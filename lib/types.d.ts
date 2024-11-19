/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { Config } from './config';
import Transaction from './models/transaction';
import Input from './models/input';
import FullNodeConnection from './new/connection';
/**
 * Logger interface where each method is a leveled log method.
 */
export interface ILogger {
    debug: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
}
/**
 * Get the default logger instance, the console
 */
export declare function getDefaultLogger(): ILogger;
export type OutputValueType = bigint;
export interface ITxSignatureData {
    ncCallerSignature: Buffer | null;
    inputSignatures: IInputSignature[];
}
export interface IInputSignature {
    inputIndex: number;
    addressIndex: number;
    signature: Buffer;
    pubkey: Buffer;
}
export declare enum HistorySyncMode {
    POLLING_HTTP_API = "polling-http-api",
    MANUAL_STREAM_WS = "manual-stream-ws",
    XPUB_STREAM_WS = "xpub-stream-ws"
}
/**
 * This is the method signature for a method that signs a transaction and
 * returns an array with signature information.
 */
export type EcdsaTxSign = (tx: Transaction, storage: IStorage, pinCode: string) => Promise<ITxSignatureData>;
export type HistorySyncFunction = (startIndex: number, count: number, storage: IStorage, connection: FullNodeConnection, shouldProcessHistory?: boolean) => Promise<void>;
export interface IAddressInfo {
    base58: string;
    bip32AddressIndex: number;
    publicKey?: string;
}
export interface IAddressMetadata {
    numTransactions: number;
    balance: Map<string, IBalance>;
}
export interface IAddressMetadataAsRecord {
    numTransactions: number;
    balance: Record<string, IBalance>;
}
export interface ITokenData {
    uid: string;
    name: string;
    symbol: string;
}
export interface ITokenMetadata {
    numTransactions: number;
    balance: IBalance;
}
export interface IBalance {
    tokens: ITokenBalance;
    authorities: IAuthoritiesBalance;
}
export interface ITokenBalance {
    locked: OutputValueType;
    unlocked: OutputValueType;
}
export interface IAuthoritiesBalance {
    mint: ITokenBalance;
    melt: ITokenBalance;
}
export interface IHistoryTx {
    tx_id: string;
    signalBits?: number;
    version: number;
    weight: number;
    timestamp: number;
    is_voided: boolean;
    nonce?: number;
    inputs: IHistoryInput[];
    outputs: IHistoryOutput[];
    parents: string[];
    token_name?: string;
    token_symbol?: string;
    tokens?: string[];
    height?: number;
    processingStatus?: TxHistoryProcessingStatus;
    nc_id?: string;
    nc_blueprint_id?: string;
    nc_method?: string;
    nc_args?: string;
    nc_pubkey?: string;
    first_block?: string | null;
}
export declare enum TxHistoryProcessingStatus {
    PROCESSING = "processing",
    FINISHED = "finished"
}
export interface IHistoryInput {
    value: OutputValueType;
    token_data: number;
    script: string;
    decoded: IHistoryOutputDecoded;
    token: string;
    tx_id: string;
    index: number;
}
export interface IHistoryOutputDecoded {
    type?: string;
    address?: string;
    timelock?: number | null;
    data?: string;
}
export interface IHistoryOutput {
    value: OutputValueType;
    token_data: number;
    script: string;
    decoded: IHistoryOutputDecoded;
    token: string;
    spent_by: string | null;
    selected_as_input?: boolean;
}
export interface IDataOutputData {
    type: 'data';
    token: string;
    value: OutputValueType;
    authorities: OutputValueType;
    data: string;
}
export declare function isDataOutputData(output: IDataOutput): output is IDataOutputData;
export interface IDataOutputAddress {
    type: 'p2pkh' | 'p2sh';
    token: string;
    value: OutputValueType;
    authorities: OutputValueType;
    address: string;
    timelock: number | null;
}
export declare function isDataOutputAddress(output: IDataOutput): output is IDataOutputAddress;
export interface IDataOutputCreateToken {
    type: 'mint' | 'melt';
    value: OutputValueType;
    address: string;
    timelock: number | null;
    authorities: OutputValueType;
}
export declare function isDataOutputCreateToken(output: IDataOutput): output is IDataOutputCreateToken;
export interface IDataOutputOptionals {
    isChange?: boolean;
}
export type IDataOutput = (IDataOutputData | IDataOutputAddress | IDataOutputCreateToken) & IDataOutputOptionals;
export interface IDataInput {
    txId: string;
    index: number;
    value: OutputValueType;
    authorities: OutputValueType;
    token: string;
    address: string;
    data?: string;
}
export interface IDataTx {
    signalBits?: number;
    version?: number;
    inputs: IDataInput[];
    outputs: IDataOutput[];
    tokens: string[];
    weight?: number;
    nonce?: number;
    timestamp?: number;
    parents?: string[];
    name?: string;
    symbol?: string;
}
export interface IUtxoId {
    txId: string;
    index: number;
}
export interface IUtxo {
    txId: string;
    index: number;
    token: string;
    address: string;
    value: OutputValueType;
    authorities: OutputValueType;
    timelock: number | null;
    type: number;
    height: number | null;
}
export interface ILockedUtxo {
    tx: IHistoryTx;
    index: number;
}
export declare enum WalletType {
    P2PKH = "p2pkh",
    MULTISIG = "multisig"
}
export declare enum WALLET_FLAGS {
    READONLY = 1,
    HARDWARE = 2
}
export interface IWalletAccessData {
    xpubkey: string;
    mainKey?: IEncryptedData;
    acctPathKey?: IEncryptedData;
    words?: IEncryptedData;
    authKey?: IEncryptedData;
    multisigData?: IMultisigData;
    walletType: WalletType;
    walletFlags: number;
}
export declare enum SCANNING_POLICY {
    GAP_LIMIT = "gap-limit",
    INDEX_LIMIT = "index-limit"
}
export interface IGapLimitAddressScanPolicy {
    policy: SCANNING_POLICY.GAP_LIMIT;
    gapLimit: number;
}
export interface IIndexLimitAddressScanPolicy {
    policy: SCANNING_POLICY.INDEX_LIMIT;
    startIndex: number;
    endIndex: number;
}
/**
 * This is a request from the scanning policy to load `count` addresses starting from nextIndex.
 */
export interface IScanPolicyLoadAddresses {
    nextIndex: number;
    count: number;
}
export type AddressScanPolicy = SCANNING_POLICY.GAP_LIMIT | SCANNING_POLICY.INDEX_LIMIT;
export type AddressScanPolicyData = IGapLimitAddressScanPolicy | IIndexLimitAddressScanPolicy;
export declare function isGapLimitScanPolicy(scanPolicyData: AddressScanPolicyData): scanPolicyData is IGapLimitAddressScanPolicy;
export declare function isIndexLimitScanPolicy(scanPolicyData: AddressScanPolicyData): scanPolicyData is IIndexLimitAddressScanPolicy;
export interface IWalletData {
    lastLoadedAddressIndex: number;
    lastUsedAddressIndex: number;
    currentAddressIndex: number;
    bestBlockHeight: number;
    scanPolicyData: AddressScanPolicyData;
}
export interface IEncryptedData {
    data: string;
    hash: string;
    salt: string;
    iterations: number;
    pbkdf2Hasher: string;
}
export interface IMultisigData {
    pubkey?: string;
    pubkeys: string[];
    numSignatures: number;
}
export interface IUtxoFilterOptions {
    token?: string;
    authorities?: OutputValueType;
    max_utxos?: number;
    filter_address?: string;
    target_amount?: OutputValueType;
    max_amount?: OutputValueType;
    amount_smaller_than?: OutputValueType;
    amount_bigger_than?: OutputValueType;
    only_available_utxos?: boolean;
    filter_method?: (utxo: IUtxo) => boolean;
    reward_lock?: number;
    order_by_value?: 'asc' | 'desc';
}
export type UtxoSelectionAlgorithm = (storage: IStorage, token: string, amount: OutputValueType) => Promise<{
    utxos: IUtxo[];
    amount: OutputValueType;
    available?: OutputValueType;
}>;
export interface IUtxoSelectionOptions {
    token?: string;
    changeAddress?: string;
    chooseInputs?: boolean;
    utxoSelectionMethod?: UtxoSelectionAlgorithm;
}
export interface IFillTxOptions {
    changeAddress?: string;
    skipAuthorities?: boolean;
    chooseInputs?: boolean;
}
export interface ApiVersion {
    version: string;
    network: string;
    min_tx_weight: number;
    min_tx_weight_coefficient: number;
    min_tx_weight_k: number;
    token_deposit_percentage: number;
    reward_spend_min_blocks: number;
    max_number_inputs: number;
    max_number_outputs: number;
    decimal_places: number;
    native_token: Omit<ITokenData, 'uid'> | null | undefined;
}
export interface IStore {
    validate(): Promise<void>;
    preProcessHistory(): Promise<void>;
    addressIter(): AsyncGenerator<IAddressInfo>;
    getAddress(base58: string): Promise<IAddressInfo | null>;
    getAddressMeta(base58: string): Promise<IAddressMetadata | null>;
    getAddressAtIndex(index: number): Promise<IAddressInfo | null>;
    saveAddress(info: IAddressInfo): Promise<void>;
    addressExists(base58: string): Promise<boolean>;
    addressCount(): Promise<number>;
    editAddressMeta(base58: string, meta: IAddressMetadata): Promise<void>;
    historyIter(tokenUid?: string): AsyncGenerator<IHistoryTx>;
    saveTx(tx: IHistoryTx): Promise<void>;
    getTx(txId: string): Promise<IHistoryTx | null>;
    historyCount(): Promise<number>;
    tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    getToken(tokenUid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
    getTokenMeta(tokenUid: string): Promise<ITokenMetadata | null>;
    saveToken(tokenConfig: ITokenData, meta?: ITokenMetadata): Promise<void>;
    registerToken(token: ITokenData): Promise<void>;
    unregisterToken(tokenUid: string): Promise<void>;
    isTokenRegistered(tokenUid: string): Promise<boolean>;
    editTokenMeta(tokenUid: string, meta: ITokenMetadata): Promise<void>;
    utxoIter(): AsyncGenerator<IUtxo>;
    selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IUtxo>;
    saveUtxo(utxo: IUtxo): Promise<void>;
    saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    iterateLockedUtxos(): AsyncGenerator<ILockedUtxo>;
    unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    getAccessData(): Promise<IWalletAccessData | null>;
    saveAccessData(data: IWalletAccessData): Promise<void>;
    getWalletData(): Promise<IWalletData>;
    getLastLoadedAddressIndex(): Promise<number>;
    getLastUsedAddressIndex(): Promise<number>;
    setLastUsedAddressIndex(index: number): Promise<void>;
    getCurrentHeight(): Promise<number>;
    setCurrentHeight(height: number): Promise<void>;
    getCurrentAddress(markAsUsed?: boolean): Promise<string>;
    setCurrentAddressIndex(index: number): Promise<void>;
    setGapLimit(value: number): Promise<void>;
    getGapLimit(): Promise<number>;
    getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
    getScanningPolicy(): Promise<AddressScanPolicy>;
    setScanningPolicyData(data: AddressScanPolicyData): Promise<void>;
    getScanningPolicyData(): Promise<AddressScanPolicyData>;
    isNanoContractRegistered(ncId: string): Promise<boolean>;
    registeredNanoContractsIter(): AsyncGenerator<INcData>;
    getNanoContract(ncId: string): Promise<INcData | null>;
    registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
    unregisterNanoContract(ncId: string): Promise<void>;
    updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void>;
    getItem(key: string): Promise<unknown>;
    setItem(key: string, value: unknown): Promise<void>;
    cleanStorage(cleanHistory?: boolean, cleanAddresses?: boolean, cleanTokens?: boolean): Promise<void>;
    cleanMetadata(): Promise<void>;
}
export interface IStorage {
    store: IStore;
    config: Config;
    version: ApiVersion | null;
    logger: ILogger;
    setApiVersion(version: ApiVersion): void;
    getDecimalPlaces(): number;
    saveNativeToken(): Promise<void>;
    getNativeTokenData(): ITokenData;
    setLogger(logger: ILogger): void;
    hasTxSignatureMethod(): boolean;
    setTxSignatureMethod(txSign: EcdsaTxSign): void;
    getTxSignatures(tx: Transaction, pinCode: string): Promise<ITxSignatureData>;
    getAllAddresses(): AsyncGenerator<IAddressInfo & IAddressMetadata>;
    getAddressInfo(base58: string): Promise<(IAddressInfo & IAddressMetadata) | null>;
    getAddressAtIndex(index: number): Promise<IAddressInfo | null>;
    getAddressPubkey(index: number): Promise<string>;
    saveAddress(info: IAddressInfo): Promise<void>;
    isAddressMine(base58: string): Promise<boolean>;
    getCurrentAddress(markAsUsed?: boolean): Promise<string>;
    getChangeAddress(options?: {
        changeAddress?: null | string;
    }): Promise<string>;
    txHistory(): AsyncGenerator<IHistoryTx>;
    tokenHistory(tokenUid?: string): AsyncGenerator<IHistoryTx>;
    getTx(txId: string): Promise<IHistoryTx | null>;
    getSpentTxs(inputs: Input[]): AsyncGenerator<{
        tx: IHistoryTx;
        input: Input;
        index: number;
    }>;
    addTx(tx: IHistoryTx): Promise<void>;
    processHistory(): Promise<void>;
    isTokenRegistered(tokenUid: string): Promise<boolean>;
    registerToken(token: ITokenData): Promise<void>;
    unregisterToken(tokenUid: string): Promise<void>;
    getToken(uid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
    getAllTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    getRegisteredTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    getAllUtxos(): AsyncGenerator<IUtxo>;
    selectUtxos(options: Omit<IUtxoFilterOptions, 'reward_lock'>): AsyncGenerator<IUtxo>;
    fillTx(token: string, tx: IDataTx, options: IFillTxOptions): Promise<{
        inputs: IDataInput[];
        outputs: IDataOutput[];
    }>;
    utxoSelectAsInput(utxo: IUtxoId, markAs: boolean, ttl?: number): Promise<void>;
    isUtxoSelectedAsInput(utxo: IUtxoId): Promise<boolean>;
    utxoSelectedAsInputIter(): AsyncGenerator<IUtxoId>;
    unlockUtxos(height: number): Promise<void>;
    processLockedUtxos(height: number): Promise<void>;
    getAccessData(): Promise<IWalletAccessData | null>;
    saveAccessData(data: IWalletAccessData): Promise<void>;
    getMainXPrivKey(pinCode: string): Promise<string>;
    getAcctPathXPrivKey(pinCode: string): Promise<string>;
    getAuthPrivKey(pinCode: string): Promise<string>;
    getWalletData(): Promise<IWalletData>;
    getWalletType(): Promise<WalletType>;
    getCurrentHeight(): Promise<number>;
    setCurrentHeight(height: number): Promise<void>;
    isReadonly(): Promise<boolean>;
    changePin(oldPin: string, newPin: string): Promise<void>;
    changePassword(oldPassword: string, newPassword: string): Promise<void>;
    setGapLimit(value: number): Promise<void>;
    getGapLimit(): Promise<number>;
    getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
    cleanStorage(cleanHistory?: boolean, cleanAddresses?: boolean, cleanTokens?: boolean): Promise<void>;
    handleStop(options: {
        connection?: FullNodeConnection;
        cleanStorage?: boolean;
        cleanAddresses?: boolean;
    }): Promise<void>;
    getTokenDepositPercentage(): number;
    checkPin(pinCode: string): Promise<boolean>;
    checkPassword(password: string): Promise<boolean>;
    isHardwareWallet(): Promise<boolean>;
    getScanningPolicy(): Promise<AddressScanPolicy>;
    getScanningPolicyData(): Promise<AddressScanPolicyData>;
    setScanningPolicyData(data: AddressScanPolicyData | null): Promise<void>;
    isNanoContractRegistered(ncId: string): Promise<boolean>;
    getRegisteredNanoContracts(): AsyncGenerator<INcData>;
    getNanoContract(ncId: string): Promise<INcData | null>;
    registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
    unregisterNanoContract(ncId: string): Promise<void>;
    updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void>;
}
/**
 */
export interface IKVStoreIndex<TValidate> {
    indexVersion: string;
    validate(): Promise<TValidate>;
    checkVersion(): Promise<void>;
    close(): Promise<void>;
}
export interface AddressIndexValidateResponse {
    firstIndex: number;
    lastIndex: number;
}
export interface IKVAddressIndex extends IKVStoreIndex<AddressIndexValidateResponse> {
    getAddressInfo(base58: string): Promise<IAddressInfo | null>;
    addressExists(base58: string): Promise<boolean>;
    addressIter(): AsyncGenerator<IAddressInfo>;
    setAddressMeta(uid: string, meta: IAddressMetadata): Promise<void>;
    getAddressMeta(base58: string): Promise<IAddressMetadata | null>;
    getAddressAtIndex(index: number): Promise<string | null>;
    saveAddress(info: IAddressInfo): Promise<void>;
    addressCount(): Promise<number>;
    clearMeta(): Promise<void>;
    clear(): Promise<void>;
}
export interface HistoryIndexValidateResponse {
    count: number;
}
export interface IKVHistoryIndex extends IKVStoreIndex<HistoryIndexValidateResponse> {
    historyIter(tokenUid?: string): AsyncGenerator<IHistoryTx>;
    getTx(txId: string): Promise<IHistoryTx | null>;
    saveTx(tx: IHistoryTx): Promise<void>;
    historyCount(): Promise<number>;
    clear(): Promise<void>;
}
export interface IKVUtxoIndex extends IKVStoreIndex<void> {
    utxoIter(): AsyncGenerator<IUtxo>;
    selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IUtxo>;
    saveUtxo(utxo: IUtxo): Promise<void>;
    saveLockedUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    iterateLockedUtxos(): AsyncGenerator<ILockedUtxo>;
    unlockUtxo(lockedUtxo: ILockedUtxo): Promise<void>;
    clear(): Promise<void>;
}
export interface IKVTokenIndex extends IKVStoreIndex<void> {
    tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    hasToken(tokenUid: string): Promise<boolean>;
    getToken(tokenUid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
    getTokenMetadata(tokenUid: string): Promise<ITokenMetadata | null>;
    saveToken(tokenConfig: ITokenData): Promise<void>;
    saveMetadata(uid: string, meta: ITokenMetadata): Promise<void>;
    registerToken(token: ITokenData): Promise<void>;
    unregisterToken(tokenUid: string): Promise<void>;
    isTokenRegistered(tokenUid: string): Promise<boolean>;
    deleteTokens(tokens: string[]): Promise<void>;
    editTokenMeta(tokenUid: string, meta: Partial<ITokenMetadata>): Promise<void>;
    clearMeta(): Promise<void>;
    clear(cleanTokens?: boolean, cleanRegisteredTokens?: boolean): Promise<void>;
}
export interface IKVWalletIndex extends IKVStoreIndex<void> {
    getAccessData(): Promise<IWalletAccessData | null>;
    saveAccessData(data: IWalletAccessData): Promise<void>;
    getWalletData(): Promise<IWalletData>;
    getLastLoadedAddressIndex(): Promise<number>;
    setLastLoadedAddressIndex(value: number): Promise<void>;
    getLastUsedAddressIndex(): Promise<number>;
    setLastUsedAddressIndex(value: number): Promise<void>;
    getCurrentHeight(): Promise<number>;
    setCurrentHeight(height: number): Promise<void>;
    setCurrentAddressIndex(value: number): Promise<void>;
    getCurrentAddressIndex(): Promise<number>;
    setGapLimit(value: number): Promise<void>;
    getGapLimit(): Promise<number>;
    getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
    getScanningPolicy(): Promise<AddressScanPolicy>;
    setScanningPolicyData(data: AddressScanPolicyData): Promise<void>;
    getScanningPolicyData(): Promise<AddressScanPolicyData>;
    getItem(key: string): Promise<unknown>;
    setItem(key: string, value: unknown): Promise<void>;
    cleanAccessData(): Promise<void>;
    cleanWalletData(clear: boolean): Promise<void>;
}
export interface IKVNanoContractIndex extends IKVStoreIndex<void> {
    isNanoContractRegistered(ncId: string): Promise<boolean>;
    getNanoContract(ncId: string): Promise<INcData | null>;
    registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
    unregisterNanoContract(ncId: string): Promise<void>;
    updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void>;
    clear(): Promise<void>;
}
export interface INcData {
    ncId: string;
    address: string;
    blueprintId: string;
    blueprintName: string;
}
//# sourceMappingURL=types.d.ts.map