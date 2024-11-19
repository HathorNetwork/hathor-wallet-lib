/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
/// <reference types="node" />
import { EventEmitter } from 'events';
import bitcore from 'bitcore-lib';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Network from '../models/network';
import { AddressInfoObject, GetBalanceObject, GetAddressesObject, GetHistoryObject, Utxo, OutputRequestObj, DataScriptOutputRequestObj, InputRequestObj, TransactionFullObject, IHathorWallet, WsTransaction, CreateWalletAuthData, ConnectionState, TokenDetailsObject, AuthorityTxOutput, WalletServiceServerUrls, FullNodeVersionData, WalletAddressMap, TxByIdTokensResponseData, DelegateAuthorityOptions, DestroyAuthorityOptions, FullNodeTxResponse, FullNodeTxConfirmationDataResponse } from './types';
import { IStorage, OutputValueType } from '../types';
declare class HathorWalletServiceWallet extends EventEmitter implements IHathorWallet {
    passphrase: string;
    walletId: string | null;
    network: Network;
    private requestPassword;
    private seed;
    private xpub;
    private xpriv;
    private authPrivKey;
    private state;
    private isSendingTx;
    private txProposalId;
    private authToken;
    private newAddresses;
    private indexToUse;
    private conn;
    private firstConnection;
    private readonly _isWsEnabled;
    storage: IStorage;
    constructor({ requestPassword, seed, xpriv, authxpriv, xpub, network, passphrase, enableWs, storage, }: {
        requestPassword: () => Promise<string>;
        seed?: string | null;
        xpriv?: string | null;
        authxpriv?: string | null;
        xpub?: string | null;
        network: Network;
        passphrase?: string;
        enableWs?: boolean;
        storage?: IStorage | null;
    });
    /**
     * Sets the server to connect on config singleton and storage
     *
     * @param {String} newServer - The new server to set the config and storage to
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    changeServer(newServer: string): Promise<void>;
    /**
     * Sets the websocket server to connect on config singleton and storage
     *
     * @param {String} newServer - The new websocket server to set the config and storage to
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    changeWsServer(newServer: string): Promise<void>;
    /**
     * Gets the stored websocket and base server urls
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getServerUrlsFromStorage(): Promise<WalletServiceServerUrls>;
    /**
     * Remove sensitive data from memory
     *
     * NOTICE: This won't remove data from memory immediately, we have to wait until javascript
     * garbage collect it. JavaScript currently does not provide a standard way to trigger
     * garbage collection
     * */
    clearSensitiveData(): void;
    /**
     * Get auth xpubkey from seed
     *
     * @param {String} seed 24 words
     * @param {Object} options Options with passphrase and networkName
     *
     * @return {String} auth xpubkey
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    static getAuthXPubKeyFromSeed(seed: string, options?: {
        passphrase?: string;
        networkName?: string;
    }): string;
    /**
     * Derive private key from root to the auth specific purpose derivation path
     *
     * @param {HDPrivateKey} xpriv The wallet's root xpriv
     *
     * @return {HDPrivateKey} Derived private key at the auth derivation path
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    static deriveAuthPrivateKey(xpriv: bitcore.HDPrivateKey): bitcore.HDPrivateKey;
    /**
     * getWalletIdFromXPub: Get the wallet id given the xpubkey
     *
     * @param xpub - The xpubkey
     * @returns The wallet id
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    static getWalletIdFromXPub(xpub: string): string;
    /**
     * Start wallet: load the wallet data, update state and start polling wallet status until it's ready
     *
     * @param {Object} optionsParams Options parameters
     *  {
     *   'pinCode': PIN to encrypt the auth xpriv on storage
     *   'password': Password to decrypt xpriv information
     *  }
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    start({ pinCode, password }?: {
        pinCode?: string;
        password?: string;
    }): Promise<void>;
    /**
     * Returns version data from the connected fullnode
     * */
    getVersionData(): Promise<FullNodeVersionData>;
    /**
     * Detects if we are loading from the seed or the account path and returns the
     * required information for authentication
     *
     * @param pinCode The pincode to be used to encrypt the auth xprivkey
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    generateCreateWalletAuthData(pinCode: string): Promise<CreateWalletAuthData>;
    /**
     * onUpdateTx: Event called when a transaction is updated
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    onUpdateTx(updatedTx: any): void;
    /**
     * onNewTx: Event called when a new transaction is received on the websocket feed
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    onNewTx(newTx: WsTransaction): Promise<void>;
    /**
     * Return wallet auth token
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getAuthToken(): string | null;
    /**
     * Returns the balance for each token in tx, if the input/output belongs to this wallet
     *
     * This method is meant to keep compatibility with the old facade
     *
     * @param {Object} tx Transaction data with array of inputs and outputs
     *
     * @return {Object} Object with each token and it's balance in this tx for this wallet
     * */
    getTxBalance(tx: WsTransaction, optionsParam?: {}): Promise<{
        [tokenId: string]: OutputValueType;
    }>;
    /**
     * When the wallet starts, it might take some seconds for the wallet service to completely load all addresses
     * This method is responsible for polling the wallet status until it's ready
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    pollForWalletStatus(): Promise<void>;
    /**
     * Check if wallet is ready and throw error if not ready
     *
     * @memberof HathorWalletServiceWallet
     * @public
     */
    failIfWalletNotReady(): void;
    /**
     * Method executed when wallet is ready
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    private onWalletReady;
    setupConnection(): void;
    /**
     * Called when the connection to the websocket changes.
     * It is also called if the network is down.
     *
     * Since the wallet service facade holds no data (as opposed to
     * the old facade, where the wallet facade receives a storage object),
     * the client needs to handle the data reload, so we just emit an event
     * to indicate that a reload is necessary.
     *
     * @param {Number} newState Enum of new state after change
     * */
    onConnectionChangedState(newState: ConnectionState): void;
    /**
     * Get all addresses of the wallet
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getAllAddresses(): AsyncGenerator<GetAddressesObject>;
    /**
     * Get the new addresses to be used by this wallet, i.e. the last GAP LIMIT unused addresses
     * Then it updates this.newAddresses and this.indexToUse that handle the addresses to use
     *
     * @param ignoreWalletReady Will download new addresses even if the wallet is not set to ready
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    private getNewAddresses;
    /**
     * Get the balance of the wallet for a specific token
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getBalance(token?: string | null): Promise<GetBalanceObject[]>;
    getTokens(): Promise<string[]>;
    /**
     * Get the history of the wallet for a specific token
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getTxHistory(options?: {
        token_id?: string;
        count?: number;
        skip?: number;
    }): Promise<GetHistoryObject[]>;
    /**
     * Get utxo from tx id and index
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getUtxoFromId(txId: string, index: number): Promise<Utxo | null>;
    /**
     * Get utxos for filling a transaction
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getUtxos(options?: {
        tokenId?: string;
        authority?: OutputValueType;
        addresses?: string[];
        totalAmount?: OutputValueType;
        count?: number;
    }): Promise<{
        utxos: Utxo[];
        changeAmount: OutputValueType;
    }>;
    /**
     * Signs a message using xpriv derivation path m/44'/280'/0'
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    signMessage(hdPrivKey: bitcore.HDPrivateKey, timestamp: number, walletId: string): string;
    /**
     * Validate that the wallet auth token is valid
     * If it's not valid, requests a new one and update
     *
     * @param {string} usePassword Accepts the password as a parameter so we don't have to ask
     * the client for it if we already have it in memory
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    validateAndRenewAuthToken(usePassword?: string): Promise<void>;
    /**
     * Renew the auth token on the wallet service
     *
     * @param {HDPrivateKey} privKey - private key to sign the auth message
     * @param {number} timestamp - Current timestamp to assemble the signature
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    renewAuthToken(privKey: bitcore.HDPrivateKey, timestamp: number): Promise<void>;
    /**
     * Creates and send a transaction from an array of inputs and outputs
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    sendManyOutputsTransaction(outputs: Array<OutputRequestObj | DataScriptOutputRequestObj>, options?: {
        inputs?: InputRequestObj[];
        changeAddress?: string;
        pinCode?: string;
    }): Promise<Transaction>;
    /**
     * Creates and send a simple transaction with one output
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    sendTransaction(address: string, value: OutputValueType, options?: {
        token?: string;
        changeAddress?: string;
        pinCode?: string;
    }): Promise<Transaction>;
    /**
     * Calculate input data from dataToSign and addressPath
     * Get the private key corresponding to the addressPath,
     * calculate the signature and add the public key
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getInputData(xprivkey: string, dataToSignHash: Buffer, addressPath: number): Buffer;
    /**
     * Return if wallet is ready to be used
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    isReady(): boolean;
    /**
     * Update wallet state and emit 'state' event
     *
     * @param {string} state New wallet state
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    setState(state: string): void;
    /**
     * Stop the wallet
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    stop({ cleanStorage }?: {
        cleanStorage?: boolean | undefined;
    }): Promise<void>;
    /**
     * Get address at specific index
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getAddressAtIndex(index: number): Promise<string>;
    /**
     * Returns an address' privateKey given an index and the encryption password
     *
     * @param {string} pinCode - The PIN used to encrypt data in accessData
     * @param {number} addressIndex - The address' index to fetch
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getAddressPrivKey(pinCode: string, addressIndex: number): Promise<bitcore.HDPrivateKey>;
    /**
     * Gets the network model object
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getNetworkObject(): Network;
    /**
     * Get the current address to be used
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getCurrentAddress({ markAsUsed }?: {
        markAsUsed?: boolean | undefined;
    }): AddressInfoObject;
    /**
     * Returns a base64 encoded signed message with an address' private key given an
     * address index
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    signMessageWithAddress(message: string, index: number, pinCode: string): Promise<string>;
    /**
     * Get the next address after the current available
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getNextAddress(): AddressInfoObject;
    getAddressIndex(address: string): void;
    isAddressMine(address: string): void;
    getTx(id: string): void;
    getAddressInfo(address: string, options?: {}): void;
    consolidateUtxos(destinationAddress: string, options?: {}): void;
    getFullHistory(): TransactionFullObject[];
    /**
     * Checks if the given array of addresses belongs to the caller wallet
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    checkAddressesMine(addresses: string[]): Promise<WalletAddressMap>;
    /**
     * Create SendTransaction object and run from mining
     * Returns a promise that resolves when the send succeeds
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    handleSendPreparedTransaction(transactionObj: Transaction): Promise<Transaction>;
    /**
     * Prepare create new token data, sign the inputs and returns an object ready to be mined
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    prepareCreateNewToken(name: string, symbol: string, amount: OutputValueType, options?: {}): Promise<CreateTokenTransaction>;
    /**
     * Expects a BIP44 path at the address level and returns the address index
     *
     * @param {string} fullPath - The full BIP44 path for the address index
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    static getAddressIndexFromFullPath(fullPath: string): number;
    /**
     * Helper method to get authority tx_outputs
     * Uses the getTxOutputs API method to return one or many authorities
     */
    _getAuthorityTxOutput(options: {
        tokenId: string;
        authority: OutputValueType;
        skipSpent: boolean;
        maxOutputs?: number;
    }): Promise<AuthorityTxOutput[]>;
    /**
     * Get mint authorities
     * Uses the getTxOutputs API method to return one or many mint authorities
     *
     * @param tokenId of the token to select the authority utxo
     * @param options Object with custom options.
     *  {
     *    'many': if should return many utxos or just one (default false),
     *    'skipSpent': if should not include spent utxos (default true)
     *  }
     *
     * @return Promise that resolves with an Array of objects with {txId, index, address, authorities} of the authority output.
     * Returns an empty array in case there are no tx outputs for this type
     * */
    getMintAuthority(tokenId: string, options?: {
        many?: boolean;
        skipSpent?: boolean;
    }): Promise<AuthorityTxOutput[]>;
    /**
     * Get melt authorities
     * Uses the getTxOutputs API method to return one or many melt authorities
     *
     * @param tokenId of the token to select the authority utxo
     * @param options Object with custom options.
     *  {
     *    'many': if should return many utxos or just one (default false),
     *    'skipSpent': if should not include spent utxos (default true)
     *  }
     *
     * @return Promise that resolves with an Array of objects with {txId, index, address, authorities} of the authority output.
     * Returns an empty array in case there are no tx outputs for this type
     * */
    getMeltAuthority(tokenId: string, options?: {
        many?: boolean;
        skipSpent?: boolean;
    }): Promise<AuthorityTxOutput[]>;
    /**
     * Create a new custom token in the network
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    createNewToken(name: string, symbol: string, amount: OutputValueType, options?: {}): Promise<Transaction>;
    /**
     * Prepare mint token data, sign the inputs and returns an object ready to be mined
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    prepareMintTokensData(token: string, amount: OutputValueType, options?: {}): Promise<Transaction>;
    /**
     * Mint new token units
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    mintTokens(token: string, amount: OutputValueType, options?: {}): Promise<Transaction>;
    /**
     * Call get token details API
     *
     * @param tokenId Token uid to get the token details
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    getTokenDetails(tokenId: string): Promise<TokenDetailsObject>;
    /**
     * Prepare melt token data, sign the inputs and returns an object ready to be mined
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    prepareMeltTokensData(token: string, amount: OutputValueType, options?: {}): Promise<Transaction>;
    /**
     * Melt custom token units
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    meltTokens(token: string, amount: OutputValueType, options?: {}): Promise<Transaction>;
    /**
     * Prepare delegate authority data, sign the inputs and returns an object ready to be mined
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    prepareDelegateAuthorityData(token: string, type: string, address: string, { anotherAuthorityAddress, createAnother, pinCode, }: DelegateAuthorityOptions): Promise<Transaction>;
    /**
     * Transfer (delegate) authority outputs to another address
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    delegateAuthority(token: string, type: string, address: string, options: DelegateAuthorityOptions): Promise<Transaction>;
    /**
     * Destroy authority outputs
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    prepareDestroyAuthorityData(token: string, type: string, count: number, { pinCode }: DestroyAuthorityOptions): Promise<Transaction>;
    /**
     * Destroy authority outputs
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    destroyAuthority(token: string, type: string, count: number, options: DestroyAuthorityOptions): Promise<Transaction>;
    /**
     * Create an NFT in the network
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     */
    createNFT(name: string, symbol: string, amount: OutputValueType, data: string, options?: {}): Promise<Transaction>;
    getTxById(txId: string): Promise<TxByIdTokensResponseData>;
    getFullTxById(txId: string): Promise<FullNodeTxResponse>;
    getTxConfirmationData(txId: string): Promise<FullNodeTxConfirmationDataResponse>;
    graphvizNeighborsQuery(txId: string, graphType: string, maxLevel: number): Promise<string>;
    /**
     * Check if websocket connection is enabled
     *
     * @memberof HathorWalletServiceWallet
     * @inner
     *
     * @returns {boolean} If wallet has websocket connection enabled
     */
    isWsEnabled(): boolean;
    /**
     * Check if the pin used to encrypt the main key is valid.
     * @param {string} pin
     * @returns {Promise<boolean>}
     */
    checkPin(pin: string): Promise<boolean>;
    /**
     * Check if the password used to encrypt the seed is valid.
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    checkPassword(password: string): Promise<boolean>;
    /**
     * @param {string} pin
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    checkPinAndPassword(pin: string, password: string): Promise<boolean>;
    /**
     * Check if the wallet is a hardware wallet.
     * @returns {Promise<boolean>}
     */
    isHardwareWallet(): Promise<boolean>;
}
export default HathorWalletServiceWallet;
//# sourceMappingURL=wallet.d.ts.map