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
  IFillTxOptions,
  IBalance,
} from '../types';
import transactionUtils from '../utils/transaction';
import { processHistory } from '../utils/storage';
import config, { Config } from '../config';
import { decryptData, encryptData } from '../utils/crypto';
import FullNodeConnection from '../new/connection';
import { getAddressType } from '../utils/address';
import { HATHOR_TOKEN_CONFIG, MAX_INPUTS, MAX_OUTPUTS } from '../constants';

const DEFAULT_ADDRESS_META: IAddressMetadata = {
  numTransactions: 0,
  balance: new Map<string, IBalance>(),
};

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

  /**
   * Set the fullnode api version data.
   * @param {ApiVersion} version Fullnode api version data
   */
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
  async *getAllAddresses(): AsyncGenerator<IAddressInfo & IAddressMetadata> {
    for await (const address of this.store.addressIter()) {
      const meta = await this.store.getAddressMeta(address.base58);
      yield {...address, ...DEFAULT_ADDRESS_META, ...meta};
    }
  }

  /**
   * Get the address info from store
   *
   * @param {string} base58 The base58 address to fetch
   * @async
   * @returns {Promise<(IAddressInfo & Partial<IAddressMetadata>)|null>} The address info or null if not found
   */
  async getAddressInfo(base58: string): Promise<(IAddressInfo & IAddressMetadata) | null> {
    const address = await this.store.getAddress(base58);
    if (address === null) {
      return null;
    }
    const meta = await this.store.getAddressMeta(base58);
    return {...address, ...DEFAULT_ADDRESS_META, ...meta};
  }

  /**
   * Get the address at the given index
   *
   * @param {number} index
   * @async
   * @returns {Promise<IAddressInfo|null>} The address info or null if not found
   */
  async getAddressAtIndex(index: number): Promise<IAddressInfo | null> {
    return this.store.getAddressAtIndex(index);
  }

  /**
   * Check if the address is from our wallet.
   * @param {string} base58 The address encoded as base58
   * @returns {Promise<boolean>} If the address is known by the storage
   */
  async isAddressMine(base58: string): Promise<boolean> {
    return this.store.addressExists(base58);
  }

  /**
   * Save address info on storage
   * @param {IAddressInfo} info Address info to save on storage
   * @returns {Promise<void>}
   */
  async saveAddress(info: IAddressInfo): Promise<void> {
    await this.store.saveAddress(info);
  }

  /**
   * Get the current address.
   *
   * @param {boolean|undefined} markAsUsed If we should set the next address as current
   * @returns {Promise<string>} The address in base58 encoding
   */
  async getCurrentAddress(markAsUsed?: boolean): Promise<string> {
    return this.store.getCurrentAddress(markAsUsed);
  }

  /**
   * Iterate on the history of transactions.
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  async *txHistory(): AsyncGenerator<IHistoryTx> {
    for await (const tx of this.store.historyIter()) {
      yield tx;
    }
  }

  /**
   * Iterate on the history of transactions that include the given token.
   *
   * @param {string|undefined} [tokenUid='00'] Token to fetch, defaults to HTR
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  async *tokenHistory(tokenUid?: string): AsyncGenerator<IHistoryTx> {
    for await (const tx of this.store.historyIter(tokenUid || HATHOR_TOKEN_CONFIG.uid)) {
      yield tx;
    }
  }

  /**
   * Fetch a transaction on the storage by it's id.
   *
   * @param {string} txId The transaction id to fetch
   * @returns {Promise<IHistoryTx | null>} The transaction or null if not on storage
   */
  async getTx(txId: string): Promise<IHistoryTx|null> {
    return this.store.getTx(txId);
  }

  /**
   * Get the transactions being spent by the given inputs if they belong in our wallet.
   *
   * @param {Input[]} inputs A list of inputs
   * @returns {AsyncGenerator<{tx: IHistoryTx, input: Input, index: number}>}
   */
  async *getSpentTxs(inputs: Input[]): AsyncGenerator<{tx: IHistoryTx, input: Input, index: number}> {
    for await (const [index, input] of inputs.entries()) {
      const tx = await this.getTx(input.hash);
      // Ignore unknown transactions
      if (tx === null) continue;
      yield {tx, input, index};
    }
  }

  /**
   * Add a transaction on storage.
   *
   * @param {IHistoryTx} tx The transaction
   * @returns {Promise<void>}
   */
  async addTx(tx: IHistoryTx): Promise<void> {
    await this.store.saveTx(tx);
  }

  /**
   * Process the transaction history to calculate the metadata.
   * @returns {Promise<void>}
   */
  async processHistory(): Promise<void> {
    await processHistory(
      this.store,
      { rewardLock: this.version?.reward_spend_min_blocks },
    );
  }

  /**
   * Iterate on all tokens on the storage.
   *
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  async *getAllTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for await (const token of this.store.tokenIter()) {
      yield token;
    }
  }

  /**
   * Iterate on all registered tokens of the wallet.
   *
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  async *getRegisteredTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for await (const token of this.store.registeredTokenIter()) {
      yield token;
    }
  }

  /**
   * Get a token from storage along with the metadata of the wallet transactions.
   *
   * @param {string} token Token uid to fetch
   * @returns {Promise<(ITokenData & Partial<ITokenMetadata>)|null>}
   */
  async getToken(token: string): Promise<(ITokenData & Partial<ITokenMetadata>)|null> {
    return this.store.getToken(token);
  }

  /**
   * Regsiter a token.
   * @param {ITokenData} token Token data to register
   * @returns {Promise<void>}
   */
  async registerToken(token: ITokenData): Promise<void> {
    await this.store.registerToken(token);
  }

  /**
   * Unregister a token from the wallet.
   * @param {Promise<void>} tokenUid Token uid to unregister.
   * @returns {Promise<void>}
   */
  async unregisterToken(tokenUid: string): Promise<void> {
    await this.store.unregisterToken(tokenUid);
  }

  /**
   * Iterate on all utxos of the wallet.
   * @returns {AsyncGenerator<IUtxo, any, unknown>}
   */
  async *getAllUtxos(): AsyncGenerator<IUtxo, any, unknown> {
    for await (const utxo of this.store.utxoIter()) {
      yield utxo;
    }
  }

  /**
   * Select utxos matching the request and do not select any utxos marked for inputs.
   *
   * @param {Omit<IUtxoFilterOptions, 'reward_lock'>} [options={}] Options to filter utxos and stop when the target is found.
   * @returns {AsyncGenerator<IUtxo, any, unknown>}
   */
  async *selectUtxos(options: Omit<IUtxoFilterOptions, 'reward_lock'> = {}): AsyncGenerator<IUtxo, any, unknown> {
    const newFilter = (utxo: IUtxo): boolean => {
      const utxoId = `${utxo.txId}:${utxo.index}`;
      return (!this.utxosSelectedAsInput.has(utxoId)) && (options.filter_method ? options.filter_method(utxo) : true);
    }

    const newOptions: IUtxoFilterOptions = {
      ...options,
      filter_method: newFilter,
    };
    if (this.version?.reward_spend_min_blocks) {
      newOptions.reward_lock = this.version.reward_spend_min_blocks;
    }
    for await (const utxo of this.store.selectUtxos(newOptions)) {
      yield utxo;
    }
  }

  /**
   * Match the selected balance for the given authority and token.
   *
   * @param {number} singleBalance The balance we want to match
   * @param {string} token The token uid
   * @param {number} authorities The authorities we want to match
   * @param {string} changeAddress change address to use
   * @param {boolean} chooseInputs If we can add new inputs to the transaction
   * @returns {Promise<{inputs: IDataInput[], outputs: IDataOutput[]}>} The inputs and outputs that match the balance
   * @internal
   */
  async matchBalanceSelection(
    singleBalance: number,
    token: string,
    authorities: number,
    changeAddress: string,
    chooseInputs: boolean,
  ): Promise<{inputs: IDataInput[], outputs: IDataOutput[]}> {
    const newInputs: IDataInput[] = [];
    const newOutputs: IDataOutput[] = [];

    const options: Omit<IUtxoFilterOptions, 'reward_lock'> = {
      authorities,
      token,
      only_available_utxos: true,
    };
    const isAuthority = authorities > 0;
    if (isAuthority) {
      options.max_utxos = singleBalance;
    } else {
      options.target_amount = singleBalance;
    }

    if (singleBalance > 0) {
      if (!chooseInputs) {
        // We cannot choose inputs, so we fail
        throw new Error(`Insufficient funds in the given inputs for ${token}, missing ${singleBalance} more tokens.`);
      }
      // We have a surplus of this token on the outputs, so we need to find utxos to match
      let foundAmount = 0;
      for await (const utxo of this.selectUtxos(options)) {
        if (isAuthority) {
          foundAmount += 1;
        } else {
          foundAmount += utxo.value;
        }
        newInputs.push({
          txId: utxo.txId,
          index: utxo.index,
          token: utxo.token,
          address: utxo.address,
          value: utxo.value,
          authorities: utxo.authorities,
        });
      }
      if (foundAmount < singleBalance) {
        // XXX: Insufficient funds
        throw new Error(`Insufficient funds, found ${foundAmount} but requested ${singleBalance}`);
      } else if (foundAmount > singleBalance) {
        if (isAuthority) {
          // Since we use max_utxos for authorities we should stop before we select more utxos than
          // required, so there should be no need to add an authority change
          throw new Error('This should never happen, authorities should be exact');
        } else {
          // Add change output
          newOutputs.push({
            type: getAddressType(changeAddress, this.config.getNetwork()),
            token,
            authorities: 0,
            value: foundAmount - singleBalance,
            address: changeAddress,
            timelock: null,
          });
        }
      }
    } else if (singleBalance < 0) {
      // We have a surplus of this token on the inputs, so we need to add a change output
      if (isAuthority) {
        for (let i = 0; i < Math.abs(singleBalance); i++) {
          newOutputs.push({
            type: getAddressType(changeAddress, this.config.getNetwork()),
            token,
            authorities: authorities,
            value: authorities,
            address: changeAddress,
            timelock: null,
          });
        }
      } else {
        newOutputs.push({
          type: getAddressType(changeAddress, this.config.getNetwork()),
          token,
          authorities: 0,
          value: Math.abs(singleBalance),
          address: changeAddress,
          timelock: null,
        });
      }
    }

    return {inputs: newInputs, outputs: newOutputs};
  }

  /**
   * Generate inputs and outputs so that the transaction balance is filled.
   *
   * @param {Map<string, Record<'funds'|'mint'|'melt', number>>} txBalance Balance of funds and authorities for all tokens on the transaction
   * @param {IFillTxOptions} [options={}]
   * @param {string} options.changeAddress Address to send change to
   * @param {boolean} [options.skipAuthorities=false] If we should fill authorities or only funds
   * @param {boolean} [options.chooseInputs=true] If we can choose inputs when needed or not
   * @returns {Promise<{inputs: IDataInput[], outputs: IDataOutput[]}>} The inputs and outputs to fill the transaction
   * @internal
   */
  async matchTxTokensBalance(
    txBalance: Map<string, Record<'funds'|'mint'|'melt', number>>,
    { changeAddress, skipAuthorities = true, chooseInputs = true }: IFillTxOptions = {},
  ): Promise<{inputs: IDataInput[], outputs: IDataOutput[]}> {
    const addressForChange = changeAddress || (await this.getCurrentAddress());
    // balance holds the balance of all tokens on the transaction
    const newInputs: IDataInput[] = [];
    const newOutputs: IDataOutput[] = [];
    for (const [token, balance] of txBalance.entries()) {
      // match funds
      const {inputs: fundsInputs, outputs: fundsOutputs} = await this.matchBalanceSelection(balance.funds, token, 0, addressForChange, chooseInputs);
      newInputs.push(...fundsInputs);
      newOutputs.push(...fundsOutputs);

      if (skipAuthorities || token === HATHOR_TOKEN_CONFIG.uid) {
        continue;
      }

      // match mint
      const {inputs: mintInputs, outputs: mintOutputs} = await this.matchBalanceSelection(balance.mint, token, 1, addressForChange, chooseInputs);
      // match melt
      const {inputs: meltInputs, outputs: meltOutputs} = await this.matchBalanceSelection(balance.melt, token, 2, addressForChange, chooseInputs);

      newInputs.push(...mintInputs, ...meltInputs);
      newOutputs.push(...mintOutputs, ...meltOutputs);
    }

    return {
      inputs: newInputs,
      outputs: newOutputs,
    }
  }

  /**
   * Check the balance of the transaction and add inputs and outputs to match the funds and authorities.
   * It will fail if we do not have enough funds or authorities and it will fail if we try to add too many inputs or outputs.
   *
   * @param tx The incomplete transaction we need to fill
   * @param {IFillTxOptions} [options={}] options to use a change address.
   *
   * @async
   * @returns {Promise<void>}
   */
  async fillTx(tx: IDataTx, options: IFillTxOptions = {}): Promise<{inputs: IDataInput[], outputs: IDataOutput[]}> {
    const tokensBalance = await transactionUtils.calculateTxBalanceToFillTx(tx);
    const {inputs: newInputs, outputs: newOutputs} = await this.matchTxTokensBalance(tokensBalance, options);

    // Validate if we will add too many inputs/outputs
    const max_inputs = this.version?.max_number_inputs || MAX_INPUTS;
    const max_outputs = this.version?.max_number_outputs || MAX_OUTPUTS;
    if (((tx.inputs.length + newInputs.length) > max_inputs)
      || ((tx.outputs.length + newOutputs.length) > max_outputs)
    ) {
      // we have more inputs/outputs than what can be sent on the transaction
      throw new Error('When over the maximum amount of inputs/outputs');
    }

    return {inputs: newInputs, outputs: newOutputs}
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
            if (this.utxosSelectedAsInput.has(utxoId)) {
              this.utxosSelectedAsInput.delete(utxoId);
            }
          }
        }, ttl);
      }
    } else {
      this.utxosSelectedAsInput.delete(utxoId);
    }
  }

  /**
   * Helper to check if the access data exists before returning it.
   * Having the accessData as null means the wallet is not initialized so we should throw an error.
   *
   * @returns {Promise<IWalletAccessData>} The access data.
   * @internal
   */
  async _getValidAccessData(): Promise<IWalletAccessData> {
    const accessData = await this.getAccessData();
    if (!accessData) {
      throw new Error('Wallet was not initialized');
    }
    return accessData;
  }

  /**
   * Get the wallet's access data if the wallet is initialized.
   *
   * @returns {Promise<IWalletAccessData | null>}
   */
  async getAccessData(): Promise<IWalletAccessData | null> {
    return this.store.getAccessData();
  }

  /**
   * Save the access data, initializing the wallet.
   *
   * @param {IWalletAccessData} data The wallet access data
   * @returns {Promise<void>}
   */
  async saveAccessData(data: IWalletAccessData): Promise<void> {
    return this.store.saveAccessData(data);
  }

  /**
   * Get the wallet's metadata.
   *
   * @returns {Promise<IWalletData>}
   */
  async getWalletData(): Promise<IWalletData> {
    return this.store.getWalletData();
  }

  /**
   * Get the wallet type, i.e. P2PKH or MultiSig.
   *
   * @returns {Promise<WalletType>}
   */
  async getWalletType(): Promise<WalletType> {
    const accessData = await this._getValidAccessData();
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

  /**
   * Return wheather the wallet is readonly, i.e. was started without the private key.
   * @returns {Promise<boolean>}
   */
  async isReadonly(): Promise<boolean> {
    const accessData = await this._getValidAccessData();
    return (accessData.walletFlags & WALLET_FLAGS.READONLY) > 0;
  }

  /**
   * Decrypt and return the main private key of the wallet.
   *
   * @param {string} pinCode Pin to unlock the private key
   * @returns {Promise<string>} The HDPrivateKey in string format.
   */
  async getMainXPrivKey(pinCode: string): Promise<string> {
    const accessData = await this._getValidAccessData();
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

  /**
   * Decrypt and return the auth private key of the wallet.
   *
   * @param {string} pinCode Pin to unlock the private key
   * @returns {Promise<string>} The Auth HDPrivateKey in string format.
   */
  async getAuthPrivKey(pinCode: string): Promise<string> {
    const accessData = await this._getValidAccessData();
    if (accessData.authKey === undefined) {
      throw new Error('Private key is not present on this wallet.');
    }

    try {
      // decryptData handles pin validation
      return decryptData(accessData.authKey, pinCode);
    } catch(err: unknown) {
      // FIXME: check error type to not hide crypto errors
      throw new Error('Invalid PIN code.');
    }
  }

  /**
   * Handle storage operations for a wallet being stopped.
   * @param {{connection?: FullNodeConnection, cleanStorage?: boolean, cleanAddresses?: boolean}} Options to handle stop
   * @returns {Promise<void>}
   */
  async handleStop({connection, cleanStorage = false, cleanAddresses = false}: {connection?: FullNodeConnection, cleanStorage?: boolean, cleanAddresses?: boolean} = {}): Promise<void> {
    if (connection) {
      for await (const addressInfo of this.getAllAddresses()) {
        connection.unsubscribeAddress(addressInfo.base58);
      }
      connection.removeMetricsHandlers();
    }
    this.version = null;
    if (cleanStorage || cleanAddresses) {
      this.cleanStorage(cleanStorage, cleanAddresses);
    }
  }

  /**
   * Clean the storage data.
   *
   * @param {boolean} [cleanHistory=false] If we should clean the history data
   * @param {boolean} [cleanAddresses=false] If we should clean the address data
   * @returns {Promise<void>}
   */
  async cleanStorage(cleanHistory: boolean = false, cleanAddresses: boolean = false): Promise<void> {
    return this.store.cleanStorage(cleanHistory, cleanAddresses);
  }

  /**
   * Change the wallet pin.
   * @param {string} oldPin Old pin to unlock data.
   * @param {string} newPin New pin to lock data.
   * @returns {Promise<void>}
   */
  async changePin(oldPin: string, newPin: string): Promise<void> {
    const accessData = await this._getValidAccessData();
    if (!(accessData.mainKey || accessData.authKey)) {
      throw new Error('No data to change');
    }

    if (accessData.mainKey) {
      try {
        const mainKey = decryptData(accessData.mainKey, oldPin);
        const newEncryptedMainKey = encryptData(mainKey, newPin);
        accessData.mainKey = newEncryptedMainKey;
      } catch(err: unknown) {
        throw new Error('Old pin is incorrect.');
      }
    }

    if (accessData.authKey) {
      try {
        const authKey = decryptData(accessData.authKey, oldPin);
        const newEncryptedAuthKey = encryptData(authKey, newPin);
        accessData.authKey = newEncryptedAuthKey;
      } catch(err: unknown) {
        throw new Error('Old pin is incorrect.');
      }
    }

    // Save the changes made
    await this.saveAccessData(accessData);
  }

  /**
   * Change the wallet password.
   *
   * @param {string} oldPassword Old password
   * @param {string} newPassword New password
   * @returns {Promise<void>}
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const accessData = await this._getValidAccessData();
    if (!accessData.words) {
      throw new Error('No data to change.');
    }

    try {
      const words = decryptData(accessData.words, oldPassword);
      const newEncryptedWords = encryptData(words, newPassword);
      accessData.words = newEncryptedWords;
    } catch(err: unknown) {
      throw new Error('Old pin is incorrect.');
    }

    // Save the changes made
    await this.saveAccessData(accessData);
  }

  /**
   * Set the wallet gap limit.
   * @param {number} value New gap limit to use.
   * @returns {Promise<void>}
   */
  async setGapLimit(value: number): Promise<void> {
    return this.store.setGapLimit(value);
  }

  /**
   * Get the wallet gap limit.
   * @returns {Promise<number>}
   */
  async getGapLimit(): Promise<number> {
    return this.store.getGapLimit();
  }
}