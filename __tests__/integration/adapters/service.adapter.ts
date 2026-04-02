/* eslint-disable class-methods-use-this */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HathorWalletServiceWallet } from '../../../src';
import config from '../../../src/config';
import { WalletTracker } from '../utils/wallet-tracker.util';
import type Transaction from '../../../src/models/transaction';
import {
  buildWalletInstance,
  initializeServiceGlobalConfigs,
  pollForTx,
} from '../helpers/service-facade.helper';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
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

const SERVICE_PIN = '123456';
const SERVICE_PASSWORD = 'testpass';

/** Stop options shared between {@link stopWallet} and the {@link WalletTracker}. */
const STOP_OPTIONS: WalletStopOptions = { cleanStorage: true };

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

  async createWallet(options?: CreateWalletOptions): Promise<CreateWalletResult> {
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

  buildWalletInstance(options?: CreateWalletOptions): CreateWalletResult {
    // xpub and seed are mutually exclusive in the constructor — prefer xpub when present.
    const result = buildWalletInstance({
      words: options?.xpub ? '' : options?.seed || '',
      xpub: options?.xpub || '',
      enableWs: false,
    });

    this.tracker.track(result.wallet);
    if (options?.xpub) {
      this.xpubWallets.add(result.wallet);
    }

    return {
      wallet: result.wallet as FuzzyWalletType,
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
    await sw.start({
      pinCode: options?.pinCode,
      password: options?.password,
    });
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

  async waitForTx(wallet: FuzzyWalletType, txId: string): Promise<void> {
    await pollForTx(this.concrete(wallet), txId);
  }

  getPrecalculatedWallet(): PrecalculatedWalletData {
    return precalculationHelpers.test!.getPrecalculatedWallet();
  }
}
