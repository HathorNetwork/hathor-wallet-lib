/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import Input from '../models/input';
import { ApiVersion, IStorage, IAddressInfo, IAddressMetadata, ITokenData, ITokenMetadata, IHistoryTx, IUtxo, IWalletAccessData, IStore, IUtxoFilterOptions, IWalletData, WalletType, IUtxoId, IDataTx, IDataInput, IDataOutput, IFillTxOptions, AddressScanPolicy, AddressScanPolicyData, IIndexLimitAddressScanPolicy, INcData, EcdsaTxSign, ITxSignatureData, OutputValueType, ILogger } from '../types';
import { Config } from '../config';
import FullNodeConnection from '../new/connection';
import Transaction from '../models/transaction';
export declare class Storage implements IStorage {
    store: IStore;
    utxosSelectedAsInput: Map<string, boolean>;
    config: Config;
    version: ApiVersion | null;
    txSignFunc: EcdsaTxSign | null;
    /**
     * This promise is used to chain the calls to process unlocked utxos.
     * This way we can avoid concurrent calls.
     * The best way to do this would be an async queue or a mutex, but to avoid adding
     * more dependencies we are using this simpler method.
     *
     * We can change this implementation to use a mutex or async queue in the future.
     */
    utxoUnlockWait: Promise<void>;
    logger: ILogger;
    constructor(store: IStore);
    /**
     * Set the fullnode api version data.
     * @param {ApiVersion} version Fullnode api version data
     */
    setApiVersion(version: ApiVersion): void;
    /**
     * Get the decimal places.
     * If not configured, will return the default DECIMAL_PLACES (2)
     * @returns {number}
     */
    getDecimalPlaces(): number;
    /**
     * Set the native token config on the store
     */
    saveNativeToken(): Promise<void>;
    /**
     * Gets the native token config
     *
     * @return {ITokenData} The native token config
     */
    getNativeTokenData(): ITokenData;
    /**
     * Set the logger instance to use.
     */
    setLogger(logger: ILogger): void;
    /**
     * Check if the tx signing method is set
     * @returns {boolean}
     */
    hasTxSignatureMethod(): boolean;
    /**
     * Set the tx signing function
     * @param {EcdsaTxSign} txSign The signing function
     */
    setTxSignatureMethod(txSign: EcdsaTxSign): void;
    /**
     * Sign the transaction
     * @param {Transaction} tx The transaction to sign
     * @param {string} pinCode The pin code
     * @returns {Promise<ITxSignatureData>} The signatures
     */
    getTxSignatures(tx: Transaction, pinCode: string): Promise<ITxSignatureData>;
    /**
     * Return the deposit percentage for creating tokens.
     * @returns {number}
     */
    getTokenDepositPercentage(): number;
    /**
     * Fetch all addresses from storage
     *
     * @async
     * @generator
     * @yields {Promise<IAddressInfo & Partial<IAddressMetadata>>} The addresses in store.
     */
    getAllAddresses(): AsyncGenerator<IAddressInfo & IAddressMetadata>;
    /**
     * Get the address info from store
     *
     * @param {string} base58 The base58 address to fetch
     * @async
     * @returns {Promise<(IAddressInfo & Partial<IAddressMetadata>)|null>} The address info or null if not found
     */
    getAddressInfo(base58: string): Promise<(IAddressInfo & IAddressMetadata) | null>;
    /**
     * Get the address at the given index
     *
     * @param {number} index
     * @async
     * @returns {Promise<IAddressInfo|null>} The address info or null if not found
     */
    getAddressAtIndex(index: number): Promise<IAddressInfo | null>;
    /**
     * Get the address public key, if not available derive from xpub
     * @param {number} index
     * @async
     * @returns {Promise<string>} The public key DER encoded in hex
     */
    getAddressPubkey(index: number): Promise<string>;
    /**
     * Check if the address is from our wallet.
     * @param {string} base58 The address encoded as base58
     * @returns {Promise<boolean>} If the address is known by the storage
     */
    isAddressMine(base58: string): Promise<boolean>;
    /**
     * Save address info on storage
     * @param {IAddressInfo} info Address info to save on storage
     * @returns {Promise<void>}
     */
    saveAddress(info: IAddressInfo): Promise<void>;
    /**
     * Get the current address.
     *
     * @param {boolean|undefined} markAsUsed If we should set the next address as current
     * @returns {Promise<string>} The address in base58 encoding
     */
    getCurrentAddress(markAsUsed?: boolean): Promise<string>;
    /**
     * Get a change address to use, if one is provided we need to check if we own it
     * If not provided, the current address will be used instead.
     *
     * @param {Object} [options={}]
     * @param {string|null|undefined} [options.changeAddress=undefined] User provided change address to use
     * @returns {Promise<string>} The change address to use
     */
    getChangeAddress({ changeAddress, }?: {
        changeAddress?: string | null | undefined;
    }): Promise<string>;
    /**
     * Iterate on the history of transactions.
     * @returns {AsyncGenerator<IHistoryTx>}
     */
    txHistory(): AsyncGenerator<IHistoryTx>;
    /**
     * Iterate on the history of transactions that include the given token.
     *
     * @param {string|undefined} [tokenUid='00'] Token to fetch, defaults to HTR
     * @returns {AsyncGenerator<IHistoryTx>}
     */
    tokenHistory(tokenUid?: string): AsyncGenerator<IHistoryTx>;
    /**
     * Fetch a transaction on the storage by it's id.
     *
     * @param {string} txId The transaction id to fetch
     * @returns {Promise<IHistoryTx | null>} The transaction or null if not on storage
     */
    getTx(txId: string): Promise<IHistoryTx | null>;
    /**
     * Get the transactions being spent by the given inputs if they belong in our wallet.
     *
     * @param {Input[]} inputs A list of inputs
     * @returns {AsyncGenerator<{tx: IHistoryTx, input: Input, index: number}>}
     */
    getSpentTxs(inputs: Input[]): AsyncGenerator<{
        tx: IHistoryTx;
        input: Input;
        index: number;
    }>;
    /**
     * Add a transaction on storage.
     *
     * @param {IHistoryTx} tx The transaction
     * @returns {Promise<void>}
     */
    addTx(tx: IHistoryTx): Promise<void>;
    /**
     * Process the transaction history to calculate the metadata.
     * @returns {Promise<void>}
     */
    processHistory(): Promise<void>;
    /**
     * Iterate on all tokens on the storage.
     *
     * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
     */
    getAllTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    /**
     * Iterate on all registered tokens of the wallet.
     *
     * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
     */
    getRegisteredTokens(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    /**
     * Get a token from storage along with the metadata of the wallet transactions.
     *
     * @param {string} token Token uid to fetch
     * @returns {Promise<(ITokenData & Partial<ITokenMetadata>)|null>}
     */
    getToken(token: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
    /**
     * Regsiter a token.
     * @param {ITokenData} token Token data to register
     * @returns {Promise<void>}
     */
    registerToken(token: ITokenData): Promise<void>;
    /**
     * Unregister a token from the wallet.
     * @param {Promise<void>} tokenUid Token uid to unregister.
     * @returns {Promise<void>}
     */
    unregisterToken(tokenUid: string): Promise<void>;
    /**
     * Return if a token is registered.
     * @param tokenUid - Token id.
     * @returns {Promise<boolean>}
     */
    isTokenRegistered(tokenUid: string): Promise<boolean>;
    /**
     * Process the locked utxos to unlock them if the lock has expired.
     * Will process both timelocked and heightlocked utxos.
     *
     * We will wait for any previous execution to finish before starting the next one.
     *
     * @param {number} height The network height to use as reference to unlock utxos
     * @returns {Promise<void>}
     */
    unlockUtxos(height: number): Promise<void>;
    /**
     * Iterate on all utxos of the wallet.
     * @returns {AsyncGenerator<IUtxo, any, unknown>}
     */
    getAllUtxos(): AsyncGenerator<IUtxo, void, void>;
    /**
     * Select utxos matching the request and do not select any utxos marked for inputs.
     *
     * @param {Omit<IUtxoFilterOptions, 'reward_lock'>} [options={}] Options to filter utxos and stop when the target is found.
     * @returns {AsyncGenerator<IUtxo, any, unknown>}
     */
    selectUtxos(options?: Omit<IUtxoFilterOptions, 'reward_lock'>): AsyncGenerator<IUtxo, void, void>;
    /**
     * Match the selected balance for the given authority and token.
     *
     * @param {OutputValueType} singleBalance The balance we want to match
     * @param {string} token The token uid
     * @param {OutputValueType} authorities The authorities we want to match
     * @param {string} changeAddress change address to use
     * @param {boolean} chooseInputs If we can add new inputs to the transaction
     * @returns {Promise<{inputs: IDataInput[], outputs: IDataOutput[]}>} The inputs and outputs that match the balance
     * @internal
     */
    matchBalanceSelection(singleBalance: OutputValueType, token: string, authorities: OutputValueType, changeAddress: string, chooseInputs: boolean): Promise<{
        inputs: IDataInput[];
        outputs: IDataOutput[];
    }>;
    /**
     * Generate inputs and outputs so that the transaction balance is filled.
     *
     * @param {string} token Token uid
     * @param {Record<'funds'|'mint'|'melt', number>} balance Balance of funds and authorities for a token on the transaction
     * @param {IFillTxOptions} [options={}]
     * @param {string} options.changeAddress Address to send change to
     * @param {boolean} [options.skipAuthorities=false] If we should fill authorities or only funds
     * @param {boolean} [options.chooseInputs=true] If we can choose inputs when needed or not
     * @returns {Promise<{inputs: IDataInput[], outputs: IDataOutput[]}>} The inputs and outputs to fill the transaction
     * @internal
     */
    matchTokenBalance(token: string, balance: Record<'funds' | 'mint' | 'melt', OutputValueType>, { changeAddress, skipAuthorities, chooseInputs }?: IFillTxOptions): Promise<{
        inputs: IDataInput[];
        outputs: IDataOutput[];
    }>;
    /**
     * Check the balance of the transaction and add inputs and outputs to match the funds and authorities.
     * It will fail if we do not have enough funds or authorities and it will fail if we try to add too many inputs or outputs.
     *
     * @param tx The incomplete transaction we need to fill
     * @param {IFillTxOptions} [options={}] options to use a change address.
     *
     * @async
     * @returns {Promise<void>}
     */
    fillTx(token: string, tx: IDataTx, options?: IFillTxOptions): Promise<{
        inputs: IDataInput[];
        outputs: IDataOutput[];
    }>;
    /**
     * Mark an utxo as selected as input
     *
     * @param {IUtxoId} utxo The Data to identify the utxo
     * @param {boolean} markAs Mark the utxo as this value
     * @param {number|undefined} ttl Unmark the utxo after this amount os ms passed
     *
     * @async
     * @returns {Promise<void>}
     */
    utxoSelectAsInput(utxo: IUtxoId, markAs: boolean, ttl?: number): Promise<void>;
    /**
     * Iterate over all locked utxos and unlock them if needed
     * When a utxo is unlocked, the balances and metadatas are updated
     * and the utxo is removed from the locked utxos.
     *
     * @param {number} height The new height of the best chain
     */
    processLockedUtxos(height: number): Promise<void>;
    /**
     * Check if an utxo is selected as input.
     *
     * @param {IUtxoId} utxo The utxo we want to check if it is selected as input
     * @returns {Promise<boolean>}
     * @example
     * const isSelected = await isUtxoSelectedAsInput({ txId: 'tx1', index: 0 });
     */
    isUtxoSelectedAsInput(utxo: IUtxoId): Promise<boolean>;
    /**
     * Iterate on all locked utxos.
     * Used to check if the utxos are still locked.
     *
     * @returns {AsyncGenerator<IUtxoId>}
     */
    utxoSelectedAsInputIter(): AsyncGenerator<IUtxoId>;
    /**
     * Helper to check if the access data exists before returning it.
     * Having the accessData as null means the wallet is not initialized so we should throw an error.
     *
     * @returns {Promise<IWalletAccessData>} The access data.
     * @internal
     */
    _getValidAccessData(): Promise<IWalletAccessData>;
    /**
     * Get the wallet's access data if the wallet is initialized.
     *
     * @returns {Promise<IWalletAccessData | null>}
     */
    getAccessData(): Promise<IWalletAccessData | null>;
    /**
     * Save the access data, initializing the wallet.
     *
     * @param {IWalletAccessData} data The wallet access data
     * @returns {Promise<void>}
     */
    saveAccessData(data: IWalletAccessData): Promise<void>;
    /**
     * Get the wallet's metadata.
     *
     * @returns {Promise<IWalletData>}
     */
    getWalletData(): Promise<IWalletData>;
    /**
     * Get the wallet type, i.e. P2PKH or MultiSig.
     *
     * @returns {Promise<WalletType>}
     */
    getWalletType(): Promise<WalletType>;
    /**
     * Set the current height
     * @param {number} height The current height
     * @returns {Promise<void>} The current height of the network
     */
    setCurrentHeight(height: number): Promise<void>;
    /**
     * Get the current height
     * @returns {Promise<number>} The current height
     */
    getCurrentHeight(): Promise<number>;
    /**
     * Return wheather the wallet is readonly, i.e. was started without the private key.
     * @returns {Promise<boolean>}
     */
    isReadonly(): Promise<boolean>;
    /**
     * Decrypt and return the main private key of the wallet.
     *
     * @param {string} pinCode Pin to unlock the private key
     * @returns {Promise<string>} The HDPrivateKey in string format.
     */
    getMainXPrivKey(pinCode: string): Promise<string>;
    /**
     * Get account path xprivkey if available.
     *
     * @param {string} pinCode
     * @returns {Promise<string>}
     */
    getAcctPathXPrivKey(pinCode: string): Promise<string>;
    /**
     * Decrypt and return the auth private key of the wallet.
     *
     * @param {string} pinCode Pin to unlock the private key
     * @returns {Promise<string>} The Auth HDPrivateKey in string format.
     */
    getAuthPrivKey(pinCode: string): Promise<string>;
    /**
     * Handle storage operations for a wallet being stopped.
     * @param {{
     *   connection?: FullNodeConnection;
     *   cleanStorage?: boolean;
     *   cleanAddresses?: boolean;
     *   cleanTokens?: boolean;
     * }} Options to handle stop
     * @returns {Promise<void>}
     */
    handleStop({ connection, cleanStorage, cleanAddresses, cleanTokens, }?: {
        connection?: FullNodeConnection;
        cleanStorage?: boolean;
        cleanAddresses?: boolean;
        cleanTokens?: boolean;
    }): Promise<void>;
    /**
     * Clean the storage data.
     *
     * @param {boolean} [cleanHistory=false] If we should clean the history data
     * @param {boolean} [cleanAddresses=false] If we should clean the address data
     * @param {boolean} [cleanTokens=false] If we should clean the registered tokens
     * @returns {Promise<void>}
     */
    cleanStorage(cleanHistory?: boolean, cleanAddresses?: boolean, cleanTokens?: boolean): Promise<void>;
    /**
     * Check if the pin is correct
     *
     * @param {string} pinCode - Pin to check
     * @returns {Promise<boolean>}
     * @throws {Error} if the wallet is not initialized
     * @throws {Error} if the wallet does not have the private key
     */
    checkPin(pinCode: string): Promise<boolean>;
    /**
     * Check if the password is correct
     *
     * @param {string} password - Password to check
     * @returns {Promise<boolean>}
     * @throws {Error} if the wallet is not initialized
     * @throws {Error} if the wallet does not have the private key
     */
    checkPassword(password: string): Promise<boolean>;
    /**
     * Change the wallet pin.
     * @param {string} oldPin Old pin to unlock data.
     * @param {string} newPin New pin to lock data.
     * @returns {Promise<void>}
     */
    changePin(oldPin: string, newPin: string): Promise<void>;
    /**
     * Change the wallet password.
     *
     * @param {string} oldPassword Old password
     * @param {string} newPassword New password
     * @returns {Promise<void>}
     */
    changePassword(oldPassword: string, newPassword: string): Promise<void>;
    /**
     * Set the wallet gap limit.
     * @param {number} value New gap limit to use.
     * @returns {Promise<void>}
     */
    setGapLimit(value: number): Promise<void>;
    /**
     * Get the wallet gap limit.
     * @returns {Promise<number>}
     */
    getGapLimit(): Promise<number>;
    /**
     * Get the index limit.
     * @returns {Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'>>}
     */
    getIndexLimit(): Promise<Omit<IIndexLimitAddressScanPolicy, 'policy'> | null>;
    /**
     * Get the scanning policy.
     * @returns {Promise<AddressScanPolicy>}
     */
    getScanningPolicy(): Promise<AddressScanPolicy>;
    /**
     * Set the scanning policy data.
     * @param {AddressScanPolicyData | null} data
     * @returns {Promise<void>}
     */
    setScanningPolicyData(data: AddressScanPolicyData | null): Promise<void>;
    /**
     * Get the scanning policy data.
     * @returns {Promise<AddressScanPolicyData>}
     */
    getScanningPolicyData(): Promise<AddressScanPolicyData>;
    /**
     * Return if the loaded wallet was started from a hardware wallet.
     * @returns {Promise<boolean>}
     */
    isHardwareWallet(): Promise<boolean>;
    /**
     * Return if the nano contract is registered for the given address based on ncId.
     * @param ncId Nano Contract ID.
     * @returns `true` if registered and `false` otherwise.
     * @async
     */
    isNanoContractRegistered(ncId: string): Promise<boolean>;
    /**
     * Iterate on all registered nano contracts of the wallet.
     *
     * @async
     * @generator
     * @returns {AsyncGenerator<INcData>}
     */
    getRegisteredNanoContracts(): AsyncGenerator<INcData>;
    /**
     * Get nano contract data.
     * @param ncId Nano Contract ID.
     * @returns An instance of Nano Contract data.
     */
    getNanoContract(ncId: string): Promise<INcData | null>;
    /**
     * Register nano contract data instance.
     * @param ncId Nano Contract ID.
     * @param ncValue Nano Contract basic information.
     */
    registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
    /**
     * Unregister nano contract.
     * @param ncId Nano Contract ID.
     */
    unregisterNanoContract(ncId: string): Promise<void>;
    /**
     * Update nano contract registered address
     * @param ncId Nano Contract ID.
     * @param address New registered address
     */
    updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void>;
}
//# sourceMappingURL=storage.d.ts.map