/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStore, IStorageAddress, IStorageToken, IStorageTokenMetadata, IStorageTx, IStorageUTXO, IStorageAccessData, IUtxoFilterOptions, ITokenBalance, IBalance, IStorageAddressMetadata, IStorageWalletData } from '../types';
import transaction from '../utils/transaction';
import walletApi from '../api/wallet';


export class MemoryStore implements IStore {
  addresses: Map<string, IStorageAddress>;
  addressIndexes: Map<number, string>;
  addressesMetadata: Map<string, IStorageAddressMetadata>;
  tokens: Map<string, IStorageToken>;
  tokensMetadata: Map<string, IStorageTokenMetadata>;
  registeredTokens: Map<string, IStorageToken>;
  history: Map<string, IStorageTx>;
  utxos: Map<string, IStorageUTXO>;
  accessData: IStorageAccessData|null;
  walletData: IStorageWalletData;
  genericStorage: Record<string, any>;

  constructor() {
    this.addresses = new Map<string, IStorageAddress>();
    this.addressIndexes = new Map<number, string>();
    this.addressesMetadata = new Map<string, IStorageAddressMetadata>();
    this.tokens = new Map<string, IStorageToken>();
    this.tokensMetadata = new Map<string, IStorageTokenMetadata>();
    this.registeredTokens = new Map<string, IStorageToken>();
    this.history = new Map<string, IStorageTx>();
    this.utxos = new Map<string, IStorageUTXO>();
    this.accessData = null;
    this.genericStorage = {};

    this.walletData = {
      lastLoadedAddressIndex: 0,
      lastUsedAddressIndex: -1,
      currentAddressIndex: -1,
      bestBlockHeight: 0,
      gapLimit: 20,
    };
  }

  /** ADDRESSES */

  async *addressIter(): AsyncGenerator<IStorageAddress, any, unknown> {
    for (const addrInfo of this.addresses.values()) {
      yield addrInfo;
    }
  }

  async getAddress(base58: string): Promise<IStorageAddress | null> {
    return this.addresses.get(base58) || null;
  }

  async getAddressMeta(base58: string): Promise<IStorageAddressMetadata | null> {
    return this.addressesMetadata.get(base58) || null;
  }

  async addressCount(): Promise<number> {
    return this.addresses.size;
  }

  async getAddressAtIndex(index: number): Promise<IStorageAddress|null> {
    const addr = this.addressIndexes.get(index);
    if (addr === undefined) {
      // We do not have this index loaded on storage, it should be generated instead
      return null;
    }
    return this.addresses.get(addr) as IStorageAddress;
  }

  async saveAddress(info: IStorageAddress): Promise<void> {
    if (!info.base58) {
      throw new Error('Invalid address');
    }
    if (this.addresses.has(info.base58)) {
      throw new Error('Already have this address');
    }

    // Saving address info
    this.addresses.set(info.base58, info);
    this.addressIndexes.set(info.bip32AddressIndex, info.base58);

    if (info.bip32AddressIndex > this.walletData.lastLoadedAddressIndex) {
      this.walletData.lastLoadedAddressIndex = info.bip32AddressIndex;
    }
  }

  async addressExists(base58: string): Promise<boolean> {
    return this.addresses.has(base58);
  }

  async getCurrentAddress(markAsUsed?: boolean): Promise<string> {
    const addressInfo = await this.getAddressAtIndex(this.walletData.currentAddressIndex);
    if (!addressInfo) {
      throw new Error('Current address is not loaded');
    }

    if (markAsUsed) {
      // Will move the address index only if we have not reached the gap limit
      this.walletData.currentAddressIndex = Math.min(this.walletData.lastLoadedAddressIndex, this.walletData.currentAddressIndex + 1);
    }
    return addressInfo.base58;
  }

  /* TRANSACTIONS */

  async *historyIter(tokenUid?: string | undefined): AsyncGenerator<IStorageTx> {
    for (const tx of this.history.values()) {
      if (tokenUid !== undefined) {
        // If a tokenUid is passed, we only yield the transaction if it has the token in one of our addresses
        let found = false;
        for (const input of tx.inputs) {
          if (input.decoded.address && this.addresses.has(input.decoded.address) && input.token === tokenUid) {
            found = true;
            break;
          }
        }
        if (found) {
          yield tx;
          continue;
        }
        for (const output of tx.outputs) {
          if (output.decoded.address && this.addresses.has(output.decoded.address) && output.token === tokenUid) {
            found = true;
            break;
          }
        }
        if (found) {
          yield tx;
          continue;
        }
      }
      yield tx;
    }
  }

  async historyCount(): Promise<number> {
    return this.history.size;
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
    const nowTs = Math.floor(Date.now() / 1000);
    const isTimelocked = (timelock: number|null) => timelock !== null && timelock > nowTs;
    const currentHeight = await this.getCurrentHeight();
    const isHeightLocked = (blockHeight?: number) => (!!blockHeight) && (!!rewardLock) && ((blockHeight + rewardLock) < currentHeight);

    // recalculate wallet metadata
    const tokensMetadata = new Map<string, IStorageTokenMetadata>();
    const addressesMetadata = new Map<string, IStorageAddressMetadata>();
    const utxos = new Map<string, IStorageUTXO>();

    const allTokens = new Set<string>();
    let maxIndexUsed = -1;
    // process entire history
    for await (const tx of this.historyIter()) {
      if (tx.is_voided) {
        // Ignore voided transactions
        continue;
      }
      for (const [index, output] of tx.outputs.entries()) {
        // if address is not in wallet, ignore
        if (!(output.decoded.address && (await this.addressExists(output.decoded.address)))) continue;

        // create if not exists
        if (!addressesMetadata.has(output.decoded.address)) {
          addressesMetadata.set(output.decoded.address, { numTransactions: 0, balance: new Map() });
        }
        if (!addressesMetadata.get(output.decoded.address)!.balance.has(output.token)) {
          addressesMetadata.get(output.decoded.address)!.balance.set(output.token, getEmptyBalance());
        }
        if (!tokensMetadata.has(output.token)) {
          tokensMetadata.set(output.token, { numTransactions: 0, balance: getEmptyBalance() });
        }

        // update metadata
        allTokens.add(output.token);
        tokensMetadata.get(output.token)!.numTransactions += 1;
        addressesMetadata.get(output.decoded.address)!.numTransactions += 1;
        // check index
        if (this.addresses.get(output.decoded.address)!.bip32AddressIndex > maxIndexUsed) {
          maxIndexUsed = this.addresses.get(output.decoded.address)!.bip32AddressIndex;
        }

        const isAuthority: boolean = transaction.isAuthorityOutput(output);

        // calculate balance
        if (isAuthority) {
          if (isTimelocked(output.decoded.timelock) || isHeightLocked(output.height)) {
            if (transaction.isMint(output)) {
              tokensMetadata.get(output.token)!.balance.authorities.mint.locked += 1;
              addressesMetadata.get(output.decoded.address)!.balance.get(output.token)!.authorities.mint.locked += 1;
            }
            if (transaction.isMelt(output)) {
              tokensMetadata.get(output.token)!.balance.authorities.melt.locked += 1;
              addressesMetadata.get(output.decoded.address)!.balance.get(output.token)!.authorities.melt.locked += 1;
            }
          } else {
            if (transaction.isMint(output)) {
              tokensMetadata.get(output.token)!.balance.authorities.mint.unlocked += 1;
              addressesMetadata.get(output.decoded.address)!.balance.get(output.token)!.authorities.mint.unlocked += 1;
            }
            if (transaction.isMelt(output)) {
              tokensMetadata.get(output.token)!.balance.authorities.melt.unlocked += 1;
              addressesMetadata.get(output.decoded.address)!.balance.get(output.token)!.authorities.melt.unlocked += 1;
            }
          }
        } else {
          if (isTimelocked(output.decoded.timelock) || isHeightLocked(output.height)) {
            tokensMetadata.get(output.token)!.balance.tokens.locked += output.value;
            addressesMetadata.get(output.decoded.address)!.balance.get(output.token)!.tokens.locked += output.value;
          } else {
            tokensMetadata.get(output.token)!.balance.tokens.unlocked += output.value;
            addressesMetadata.get(output.decoded.address)!.balance.get(output.token)!.tokens.unlocked += output.value;
          }
        }

        // add utxo if available (not spent and unlocked)
        if (output.spent_by === null && !(isTimelocked(output.decoded.timelock) || isHeightLocked(output.height))) {
          utxos.set(`${tx.tx_id}:${index}`, {
            txId: tx.tx_id,
            index,
            type: tx.version,
            authorities: transaction.isAuthorityOutput(output) ? output.value : 0,
            address: output.decoded.address,
            token: output.token,
            value: output.value,
            timelock: output.decoded.timelock,
            height: output.height||null,
          });
        }
      }
      for (const input of tx.inputs) {
        // If this is not
        if (!(input.decoded.address && (await this.addressExists(input.decoded.address)))) continue;

        // create if not exists
        if (!addressesMetadata.has(input.decoded.address)) {
          addressesMetadata.set(input.decoded.address, { numTransactions: 0, balance: new Map() });
        }
        if (!addressesMetadata.get(input.decoded.address)!.balance.has(input.token)) {
          addressesMetadata.get(input.decoded.address)!.balance.set(input.token, getEmptyBalance());
        }
        if (!tokensMetadata.has(input.token)) {
          tokensMetadata.set(input.token, { numTransactions: 0, balance: getEmptyBalance() });
        }

        // update metadata
        addressesMetadata.get(input.decoded.address)!.numTransactions += 1;
        allTokens.add(input.token);
        tokensMetadata.get(input.token)!.numTransactions += 1;

        // check index
        if (this.addresses.get(input.decoded.address)!.bip32AddressIndex > maxIndexUsed) {
          maxIndexUsed = this.addresses.get(input.decoded.address)!.bip32AddressIndex;
        }

        const isAuthority: boolean = transaction.isAuthorityOutput(input);

        if (isAuthority) {
          if (transaction.isMint(input)) {
            tokensMetadata.get(input.token)!.balance.authorities.mint.unlocked -= 1;
            addressesMetadata.get(input.decoded.address)!.balance.get(input.token)!.authorities.mint.unlocked -= 1;
          }
          if (transaction.isMelt(input)) {
            tokensMetadata.get(input.token)!.balance.authorities.melt.unlocked -= 1;
            addressesMetadata.get(input.decoded.address)!.balance.get(input.token)!.authorities.melt.unlocked -= 1;
          }
        } else {
          tokensMetadata.get(input.token)!.balance.tokens.unlocked -= input.value;
          addressesMetadata.get(input.decoded.address)!.balance.get(input.token)!.tokens.unlocked -= input.value;
        }
      }
    }

    if (this.walletData.lastUsedAddressIndex < maxIndexUsed) {
      if (this.walletData.currentAddressIndex < maxIndexUsed) {
        this.walletData.currentAddressIndex = Math.min(maxIndexUsed + 1, this.walletData.lastLoadedAddressIndex);
      }
      this.walletData.lastUsedAddressIndex = maxIndexUsed;
    }

    for (const uid of allTokens) {
      const tokenInfo = this.tokens.get(uid);
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
        this.tokens.set(uid, tokenData);
      }
    }

    this.tokensMetadata = tokensMetadata;
    this.addressesMetadata = addressesMetadata;
    this.utxos = utxos;
  }

  async saveTx(tx: IStorageTx): Promise<void> {
    this.history.set(tx.tx_id, tx);

    let maxIndex = this.walletData.lastUsedAddressIndex;
    for (const el of [...tx.inputs, ...tx.outputs]) {
      if (el.decoded.address && (await this.addressExists(el.decoded.address))) {
        const index = this.addresses.get(el.decoded.address)!.bip32AddressIndex;
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    }
    if (this.walletData.currentAddressIndex < maxIndex) {
      this.walletData.currentAddressIndex = Math.min(maxIndex + 1, this.walletData.lastLoadedAddressIndex);
    }
    this.walletData.lastUsedAddressIndex = maxIndex;
  }

  async getTx(txId: string): Promise<IStorageTx | null> {
    return this.history.get(txId) || null;
  }

  /** TOKENS */

  async *tokenIter(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>> {
    for (const tokenInfo of this.tokens.values()) {
      const tokenMeta = this.tokensMetadata.get(tokenInfo.uid);
      yield {...tokenInfo, ...tokenMeta};
    }
  }

  async getToken(tokenUid: string): Promise<(IStorageToken & Partial<IStorageTokenMetadata>)|null> {
    const tokenConfig = this.tokens.get(tokenUid);
    if (tokenConfig === undefined) {
      return null;
    }
    const tokenMeta = this.tokensMetadata.get(tokenUid);
    if (tokenMeta === undefined) {
      throw new Error('configuration error: missing token metadata');
    }
    return {...tokenConfig, ...tokenMeta};
  }

  async saveToken(tokenConfig: IStorageToken, meta?: IStorageTokenMetadata | undefined): Promise<void> {
    if (this.tokens.has(tokenConfig.uid)) {
      throw new Error('Already have this token');
    }
    this.tokens.set(tokenConfig.uid, tokenConfig);
    if (meta !== undefined) {
      this.tokensMetadata.set(tokenConfig.uid, meta);
    }
  }

  async *registeredTokenIter(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>> {
    for (const tokenConfig of this.registeredTokens.values()) {
      const tokenMeta = this.tokensMetadata.get(tokenConfig.uid);
      yield {...tokenConfig, ...tokenMeta};
    }
  }

  async registerToken(token: IStorageToken): Promise<void> {
    this.registeredTokens.set(token.uid, token);
  }

  async unregisterToken(tokenUid: string): Promise<void> {
    this.registeredTokens.delete(tokenUid);
  }

  async deleteTokens(tokens: string[]): Promise<void> {
    for (const tokenUid of tokens) {
      this.tokens.delete(tokenUid);
      this.tokensMetadata.delete(tokenUid);
    }
  }

  async editToken(tokenUid: string, meta: IStorageTokenMetadata): Promise<void> {
    if (this.tokensMetadata.has(tokenUid)) {
      this.tokensMetadata.set(tokenUid, meta);
    }
  }

  /** UTXOS */
  async *utxoIter(): AsyncGenerator<IStorageUTXO, any, unknown> {
    for (const utxo of this.utxos.values()) {
      yield utxo;
    }
  }

  async *selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IStorageUTXO> {
    const token = options.token || '00';
    const authorities = options.authorities || 0;
    const maxUtxos = options.max_utxos || 255; // MAX_INPUTS
    if (options.max_amount && options.target_amount) {
      throw new Error('invalid options');
    }

    let sumAmount = 0;
    let utxoNum = 0;

    for (const utxo of this.utxos.values()) {
      let authority_match: boolean;
      if (authorities === 0) {
        authority_match = utxo.authorities === 0;
      } else {
        authority_match = (utxo.authorities & authorities) > 0;
      }
      if (
        (options.filter_method && !options.filter_method(utxo))
        || (options.amount_bigger_than && utxo.value <= options.amount_bigger_than)
        || (options.amount_smaller_than && utxo.value >= options.amount_smaller_than)
        || (options.filter_address && utxo.address !== options.filter_address)
        || (!authority_match)
        || (utxo.token !== token)
      ) {
        // This utxo has failed a filter constraint
        continue;
      }

      if (options.max_amount && (sumAmount + utxo.value) > options.max_amount) {
        // If this utxo is returned we would pass the max_amount
        // XXX: We could also return to stop iteration early
        // This ensures we have the closest to max_amount
        continue;
      }

      yield utxo;

      utxoNum += 1;
      sumAmount += utxo.value;
      if ((options.target_amount && sumAmount >= options.target_amount) || (utxoNum >= maxUtxos)) {
        // We have reached either the target amount or the max number of utxos requested
        return;
      }
    }
  }

  async saveUtxo(utxo: IStorageUTXO): Promise<void> {
    this.utxos.set(`${utxo.txId}:${utxo.index}`, utxo);
  }

  /** ACCESS DATA */

  async saveAccessData(data: IStorageAccessData): Promise<void> {
    this.accessData = data;
  }

  async getAccessData(): Promise<IStorageAccessData|null> {
    if (this.accessData === null) {
      throw new Error('Wallet access data unset');
    }
    return this.accessData;
  }

  async getLastLoadedAddressIndex(): Promise<number> {
    return this.walletData.lastLoadedAddressIndex;
  }

  async getLastUsedAddressIndex(): Promise<number> {
    return this.walletData.lastUsedAddressIndex;
  }

  async setCurrentHeight(height: number): Promise<void> {
    this.walletData.bestBlockHeight = height;
  }

  async getCurrentHeight(): Promise<number> {
    return this.walletData.bestBlockHeight;
  }

  async getWalletData(): Promise<IStorageWalletData> {
    return this.walletData;
  }

  async getItem(key: string): Promise<any> {
    return this.genericStorage[key];
  }

  async setItem(key: string, value: any): Promise<void> {
    this.genericStorage[key] = value;
  }

  async cleanStorage(cleanHistory: boolean = false): Promise<void> {
    this.accessData = null;
    if (cleanHistory) {
      // this.addresses = new Map<string, IStorageAddress>();
      // this.addressIndexes = new Map<number, string>();
      // this.addressesMetadata = new Map<string, IStorageAddressMetadata>();
      this.tokens = new Map<string, IStorageToken>();
      this.tokensMetadata = new Map<string, IStorageTokenMetadata>();
      this.registeredTokens = new Map<string, IStorageToken>();
      this.history = new Map<string, IStorageTx>();
      this.utxos = new Map<string, IStorageUTXO>();
      // wallet data will be kept
    }
  }
}