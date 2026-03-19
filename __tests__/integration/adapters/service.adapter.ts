/* eslint-disable class-methods-use-this */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HathorWalletServiceWallet } from '../../../src';
import { WalletTracker } from '../utils/wallet-tracker.util';
import type Transaction from '../../../src/models/transaction';
import {
  buildWalletInstance,
  initializeServiceGlobalConfigs,
  pollForTx,
} from '../helpers/service-facade.helper';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
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

/**
 * Adapter for the wallet-service facade ({@link HathorWalletServiceWallet}).
 *
 * Key behavioral differences from the fullnode adapter:
 * - `start()` blocks until the wallet is ready (no explicit `waitForReady()` needed).
 * - Does not support multisig, xpub-readonly, token scoping, or external signing.
 * - Uses the wallet-service helpers ({@link GenesisWalletServiceHelper}) for fund injection.
 */
export class ServiceWalletTestAdapter implements IWalletTestAdapter {
  name = 'Wallet Service';

  networkName = NETWORK_NAME;

  defaultPinCode = SERVICE_PIN;

  defaultPassword = SERVICE_PASSWORD;

  capabilities: WalletCapabilities = {
    supportsMultisig: false,
    supportsTokenScope: false,
    supportsXpubReadonly: false,
    supportsExternalSigning: false,
    supportsRuntimeAddressCalculation: false,
    supportsPreStartFunding: true,
    requiresExplicitWaitReady: false,
    stateEventValues: {
      loading: 'Loading',
      ready: 'Ready',
    },
  };

  private readonly tracker = new WalletTracker<HathorWalletServiceWallet>({
    cleanStorage: true,
  });

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

  async suiteSetup(): Promise<void> {
    initializeServiceGlobalConfigs();
    await GenesisWalletServiceHelper.start();
  }

  async suiteTeardown(): Promise<void> {
    await this.stopAllWallets();
    await GenesisWalletServiceHelper.stop();
  }

  async createWallet(options?: CreateWalletOptions): Promise<CreateWalletResult> {
    const built = this.buildWalletInstance(options);

    await this.concrete(built.wallet).start({
      pinCode: options?.pinCode ?? SERVICE_PIN,
      password: options?.password ?? SERVICE_PASSWORD,
    });

    return built;
  }

  buildWalletInstance(options?: CreateWalletOptions): CreateWalletResult {
    const result = buildWalletInstance({
      words: options?.seed || '',
      enableWs: false,
    });

    this.tracker.track(result.wallet);

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
    // Pass options through directly — do NOT fill defaults when the caller
    // explicitly passes undefined (used by validation tests).
    await this.concrete(wallet).start({
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
    await sw.stop({ cleanStorage: true });
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
