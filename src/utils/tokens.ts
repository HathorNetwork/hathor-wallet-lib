/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { CREATE_TOKEN_TX_VERSION, HATHOR_TOKEN_CONFIG, TOKEN_DEPOSIT_PERCENTAGE, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../constants';
import helpers from './helpers';
import buffer from 'buffer';
import { IDataInput, IDataOutput, IDataTx, IHistoryOutput, IStorage } from '../types';
import { getAddressType } from './address';
import { InsufficientFundsError } from '../errors';

type configStringType = {uid: string, name: string, symbol: string}


const tokens = {
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
  getTokenFromConfigurationString(config: string): configStringType | null {
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
  getTokenIndex(tokens: configStringType[], uid: string): number {
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
   * @param {boolean} isCreateNFT If we are calculating the deposit for a NFT creation
   *
   * @return {number}
   * @memberof Tokens
   * @inner
   *
   */
  getDepositAmount(mintAmount: number, isCreateNFT: boolean = false): number {
    let depositAmount = Math.ceil(TOKEN_DEPOSIT_PERCENTAGE * mintAmount);
    if (isCreateNFT) {
      // The NFT has the normal deposit + 0.01 HTR fee
      depositAmount += 1;
    }
    return depositAmount;
  },

  /**
   * Calculate withdraw value for the given token melt amount
   *
   * @param {number} meltAmount Amount of tokens being melted
   *
   * @return {number}
   * @memberof Tokens
   * @inner
   *
   */
  getWithdrawAmount(meltAmount: number): number {
    return Math.floor(TOKEN_DEPOSIT_PERCENTAGE * meltAmount);
  },

  /**
   * Prepare the transaction data for minting tokens or creating tokens.
   *
   * @param address Where to send the minted tokens
   * @param amount Amount of tokens to mint
   * @param storage Storage instance of the wallet
   * @param [options={}] Options to mint tokens
   * @param {string|null} [options.token=null] Token to mint, may be null if we are creating the token
   * @param {IDataInput|null} [options.mintInput=null] Input to spend, may be null of we are creating the token
   * @param {boolean} [options.createAnotherMint=true] If a mint authority should be created on the transaction.
   * @param {boolean} [options.createMelt=false] If a melt authority should be created on the transaction.
   * @param {string|null} [options.changeAddress=null] The address to send any change output.
   * @param {boolean} [options.isCreateNFT=false] If this transaction will create an NFT
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
      createMelt = false,
      changeAddress = null,
      isCreateNFT = false,
    }: {
      token?: string|null,
      mintInput?: IDataInput|null,
      createAnotherMint?: boolean,
      createMelt?: boolean,
      changeAddress?: string|null,
      isCreateNFT?: boolean,
    } = {},
  ): Promise<IDataTx> {
    const inputs: IDataInput[] = [];
    const outputs: IDataOutput[] = [];
    const depositAmount = this.getDepositAmount(amount, isCreateNFT);

    // get HTR deposit inputs
    let foundAmount = 0;
    for await (const utxo of storage.selectUtxos({token: HATHOR_TOKEN_CONFIG.uid, target_amount: depositAmount})) {
      foundAmount += utxo.value;
      inputs.push({
        txId: utxo.txId,
        index: utxo.index,
        value: utxo.value,
        address: utxo.address,
        authorities: utxo.authorities,
        token: utxo.token,
      });
    }

    if (foundAmount < depositAmount) {
      throw new InsufficientFundsError(`Not enough HTR tokens for deposit: ${depositAmount} required, ${foundAmount} available`);
    }

    // get output change
    if (foundAmount > depositAmount) {
      const cAddress = changeAddress || await storage.getCurrentAddress();

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
      const newAddress = await storage.getCurrentAddress();
      outputs.push({
        type: 'mint',
        address: newAddress,
        value: TOKEN_MINT_MASK,
        timelock: null,
        authorities: 1,
      });
    }

    if (createMelt) {
      const newAddress = await storage.getCurrentAddress();
      outputs.push({
        type: 'melt',
        address: newAddress,
        value: TOKEN_MELT_MASK,
        timelock: null,
        authorities: 2,
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
   * @param {string|null} [options.changeAddress=null] Address to send the change
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
      changeAddress = null,
    }: {
      createAnotherMelt?: boolean,
      changeAddress?: string|null,
    } = {},
  ): Promise<IDataTx> {
    if ((authorityMeltInput.token !== token) || (authorityMeltInput.authorities !== 2)) {
      throw new Error('Melt authority input is not valid');
    }
    const inputs: IDataInput[] = [authorityMeltInput];
    const outputs: IDataOutput[] = [];
    const tokens = [authorityMeltInput.token];
    const withdrawAmount = this.getWithdrawAmount(amount);

    // get inputs that amount to requested melt amount
    let foundAmount = 0;
    for await (const utxo of storage.selectUtxos({token, target_amount: amount})) {
      foundAmount += utxo.value;
      inputs.push({
        txId: utxo.txId,
        index: utxo.index,
        value: utxo.value,
        address: utxo.address,
        authorities: 0,
        token: utxo.token,
      });
    }

    if (foundAmount < amount) {
      throw new InsufficientFundsError(`Not enough HTR tokens for withdraw: ${withdrawAmount} required, ${foundAmount} available`);
    }

    // get output change
    if (foundAmount > amount) {
      if (changeAddress === null) {
        throw new Error('Must provide change address');
      }

      outputs.push({
        type: getAddressType(changeAddress, storage.config.getNetwork()),
        address: changeAddress,
        value: foundAmount - amount,
        timelock: null,
        token: token,
        authorities: 0,
        isChange: true,
      });
    }

    if (createAnotherMelt) {
      const newAddress = await storage.getCurrentAddress();
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
        isChange: true, // XXX: should this be considered change?
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
   * @param {boolean} [options.createMelt=true] Whether to create a melt output
   * @param {string|null} [options.nftData=null] NFT data to create an NFT token
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
      createMelt = true,
      nftData = null,
    }: {
      changeAddress?: string|null,
      createMint?: boolean,
      createMelt?: boolean,
      nftData?: string|null,
    } = {},
  ): Promise<IDataTx> {
    const isNFT = nftData !== null;
    const mintOptions = {
      createAnotherMint: createMint,
      createMelt,
      changeAddress,
      isNFT,
    };

    const txData = await this.prepareMintTxData(address, mintAmount, storage, mintOptions);
    if (isNFT) {
      if (nftData === null) {
        // This should never happen since isNFT is true only if nftData is not null
        // But the typescript compiler doesn't seem to understand that
        throw new Error('this should not happen');
      }
      // After the transaction data is completed
      // if it's an NFT I must add the first output as the data script
      // For NFT data the value is always 0.01 HTR (i.e. 1 integer)
      txData.outputs.unshift({
        type: 'data',
        data: nftData,
        value: 1,
        token: HATHOR_TOKEN_CONFIG.uid,
        authorities: 0,
      });
    }

    // Set create token tx version value
    txData.version = CREATE_TOKEN_TX_VERSION;
    txData.name = name;
    txData.symbol = symbol;

    return txData;
  },

  /**
   * Prepare delegate authority transaction data
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