/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage, IHistoryTx, IAddressInfo, IAddressMetadata } from '../types';
import Transaction from '../models/transaction';
import HathorWalletServiceWallet from './wallet';
import { FullNodeTxResponse } from './types';
import transactionUtils from '../utils/transaction';

/**
 * Storage proxy that implements missing storage methods for wallet service
 * by delegating to wallet service API calls.
 *
 * This proxy enables nano contract transaction signing by providing:
 * - getAddressInfo: Maps addresses to BIP32 indices
 * - getTx: Fetches transaction data from full node API
 * - getTxSignatures: Delegates to transaction signing utilities
 */
export class WalletServiceStorageProxy {
  private wallet: HathorWalletServiceWallet;

  private originalStorage: IStorage;

  constructor(wallet: HathorWalletServiceWallet, originalStorage: IStorage) {
    this.wallet = wallet;
    this.originalStorage = originalStorage;
  }

  /**
   * Creates a proxy that wraps the original storage with additional methods
   * needed for nano contract transaction signing.
   */
  createProxy(): IStorage {
    return new Proxy(this.originalStorage, {
      get: this.proxyHandler.bind(this),
    });
  }

  /**
   * Proxy handler that intercepts property access on the storage object.
   *
   * @param target - The original IStorage object being proxied
   * @param prop - The property name being accessed (can be string or Symbol for JS property keys)
   * @param receiver - The proxy itself (not the target), used to maintain correct 'this' context
   * @returns The intercepted method or the original property value
   */
  private proxyHandler(target: IStorage, prop: string | symbol, receiver: IStorage): unknown {
    if (prop === 'getAddressInfo') {
      return this.getAddressInfo.bind(this);
    }

    if (prop === 'getTxSignatures') {
      return this.getTxSignatures.bind(this, receiver);
    }

    if (prop === 'getTx') {
      return this.getTx.bind(this);
    }

    if (prop === 'getSpentTxs') {
      return this.getSpentTxs.bind(this);
    }

    if (prop === 'getCurrentAddress') {
      return this.getCurrentAddress.bind(this);
    }

    // For all other properties, use the original behavior
    const value = Reflect.get(target, prop, receiver);

    // Bind methods to maintain correct 'this' context
    if (typeof value === 'function') {
      return value.bind(target);
    }

    return value;
  }

  /**
   * Get address information including BIP32 index
   */
  private async getAddressInfo(
    address: string
  ): Promise<(IAddressInfo & IAddressMetadata & { seqnum: number }) | null> {
    const addressDetails = await this.wallet.getAddressDetails(address);

    if (!addressDetails) {
      return null;
    }

    return {
      bip32AddressIndex: addressDetails.index,
      base58: addressDetails.address,
      seqnum: addressDetails.seqnum,
      numTransactions: addressDetails.transactions,
      // TODO: This balance is not used by any of the nano contract methods
      // but in order to be 100% compatible with the old facade method, we need
      // to implement an API to fetch the balance for all tokens given an address
      balance: new Map(),
    };
  }

  /**
   * Get transaction signatures using the transaction utility
   */
  // eslint-disable-next-line class-methods-use-this
  private async getTxSignatures(receiver: IStorage, tx: Transaction, pinCode: string) {
    const result = await transactionUtils.getSignatureForTx(tx, receiver, pinCode);
    return result;
  }

  /**
   * Get spent transactions for input signing
   * This is an async generator that yields transaction data for each input
   */
  private async *getSpentTxs(inputs: any[]) {
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];
      const tx = await this.getTx(input.hash);
      if (tx) {
        yield { tx, input, index };
      }
    }
  }

  /**
   * Get transaction data by fetching from full node and converting format
   */
  private async getTx(txId: string) {
    try {
      const fullTxResponse = await this.wallet.getFullTxById(txId);
      const result = this.convertFullNodeToHistoryTx(fullTxResponse);
      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get current address from wallet service
   * Uses the wallet's getCurrentAddress method which fetches from the API
   */
  private async getCurrentAddress(markAsUsed?: boolean): Promise<string> {
    try {
      const currentAddress = this.wallet.getCurrentAddress({ markAsUsed });
      return currentAddress.address; // Return just the address string for utils compatibility
    } catch (error) {
      throw new Error('Current address is not loaded');
    }
  }

  /**
   * Convert FullNodeTxResponse to IHistoryTx format
   * This bridges the gap between full node API format and wallet storage format
   */
  // eslint-disable-next-line class-methods-use-this
  private convertFullNodeToHistoryTx(fullTxResponse: FullNodeTxResponse): IHistoryTx {
    const { tx, meta } = fullTxResponse;

    return {
      tx_id: tx.hash,
      signalBits: 0, // Default value since fullnode tx doesn't include signal bits
      version: tx.version,
      weight: tx.weight,
      timestamp: tx.timestamp,
      is_voided: meta.voided_by.length > 0,
      nonce: Number.parseInt(tx.nonce ?? '0', 10),
      inputs: tx.inputs.map(input => ({
        ...input,
        decoded: {
          ...input.decoded,
          type: input.decoded.type ?? undefined,
        },
      })) as IHistoryTx['inputs'],
      outputs: tx.outputs.map(output => ({
        ...output,
        decoded: {
          ...output.decoded,
          type: output.decoded.type ?? undefined,
        },
      })) as IHistoryTx['outputs'],
      parents: tx.parents,
      tokens: tx.tokens.map(token => token.uid),
      height: meta.height,
      first_block: meta.first_block,
      token_name: tx.token_name ?? undefined,
      token_symbol: tx.token_symbol ?? undefined,
    };
  }
}
