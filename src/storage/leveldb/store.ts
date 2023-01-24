/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IAddressInfo, IAddressMetadata, IBalance, IHistoryTx, IStore, ITokenData, ITokenMetadata, IUtxo, IUtxoFilterOptions, IWalletAccessData, IWalletData } from '../../types';
import { HDPublicKey } from 'bitcore-lib'
import path from 'path';
import LevelAddressIndex from './address_index';
import LevelHistoryIndex from './history_index';
import LevelUtxoIndex from './utxo_index';
import LevelWalletIndex from './wallet_index';
import LevelTokenIndex from './token_index';
import walletApi from '../../api/wallet';
import transaction from '../../utils/transaction';
import { rmSync } from 'fs';
import { HATHOR_TOKEN_CONFIG } from '../../constants';

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
    await this.close();
    rmSync(this.dbpath, { recursive: true, force: true });
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
      this.walletIndex.setLastLoadedAddressIndex(info.bip32AddressIndex);
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

  async processHistory({ rewardLock }: {rewardLock?: number} = {}): Promise<void> {
    function getEmptyBalance(): IBalance {
      return {
        tokens: {unlocked: 0, locked: 0},
        authorities: {
          mint: {unlocked: 0, locked: 0},
          melt: {unlocked: 0, locked: 0},
        }
      };
    }

    await this.tokenIndex.clearMeta();
    await this.addressIndex.clearMeta();

    const nowTs = Math.floor(Date.now() / 1000);
    const isTimelocked = (timelock?: number|null) => (!!timelock) && timelock > nowTs;
    const currentHeight = await this.getCurrentHeight();
    const checkRewardLock = (blockHeight?: number) => (!!blockHeight) && (!!rewardLock) && ((blockHeight + rewardLock) < currentHeight);

    const allTokens = new Set<string>();
    let maxIndexUsed = -1;
    // process entire history
    for await (const tx of this.historyIter()) {
      if (tx.is_voided) {
        // Ignore voided transactions
        continue;
      }
      const txAddresses = new Set<string>();
      const txTokens = new Set<string>();
      const isHeightLocked = checkRewardLock(tx.height);

      for (const [index, output] of tx.outputs.entries()) {
        // if address is not in wallet, ignore
        if (!(output.decoded.address && (await this.addressExists(output.decoded.address)))) continue;

        // create if not exists
        let addressMeta = await this.addressIndex.getAddressMeta(output.decoded.address);
        let tokenMeta = await this.tokenIndex.getTokenMetadata(output.token);
        if (!addressMeta) {
          addressMeta = { numTransactions: 0, balance: new Map() };
        }
        if (!addressMeta.balance.has(output.token)) {
          addressMeta.balance.set(output.token, getEmptyBalance());
        }
        if (!tokenMeta) {
          tokenMeta = { numTransactions: 0, balance: getEmptyBalance() };
        }

        // update metadata
        allTokens.add(output.token);
        txTokens.add(output.token);
        txAddresses.add(output.decoded.address);
        // check index
        const addressInfo = await this.addressIndex.getAddressInfo(output.decoded.address);
        if (addressInfo!.bip32AddressIndex > maxIndexUsed) {
          maxIndexUsed = addressInfo!.bip32AddressIndex;
        }

        const isAuthority: boolean = transaction.isAuthorityOutput(output);

        // calculate balance
        if (isAuthority) {
          if (isTimelocked(output.decoded.timelock) || isHeightLocked) {
            if (transaction.isMint(output)) {
              tokenMeta.balance.authorities.mint.locked += 1;
              addressMeta.balance.get(output.token)!.authorities.mint.locked += 1;
            }
            if (transaction.isMelt(output)) {
              tokenMeta.balance.authorities.melt.locked += 1;
              addressMeta.balance.get(output.token)!.authorities.melt.locked += 1;
            }
          } else {
            if (transaction.isMint(output)) {
              tokenMeta.balance.authorities.mint.unlocked += 1;
              addressMeta.balance.get(output.token)!.authorities.mint.unlocked += 1;
            }
            if (transaction.isMelt(output)) {
              tokenMeta.balance.authorities.melt.unlocked += 1;
              addressMeta.balance.get(output.token)!.authorities.melt.unlocked += 1;
            }
          }
        } else {
          if (isTimelocked(output.decoded.timelock) || isHeightLocked) {
            tokenMeta.balance.tokens.locked += output.value;
            addressMeta.balance.get(output.token)!.tokens.locked += output.value;
          } else {
            tokenMeta.balance.tokens.unlocked += output.value;
            addressMeta.balance.get(output.token)!.tokens.unlocked += output.value;
          }
        }

        // add utxo if available (not spent and unlocked)
        if (output.spent_by === null && !(isTimelocked(output.decoded.timelock) || isHeightLocked)) {
          await this.utxoIndex.saveUtxo({
            txId: tx.tx_id,
            index,
            type: tx.version,
            authorities: transaction.isAuthorityOutput(output) ? output.value : 0,
            address: output.decoded.address,
            token: output.token,
            value: output.value,
            timelock: output.decoded.timelock || null,
            height: tx.height || null,
          });
        }

        // save address and token metadatas
        await this.addressIndex.setAddressMeta(output.decoded.address, addressMeta);
        await this.tokenIndex.saveMetadata(output.token, tokenMeta);
      }
      for (const input of tx.inputs) {
        // If this is not
        if (!input.decoded.address) continue;

        const addressInfo = await this.addressIndex.getAddressInfo(input.decoded.address);
        if (addressInfo === null) {
          continue;
        }

        // create if not exists
        let addressMeta = await this.addressIndex.getAddressMeta(input.decoded.address);
        let tokenMeta = await this.tokenIndex.getTokenMetadata(input.token);
        if (!addressMeta) {
          addressMeta = { numTransactions: 0, balance: new Map() };
        }
        if (!addressMeta.balance.has(input.token)) {
          addressMeta.balance.set(input.token, getEmptyBalance());
        }
        if (!tokenMeta) {
          tokenMeta = { numTransactions: 0, balance: getEmptyBalance() };
        }

        // update metadata
        txTokens.add(input.token);
        txAddresses.add(input.decoded.address);
        allTokens.add(input.token);

        // check index
        if (addressInfo.bip32AddressIndex > maxIndexUsed) {
          maxIndexUsed = addressInfo.bip32AddressIndex;
        }

        const isAuthority: boolean = transaction.isAuthorityOutput(input);

        if (isAuthority) {
          if (transaction.isMint(input)) {
            tokenMeta.balance.authorities.mint.unlocked -= 1;
            addressMeta.balance.get(input.token)!.authorities.mint.unlocked -= 1;
          }
          if (transaction.isMelt(input)) {
            tokenMeta.balance.authorities.melt.unlocked -= 1;
            addressMeta.balance.get(input.token)!.authorities.melt.unlocked -= 1;
          }
        } else {
          tokenMeta.balance.tokens.unlocked -= input.value;
          addressMeta.balance.get(input.token)!.tokens.unlocked -= input.value;
        }

        // save address and token metadatas
        await this.addressIndex.setAddressMeta(input.decoded.address, addressMeta);
        await this.tokenIndex.saveMetadata(input.token, tokenMeta);
      }

      for (const token of txTokens) {
        const tokenMeta = await this.tokenIndex.getTokenMetadata(token);
        tokenMeta!.numTransactions += 1;
        await this.tokenIndex.saveMetadata(token, tokenMeta!);
      }
      for (const address of txAddresses) {
        const addrMeta = await this.addressIndex.getAddressMeta(address);
        addrMeta!.numTransactions += 1;
        await this.addressIndex.setAddressMeta(address, addrMeta!);
      }
    }

    if ((await this.walletIndex.getLastUsedAddressIndex()) <= maxIndexUsed) {
      if ((await this.walletIndex.getCurrentAddressIndex()) <= maxIndexUsed) {
        await this.walletIndex.setCurrentAddressIndex(Math.min(maxIndexUsed + 1, await this.walletIndex.getLastLoadedAddressIndex()));
      }
      await this.walletIndex.setLastUsedAddressIndex(maxIndexUsed);
    }

    for (const uid of allTokens) {
      if (uid === HATHOR_TOKEN_CONFIG.uid) {
        await this.tokenIndex.saveToken(HATHOR_TOKEN_CONFIG);
      }
      const tokenInfo = await this.tokenIndex.getToken(uid);
      if (!tokenInfo) {
        // this is a new token, we need to get the token data from api
        const result: {
          success: true;
          name: string;
          symbol: string;
        } | { success: false, message: string } = await new Promise((resolve) => {
          return walletApi.getGeneralTokenInfo(uid, resolve);
        });

        if (!result.success) {
          throw new Error(result.message);
        }

        const { name, symbol } = result;
        const tokenData = { uid, name, symbol };
        await this.tokenIndex.saveToken(tokenData);
      }
    }
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
      this.walletIndex.setCurrentAddressIndex(Math.min(maxIndex + 1, await this.walletIndex.getLastLoadedAddressIndex()));
    }
    this.walletIndex.setLastUsedAddressIndex(maxIndex);
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

  async deleteTokens(tokens: string[]): Promise<void> {
    await this.tokenIndex.deleteTokens(tokens);
  }

  async editToken(tokenUid: string, meta: Partial<ITokenMetadata>): Promise<void> {
    await this.tokenIndex.editToken(tokenUid, meta);
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

  async saveAccessData(data: IWalletAccessData): Promise<void> {
    if (this.xpubkey !== data.xpubkey) {
      throw new Error('Invalid access data: xpubkey used to initiade the store does not match access data being saved');
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
}