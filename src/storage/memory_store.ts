/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { orderBy, cloneDeep } from 'lodash';
import {
  IStore,
  IAddressInfo,
  ITokenData,
  ITokenMetadata,
  IHistoryTx,
  IUtxo,
  IWalletAccessData,
  isGapLimitScanPolicy,
  IUtxoFilterOptions,
  IAddressMetadata,
  IWalletData,
  ILockedUtxo,
  AddressScanPolicy,
  AddressScanPolicyData,
  IIndexLimitAddressScanPolicy,
  SCANNING_POLICY,
  INcData,
} from '../types';
import { GAP_LIMIT, NATIVE_TOKEN_UID } from '../constants';
import transactionUtils from '../utils/transaction';

const DEFAULT_ADDRESSES_WALLET_DATA = {
  lastLoadedAddressIndex: 0,
  lastUsedAddressIndex: -1,
  currentAddressIndex: -1,
};

const DEFAULT_SCAN_POLICY_DATA: AddressScanPolicyData = {
  policy: SCANNING_POLICY.GAP_LIMIT,
  gapLimit: GAP_LIMIT,
};

const DEFAULT_WALLET_DATA = {
  bestBlockHeight: 0,
  scanPolicyData: DEFAULT_SCAN_POLICY_DATA,
};

/**
 * Get the ordering key for a transaction.
 * This will be used to sort the transactions by timestamp.
 *
 * @param {Pick<IHistoryTx, 'timestamp'|'tx_id'>} tx The transaction, at least with timestamp and tx_id
 * @returns {string} The ordering key for the transaction
 * @example
 * // returns '0000000f:cafe'
 * getOrderingKey({ tx_id: 'cafe', timestamp: 15 });
 * @example
 * // returns '5fbec5d0:abcdef'
 * getOrderingKey({ tx_id: 'abcdef', timestamp: 1606338000 });
 */
function getOrderingKey(tx: Pick<IHistoryTx, 'timestamp' | 'tx_id'>): string {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(tx.timestamp, 0);
  return `${buf.toString('hex')}:${tx.tx_id}`;
}

/**
 * Get the parts of the ordering key.
 * This is meant to be used to decode the ordering key
 * so we can fetch the transaction from the storage.
 *
 * @param {string} key The ordering key of a transaction
 * @returns {{ timestamp: number, txId: string }}
 * @example
 * // returns { timestamp: 15, txId: 'cafe' }
 * getPartsFromOrderingKey('0000000f:cafe');
 * @example
 * // returns { timestamp: 1606338000, txId: 'abcdef' }
 * getPartsFromOrderingKey('5fbec5d0:abcdef');
 */
function getPartsFromOrderingKey(key: string): { timestamp: number; txId: string } {
  const parts = key.split(':');
  const buf = Buffer.from(parts[0], 'hex');
  return {
    timestamp: buf.readUInt32BE(0),
    txId: parts[1],
  };
}

export class MemoryStore implements IStore {
  /**
   * Map<base58, IAddressInfo>
   * where base58 is the address in base58
   */
  addresses: Map<string, IAddressInfo>;

  /**
   * Map<index, base58>
   * where index is the address index and base58 is the address in base58
   */
  addressIndexes: Map<number, string>;

  /**
   * Map<base58, IAddressMetadata>
   * where base58 is the address in base58
   */
  addressesMetadata: Map<string, IAddressMetadata>;

  /**
   * Map<uid, ITokenData>
   * where uid is the token uid in hex
   */
  tokens: Map<string, ITokenData>;

  /**
   * Map<uid, ITokenMetadata>
   * where uid is the token uid in hex
   */
  tokensMetadata: Map<string, ITokenMetadata>;

  /**
   * Map<uid, ITokenData>
   * where uid is the token uid in hex
   */
  registeredTokens: Map<string, ITokenData>;

  /**
   * Map<ncId, INcData>
   * where ncId is the nano contract id in hex
   */
  registeredNanoContracts: Map<string, INcData>;

  /**
   * Map<txId, IHistoryTx>
   * where txId is the transaction id in hex
   */
  history: Map<string, IHistoryTx>;

  /**
   * Array of `<timestamp>:<txId>` strings, which should be always sorted.
   * `timestamp` should be in uint32 representation
   * This will force the items to be ordered by timestamp.
   */
  historyTs: string[];

  /**
   * Map<utxoid, IUtxo>
   * where utxoid is the txId + index, a string representation of IUtxoId
   */
  utxos: Map<string, IUtxo>;

  /**
   * Wallet access data
   */
  accessData: IWalletAccessData | null;

  /**
   * Wallet metadata
   */
  walletData: IWalletData;

  /**
   * Generic storage for any other data
   */
  genericStorage: Record<string, any>;

  lockedUtxos: Map<string, ILockedUtxo>;

  constructor() {
    this.addresses = new Map<string, IAddressInfo>();
    this.addressIndexes = new Map<number, string>();
    this.addressesMetadata = new Map<string, IAddressMetadata>();
    this.tokens = new Map<string, ITokenData>();
    this.tokensMetadata = new Map<string, ITokenMetadata>();
    this.registeredTokens = new Map<string, ITokenData>();
    this.history = new Map<string, IHistoryTx>();
    this.historyTs = [];
    this.utxos = new Map<string, IUtxo>();
    this.accessData = null;
    this.genericStorage = {};
    this.lockedUtxos = new Map<string, ILockedUtxo>();
    this.registeredNanoContracts = new Map<string, INcData>();

    this.walletData = cloneDeep({ ...DEFAULT_WALLET_DATA, ...DEFAULT_ADDRESSES_WALLET_DATA });
  }

  // eslint-disable-next-line class-methods-use-this
  async validate(): Promise<void> {
    // This is a noop since the memory store always starts clean.
  }

  /** ADDRESSES */

  /**
   * Iterate on all addresses
   *
   * @async
   * @returns {AsyncGenerator<IAddressInfo>}
   */
  async *addressIter(): AsyncGenerator<IAddressInfo, any, unknown> {
    for (const addrInfo of this.addresses.values()) {
      yield addrInfo;
    }
  }

  /**
   * Get the address info if it exists.
   *
   * @param {string} base58 Address in base58 to search
   * @async
   * @returns {Promise<IAddressInfo | null>} A promise with the address info or null if not in storage
   */
  async getAddress(base58: string): Promise<IAddressInfo | null> {
    return this.addresses.get(base58) || null;
  }

  /**
   * Get the metadata for an address if it exists.
   *
   * @param {string} base58 Address in base58 to search the metadata
   * @async
   * @returns {Promise<IAddressMetadata | null>} A promise with the address metadata or null if not in storage
   */
  async getAddressMeta(base58: string): Promise<IAddressMetadata | null> {
    return this.addressesMetadata.get(base58) || null;
  }

  /**
   * Count the number of addresses in storage.
   * @async
   * @returns {Promise<number>} A promise with the number of addresses
   */
  async addressCount(): Promise<number> {
    return this.addresses.size;
  }

  /**
   * Get the address info from its bip32 index.
   * @param index bip32 address index to search for
   * @async
   * @returns {Promise<IAddressInfo | null>} The address info or null if not in storage
   */
  async getAddressAtIndex(index: number): Promise<IAddressInfo | null> {
    const addr = this.addressIndexes.get(index);
    if (addr === undefined) {
      // We do not have this index loaded on storage, it should be generated instead
      return null;
    }
    return this.addresses.get(addr) as IAddressInfo;
  }

  /**
   * Save the address in storage
   * @param {IAddressInfo} info Info on address to save
   * @async
   * @returns {Promise<void>}
   */
  async saveAddress(info: IAddressInfo): Promise<void> {
    if (!info.base58) {
      throw new Error('Invalid address');
    }
    if (this.addresses.has(info.base58)) {
      throw new Error('Already have this address');
    }

    // Saving address info
    this.addresses.set(info.base58, info);
    this.addressIndexes.set(info.bip32AddressIndex, info.base58);

    if (this.walletData.currentAddressIndex === -1) {
      this.walletData.currentAddressIndex = info.bip32AddressIndex;
    }

    if (info.bip32AddressIndex > this.walletData.lastLoadedAddressIndex) {
      this.walletData.lastLoadedAddressIndex = info.bip32AddressIndex;
    }
  }

  /**
   * Check that an address is in our storage.
   * @param {string} base58 Address to check.
   * @async
   * @returns A promise that resolves to wheather the address is saved in storage or no.
   */
  async addressExists(base58: string): Promise<boolean> {
    return this.addresses.has(base58);
  }

  /**
   * Get the current address.
   *
   * @param {boolean | undefined} markAsUsed If we should set the next address as current
   * @async
   * @returns {Promise<string>} The address in base58 format
   */
  async getCurrentAddress(markAsUsed?: boolean): Promise<string> {
    const addressInfo = await this.getAddressAtIndex(this.walletData.currentAddressIndex);
    if (!addressInfo) {
      throw new Error('Current address is not loaded');
    }

    if (markAsUsed) {
      // Will move the address index only if we have not reached the gap limit
      this.walletData.currentAddressIndex = Math.min(
        this.walletData.lastLoadedAddressIndex,
        this.walletData.currentAddressIndex + 1
      );
    }
    return addressInfo.base58;
  }

  /**
   * Set the value of the current address index.
   * @param {number} index The index to set
   */
  async setCurrentAddressIndex(index: number): Promise<void> {
    this.walletData.currentAddressIndex = index;
  }

  /**
   * Edit address metadata.
   *
   * @param {string} base58 The address in base58 format
   * @param {IAddressMetadata} meta The metadata to save
   */
  async editAddressMeta(base58: string, meta: IAddressMetadata): Promise<void> {
    this.addressesMetadata.set(base58, meta);
  }

  /* TRANSACTIONS */

  /**
   * Iterate on the transaction history ordered by timestamp.
   *
   * @param {string|undefined} tokenUid Only yield txs with this token.
   *
   * @async
   * @returns {AsyncGenerator<IHistoryTx>}
   */
  async *historyIter(tokenUid?: string | undefined): AsyncGenerator<IHistoryTx> {
    /**
     * We iterate in reverse order so the most recent transactions are yielded first.
     * This is to maintain the behavior in the wallets and allow the user to see the most recent transactions first.
     */
    for (let i = this.historyTs.length - 1; i >= 0; i -= 1) {
      const orderKey = this.historyTs[i];
      const { txId } = getPartsFromOrderingKey(orderKey);
      const tx = this.history.get(txId);
      if (!tx) {
        // This should never happen since any transactions in historyTs should also be in history
        throw new Error('Transaction not found');
      }

      if (tokenUid === undefined) {
        yield tx;
        continue;
      }

      // If a tokenUid is passed, we only yield the transaction if it has the token in one of our addresses
      let found = false;
      for (const input of tx.inputs) {
        if (
          input.decoded.address &&
          this.addresses.has(input.decoded.address) &&
          input.token === tokenUid
        ) {
          found = true;
          break;
        }
      }
      if (found) {
        yield tx;
        continue;
      }
      for (const output of tx.outputs) {
        if (
          output.decoded.address &&
          this.addresses.has(output.decoded.address) &&
          output.token === tokenUid
        ) {
          found = true;
          break;
        }
      }
      if (found) {
        yield tx;
        continue;
      }
    }
  }

  /**
   * Get the size of the transaction history.
   *
   * @returns {Promise<number>} The size of the transaction history
   */
  async historyCount(): Promise<number> {
    return this.history.size;
  }

  /**
   * Save a transaction on storage.
   * @param {IHistoryTx} tx The transaction to store
   * @async
   * @returns {Promise<void>}
   */
  async saveTx(tx: IHistoryTx): Promise<void> {
    // Protect ordering list from updates on the same transaction
    // We can check the historyTs but it's O(n) and this check is O(1).
    if (!this.history.has(tx.tx_id)) {
      // Add transaction to the ordering list and sort it
      // Wallets expect to show users the transactions in order of descending timestamp
      // This is so wallets can show the most recent transactions to users
      // XXX: If this becomes a performance bottleneck we can either allow wallets to skip ordering
      // or have the ordering be done during history processing so that
      // we don't have to sort the list every time we add a new transaction
      this.historyTs.push(getOrderingKey(tx));
      this.historyTs.sort();
    }

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
      this.walletData.currentAddressIndex = Math.min(
        maxIndex + 1,
        this.walletData.lastLoadedAddressIndex
      );
    }
    this.walletData.lastUsedAddressIndex = maxIndex;
  }

  /**
   * Fetch a transaction in the storage by its id.
   * @param txId The transaction id
   * @async
   * @returns {Promise<IHistoryTx | null>} A promise with the transaction or null
   */
  async getTx(txId: string): Promise<IHistoryTx | null> {
    return this.history.get(txId) || null;
  }

  /** TOKENS */

  /**
   * Iterate on tokens with the available metadata
   *
   * @async
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  async *tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for (const tokenInfo of this.tokens.values()) {
      const tokenMeta = this.tokensMetadata.get(tokenInfo.uid);
      yield { ...tokenInfo, ...tokenMeta };
    }
  }

  /**
   * Get a token on storage from the uid
   * @param tokenUid The token id to fetch
   * @returns {Promise<(ITokenData & Partial<ITokenMetadata>) | null>} The token data if present
   */
  async getToken(tokenUid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null> {
    const tokenConfig = this.tokens.get(tokenUid);
    if (tokenConfig === undefined) {
      return null;
    }
    const DEFAULT_TOKEN_META: ITokenMetadata = {
      numTransactions: 0,
      balance: {
        tokens: { unlocked: 0, locked: 0 },
        authorities: {
          mint: { unlocked: 0, locked: 0 },
          melt: { unlocked: 0, locked: 0 },
        },
      },
    };
    const tokenMeta = this.tokensMetadata.get(tokenUid);

    return { ...tokenConfig, ...DEFAULT_TOKEN_META, ...tokenMeta };
  }

  /**
   * Fetch the token metadata from the storage.
   *
   * @param {string} tokenUid The token id to fetch metadata.
   * @returns {Promise<ITokenMetadata | null>} The token metadata if present
   */
  async getTokenMeta(tokenUid: string): Promise<ITokenMetadata | null> {
    const tokenMeta = this.tokensMetadata.get(tokenUid);
    if (tokenMeta === undefined) {
      return null;
    }
    return tokenMeta;
  }

  /**
   * Save a token on storage
   * @param {ITokenData} tokenConfig Token config
   * @param {ITokenMetadata|undefined} [meta] The token metadata
   * @async
   * @returns {Promise<void>}
   */
  async saveToken(tokenConfig: ITokenData, meta?: ITokenMetadata | undefined): Promise<void> {
    if (this.tokens.has(tokenConfig.uid)) {
      throw new Error('Already have this token');
    }
    this.tokens.set(tokenConfig.uid, tokenConfig);
    if (meta !== undefined) {
      this.tokensMetadata.set(tokenConfig.uid, meta);
    }
  }

  /**
   * Iterate on registered tokens.
   *
   * @async
   * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
   */
  async *registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>> {
    for (const tokenConfig of this.registeredTokens.values()) {
      const tokenMeta = this.tokensMetadata.get(tokenConfig.uid);
      yield { ...tokenConfig, ...tokenMeta };
    }
  }

  /**
   * Register a token.
   *
   * Obs: we require the token data because the token being registered may not be on our storage yet.
   *
   * @param token Token config to register
   * @async
   * @returns {Promise<void>}
   */
  async registerToken(token: ITokenData): Promise<void> {
    this.registeredTokens.set(token.uid, token);
  }

  /**
   * Unregister a token.
   *
   * @param {string} tokenUid Token id
   * @async
   * @returns {Promise<void>}
   */
  async unregisterToken(tokenUid: string): Promise<void> {
    this.registeredTokens.delete(tokenUid);
  }

  /**
   * Return if a token uid is registered or not.
   *
   * @param {string} tokenUid - Token id
   * @returns {Promise<boolean>}
   */
  async isTokenRegistered(tokenUid: string): Promise<boolean> {
    return this.registeredTokens.has(tokenUid);
  }

  /**
   * Edit token metadata on storage.
   * @param {string} tokenUid Token id to edit
   * @param {Partial<ITokenMetadata>} meta Metadata to save
   * @returns {Promise<void>}
   */
  async editTokenMeta(tokenUid: string, meta: ITokenMetadata): Promise<void> {
    this.tokensMetadata.set(tokenUid, meta);
  }

  /** UTXOS */

  /**
   * Iterate on all available utxos.
   * @async
   * @returns {AsyncGenerator<IUtxo>}
   */
  async *utxoIter(): AsyncGenerator<IUtxo, any, unknown> {
    for (const utxo of this.utxos.values()) {
      yield utxo;
    }
  }

  /**
   * Fetch utxos based on a selection criteria
   * @param {IUtxoFilterOptions} options Options to filter utxos
   * @async
   * @returns {AsyncGenerator<IUtxo>}
   */
  async *selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IUtxo> {
    const networkHeight = await this.getCurrentHeight();
    const nowTs = Math.floor(Date.now() / 1000);
    const isTimeLocked = (timestamp: number) => !!timestamp && nowTs < timestamp;
    const isHeightLocked = (utxo: IUtxo) => {
      if (!transactionUtils.isBlock({ version: utxo.type })) {
        // Only blocks can be reward locked
        return false;
      }
      return transactionUtils.isHeightLocked(utxo.height, networkHeight, options.reward_lock);
    };
    const isLocked = (utxo: IUtxo) => isTimeLocked(utxo.timelock || 0) || isHeightLocked(utxo);
    const token = options.token || NATIVE_TOKEN_UID;
    const authorities = options.authorities || 0;
    if (options.max_amount && options.target_amount) {
      throw new Error('invalid options');
    }

    let sumAmount = 0;
    let utxoNum = 0;

    // Map.prototype.values() is an iterable but orderBy returns an array
    // Both work with for...of so we can use them interchangeably
    let iter: IterableIterator<IUtxo> | IUtxo[];
    if (options.order_by_value) {
      // Sort by value as requested in options.order_by_value
      iter = orderBy(Array.from(this.utxos.values()), ['value'], [options.order_by_value]);
    } else {
      iter = this.utxos.values();
    }

    for (const utxo of iter) {
      if (options.only_available_utxos && isLocked(utxo)) {
        // Skip locked utxos if we only want available utxos
        continue;
      }
      let authority_match: boolean;
      if (authorities === 0) {
        authority_match = utxo.authorities === 0;
      } else {
        authority_match = (utxo.authorities & authorities) > 0;
      }
      if (
        (options.filter_method && !options.filter_method(utxo)) ||
        (options.amount_bigger_than && utxo.value <= options.amount_bigger_than) ||
        (options.amount_smaller_than && utxo.value >= options.amount_smaller_than) ||
        (options.filter_address && utxo.address !== options.filter_address) ||
        !authority_match ||
        utxo.token !== token
      ) {
        // This utxo has failed a filter constraint
        continue;
      }

      if (options.max_amount && sumAmount + utxo.value > options.max_amount) {
        // If this utxo is returned we would pass the max_amount
        // We continue to ensure we have the closest to max_amount
        continue;
      }

      yield utxo;

      utxoNum += 1;
      if (!isLocked(utxo)) {
        // sumAmount is used to filter for a target_amount and max_amount
        // both only count unlocked utxos.
        sumAmount += utxo.value;
      }
      if (
        (options.target_amount && sumAmount >= options.target_amount) ||
        (options.max_utxos && utxoNum >= options.max_utxos)
      ) {
        // We have reached either the target amount or the max number of utxos requested
        return;
      }
    }
  }

  /**
   * Save an utxo on storage.
   * @param {IUtxo} utxo Utxo to save
   * @async
   * @returns {Promise<void>}
   */
  async saveUtxo(utxo: IUtxo): Promise<void> {
    this.utxos.set(`${utxo.txId}:${utxo.index}`, utxo);
  }

  /**
   * Save a locked utxo.
   * Used when a new utxo is received but it is either time locked or height locked.
   * The locked utxo index will be used to manage the locked utxos.
   *
   * @param {ILockedUtxo} lockedUtxo The locked utxo to be saved
   * @returns {Promise<void>}
   */
  async saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void> {
    this.lockedUtxos.set(`${lockedUtxo.tx.tx_id}:${lockedUtxo.index}`, lockedUtxo);
  }

  /**
   * Iterate over all locked utxos
   * @returns {AsyncGenerator<ILockedUtxo>}
   */
  async *iterateLockedUtxos(): AsyncGenerator<ILockedUtxo> {
    for (const lockedUtxo of this.lockedUtxos.values()) {
      yield lockedUtxo;
    }
  }

  /**
   * Remove an utxo from the locked utxos if it became unlocked.
   *
   * @param lockedUtxo utxo that became unlocked
   * @returns {Promise<void>}
   */
  async unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void> {
    this.lockedUtxos.delete(`${lockedUtxo.tx.tx_id}:${lockedUtxo.index}`);
  }

  /** ACCESS DATA */

  /**
   * Save access data on storage.
   * @param {IWalletAccessData} data Access data to save
   * @async
   * @returns {Promise<void>}
   */
  async saveAccessData(data: IWalletAccessData): Promise<void> {
    this.accessData = data;
  }

  /**
   * Fetch wallet access data on storage if present.
   * @async
   * @returns {Promise<IWalletAccessData | null>} A promise with the wallet access data.
   */
  async getAccessData(): Promise<IWalletAccessData | null> {
    return this.accessData;
  }

  /**
   * Get the last bip32 address index loaded on storage.
   * @async
   * @returns {Promise<number>}
   */
  async getLastLoadedAddressIndex(): Promise<number> {
    return this.walletData.lastLoadedAddressIndex;
  }

  /**
   * Get the last bip32 address index used, i.e. with any transaction.
   * @async
   * @returns {Promise<number>}
   */
  async getLastUsedAddressIndex(): Promise<number> {
    return this.walletData.lastUsedAddressIndex;
  }

  /**
   * Set the current best chain height.
   * @async
   * @param {number} height Height to set.
   */
  async setCurrentHeight(height: number): Promise<void> {
    this.walletData.bestBlockHeight = height;
  }

  /**
   * Set the last bip32 address index used on storage.
   * @param {number} index The index to set as last used address.
   */
  async setLastUsedAddressIndex(index: number): Promise<void> {
    this.walletData.lastUsedAddressIndex = index;
  }

  /**
   * Get the current best chain height.
   * @async
   * @returns {Promise<number>}
   */
  async getCurrentHeight(): Promise<number> {
    return this.walletData.bestBlockHeight;
  }

  /**
   * Set the gap limit for this wallet.
   * @async
   * @param {number} value Gat limit to set.
   */
  async setGapLimit(value: number): Promise<void> {
    if (!this.walletData.scanPolicyData) {
      this.walletData.scanPolicyData = {
        policy: SCANNING_POLICY.GAP_LIMIT,
        gapLimit: value,
      };
      return;
    }

    if (isGapLimitScanPolicy(this.walletData.scanPolicyData)) {
      this.walletData.scanPolicyData.gapLimit = value;
    }
  }

  /**
   * Get the current wallet gap limit.
   * @async
   * @returns {Promise<number>}
   */
  async getGapLimit(): Promise<number> {
    if (isGapLimitScanPolicy(this.walletData.scanPolicyData)) {
      if (!this.walletData.scanPolicyData.gapLimit) {
        this.walletData.scanPolicyData = {
          policy: SCANNING_POLICY.GAP_LIMIT,
          gapLimit: GAP_LIMIT,
        };
      }
      return this.walletData.scanPolicyData.gapLimit;
    }
    // Return default gap limit
    return GAP_LIMIT;
  }

  async getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null> {
    if (this.walletData.scanPolicyData?.policy === SCANNING_POLICY.INDEX_LIMIT) {
      return {
        startIndex: this.walletData?.scanPolicyData?.startIndex || 0,
        endIndex: this.walletData?.scanPolicyData?.endIndex || 0,
      };
    }
    return null;
  }

  /**
   * Get the configured address scanning policy.
   * @async
   * @returns {Promise<AddressScanPolicy>}
   */
  async getScanningPolicy(): Promise<AddressScanPolicy> {
    return this.walletData.scanPolicyData?.policy || SCANNING_POLICY.GAP_LIMIT;
  }

  async setScanningPolicyData(data: AddressScanPolicyData): Promise<void> {
    this.walletData.scanPolicyData = data;
  }

  async getScanningPolicyData(): Promise<AddressScanPolicyData> {
    return this.walletData.scanPolicyData || DEFAULT_SCAN_POLICY_DATA;
  }

  /**
   * Get the wallet data.
   * @async
   * @returns {Promise<IWalletData>}
   */
  async getWalletData(): Promise<IWalletData> {
    return this.walletData;
  }

  /**
   * Get an entry on the generic storage.
   * @param {string} key Key to fetch
   * @async
   * @returns {Promise<any>}
   */
  async getItem(key: string): Promise<any> {
    return this.genericStorage[key];
  }

  /**
   * Set an item on the generic storage.
   *
   * @param {string} key Key to store
   * @param {any} value Value to store
   * @async
   * @returns {Promise<void>}
   */
  async setItem(key: string, value: any): Promise<void> {
    this.genericStorage[key] = value;
  }

  /**
   * Clean the storage.
   * @param {boolean} cleanHistory if we should clean the transaction history.
   * @param {boolean} cleanAddresses if we should clean the addresses.
   * @param {boolean} cleanTokens if we should clean the registered tokens.
   * @async
   * @returns {Promise<void>}
   */
  async cleanStorage(
    cleanHistory: boolean = false,
    cleanAddresses: boolean = false,
    cleanTokens: boolean = false
  ): Promise<void> {
    if (cleanHistory) {
      this.tokens = new Map<string, ITokenData>();
      this.tokensMetadata = new Map<string, ITokenMetadata>();
      this.history = new Map<string, IHistoryTx>();
      this.historyTs = [];
      this.utxos = new Map<string, IUtxo>();
      this.lockedUtxos = new Map<string, ILockedUtxo>();
    }

    if (cleanAddresses) {
      this.addresses = new Map<string, IAddressInfo>();
      this.addressIndexes = new Map<number, string>();
      this.addressesMetadata = new Map<string, IAddressMetadata>();
      this.walletData = { ...this.walletData, ...DEFAULT_ADDRESSES_WALLET_DATA };
    }

    if (cleanTokens) {
      this.registeredTokens = new Map<string, ITokenData>();
      this.registeredNanoContracts = new Map<string, INcData>();
    }
  }

  /**
   * Clean the store metadata.
   *
   * This is used when processing the history to avoid keeping metadata from a voided tx.
   * `processHistory` is additive, so if we don't clean the metadata we are passive to keep stale metadata.
   * This is also true for utxos since processing txs that spent utxos will not remove the utxo from the store.
   *
   * @returns {Promise<void>}
   */
  async cleanMetadata(): Promise<void> {
    this.tokensMetadata = new Map<string, ITokenMetadata>();
    this.addressesMetadata = new Map<string, IAddressMetadata>();
    this.utxos = new Map<string, IUtxo>();
    this.lockedUtxos = new Map<string, ILockedUtxo>();
  }

  /**
   * Return if the nano contract is registered for the given address based on ncId.
   *
   * @param ncId Nano Contract ID.
   * @returns `true` if registered and `false` otherwise.
   * @async
   */
  async isNanoContractRegistered(ncId: string): Promise<boolean> {
    return this.registeredNanoContracts.has(ncId);
  }

  /**
   * Iterate on registered nano contracts.
   *
   * @async
   * @generator
   * @returns {AsyncGenerator<INcData>}
   */
  async *registeredNanoContractsIter(): AsyncGenerator<INcData> {
    for (const ncData of this.registeredNanoContracts.values()) {
      yield ncData;
    }
  }

  /**
   * Get a nano contract data on storage from the ncId.
   *
   * @param ncId Nano Contract ID.
   * @returns Nano contract data instance.
   * @async
   */
  async getNanoContract(ncId: string): Promise<INcData | null> {
    return this.registeredNanoContracts.get(ncId) || null;
  }

  /**
   * Register a nano contract data.
   *
   * @param ncId Nano Contract ID.
   * @param ncValue Nano contract basic information.
   * @async
   */
  async registerNanoContract(ncId: string, ncValue: INcData): Promise<void> {
    this.registeredNanoContracts.set(ncId, ncValue);
  }

  /**
   * Unregister nano contract.
   *
   * @param ncId Nano Contract ID.
   */
  async unregisterNanoContract(ncId: string): Promise<void> {
    this.registeredNanoContracts.delete(ncId);
  }

  /**
   * Update nano contract registered address.
   *
   * @param ncId Nano Contract ID.
   * @param address Nano Contract registered address.
   */
  async updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void> {
    const currentNanoContractData = await this.getNanoContract(ncId);
    if (currentNanoContractData !== null) {
      this.registeredNanoContracts.set(ncId, Object.assign(currentNanoContractData, { address }));
    }
  }
}
