/* eslint-disable class-methods-use-this */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../../src/new/wallet';
import { WalletTracker } from '../utils/wallet-tracker.util';
import { WalletState } from '../../../src/types';
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
import type { WalletStopOptions } from '../../../src/new/types';
import { NETWORK_NAME } from '../configuration/test-constants';
import type {
  FuzzyWalletType,
  IWalletTestAdapter,
  WalletCapabilities,
  CreateWalletOptions,
  CreateWalletResult,
} from './types';
import type { PrecalculatedWalletData } from '../helpers/wallet-precalculation.helper';

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
   * This intentionally duplicates parts of {@link buildWalletInstance} because they serve
   * different purposes: `buildWalletInstance` returns an unstarted wallet so tests can
   * exercise error handling (e.g. missing pinCode/password), while `createWallet` fills
   * in valid defaults and starts the wallet — optimizing for tests that need a working
   * wallet with no setup friction.
   */
  async createWallet(options?: CreateWalletOptions): Promise<CreateWalletResult> {
    const walletData = this.resolveWalletData(options);
    const walletConfig = this.buildConfig(walletData, options, { fillDefaults: true });

    const hWallet = new HathorWallet(walletConfig);
    this.tracker.track(hWallet);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    return {
      wallet: hWallet as FuzzyWalletType,
      storage: hWallet.storage,
      words: walletData.words,
      addresses: walletData.addresses,
    };
  }

  buildWalletInstance(options?: CreateWalletOptions): CreateWalletResult {
    const walletData = this.resolveWalletData(options);
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

  async injectFundsBeforeStart(address: string, amount: bigint): Promise<string> {
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    const result = await gWallet.sendTransaction(address, amount);
    if (!result || !result.hash) {
      throw new Error('injectFundsBeforeStart: transaction had no hash');
    }
    return result.hash;
  }

  async waitForTx(wallet: FuzzyWalletType, txId: string): Promise<void> {
    const hWallet = this.concrete(wallet);
    await waitForTxReceived(hWallet, txId);
    await waitUntilNextTimestamp(hWallet, txId);
  }

  getPrecalculatedWallet(): PrecalculatedWalletData {
    return precalculationHelpers.test!.getPrecalculatedWallet();
  }

  // --- Private helpers ---

  private resolveWalletData(options?: CreateWalletOptions): {
    words?: string;
    addresses?: string[];
  } {
    if (!options?.seed && !options?.xpub && !options?.xpriv) {
      const precalc = this.getPrecalculatedWallet();
      return { words: precalc.words, addresses: precalc.addresses };
    }
    return {
      words: options?.seed,
      addresses: options?.preCalculatedAddresses,
    };
  }

  private buildConfig(
    walletData: { words?: string; addresses?: string[] },
    options?: CreateWalletOptions,
    { fillDefaults = false }: { fillDefaults?: boolean } = {}
  ) {
    return {
      seed: walletData.words,
      connection: generateConnection(),
      // Only fill default credentials when explicitly requested (e.g. createWallet).
      // buildWalletInstance leaves them out so validation tests can exercise the
      // "missing pinCode / password" code paths.
      ...(fillDefaults
        ? { password: DEFAULT_PASSWORD, pinCode: DEFAULT_PIN_CODE }
        : {
            ...(options?.password !== undefined && { password: options.password }),
            ...(options?.pinCode !== undefined && { pinCode: options.pinCode }),
          }),
      preCalculatedAddresses: walletData.addresses,
      ...(options?.xpub && { xpub: options.xpub }),
      ...(options?.xpriv && { xpriv: options.xpriv }),
      ...(options?.passphrase && { passphrase: options.passphrase }),
      ...(options?.multisig && { multisig: options.multisig }),
      ...(options?.tokenUid && { tokenUid: options.tokenUid }),
    };
  }
}
