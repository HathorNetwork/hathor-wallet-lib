/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Input from '../models/input';
import Transaction from '../models/transaction';
import {
  ApiVersion,
  IStorage,
  IStorageAddress,
  IStorageAddressMetadata,
  IStorageToken,
  IStorageTokenMetadata,
  IStorageTx,
  IStorageUTXO,
  IStorageAccessData,
  IStore,
  IUtxoFilterOptions,
  IStorageWalletData,
  WalletType,
  WALLET_FLAGS,
  UtxoId,
} from '../types';
import transaction from '../utils/transaction';
import config, { Config } from '../config';
import { decryptData, validateHash } from '../utils/crypto';


export class Storage implements IStorage {
  store: IStore;
  utxosSelectedAsInput: Map<string, boolean>;
  config: Config;
  version: ApiVersion|null;

  constructor(store: IStore) {
    this.store = store;
    this.utxosSelectedAsInput = new Map<string, boolean>();
    this.config = config;
    this.version = null;
  }

  setApiVersion(version: ApiVersion): void {
    this.version = version;
  }

  /**
   * Fetch all addresses from storage
   *
   * @async
   * @generator
   * @yields {Promise<IStorageAddress & Partial<IStorageAddressMetadata>>} The addresses in store.
   */
  async *getAllAddresses(): AsyncGenerator<IStorageAddress & Partial<IStorageAddressMetadata>> {
    for await (const address of this.store.addressIter()) {
      const meta = await this.store.getAddressMeta(address.base58);
      yield {...address, ...meta};
    }
  }

  /**
   * Get the address info from store
   *
   * @param {string} base58 The base58 address to fetch
   * @async
   * @returns {Promise<(IStorageAddress & Partial<IStorageAddressMetadata>)|null>} The address info or null if not found
   */
  async getAddressInfo(base58: string): Promise<(IStorageAddress & Partial<IStorageAddressMetadata>)|null> {
    const address = await this.store.getAddress(base58);
    if (address === null) {
      return null;
    }
    const meta = await this.store.getAddressMeta(base58);
    return {...address, ...meta};
  }

  /**
   * Get the address at the given index
   *
   * @param {number} index
   * @async
   * @returns {Promise<IStorageAddress|null>} The address info or null if not found
   */
  async getAddressAtIndex(index: number): Promise<IStorageAddress|null> {
    return this.store.getAddressAtIndex(index);
  }

  async isAddressMine(base58: string): Promise<boolean> {
    return this.store.addressExists(base58);
  }

  async saveAddress(info: IStorageAddress): Promise<void> {
    await this.store.saveAddress(info);
  }

  async getCurrentAddress(markAsUsed?: boolean): Promise<string> {
    return this.store.getCurrentAddress(markAsUsed);
  }

  async *txHistory(): AsyncGenerator<IStorageTx> {
    for await (const tx of this.store.historyIter()) {
      yield tx;
    }
  }

  async *tokenHistory(tokenUid?: string): AsyncGenerator<IStorageTx> {
    for await (const tx of this.store.historyIter(tokenUid || '00')) {
      yield tx;
    }
  }

  async getTx(txId: string): Promise<IStorageTx|null> {
    return this.store.getTx(txId);
  }

  async *getSpentTxs(inputs: Input[]): AsyncGenerator<{tx: IStorageTx, input: Input, index: number}> {
    for await (const [index, input] of inputs.entries()) {
      const tx = await this.getTx(input.hash);
      // Ignore unknown transactions
      if (tx === null) continue;
      yield {tx, input, index};
    }
  }

  async addTx(tx: IStorageTx): Promise<void> {
    await this.store.saveTx(tx);
  }

  async processHistory(): Promise<void> {
    await this.store.processHistory({
      rewardLock: this.version?.reward_spend_min_blocks,
    });
  }

  async addToken(data: IStorageToken): Promise<void> {
    await this.store.saveToken(data);
  }

  async editToken(tokenUid: string, meta: IStorageTokenMetadata): Promise<void> {
    this.store.editToken(tokenUid, meta);
  }

  async *getAllTokens(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>> {
    for await (const token of this.store.tokenIter()) {
      yield token;
    }
  }

  async *getRegisteredTokens(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>> {
    for await (const token of this.store.registeredTokenIter()) {
      yield token;
    }
  }

  async getToken(token?: string): Promise<(IStorageToken & Partial<IStorageTokenMetadata>)|null> {
    return this.store.getToken(token || '00');
  }

  async registerToken(token: IStorageToken): Promise<void> {
    await this.store.registerToken(token);
  }

  async unregisterToken(tokenUid: string): Promise<void> {
    await this.store.unregisterToken(tokenUid);
  }

  async *getAllUtxos(): AsyncGenerator<IStorageUTXO, any, unknown> {
    for await (const utxo of this.store.utxoIter()) {
      yield utxo;
    }
  }

  async *selectUtxos(options: IUtxoFilterOptions = {}): AsyncGenerator<IStorageUTXO, any, unknown> {
    const newFilter = (utxo: IStorageUTXO): boolean => {
      const utxoId = `${utxo.txId}:${utxo.index}`;
      return (!this.utxosSelectedAsInput.has(utxoId)) && (options.filter_method ? options.filter_method(utxo) : true);
    }
    const newOptions = {...options, filter_method: newFilter};
    for await (const utxo of this.store.selectUtxos(newOptions)) {
      yield utxo;
    }
  }

  async fillTx(tx: Transaction): Promise<void> {
    function getDefaultAuthorityBalance(): Record<'mint'|'melt', number> {
      return {'mint': 0, 'melt': 0};
    }
    const tokenAmountOutputs = new Map<string, number>();
    const tokenAuthorityOutputs = new Map<string, Record<'mint'|'melt', number>>();

    for (const output of tx.outputs) {
      const token = tx.tokens[output.getTokenIndex()];
      if (output.isAuthority()) {
        // Authority output, add to mint or melt balance
        const balance = tokenAuthorityOutputs.get(token) || getDefaultAuthorityBalance();
        if (output.isMint()) {
          balance.mint += 1;
        }
        if (output.isMelt()) {
          balance.melt += 1;
        }
        tokenAuthorityOutputs.set(token, balance);
      } else {
        // Fund output, add to the amount balance
        tokenAmountOutputs.set(token, (tokenAmountOutputs.get(token) || 0) + output.value);
      }
    }

    const tokenAmountInputs = new Map<string, number>();
    const tokenAuthorityInputs = new Map<string, Record<'mint'|'melt', number>>();

    // Check the inputs
    for await (const spentResult of this.getSpentTxs(tx.inputs)) {
      const {tx: spentTx, input} = spentResult;
      // const token = spentTx.outputs[input.index].token;
      const utxoSpent = spentTx.outputs[input.index];
      if (transaction.isAuthorityOutput(utxoSpent)) {
        if (!tokenAuthorityOutputs.has(utxoSpent.token)) {
          // XXX: throw error?
        }
        // Authority input, add to mint or melt balance
        const balance = tokenAuthorityInputs.get(utxoSpent.token) || getDefaultAuthorityBalance();
        if (transaction.isMint(utxoSpent)) {
          balance.mint += 1;
        }
        if (transaction.isMelt(utxoSpent)) {
          balance.melt += 1;
        }
        tokenAuthorityInputs.set(utxoSpent.token, balance);
      } else {
        if (!tokenAuthorityOutputs.has(utxoSpent.token)) {
          // XXX: throw error?
        }
        // Fund input, add to the amount balance
        tokenAmountInputs.set(utxoSpent.token, (tokenAmountInputs.get(utxoSpent.token) || 0) + utxoSpent.value);
      }
    }

    for (const [token, outputBalance] of tokenAmountOutputs) {
      const inputBalance = tokenAmountInputs.get(token) || 0;
      if (outputBalance === inputBalance) continue;

      if (outputBalance > inputBalance) {
        const targetAmount = outputBalance - inputBalance;
        let foundAmount = 0;
        for await (const utxo of this.selectUtxos({
          token,
          authorities: 0,
          target_amount: targetAmount,
        })) {
          foundAmount += utxo.value;
          tx.inputs.push(new Input(utxo.txId, utxo.index));
          this.utxoSelectAsInput(utxo, true, 1000);
        }
        if (foundAmount > targetAmount) {
          // XXX: change output
          // tx.outputs.push(new Output(foundAmount - targetAmount, token));
        }
      } else {
        // XXX: add change output
      }
    }

    for (const [token, outputBalance] of tokenAuthorityOutputs) {
      const inputBalance = tokenAuthorityInputs.get(token) || getDefaultAuthorityBalance();
      if (outputBalance.mint !== inputBalance.mint) {
        if (outputBalance.mint > inputBalance.mint) {
          // select inputs to match
        } else {
          // add change output
        }
      }
      if (outputBalance.melt !== inputBalance.melt) {
        if (outputBalance.melt > inputBalance.melt) {
          // select inputs to match
        } else {
          // add change output
        }
      }
    }
  }

  async utxoSelectAsInput(utxo: UtxoId, markAs: boolean, ttl?: number): Promise<void> {
    const tx = await this.getTx(utxo.txId);
    if ((!tx) || (!tx.outputs[utxo.index])) {
      return;
    }

    if (markAs && (tx.outputs[utxo.index].spent_by !== null)) {
      // Already spent, no need to mark as selected_as_input
      return;
    }

    const utxoId = `${utxo.txId}:${utxo.index}`;
    if (markAs) {
      this.utxosSelectedAsInput.set(utxoId, markAs);
      // if a ttl is given, we should reverse
      if (ttl) {
        setTimeout(() => {
          if (!markAs) {
            this.utxosSelectedAsInput.delete(utxoId);
          }
        }, ttl);
      }
    } else {
      this.utxosSelectedAsInput.delete(utxoId);
    }
  }

  async getAccessData(): Promise<IStorageAccessData|null> {
    return this.store.getAccessData();
  }

  async saveAccessData(data: IStorageAccessData): Promise<void> {
    return this.store.saveAccessData(data);
  }

  async getWalletData(): Promise<IStorageWalletData> {
    return this.store.getWalletData();
  }

  async getWalletType(): Promise<WalletType> {
    const accessData = await this.getAccessData();
    if (accessData === null) {
      throw new Error('Wallet type not set.');
    }
    return accessData.walletType;
  }

  /**
   * Set the current height
   * @param {number} height The current height
   * @returns {Promise<void>} The current height of the network
   */
  async setCurrentHeight(height: number): Promise<void> {
    return this.store.setCurrentHeight(height);
  }

  /**
   * Get the current height
   * @returns {Promise<number>} The current height
   */
  async getCurrentHeight(): Promise<number> {
    return this.store.getCurrentHeight();
  }

  async isReadonly(): Promise<boolean> {
    const accessData = await this.getAccessData();
    if (accessData === null) {
      throw new Error('Wallet is not initialized.');
    }
    return (accessData.walletFlags & WALLET_FLAGS.READONLY) > 0;
  }

  async getMainXPrivKey(pinCode: string): Promise<string> {
    const accessData = await this.getAccessData();
    if (accessData === null) {
      throw new Error('Wallet is not initialized.');
    }
    if (accessData.mainKey === undefined) {
      throw new Error('Private key is not present on this wallet.');
    }
    const keyData = accessData.mainKey.data;
    const hash = accessData.mainKey.hash;
    const options = {
      salt: accessData.mainKey.salt,
      iterations: accessData.mainKey.iterations,
      pbkdf2Hasher: accessData.mainKey.pbkdf2Hasher,
    };

    if(validateHash(pinCode, hash, options)) {
      return decryptData(keyData, pinCode);
    } else {
      throw new Error('Invalid PIN code.');
    }
  }

  async cleanStorage(cleanHistory: boolean = false): Promise<void> {
    return this.store.cleanStorage(cleanHistory);
  }
}