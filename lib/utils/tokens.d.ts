/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { IDataInput, IDataTx, IStorage, ITokenData, OutputValueType, UtxoSelectionAlgorithm } from '../types';
declare const tokens: {
    /**
     * Validate the configuration string and if we should register the token in it.
     *
     * @param {string} config Configuration string to check
     * @param {IStorage | undefined} storage To check if we have a similarly named token in storage.
     * @param {string | undefined} uid Check that the configuration string matches this uid.
     * @returns {Promise<ITokenData>}
     */
    validateTokenToAddByConfigurationString(config: string, storage?: IStorage, uid?: string): Promise<ITokenData>;
    /**
     * Validate the token data and if we should register the token in it.
     *
     * - Check if the token is already registered.
     * - Check if we have a token in storage with the same name or symbol.
     * - Check the uid with the fullnode and fail if the name or symbol does not match.
     *
     * @param {ITokenData} tokenData Token data to check.
     * @param {IStorage | undefined} storage to check if we have a similarly named token in storage.
     * @returns {Promise<void>}
     */
    validadateTokenToAddByData(tokenData: ITokenData, storage?: IStorage): Promise<void>;
    /**
     * Check if we have a token with the same name or symbol in the storage.
     *
     * @param {IStorage} storage to retrieve the registered tokens.
     * @param {ITokenData} tokenData token we are searching.
     * @returns {Promise<null | { token: ITokenData, key: string }>}
     */
    checkDuplicateTokenInfo(tokenData: ITokenData, storage: IStorage): Promise<null | {
        token: ITokenData;
        key: string;
    }>;
    /**
     * Check if string is a valid configuration token string.
     *
     * @param {string} config Token configuration string
     *
     * @return {Boolean} If config string is valid
     *
     * @memberof Tokens
     * @inner
     */
    isConfigurationStringValid(config: string): boolean;
    /**
     * Returns token configuration string
     *
     * @param {string} uid Token uid
     * @param {string} name Token name
     * @param {string} symbol Token symbol
     *
     * @return {string} Configuration string of the token
     *
     * @memberof Tokens
     * @inner
     *
     */
    getConfigurationString(uid: string, name: string, symbol: string): string;
    /**
     * Returns token from configuration string
     * Configuration string has the following format:
     * [name:symbol:uid:checksum]
     *
     * @param {string} config Configuration string with token data plus a checksum
     *
     * @return {Object} token {'uid', 'name', 'symbol'} or null in case config is invalid
     *
     * @memberof Tokens
     * @inner
     *
     */
    getTokenFromConfigurationString(config: string): ITokenData | null;
    /**
     * Gets the token index to be added to the tokenData in the output from tx
     *
     * @param {Object} tokensArray Array of token configs
     * @param {Object} uid Token uid to return the index
     *
     * @return {number} Index of token to be set as tokenData in output tx
     *
     * @memberof Tokens
     * @inner
     */
    getTokenIndex(tokensArray: ITokenData[], uid: string): number;
    /**
     * Get token index from tokenData in output.
     * 0 is HTR and any other are mapped to the tx tokens array at index = tokenIndex - 1.
     * @param {number} tokenData Token data from output
     * @returns {number} Token index
     */
    getTokenIndexFromData(tokenData: number): number;
    /**
     * Checks if the uid passed is from Hathor token
     *
     * @param {string} uid UID to check if is Hathor's
     *
     * @return {boolean} true if is Hathor uid, false otherwise
     *
     * @memberof Tokens
     * @inner
     */
    isHathorToken(uid: string): boolean;
    /**
     * Calculate deposit value for the given token mint amount
     *
     * @param {OutputValueType} mintAmount Amount of tokens being minted
     * @param {number} [depositPercent=TOKEN_DEPOSIT_PERCENTAGE] token deposit percentage.
     *
     * @return {number}
     * @memberof Tokens
     * @inner
     *
     */
    getDepositAmount(mintAmount: OutputValueType, depositPercent?: number): OutputValueType;
    /**
     * Get the HTR value of the fee to add a data script output
     * @returns {OutputValueType} The fee to have a data script output
     */
    getDataScriptOutputFee(): OutputValueType;
    /**
     * Calculate withdraw value for the given token melt amount
     *
     * @param {OutputValueType} meltAmount Amount of tokens being melted
     * @param {number} [depositPercent=TOKEN_DEPOSIT_PERCENTAGE] token deposit percentage.
     *
     * @return {number}
     * @memberof Tokens
     * @inner
     *
     */
    getWithdrawAmount(meltAmount: OutputValueType, depositPercent?: number): OutputValueType;
    /**
     * Prepare the transaction data for minting tokens or creating tokens.
     *
     * @param address Where to send the minted tokens
     * @param amount Amount of tokens to mint
     * @param storage Storage instance of the wallet
     * @param [options={}] Options to mint tokens
     * @param {string|null} [options.token=null] Token to mint, may be null if we are creating the token
     * @param {IDataInput|null} [options.mintInput=null] Input to spend, may be null if we are creating the token
     * @param {boolean} [options.createAnotherMint=true] If a mint authority should be created on the transaction.
     * @param {string|null} [options.mintAuthorityAddress=null] The address to send the new mint authority created
     * @param {string|null} [options.changeAddress=null] The address to send any change output.
     * @param {boolean|null} [options.unshiftData=null] Whether to unshift the data script output.
     * @param {string[]|null} [options.data=null] list of data strings using utf8 encoding to add each as a data script output
     * @param {function} [options.utxoSelection=bestUtxoSelection] Algorithm to select utxos. Use the best method by default
     *
     * @returns {Promise<IDataTx>} The transaction data
     */
    prepareMintTxData(address: string, amount: OutputValueType, storage: IStorage, { token, mintInput, createAnotherMint, changeAddress, unshiftData, data, mintAuthorityAddress, utxoSelection, }?: {
        token?: string | null;
        mintInput?: IDataInput | null;
        createAnotherMint?: boolean;
        changeAddress?: string | null;
        unshiftData?: boolean | null;
        data?: string[] | null;
        mintAuthorityAddress?: string | null;
        utxoSelection?: UtxoSelectionAlgorithm;
    }): Promise<IDataTx>;
    /**
     * Generate melt transaction data
     *
     * @param {string} token Token to melt
     * @param {IDataInput} authorityMeltInput Input with authority to melt
     * @param {string} address Address to send the melted HTR tokens
     * @param {OutputValueType} amount The amount of tokens to melt
     * @param {IStorage} storage The storage object
     * @param {Object} [options={}] Options to create the melt transaction
     * @param {boolean} [options.createAnotherMelt=true] If should create another melt authority
     * @param {string | null} [options.meltAuthorityAddress=null] Address to send the new melt authority created
     * @param {string | null} [options.changeAddress=null] Address to send the change
     * @param {boolean|null} [options.unshiftData=null] Whether to unshift the data script output.
     * @param {string[]|null} [options.data=null] list of data strings using utf8 encoding to add each as a data script output
     * @param {function} [options.utxoSelection=bestUtxoSelection] Algorithm to select utxos. Use the best method by default
     * @returns {Promise<IDataTx>}
     */
    prepareMeltTxData(token: string, authorityMeltInput: IDataInput, address: string, amount: OutputValueType, storage: IStorage, { createAnotherMelt, meltAuthorityAddress, changeAddress, unshiftData, data, utxoSelection, }?: {
        createAnotherMelt?: boolean;
        meltAuthorityAddress?: string | null;
        changeAddress?: string | null;
        unshiftData?: boolean | null;
        data?: string[] | null;
        utxoSelection?: UtxoSelectionAlgorithm;
    }): Promise<IDataTx>;
    /**
     * Prepare transaction data to create a token.
     *
     * @param {string} address Address to create the token
     * @param {string} name Name of the token being created
     * @param {string} symbol Symbol of the token being created
     * @param {OutputValueType} mintAmount Amount of tokens to mint
     * @param {IStorage} storage Storage to get necessary data
     * @param {Object} [options={}] options to create the token
     * @param {string|null} [options.changeAddress=null] Address to send the change
     * @param {boolean} [options.createMint=true] Whether to create a mint output
     * @param {string} [options.mintAuthorityAddress] the address to send the mint authority created
     * @param {boolean} [options.createMelt=true] Whether to create a melt output
     * @param {string} [options.meltAuthorityAddress] the address to send the melt authority created
     * @param {string[]|null} [options.data=null] list of data strings using utf8 encoding to add each as a data script output
     * @param {boolean} [options.isCreateNFT=false] if the create token is an NFT creation call
     * @returns {Promise<IDataTx>} The transaction data to create the token
     */
    prepareCreateTokenData(address: string, name: string, symbol: string, mintAmount: OutputValueType, storage: IStorage, { changeAddress, createMint, mintAuthorityAddress, createMelt, meltAuthorityAddress, data, isCreateNFT, }?: {
        changeAddress?: string | null;
        createMint?: boolean;
        mintAuthorityAddress?: string | null;
        createMelt?: boolean;
        meltAuthorityAddress?: string | null;
        data?: string[] | null;
        isCreateNFT?: boolean;
    }): Promise<IDataTx>;
    /**
     * Prepare delegate authority transaction data.
     *
     * This method creates the tx data to delegate the authority of `authorityInput` to `address`.
     * So the we will create an output with the same authorities of the `authorityInput`.
     * Meaning that we do not yet support creating a mint only authority (authorities=1) from a mint/melt authority (authorities=3).
     *
     * @param {string} token Token to delegate authority
     * @param {IDataInput} authorityInput Utxo to spend
     * @param {string} address Address to send the authority
     * @param {IStorage} storage Storage instance of the wallet
     * @param {boolean} [createAnother=true] If we should create another authority in the current wallet
     * @returns {Promise<IDataTx>} Transaction data
     */
    prepareDelegateAuthorityTxData(token: string, authorityInput: IDataInput, address: string, storage: IStorage, createAnother?: boolean): Promise<IDataTx>;
    /**
     * Prepare transaction data to destroy authority utxos
     *
     * @param authorityInputs Authority inputs to destroy
     * @returns {IDataTx} Transaction data
     */
    prepareDestroyAuthorityTxData(authorityInputs: IDataInput[]): IDataTx;
};
export default tokens;
//# sourceMappingURL=tokens.d.ts.map