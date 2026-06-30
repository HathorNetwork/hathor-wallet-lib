/* eslint-disable class-methods-use-this */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HathorWalletServiceWallet } from '../../../src';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import config from '../../../src/config';
import { WalletTracker } from '../utils/wallet-tracker.util';
import type Transaction from '../../../src/models/transaction';
import {
  buildWalletInstance,
  initializeServiceGlobalConfigs,
  pollForTx,
  pollForTokenDetails,
  pollUntilCondition,
  retryOnTransientWalletInit,
} from '../helpers/service-facade.helper';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import type { WalletStopOptions } from '../../../src/new/types';
import type { IHistoryTx } from '../../../src/types';
import { AuthorityType } from '../../../src/types';
import { NETWORK_NAME } from '../configuration/test-constants';
import type { FullNodeTxResponse } from '../../../src/wallet/types';
import type {
  FuzzyWalletType,
  IWalletTestAdapter,
  WalletCapabilities,
  CreateWalletOptions,
  CreateWalletResult,
  SendTransactionOptions,
  SendTransactionResult,
  CreateTokenOptions,
  CreateTokenResult,
  TokenDetailsResult,
  GetUtxosAdapterOptions,
  GetUtxosResult,
  AdapterUtxo,
  AdapterOutput,
  SendManyOutputsAdapterOptions,
  AuthorityUtxoResult,
  GetAuthorityUtxosOptions,
  DelegateAuthorityAdapterOptions,
  DelegateAuthorityResult,
  MintTokensAdapterOptions,
  MintTokensResult,
  MeltTokensAdapterOptions,
  MeltTokensResult,
  DestroyAuthorityResult,
} from './types';
import type { PrecalculatedWalletData } from '../helpers/wallet-precalculation.helper';

const SERVICE_PIN = '123456';
const SERVICE_PASSWORD = 'testpass';

/** Stop options shared between {@link stopWallet} and the {@link WalletTracker}. */
const STOP_OPTIONS: WalletStopOptions = { cleanStorage: true };

/**
 * Like {@link CreateWalletResult}, but with `wallet` narrowed to the concrete
 * {@link HathorWalletServiceWallet}. This adapter only ever builds service
 * wallets, so service-specific tests can read `created.wallet` with no cast.
 */
type ServiceCreateWalletResult = CreateWalletResult & { wallet: HathorWalletServiceWallet };

/**
 * Adapter for the wallet-service facade ({@link HathorWalletServiceWallet}).
 *
 * Key behavioral differences from the fullnode adapter:
 * - `start()` blocks until the wallet is ready (no explicit `waitForReady()` needed).
 * - Does not support multisig, token scoping, or external signing.
 * - Uses the wallet-service helpers ({@link GenesisWalletServiceHelper}) for fund injection.
 */
export class ServiceWalletTestAdapter implements IWalletTestAdapter {
  name = 'Wallet Service';

  networkName = NETWORK_NAME;

  defaultPinCode = SERVICE_PIN;

  defaultPassword = SERVICE_PASSWORD;

  private _originalServerUrl?: string;

  testnetServerUrl = 'https://wallet-service.testnet.hathor.network/';

  get originalServerUrl(): string {
    if (!this._originalServerUrl) {
      throw new Error('originalServerUrl not initialized. Call suiteSetup() first.');
    }
    return this._originalServerUrl;
  }

  async suiteSetup(): Promise<void> {
    initializeServiceGlobalConfigs();
    this._originalServerUrl = config.getWalletServiceBaseUrl();
    await GenesisWalletServiceHelper.start();
  }

  capabilities: WalletCapabilities = {
    supportsMultisig: false,
    supportsTokenScope: false,
    supportsXpubReadonly: true,
    supportsExternalSigning: false,
    supportsRuntimeAddressCalculation: false,
    supportsPreStartFunding: true,
    requiresExplicitWaitReady: false,
    stateEventValues: {
      loading: 'Loading',
      ready: 'Ready',
    },
  };

  private readonly tracker = new WalletTracker<HathorWalletServiceWallet>(STOP_OPTIONS);

  /** Wallets created with xpub need {@link HathorWalletServiceWallet.startReadOnly} instead of start(). */
  private readonly xpubWallets = new WeakSet<HathorWalletServiceWallet>();

  /**
   * Narrows a {@link FuzzyWalletType} to the concrete {@link HathorWalletServiceWallet}.
   *
   * The double-cast (`as unknown as`) is required because {@link IHathorWallet}
   * and {@link HathorWalletServiceWallet} are not structurally compatible (see
   * type aliases in types.ts). Centralizing it here keeps the rest of the adapter cast-free.
   */
  private concrete(wallet: FuzzyWalletType): HathorWalletServiceWallet {
    return wallet as unknown as HathorWalletServiceWallet;
  }

  async suiteTeardown(): Promise<void> {
    await this.stopAllWallets();
    await GenesisWalletServiceHelper.stop();
  }

  async createWallet(options?: CreateWalletOptions): Promise<ServiceCreateWalletResult> {
    // The wallet-service backend must know about the wallet before startReadOnly() can
    // attach to it. When both seed and xpub are provided, pre-register the wallet by
    // starting it with the seed, then stop and restart as a readonly xpub client.
    if (options?.xpub && options?.seed) {
      const seedWallet = this.buildWalletInstance({ seed: options.seed });
      await this.startWallet(seedWallet.wallet, {
        pinCode: options.pinCode ?? SERVICE_PIN,
        password: options.password ?? SERVICE_PASSWORD,
      });
      await this.stopWallet(seedWallet.wallet);
    }

    const built = this.buildWalletInstance(options);

    await this.startWallet(built.wallet, {
      pinCode: options?.pinCode ?? SERVICE_PIN,
      password: options?.password ?? SERVICE_PASSWORD,
    });

    return built;
  }

  buildWalletInstance(options?: CreateWalletOptions): ServiceCreateWalletResult {
    // xpub and seed are mutually exclusive in the constructor — prefer xpub when present.
    const result = buildWalletInstance({
      words: options?.xpub ? '' : options?.seed || '',
      xpub: options?.xpub || '',
      enableWs: false,
      singleAddressMode: options?.singleAddressMode,
    });

    this.tracker.track(result.wallet);
    if (options?.xpub) {
      this.xpubWallets.add(result.wallet);
    }

    return {
      wallet: result.wallet,
      storage: result.storage,
      words: result.words,
      addresses: result.addresses,
    };
  }

  async startWallet(
    wallet: FuzzyWalletType,
    options?: { pinCode?: string; password?: string }
  ): Promise<void> {
    const sw = this.concrete(wallet);

    if (this.xpubWallets.has(sw)) {
      // Readonly wallets use a dedicated start method that requires no credentials.
      await sw.startReadOnly();
      return;
    }

    // Pass options through directly — do NOT fill defaults when the caller
    // explicitly passes undefined (used by validation tests).
    // Wrap in retryOnTransientWalletInit so a freshly-spawned wallet-service
    // backend rejecting `POST wallet/init` doesn't fail the suite's beforeAll
    // (Jest's retryTimes only re-runs it() bodies, not setup hooks).
    await retryOnTransientWalletInit(
      () => sw.start({ pinCode: options?.pinCode, password: options?.password }),
      'ServiceWalletTestAdapter.startWallet'
    );
  }

  async waitForReady(_wallet: FuzzyWalletType): Promise<void> {
    // The service wallet's start() already waits for ready by default (waitReady=true).
    // Nothing additional needed.
  }

  async stopWallet(wallet: FuzzyWalletType): Promise<void> {
    const sw = this.concrete(wallet);
    await sw.stop(STOP_OPTIONS);
    this.tracker.untrack(sw);
  }

  async stopAllWallets(): Promise<void> {
    await this.tracker.stopAll();
  }

  async injectFunds(
    destWallet: FuzzyWalletType,
    address: string,
    amount: bigint
  ): Promise<Transaction> {
    return GenesisWalletServiceHelper.injectFunds(address, amount, this.concrete(destWallet));
  }

  /**
   * Sends funds to an address whose wallet has not started yet.
   *
   * Cannot delegate to {@link injectFunds} because that method passes the
   * destination wallet to the helper so it polls for tx confirmation on both
   * sides — but the destination wallet isn't running yet, so polling it would
   * hang or fail. Omitting the destination wallet makes the helper skip that poll.
   */
  async injectFundsBeforeStart(address: string, amount: bigint): Promise<string> {
    const fundTx = await GenesisWalletServiceHelper.injectFunds(address, amount);
    if (!fundTx?.hash) {
      throw new Error('injectFundsBeforeStart: transaction had no hash');
    }
    return fundTx.hash;
  }

  async waitForTx(
    wallet: FuzzyWalletType,
    txId: string,
    recvWallet?: FuzzyWalletType
  ): Promise<void> {
    await pollForTx(this.concrete(wallet), txId);
    if (recvWallet) {
      await pollForTx(this.concrete(recvWallet), txId);
    }
  }

  getPrecalculatedWallet(): PrecalculatedWalletData {
    return precalculationHelpers.test!.getPrecalculatedWallet();
  }

  async sendTransaction(
    wallet: FuzzyWalletType,
    address: string,
    amount: bigint,
    options?: SendTransactionOptions
  ): Promise<SendTransactionResult> {
    const sw = this.concrete(wallet);
    const { recvWallet, ...txOptions } = options ?? {};
    const result = await sw.sendTransaction(address, amount, {
      pinCode: SERVICE_PIN,
      ...txOptions,
    });
    if (!result.hash) {
      throw new Error('sendTransaction: transaction had no hash');
    }
    await this.waitForTx(wallet, result.hash, recvWallet);
    return { hash: result.hash, transaction: result };
  }

  async getTx(wallet: FuzzyWalletType, txId: string) {
    // HathorWalletServiceWallet.getTx() is not implemented — use fullnode API
    // and map the response to IHistoryTx format (adding token UID to each output/input)
    const fullNodeResponse = await this.concrete(wallet).getFullTxById(txId);
    const { tx } = fullNodeResponse;
    const tokenUids = tx.tokens.map(t => t.uid);
    const resolveToken = (tokenData: number) =>
      tokenData === 0 ? NATIVE_TOKEN_UID : tokenUids[tokenData - 1];
    return {
      tx_id: tx.hash,
      version: tx.version,
      timestamp: tx.timestamp,
      inputs: tx.inputs.map(i => ({ ...i, token: resolveToken(i.token_data) })),
      outputs: tx.outputs.map(o => ({ ...o, token: resolveToken(o.token_data) })),
      parents: tx.parents,
      tokens: tx.tokens,
      weight: tx.weight,
      nonce: Number(tx.nonce),
    } as unknown as IHistoryTx;
  }

  async getFullTxById(wallet: FuzzyWalletType, txId: string): Promise<FullNodeTxResponse> {
    return this.concrete(wallet).getFullTxById(txId);
  }

  async createToken(
    wallet: FuzzyWalletType,
    name: string,
    symbol: string,
    amount: bigint,
    options?: CreateTokenOptions
  ): Promise<CreateTokenResult> {
    const sw = this.concrete(wallet);
    const result = await sw.createNewToken(name, symbol, amount, {
      ...options,
      pinCode: SERVICE_PIN,
    });
    if (!result?.hash) {
      throw new Error('createToken: transaction had no hash');
    }
    await pollForTx(sw, result.hash);
    await pollForTokenDetails(sw, result.hash);
    return { hash: result.hash, transaction: result };
  }

  async getTokenDetails(wallet: FuzzyWalletType, tokenUid: string): Promise<TokenDetailsResult> {
    return this.concrete(wallet).getTokenDetails(tokenUid);
  }

  async getUtxos(
    wallet: FuzzyWalletType,
    options?: GetUtxosAdapterOptions
  ): Promise<GetUtxosResult> {
    const tokenId = options?.token ?? NATIVE_TOKEN_UID;
    const result = await this.concrete(wallet).getUtxos({
      token: tokenId,
      filter_address: options?.address,
    });

    const utxos: AdapterUtxo[] = result.utxos.map(u => ({
      txId: u.tx_id,
      index: u.index,
      value: u.amount,
      address: u.address,
      tokenId,
      locked: u.locked,
    }));

    return {
      total_amount_available: result.total_amount_available,
      total_utxos_available: result.total_utxos_available,
      utxos,
    };
  }

  async sendManyOutputsTransaction(
    wallet: FuzzyWalletType,
    outputs: AdapterOutput[],
    options?: SendManyOutputsAdapterOptions
  ): Promise<SendTransactionResult> {
    const sw = this.concrete(wallet);
    const { recvWallet, ...txOptions } = options ?? {};
    const result = await sw.sendManyOutputsTransaction(outputs, {
      pinCode: SERVICE_PIN,
      ...txOptions,
    });
    if (!result?.hash) {
      throw new Error('sendManyOutputsTransaction: transaction had no hash');
    }
    await this.waitForTx(wallet, result.hash, recvWallet);
    return { hash: result.hash, transaction: result };
  }

  async getAuthorityUtxos(
    wallet: FuzzyWalletType,
    tokenUid: string,
    type: AuthorityType,
    options?: GetAuthorityUtxosOptions
  ): Promise<AuthorityUtxoResult[]> {
    const sw = this.concrete(wallet);
    const utxos = await sw.getAuthorityUtxo(tokenUid, type, {
      many: options?.many ?? true,
      only_available_utxos: true,
      filter_address: options?.filter_address,
    });
    return utxos.map(u => ({
      txId: u.txId,
      index: u.index,
      address: u.address,
      authorities: u.authorities,
    }));
  }

  async delegateAuthority(
    wallet: FuzzyWalletType,
    tokenUid: string,
    type: AuthorityType,
    destinationAddress: string,
    options?: DelegateAuthorityAdapterOptions
  ): Promise<DelegateAuthorityResult> {
    const sw = this.concrete(wallet);
    const result = await sw.delegateAuthority(tokenUid, type, destinationAddress, {
      pinCode: SERVICE_PIN,
      anotherAuthorityAddress: null,
      createAnother: options?.createAnother ?? false,
    });
    if (!result?.hash) {
      throw new Error('delegateAuthority: transaction had no hash');
    }
    await pollForTx(sw, result.hash);

    // The wallet service UTXO index may lag behind tx visibility.
    // Poll until the delegation tx appears in the authority UTXO list.
    const delegationTxId = result.hash;
    await pollUntilCondition(async () => {
      const utxos = await sw.getAuthorityUtxo(tokenUid, type, {
        many: true,
        only_available_utxos: true,
      });
      return utxos.some(u => u.txId === delegationTxId);
    }, `authority UTXO index reflects delegation ${delegationTxId}`);

    // When a destination wallet is provided, also wait for ITS index to reflect
    // the delegation so cross-wallet tests can read the recipient's authorities.
    if (options?.recvWallet) {
      const recv = this.concrete(options.recvWallet);
      await pollForTx(recv, delegationTxId);
      await pollUntilCondition(async () => {
        const utxos = await recv.getAuthorityUtxo(tokenUid, type, {
          many: true,
          only_available_utxos: true,
        });
        return utxos.some(u => u.txId === delegationTxId);
      }, `recipient authority UTXO index reflects delegation ${delegationTxId}`);
    }

    return { hash: result.hash };
  }

  async mintTokens(
    wallet: FuzzyWalletType,
    tokenUid: string,
    amount: bigint,
    options?: MintTokensAdapterOptions
  ): Promise<MintTokensResult> {
    const sw = this.concrete(wallet);

    // Capture the current token balance so we can wait for the UTXO/balance
    // index to reflect the mint. Minting increases the token balance by `amount`
    // on BOTH deposit- and fee-based tokens, regardless of where the new mint
    // authority is routed — so this is a robust settle signal even when the
    // authority is delegated to an external address.
    const [balanceBefore] = await sw.getBalance(tokenUid);
    const expectedUnlocked = balanceBefore.balance.unlocked + amount;

    const result = await sw.mintTokens(tokenUid, amount, {
      ...options,
      pinCode: SERVICE_PIN,
    });
    if (!result?.hash) {
      throw new Error('mintTokens: transaction had no hash');
    }
    await pollForTx(sw, result.hash);
    await pollUntilCondition(async () => {
      const [balance] = await sw.getBalance(tokenUid);
      return balance.balance.unlocked >= expectedUnlocked;
    }, `token balance index reflects mint ${result.hash}`);

    return { hash: result.hash, transaction: result };
  }

  async meltTokens(
    wallet: FuzzyWalletType,
    tokenUid: string,
    amount: bigint,
    options?: MeltTokensAdapterOptions
  ): Promise<MeltTokensResult> {
    const sw = this.concrete(wallet);

    // Capture the current token balance so we can wait for the UTXO/balance
    // index to reflect the melt. Melting decreases the token balance by `amount`
    // on BOTH deposit- and fee-based tokens, so this is a robust settle signal.
    const [balanceBefore] = await sw.getBalance(tokenUid);
    const expectedUnlocked = balanceBefore.balance.unlocked - amount;

    const result = await sw.meltTokens(tokenUid, amount, {
      ...options,
      pinCode: SERVICE_PIN,
    });
    if (!result?.hash) {
      throw new Error('meltTokens: transaction had no hash');
    }
    await pollForTx(sw, result.hash);
    await pollUntilCondition(async () => {
      const [balance] = await sw.getBalance(tokenUid);
      return balance.balance.unlocked <= expectedUnlocked;
    }, `token balance index reflects melt ${result.hash}`);

    return { hash: result.hash, transaction: result };
  }

  async destroyAuthority(
    wallet: FuzzyWalletType,
    tokenUid: string,
    type: AuthorityType,
    count: number
  ): Promise<DestroyAuthorityResult> {
    const sw = this.concrete(wallet);

    // Capture the current authority count so we can wait for the UTXO index to
    // reflect the destruction. `getAuthorityUtxo` throwing (e.g. count too high)
    // surfaces before any polling, preserving the rejection for the caller.
    const countBefore = (
      await sw.getAuthorityUtxo(tokenUid, type, { many: true, only_available_utxos: true })
    ).length;

    const result = await sw.destroyAuthority(tokenUid, type, count, { pinCode: SERVICE_PIN });
    if (!result?.hash) {
      throw new Error('destroyAuthority: transaction had no hash');
    }
    await pollForTx(sw, result.hash);
    await pollUntilCondition(async () => {
      const remaining = (
        await sw.getAuthorityUtxo(tokenUid, type, { many: true, only_available_utxos: true })
      ).length;
      return remaining <= countBefore - count;
    }, `authority UTXO index reflects destroy ${result.hash}`);

    return { hash: result.hash };
  }
}
