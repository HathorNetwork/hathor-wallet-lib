/* eslint-disable class-methods-use-this */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../../src/new/wallet';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { WalletTracker } from '../utils/wallet-tracker.util';
import {
  AddressScanPolicyData,
  AuthorityType,
  IPrecalculatedShieldedAddress,
  SCANNING_POLICY,
  WalletState,
} from '../../../src/types';
import type Transaction from '../../../src/models/transaction';
import {
  generateConnection,
  waitForWalletReady,
  waitForTxReceived,
  waitUntilNextTimestamp,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
} from '../helpers/wallet.helper';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { getPrecalculatedShieldedForSeed } from '../configuration/precalculated-shielded-addresses';
import type { WalletStopOptions } from '../../../src/new/types';
import { FULLNODE_URL, NETWORK_NAME } from '../configuration/test-constants';
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
  MintTokensAdapterOptions,
  MeltTokensAdapterOptions,
  MintMeltResult,
  TokenDetailsResult,
  GetUtxosAdapterOptions,
  GetUtxosResult,
  GetUtxosForAmountResult,
  AdapterUtxo,
  AdapterOutput,
  SendManyOutputsAdapterOptions,
  AuthorityUtxoResult,
  GetAuthorityUtxosOptions,
  DelegateAuthorityAdapterOptions,
  DelegateAuthorityResult,
  AdapterAddress,
} from './types';
import type { PrecalculatedWalletData } from '../helpers/wallet-precalculation.helper';
import { getGapLimitConfig } from '../utils/core.util';

/** Stop options shared between {@link stopWallet} and the {@link WalletTracker}. */
const STOP_OPTIONS: WalletStopOptions = { cleanStorage: true, cleanAddresses: true };

/**
 * Adapter for the fullnode facade ({@link HathorWallet}).
 *
 * Key behavioral differences from the service adapter:
 * - `start()` returns immediately; callers must explicitly `waitForReady()`.
 * - Supports multisig, xpub-readonly, token scoping, and external signing.
 * - Uses the fullnode P2P helpers ({@link GenesisWalletHelper}) for fund injection.
 */
export class FullnodeWalletTestAdapter implements IWalletTestAdapter {
  name = 'Fullnode';

  networkName = NETWORK_NAME;

  defaultPinCode = DEFAULT_PIN_CODE;

  defaultPassword = DEFAULT_PASSWORD;

  originalServerUrl = FULLNODE_URL;

  testnetServerUrl = 'https://node1.testnet.hathor.network/v1a/';

  capabilities: WalletCapabilities = {
    supportsMultisig: true,
    supportsTokenScope: true,
    supportsXpubReadonly: true,
    supportsExternalSigning: true,
    supportsRuntimeAddressCalculation: true,
    supportsPreStartFunding: true,
    requiresExplicitWaitReady: true,
    stateEventValues: {
      loading: WalletState.CONNECTING,
      ready: WalletState.READY,
    },
  };

  private readonly tracker = new WalletTracker<HathorWallet>(STOP_OPTIONS);

  /**
   * Narrows a {@link FuzzyWalletType} to the concrete {@link HathorWallet}.
   *
   * The double-cast (`as unknown as`) is required because {@link IHathorWallet}
   * and {@link HathorWallet} are not structurally compatible (see type aliases
   * in types.ts). Centralizing it here keeps the rest of the adapter cast-free.
   */
  private concrete(wallet: FuzzyWalletType): HathorWallet {
    return wallet as unknown as HathorWallet;
  }

  async suiteSetup(): Promise<void> {
    // GenesisWalletHelper lazily initializes via getSingleton(), no explicit setup needed.
    await GenesisWalletHelper.getSingleton();
  }

  async suiteTeardown(): Promise<void> {
    await this.stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  }

  /**
   * Creates a fully started, ready-to-use wallet with default credentials.
   *
   * Delegates to {@link buildWalletInstance} for construction and
   * {@link startWallet} for startup, filling in default credentials so tests
   * that just need a working wallet have zero setup friction.
   */
  async createWallet(options?: CreateWalletOptions): Promise<CreateWalletResult> {
    const built = await this.buildWalletInstance(options);

    await this.startWallet(built.wallet, {
      pinCode: options?.pinCode ?? DEFAULT_PIN_CODE,
      password: options?.password ?? DEFAULT_PASSWORD,
    });
    await this.waitForReady(built.wallet);

    return built;
  }

  async buildWalletInstance(options?: CreateWalletOptions): Promise<CreateWalletResult> {
    const walletData = await this.resolveWordsAndAddresses(options);
    const walletConfig = this.buildConfig(walletData, options);

    const hWallet = new HathorWallet(walletConfig);
    this.tracker.track(hWallet);

    return {
      wallet: hWallet as FuzzyWalletType,
      storage: hWallet.storage,
      words: walletData.words,
      addresses: walletData.addresses,
    };
  }

  async startWallet(
    wallet: FuzzyWalletType,
    options?: { pinCode?: string; password?: string }
  ): Promise<void> {
    await this.concrete(wallet).start({
      pinCode: options?.pinCode,
      password: options?.password,
    });
  }

  async waitForReady(wallet: FuzzyWalletType): Promise<void> {
    await waitForWalletReady(this.concrete(wallet));
  }

  async stopWallet(wallet: FuzzyWalletType): Promise<void> {
    const hWallet = this.concrete(wallet);
    await hWallet.stop(STOP_OPTIONS);
    this.tracker.untrack(hWallet);
  }

  async stopAllWallets(): Promise<void> {
    await this.tracker.stopAll();
  }

  async injectFunds(
    destWallet: FuzzyWalletType,
    address: string,
    amount: bigint
  ): Promise<Transaction> {
    return GenesisWalletHelper.injectFunds(this.concrete(destWallet), address, amount);
  }

  /**
   * Sends funds to an address whose wallet has not started yet.
   *
   * Cannot delegate to {@link injectFunds} because that method polls both the
   * genesis and the destination wallet for tx confirmation — but the destination
   * wallet isn't running yet, so polling it would hang or fail.
   */
  async injectFundsBeforeStart(address: string, amount: bigint): Promise<string> {
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    const result = await gWallet.sendTransaction(address, amount);
    if (!result || !result.hash) {
      throw new Error('injectFundsBeforeStart: transaction had no hash');
    }
    return result.hash;
  }

  async waitForTx(
    wallet: FuzzyWalletType,
    txId: string,
    recvWallet?: FuzzyWalletType
  ): Promise<void> {
    const hWallet = this.concrete(wallet);
    await waitForTxReceived(hWallet, txId);
    if (recvWallet) {
      const hRecv = this.concrete(recvWallet);
      await waitForTxReceived(hRecv, txId);
    }
    await waitUntilNextTimestamp(hWallet, txId);
  }

  getPrecalculatedWallet(): Promise<PrecalculatedWalletData> {
    return precalculationHelpers.test!.getPrecalculatedWallet();
  }

  async sendTransaction(
    wallet: FuzzyWalletType,
    address: string,
    amount: bigint,
    options?: SendTransactionOptions
  ): Promise<SendTransactionResult> {
    const hWallet = this.concrete(wallet);
    const { recvWallet, ...txOptions } = options ?? {};
    const result = await hWallet.sendTransaction(address, amount, {
      pinCode: DEFAULT_PIN_CODE,
      ...txOptions,
    });
    if (!result || !result.hash) {
      throw new Error('sendTransaction: transaction had no hash');
    }
    await this.waitForTx(wallet, result.hash, recvWallet);
    return { hash: result.hash, transaction: result };
  }

  async getTx(wallet: FuzzyWalletType, txId: string) {
    const result = await this.concrete(wallet).getTx(txId);
    if (!result) {
      throw new Error(`getTx: transaction ${txId} not found`);
    }
    return result;
  }

  async getFullTxById(wallet: FuzzyWalletType, txId: string): Promise<FullNodeTxResponse> {
    // The fullnode facade returns FullNodeTxApiResponse (zod-inferred), which is structurally
    // compatible with FullNodeTxResponse but has minor nullability differences.
    return this.concrete(wallet).getFullTxById(txId) as Promise<FullNodeTxResponse>;
  }

  async createToken(
    wallet: FuzzyWalletType,
    name: string,
    symbol: string,
    amount: bigint,
    options?: CreateTokenOptions
  ): Promise<CreateTokenResult> {
    const hWallet = this.concrete(wallet);
    const result = await hWallet.createNewToken(name, symbol, amount, {
      pinCode: DEFAULT_PIN_CODE,
      ...options,
    });
    if (!result?.hash) {
      throw new Error('createToken: transaction had no hash');
    }
    await waitForTxReceived(hWallet, result.hash);
    await waitUntilNextTimestamp(hWallet, result.hash);
    return { hash: result.hash, transaction: result };
  }

  async mintTokens(
    wallet: FuzzyWalletType,
    tokenUid: string,
    amount: bigint,
    options?: MintTokensAdapterOptions
  ): Promise<MintMeltResult> {
    const hWallet = this.concrete(wallet);
    const result = await hWallet.mintTokens(tokenUid, amount, {
      pinCode: DEFAULT_PIN_CODE,
      ...options,
    });
    if (!result?.hash) {
      throw new Error('mintTokens: transaction had no hash');
    }
    await waitForTxReceived(hWallet, result.hash);
    await waitUntilNextTimestamp(hWallet, result.hash);
    return { hash: result.hash, transaction: result };
  }

  async meltTokens(
    wallet: FuzzyWalletType,
    tokenUid: string,
    amount: bigint,
    options?: MeltTokensAdapterOptions
  ): Promise<MintMeltResult> {
    const hWallet = this.concrete(wallet);
    const result = await hWallet.meltTokens(tokenUid, amount, {
      pinCode: DEFAULT_PIN_CODE,
      ...options,
    });
    if (!result?.hash) {
      throw new Error('meltTokens: transaction had no hash');
    }
    await waitForTxReceived(hWallet, result.hash);
    await waitUntilNextTimestamp(hWallet, result.hash);
    return { hash: result.hash, transaction: result };
  }

  async getTokenDetails(wallet: FuzzyWalletType, tokenUid: string): Promise<TokenDetailsResult> {
    return this.concrete(wallet).getTokenDetails(tokenUid);
  }

  async getUtxos(
    wallet: FuzzyWalletType,
    options?: GetUtxosAdapterOptions
  ): Promise<GetUtxosResult> {
    const hWallet = this.concrete(wallet);
    const tokenId = options?.token ?? NATIVE_TOKEN_UID;
    const utxos: AdapterUtxo[] = [];
    let totalAmount = 0n;
    let totalUtxos = 0n;

    // The fullnode facade exposes UTXO listing as an async generator. Drain it
    // into an array so the adapter contract matches the wallet-service shape.
    // `getAvailableUtxos` only yields available (unlocked) UTXOs by definition.
    const generator = hWallet.getAvailableUtxos({
      token: tokenId,
      filter_address: options?.address,
    });
    for await (const utxo of generator) {
      utxos.push({
        txId: utxo.txId,
        index: utxo.index,
        value: utxo.value,
        address: utxo.address,
        tokenId,
        locked: false,
      });
      totalAmount += utxo.value;
      totalUtxos += 1n;
    }

    return {
      total_amount_available: totalAmount,
      total_utxos_available: totalUtxos,
      utxos,
    };
  }

  async getUtxosForAmount(
    wallet: FuzzyWalletType,
    amount: bigint,
    options?: GetUtxosAdapterOptions
  ): Promise<GetUtxosForAmountResult> {
    const tokenId = options?.token ?? NATIVE_TOKEN_UID;
    const result = await this.concrete(wallet).getUtxosForAmount(amount, {
      token: tokenId,
      filter_address: options?.address,
    });
    return {
      changeAmount: result.changeAmount,
      utxos: result.utxos.map(utxo => ({
        txId: utxo.txId,
        index: utxo.index,
        value: utxo.value,
        address: utxo.address,
        tokenId,
        locked: utxo.locked,
      })),
    };
  }

  async sendManyOutputsTransaction(
    wallet: FuzzyWalletType,
    outputs: AdapterOutput[],
    options?: SendManyOutputsAdapterOptions
  ): Promise<SendTransactionResult> {
    const hWallet = this.concrete(wallet);
    const { recvWallet, ...txOptions } = options ?? {};
    // Cast — wallet-lib's signature is ProposedOutput[] (address only); the
    // runtime mapper handles data outputs too (see HathorWallet.sendManyOutputsSendTransaction).
    const result = await hWallet.sendManyOutputsTransaction(
      outputs as unknown as Parameters<typeof hWallet.sendManyOutputsTransaction>[0],
      {
        pinCode: DEFAULT_PIN_CODE,
        ...txOptions,
      }
    );
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
    const hWallet = this.concrete(wallet);
    const utxos = await hWallet.getAuthorityUtxo(tokenUid, type, {
      many: options?.many ?? true,
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
    const hWallet = this.concrete(wallet);
    const result = await hWallet.delegateAuthority(tokenUid, type, destinationAddress, {
      pinCode: DEFAULT_PIN_CODE,
      createAnother: options?.createAnother ?? false,
    });
    if (!result?.hash) {
      throw new Error('delegateAuthority: transaction had no hash');
    }
    await waitForTxReceived(hWallet, result.hash);
    await waitUntilNextTimestamp(hWallet, result.hash);
    return { hash: result.hash };
  }

  async getAllAddresses(wallet: FuzzyWalletType): Promise<AdapterAddress[]> {
    const hWallet = this.concrete(wallet);
    const result: AdapterAddress[] = [];
    for await (const entry of hWallet.getAllAddresses()) {
      result.push({
        address: entry.address,
        index: entry.index,
        addressPath: await hWallet.getAddressPathForIndex(entry.index),
      });
    }
    return result;
  }

  async getCurrentAddress(
    wallet: FuzzyWalletType,
    options?: { markAsUsed?: boolean }
  ): Promise<AdapterAddress> {
    const hWallet = this.concrete(wallet);
    const current = await hWallet.getCurrentAddress({ markAsUsed: options?.markAsUsed ?? false });
    if (current.index === null) {
      throw new Error('getCurrentAddress: address has no index');
    }
    return {
      address: current.address,
      index: current.index,
      addressPath: current.addressPath,
    };
  }

  async getNextAddress(wallet: FuzzyWalletType): Promise<AdapterAddress> {
    const hWallet = this.concrete(wallet);
    const next = await hWallet.getNextAddress();
    if (next.index === null) {
      throw new Error('getNextAddress: address has no index');
    }
    return {
      address: next.address,
      index: next.index,
      addressPath: next.addressPath,
    };
  }

  async getAddressIndex(wallet: FuzzyWalletType, address: string): Promise<number | undefined> {
    const index = await this.concrete(wallet).getAddressIndex(address);
    return index === null ? undefined : index;
  }

  async getAddressAtIndex(wallet: FuzzyWalletType, index: number): Promise<string> {
    return this.concrete(wallet).getAddressAtIndex(index);
  }

  // --- Private helpers ---

  /**
   * Resolves the wallet identity for simple cases (seed, addresses) from the caller's options.
   *
   * When no explicit identity is provided, a precalculated wallet is used.
   * For xpub/xpriv-only wallets, `words` will be `undefined` — that's intentional:
   * {@link buildConfig} spreads `xpub`/`xpriv` into the config independently of the seed.
   */
  private async resolveWordsAndAddresses(options?: CreateWalletOptions): Promise<{
    words?: string;
    addresses?: string[];
    shieldedAddresses?: IPrecalculatedShieldedAddress[];
  }> {
    if (!options?.seed && !options?.xpub && !options?.xpriv) {
      const precalc = await this.getPrecalculatedWallet();
      return {
        words: precalc.words,
        addresses: precalc.addresses,
        shieldedAddresses: precalc.shieldedAddresses,
      };
    }
    return {
      words: options?.seed,
      addresses: options?.preCalculatedAddresses,
      // Explicit seeds are usually the fixed in-repo ones — resolve their
      // committed shielded fixtures; unknown seeds resolve to undefined and
      // the wallet derives the pairs live.
      shieldedAddresses: getPrecalculatedShieldedForSeed(options?.seed),
    };
  }

  private buildConfig(
    walletData: {
      words?: string;
      addresses?: string[];
      shieldedAddresses?: IPrecalculatedShieldedAddress[];
    },
    options?: CreateWalletOptions
  ) {
    // xpub/xpriv and seed are mutually exclusive in HathorWallet's constructor.
    // When both are provided (e.g. shared readonly tests pass seed for service
    // pre-registration), prefer xpub/xpriv and omit the seed.
    const useSeed = !options?.xpub && !options?.xpriv;
    let scanPolicy: AddressScanPolicyData | null = null;
    if (options?.singleAddressMode === true) {
      scanPolicy = { policy: SCANNING_POLICY.SINGLE_ADDRESS };
    } else if (!options?.singleAddressMode) {
      scanPolicy = getGapLimitConfig();
    }
    return {
      ...(useSeed && walletData.words ? { seed: walletData.words } : {}),
      connection: generateConnection(),
      // Credentials are intentionally omitted here — they are passed at start()
      // time instead. This lets validation tests exercise missing-credential paths
      // by calling buildWalletInstance + startWallet without defaults.
      ...(options?.password !== undefined && { password: options.password }),
      ...(options?.pinCode !== undefined && { pinCode: options.pinCode }),
      preCalculatedAddresses: walletData.addresses,
      preCalculatedShieldedAddresses: walletData.shieldedAddresses,
      ...(options?.xpub && { xpub: options.xpub }),
      ...(options?.xpriv && { xpriv: options.xpriv }),
      ...(options?.passphrase && { passphrase: options.passphrase }),
      ...(options?.multisig && { multisig: options.multisig }),
      ...(options?.tokenUid && { tokenUid: options.tokenUid }),
      scanPolicy,
    };
  }
}
