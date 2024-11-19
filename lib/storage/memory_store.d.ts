/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { IStore, IAddressInfo, ITokenData, ITokenMetadata, IHistoryTx, IUtxo, IWalletAccessData, IUtxoFilterOptions, IAddressMetadata, IWalletData, ILockedUtxo, AddressScanPolicy, AddressScanPolicyData, IIndexLimitAddressScanPolicy, INcData } from '../types';
export declare class MemoryStore implements IStore {
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
    genericStorage: Record<string, unknown>;
    lockedUtxos: Map<string, ILockedUtxo>;
    constructor();
    validate(): Promise<void>;
    /**
     * Prepare the store for history processing.
     */
    preProcessHistory(): Promise<void>;
    /** ADDRESSES */
    /**
     * Iterate on all addresses
     *
     * @async
     * @returns {AsyncGenerator<IAddressInfo>}
     */
    addressIter(): AsyncGenerator<IAddressInfo, void, void>;
    /**
     * Get the address info if it exists.
     *
     * @param {string} base58 Address in base58 to search
     * @async
     * @returns {Promise<IAddressInfo | null>} A promise with the address info or null if not in storage
     */
    getAddress(base58: string): Promise<IAddressInfo | null>;
    /**
     * Get the metadata for an address if it exists.
     *
     * @param {string} base58 Address in base58 to search the metadata
     * @async
     * @returns {Promise<IAddressMetadata | null>} A promise with the address metadata or null if not in storage
     */
    getAddressMeta(base58: string): Promise<IAddressMetadata | null>;
    /**
     * Count the number of addresses in storage.
     * @async
     * @returns {Promise<number>} A promise with the number of addresses
     */
    addressCount(): Promise<number>;
    /**
     * Get the address info from its bip32 index.
     * @param index bip32 address index to search for
     * @async
     * @returns {Promise<IAddressInfo | null>} The address info or null if not in storage
     */
    getAddressAtIndex(index: number): Promise<IAddressInfo | null>;
    /**
     * Save the address in storage
     * @param {IAddressInfo} info Info on address to save
     * @async
     * @returns {Promise<void>}
     */
    saveAddress(info: IAddressInfo): Promise<void>;
    /**
     * Check that an address is in our storage.
     * @param {string} base58 Address to check.
     * @async
     * @returns A promise that resolves to wheather the address is saved in storage or no.
     */
    addressExists(base58: string): Promise<boolean>;
    /**
     * Get the current address.
     *
     * @param {boolean | undefined} markAsUsed If we should set the next address as current
     * @async
     * @returns {Promise<string>} The address in base58 format
     */
    getCurrentAddress(markAsUsed?: boolean): Promise<string>;
    /**
     * Set the value of the current address index.
     * @param {number} index The index to set
     */
    setCurrentAddressIndex(index: number): Promise<void>;
    /**
     * Edit address metadata.
     *
     * @param {string} base58 The address in base58 format
     * @param {IAddressMetadata} meta The metadata to save
     */
    editAddressMeta(base58: string, meta: IAddressMetadata): Promise<void>;
    /**
     * Iterate on the transaction history ordered by timestamp.
     *
     * @param {string|undefined} tokenUid Only yield txs with this token.
     *
     * @async
     * @returns {AsyncGenerator<IHistoryTx>}
     */
    historyIter(tokenUid?: string | undefined): AsyncGenerator<IHistoryTx>;
    /**
     * Get the size of the transaction history.
     *
     * @returns {Promise<number>} The size of the transaction history
     */
    historyCount(): Promise<number>;
    /**
     * Save a transaction on storage.
     * @param {IHistoryTx} tx The transaction to store
     * @async
     * @returns {Promise<void>}
     */
    saveTx(tx: IHistoryTx): Promise<void>;
    /**
     * Fetch a transaction in the storage by its id.
     * @param txId The transaction id
     * @async
     * @returns {Promise<IHistoryTx | null>} A promise with the transaction or null
     */
    getTx(txId: string): Promise<IHistoryTx | null>;
    /** TOKENS */
    /**
     * Iterate on tokens with the available metadata
     *
     * @async
     * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
     */
    tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    /**
     * Get a token on storage from the uid
     * @param tokenUid The token id to fetch
     * @returns {Promise<(ITokenData & Partial<ITokenMetadata>) | null>} The token data if present
     */
    getToken(tokenUid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
    /**
     * Fetch the token metadata from the storage.
     *
     * @param {string} tokenUid The token id to fetch metadata.
     * @returns {Promise<ITokenMetadata | null>} The token metadata if present
     */
    getTokenMeta(tokenUid: string): Promise<ITokenMetadata | null>;
    /**
     * Save a token on storage
     * @param {ITokenData} tokenConfig Token config
     * @param {ITokenMetadata|undefined} [meta] The token metadata
     * @async
     * @returns {Promise<void>}
     */
    saveToken(tokenConfig: ITokenData, meta?: ITokenMetadata | undefined): Promise<void>;
    /**
     * Iterate on registered tokens.
     *
     * @async
     * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
     */
    registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    /**
     * Register a token.
     *
     * Obs: we require the token data because the token being registered may not be on our storage yet.
     *
     * @param token Token config to register
     * @async
     * @returns {Promise<void>}
     */
    registerToken(token: ITokenData): Promise<void>;
    /**
     * Unregister a token.
     *
     * @param {string} tokenUid Token id
     * @async
     * @returns {Promise<void>}
     */
    unregisterToken(tokenUid: string): Promise<void>;
    /**
     * Return if a token uid is registered or not.
     *
     * @param {string} tokenUid - Token id
     * @returns {Promise<boolean>}
     */
    isTokenRegistered(tokenUid: string): Promise<boolean>;
    /**
     * Edit token metadata on storage.
     * @param {string} tokenUid Token id to edit
     * @param {Partial<ITokenMetadata>} meta Metadata to save
     * @returns {Promise<void>}
     */
    editTokenMeta(tokenUid: string, meta: ITokenMetadata): Promise<void>;
    /** UTXOS */
    /**
     * Iterate on all available utxos.
     * @async
     * @returns {AsyncGenerator<IUtxo>}
     */
    utxoIter(): AsyncGenerator<IUtxo, void, void>;
    /**
     * Fetch utxos based on a selection criteria
     * @param {IUtxoFilterOptions} options Options to filter utxos
     * @async
     * @returns {AsyncGenerator<IUtxo>}
     */
    selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IUtxo>;
    /**
     * Save an utxo on storage.
     * @param {IUtxo} utxo Utxo to save
     * @async
     * @returns {Promise<void>}
     */
    saveUtxo(utxo: IUtxo): Promise<void>;
    /**
     * Save a locked utxo.
     * Used when a new utxo is received but it is either time locked or height locked.
     * The locked utxo index will be used to manage the locked utxos.
     *
     * @param {ILockedUtxo} lockedUtxo The locked utxo to be saved
     * @returns {Promise<void>}
     */
    saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    /**
     * Iterate over all locked utxos
     * @returns {AsyncGenerator<ILockedUtxo>}
     */
    iterateLockedUtxos(): AsyncGenerator<ILockedUtxo>;
    /**
     * Remove an utxo from the locked utxos if it became unlocked.
     *
     * @param lockedUtxo utxo that became unlocked
     * @returns {Promise<void>}
     */
    unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    /** ACCESS DATA */
    /**
     * Save access data on storage.
     * @param {IWalletAccessData} data Access data to save
     * @async
     * @returns {Promise<void>}
     */
    saveAccessData(data: IWalletAccessData): Promise<void>;
    /**
     * Fetch wallet access data on storage if present.
     * @async
     * @returns {Promise<IWalletAccessData | null>} A promise with the wallet access data.
     */
    getAccessData(): Promise<IWalletAccessData | null>;
    /**
     * Get the last bip32 address index loaded on storage.
     * @async
     * @returns {Promise<number>}
     */
    getLastLoadedAddressIndex(): Promise<number>;
    /**
     * Get the last bip32 address index used, i.e. with any transaction.
     * @async
     * @returns {Promise<number>}
     */
    getLastUsedAddressIndex(): Promise<number>;
    /**
     * Set the current best chain height.
     * @async
     * @param {number} height Height to set.
     */
    setCurrentHeight(height: number): Promise<void>;
    /**
     * Set the last bip32 address index used on storage.
     * @param {number} index The index to set as last used address.
     */
    setLastUsedAddressIndex(index: number): Promise<void>;
    /**
     * Get the current best chain height.
     * @async
     * @returns {Promise<number>}
     */
    getCurrentHeight(): Promise<number>;
    /**
     * Set the gap limit for this wallet.
     * @async
     * @param {number} value Gat limit to set.
     */
    setGapLimit(value: number): Promise<void>;
    /**
     * Get the current wallet gap limit.
     * @async
     * @returns {Promise<number>}
     */
    getGapLimit(): Promise<number>;
    getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
    /**
     * Get the configured address scanning policy.
     * @async
     * @returns {Promise<AddressScanPolicy>}
     */
    getScanningPolicy(): Promise<AddressScanPolicy>;
    setScanningPolicyData(data: AddressScanPolicyData): Promise<void>;
    getScanningPolicyData(): Promise<AddressScanPolicyData>;
    /**
     * Get the wallet data.
     * @async
     * @returns {Promise<IWalletData>}
     */
    getWalletData(): Promise<IWalletData>;
    /**
     * Get an entry on the generic storage.
     * @param {string} key Key to fetch
     * @async
     * @returns {Promise<any>}
     */
    getItem(key: string): Promise<unknown>;
    /**
     * Set an item on the generic storage.
     *
     * @param {string} key Key to store
     * @param {any} value Value to store
     * @async
     * @returns {Promise<void>}
     */
    setItem(key: string, value: unknown): Promise<void>;
    /**
     * Clean the storage.
     * @param {boolean} cleanHistory if we should clean the transaction history.
     * @param {boolean} cleanAddresses if we should clean the addresses.
     * @param {boolean} cleanTokens if we should clean the registered tokens.
     * @async
     * @returns {Promise<void>}
     */
    cleanStorage(cleanHistory?: boolean, cleanAddresses?: boolean, cleanTokens?: boolean): Promise<void>;
    /**
     * Clean the store metadata.
     *
     * This is used when processing the history to avoid keeping metadata from a voided tx.
     * `processHistory` is additive, so if we don't clean the metadata we are passive to keep stale metadata.
     * This is also true for utxos since processing txs that spent utxos will not remove the utxo from the store.
     *
     * @returns {Promise<void>}
     */
    cleanMetadata(): Promise<void>;
    /**
     * Return if the nano contract is registered for the given address based on ncId.
     *
     * @param ncId Nano Contract ID.
     * @returns `true` if registered and `false` otherwise.
     * @async
     */
    isNanoContractRegistered(ncId: string): Promise<boolean>;
    /**
     * Iterate on registered nano contracts.
     *
     * @async
     * @generator
     * @returns {AsyncGenerator<INcData>}
     */
    registeredNanoContractsIter(): AsyncGenerator<INcData>;
    /**
     * Get a nano contract data on storage from the ncId.
     *
     * @param ncId Nano Contract ID.
     * @returns Nano contract data instance.
     * @async
     */
    getNanoContract(ncId: string): Promise<INcData | null>;
    /**
     * Register a nano contract data.
     *
     * @param ncId Nano Contract ID.
     * @param ncValue Nano contract basic information.
     * @async
     */
    registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
    /**
     * Unregister nano contract.
     *
     * @param ncId Nano Contract ID.
     */
    unregisterNanoContract(ncId: string): Promise<void>;
    /**
     * Update nano contract registered address.
     *
     * @param ncId Nano Contract ID.
     * @param address Nano Contract registered address.
     */
    updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void>;
}
//# sourceMappingURL=memory_store.d.ts.map