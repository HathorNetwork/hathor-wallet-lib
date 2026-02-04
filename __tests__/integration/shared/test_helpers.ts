/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable max-classes-per-file */

import HathorWallet from '../../../src/new/wallet';
import HathorWalletServiceWallet from '../../../src/wallet/wallet';
import Connection from '../../../src/new/connection';
import {
  generateConnection,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  waitForTxReceived,
  waitForWalletReady,
} from '../helpers/wallet.helper';
import { GenesisWalletHelper, GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { buildWalletInstance } from '../helpers/service-facade.helper';
import { delay } from '../utils/core.util';
import { TxNotFoundError } from '../../../src/errors';
import { loggers } from '../utils/logger.util';
import {
  SupportedWallet,
  WalletFactory,
  WalletCreationOptions,
  WalletFactoryResult,
  WalletHelperAdapter,
  WalletStartOptions,
} from './types';
import Transaction from '../../../src/models/transaction';

/**
 * Unified wallet factory for HathorWallet (Fullnode facade)
 */
export class HathorWalletFactory implements WalletFactory<HathorWallet> {
  private startedWallets: HathorWallet[] = [];

  async create(options: WalletCreationOptions = {}): Promise<WalletFactoryResult<HathorWallet>> {
    const walletData: { words?: string; addresses?: string[] } = {};

    // Only fetch a precalculated wallet if no seed is provided
    if (!options.seed && !options.xpub) {
      const precalculated = precalculationHelpers.test!.getPrecalculatedWallet()!;
      walletData.words = precalculated.words;
      walletData.addresses = precalculated.addresses;
    } else {
      walletData.words = options.seed;
      walletData.addresses = options.preCalculatedAddresses;
    }

    // Configure the wallet
    const walletConfig: {
      seed?: string;
      xpub?: string;
      connection: Connection;
      password: string;
      pinCode: string;
      preCalculatedAddresses?: string[];
      multisig?: { pubkeys: string[]; numSignatures: number };
    } = {
      seed: walletData.words,
      xpub: options.xpub,
      connection: generateConnection(),
      password: options.password || DEFAULT_PASSWORD,
      pinCode: options.pinCode || DEFAULT_PIN_CODE,
      preCalculatedAddresses: walletData.addresses,
    };

    if (options.multisig) {
      walletConfig.multisig = options.multisig;
    }

    const wallet = new HathorWallet(walletConfig);

    return {
      wallet,
      words: walletData.words ?? undefined,
      preCalculatedAddresses: walletData.addresses ?? undefined,
      cleanup: async () => {
        await this.stopAll();
      },
    };
  }

  async start(options: WalletStartOptions) {
    await options.wallet.start();
    await waitForWalletReady(options.wallet);
    this.startedWallets.push(options.wallet as HathorWallet);
  }

  async stopAll(): Promise<void> {
    const { startedWallets } = this;
    let wallet = startedWallets.pop();
    while (wallet) {
      try {
        await wallet.stop({ cleanStorage: true, cleanAddresses: true });
      } catch (e) {
        loggers.test!.error((e as Error).stack);
      }
      wallet = startedWallets.pop();
    }
  }
}

/**
 * Unified wallet factory for HathorWalletServiceWallet
 */
export class WalletServiceWalletFactory implements WalletFactory<HathorWalletServiceWallet> {
  private startedWallets: HathorWalletServiceWallet[] = [];

  async create(
    options: WalletCreationOptions = {}
  ): Promise<WalletFactoryResult<HathorWalletServiceWallet>> {
    const { wallet, words, addresses } = buildWalletInstance({
      words: options.seed,
      passwordForRequests: options.password,
    });

    this.startedWallets.push(wallet);

    return {
      wallet,
      words,
      preCalculatedAddresses: addresses,
      cleanup: async () => {
        await this.stopAll();
      },
    };
  }

  async start(options: WalletStartOptions) {
    await options.wallet.start({
      pinCode: options.pinCode || DEFAULT_PIN_CODE,
      password: options.password || DEFAULT_PASSWORD,
    });

    this.startedWallets.push(options.wallet as HathorWalletServiceWallet);
  }

  async stopAll(): Promise<void> {
    let wallet = this.startedWallets.pop();
    while (wallet) {
      try {
        await wallet.stop({ cleanStorage: true });
      } catch (e) {
        loggers.test!.error((e as Error).stack);
      }
      wallet = this.startedWallets.pop();
    }
  }
}

/**
 * Helper adapter for HathorWallet (Fullnode facade)
 */
export class HathorWalletHelperAdapter implements WalletHelperAdapter<HathorWallet> {
  // eslint-disable-next-line class-methods-use-this
  async injectFunds(wallet: HathorWallet, address: string, amount: bigint) {
    return GenesisWalletHelper.injectFunds(wallet, address, amount);
  }

  // eslint-disable-next-line class-methods-use-this
  async waitForTx(wallet: HathorWallet, txId: string, timeout?: number): Promise<void> {
    await waitForTxReceived(wallet, txId, timeout);
  }

  // eslint-disable-next-line class-methods-use-this
  async getAddressAtIndex(wallet: HathorWallet, index: number): Promise<string> {
    return wallet.getAddressAtIndex(index);
  }

  // eslint-disable-next-line class-methods-use-this
  async isAddressMine(wallet: HathorWallet, address: string): Promise<boolean> {
    return wallet.isAddressMine(address);
  }

  // eslint-disable-next-line class-methods-use-this
  async getAllAddresses(wallet: HathorWallet): Promise<string[]> {
    const addresses: string[] = [];
    for await (const addressObj of wallet.getAllAddresses()) {
      addresses.push(addressObj.address);
    }
    return addresses;
  }
}

/**
 * Helper adapter for HathorWalletServiceWallet
 */
export class WalletServiceHelperAdapter implements WalletHelperAdapter<HathorWalletServiceWallet> {
  // eslint-disable-next-line class-methods-use-this
  async injectFunds(wallet: HathorWalletServiceWallet, address: string, amount: bigint) {
    // We need to get the genesis wallet in WalletService format
    // For now, we'll use a polling approach similar to the existing tests
    return GenesisWalletServiceHelper.injectFunds(address, amount, wallet);
  }

  // eslint-disable-next-line class-methods-use-this
  async waitForTx(
    wallet: HathorWalletServiceWallet,
    txId: string,
    timeout: number = 30000
  ): Promise<void> {
    const maxAttempts = Math.floor(timeout / 1000);
    const delayMs = 1000;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const tx = await wallet.getTxById(txId);
        if (tx) {
          loggers.test!.log(`Polling for ${txId} took ${attempts + 1} attempts`);
          return;
        }
      } catch (error) {
        if (!(error instanceof TxNotFoundError)) {
          throw error;
        }
      }
      attempts += 1;
      await delay(delayMs);
    }
    throw new Error(`Transaction ${txId} not found after ${maxAttempts} attempts`);
  }

  // eslint-disable-next-line class-methods-use-this
  async getCurrentAddress(wallet: HathorWalletServiceWallet): Promise<string> {
    // WalletServiceWallet.getCurrentAddress() is sync and returns AddressInfoObject
    const addressInfo = wallet.getCurrentAddress();
    return addressInfo.address;
  }

  // eslint-disable-next-line class-methods-use-this
  async getAddressAtIndex(wallet: HathorWalletServiceWallet, index: number): Promise<string> {
    // WalletServiceWallet.getAddressAtIndex() is sync
    return wallet.getAddressAtIndex(index);
  }

  // eslint-disable-next-line class-methods-use-this
  async isAddressMine(wallet: HathorWalletServiceWallet, address: string): Promise<boolean> {
    // WalletServiceWallet.isAddressMine() is sync
    return wallet.isAddressMine(address);
  }

  // eslint-disable-next-line class-methods-use-this
  async getAllAddresses(wallet: HathorWalletServiceWallet): Promise<string[]> {
    const addresses: string[] = [];
    // WalletServiceWallet.getAllAddresses() is an async generator
    for await (const addressObj of wallet.getAllAddresses()) {
      addresses.push(addressObj.address);
    }
    return addresses;
  }
}

/**
 * Unified helper that works with both wallet facades
 * Automatically detects the wallet type and delegates to the appropriate adapter
 */
export class UnifiedWalletHelper implements WalletHelperAdapter<SupportedWallet> {
  private hathorWalletHelper = new HathorWalletHelperAdapter();

  private walletServiceHelper = new WalletServiceHelperAdapter();

  // eslint-disable-next-line class-methods-use-this
  private isHathorWallet(wallet: SupportedWallet): wallet is HathorWallet {
    return wallet instanceof HathorWallet;
  }

  async injectFunds(
    wallet: SupportedWallet,
    address: string,
    amount: bigint
  ): Promise<Transaction> {
    if (this.isHathorWallet(wallet)) {
      return this.hathorWalletHelper.injectFunds(wallet, address, amount);
    }
    return this.walletServiceHelper.injectFunds(wallet, address, amount);
  }

  async waitForTx(wallet: SupportedWallet, txId: string, timeout?: number): Promise<void> {
    if (this.isHathorWallet(wallet)) {
      return this.hathorWalletHelper.waitForTx(wallet, txId, timeout);
    }
    return this.walletServiceHelper.waitForTx(wallet, txId, timeout);
  }

  // async getCurrentAddress(wallet: SupportedWallet): Promise<string> {
  //   if (this.isHathorWallet(wallet)) {
  //     return this.hathorWalletHelper.getCurrentAddress(wallet);
  //   }
  //   return this.walletServiceHelper.getCurrentAddress(wallet);
  // }

  async getAddressAtIndex(wallet: SupportedWallet, index: number): Promise<string> {
    if (this.isHathorWallet(wallet)) {
      return this.hathorWalletHelper.getAddressAtIndex(wallet, index);
    }
    return this.walletServiceHelper.getAddressAtIndex(wallet, index);
  }

  async isAddressMine(wallet: SupportedWallet, address: string): Promise<boolean> {
    if (this.isHathorWallet(wallet)) {
      return this.hathorWalletHelper.isAddressMine(wallet, address);
    }
    return this.walletServiceHelper.isAddressMine(wallet, address);
  }

  async getAllAddresses(wallet: SupportedWallet): Promise<string[]> {
    if (this.isHathorWallet(wallet)) {
      return this.hathorWalletHelper.getAllAddresses(wallet);
    }
    return this.walletServiceHelper.getAllAddresses(wallet);
  }
}
