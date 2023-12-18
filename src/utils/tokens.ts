/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { CREATE_TOKEN_TX_VERSION, HATHOR_TOKEN_CONFIG, TOKEN_DEPOSIT_PERCENTAGE, TOKEN_MELT_MASK, TOKEN_MINT_MASK, TOKEN_INDEX_MASK } from '../constants';
import helpers from './helpers';
import buffer from 'buffer';
import { IDataInput, IDataOutput, IDataTx, IStorage, ITokenData, UtxoSelectionAlgorithm } from '../types';
import { getAddressType } from './address';
import { InsufficientFundsError, TokenValidationError } from '../errors';
import { bestUtxoSelection } from './utxo';
import walletApi from '../api/wallet';


const tokens = {

  /**
   * Validate the configuration string and if we should register the token in it.
   *
   * @param {string} config Configuration string to check
   * @param {IStorage | undefined} storage To check if we have a similarly named token in storage.
   * @param {string | undefined} uid Check that the configuration string matches this uid.
   * @returns {Promise<ITokenData>}
   */
  async validateTokenToAddByConfigurationString(config: string, storage?: IStorage, uid?: string): Promise<ITokenData> {
    const tokenData = this.getTokenFromConfigurationString(config);
    if (!tokenData) {
      throw new TokenValidationError('Invalid configuration string');
    }
    if (uid && tokenData.uid !== uid) {
      throw new TokenValidationError(`Configuration string uid does not match: ${uid} != ${tokenData.uid}`)
    }

    await this.validadateTokenToAddByData(tokenData, storage);
    return tokenData;
  },

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
  async validadateTokenToAddByData(tokenData: ITokenData, storage?: IStorage): Promise<void> {
    if (storage) {
      if (await storage.isTokenRegistered(tokenData.uid)) {
        throw new TokenValidationError(`You already have this token: ${tokenData.uid} (${tokenData.name})`)
      }

      const isDuplicate = await this.checkDuplicateTokenInfo(tokenData, storage);
      if (isDuplicate) {
        throw new TokenValidationError(`You already have a token with this ${isDuplicate.key}: ${isDuplicate.token.uid} - ${isDuplicate.token.name} (${isDuplicate.token.symbol})`);
      }
    }

    // Validate if name and symbol match with the token info in the DAG
    const response = await new Promise<any>((resolve) => {
      return walletApi.getGeneralTokenInfo(tokenData.uid, resolve);
    });

    if (!response.success) {
      throw new TokenValidationError(response.message);
    }

    if (response.name !== tokenData.name) {
      throw new TokenValidationError(`Token name does not match with the real one. Added: ${tokenData.name}. Real: ${response.name}`);
    }
    if (response.symbol !== tokenData.symbol) {
      throw new TokenValidationError(`Token symbol does not match with the real one. Added: ${tokenData.symbol}. Real: ${response.symbol}`);
    }
  },

  /**
   * Check if we have a token with the same name or symbol in the storage.
   *
   * @param {IStorage} storage to retrieve the registered tokens.
   * @param {ITokenData} tokenData token we are searching.
   * @returns {Promise<null | { token: ITokenData, key: string }>}
   */
  async checkDuplicateTokenInfo(tokenData: ITokenData, storage: IStorage): Promise<null | { token: ITokenData, key: string }> {
    const cleanName = helpers.cleanupString(tokenData.name);
    const cleanSymbol = helpers.cleanupString(tokenData.symbol);
    for await (const registeredToken of storage.getRegisteredTokens()) {
      if (helpers.cleanupString(registeredToken.name) === cleanName) {
        return { token: registeredToken, key: 'name' };
      }
      if (helpers.cleanupString(registeredToken.symbol) === cleanSymbol) {
        return { token: registeredToken, key: 'symbol' };
      }
    }

    return null;
  },

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
  isConfigurationStringValid(config: string): boolean {
    const tokenData = this.getTokenFromConfigurationString(config);
    if (tokenData === null) {
      return false;
    }
    return true;
  },

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
  getConfigurationString(uid: string, name: string, symbol: string): string {
    const partialConfig = `${name}:${symbol}:${uid}`;
    const checksum = helpers.getChecksum(buffer.Buffer.from(partialConfig));
    return `[${partialConfig}:${checksum.toString('hex')}]`;
  },

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
  getTokenFromConfigurationString(config: string): ITokenData | null {
    // First we validate that first char is [ and last one is ]
    if (!config || config[0] !== '[' || config[config.length - 1] !== ']') {
      return null;
    }
    // Then we remove the [] and split the string by :
    const configArr = config.slice(1, -1).split(':');
    if (configArr.length < 4) {
      return null;
    }

    // Last element is the checksum
    const checksum = configArr.splice(-1);
    const configWithoutChecksum = configArr.join(':');
    const correctChecksum = helpers.getChecksum(buffer.Buffer.from(configWithoutChecksum));
    if (correctChecksum.toString('hex') !== checksum[0]) {
      return null;
    }
    const uid = configArr.pop()!;
    const symbol = configArr.pop()!;
    // Assuming that the name might have : on it
    const name = configArr.join(':');
    return {uid, name, symbol};
  },

  /**
   * Gets the token index to be added to the tokenData in the output from tx
   *
   * @param {Object} tokens Array of token configs
   * @param {Object} uid Token uid to return the index
   *
   * @return {number} Index of token to be set as tokenData in output tx
   *
   * @memberof Tokens
   * @inner
   */
  getTokenIndex(tokens: ITokenData[], uid: string): number {
    // If token is Hathor, index is always 0
    // Otherwise, it is always the array index + 1
    if (uid === HATHOR_TOKEN_CONFIG.uid) {
      return 0;
    } else {
      const tokensWithoutHathor = tokens.filter((token) => token.uid !== HATHOR_TOKEN_CONFIG.uid);
      const myIndex = tokensWithoutHathor.findIndex((token) => token.uid === uid);
      return myIndex + 1;
    }
  },

  /**
   * Get token index from tokenData in output.
   * 0 is HTR and any other are mapped to the tx tokens array at index = tokenIndex - 1.
   * @param {number} tokenData Token data from output
   * @returns {number} Token index
   */
  getTokenIndexFromData(tokenData: number): number {
    return tokenData & TOKEN_INDEX_MASK;
  },

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
  isHathorToken(uid: string): boolean {
    return uid === HATHOR_TOKEN_CONFIG.uid;
  },

  /**
   * Calculate deposit value for the given token mint amount
   *
   * @param {number} mintAmount Amount of tokens being minted
   * @param {number} [depositPercent=TOKEN_DEPOSIT_PERCENTAGE] token deposit percentage.
   *
   * @return {number}
   * @memberof Tokens
   * @inner
   *
   */
  getDepositAmount(mintAmount: number, depositPercent: number = TOKEN_DEPOSIT_PERCENTAGE): number {
    return Math.ceil(depositPercent * mintAmount);
  },

  /**
   * Get the HTR value of the fee to add a data script output
   * @returns {number} The fee to have a data script output
   */
  getDataScriptOutputFee(): number {
    return 1;
  },

  /**
   * Calculate withdraw value for the given token melt amount
   *
   * @param {number} meltAmount Amount of tokens being melted
   * @param {number} [depositPercent=TOKEN_DEPOSIT_PERCENTAGE] token deposit percentage.
   *
   * @return {number}
   * @memberof Tokens
   * @inner
   *
   */
  getWithdrawAmount(meltAmount: number, depositPercent: number = TOKEN_DEPOSIT_PERCENTAGE): number {
    return Math.floor(depositPercent * meltAmount);
  },

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
   * @param {string[]|null} [options.data=null] list of data strings to add each as a data script output
   * @param {function} [options.utxoSelection=bestUtxoSelection] Algorithm to select utxos. Use the best method by default
   *
   * @returns {Promise<IDataTx>} The transaction data
   */
  async prepareMintTxData(
    address: string,
    amount: number,
    storage: IStorage,
    {
      token = null,
      mintInput = null,
      createAnotherMint = true,
      changeAddress = null,
      data = null,
      mintAuthorityAddress = null,
      utxoSelection = bestUtxoSelection,
    }: {
      token?: string | null,
      mintInput?: IDataInput | null,
      createAnotherMint?: boolean,
      changeAddress?: string | null,
      data?: string[] | null,
      mintAuthorityAddress?: string | null,
      utxoSelection?: UtxoSelectionAlgorithm,
    } = {},
  ): Promise<IDataTx> {
    const inputs: IDataInput[] = [];
    const outputs: IDataOutput[] = [];
    const depositPercent = storage.getTokenDepositPercentage();
    let depositAmount = this.getDepositAmount(amount, depositPercent);
    if (data) {
      // The deposit amount will be the quantity of data strings in the array
      // multiplied by the fee
      depositAmount += this.getDataScriptOutputFee() * data.length;
    }

    // get HTR deposit inputs
    const selectedUtxos = await utxoSelection(storage, HATHOR_TOKEN_CONFIG.uid, depositAmount);
    const foundAmount = selectedUtxos.amount;
    for (const utxo of selectedUtxos.utxos) {
      inputs.push(helpers.getDataInputFromUtxo(utxo));
    }

    if (foundAmount < depositAmount) {
      throw new InsufficientFundsError(`Not enough HTR tokens for deposit: ${depositAmount} required, ${foundAmount} available`);
    }

    // get output change
    if (foundAmount > depositAmount) {
      const cAddress = await storage.getChangeAddress({ changeAddress });

      outputs.push({
        type: getAddressType(cAddress, storage.config.getNetwork()),
        address: cAddress,
        value: foundAmount - depositAmount,
        timelock: null,
        token: HATHOR_TOKEN_CONFIG.uid,
        authorities: 0,
        isChange: true,
      });
    }

    if (mintInput !== null) {
      // We are spending a mint input to mint more tokens
      inputs.push(mintInput);
    }

    // Add output to mint tokens
    outputs.push({
      type: 'mint',
      address,
      value: amount,
      timelock: null,
      authorities: 0,
    });

    if (createAnotherMint) {
      const newAddress = mintAuthorityAddress || await storage.getCurrentAddress();
      outputs.push({
        type: 'mint',
        address: newAddress,
        value: TOKEN_MINT_MASK,
        timelock: null,
        authorities: 1,
      });
    }

    const tokens = token !== null ? [token] : [];

    return {
      inputs,
      outputs,
      tokens,
    };
  },

  /**
   * Generate melt transaction data
   *
   * @param {string} token Token to melt
   * @param {IDataInput} authorityMeltInput Input with authority to melt
   * @param {string} address Address to send the melted HTR tokens
   * @param {number} amount The amount of tokens to melt
   * @param {IStorage} storage The storage object
   * @param {Object} [options={}] Options to create the melt transaction
   * @param {boolean} [options.createAnotherMelt=true] If should create another melt authority
   * @param {string | null} [options.meltAuthorityAddress=null] Address to send the new melt authority created
   * @param {string | null} [options.changeAddress=null] Address to send the change
   * @param {function} [options.utxoSelection=bestUtxoSelection] Algorithm to select utxos. Use the best method by default
   * @returns {Promise<IDataTx>}
   */
  async prepareMeltTxData(
    token: string,
    authorityMeltInput: IDataInput, // Authority melt
    address: string,
    amount: number,
    storage: IStorage,
    {
      createAnotherMelt = true,
      meltAuthorityAddress = null,
      changeAddress = null,
      utxoSelection = bestUtxoSelection,
    }: {
      createAnotherMelt?: boolean,
      meltAuthorityAddress?: string | null,
      changeAddress?: string | null,
      utxoSelection?: UtxoSelectionAlgorithm,
    } = {},
  ): Promise<IDataTx> {
    if ((authorityMeltInput.token !== token) || (authorityMeltInput.authorities !== 2)) {
      throw new Error('Melt authority input is not valid');
    }
    const inputs: IDataInput[] = [authorityMeltInput];
    const outputs: IDataOutput[] = [];
    const tokens = [authorityMeltInput.token];
    const depositPercent = storage.getTokenDepositPercentage();
    const withdrawAmount = this.getWithdrawAmount(amount, depositPercent);

    // get inputs that amount to requested melt amount
    const selectedUtxos = await utxoSelection(storage, token, amount);
    const foundAmount = selectedUtxos.amount;
    for (const utxo of selectedUtxos.utxos) {
      inputs.push(helpers.getDataInputFromUtxo(utxo));
    }

    if (foundAmount < amount) {
      throw new InsufficientFundsError(`Not enough tokens to melt: ${amount} requested, ${foundAmount} available`);
    }

    // get output change
    if (foundAmount > amount) {
      const cAddress = await storage.getChangeAddress({ changeAddress });

      outputs.push({
        type: getAddressType(cAddress, storage.config.getNetwork()),
        address: cAddress,
        value: foundAmount - amount,
        timelock: null,
        token: token,
        authorities: 0,
        isChange: true,
      });
    }

    if (createAnotherMelt) {
      const newAddress = meltAuthorityAddress || await storage.getCurrentAddress();
      outputs.push({
        type: getAddressType(newAddress, storage.config.getNetwork()),
        address: newAddress,
        token,
        authorities: 2,
        value: TOKEN_MELT_MASK,
        timelock: null,
      });
    }

    // When melting an amount smaller than 100 (1.00), the withdraw value will be 0, then we don't need to add output for that
    if (withdrawAmount > 0) {
      outputs.push({
        value: withdrawAmount,
        address,
        token: HATHOR_TOKEN_CONFIG.uid,
        authorities: 0,
        timelock: null,
        type: getAddressType(address, storage.config.getNetwork()),
      });
    }

    return {
      inputs,
      outputs,
      tokens,
    };
  },

  /**
   * Prepare transaction data to create a token.
   *
   * @param {string} address Address to create the token
   * @param {string} name Name of the token being created
   * @param {string} symbol Symbol of the token being created
   * @param {number} mintAmount Amount of tokens to mint
   * @param {IStorage} storage Storage to get necessary data
   * @param {Object} [options={}] options to create the token
   * @param {string|null} [options.changeAddress=null] Address to send the change
   * @param {boolean} [options.createMint=true] Whether to create a mint output
   * @param {string} [options.mintAuthorityAddress] the address to send the mint authority created
   * @param {boolean} [options.createMelt=true] Whether to create a melt output
   * @param {string} [options.meltAuthorityAddress] the address to send the melt authority created
   * @param {string[]|null} [options.data=null] list of data strings to add each as a data script output
   * @param {boolean} [options.isCreateNFT=false] if the create token is an NFT creation call
   * @returns {Promise<IDataTx>} The transaction data to create the token
   */
  async prepareCreateTokenData(
    address: string,
    name: string,
    symbol: string,
    mintAmount: number,
    storage: IStorage,
    {
      changeAddress = null,
      createMint = true,
      mintAuthorityAddress = null,
      createMelt = true,
      meltAuthorityAddress = null,
      data = null,
      isCreateNFT = false,
    }: {
      changeAddress?: string | null,
      createMint?: boolean,
      mintAuthorityAddress?: string | null,
      createMelt?: boolean,
      meltAuthorityAddress?: string | null,
      data?: string[] | null,
      isCreateNFT?: boolean,
    } = {},
  ): Promise<IDataTx> {
    const mintOptions = {
      createAnotherMint: createMint,
      mintAuthorityAddress,
      changeAddress,
      data
    };

    const txData = await this.prepareMintTxData(address, mintAmount, storage, mintOptions);

    if (createMelt) {
      const newAddress = meltAuthorityAddress || await storage.getCurrentAddress();
      txData.outputs.push({
        type: 'melt',
        address: newAddress,
        value: TOKEN_MELT_MASK,
        timelock: null,
        authorities: 2,
      });
    }

    if (data !== null) {
      for (const dataString of data) {
        const outputData = {
          type: 'data',
          data: dataString,
          value: 1,
          token: HATHOR_TOKEN_CONFIG.uid,
          authorities: 0,
        } as IDataOutput;

        // We currently have an external service that identifies NFT tokens with the first output as the data output
        // that's why we are keeping like this
        // However, this will change after a new project is completed to better identify an NFT token
        if (isCreateNFT) {
          txData.outputs.unshift(outputData);
        } else {
          txData.outputs.push(outputData);
        }
      }
    }

    // Set create token tx version value
    txData.version = CREATE_TOKEN_TX_VERSION;
    txData.name = name;
    txData.symbol = symbol;

    return txData;
  },

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
  async prepareDelegateAuthorityTxData(
    token: string,
    authorityInput: IDataInput, // Authority input
    address: string,
    storage: IStorage,
    createAnother: boolean = true,
  ): Promise<IDataTx> {
    const outputs: IDataOutput[] = [{
      type: getAddressType(address, storage.config.getNetwork()),
      address,
      token,
      authorities: authorityInput.authorities,
      value: authorityInput.value,
      timelock: null,
    }];

    if (createAnother) {
      const newAddress = await storage.getCurrentAddress();
      outputs.push({
        type: getAddressType(newAddress, storage.config.getNetwork()),
        address: newAddress,
        token,
        authorities: authorityInput.authorities,
        value: authorityInput.value,
        timelock: null,
      });
    }

    return {
      outputs,
      inputs: [authorityInput],
      tokens: [token],
    };
  },

  /**
   * Prepare transaction data to destroy authority utxos
   *
   * @param authorityInputs Authority inputs to destroy
   * @returns {IDataTx} Transaction data
   */
  prepareDestroyAuthorityTxData(
    authorityInputs: IDataInput[], // Authority inputs
  ): IDataTx {
    return {
      inputs: authorityInputs,
      outputs: [],
      tokens: [],
    };
  },
}

export default tokens;
