/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import bitcore from 'bitcore-lib';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import SendTransactionWalletService from './sendTransactionWalletService';
import Input from '../models/input';
import Output from '../models/output';
import { OutputValueType } from '../types';
export interface GetAddressesObject {
    address: string;
    index: number;
    transactions: number;
}
export interface GetBalanceObject {
    token: TokenInfo;
    balance: Balance;
    tokenAuthorities: AuthoritiesBalance;
    transactions: number;
    lockExpires: number | null;
}
export interface TokenInfo {
    id: string;
    name: string;
    symbol: string;
}
export interface Balance {
    unlocked: OutputValueType;
    locked: OutputValueType;
}
export interface AuthoritiesBalance {
    unlocked: Authority;
    locked: Authority;
}
export interface Authority {
    mint: boolean;
    melt: boolean;
}
export interface GetHistoryObject {
    txId: string;
    balance: OutputValueType;
    timestamp: number;
    voided: boolean;
    version: number;
}
export interface AddressInfoObject {
    address: string;
    index: number;
    addressPath: string;
    info: string | undefined;
}
export interface WalletStatusResponseData {
    success: boolean;
    status: WalletStatus;
    error?: string | undefined;
}
export interface WalletStatus {
    walletId: string;
    xpubkey: string;
    status: string;
    maxGap: number;
    createdAt: number;
    readyAt: number | null;
}
export interface AddressesResponseData {
    success: boolean;
    addresses: GetAddressesObject[];
}
export interface CheckAddressesMineResponseData {
    success: boolean;
    addresses: WalletAddressMap;
}
export interface NewAddressesResponseData {
    success: boolean;
    addresses: AddressInfoObject[];
}
export interface BalanceResponseData {
    success: boolean;
    balances: GetBalanceObject[];
}
export interface TokenDetailsResponseData {
    success: boolean;
    details: TokenDetailsObject;
}
export interface TokenDetailsAuthoritiesObject {
    mint: boolean;
    melt: boolean;
}
export interface TokenDetailsObject {
    tokenInfo: TokenInfo;
    totalSupply: OutputValueType;
    totalTransactions: number;
    authorities: TokenDetailsAuthoritiesObject;
}
export interface HistoryResponseData {
    success: boolean;
    history: GetHistoryObject[];
}
export interface TxProposalCreateResponseData {
    success: boolean;
    txProposalId: string;
    inputs: TxProposalInputs[];
    outputs: TxProposalOutputs[];
    tokens: string[];
}
export interface TxProposalInputs {
    txId: string;
    index: number;
    addressPath: string;
}
export interface TxProposalOutputs {
    address: string;
    value: OutputValueType;
    token: string;
    timelock: number | null;
}
export interface TxProposalUpdateResponseData {
    success: boolean;
    txProposalId: string;
    txHex: string;
}
export interface RequestError {
    success: boolean;
    error: string;
}
export interface InputRequestObject {
    txId: string;
    index: number;
}
export interface SendManyTxOptionsParam {
    inputs: InputRequestObject[] | undefined;
    changeAddress: string | undefined;
}
export interface SendTxOptionsParam {
    token: string | undefined;
    changeAddress: string | undefined;
}
export interface TxOutputResponseData {
    success: boolean;
    txOutputs: Utxo[];
}
export interface Utxo {
    txId: string;
    index: number;
    tokenId: string;
    address: string;
    value: OutputValueType;
    authorities: OutputValueType;
    timelock: number | null;
    heightlock: number | null;
    locked: boolean;
    addressPath: string;
}
export interface AuthorityTxOutput {
    txId: string;
    index: number;
    address: string;
    authorities: OutputValueType;
}
export interface AuthTokenResponseData {
    success: boolean;
    token: string;
}
export interface OutputRequestObj {
    address: string;
    value: OutputValueType;
    token: string;
    timelock?: number | null;
}
export interface DataScriptOutputRequestObj {
    type: 'data';
    data: string;
}
export interface OutputSendTransaction {
    type: string;
    value: OutputValueType;
    token: string;
    address?: string;
    timelock?: number | null;
    data?: string;
}
export interface InputRequestObj {
    txId: string;
    index: number;
}
export interface TokensResponseData {
    success: boolean;
    tokens: string[];
}
export interface SendTransactionEvents {
    success: boolean;
    sendTransaction: SendTransactionWalletService;
}
export interface SendTransactionResponse {
    success: boolean;
    transaction: Transaction;
}
export interface WalletAddressMap {
    [address: string]: boolean;
}
export interface TokenAmountMap {
    [token: string]: OutputValueType;
}
export interface TransactionFullObject {
    tx_id: string;
    version: number;
    timestamp: number;
    is_voided: boolean;
    inputs: Input[];
    outputs: Output[];
    parents: string[];
}
export interface IStopWalletParams {
    cleanStorage?: boolean;
    cleanAddresses?: boolean;
}
export interface DelegateAuthorityOptions {
    anotherAuthorityAddress: string | null;
    createAnother: boolean;
    pinCode: string | null;
}
export interface DestroyAuthorityOptions {
    pinCode: string | null;
}
export interface IHathorWallet {
    start(options: {
        pinCode: string;
        password: string;
    }): Promise<void>;
    getAllAddresses(): AsyncGenerator<GetAddressesObject>;
    getBalance(token: string | null): Promise<GetBalanceObject[]>;
    getTokens(): Promise<string[]>;
    getTxHistory(options: {
        token_id?: string;
        count?: number;
        skip?: number;
    }): Promise<GetHistoryObject[]>;
    sendManyOutputsTransaction(outputs: OutputRequestObj[], options: {
        inputs?: InputRequestObj[];
        changeAddress?: string;
    }): Promise<Transaction>;
    sendTransaction(address: string, value: OutputValueType, options: {
        token?: string;
        changeAddress?: string;
    }): Promise<Transaction>;
    stop(params?: IStopWalletParams): void;
    getAddressAtIndex(index: number): Promise<string>;
    getCurrentAddress(options: {
        markAsUsed: boolean;
    }): AddressInfoObject;
    getNextAddress(): AddressInfoObject;
    getAddressPrivKey(pinCode: string, addressIndex: number): Promise<bitcore.PrivateKey>;
    signMessageWithAddress(message: string, index: number, pinCode: string): Promise<string>;
    prepareCreateNewToken(name: string, symbol: string, amount: OutputValueType, options: any): Promise<CreateTokenTransaction>;
    createNewToken(name: string, symbol: string, amount: OutputValueType, options: any): Promise<Transaction>;
    createNFT(name: string, symbol: string, amount: OutputValueType, data: string, options: any): Promise<Transaction>;
    prepareMintTokensData(token: string, amount: OutputValueType, options: any): Promise<Transaction>;
    mintTokens(token: string, amount: OutputValueType, options: any): Promise<Transaction>;
    prepareMeltTokensData(token: string, amount: OutputValueType, options: any): Promise<Transaction>;
    meltTokens(token: string, amount: OutputValueType, options: any): Promise<Transaction>;
    prepareDelegateAuthorityData(token: string, type: string, address: string, options: DelegateAuthorityOptions): Promise<Transaction>;
    delegateAuthority(token: string, type: string, address: string, options: DelegateAuthorityOptions): Promise<Transaction>;
    prepareDestroyAuthorityData(token: string, type: string, count: number, options: DestroyAuthorityOptions): Promise<Transaction>;
    destroyAuthority(token: string, type: string, count: number, options: DestroyAuthorityOptions): Promise<Transaction>;
    getFullHistory(): TransactionFullObject[];
    getTxBalance(tx: WsTransaction, optionsParams: any): Promise<{
        [tokenId: string]: OutputValueType;
    }>;
    onConnectionChangedState(newState: ConnectionState): void;
    getTokenDetails(tokenId: string): Promise<TokenDetailsObject>;
    getVersionData(): Promise<FullNodeVersionData>;
    checkAddressesMine(addresses: string[]): Promise<WalletAddressMap>;
    getFullTxById(txId: string): Promise<FullNodeTxResponse>;
    getTxConfirmationData(txId: string): Promise<FullNodeTxConfirmationDataResponse>;
    graphvizNeighborsQuery(txId: string, graphType: string, maxLevel: number): Promise<string>;
    checkPin(pin: string): Promise<boolean>;
    checkPassword(password: string): Promise<boolean>;
    checkPinAndPassword(pin: string, password: string): Promise<boolean>;
}
export interface ISendTransaction {
    run(until: string | null): Promise<Transaction>;
    runFromMining(until: string | null): Promise<Transaction>;
}
export interface MineTxSuccessData {
    nonce: number;
    weight: number;
    timestamp: number;
    parents: string[];
}
export interface DecodedOutput {
    type: string;
    address: string;
    timelock: number | null;
}
export interface TxOutput {
    value: OutputValueType;
    script: string;
    token: string;
    decoded: DecodedOutput;
    spent_by: string | null;
    token_data: number;
    locked?: boolean;
}
export interface TxInput {
    tx_id: string;
    index: number;
    value: OutputValueType;
    token_data: number;
    script: string;
    token: string;
    decoded: DecodedOutput;
}
export interface WsTransaction {
    tx_id: string;
    nonce: number;
    timestamp: number;
    signalBits: number;
    version: number;
    weight: number;
    parents: string[];
    inputs: TxInput[];
    outputs: TxOutput[];
    height?: number;
    token_name?: string;
    token_symbol?: string;
}
export interface CreateWalletAuthData {
    xpub: bitcore.HDPublicKey;
    xpubkeySignature: string;
    authXpub: string;
    authXpubkeySignature: string;
    timestampNow: number;
    firstAddress: string;
    authDerivedPrivKey: bitcore.HDPrivateKey;
}
export interface FullNodeVersionData {
    timestamp: number;
    version: string;
    network: string;
    minWeight: number;
    minTxWeight: number;
    minTxWeightCoefficient: number;
    minTxWeightK: number;
    tokenDepositPercentage: number;
    rewardSpendMinBlocks: number;
    maxNumberInputs: number;
    maxNumberOutputs: number;
}
export interface TxByIdTokenData {
    txId: string;
    timestamp: number;
    version: number;
    voided: boolean;
    height?: number | null;
    weight: number;
    balance: Balance;
    tokenId: string;
    walletId: string;
    tokenName: string;
    tokenSymbol: string;
}
export type TxByIdTokensResponseData = TxByIdTokenData[];
export interface WalletServiceServerUrls {
    walletServiceBaseUrl: string;
    walletServiceWsUrl: string;
}
export declare enum ConnectionState {
    CLOSED = 0,
    CONNECTING = 1,
    CONNECTED = 2
}
export declare enum OutputType {
    P2PKH = "p2pkh",
    P2SH = "p2sh",
    DATA = "data"
}
export interface FullNodeToken {
    uid: string;
    name: string | null;
    symbol: string | null;
}
export interface FullNodeDecodedInput {
    type: string;
    address: string;
    timelock?: number | null;
    value: OutputValueType;
    token_data: number;
}
export interface FullNodeDecodedOutput {
    type: string;
    address?: string;
    timelock?: number | null;
    value: OutputValueType;
    token_data?: number;
}
export interface FullNodeInput {
    value: OutputValueType;
    token_data: number;
    script: string;
    decoded: FullNodeDecodedInput;
    tx_id: string;
    index: number;
    token?: string | null;
    spent_by?: string | null;
}
export interface FullNodeOutput {
    value: OutputValueType;
    token_data: number;
    script: string;
    decoded: FullNodeDecodedOutput;
    token?: string | null;
    spent_by?: string | null;
}
export interface FullNodeTx {
    hash: string;
    nonce: string;
    timestamp: number;
    version: number;
    weight: number;
    parents: string[];
    inputs: FullNodeInput[];
    outputs: FullNodeOutput[];
    tokens: FullNodeToken[];
    token_name?: string | null;
    token_symbol?: string | null;
    raw: string;
}
export interface FullNodeMeta {
    hash: string;
    spent_outputs: Array<[number, Array<string>]>;
    received_by: string[];
    children: string[];
    conflict_with: string[];
    voided_by: string[];
    twins: string[];
    accumulated_weight: number;
    score: number;
    height: number;
    validation?: string;
    first_block?: string | null;
    first_block_height?: number | null;
}
export interface FullNodeTxResponse {
    tx: FullNodeTx;
    meta: FullNodeMeta;
    success: boolean;
    message?: string;
    spent_outputs?: Record<string, string>;
}
export interface FullNodeTxConfirmationDataResponse {
    success: boolean;
    accumulated_weight: number;
    accumulated_bigger: boolean;
    stop_value: number;
    confirmation_level: number;
}
//# sourceMappingURL=types.d.ts.map