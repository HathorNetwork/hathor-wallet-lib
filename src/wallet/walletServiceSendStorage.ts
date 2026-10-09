/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { orderBy } from 'lodash';
import {
  IAddressChainOptions,
  IDataTx,
  IHistoryTx,
  IStorage,
  ITokenData,
  IUtxo,
  IUtxoFilterOptions,
  IUtxoId,
  TokenVersion,
  WalletType,
} from '../types';
import {
  DEFAULT_TX_VERSION,
  MAX_INPUTS,
  NATIVE_TOKEN_UID,
  NATIVE_TOKEN_UID_HEX,
} from '../constants';
import { SendTxError, TxNotFoundError, WalletError, WalletRequestError } from '../errors';
import { deriveScanChildPrivkey, rewindShieldedOutput } from '../shielded/rewind';
import { ShieldedOutputMode } from '../shielded/types';
import { convertFullNodeToHistoryTx } from './walletServiceStorageProxy';
import walletApi from './api/walletApi';
import HathorWalletServiceWallet from './wallet';
import { FullNodeTxResponse, ShieldedUtxo, Utxo } from './types';
import Network from '../models/network';
import { toOnChainAddress } from '../utils/address';

type UtxoKind = 'transparent' | 'shielded';

type AddressChain = 'legacy' | 'shielded';

const chainOptions = (chain: AddressChain): IAddressChainOptions => ({
  legacy: chain === 'legacy',
});

/** Outputs per wallet-service `tx_outputs` request. */
const PAGE_SIZE = MAX_INPUTS;

const RECOVERED = 'recovered';

/**
 * The storage members the shared send engine (SendTransaction.prepareTxData /
 * prepareTx) may read. Anything else throws, so an engine change that needs a
 * new member fails loudly instead of reading `undefined`.
 */
const SUPPORTED_MEMBERS = new Set<string | symbol>([
  'config',
  'version',
  'logger',
  'getCurrentHeight',
  'isUtxoSelectedAsInput',
  'utxoSelectAsInput',
  'getWalletType',
  'shieldedCryptoProvider',
  'getShieldedCryptoProvider',
  'getScanXPubKey',
  'getSpendXPubKey',
  'selectUtxos',
  'getUtxo',
  'getTx',
  'getChangeAddress',
  'getCurrentAddress',
  'isAddressMine',
  'getToken',
  'store',
]);

/**
 * Members that may be probed without being used (thenable checks by `await`,
 * inspection by test tooling).
 */
const IGNORED_MEMBERS = new Set<string | symbol>(['then', 'toJSON', 'asymmetricMatch']);

/**
 * Read-only `IStorage` view of a wallet-service wallet for one send, so the
 * fullnode facade's send engine (SendTransaction, with the shielded selection
 * and change rules) builds wallet-service transactions too.
 *
 * - UTXOs come from `GET wallet/tx_outputs`, every unspent output of a token
 *   and kind, paged by value and cached for the send, so selection sees the
 *   same UTXOs a fullnode wallet would. One limit: the server orders a page by
 *   value only, so when more outputs share one value than a page holds, the
 *   ones a page leaves out are skipped (see fetchAllOutputs).
 * - Shielded UTXOs are rewound with the wallet's scan key when their pool is
 *   fetched: the engine reads their blinding factors during selection.
 * - Availability is the wallet-service's: pools exclude locked and spent
 *   outputs, the local height check is disabled (height 0) and UTXOs are
 *   locked by the tx proposal, not here. Two concurrent sends from one wallet
 *   can therefore pick the same UTXOs; the server rejects the second proposal.
 * - The current address of each chain is taken (marked as used) once per send
 *   and reused for every change output.
 */
export class WalletServiceSendStorage {
  private readonly wallet: HathorWalletServiceWallet;

  private readonly pin: string;

  private readonly storage: IStorage;

  private readonly pools = new Map<string, Promise<IUtxo[]>>();

  private readonly knownUtxos = new Map<string, IUtxo>();

  // Why a known utxo cannot be spent (locked, or held by another proposal)
  private readonly unavailable = new Map<string, string>();

  private readonly txs = new Map<string, Promise<IHistoryTx | null>>();

  private readonly addressPaths = new Map<string, string>();

  // Current address of each chain handed to the engine, with the on-chain
  // address an output paying it carries
  private readonly currentAddresses = new Map<AddressChain, { address: string; onChain: string }>();

  private readonly accessed = new Set<string>();

  private scanKey: HDPrivateKey | null = null;

  constructor(wallet: HathorWalletServiceWallet, pin: string) {
    this.wallet = wallet;
    this.pin = pin;
    this.storage = wallet.storage;
  }

  /**
   * The `IStorage` to hand to the send engine.
   */
  createProxy(): IStorage {
    const members = this.members();
    return new Proxy({} as IStorage, {
      get: (_target, prop) => {
        if (IGNORED_MEMBERS.has(prop)) {
          return undefined;
        }
        if (!SUPPORTED_MEMBERS.has(prop)) {
          throw new WalletError(
            `Storage member '${String(prop)}' is not supported by the wallet-service send adapter.`
          );
        }
        this.accessed.add(String(prop));
        return members[prop as string]();
      },
    });
  }

  /**
   * Drop the decrypted scan key once the send is prepared; opening more
   * shielded utxos decrypts it again.
   */
  release(): void {
    this.scanKey = null;
  }

  /**
   * Storage members read through the proxy so far.
   */
  accessedMembers(): string[] {
    return Array.from(this.accessed);
  }

  /**
   * Derivation path of a UTXO handed out by this adapter, for signing.
   */
  getAddressPath(txId: string, index: number): string | undefined {
    return this.addressPaths.get(utxoKey(txId, index));
  }

  private members(): Record<string, () => unknown> {
    const { storage, wallet } = this;
    return {
      config: () => configForNetwork(storage.config, wallet.network),
      version: () => ({ ...(storage.version ?? {}), reward_spend_min_blocks: 0 }),
      logger: () => storage.logger,
      getCurrentHeight: () => async () => 0,
      isUtxoSelectedAsInput: () => async () => false,
      utxoSelectAsInput: () => async () => undefined,
      getWalletType: () => async () => WalletType.P2PKH,
      shieldedCryptoProvider: () => storage.shieldedCryptoProvider,
      getShieldedCryptoProvider: () => () => storage.getShieldedCryptoProvider(),
      getScanXPubKey: () => () => storage.getScanXPubKey(),
      getSpendXPubKey: () => () => storage.getSpendXPubKey(),
      selectUtxos: () => (options?: IUtxoFilterOptions) => this.selectUtxos(options),
      getUtxo: () => (utxoId: IUtxoId) => this.getUtxo(utxoId),
      getTx: () => (txId: string) => this.getTx(txId),
      getChangeAddress: () => (options?: { changeAddress?: string | null }) =>
        this.getChangeAddress(options),
      getCurrentAddress: () => (markAsUsed?: boolean, opts?: IAddressChainOptions) =>
        this.getCurrentAddress(opts),
      isAddressMine: () => (address: string) => wallet.isAddressMine(address),
      getToken: () => (uid: string) => this.getToken(uid),
      store: () => this.storeView(),
    };
  }

  /**
   * The engine reads the store only to tell whether the wallet has a shielded
   * address to receive a shielded change. Here that is an unused shielded
   * address the wallet-service watches: with none, a shielded change cannot be
   * hosted, the same as a fullnode wallet without shielded addresses.
   */
  private storeView(): Pick<IStorage['store'], 'addressCount'> {
    return {
      addressCount: async (opts?: IAddressChainOptions) => {
        if (opts?.legacy !== false) {
          throw new WalletError(
            'Counting legacy addresses is not supported by the wallet-service send adapter.'
          );
        }
        return this.wallet.getUnusedShieldedAddressCount();
      },
    };
  }

  private async *selectUtxos(options: IUtxoFilterOptions = {}): AsyncGenerator<IUtxo> {
    const token = options.token || NATIVE_TOKEN_UID;
    const authorities = options.authorities || 0n;
    if (authorities !== 0n) {
      // The send engine never selects authorities through storage
      throw new WalletError('Selecting authority utxos is not supported by the send adapter.');
    }
    if (options.max_amount && options.target_amount) {
      throw new Error('invalid options');
    }
    const kinds: UtxoKind[] = [];
    if (options.shielded !== true) kinds.push('transparent');
    if (options.shielded !== false) kinds.push('shielded');

    let utxos: IUtxo[] = [];
    for (const kind of kinds) {
      // eslint-disable-next-line no-await-in-loop -- one pool at a time
      utxos = utxos.concat(await this.getPool(token, kind));
    }
    if (options.order_by_value) {
      utxos = orderBy(utxos, ['value'], [options.order_by_value]);
    }

    const filterAddress = options.filter_address
      ? toOnChainAddress(options.filter_address, this.wallet.network)
      : undefined;
    const nowTs = Math.floor(Date.now() / 1000);
    let sumAmount = 0n;
    let count = 0;
    for (const utxo of utxos) {
      if (
        (options.only_available_utxos && !!utxo.timelock && nowTs < utxo.timelock) ||
        (options.filter_method && !options.filter_method(utxo)) ||
        (options.amount_bigger_than && utxo.value <= options.amount_bigger_than) ||
        (options.amount_smaller_than && utxo.value >= options.amount_smaller_than) ||
        (filterAddress && utxo.address !== filterAddress)
      ) {
        continue;
      }
      if (options.max_amount && sumAmount + utxo.value > options.max_amount) {
        continue;
      }
      yield utxo;
      count += 1;
      sumAmount += utxo.value;
      if (
        (options.target_amount && sumAmount >= options.target_amount) ||
        (options.max_utxos && count >= options.max_utxos)
      ) {
        break;
      }
    }
  }

  private getPool(token: string, kind: UtxoKind): Promise<IUtxo[]> {
    const key = `${token}:${kind}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = this.fetchPool(token, kind);
      this.pools.set(key, pool);
    }
    return pool;
  }

  private async fetchPool(token: string, kind: UtxoKind): Promise<IUtxo[]> {
    const entries = await this.fetchAllOutputs(token, kind);
    const utxos: IUtxo[] = [];
    for (const entry of entries) {
      if (entry.kind === 'shielded' && entry.recoveryState !== RECOVERED) {
        // Only recovered outputs have a value the wallet-service vouches for
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- rewinds share the decrypted scan key
      utxos.push(await this.toUtxo(entry));
    }
    return utxos;
  }

  /**
   * Every unspent, unlocked output of a token and kind. The wallet-service
   * returns at most PAGE_SIZE outputs per request, largest first, filtered by
   * `value < smallerThan`; each next page starts at the last value seen (ties
   * included) and repeated outputs are dropped.
   */
  private async fetchAllOutputs(token: string, kind: UtxoKind): Promise<Utxo[]> {
    const seen = new Map<string, Utxo>();
    let smallerThan: bigint | undefined;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- pages depend on the previous one
      const { txOutputs } = await walletApi.getTxOutputs(this.wallet, {
        tokenId: token,
        kind,
        skipSpent: true,
        ignoreLocked: true,
        authority: 0n,
        maxOutputs: PAGE_SIZE,
        ...(smallerThan !== undefined ? { smallerThan: smallerThan.toString() } : {}),
      });
      let added = 0;
      for (const entry of txOutputs) {
        const key = utxoKey(entry.txId, entry.index);
        if (!seen.has(key)) {
          seen.set(key, entry);
          added += 1;
        }
      }
      if (txOutputs.length < PAGE_SIZE) {
        break;
      }
      const lastValue = txOutputs[txOutputs.length - 1].value;
      // Start the next page at the last value, to keep the outputs tied with it.
      // When a whole page was already seen, a single value has more outputs than
      // a page holds: move past it, as no request can return the rest. Those
      // outputs are left out; ordering ties by value alone, the server has no
      // cursor that reaches them.
      smallerThan = added > 0 ? lastValue + 1n : lastValue;
      if (smallerThan <= 1n) {
        break;
      }
    }
    return Array.from(seen.values());
  }

  /**
   * A utxo the send may spend: never `null`, which the engine would read as a
   * transparent input.
   */
  private async getUtxo({ txId, index }: IUtxoId): Promise<IUtxo> {
    const utxo = await this.findOwnUtxo(txId, index);
    if (!utxo) {
      throw new SendTxError(`Utxo ${txId}:${index} is not an unspent output of this wallet.`);
    }
    const unavailable = this.unavailable.get(utxoKey(txId, index));
    if (unavailable) {
      throw new SendTxError(`Utxo ${txId}:${index} ${unavailable}.`);
    }
    return utxo;
  }

  /**
   * An unspent output of this wallet, opened if shielded, whether or not it is
   * available to spend; `null` when the wallet-service has no such output for
   * this wallet.
   */
  private async findOwnUtxo(txId: string, index: number): Promise<IUtxo | null> {
    const known = this.knownUtxos.get(utxoKey(txId, index));
    if (known) {
      return known;
    }
    let entry: Utxo | null;
    try {
      entry = await this.wallet.getUtxoFromId(txId, index);
    } catch (e) {
      if (isClientError(e)) {
        // The wallet-service refuses the lookup: not an output of this wallet
        return null;
      }
      throw e;
    }
    if (!entry || (entry.kind === 'shielded' && entry.recoveryState !== RECOVERED)) {
      return null;
    }
    return this.toUtxo(entry);
  }

  /**
   * Convert a wallet-service output to the storage `IUtxo` the engine reads,
   * recovering the blinding factors of a shielded one.
   */
  private async toUtxo(entry: Utxo): Promise<IUtxo> {
    const token = entry.tokenId === '00' ? NATIVE_TOKEN_UID : entry.tokenId;
    const utxo: IUtxo = {
      txId: entry.txId,
      index: entry.index,
      token,
      address: entry.address,
      value: entry.value,
      authorities: entry.authorities,
      timelock: entry.timelock,
      // Not read by the send path; the wallet-service already filters locks
      type: DEFAULT_TX_VERSION,
      height: null,
    };
    if (entry.kind === 'shielded') {
      Object.assign(utxo, await this.rewind(entry, token));
    }
    const key = utxoKey(entry.txId, entry.index);
    this.knownUtxos.set(key, utxo);
    this.addressPaths.set(key, entry.addressPath);
    if (entry.locked) {
      this.unavailable.set(key, 'is locked');
    } else if (entry.txProposalId) {
      this.unavailable.set(key, 'is already used by another tx proposal');
    }
    return utxo;
  }

  private async rewind(
    entry: ShieldedUtxo,
    token: string
  ): Promise<Pick<IUtxo, 'shielded' | 'blindingFactor' | 'assetBlindingFactor'>> {
    if (!this.scanKey) {
      this.scanKey = new HDPrivateKey(await this.storage.getScanXPrivKey(this.pin));
    }
    const privkey = deriveScanChildPrivkey(this.scanKey, entry.shieldedIndex);
    try {
      const tokenUid = token === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : token;
      const rewound = await rewindShieldedOutput(
        this.storage.getShieldedCryptoProvider(),
        privkey,
        {
          ephemeralPubkey: Buffer.from(entry.ephemeralPubkey, 'hex'),
          commitment: Buffer.from(entry.commitment, 'hex'),
          rangeProof: Buffer.from(entry.rangeProof, 'hex'),
          ...(entry.mode === 2
            ? {
                mode: ShieldedOutputMode.FULLY_SHIELDED,
                assetCommitment: Buffer.from(entry.assetCommitment, 'hex'),
              }
            : { mode: ShieldedOutputMode.AMOUNT_SHIELDED, tokenUid }),
        }
      );
      if (rewound.value !== entry.value || rewound.tokenUid !== tokenUid) {
        throw new SendTxError(
          `Shielded utxo ${entry.txId}:${entry.index} does not open to the amount and token ` +
            'the wallet-service reports.'
        );
      }
      return {
        shielded: true,
        blindingFactor: rewound.blindingFactor.toString('hex'),
        ...(rewound.assetBlindingFactor
          ? { assetBlindingFactor: rewound.assetBlindingFactor.toString('hex') }
          : {}),
      };
    } finally {
      privkey.fill(0);
    }
  }

  /**
   * The full transaction, with the wallet's own shielded outputs carrying the
   * value, token, address and blinding factors the fullnode does not expose,
   * as they would be in a fullnode wallet's history.
   */
  private getTx(txId: string): Promise<IHistoryTx | null> {
    // The engine reads the same transaction several times per input
    let tx = this.txs.get(txId);
    if (!tx) {
      tx = this.fetchTx(txId);
      this.txs.set(txId, tx);
    }
    return tx;
  }

  private async fetchTx(txId: string): Promise<IHistoryTx | null> {
    let response: FullNodeTxResponse;
    try {
      response = await this.wallet.getFullTxById(txId);
    } catch (e) {
      if (e instanceof TxNotFoundError) {
        return null;
      }
      throw e;
    }
    const tx = convertFullNodeToHistoryTx(response);
    const shieldedOutputs = tx.shielded_outputs ?? [];
    for (const [s, output] of shieldedOutputs.entries()) {
      // eslint-disable-next-line no-await-in-loop -- few shielded outputs per tx
      const utxo = await this.findOwnUtxo(txId, tx.outputs.length + s);
      if (utxo?.shielded) {
        // What a fullnode wallet's history holds for its own shielded output.
        // Whether it can be spent is checked when it is used as an input.
        output.value = utxo.value;
        output.token = utxo.token;
        output.blindingFactor = utxo.blindingFactor;
        output.assetBlindingFactor = utxo.assetBlindingFactor;
        output.decoded = { ...output.decoded, address: utxo.address };
        output.mode = utxo.assetBlindingFactor
          ? ShieldedOutputMode.FULLY_SHIELDED
          : ShieldedOutputMode.AMOUNT_SHIELDED;
      }
    }
    return tx;
  }

  private async getChangeAddress({
    changeAddress,
  }: { changeAddress?: string | null } = {}): Promise<string> {
    if (changeAddress) {
      if (!(await this.wallet.isAddressMine(changeAddress))) {
        throw new Error('Change address is not from the wallet');
      }
      return changeAddress;
    }
    return this.getCurrentAddress();
  }

  private async getCurrentAddress(opts?: IAddressChainOptions): Promise<string> {
    const chain: AddressChain = opts?.legacy === false ? 'shielded' : 'legacy';
    let current = this.currentAddresses.get(chain);
    if (!current) {
      // Not marked as used here: the engine also reads it only to check that a
      // shielded change could be hosted (see markChangeAddressesUsed)
      const info = this.wallet.getCurrentAddress({}, chainOptions(chain));
      const onChain = (info as { spendAddress?: string }).spendAddress ?? info.address;
      current = { address: info.address, onChain };
      this.currentAddresses.set(chain, current);
    }
    return current.address;
  }

  /**
   * Mark as used the current address of each chain the built transaction
   * pays, so the next send gets a new one. All change outputs of a chain go
   * to its current address.
   */
  markChangeAddressesUsed(txData: IDataTx): void {
    const paid = new Set<string>();
    for (const output of txData.outputs) {
      if ('address' in output && output.address) {
        paid.add(output.address);
      }
    }
    for (const output of txData.shieldedOutputs ?? []) {
      paid.add(output.address);
    }
    for (const [chain, { onChain }] of this.currentAddresses) {
      if (paid.has(onChain)) {
        this.wallet.getCurrentAddress({ markAsUsed: true }, chainOptions(chain));
      }
    }
  }

  private async getToken(uid: string): Promise<ITokenData> {
    if (uid === NATIVE_TOKEN_UID) {
      const nativeToken = this.storage.getNativeTokenData();
      return { ...nativeToken, uid: NATIVE_TOKEN_UID, version: TokenVersion.NATIVE };
    }
    const { tokenInfo } = await this.wallet.getTokenDetails(uid);
    return {
      uid: tokenInfo.id,
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      version: tokenInfo.version,
    };
  }
}

/**
 * A wallet-service request the server refused (4xx), as opposed to one that
 * failed to reach or be served by it.
 */
function isClientError(e: unknown): boolean {
  if (!(e instanceof WalletRequestError) || !e.cause || !('status' in e.cause)) {
    return false;
  }
  return e.cause.status >= 400 && e.cause.status < 500;
}

function utxoKey(txId: string, index: number): string {
  return `${txId}:${index}`;
}

/**
 * The wallet storage's config, reporting the wallet's network: the facade
 * never sets the global config network, which the send engine reads.
 */
function configForNetwork(config: IStorage['config'], network: Network): IStorage['config'] {
  const scoped = Object.create(config);
  scoped.getNetwork = () => network;
  return scoped;
}
