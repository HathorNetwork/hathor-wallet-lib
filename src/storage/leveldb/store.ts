/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IAddressInfo, IAddressMetadata, IHistoryTx, ILockedUtxo, IStore, ITokenData, ITokenMetadata, IUtxo, IUtxoFilterOptions, IWalletAccessData, IWalletData } from '../../types';
import { HDPublicKey } from 'bitcore-lib'
import path from 'path';
import LevelAddressIndex from './address_index';
import LevelHistoryIndex from './history_index';
import LevelUtxoIndex from './utxo_index';
import LevelWalletIndex from './wallet_index';
import LevelTokenIndex from './token_index';

export default class LevelDBStore implements IStore {
  addressIndex: LevelAddressIndex;
  historyIndex: LevelHistoryIndex;
  utxoIndex: LevelUtxoIndex;
  walletIndex: LevelWalletIndex;
  tokenIndex: LevelTokenIndex;
  dbpath: string;
  xpubkey: string;

  constructor(dbroot: string, xpubkey: string) {
    // The xpubkey in the account or change path?
    this.xpubkey = xpubkey;
    const xpub = HDPublicKey.fromString(xpubkey);
    const dbpath = path.join(dbroot, xpub.publicKey.toString());
    this.addressIndex = new LevelAddressIndex(dbpath);
    this.historyIndex = new LevelHistoryIndex(dbpath);
    this.utxoIndex = new LevelUtxoIndex(dbpath);
    this.walletIndex = new LevelWalletIndex(dbpath);
    this.tokenIndex = new LevelTokenIndex(dbpath);

    this.dbpath = dbpath;
  }

  async close(): Promise<void> {
    await this.addressIndex.close();
    await this.historyIndex.close();
    await this.utxoIndex.close();
    await this.walletIndex.close();
    await this.tokenIndex.close();
  }

  async destroy(): Promise<void> {
    await this.addressIndex.clear();
    await this.historyIndex.clear();
    await this.utxoIndex.clear();
    await this.walletIndex.clear();
    await this.tokenIndex.clear();
    await this.close();
  }

  async validate(): Promise<void> {
    await this.addressIndex.validate();
    await this.historyIndex.validate();
    await this.utxoIndex.validate();
    await this.tokenIndex.validate();
    await this.walletIndex.validate();
  }

  async *addressIter(): AsyncGenerator<IAddressInfo> {
    for await (const info of this.addressIndex.addressIter()) {
      yield info;
    }
  }

  async getAddress(base58: string): Promise<IAddressInfo | null> {
    return this.addressIndex.getAddressInfo(base58);
  }

  async getAddressMeta(base58: string): Promise<IAddressMetadata | null> {
    return this.addressIndex.getAddressMeta(base58);
  }

  async addressCount(): Promise<number> {
    return this.addressIndex.addressCount();
  }

  async getAddressAtIndex(index: number): Promise<IAddressInfo | null> {
    const address = await this.addressIndex.getAddressAtIndex(index);
    if (address === null) {
      return null;
    }
    return this.addressIndex.getAddressInfo(address);
  }

  async setCurrentAddressIndex(index: number): Promise<void> {
    await this.walletIndex.setCurrentAddressIndex(index);
  }

  async editAddressMeta(base58: string, meta: IAddressMetadata): Promise<void> {
    await this.addressIndex.setAddressMeta(base58, meta);
  }

  async saveAddress(info: IAddressInfo): Promise<void> {
    if (!info.base58) {
      throw new Error('Invalid address');
    }

    if (await this.addressIndex.addressExists(info.base58)) {
      throw new Error('Already have this address');
    }

    await this.addressIndex.saveAddress(info);

    if ((await this.walletIndex.getCurrentAddressIndex()) === -1) {
      await this.walletIndex.setCurrentAddressIndex(info.bip32AddressIndex);
    }

    if (info.bip32AddressIndex > (await this.walletIndex.getLastLoadedAddressIndex())) {
      await this.walletIndex.setLastLoadedAddressIndex(info.bip32AddressIndex);
    }
  }

  async addressExists(base58: string): Promise<boolean> {
    return this.addressIndex.addressExists(base58);
  }

  async getCurrentAddress(markAsUsed?: boolean | undefined): Promise<string> {
    const addressIndex = await this.walletIndex.getCurrentAddressIndex();
    const addressInfo = await this.getAddressAtIndex(addressIndex);
    if (!addressInfo) {
      throw new Error('Current address is not loaded');
    }

    if (markAsUsed) {
      // Will move the address index only if we have not reached the gap limit
      const lastLoadedIndex = await this.walletIndex.getLastLoadedAddressIndex();
      await this.walletIndex.setCurrentAddressIndex(Math.min(lastLoadedIndex, addressIndex + 1));
    }
    return addressInfo.base58;
  }

  async *historyIter(tokenUid?: string | undefined): AsyncGenerator<IHistoryTx, any, unknown> {
    for await (const tx of this.historyIndex.historyIter(tokenUid)) {
      yield tx;
    }
  }

  async historyCount(): Promise<number> {
    return this.historyIndex.historyCount();
  }

  async saveTx(tx: IHistoryTx): Promise<void> {
    await this.historyIndex.saveTx(tx);
    let maxIndex = await this.walletIndex.getLastUsedAddressIndex();
    for (const el of [...tx.inputs, ...tx.outputs]) {
      if (el.decoded.address && (await this.addressExists(el.decoded.address))) {
        const index = (await this.addressIndex.getAddressInfo(el.decoded.address))!.bip32AddressIndex;
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    }
    if ((await this.walletIndex.getCurrentAddressIndex()) < maxIndex) {
      await this.walletIndex.setCurrentAddressIndex(Math.min(maxIndex + 1, await this.walletIndex.getLastLoadedAddressIndex()));
    }
    await this.walletIndex.setLastUsedAddressIndex(maxIndex);
  }

  async getTx(txId: string): Promise<IHistoryTx | null> {
    return this.historyIndex.getTx(txId);
  }

  // TOKENS
  async *tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>, any, unknown> {
    for await (const token of this.tokenIndex.tokenIter()) {
      yield token;
    }
  }

  async getToken(tokenUid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null> {
    return this.tokenIndex.getToken(tokenUid);
  }

  async getTokenMeta(tokenUid: string): Promise<ITokenMetadata | null> {
    return this.tokenIndex.getTokenMetadata(tokenUid);
  }

  async saveToken(tokenConfig: ITokenData, meta?: ITokenMetadata | undefined): Promise<void> {
    await this.tokenIndex.saveToken(tokenConfig);
    if (meta !== undefined) {
      await this.tokenIndex.saveMetadata(tokenConfig.uid, meta);
    }
  }

  async *registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>, any, unknown> {
    for await (const token of this.tokenIndex.registeredTokenIter()) {
      yield token;
    }
  }

  async registerToken(token: ITokenData): Promise<void> {
    await this.tokenIndex.registerToken(token);
  }

  async unregisterToken(tokenUid: string): Promise<void> {
    await this.tokenIndex.unregisterToken(tokenUid);
  }

  async editTokenMeta(tokenUid: string, meta: ITokenMetadata): Promise<void> {
    await this.tokenIndex.editTokenMeta(tokenUid, meta);
  }

  // Utxos

  async *utxoIter(): AsyncGenerator<IUtxo> {
    for await (const utxo of this.utxoIndex.utxoIter()) {
      yield utxo;
    }
  }

  async *selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IUtxo> {
    if (options.max_amount && options.target_amount) {
      throw new Error('invalid options');
    }
    const networkHeight = await this.getCurrentHeight();
    for await (const utxo of this.utxoIndex.selectUtxos(options, networkHeight)) {
      yield utxo;
    }
  }

  async saveUtxo(utxo: IUtxo): Promise<void> {
    return this.utxoIndex.saveUtxo(utxo);
  }

  /**
   * Save a locked utxo to the database.
   * Used when a new utxo is received but it is either time locked or height locked.
   * The locked utxo index will be used to manage the locked utxos.
   *
   * @param {ILockedUtxo} lockedUtxo The locked utxo to be saved
   * @returns {Promise<void>}
   */
  async saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void> {
    return this.utxoIndex.saveLockedUtxo(lockedUtxo);
  }

  /**
   * Remove an utxo from the locked utxos if it became unlocked.
   *
   * @param lockedUtxo utxo that became unlocked
   * @returns {Promise<void>}
   */
  async unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void> {
    return this.utxoIndex.unlockUtxo(lockedUtxo);
  }

  /**
   * Iterate over all locked utxos
   * @returns {AsyncGenerator<ILockedUtxo>}
   */
  async *iterateLockedUtxos(): AsyncGenerator<ILockedUtxo> {
    for await (const lockedUtxo of this.utxoIndex.iterateLockedUtxos()) {
      yield lockedUtxo;
    }
  }

  // Wallet

  async saveAccessData(data: IWalletAccessData): Promise<void> {
    if (this.xpubkey !== data.xpubkey) {
      throw new Error('Invalid access data: xpubkey used to initiate the store does not match access data being saved');
    }
    await this.walletIndex.saveAccessData(data);
  }

  async getAccessData(): Promise<IWalletAccessData | null> {
    const accessData = await this.walletIndex.getAccessData();
    if (accessData === null) {
      throw new Error('Wallet access data unset');
    }
    return accessData;
  }

  async getLastLoadedAddressIndex(): Promise<number> {
    return this.walletIndex.getLastLoadedAddressIndex();
  }

  async getLastUsedAddressIndex(): Promise<number> {
    return this.walletIndex.getLastUsedAddressIndex();
  }

  async setLastUsedAddressIndex(index: number): Promise<void> {
    await this.walletIndex.setLastUsedAddressIndex(index);
  }

  async setCurrentHeight(height: number): Promise<void> {
    await this.walletIndex.setCurrentHeight(height);
  }

  async getCurrentHeight(): Promise<number> {
    return this.walletIndex.getCurrentHeight();
  }

  async setGapLimit(value: number): Promise<void> {
    await this.walletIndex.setGapLimit(value);
  }

  async getGapLimit(): Promise<number> {
    return this.walletIndex.getGapLimit();
  }

  async getWalletData(): Promise<IWalletData> {
    return this.walletIndex.getWalletData();
  }

  async getItem(key: string): Promise<any> {
    return this.walletIndex.getItem(key);
  }

  async setItem(key: string, value: any): Promise<void> {
    await this.walletIndex.setItem(key, value);
  }

  async cleanStorage(cleanHistory?: boolean | undefined, cleanAddresses?: boolean | undefined): Promise<void> {
    // set access data to null
    await this.walletIndex.cleanAccessData();
    if (cleanHistory) {
      await this.tokenIndex.clear();
      await this.historyIndex.clear();
      await this.utxoIndex.clear();
    }
    if (cleanAddresses) {
      await this.addressIndex.clear();
      await this.walletIndex.cleanWalletData();
    }
  }

  async cleanMetadata(): Promise<void> {
    await this.tokenIndex.clearMeta();
    await this.addressIndex.clearMeta();
    await this.utxoIndex.clear();
  }
}
