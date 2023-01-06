/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Input from '../models/input';
import {
  ApiVersion,
  IStorage,
  IAddressInfo,
  IAddressMetadata,
  ITokenData,
  ITokenMetadata,
  IHistoryTx,
  IUtxo,
  IWalletAccessData,
  IStore,
  IUtxoFilterOptions,
  IWalletData,
  WalletType,
  WALLET_FLAGS,
  IUtxoId,
  IDataTx,
  IDataInput,
  IDataOutput,
} from '../types';
import transaction from '../utils/transaction';
import config, { Config } from '../config';
import { decryptData } from '../utils/crypto';


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
   * @yields {Promise<IAddressInfo & Partial<IAddressMetadata>>} The addresses in store.
   */
  async *getAllAddresses(): AsyncGenerator<IAddressInfo & Partial<IAddressMetadata>> {
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
   * @returns {Promise<(IAddressInfo & Partial<IAddressMetadata>)|null>} The address info or null if not found
   */
  async getAddressInfo(base58: string): Promise<(IAddressInfo & Partial<IAddressMetadata>)|null> {
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
   * @returns {Promise<IAddressInfo|null>} The address info or null if not found
   */
  async getAddressAtIndex(index: number): Promise<IAddressInfo|null> {
    return this.store.getAddressAtIndex(index);
  }

  async isAddressMine(base58: string): Promise<boolean> {
    return this.store.addressExists(base58);
  }

  async saveAddress(info: IAddressInfo): Promise<void> {
    await this.store.saveAddress(info);
  }

  async getCurrentAddress(markAsUsed?: boolean): Promise<string> {
    return this.store.getCurrentAddress(markAsUsed);
  }

  async *txHistory(): AsyncGenerator<IHistoryTx> {
    for await (const tx of this.store.historyIter()) {
      yield tx;
    }
  }

  async *tokenHistory(tokenUid?: string): AsyncGenerator<IHistoryTx> {
    for await (const tx of this.store.historyIter(tokenUid || '00')) {
      yield tx;
    }
  }

  async getTx(txId: string): Promise<IHistoryTx|null> {
    return this.store.getTx(txId);
  }

  async *getSpentTxs(inputs: Input[]): AsyncGenerator<{tx: IHistoryTx, input: Input, index: number}> {
    for await (const [index, input] of inputs.entries()) {
      const tx = await this.getTx(input.hash);
      // Ignore unknown transactions
      if (tx === null) continue;
      yield {tx, input, index};
    }
  }

  async addTx(tx: IHistoryTx): Promise<void> {
    await this.store.saveTx(tx);
  }

  async processHistory(): Promise<void> {
    await this.store.processHistory({
      rewardLock: this.version?.reward_spend_min_blocks,
    });
  }

  async addToken(data: ITokenData): Promise<void> {
    await this.store.saveToken(data);
  }

  async editToken(tokenUid: string, meta: ITokenMetadata): Promise<void> {
    this.store.editToken(tokenUid, meta);
  }

  async *getAllTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for await (const token of this.store.tokenIter()) {
      yield token;
    }
  }

  async *getRegisteredTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for await (const token of this.store.registeredTokenIter()) {
      yield token;
    }
  }

  async getToken(token?: string): Promise<(ITokenData & Partial<ITokenMetadata>)|null> {
    return this.store.getToken(token || '00');
  }

  async registerToken(token: ITokenData): Promise<void> {
    await this.store.registerToken(token);
  }

  async unregisterToken(tokenUid: string): Promise<void> {
    await this.store.unregisterToken(tokenUid);
  }

  async *getAllUtxos(): AsyncGenerator<IUtxo, any, unknown> {
    for await (const utxo of this.store.utxoIter()) {
      yield utxo;
    }
  }

  /**
   * Select utxos matching the request and do not select any utxos marked for inputs.
   *
   * @param options Options to filter utxos and stop when the target is found.
   *
   * @async
   * @generator
   * @yields {IUtxo}
   */
  async *selectUtxos(options: IUtxoFilterOptions = {}): AsyncGenerator<IUtxo, any, unknown> {
    const newFilter = (utxo: IUtxo): boolean => {
      const utxoId = `${utxo.txId}:${utxo.index}`;
      return (!this.utxosSelectedAsInput.has(utxoId)) && (options.filter_method ? options.filter_method(utxo) : true);
    }
    const newOptions = {...options, filter_method: newFilter};
    for await (const utxo of this.store.selectUtxos(newOptions)) {
      yield utxo;
    }
  }

  /**
   * Check the balance of the transaction and add inputs and outputs to match the funds and authorities.
   * It will fail if we do not have enough funds or authorities and it will fail if we try to add too many inputs or outputs.
   *
   * @param tx The incomplete transaction we need to fill
   * @param {{changeAddress?: string}} [options={}] options to use a change address.
   *
   * @async
   * @returns {Promise<void>}
   */
  async fillTx(tx: IDataTx, { changeAddress }: { changeAddress?: string } = {}): Promise<void> {
    function getEmptyBalance(): Record<'funds'|'mint'|'melt', number> {
      return {'funds': 0, 'mint': 0, 'melt': 0};
    }
    const tokensBalance = new Map<string, Record<'funds'|'mint'|'melt', number>>();
    const addressForChange = changeAddress || (await this.getCurrentAddress());

    // Calculate balance for outputs
    for (const output of tx.outputs) {
      if (!tokensBalance.has(output.token)) {
        tokensBalance.set(output.token, getEmptyBalance());
      }

      if (output.authorities > 0) {
        // Authority output, add to mint or melt balance
        // Check for MINT authority
        if ((output.authorities & 1) > 0) {
          tokensBalance.get(output.token)!.mint += 1;
        }
        // Check for MELT authority
        if ((output.authorities & 2) > 0) {
          tokensBalance.get(output.token)!.melt += 1;
        }
      } else {
        // Fund output, add to the amount balance
        tokensBalance.get(output.token)!.funds += output.value;
      }
    }

    // Map tx.inputs to Input so we can use getSpentTxs tool
    const inputs: Input[] = tx.inputs.map(input => new Input(input.txId, input.index));
    // Check the inputs
    // XXX: this.getSpentTxs will only return the inputs of our wallet
    // If we want to fill inputs/outputs of any wallet we should change this method
    for await (const {tx: spentTx, input} of this.getSpentTxs(inputs)) {
      // const {tx: spentTx, input} = spentResult;
      const utxoSpent = spentTx.outputs[input.index];
      if (!tokensBalance.has(utxoSpent.token)) {
        tokensBalance.set(utxoSpent.token, getEmptyBalance());
      }
      if (transaction.isAuthorityOutput(utxoSpent)) {
        // Authority input, add to mint or melt balance
        if (transaction.isMint(utxoSpent)) {
          tokensBalance.get(utxoSpent.token)!.mint -= 1;
        }
        if (transaction.isMelt(utxoSpent)) {
          tokensBalance.get(utxoSpent.token)!.melt -= 1;
        }
      } else {
        // Fund input, add to the amount balance
        tokensBalance.get(utxoSpent.token)!.funds -= utxoSpent.value;
      }
    }

    // tokensBalance holds the balance of all tokens on the transaction
    const newInputs: IDataInput[] = [];
    const newOutputs: IDataOutput[] = [];
    for (const [token, balance] of tokensBalance) {
      // match funds
      if (balance.funds > 0) {
        // We have a surplus of this token on the outputs, so we need to find utxos to match
        let foundAmount = 0;
        for await (const utxo of this.selectUtxos({ token, authorities: 0, target_amount: balance.funds})) {
          foundAmount += utxo.value;
          newInputs.push({
            txId: utxo.txId,
            index: utxo.index,
            token: utxo.token,
            address: utxo.address,
          });
        }
        if (foundAmount < balance.funds) {
          // XXX: Insufficient funds
          throw new Error('Insufficient funds');
        }
      } else if (balance.funds < 0) {
        // We have a surplus of this token on the inputs, so we need to add a change output
        newOutputs.push({
          token,
          authorities: 0,
          value: Math.abs(balance.funds),
          address: addressForChange,
          timelock: null,
        });
      }

      // match mint
      if (balance.mint > 0) {
        // We have a surplus of this token on the outputs, so we need to find utxos to match
        let foundAmount = 0;
        // We use max_utxos to find at most `balance.mint` inputs
        for await (const utxo of this.selectUtxos({ token, authorities: 1, max_utxos: balance.mint})) {
          foundAmount += 1;
          newInputs.push({
            txId: utxo.txId,
            index: utxo.index,
            token: utxo.token,
            address: utxo.address,
          });
        }
        if (foundAmount < balance.mint) {
          // XXX: Insufficient funds
          throw new Error('Insufficient mint authority');
        }
      } else if (balance.mint < 0) {
        // We have a surplus of this token on the inputs, so we need to add enough change outputs to match
        for (let i = 0; i < Math.abs(balance.mint); i++) {
          newOutputs.push({
            token,
            authorities: 1,
            value: 1,
            address: addressForChange,
            timelock: null,
          });
        }
      }

      // match melt
      if (balance.melt > 0) {
        // We have a surplus of this token on the outputs, so we need to find utxos to match
        let foundAmount = 0;
        // We use max_utxos to find at most `balance.melt` inputs
        for await (const utxo of this.selectUtxos({ token, authorities: 1, max_utxos: balance.melt})) {
          foundAmount += 1;
          newInputs.push({
            txId: utxo.txId,
            index: utxo.index,
            token: utxo.token,
            address: utxo.address,
          });
        }
        if (foundAmount < balance.melt) {
          // XXX: Insufficient funds
          throw new Error('Insufficient melt authority');
        }
      } else if (balance.melt < 0) {
        // We have a surplus of this token on the inputs, so we need to add enough change outputs to match
        for (let i = 0; i < Math.abs(balance.melt); i++) {
          newOutputs.push({
            token,
            authorities: 2,
            value: 2,
            address: addressForChange,
            timelock: null,
          });
        }
      }
    }

    const max_inputs = this.version?.max_number_inputs || 255;
    const max_outputs = this.version?.max_number_outputs || 255;
    if (((tx.inputs.length + newInputs.length) > max_inputs)
      || ((tx.outputs.length + newOutputs.length) > max_outputs)
    ) {
      // we have more inputs/outputs than what can be sent on the transaction
      throw new Error('When over the maximum amount of inputs/outputs');
    }

    for (const input of newInputs) {
      tx.inputs.push(input);
    }
    for (const output of tx.outputs) {
      tx.outputs.push(output);
    }

    // return {newInputs, newOutputs}
  }

  /**
   * Mark an utxo as selected as input
   *
   * @param {IUtxoId} utxo The Data to identify the utxo
   * @param {boolean} markAs Mark the utxo as this value
   * @param {number|undefined} ttl Unmark the utxo after this amount os ms passed
   *
   * @async
   * @returns {Promise<void>}
   */
  async utxoSelectAsInput(utxo: IUtxoId, markAs: boolean, ttl?: number): Promise<void> {
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

  async getAccessData(): Promise<IWalletAccessData|null> {
    return this.store.getAccessData();
  }

  async saveAccessData(data: IWalletAccessData): Promise<void> {
    return this.store.saveAccessData(data);
  }

  async getWalletData(): Promise<IWalletData> {
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

    try {
      // decryptData handles pin validation
      return decryptData(accessData.mainKey, pinCode);
    } catch(err: unknown) {
      // FIXME: check error type to not hide crypto errors
      throw new Error('Invalid PIN code.');
    }
  }

  async cleanStorage(cleanHistory: boolean = false): Promise<void> {
    return this.store.cleanStorage(cleanHistory);
  }
}