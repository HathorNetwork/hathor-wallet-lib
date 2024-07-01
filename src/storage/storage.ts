/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPublicKey } from 'bitcore-lib';
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
  AddressScanPolicy,
  AddressScanPolicyData,
  IIndexLimitAddressScanPolicy,
  SCANNING_POLICY,
  INcData,
  EcdsaTxSign,
  ITxSignatureData,
} from '../types';
import transactionUtils from '../utils/transaction';
import { processHistory, processUtxoUnlock } from '../utils/storage';
import config, { Config } from '../config';
import { decryptData, checkPassword } from '../utils/crypto';
import FullNodeConnection from '../new/connection';
import { getAddressType } from '../utils/address';
import walletUtils from '../utils/wallet';
import {
  NATIVE_TOKEN_UID,
  MAX_INPUTS,
  MAX_OUTPUTS,
  TOKEN_DEPOSIT_PERCENTAGE,
  DECIMAL_PLACES,
  DEFAULT_NATIVE_TOKEN_CONFIG,
} from '../constants';
import { UninitializedWalletError } from '../errors';
import Transaction from '../models/transaction';

const DEFAULT_ADDRESS_META: IAddressMetadata = {
  numTransactions: 0,
  balance: new Map<string, IBalance>(),
};

export class Storage implements IStorage {
  store: IStore;

  utxosSelectedAsInput: Map<string, boolean>;

  config: Config;

  version: ApiVersion | null;

  txSignFunc: EcdsaTxSign | null;

  /**
   * This promise is used to chain the calls to process unlocked utxos.
   * This way we can avoid concurrent calls.
   * The best way to do this would be an async queue or a mutex, but to avoid adding
   * more dependencies we are using this simpler method.
   *
   * We can change this implementation to use a mutex or async queue in the future.
   */
  utxoUnlockWait: Promise<void>;

  constructor(store: IStore) {
    this.store = store;
    this.utxosSelectedAsInput = new Map<string, boolean>();
    this.config = config;
    this.version = null;
    this.utxoUnlockWait = Promise.resolve();
    this.txSignFunc = null;
  }

  /**
   * Set the fullnode api version data.
   * @param {ApiVersion} version Fullnode api version data
   */
  setApiVersion(version: ApiVersion): void {
    this.version = version;
  }

  /**
   * Get the decimal places.
   * If not configured, will return the default DECIMAL_PLACES (2)
   * @returns {number}
   */
  getDecimalPlaces(): number {
    return this.version?.decimal_places ?? DECIMAL_PLACES;
  }

  /**
   * Set the native token config on the store
   */
  async saveNativeToken(): Promise<void> {
    if ((await this.store.getToken(NATIVE_TOKEN_UID)) === null) {
      await this.store.saveToken(this.getNativeTokenData());
    }
  }

  /**
   * Gets the native token config
   *
   * @return {ITokenData} The native token config
   */
  getNativeTokenData(): ITokenData {
    const nativeToken = this.version?.native_token ?? DEFAULT_NATIVE_TOKEN_CONFIG;

    return {...nativeToken, uid: NATIVE_TOKEN_UID};
  }

  /**
   * Check if the tx signing method is set
   * @returns {boolean}
   */
  hasTxSignatureMethod(): boolean {
    return !!this.txSignFunc;
  }

  /**
   * Set the tx signing function
   * @param {EcdsaTxSign} txSign The signing function
   */
  setTxSignatureMethod(txSign: EcdsaTxSign): void {
    this.txSignFunc = txSign;
  }

  /**
   * Sign the transaction
   * @param {Transaction} tx The transaction to sign
   * @param {string} pinCode The pin code
   * @returns {Promise<ITxSignatureData>} The signatures
   */
  async getTxSignatures(tx: Transaction, pinCode: string): Promise<ITxSignatureData> {
    if (this.txSignFunc) {
      return this.txSignFunc(tx, this, pinCode);
    }
    return transactionUtils.getSignatureForTx(tx, this, pinCode);
  }

  /**
   * Return the deposit percentage for creating tokens.
   * @returns {number}
   */
  getTokenDepositPercentage(): number {
    /**
     *  When using wallet-service facade we do not update the version constants
     *  Since this data is important for the wallets UI we will return the default value here.
     */
    return this.version?.token_deposit_percentage ?? TOKEN_DEPOSIT_PERCENTAGE;
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
      yield { ...address, ...DEFAULT_ADDRESS_META, ...meta };
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
    return { ...address, ...DEFAULT_ADDRESS_META, ...meta };
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
   * Get the address public key, if not available derive from xpub
   * @param {number} index
   * @async
   * @returns {Promise<string>} The public key DER encoded in hex
   */
  async getAddressPubkey(index: number): Promise<string> {
    const addressInfo = await this.store.getAddressAtIndex(index);
    if (addressInfo?.publicKey) {
      // public key already cached on address info
      return addressInfo.publicKey;
    }

    // derive public key from xpub
    const accessData = await this._getValidAccessData();
    const hdpubkey = new HDPublicKey(accessData.xpubkey);
    const key: HDPublicKey = hdpubkey.deriveChild(index);
    return key.publicKey.toString('hex');
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
   * Get a change address to use, if one is provided we need to check if we own it
   * If not provided, the current address will be used instead.
   *
   * @param {Object} [options={}]
   * @param {string|null|undefined} [options.changeAddress=undefined] User provided change address to use
   * @returns {Promise<string>} The change address to use
   */
  async getChangeAddress({
    changeAddress,
  }: { changeAddress?: string | null | undefined } = {}): Promise<string> {
    if (changeAddress) {
      if (!(await this.isAddressMine(changeAddress))) {
        throw new Error('Change address is not from the wallet');
      }
      return changeAddress;
    }

    return this.getCurrentAddress();
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
    for await (const tx of this.store.historyIter(tokenUid || NATIVE_TOKEN_UID)) {
      yield tx;
    }
  }

  /**
   * Fetch a transaction on the storage by it's id.
   *
   * @param {string} txId The transaction id to fetch
   * @returns {Promise<IHistoryTx | null>} The transaction or null if not on storage
   */
  async getTx(txId: string): Promise<IHistoryTx | null> {
    return this.store.getTx(txId);
  }

  /**
   * Get the transactions being spent by the given inputs if they belong in our wallet.
   *
   * @param {Input[]} inputs A list of inputs
   * @returns {AsyncGenerator<{tx: IHistoryTx, input: Input, index: number}>}
   */
  async *getSpentTxs(
    inputs: Input[]
  ): AsyncGenerator<{ tx: IHistoryTx; input: Input; index: number }> {
    for await (const [index, input] of inputs.entries()) {
      const tx = await this.getTx(input.hash);
      // Ignore unknown transactions
      if (tx === null) continue;
      yield { tx, input, index };
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
    await processHistory(this, { rewardLock: this.version?.reward_spend_min_blocks });
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
  async getToken(token: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null> {
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
   * Return if a token is registered.
   * @param tokenUid - Token id.
   * @returns {Promise<boolean>}
   */
  async isTokenRegistered(tokenUid: string): Promise<boolean> {
    return this.store.isTokenRegistered(tokenUid);
  }

  /**
   * Process the locked utxos to unlock them if the lock has expired.
   * Will process both timelocked and heightlocked utxos.
   *
   * We will wait for any previous execution to finish before starting the next one.
   *
   * @param {number} height The network height to use as reference to unlock utxos
   * @returns {Promise<void>}
   */
  async unlockUtxos(height: number): Promise<void> {
    // Will wait for the previous execution to finish before starting the next one
    // This is to prevent multiple calls to this method to run in parallel and "double unlock" utxos
    this.utxoUnlockWait = this.utxoUnlockWait.then(() => this.processLockedUtxos(height));
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
  async *selectUtxos(
    options: Omit<IUtxoFilterOptions, 'reward_lock'> = {}
  ): AsyncGenerator<IUtxo, any, unknown> {
    const filterSelected = (utxo: IUtxo): boolean => {
      const utxoId = `${utxo.txId}:${utxo.index}`;
      return !this.utxosSelectedAsInput.has(utxoId);
    };
    const newFilter = (utxo: IUtxo): boolean => {
      const optionsFilter = options.filter_method ? options.filter_method(utxo) : true;
      const selectedFilter = filterSelected(utxo);
      if (options.only_available_utxos) {
        // We need to check if the utxo is selected as an input since we only want available utxos.
        return selectedFilter && optionsFilter;
      }
      // Only check the filter method if we don't care about available utxos.
      return optionsFilter;
    };

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
    chooseInputs: boolean
  ): Promise<{ inputs: IDataInput[]; outputs: IDataOutput[] }> {
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
        throw new Error(
          `Insufficient funds in the given inputs for ${token}, missing ${singleBalance} more tokens.`
        );
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
            authorities,
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

    return { inputs: newInputs, outputs: newOutputs };
  }

  /**
   * Generate inputs and outputs so that the transaction balance is filled.
   *
   * @param {string} token Token uid
   * @param {Record<'funds'|'mint'|'melt', number>} balance Balance of funds and authorities for a token on the transaction
   * @param {IFillTxOptions} [options={}]
   * @param {string} options.changeAddress Address to send change to
   * @param {boolean} [options.skipAuthorities=false] If we should fill authorities or only funds
   * @param {boolean} [options.chooseInputs=true] If we can choose inputs when needed or not
   * @returns {Promise<{inputs: IDataInput[], outputs: IDataOutput[]}>} The inputs and outputs to fill the transaction
   * @internal
   */
  async matchTokenBalance(
    token: string,
    balance: Record<'funds' | 'mint' | 'melt', number>,
    { changeAddress, skipAuthorities = true, chooseInputs = true }: IFillTxOptions = {}
  ): Promise<{ inputs: IDataInput[]; outputs: IDataOutput[] }> {
    const addressForChange = changeAddress || (await this.getCurrentAddress());
    // balance holds the balance of all tokens on the transaction
    const newInputs: IDataInput[] = [];
    const newOutputs: IDataOutput[] = [];
    // match funds
    const { inputs: fundsInputs, outputs: fundsOutputs } = await this.matchBalanceSelection(
      balance.funds,
      token,
      0,
      addressForChange,
      chooseInputs
    );
    newInputs.push(...fundsInputs);
    newOutputs.push(...fundsOutputs);

    if (!(skipAuthorities || token === NATIVE_TOKEN_UID)) {
      // Match authority balance (only possible for custom tokens)
      // match mint
      const { inputs: mintInputs, outputs: mintOutputs } = await this.matchBalanceSelection(
        balance.mint,
        token,
        1,
        addressForChange,
        chooseInputs
      );
      // match melt
      const { inputs: meltInputs, outputs: meltOutputs } = await this.matchBalanceSelection(
        balance.melt,
        token,
        2,
        addressForChange,
        chooseInputs
      );

      newInputs.push(...mintInputs, ...meltInputs);
      newOutputs.push(...mintOutputs, ...meltOutputs);
    }

    return {
      inputs: newInputs,
      outputs: newOutputs,
    };
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
  async fillTx(
    token: string,
    tx: IDataTx,
    options: IFillTxOptions = {}
  ): Promise<{ inputs: IDataInput[]; outputs: IDataOutput[] }> {
    const tokenBalance = await transactionUtils.calculateTxBalanceToFillTx(token, tx);
    const { inputs: newInputs, outputs: newOutputs } = await this.matchTokenBalance(
      token,
      tokenBalance,
      options
    );

    // Validate if we will add too many inputs/outputs
    const max_inputs = this.version?.max_number_inputs || MAX_INPUTS;
    const max_outputs = this.version?.max_number_outputs || MAX_OUTPUTS;
    if (
      tx.inputs.length + newInputs.length > max_inputs ||
      tx.outputs.length + newOutputs.length > max_outputs
    ) {
      // we have more inputs/outputs than what can be sent on the transaction
      throw new Error('When over the maximum amount of inputs/outputs');
    }

    return { inputs: newInputs, outputs: newOutputs };
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
    if (!tx || !tx.outputs[utxo.index]) {
      return;
    }

    if (markAs && tx.outputs[utxo.index].spent_by !== null) {
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
   * Iterate over all locked utxos and unlock them if needed
   * When a utxo is unlocked, the balances and metadatas are updated
   * and the utxo is removed from the locked utxos.
   *
   * @param {number} height The new height of the best chain
   */
  async processLockedUtxos(height: number): Promise<void> {
    const nowTs = Math.floor(Date.now() / 1000);
    for await (const lockedUtxo of this.store.iterateLockedUtxos()) {
      await processUtxoUnlock(this, lockedUtxo, {
        nowTs,
        rewardLock: this.version?.reward_spend_min_blocks || 0,
        currentHeight: height,
      });
    }
  }

  /**
   * Check if an utxo is selected as input.
   *
   * @param {IUtxoId} utxo The utxo we want to check if it is selected as input
   * @returns {Promise<boolean>}
   * @example
   * const isSelected = await isUtxoSelectedAsInput({ txId: 'tx1', index: 0 });
   */
  async isUtxoSelectedAsInput(utxo: IUtxoId): Promise<boolean> {
    const utxoId = `${utxo.txId}:${utxo.index}`;
    return this.utxosSelectedAsInput.has(utxoId);
  }

  /**
   * Iterate on all locked utxos.
   * Used to check if the utxos are still locked.
   *
   * @returns {AsyncGenerator<IUtxoId>}
   */
  async *utxoSelectedAsInputIter(): AsyncGenerator<IUtxoId> {
    for (const [utxoStr, isSelected] of this.utxosSelectedAsInput.entries()) {
      if (isSelected) {
        const [txId, index] = utxoStr.split(':');
        yield {
          txId,
          index: parseInt(index, 10),
        };
      }
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
      throw new UninitializedWalletError();
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
    await this.store.setCurrentHeight(height);
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

    // decryptData handles pin validation
    return decryptData(accessData.mainKey, pinCode);
  }

  /**
   * Get account path xprivkey if available.
   *
   * @param {string} pinCode
   * @returns {Promise<string>}
   */
  async getAcctPathXPrivKey(pinCode: string): Promise<string> {
    const accessData = await this._getValidAccessData();
    if (!accessData.acctPathKey) {
      throw new Error('Private key is not present on this wallet.');
    }

    // decryptData handles pin validation
    return decryptData(accessData.acctPathKey, pinCode);
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

    // decryptData handles pin validation
    return decryptData(accessData.authKey, pinCode);
  }

  /**
   * Handle storage operations for a wallet being stopped.
   * @param {{
   *   connection?: FullNodeConnection;
   *   cleanStorage?: boolean;
   *   cleanAddresses?: boolean;
   *   cleanTokens?: boolean;
   * }} Options to handle stop
   * @returns {Promise<void>}
   */
  async handleStop({
    connection,
    cleanStorage = false,
    cleanAddresses = false,
    cleanTokens = false,
  }: {
    connection?: FullNodeConnection;
    cleanStorage?: boolean;
    cleanAddresses?: boolean;
    cleanTokens?: boolean;
  } = {}): Promise<void> {
    if (connection) {
      for await (const addressInfo of this.getAllAddresses()) {
        connection.unsubscribeAddress(addressInfo.base58);
      }
      connection.removeMetricsHandlers();
    }
    this.version = null;
    if (cleanStorage || cleanAddresses || cleanTokens) {
      await this.cleanStorage(cleanStorage, cleanAddresses, cleanTokens);
    }
  }

  /**
   * Clean the storage data.
   *
   * @param {boolean} [cleanHistory=false] If we should clean the history data
   * @param {boolean} [cleanAddresses=false] If we should clean the address data
   * @param {boolean} [cleanTokens=false] If we should clean the registered tokens
   * @returns {Promise<void>}
   */
  async cleanStorage(
    cleanHistory: boolean = false,
    cleanAddresses: boolean = false,
    cleanTokens: boolean = false
  ): Promise<void> {
    return this.store.cleanStorage(cleanHistory, cleanAddresses, cleanTokens);
  }

  /**
   * Check if the pin is correct
   *
   * @param {string} pinCode - Pin to check
   * @returns {Promise<boolean>}
   * @throws {Error} if the wallet is not initialized
   * @throws {Error} if the wallet does not have the private key
   */
  async checkPin(pinCode: string): Promise<boolean> {
    const accessData = await this._getValidAccessData();
    if (!accessData.mainKey) {
      throw new Error('Cannot check pin without the private key.');
    }

    return checkPassword(accessData.mainKey, pinCode);
  }

  /**
   * Check if the password is correct
   *
   * @param {string} password - Password to check
   * @returns {Promise<boolean>}
   * @throws {Error} if the wallet is not initialized
   * @throws {Error} if the wallet does not have the private key
   */
  async checkPassword(password: string): Promise<boolean> {
    const accessData = await this._getValidAccessData();
    if (!accessData.words) {
      throw new Error('Cannot check password without the words.');
    }

    return checkPassword(accessData.words, password);
  }

  /**
   * Change the wallet pin.
   * @param {string} oldPin Old pin to unlock data.
   * @param {string} newPin New pin to lock data.
   * @returns {Promise<void>}
   */
  async changePin(oldPin: string, newPin: string): Promise<void> {
    const accessData = await this._getValidAccessData();

    const newAccessData = walletUtils.changeEncryptionPin(accessData, oldPin, newPin);

    // Save the changes made
    await this.saveAccessData(newAccessData);
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

    const newAccessData = walletUtils.changeEncryptionPassword(
      accessData,
      oldPassword,
      newPassword
    );

    // Save the changes made
    await this.saveAccessData(newAccessData);
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
    if ((await this.getScanningPolicy()) !== SCANNING_POLICY.GAP_LIMIT) {
      throw new Error('Wallet is not configured to use gap limit');
    }
    return this.store.getGapLimit();
  }

  /**
   * Get the index limit.
   * @returns {Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'>>}
   */
  async getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null> {
    return this.store.getIndexLimit();
  }

  /**
   * Get the scanning policy.
   * @returns {Promise<AddressScanPolicy>}
   */
  async getScanningPolicy(): Promise<AddressScanPolicy> {
    return this.store.getScanningPolicy();
  }

  /**
   * Set the scanning policy data.
   * @param {AddressScanPolicyData | null} data
   * @returns {Promise<void>}
   */
  async setScanningPolicyData(data: AddressScanPolicyData | null): Promise<void> {
    if (!data) return;
    await this.store.setScanningPolicyData(data);
  }

  /**
   * Get the scanning policy data.
   * @returns {Promise<AddressScanPolicyData>}
   */
  async getScanningPolicyData(): Promise<AddressScanPolicyData> {
    return this.store.getScanningPolicyData();
  }

  /**
   * Return if the loaded wallet was started from a hardware wallet.
   * @returns {Promise<boolean>}
   */
  async isHardwareWallet(): Promise<boolean> {
    const accessData = await this._getValidAccessData();
    return (accessData.walletFlags & WALLET_FLAGS.HARDWARE) > 0;
  }

  /**
   * Return if the nano contract is registered for the given address based on ncId.
   * @param ncId Nano Contract ID.
   * @returns `true` if registered and `false` otherwise.
   * @async
   */
  async isNanoContractRegistered(ncId: string): Promise<boolean> {
    return this.store.isNanoContractRegistered(ncId);
  }

  /**
   * Iterate on all registered nano contracts of the wallet.
   *
   * @async
   * @generator
   * @returns {AsyncGenerator<INcData>}
   */
  async *getRegisteredNanoContracts(): AsyncGenerator<INcData> {
    for await (const ncData of this.store.registeredNanoContractsIter()) {
      yield ncData;
    }
  }

  /**
   * Get nano contract data.
   * @param ncId Nano Contract ID.
   * @returns An instance of Nano Contract data.
   */
  async getNanoContract(ncId: string): Promise<INcData | null> {
    return this.store.getNanoContract(ncId);
  }

  /**
   * Register nano contract data instance.
   * @param ncId Nano Contract ID.
   * @param ncValue Nano Contract basic information.
   */
  async registerNanoContract(ncId: string, ncValue: INcData): Promise<void> {
    return this.store.registerNanoContract(ncId, ncValue);
  }

  /**
   * Unregister nano contract.
   * @param ncId Nano Contract ID.
   */
  async unregisterNanoContract(ncId: string): Promise<void> {
    return this.store.unregisterNanoContract(ncId);
  }

  /**
   * Update nano contract registered address
   * @param ncId Nano Contract ID.
   * @param address New registered address
   */
  async updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void> {
    if (!(await this.isAddressMine(address))) {
      throw new Error('Registered address must belong to the wallet.');
    }
    return this.store.updateNanoContractRegisteredAddress(ncId, address);
  }
}
