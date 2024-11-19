/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { AddressScanPolicy, AddressScanPolicyData, IAddressInfo, IAddressMetadata, IHistoryTx, IIndexLimitAddressScanPolicy, ILockedUtxo, INcData, IStore, ITokenData, ITokenMetadata, IUtxo, IUtxoFilterOptions, IWalletAccessData, IWalletData } from '../../types';
import LevelAddressIndex from './address_index';
import LevelHistoryIndex from './history_index';
import LevelUtxoIndex from './utxo_index';
import LevelWalletIndex from './wallet_index';
import LevelTokenIndex from './token_index';
import LevelNanoContractIndex from './nanocontract_index';
export default class LevelDBStore implements IStore {
    addressIndex: LevelAddressIndex;
    historyIndex: LevelHistoryIndex;
    utxoIndex: LevelUtxoIndex;
    walletIndex: LevelWalletIndex;
    tokenIndex: LevelTokenIndex;
    nanoContractIndex: LevelNanoContractIndex;
    dbpath: string;
    constructor(dirpath: string, dbroot?: string);
    close(): Promise<void>;
    destroy(): Promise<void>;
    validate(): Promise<void>;
    preProcessHistory(): Promise<void>;
    addressIter(): AsyncGenerator<IAddressInfo>;
    getAddress(base58: string): Promise<IAddressInfo | null>;
    getAddressMeta(base58: string): Promise<IAddressMetadata | null>;
    addressCount(): Promise<number>;
    getAddressAtIndex(index: number): Promise<IAddressInfo | null>;
    setCurrentAddressIndex(index: number): Promise<void>;
    editAddressMeta(base58: string, meta: IAddressMetadata): Promise<void>;
    saveAddress(info: IAddressInfo): Promise<void>;
    addressExists(base58: string): Promise<boolean>;
    getCurrentAddress(markAsUsed?: boolean | undefined): Promise<string>;
    historyIter(tokenUid?: string | undefined): AsyncGenerator<IHistoryTx, void, void>;
    historyCount(): Promise<number>;
    saveTx(tx: IHistoryTx): Promise<void>;
    getTx(txId: string): Promise<IHistoryTx | null>;
    tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>, void, void>;
    getToken(tokenUid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
    getTokenMeta(tokenUid: string): Promise<ITokenMetadata | null>;
    saveToken(tokenConfig: ITokenData, meta?: ITokenMetadata | undefined): Promise<void>;
    registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>, void, void>;
    registerToken(token: ITokenData): Promise<void>;
    unregisterToken(tokenUid: string): Promise<void>;
    isTokenRegistered(tokenUid: string): Promise<boolean>;
    editTokenMeta(tokenUid: string, meta: ITokenMetadata): Promise<void>;
    utxoIter(): AsyncGenerator<IUtxo>;
    selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IUtxo>;
    saveUtxo(utxo: IUtxo): Promise<void>;
    /**
     * Save a locked utxo to the database.
     * Used when a new utxo is received but it is either time locked or height locked.
     * The locked utxo index will be used to manage the locked utxos.
     *
     * @param {ILockedUtxo} lockedUtxo The locked utxo to be saved
     * @returns {Promise<void>}
     */
    saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    /**
     * Remove an utxo from the locked utxos if it became unlocked.
     *
     * @param lockedUtxo utxo that became unlocked
     * @returns {Promise<void>}
     */
    unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    /**
     * Iterate over all locked utxos
     * @returns {AsyncGenerator<ILockedUtxo>}
     */
    iterateLockedUtxos(): AsyncGenerator<ILockedUtxo>;
    saveAccessData(data: IWalletAccessData): Promise<void>;
    getAccessData(): Promise<IWalletAccessData | null>;
    getLastLoadedAddressIndex(): Promise<number>;
    getLastUsedAddressIndex(): Promise<number>;
    setLastUsedAddressIndex(index: number): Promise<void>;
    setCurrentHeight(height: number): Promise<void>;
    getCurrentHeight(): Promise<number>;
    setGapLimit(value: number): Promise<void>;
    getGapLimit(): Promise<number>;
    getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
    getScanningPolicy(): Promise<AddressScanPolicy>;
    setScanningPolicyData(data: AddressScanPolicyData): Promise<void>;
    getScanningPolicyData(): Promise<AddressScanPolicyData>;
    getWalletData(): Promise<IWalletData>;
    getItem(key: string): Promise<unknown>;
    setItem(key: string, value: unknown): Promise<void>;
    cleanStorage(cleanHistory?: boolean, cleanAddresses?: boolean, cleanTokens?: boolean): Promise<void>;
    cleanMetadata(): Promise<void>;
    /**
     * Return if the nano contract is registered for the given address based on ncId.
     *
     * @param ncId Nano Contract Id.
     * @returns `true` if registered and `false` otherwise.
     * @async
     */
    isNanoContractRegistered(ncId: string): Promise<boolean>;
    /**
     * Iterate over all registered nano contracts in the database
     *
     * @async
     * @generator
     * @returns {AsyncGenerator<INcData>}
     */
    registeredNanoContractsIter(): AsyncGenerator<INcData>;
    /**
     * Get a nano contract data on storage from the ncId.
     *
     * @param ncId Nano Contract Id.
     * @returns Nano contract data instance.
     * @async
     */
    getNanoContract(ncId: string): Promise<INcData | null>;
    /**
     * Register a nano contract data.
     *
     * @param ncId Nano Contract Id.
     * @param ncValue Nano contract basic information.
     * @async
     */
    registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
    /**
     * Unregister a nano contract.
     *
     * @param ncId Nano Contract ID.
     * @async
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
//# sourceMappingURL=store.d.ts.map