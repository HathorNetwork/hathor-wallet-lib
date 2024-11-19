/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import EventEmitter from 'events';
import SendTransaction from './sendTransaction';
import Network from '../models/network';
/**
 * This is a Wallet that is supposed to be simple to be used by a third-party app.
 *
 * This class handles all the details of syncing, including receiving the same transaction
 * multiple times from the server. It also keeps the balance of the tokens updated.
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - SYNCING: When it has connected and is syncing the transaction history.
 * - READY: When it is ready to be used.
 *
 * You can subscribe for the following events:
 * - state: Fired when the state of the Wallet changes.
 * - new-tx: Fired when a new tx arrives.
 * - update-tx: Fired when a known tx is updated. Usually, it happens when one of its outputs is spent.
 * - more-addresses-loaded: Fired when loading the history of transactions. It is fired multiple times,
 *                          one for each request sent to the server.
 */
declare class HathorWallet extends EventEmitter {
    /**
     * @param {Object} param
     * @param {FullnodeConnection} param.connection A connection to the server
     * @param {IStorage} param.storage A storage
     * @param {string} param.seed 24 words separated by space
     * @param {string} [param.passphrase=''] Wallet passphrase
     * @param {string} [param.xpriv]
     * @param {string} [param.xpub]
     * @param {string} [param.tokenUid] UID of the token to handle on this wallet
     * @param {string} [param.password] Password to encrypt the seed
     * @param {string} [param.pinCode] PIN to execute wallet actions
     * @param {boolean} [param.debug] Activates debug mode
     * @param {{pubkeys:string[],numSignatures:number}} [param.multisig]
     * @param {string[]} [param.preCalculatedAddresses] An array of pre-calculated addresses
     * @param {import('../types').AddressScanPolicyData} [param.scanPolicy] config specific to
     * the address scan policy.
     */
    constructor({ connection, storage, seed, passphrase, xpriv, xpub, tokenUid, password, pinCode, debug, beforeReloadCallback, multisig, preCalculatedAddresses, scanPolicy, }?: {
        connection: any;
        storage: any;
        seed: any;
        passphrase?: string | undefined;
        xpriv: any;
        xpub: any;
        tokenUid?: string | undefined;
        password?: null | undefined;
        pinCode?: null | undefined;
        debug?: boolean | undefined;
        beforeReloadCallback?: null | undefined;
        multisig?: null | undefined;
        preCalculatedAddresses?: null | undefined;
        scanPolicy?: null | undefined;
    });
    /**
     * Gets the current server url from connection
     * @return {string} The server url. Ex.: 'http://server.com:8083'
     */
    getServerUrl(): any;
    /**
     * Gets the current network from connection
     * @return {string} The network name. Ex.: 'mainnet', 'testnet'
     */
    getNetwork(): any;
    /**
     * Gets the network model object
     */
    getNetworkObject(): Network;
    /**
     * Gets version data from the fullnode
     *
     * @return {FullNodeVersionData} The data information from the fullnode
     *
     * @memberof HathorWallet
     * @inner
     * */
    getVersionData(): Promise<{
        timestamp: number;
        version: any;
        network: any;
        minWeight: any;
        minTxWeight: any;
        minTxWeightCoefficient: any;
        minTxWeightK: any;
        tokenDepositPercentage: any;
        rewardSpendMinBlocks: any;
        maxNumberInputs: any;
        maxNumberOutputs: any;
    }>;
    /**
     * Set the server url to connect to
     * @param {String} newServer The new server to change to
     *
     * @memberof HathorWallet
     * @inner
     * */
    changeServer(newServer: any): void;
    /**
     * Set the value of the gap limit for this wallet instance.
     * @param {number} value The new gap limit value
     * @returns {Promise<void>}
     */
    setGapLimit(value: any): Promise<any>;
    /**
     * Load more addresses if configured to index-limit scanning policy.
     * @param {number} count Number of addresses to load
     * @returns {Promise<number>} The index of the last address loaded
     */
    indexLimitLoadMore(count: any): Promise<any>;
    /**
     * Set the value of the index limit end for this wallet instance.
     * @param {number} endIndex The new index limit value
     * @returns {Promise<void>}
     */
    indexLimitSetEndIndex(endIndex: any): Promise<void>;
    /**
     * Get the value of the gap limit for this wallet instance.
     * @returns {Promise<number>}
     */
    getGapLimit(): Promise<any>;
    /**
     * Get the access data object from storage.
     * @returns {Promise<import('../types').IWalletAccessData>}
     */
    getAccessData(): Promise<any>;
    /**
     * Get the configured wallet type.
     * @returns {Promise<string>} The wallet type
     */
    getWalletType(): Promise<any>;
    /**
     * Get the multisig data object from storage.
     * Only works if the wallet is a multisig wallet.
     *
     * @returns {Promise<import('../types').IMultisigData>}
     */
    getMultisigData(): Promise<any>;
    /**
     * Enable debug mode.
     * */
    enableDebugMode(): void;
    /**
     * Disable debug mode.
     */
    disableDebugMode(): void;
    /**
     * Check that this wallet is readonly.
     * This can be shortcircuted if the wallet is meant to be signed externally.
     * @returns {Promise<boolean>}
     */
    isReadonly(): Promise<any>;
    /**
     * Called when the connection to the websocket changes.
     * It is also called if the network is down.
     *
     * @param {Number} newState Enum of new state after change
     */
    onConnectionChangedState(newState: any): Promise<void>;
    /**
     * Sign and return all signatures of the inputs belonging to this wallet.
     *
     * @param {string} txHex hex representation of the transaction.
     * @param {string} pin PIN to decrypt the private key
     *
     * @async
     * @return {Promise<string>} serialized P2SHSignature data
     *
     * @memberof HathorWallet
     * @inner
     */
    getAllSignatures(txHex: any, pin: any): Promise<string>;
    /**
     * Assemble transaction from hex and collected p2sh_signatures.
     *
     * @param {string} txHex hex representation of the transaction.
     * @param {Array} signatures Array of serialized p2sh_signatures (string).
     *
     * @return {Promise<Transaction>} with input data created from the signatures.
     *
     * @throws {Error} if there are not enough signatures for an input
     *
     * @memberof HathorWallet
     * @inner
     */
    assemblePartialTransaction(txHex: any, signatures: any): Promise<import("..").Transaction | import("..").CreateTokenTransaction>;
    /**
     * Return all addresses of the wallet with info of each of them
     *
     * @async
     * @generator
     * @returns {AsyncGenerator<{address: string, index: number, transactions: number}>} transactions is the count of txs for this address
     * @memberof HathorWallet
     * */
    getAllAddresses(): AsyncGenerator<{
        address: any;
        index: any;
        transactions: any;
    }, void, unknown>;
    /**
     * Get address from specific derivation index
     *
     * @return {Promise<string>} Address
     *
     * @memberof HathorWallet
     * @inner
     */
    getAddressAtIndex(index: any): Promise<any>;
    /**
     * Get address path from specific derivation index
     *
     * @param {number} index Address path index
     *
     * @return {Promise<string>} Address path for the given index
     *
     * @memberof HathorWallet
     * @inner
     */
    getAddressPathForIndex(index: any): Promise<string>;
    /**
     * Get address to be used in the wallet
     *
     * @param [options]
     * @param {boolean} [options.markAsUsed=false] if true, we will locally mark this address as used
     *                                             and won't return it again to be used
     *
     * @return {Promise<{ address:string, index:number, addressPath:string }>}
     *
     * @memberof HathorWallet
     * @inner
     */
    getCurrentAddress({ markAsUsed }?: {
        markAsUsed?: boolean | undefined;
    }): Promise<{
        address: any;
        index: any;
        addressPath: string;
    }>;
    /**
     * Get the next address after the current available
     *
     * @return {Promise<{ address:string, index:number, addressPath:string }>}
     */
    getNextAddress(): Promise<{
        address: any;
        index: any;
        addressPath: string;
    }>;
    /**
     * Called when a new message arrives from websocket.
     */
    handleWebsocketMsg(wsData: any): void;
    /**
     * Get balance for a token
     *
     * @param {string|null|undefined} token
     *
     * @return {Promise<{
     *   token: {id:string, name:string, symbol:string},
     *   balance: {unlocked:number, locked:number},
     *   transactions:number,
     *   lockExpires:number|null,
     *   tokenAuthorities: {unlocked: {mint:number,melt:number}, locked: {mint:number,melt:number}}
     * }[]>} Array of balance for each token
     *
     * @memberof HathorWallet
     * @inner
     * */
    getBalance(token?: null): Promise<{
        token: {
            id: any;
            name: any;
            symbol: any;
        };
        balance: any;
        transactions: any;
        lockExpires: null;
        tokenAuthorities: {
            unlocked: {
                mint: any;
                melt: any;
            };
            locked: {
                mint: any;
                melt: any;
            };
        };
    }[]>;
    /**
     * Summarizes the IHistoryTx that comes from wallet token's history.
     *
     * @typedef {Object} SummaryHistoryTx
     * @property {string} txId - Transaction hash
     * @property {number} balance
     * @property {number} timestamp
     * @property {boolean} voided
     * @property {number} version
     * @property {string} [ncId] - Nano Contract transaction hash
     * @property {string} [ncMethod] - Nano Contract method called
     * @property {Address} [ncCaller] - Nano Contract transaction's signing address
     * @property {string} [firstBlock] - Hash of the first block that validates the transaction
     */
    /**
     * Get transaction history
     *
     * @param options
     * @param {string} [options.token_id]
     * @param {number} [options.count]
     * @param {number} [options.skip]
     *
     * @return {Promise<SummaryHistoryTx[]>} Array of transactions
     *
     * @memberof HathorWallet
     * @inner
     * */
    getTxHistory(options?: {}): Promise<never[]>;
    /**
     * Get tokens that this wallet has transactions
     *
     * @return {Promise<string[]>} Array of strings (token uid)
     *
     * @memberof HathorWallet
     * @inner
     * */
    getTokens(): Promise<never[]>;
    /**
     * Get a transaction data from the wallet
     *
     * @param {string} id Hash of the transaction to get data from
     *
     * @return {Promise<DecodedTx|null>} Data from the transaction to get.
     *                          Can be null if the wallet does not contain the tx.
     */
    getTx(id: any): Promise<any>;
    /**
     * @typedef AddressInfoOptions
     * @property {string} token Optionally filter transactions by this token uid (Default: HTR)
     */
    /**
     * @typedef AddressInfo
     * @property {number} total_amount_received Sum of the amounts received
     * @property {number} total_amount_sent Sum of the amounts sent
     * @property {number} total_amount_available Amount available to transfer
     * @property {number} total_amount_locked Amount locked and thus no available to transfer
     * @property {number} token Token used to calculate the amounts received, sent, available and locked
     * @property {number} index Derivation path for the given address
     */
    /**
     * Get information of a given address
     *
     * @param {string} address Address to get information of
     * @param {AddressInfoOptions} options Optional parameters to filter the results
     *
     * @returns {Promise<AddressInfo>} Aggregated information about the given address
     *
     */
    getAddressInfo(address: any, options?: {}): Promise<{
        total_amount_received: number;
        total_amount_sent: number;
        total_amount_available: number;
        total_amount_locked: number;
        token: any;
        index: any;
    }>;
    /**
     *
     * @typedef UtxoOptions
     * @property {number} [max_utxos] - Maximum number of utxos to aggregate. Default to MAX_INPUTS (255).
     * @property {string} [token] - Token to filter the utxos. If not sent, we select only HTR utxos.
     * @property {number} [authorities] - Authorities to filter the utxos. If not sent, we select only non authority utxos.
     * @property {string} [filter_address] - Address to filter the utxos.
     * @property {number} [amount_smaller_than] - Maximum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount lower than or equal to this value. Integer representation of decimals, i.e. 100 = 1.00.
     * @property {number} [amount_bigger_than] - Minimum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount bigger than or equal to this value. Integer representation of decimals, i.e. 100 = 1.00.
     * @property {number} [max_amount] - Limit the maximum total amount to consolidate summing all utxos. Integer representation of decimals, i.e. 100 = 1.00.
     * @property {boolean} [only_available_utxos] - Use only available utxos (not locked)
     */
    /**
     * @typedef UtxoDetails
     * @property {number} total_amount_available - Maximum number of utxos to aggregate. Default to MAX_INPUTS (255).
     * @property {number} total_utxos_available - Token to filter the utxos. If not sent, we select only HTR utxos.
     * @property {number} total_amount_locked - Address to filter the utxos.
     * @property {number} total_utxos_locked - Maximum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount lower than this value. Integer representation of decimals, i.e. 100 = 1.00.
     * @property {{ address: string, amount: number, tx_id: string, locked: boolean, index: number }[]} utxos - Array of utxos
     */
    /**
     * Get utxos of the wallet addresses
     *
     * @param {UtxoOptions} options Utxo filtering options
     *
     * @return {Promise<UtxoDetails>} Utxos and meta information about it
     *
     */
    getUtxos(options?: {}): Promise<{
        total_amount_available: bigint;
        total_utxos_available: bigint;
        total_amount_locked: bigint;
        total_utxos_locked: bigint;
        utxos: never[];
    }>;
    /**
     * @typedef Utxo
     * @property {string} txId
     * @property {number} index
     * @property {string} tokenId
     * @property {string} address
     * @property {string} value
     * @property {bigint} authorities
     * @property {number|null} timelock
     * @property {number|null} heightlock
     * @property {boolean} locked
     * @property {string} addressPath
     */
    /**
     * Generates all available utxos
     *
     * @param [options] Utxo filtering options
     * @param {string} [options.token='00'] - Search for UTXOs of this token UID.
     * @param {string|null} [options.filter_address=null] - Address to filter the utxos.
     *
     * @async
     * @generator
     * @yields {Utxo} all available utxos
     */
    getAvailableUtxos(options?: {}): AsyncGenerator<{
        txId: any;
        index: any;
        tokenId: any;
        address: any;
        value: any;
        authorities: any;
        timelock: any;
        heightlock: null;
        locked: boolean;
        addressPath: string;
    }, void, unknown>;
    /**
     * Get utxos of the wallet addresses to fill the amount specified.
     *
     * @param {Object} [options] Utxo filtering options
     * @param {string} [options.token='00'] - Search for UTXOs of this token UID.
     * @param {string|null} [options.filter_address=null] - Address to filter the utxos.
     *
     * @return {Promise<{utxos: Utxo[], changeAmount: number}>} Utxos and change information.
     */
    getUtxosForAmount(amount: any, options?: {}): Promise<{
        utxos: import("../wallet/types").Utxo[];
        changeAmount: bigint;
    }>;
    /**
     * Mark UTXO selected_as_input.
     *
     * @param {string} txId Transaction id of the UTXO
     * @param {number} index Output index of the UTXO
     * @param {boolean} [value=true] The value to set the utxos.
     */
    markUtxoSelected(txId: any, index: any, value?: boolean): Promise<void>;
    /**
     * Prepare all required data to consolidate utxos.
     *
     * @typedef {Object} PrepareConsolidateUtxosDataResult
     * @property {{ address: string, value: bigint }[]} outputs - Destiny of the consolidated utxos
     * @property {{ hash: string, index: number }[]} inputs - Inputs for the consolidation transaction
     * @property {{ uid: string, name: string, symbol: string }} token - HTR or custom token
     * @property {{ address: string, amount: number, tx_id: string, locked: boolean, index: number }[]} utxos - Array of utxos that will be consolidated
     * @property {number} total_amount - Amount to be consolidated
     *
     * @param {string} destinationAddress Address of the consolidated utxos
     * @param {UtxoOptions} options Utxo filtering options
     *
     * @return {Promise<PrepareConsolidateUtxosDataResult>} Required data to consolidate utxos
     *
     */
    prepareConsolidateUtxosData(destinationAddress: any, options?: {}): Promise<{
        outputs: {
            address: any;
            value: bigint;
            token: any;
        }[];
        inputs: never[];
        utxos: never[];
        total_amount: bigint;
    }>;
    /**
     * @typedef ConsolidationResult
     * @property {number} total_utxos_consolidated - Number of utxos consolidated
     * @property {number} total_amount - Consolidated amount
     * @property {string} txId - Consolidated transaction id
     * @property {{
     *  address: string,
     *  amount: number,
     *  tx_id: string,
     *  locked: boolean,
     *  index: number
     * }[]} utxos - Array of consolidated utxos
     */
    /**
     * Consolidates many utxos into a single one for either HTR or exactly one custom token.
     *
     * @param {string} destinationAddress Address of the consolidated utxos
     * @param {UtxoOptions} options Utxo filtering options
     *
     * @return {Promise<ConsolidationResult>} Indicates that the transaction is sent or not
     *
     */
    consolidateUtxos(destinationAddress: any, options?: {}): Promise<{
        total_utxos_consolidated: number;
        total_amount: bigint;
        txId: string | null;
        utxos: never[];
    }>;
    /**
     * @typedef DecodedTx
     * @property {string} tx_id
     * @property {number} version
     * @property {number} weight
     * @property {number} timestamp
     * @property {boolean} is_voided
     * @property {{
     *   value: bigint,
     *   token_data: number,
     *   script: string,
     *   decoded: { type: string, address: string, timelock: number|null },
     *   token: string,
     *   tx_id: string,
     *   index: number
     * }[]} inputs
     * @property {{
     *   value: bigint,
     *   token_data: number,
     *   script: string,
     *   decoded: { type: string, address: string, timelock: number|null },
     *   token: string,
     *   spent_by: string|null,
     *   selected_as_input?: boolean
     * }[]} outputs
     * @property {string[]} parents
     */
    /**
     * Get full wallet history (same as old method to be used for compatibility)
     *
     * @return {Promise<Record<string,DecodedTx>>} Object with transaction data { tx_id: { full_transaction_data }}
     *
     * @memberof HathorWallet
     * @inner
     * */
    getFullHistory(): Promise<{}>;
    /**
     * Process the transactions on the websocket transaction queue as if they just arrived.
     *
     * @memberof HathorWallet
     * @inner
     */
    processTxQueue(): Promise<void>;
    /**
     * Check if we need to load more addresses and load them if needed.
     * The configured scanning policy will be used to determine the loaded addresses.
     * @param {boolean} processHistory If we should process the txs found on the loaded addresses.
     *
     * @returns {Promise<void>}
     */
    scanAddressesToLoad(processHistory?: boolean): Promise<void>;
    /**
     * Call the method to process data and resume with the correct state after processing.
     *
     * @returns {Promise} A promise that resolves when the wallet is done processing the tx queue.
     */
    onEnterStateProcessing(): Promise<void>;
    setState(state: any): void;
    onNewTx(wsData: any): Promise<void>;
    /**
     * Send a transaction with a single output
     *
     * @param {string} address Output address
     * @param {Number} value Output value
     * @param [options] Options parameters
     * @param {string} [options.changeAddress] address of the change output
     * @param {string} [options.token] token uid
     * @param {string} [options.pinCode] pin to decrypt the private key
     *
     * @return {Promise<Transaction>} Promise that resolves when transaction is sent
     */
    sendTransaction(address: any, value: any, options?: {}): Promise<import("..").Transaction | null>;
    /**
     * Send a transaction from its outputs
     *
     * @param {{
     *   address: string,
     *   value: bigint,
     *   timelock?: number,
     *   token: string
     * }[]} outputs Array of proposed outputs
     * @param [options]
     * @param {{
     *   txId: string,
     *   index: number,
     *   token: string
     * }[]} [options.inputs] Array of proposed inputs
     * @param {string} [options.changeAddress] address of the change output
     * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
     * @param {string} [options.pinCode] pin to decrypt xpriv information.
     *                                   Optional but required if not set in this
     *
     * @return {Promise<Transaction>} Promise that resolves when transaction is sent
     */
    sendManyOutputsTransaction(outputs: any, options?: {}): Promise<import("..").Transaction | null>;
    /**
     * Connect to the server and start emitting events.
     *
     * @param {Object} optionsParams Options parameters
     *  {
     *   'pinCode': pin to decrypt xpriv information. Required if not set in object.
     *   'password': password to decrypt xpriv information. Required if not set in object.
     *  }
     */
    start(optionsParams?: {}): Promise<unknown>;
    /**
     * Close the connections and stop emitting events.
     */
    stop({ cleanStorage, cleanAddresses, cleanTokens }?: {
        cleanStorage?: boolean | undefined;
        cleanAddresses?: boolean | undefined;
        cleanTokens?: boolean | undefined;
    }): Promise<void>;
    /**
     * Returns an address' HDPrivateKey given an index and the encryption password
     *
     * @param {string} pinCode - The PIN used to encrypt data in accessData
     * @param {number} addressIndex - The address' index to fetch
     *
     * @returns {Promise<HDPrivateKey>} Promise that resolves with the HDPrivateKey
     *
     * @memberof HathorWallet
     * @inner
     */
    getAddressPrivKey(pinCode: any, addressIndex: any): Promise<any>;
    /**
     * Returns a base64 encoded signed message with an address' private key given an
     * andress index
     *
     * @param {string} message - The message to sign
     * @param {number} index - The address index to sign with
     * @param {string} pinCode - The PIN used to encrypt data in accessData
     *
     * @return {Promise} Promise that resolves with the signed message
     *
     * @memberof HathorWallet
     * @inner
     */
    signMessageWithAddress(message: any, index: any, pinCode: any): Promise<string>;
    /**
     * Create SendTransaction object and run from mining
     * Returns a promise that resolves when the send succeeds
     *
     * @param {Transaction} transaction Transaction object to be mined and pushed to the network
     *
     * @return {Promise} Promise that resolves with transaction object if succeeds
     * or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     */
    handleSendPreparedTransaction(transaction: any): Promise<import("..").Transaction>;
    /**
     * Prepare create token transaction data before mining
     *
     * @param {string} name Name of the token
     * @param {string} symbol Symbol of the token
     * @param {bigint} amount Quantity of the token to be minted
     * @param [options] Options parameters
     * @param {string} [options.address] address of the minted token,
     * @param {string} [options.changeAddress] address of the change output,
     * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
     * @param {string} [options.pinCode] pin to decrypt xpriv information. Optional but required if not set in this
     * @param {boolean} [options.createMint=true] if should create mint authority with the token
     * @param {string} [options.mintAuthorityAddress] the address to send the mint authority created
     * @param {boolean} [options.allowExternalMintAuthorityAddress=false] allow the mint authority address
     *                                                                    to be from another wallet
     * @param {boolean} [options.createMelt=true] if should create melt authority with the token
     * @param {string} [options.meltAuthorityAddress] the address to send the melt authority created
     * @param {boolean} [options.allowExternalMeltAuthorityAddress=false] allow the melt authority address
     *                                                                    to be from another wallet
     * @param {string[]|null} [options.data=null] list of data strings using utf8 encoding to add each as a data script output
     *
     * @param {boolean} [options.signTx] sign transaction instance (default true)
     * @param {boolean} [options.isCreateNFT=false] if the create token is an NFT creation call
     *
     * @return {CreateTokenTransaction} Promise that resolves with transaction object if succeeds
     * or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     */
    prepareCreateNewToken(name: any, symbol: any, amount: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * @typedef BaseTransactionResponse
     * @property {{hash:string, index:number, data:Buffer}[]} inputs
     * @property {{value:number, script:Buffer, tokenData:number, decodedScript:*}[]} outputs
     * @property {number} version
     * @property {number} weight
     * @property {number} nonce
     * @property {number} timestamp
     * @property {string[]} parents
     * @property {string[]} tokens
     * @property {string} hash
     * @property {*} _dataToSignCache
     */
    /**
     * @typedef CreateNewTokenResponse
     * @extends BaseTransactionResponse
     * @property {string} name
     * @property {string} symbol
     */
    /**
     * Create a new token for this wallet
     *
     * @param {string} name Name of the token
     * @param {string} symbol Symbol of the token
     * @param {bigint} amount Quantity of the token to be minted
     * @param [options] Options parameters
     * @param {string} [options.address] address of the minted token
     * @param {string} [options.changeAddress] address of the change output
     * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
     * @param {string} [options.pinCode] pin to decrypt xpriv information.
     *                                   Optional but required if not set in this
     * @param {boolean} [options.createMint=true] should create mint authority
     * @param {string} [options.mintAuthorityAddress] the address to send the mint authority created
     * @param {boolean} [options.allowExternalMintAuthorityAddress=false] allow the mint authority address
     *                                                                    to be from another wallet
     * @param {boolean} [options.createMelt=true] should create melt authority
     * @param {string} [options.meltAuthorityAddress] the address to send the melt authority created
     * @param {boolean} [options.allowExternalMeltAuthorityAddress=false] allow the melt authority address
     *                                                                    to be from another wallet
     * @param {string[]|null} [options.data=null] list of data strings using utf8 encoding to add each as a data script output
     *
     * @return {Promise<CreateNewTokenResponse>}
     * @memberof HathorWallet
     * @inner
     * */
    createNewToken(name: any, symbol: any, amount: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Get mint authorities
     *
     * @param {string} tokenUid UID of the token to select the authority utxo
     * @param [options] Object with custom options.
     * @param {boolean} [options.many=false] if should return many utxos or just one (default false)
     *
     * @return {Promise<{
     *   txId: string,
     *   index: number,
     *   address: string,
     *   authorities: bigint
     * }[]>} Promise that resolves with an Array of objects with properties of the authority output.
     *       The "authorities" field actually contains the output value with the authority masks.
     *       Returns an empty array in case there are no tx_outupts for this type.
     * */
    getMintAuthority(tokenUid: any, options?: {}): Promise<never[]>;
    /**
     * Get melt authorities
     *
     * @param {string} tokenUid UID of the token to select the authority utxo
     * @param [options] Object with custom options.
     * @param {boolean} [options.many=false] if should return many utxos or just one (default false)
     *
     * @return {Promise<{
     *   txId: string,
     *   index: number,
     *   address: string,
     *   authorities: bigint
     * }[]>} Promise that resolves with an Array of objects with properties of the authority output.
     *       The "authorities" field actually contains the output value with the authority masks.
     *       Returns an empty array in case there are no tx_outupts for this type.
     * */
    getMeltAuthority(tokenUid: any, options?: {}): Promise<never[]>;
    /**
     * Prepare mint transaction before mining
     *
     * @param {string} tokenUid UID of the token to mint
     * @param {bigint} amount Quantity to mint
     * @param {Object} options Options parameters
     *  {
     *   'address': destination address of the minted token
     *   'changeAddress': address of the change output
     *   'startMiningTx': boolean to trigger start mining (default true)
     *   'createAnotherMint': boolean to create another mint authority or not for the wallet
     *   'mintAuthorityAddress': address to send the new mint authority created
     *   'allowExternalMintAuthorityAddress': boolean allow the mint authority address to be from another wallet (default false)
     *   'unshiftData': boolean to unshift the data script output
     *   'data': list of string to add as a data script output
     *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
     *   'signTx': boolean to sign transaction instance (default true)
     *  }
     *
     * @return {Promise} Promise that resolves with transaction object if succeeds
     * or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     * */
    prepareMintTokensData(tokenUid: any, amount: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Mint tokens
     *
     * @param {string} tokenUid UID of the token to mint
     * @param {bigint} amount Quantity to mint
     * @param [options] Options parameters
     * @param {string} [options.address] destination address of the minted token
     *                                   (if not sent we choose the next available address to use)
     * @param {string} [options.changeAddress] address of the change output
     *                                   (if not sent we choose the next available address to use)
     * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
     * @param {boolean} [options.createAnotherMint] boolean to create another mint authority or not
     *                                              for the wallet
     * @param {string} [options.mintAuthorityAddress] address to send the new mint authority created
     * @param {boolean} [options.allowExternalMintAuthorityAddress=false] allow the mint authority address
     *                                                                    to be from another wallet
     * @param {boolean} [options.unshiftData] whether to unshift the data script output
     * @param {string[]|null} [options.data=null] list of data strings using utf8 encoding to add each as a data script output
     * @param {string} [options.pinCode] pin to decrypt xpriv information.
     *                                   Optional but required if not set in this
     *
     * @return {Promise<BaseTransactionResponse>} Promise that resolves with transaction object
     *                                           if it succeeds or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     * */
    mintTokens(tokenUid: any, amount: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Prepare melt transaction before mining
     *
     * @param {string} tokenUid UID of the token to melt
     * @param {bigint} amount Quantity to melt
     * @param {Object} options Options parameters
     *  {
     *   'address': address of the HTR deposit back
     *   'changeAddress': address of the change output
     *   'createAnotherMelt': boolean to create another melt authority or not for the wallet
     *   'meltAuthorityAddress': address to send the new melt authority created
     *   'allowExternalMeltAuthorityAddress': boolean allow the melt authority address to be from another wallet (default false)
     *   'unshiftData': boolean to unshift the data script output
     *   'data': list of string to add as a data script output
     *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
     *   'signTx': boolean to sign transaction instance (default true)
     *  }
     *
     * @return {Promise} Promise that resolves with transaction object if succeeds
     * or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     * */
    prepareMeltTokensData(tokenUid: any, amount: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Melt tokens
     *
     * @param {string} tokenUid UID of the token to melt
     * @param {bigint} amount Quantity to melt
     * @param [options] Options parameters
     * @param {string} [options.address]: address of the HTR deposit back
     * @param {string} [options.changeAddress] address of the change output
     * @param {boolean} [options.createAnotherMelt] boolean to create another melt authority or not
     *                                              for the wallet
     * @param {string} [options.meltAuthorityAddress] address to send the new melt authority created
     * @param {boolean} [options.allowExternalMeltAuthorityAddress=false] allow the melt authority address
     *                                                                    to be from another wallet
     * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
     * @param {boolean} [options.unshiftData=false] boolean to unshift the data script output
     * @param {string[]|null} [options.data=null] list of data strings using utf8 encoding to add each as a data script output
     * @param {string} [options.pinCode] pin to decrypt xpriv information.
     *                                   Optional but required if not set in this
     *
     * @return {Promise<BaseTransactionResponse>} Promise that resolves with transaction object
     *                                            if it succeeds or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     * */
    meltTokens(tokenUid: any, amount: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Prepare delegate authority transaction before mining
     *
     * @param {string} tokenUid UID of the token to delegate the authority
     * @param {string} type Type of the authority to delegate 'mint' or 'melt'
     * @param {string} destinationAddress Destination address of the delegated authority
     * @param {Object} options Options parameters
     *  {
     *   'createAnother': if should create another authority for the wallet. Default to true
     *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
     *  }
     *
     * @return {Promise} Promise that resolves with transaction object if succeeds
     * or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     * */
    prepareDelegateAuthorityData(tokenUid: any, type: any, destinationAddress: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Delegate authority
     *
     * @param {string} tokenUid UID of the token to delegate the authority
     * @param {'mint'|'melt'} type Type of the authority to delegate 'mint' or 'melt'
     * @param {string} destinationAddress Destination address of the delegated authority
     * @param [options] Options parameters
     * @param {boolean} [options.createAnother=true] Should create another authority for the wallet.
     *                                               Default to true
     * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
     * @param {string} [options.pinCode] pin to decrypt xpriv information.
     *                                   Optional but required if not set in this
     *
     * @return {Promise<BaseTransactionResponse>} Promise that resolves with transaction object
     *                                            if it succeeds or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     * */
    delegateAuthority(tokenUid: any, type: any, destinationAddress: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Prepare destroy authority transaction before mining
     *
     * @param {string} tokenUid UID of the token to delegate the authority
     * @param {string} type Type of the authority to delegate 'mint' or 'melt'
     * @param {number} count How many authority outputs to destroy
     * @param {Object} options Options parameters
     *  {
     *   'startMiningTx': boolean to trigger start mining (default true)
     *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
     *  }
     *
     * @return {Promise} Promise that resolves with transaction object if succeeds
     * or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     * */
    prepareDestroyAuthorityData(tokenUid: any, type: any, count: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Destroy authority
     *
     * @param {string} tokenUid UID of the token to destroy the authority
     * @param {'mint'|'melt'} type Type of the authority to destroy: 'mint' or 'melt'
     * @param {number} count How many authority outputs to destroy
     * @param [options] Options parameters
     * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
     * @param {string} [options.pinCode] pin to decrypt xpriv information.
     *                                   Optional but required if not set in this
     *
     * @return {Promise<BaseTransactionResponse>} Promise that resolves with transaction object
     *                                            if it succeeds or with error message if it fails
     *
     * @memberof HathorWallet
     * @inner
     * */
    destroyAuthority(tokenUid: any, type: any, count: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Remove sensitive data from memory
     *
     * NOTICE: This won't remove data from memory immediately, we have to wait until javascript
     * garbage collect it. JavaScript currently does not provide a standard way to trigger
     * garbage collection
     * */
    clearSensitiveData(): void;
    /**
     * Get all authorities utxos for specific token
     *
     * @param {string} tokenUid UID of the token to delegate the authority
     * @param {"mint"|"melt"} type Type of the authority to search for: 'mint' or 'melt'
     *
     * @return {{tx_id: string, index: number, address: string, authorities: bigint}[]}
     *    Array of the authority outputs.
     * */
    getAuthorityUtxos(tokenUid: any, type: any): Promise<never[]>;
    getTokenData(): void;
    /**
     * Call get token details API
     *
     * @param tokenId Token uid to get the token details
     *
     * @return {Promise<{
     *   totalSupply: number,
     *   totalTransactions: number,
     *   tokenInfo: {
     *     name: string,
     *     symbol: string,
     *   },
     *   authorities: {
     *     mint: boolean,
     *     melt: boolean,
     *   },
     * }>} token details
     */
    getTokenDetails(tokenId: any): Promise<{
        totalSupply: any;
        totalTransactions: any;
        tokenInfo: {
            name: any;
            symbol: any;
        };
        authorities: {
            mint: boolean;
            melt: boolean;
        };
    }>;
    isReady(): boolean;
    /**
     * Check if address is from the loaded wallet
     *
     * @param {string} address Address to check
     *
     * @return {Promise<boolean>}
     * */
    isAddressMine(address: any): Promise<any>;
    /**
     * Check if a list of addresses are from the loaded wallet
     *
     * @param {string[]} addresses Addresses to check
     *
     * @return {Object} Object with the addresses and whether it belongs or not { address: boolean }
     * */
    checkAddressesMine(addresses: any): Promise<{}>;
    /**
     * Get index of address
     * Returns null if address does not belong to the wallet
     *
     * @param {string} address Address to get the index
     *
     * @return {Promise<number | null>}
     * */
    getAddressIndex(address: any): Promise<any>;
    /**
     * FIXME: does not differentiate between locked and unlocked, also ignores authorities
     * Returns the balance for each token in tx, if the input/output belongs to this wallet
     *
     * @param {DecodedTx} tx Decoded transaction with populated data from local wallet history
     * @param [optionsParam]
     * @param {boolean} [optionsParam.includeAuthorities=false] Retrieve authority balances if true
     *
     * @return {Promise<Record<string,number>>} Promise that resolves with an object with each token
     *                                          and it's balance in this tx for this wallet
     *
     * @example
     * const decodedTx = hathorWalletInstance.getTx(txHash);
     * const txBalance = await hathorWalletInstance.getTxBalance(decodedTx);
     * */
    getTxBalance(tx: any, optionsParam?: {}): Promise<{}>;
    /**
     * Return the addresses of the tx that belongs to this wallet
     * The address might be in the input or output
     * Removes duplicates
     *
     * @param {DecodedTx} tx Transaction data with array of inputs and outputs
     *
     * @return {Set<string>} Set of strings with addresses
     * */
    getTxAddresses(tx: any): Promise<Set<unknown>>;
    /**
     * Create an NFT for this wallet
     *
     * @param {string} name Name of the token
     * @param {string} symbol Symbol of the token
     * @param {bigint} amount Quantity of the token to be minted
     * @param {string} data NFT data string using utf8 encoding
     * @param [options] Options parameters
     * @param {string} [options.address] address of the minted token,
     * @param {string} [options.changeAddress] address of the change output,
     * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
     * @param {string} [options.pinCode] pin to decrypt xpriv information.
     *                                   Optional but required if not set in this
     * @param {boolean} [options.createMint=false] should create mint authority
     * @param {string} [options.mintAuthorityAddress] the address to send the mint authority created
     * @param {boolean} [options.allowExternalMintAuthorityAddress=false] allow the mint authority address
     *                                                                    to be from another wallet
     * @param {boolean} [options.createMelt=false] should create melt authority
     * @param {string} [options.meltAuthorityAddress] the address to send the melt authority created
     * @param {boolean} [options.allowExternalMeltAuthorityAddress=false] allow the melt authority address
     *                                                                    to be from another wallet
     *
     * @return {Promise<CreateNewTokenResponse>}
     *
     * @memberof HathorWallet
     * @inner
     * */
    createNFT(name: any, symbol: any, amount: any, data: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Identify all inputs from the loaded wallet
     *
     * @param {Transaction} tx The transaction
     *
     * @returns {Promise<{
     * inputIndex: number,
     * addressIndex: number,
     * addressPath: string,
     * }[]>} List of indexes and their associated address index
     */
    getWalletInputInfo(tx: any): Promise<never[]>;
    /**
     * Get signatures for all inputs of the loaded wallet.
     *
     * @param {Transaction} tx The transaction to be signed
     * @param [options]
     * @param {string} [options.pinCode] PIN to decrypt the private key.
     *                                   Optional but required if not set in this
     *
     * @async
     * @returns {Promise<{
     * inputIndex: number,
     * addressIndex: number,
     * addressPath: string,
     * signature: string,
     * pubkey: string,
     * }>} Input and signature information
     */
    getSignatures(tx: any, { pinCode }?: {
        pinCode?: null | undefined;
    }): Promise<never[]>;
    /**
     * Sign all inputs of the given transaction.
     *   OBS: only for P2PKH wallets.
     *
     * @param {Transaction} tx The transaction to be signed
     * @param [options]
     * @param {string} [options.pinCode] PIN to decrypt the private key.
     *                                   Optional but required if not set in this
     *
     * @returns {Promise<Transaction>} The signed transaction
     */
    signTx(tx: any, options?: {}): Promise<any>;
    /**
     * Guard to check if the response is a transaction not found response
     *
     * @param {Object} data The request response data
     *
     * @throws {TxNotFoundError} If the returned error was a transaction not found
     */
    static _txNotFoundGuard(data: any): void;
    /**
     * Queries the fullnode for a transaction
     *
     * @param {string} txId The transaction to query
     *
     * @returns {FullNodeTxResponse} Transaction data in the fullnode
     */
    getFullTxById(txId: any): Promise<unknown>;
    /**
     * Queries the fullnode for a transaction confirmation data
     *
     * @param {string} txId The transaction to query
     *
     * @returns {FullNodeTxConfirmationDataResponse} Transaction confirmation data
     */
    getTxConfirmationData(txId: any): Promise<unknown>;
    /**
     * Queries the fullnode for a graphviz graph, given a graph type and txId
     *
     * @param {string} txId The transaction to query
     * @param {string} graphType The graph type to query
     * @param {string} maxLevel Max level to render
     *
     * @returns {Promise<string>} The graphviz digraph
     */
    graphvizNeighborsQuery(txId: any, graphType: any, maxLevel: any): Promise<unknown>;
    /**
     * This function is responsible for getting the details of each token in the transaction.
     * @param {string} txId - Transaction id
     * @returns {Promise<{
     *   success: boolean
     *   txTokens: Array<{
     *     txId: string,
     *     timestamp: number,
     *     version: number,
     *     voided: boolean,
     *     weight: number,
     *     tokenName: string,
     *     tokenSymbol: string,
     *     balance: number
     *   }>
     * }>} Array of token details
     * @example
     * {
     *   success: true,
     *   txTokens: [
     *     {
     *      txId: '000021e7addbb94a8e43d7f1237d556d47efc4d34800c5923ed3a75bf5a2886e';
     *      timestamp: 123456789;
     *      version: 1;
     *      voided: false;
     *      weight: 18.5;
     *      tokenId: '00',
     *      tokenName: 'Hathor',
     *      tokenSymbol: 'HTR',
     *      balance: 100,
     *     },
     *   ],
     * }
     * @throws {Error} (propagation) Invalid transaction
     * @throws {Error} (propagation) Client did not use the callback
     * @throws {Error} (propagation) Transaction not found
     * @throws {Error} Transaction does not have any balance for this wallet
     * @throws {Error} Token uid not found in tokens list
     * @throws {Error} Token uid not found in tx
     */
    getTxById(txId: any): Promise<{
        success: boolean;
        txTokens: {
            txId: any;
            timestamp: any;
            version: any;
            voided: boolean;
            weight: any;
            tokenId: any;
            tokenName: any;
            tokenSymbol: any;
            balance: any;
        }[];
    }>;
    /**
     * Check if the pin used to encrypt the main key is valid.
     * @param {string} pin
     * @returns {Promise<boolean>}
     */
    checkPin(pin: any): Promise<any>;
    /**
     * Check if the password used to encrypt the seed is valid.
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    checkPassword(password: any): Promise<any>;
    /**
     * @param {string} pin
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    checkPinAndPassword(pin: any, password: any): Promise<any>;
    /**
     * Check if the wallet is a hardware wallet.
     * @returns {Promise<boolean>}
     */
    isHardwareWallet(): Promise<any>;
    /**
     * Create and send a nano contract transaction
     *
     * @param {string} method Method of nano contract to have the transaction created
     * @param {string} address Address that will be used to sign the nano contract transaction
     * @param [data]
     * @param {string | null} [data.blueprintId] ID of the blueprint to create the nano contract. Required if method is initialize
     * @param {string | null} [data.ncId] ID of the nano contract to execute method. Required if method is not initialize
     * @param {NanoContractAction[]} [data.actions] List of actions to execute in the nano contract transaction
     * @param {any[]} [data.args] List of arguments for the method to be executed in the transaction
     * @param [options]
     * @param {string} [options.pinCode] PIN to decrypt the private key.
     *                                   Optional but required if not set in this
     *
     * @returns {Promise<NanoContract>}
     */
    createAndSendNanoContractTransaction(method: any, address: any, data: any, options?: {}): Promise<import("..").Transaction>;
    /**
     * Create a nano contract transaction and return the SendTransaction object
     *
     * @param {string} method Method of nano contract to have the transaction created
     * @param {string} address Address that will be used to sign the nano contract transaction
     * @param [data]
     * @param {string | null} [data.blueprintId] ID of the blueprint to create the nano contract. Required if method is initialize
     * @param {string | null} [data.ncId] ID of the nano contract to execute method. Required if method is not initialize
     * @param {NanoContractAction[]} [data.actions] List of actions to execute in the nano contract transaction
     * @param {any[]} [data.args] List of arguments for the method to be executed in the transaction
     * @param [options]
     * @param {string} [options.pinCode] PIN to decrypt the private key.
     *                                   Optional but required if not set in this
     *
     * @returns {Promise<SendTransaction>}
     */
    createNanoContractTransaction(method: any, address: any, data: any, options?: {}): Promise<SendTransaction>;
    /**
     * Generate and return the PrivateKey for an address
     *
     * @param {string} address Address to get the PrivateKey from
     * @param [options]
     * @param {string} [options.pinCode] PIN to decrypt the private key.
     *                                   Optional but required if not set in this
     *
     * @returns {Promise<HDPrivateKey>}
     */
    getPrivateKeyFromAddress(address: any, options?: {}): Promise<any>;
    /**
     * Set the external tx signing method.
     * @param {EcdsaTxSign|null} method
     */
    setExternalTxSigningMethod(method: any): void;
}
export default HathorWallet;
//# sourceMappingURL=wallet.d.ts.map