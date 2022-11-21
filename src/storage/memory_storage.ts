/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage, IStorageAddress, IStorageToken, IStorageTokenMetadata, IStorageTx, IStorageUTXO, IStorageWalletData, IUtxoFilterOptions } from '../types';

export class MemoryStorage implements IStorage {
  addresses: Map<string, IStorageAddress>;
  addressIndexes: Map<string, number>;
  tokens: Map<string, IStorageToken>;
  tokensMetadata: Map<string, IStorageTokenMetadata>;
  registeredTokens: Map<string, IStorageToken>;
  history: Map<string, IStorageTx>;
  utxos: Map<string, IStorageUTXO>;
  walletData: IStorageWalletData|null;
  data: Map<string, any>;
  genericStorage: Record<string, any>;

  constructor() {
    this.addresses = new Map<string, IStorageAddress>();
    this.addressIndexes = new Map<string, number>();
    this.tokens = new Map<string, IStorageToken>();
    this.tokensMetadata = new Map<string, IStorageTokenMetadata>();
    this.registeredTokens = new Map<string, IStorageToken>();
    this.history = new Map<string, IStorageTx>();
    this.utxos = new Map<string, IStorageUTXO>();
    this.walletData = null;
    this.genericStorage = {};

    const defaultWalletData = {
      'wallet:last-loaded-address-index': 0,
      'wallet:last-used-address-index': 0,
    };

    this.data = new Map<string, any>(Object.entries(defaultWalletData));
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

  async getAddressAtIndex(index: number): Promise<IStorageAddress> {
    if (index > await this.getLastLoadedAddressIndex()) {
      // We do not have this index loaded on storage, it should be generated instead
      throw new Error('index not loaded');
    }
    for await (const addr of this.addressIter()) {
      if (addr.bip32AddressIndex === index) {
        return addr;
      }
    }

    throw new Error('address not found');
  }

  async saveAddress(info: IStorageAddress): Promise<void> {
    if (!info.base58) {
      throw new Error('Invalid address');
    }
    if (this.addresses.has(info.base58)) {
      throw new Error('Already have this address');
    }

    const gtAddrIndex = 
    // Saving address info
    this.addresses.set(info.base58, info);
  }

  async updateAddress(base58: string, options: { numTransactions: number; }): Promise<void> {
    const address = this.addresses.get(base58);
    if (address === undefined) {
      throw new Error('Address does not exist.');
    }
    address.numTransactions = options.numTransactions;
  }

  async addressExists(base58: string): Promise<boolean> {
    return this.addresses.has(base58);
  }

  /* TRANSACTIONS */

  async *historyIter(tokenUid?: string | undefined): AsyncGenerator<IStorageTx> {
    for (const tx of this.history.values()) {
      if (tokenUid !== undefined) {
        // If a tokenUid is passed, we only yield the transaction if it has the token
        // XXX: should we only yield if the token is in a wallet address?
        const tokens = new Set();
        for (const input of tx.inputs) {
          tokens.add(input.token);
        }
        for (const output of tx.outputs) {
          tokens.add(output.token);
        }
        // check if token is on the transaction
        if (!tokens.has(tokenUid)) {
          continue;
        }
      }
      yield tx;
    }
  }

  async saveTx(tx: IStorageTx): Promise<void> {
    this.history.set(tx.tx_id, tx);
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
      if (
        (options.amount_bigger_than && utxo.value <= options.amount_bigger_than)
        || (options.amount_smaller_than && utxo.value >= options.amount_smaller_than)
        || (options.filter_address && utxo.address !== options.filter_address)
        || (utxo.authorities !== authorities)
        || (utxo.token !== token)
      ) {
        // This utxo has failed a filter constraint
        continue;
      }

      sumAmount += utxo.value;
      if (options.max_amount && sumAmount > options.max_amount) {
        // If this utxo is returned we would pass the max_amount
        // XXX: We could also return to stop iteration early
        // This ensures we have the closest to max_amount
        continue;
      }

      yield utxo;
      
      utxoNum += 1;
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

  async saveAccessData(data: IStorageWalletData): Promise<void> {
    if (this.walletData !== null) {
      throw new Error('Wallet data already set');
    }
    this.walletData = data;
  }

  async getAccessData(): Promise<IStorageWalletData|null> {
    if (this.walletData === null) {
      throw new Error('Wallet access data unset');
    }
    return this.walletData;
  }

  async getLastLoadedAddressIndex(): Promise<number> {
    return this.data.get('wallet:last-loaded-address-index') as number;
  }

  async getLastUsedAddressIndex(): Promise<number> {
    return this.data.get('wallet:last-used-address-index') as number;
  }

  async getItem(key: string): Promise<any> {
    return this.genericStorage[key];
  }

  async setItem(key: string, value: any): Promise<void> {
    this.genericStorage[key] = value;
  }
}