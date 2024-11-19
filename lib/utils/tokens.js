"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _buffer = _interopRequireDefault(require("buffer"));
var _constants = require("../constants");
var _helpers = _interopRequireDefault(require("./helpers"));
var _address = require("./address");
var _errors = require("../errors");
var _utxo = require("./utxo");
var _wallet = _interopRequireDefault(require("../api/wallet"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _asyncIterator(r) { var n, t, o, e = 2; for ("undefined" != typeof Symbol && (t = Symbol.asyncIterator, o = Symbol.iterator); e--;) { if (t && null != (n = r[t])) return n.call(r); if (o && null != (n = r[o])) return new AsyncFromSyncIterator(n.call(r)); t = "@@asyncIterator", o = "@@iterator"; } throw new TypeError("Object is not async iterable"); }
function AsyncFromSyncIterator(r) { function AsyncFromSyncIteratorContinuation(r) { if (Object(r) !== r) return Promise.reject(new TypeError(r + " is not an object.")); var n = r.done; return Promise.resolve(r.value).then(function (r) { return { value: r, done: n }; }); } return AsyncFromSyncIterator = function (r) { this.s = r, this.n = r.next; }, AsyncFromSyncIterator.prototype = { s: null, n: null, next: function () { return AsyncFromSyncIteratorContinuation(this.n.apply(this.s, arguments)); }, return: function (r) { var n = this.s.return; return void 0 === n ? Promise.resolve({ value: r, done: !0 }) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); }, throw: function (r) { var n = this.s.return; return void 0 === n ? Promise.reject(r) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); } }, new AsyncFromSyncIterator(r); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const tokens = {
  /**
   * Validate the configuration string and if we should register the token in it.
   *
   * @param {string} config Configuration string to check
   * @param {IStorage | undefined} storage To check if we have a similarly named token in storage.
   * @param {string | undefined} uid Check that the configuration string matches this uid.
   * @returns {Promise<ITokenData>}
   */
  async validateTokenToAddByConfigurationString(config, storage, uid) {
    const tokenData = this.getTokenFromConfigurationString(config);
    if (!tokenData) {
      throw new _errors.TokenValidationError('Invalid configuration string');
    }
    if (uid && tokenData.uid !== uid) {
      throw new _errors.TokenValidationError(`Configuration string uid does not match: ${uid} != ${tokenData.uid}`);
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
  async validadateTokenToAddByData(tokenData, storage) {
    if (storage) {
      if (await storage.isTokenRegistered(tokenData.uid)) {
        throw new _errors.TokenValidationError(`You already have this token: ${tokenData.uid} (${tokenData.name})`);
      }
      const isDuplicate = await this.checkDuplicateTokenInfo(tokenData, storage);
      if (isDuplicate) {
        throw new _errors.TokenValidationError(`You already have a token with this ${isDuplicate.key}: ${isDuplicate.token.uid} - ${isDuplicate.token.name} (${isDuplicate.token.symbol})`);
      }
    }

    // Validate if name and symbol match with the token info in the DAG
    const response = await new Promise(resolve => {
      _wallet.default.getGeneralTokenInfo(tokenData.uid, resolve);
    });
    if (!response.success) {
      throw new _errors.TokenValidationError(response.message);
    }
    if (response.name !== tokenData.name) {
      throw new _errors.TokenValidationError(`Token name does not match with the real one. Added: ${tokenData.name}. Real: ${response.name}`);
    }
    if (response.symbol !== tokenData.symbol) {
      throw new _errors.TokenValidationError(`Token symbol does not match with the real one. Added: ${tokenData.symbol}. Real: ${response.symbol}`);
    }
  },
  /**
   * Check if we have a token with the same name or symbol in the storage.
   *
   * @param {IStorage} storage to retrieve the registered tokens.
   * @param {ITokenData} tokenData token we are searching.
   * @returns {Promise<null | { token: ITokenData, key: string }>}
   */
  async checkDuplicateTokenInfo(tokenData, storage) {
    const cleanName = _helpers.default.cleanupString(tokenData.name);
    const cleanSymbol = _helpers.default.cleanupString(tokenData.symbol);
    var _iteratorAbruptCompletion = false;
    var _didIteratorError = false;
    var _iteratorError;
    try {
      for (var _iterator = _asyncIterator(storage.getRegisteredTokens()), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
        const registeredToken = _step.value;
        {
          if (_helpers.default.cleanupString(registeredToken.name) === cleanName) {
            return {
              token: registeredToken,
              key: 'name'
            };
          }
          if (_helpers.default.cleanupString(registeredToken.symbol) === cleanSymbol) {
            return {
              token: registeredToken,
              key: 'symbol'
            };
          }
        }
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (_iteratorAbruptCompletion && _iterator.return != null) {
          await _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
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
  isConfigurationStringValid(config) {
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
  getConfigurationString(uid, name, symbol) {
    const partialConfig = `${name}:${symbol}:${uid}`;
    const checksum = _helpers.default.getChecksum(_buffer.default.Buffer.from(partialConfig));
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
  getTokenFromConfigurationString(config) {
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
    const correctChecksum = _helpers.default.getChecksum(_buffer.default.Buffer.from(configWithoutChecksum));
    if (correctChecksum.toString('hex') !== checksum[0]) {
      return null;
    }
    const uid = configArr.pop();
    const symbol = configArr.pop();
    // Assuming that the name might have : on it
    const name = configArr.join(':');
    return {
      uid,
      name,
      symbol
    };
  },
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
  getTokenIndex(tokensArray, uid) {
    // If token is Hathor, index is always 0
    // Otherwise, it is always the array index + 1
    if (uid === _constants.NATIVE_TOKEN_UID) {
      return 0;
    }
    const tokensWithoutHathor = tokensArray.filter(token => token.uid !== _constants.NATIVE_TOKEN_UID);
    const myIndex = tokensWithoutHathor.findIndex(token => token.uid === uid);
    return myIndex + 1;
  },
  /**
   * Get token index from tokenData in output.
   * 0 is HTR and any other are mapped to the tx tokens array at index = tokenIndex - 1.
   * @param {number} tokenData Token data from output
   * @returns {number} Token index
   */
  getTokenIndexFromData(tokenData) {
    return tokenData & _constants.TOKEN_INDEX_MASK;
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
  isHathorToken(uid) {
    return uid === _constants.NATIVE_TOKEN_UID;
  },
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
  getDepositAmount(mintAmount, depositPercent = _constants.TOKEN_DEPOSIT_PERCENTAGE) {
    return BigInt(Math.ceil(depositPercent * Number(mintAmount)));
  },
  /**
   * Get the HTR value of the fee to add a data script output
   * @returns {OutputValueType} The fee to have a data script output
   */
  getDataScriptOutputFee() {
    return 1n;
  },
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
  getWithdrawAmount(meltAmount, depositPercent = _constants.TOKEN_DEPOSIT_PERCENTAGE) {
    return BigInt(Math.floor(depositPercent * Number(meltAmount)));
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
   * @param {boolean|null} [options.unshiftData=null] Whether to unshift the data script output.
   * @param {string[]|null} [options.data=null] list of data strings using utf8 encoding to add each as a data script output
   * @param {function} [options.utxoSelection=bestUtxoSelection] Algorithm to select utxos. Use the best method by default
   *
   * @returns {Promise<IDataTx>} The transaction data
   */
  async prepareMintTxData(address, amount, storage, {
    token = null,
    mintInput = null,
    createAnotherMint = true,
    changeAddress = null,
    unshiftData = null,
    data = null,
    mintAuthorityAddress = null,
    utxoSelection = _utxo.bestUtxoSelection
  } = {}) {
    const inputs = [];
    const outputs = [];
    const depositPercent = storage.getTokenDepositPercentage();
    let depositAmount = this.getDepositAmount(amount, depositPercent);
    if (data) {
      // The deposit amount will be the quantity of data strings in the array
      // multiplied by the fee
      depositAmount += this.getDataScriptOutputFee() * BigInt(data.length);
    }

    // get HTR deposit inputs
    const selectedUtxos = await utxoSelection(storage, _constants.NATIVE_TOKEN_UID, depositAmount);
    const foundAmount = selectedUtxos.amount;
    for (const utxo of selectedUtxos.utxos) {
      inputs.push(_helpers.default.getDataInputFromUtxo(utxo));
    }
    if (foundAmount < depositAmount) {
      const availableAmount = selectedUtxos.available ?? 0;
      throw new _errors.InsufficientFundsError(`Not enough HTR tokens for deposit: ${depositAmount} required, ${availableAmount} available`);
    }

    // get output change
    if (foundAmount > depositAmount) {
      const cAddress = await storage.getChangeAddress({
        changeAddress
      });
      outputs.push({
        type: (0, _address.getAddressType)(cAddress, storage.config.getNetwork()),
        address: cAddress,
        value: foundAmount - depositAmount,
        timelock: null,
        token: _constants.NATIVE_TOKEN_UID,
        authorities: 0n,
        isChange: true
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
      authorities: 0n
    });
    if (createAnotherMint) {
      const newAddress = mintAuthorityAddress || (await storage.getCurrentAddress());
      outputs.push({
        type: 'mint',
        address: newAddress,
        value: _constants.TOKEN_MINT_MASK,
        timelock: null,
        authorities: 1n
      });
    }
    if (data !== null) {
      for (const dataString of data) {
        const outputData = {
          type: 'data',
          data: dataString,
          value: 1n,
          token: _constants.NATIVE_TOKEN_UID,
          authorities: 0n
        };

        // We currently have an external service that identifies NFT tokens with the first output as the data output
        // that's why we are keeping like this
        // However, this will change after a new project is completed to better identify an NFT token
        // the method that validates the NFT is in src/models/CreateTokenTransaction.validateNft
        if (unshiftData) {
          outputs.unshift(outputData);
        } else {
          outputs.push(outputData);
        }
      }
    }
    const tokensArray = token !== null ? [token] : [];
    return {
      inputs,
      outputs,
      tokens: tokensArray
    };
  },
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
  async prepareMeltTxData(token, authorityMeltInput,
  // Authority melt
  address, amount, storage, {
    createAnotherMelt = true,
    meltAuthorityAddress = null,
    changeAddress = null,
    unshiftData = null,
    data = null,
    utxoSelection = _utxo.bestUtxoSelection
  } = {}) {
    if (authorityMeltInput.token !== token || authorityMeltInput.authorities !== 2n) {
      throw new Error('Melt authority input is not valid');
    }
    const inputs = [authorityMeltInput];
    const outputs = [];
    const tokensArray = [authorityMeltInput.token];
    const depositPercent = storage.getTokenDepositPercentage();
    let withdrawAmount = this.getWithdrawAmount(amount, depositPercent);
    // The deposit amount will be the quantity of data strings in the array
    // multiplied by the fee or 0 if there are no data outputs
    let depositAmount = data !== null ? this.getDataScriptOutputFee() * BigInt(data.length) : 0n;

    // We only make these calculations if we are creating data outputs because the transaction needs to deposit the fee
    if (depositAmount > 0) {
      // If we are creating data outputs the withdrawal amount may be used to create the data outputs
      // This may prevent finding HTR inputs to meet the deposit amount if we are creating HTR with the melt.
      if (withdrawAmount >= depositAmount) {
        // We can use part of the withdraw tokens as deposit
        withdrawAmount -= depositAmount;
        depositAmount = 0n;
      } else {
        // Deposit is greater than withdraw, we will use all withdrawn tokens and still need to find utxos to meet deposit
        depositAmount -= withdrawAmount;
        withdrawAmount = 0n;
      }
    }

    // get inputs that amount to requested melt amount
    const selectedUtxos = await utxoSelection(storage, token, amount);
    const foundAmount = selectedUtxos.amount;
    for (const utxo of selectedUtxos.utxos) {
      inputs.push(_helpers.default.getDataInputFromUtxo(utxo));
    }
    if (foundAmount < amount) {
      const availableAmount = selectedUtxos.available ?? 0;
      throw new _errors.InsufficientFundsError(`Not enough tokens to melt: ${amount} requested, ${availableAmount} available`);
    }

    // get output change
    if (foundAmount > amount) {
      const cAddress = await storage.getChangeAddress({
        changeAddress
      });
      outputs.push({
        type: (0, _address.getAddressType)(cAddress, storage.config.getNetwork()),
        address: cAddress,
        value: foundAmount - amount,
        timelock: null,
        token,
        authorities: 0n,
        isChange: true
      });
    }
    if (depositAmount > 0) {
      // get HTR deposit inputs
      const depositSelectedUtxos = await utxoSelection(storage, _constants.NATIVE_TOKEN_UID, depositAmount);
      const depositFoundAmount = depositSelectedUtxos.amount;
      for (const utxo of depositSelectedUtxos.utxos) {
        inputs.push(_helpers.default.getDataInputFromUtxo(utxo));
      }
      if (depositFoundAmount < depositAmount) {
        throw new _errors.InsufficientFundsError(`Not enough HTR tokens for deposit: ${depositAmount} required, ${depositFoundAmount} available`);
      }

      // get output change
      if (depositFoundAmount > depositAmount) {
        const cAddress = await storage.getChangeAddress({
          changeAddress
        });
        outputs.push({
          type: (0, _address.getAddressType)(cAddress, storage.config.getNetwork()),
          address: cAddress,
          value: depositFoundAmount - depositAmount,
          timelock: null,
          token: _constants.NATIVE_TOKEN_UID,
          authorities: 0n,
          isChange: true
        });
      }
    }
    if (createAnotherMelt) {
      const newAddress = meltAuthorityAddress || (await storage.getCurrentAddress());
      outputs.push({
        type: (0, _address.getAddressType)(newAddress, storage.config.getNetwork()),
        address: newAddress,
        token,
        authorities: 2n,
        value: _constants.TOKEN_MELT_MASK,
        timelock: null
      });
    }

    // When melting an amount smaller than 100 (1.00), the withdraw value will be 0, then we don't need to add output for that
    if (withdrawAmount > 0) {
      outputs.push({
        value: withdrawAmount,
        address,
        token: _constants.NATIVE_TOKEN_UID,
        authorities: 0n,
        timelock: null,
        type: (0, _address.getAddressType)(address, storage.config.getNetwork())
      });
    }
    if (data !== null) {
      for (const dataString of data) {
        const outputData = {
          type: 'data',
          data: dataString,
          value: 1n,
          token: _constants.NATIVE_TOKEN_UID,
          authorities: 0n
        };
        if (unshiftData) {
          outputs.unshift(outputData);
        } else {
          outputs.push(outputData);
        }
      }
    }
    return {
      inputs,
      outputs,
      tokens: tokensArray
    };
  },
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
  async prepareCreateTokenData(address, name, symbol, mintAmount, storage, {
    changeAddress = null,
    createMint = true,
    mintAuthorityAddress = null,
    createMelt = true,
    meltAuthorityAddress = null,
    data = null,
    isCreateNFT = false
  } = {}) {
    const mintOptions = {
      createAnotherMint: createMint,
      mintAuthorityAddress,
      changeAddress,
      unshiftData: isCreateNFT,
      data
    };
    const txData = await this.prepareMintTxData(address, mintAmount, storage, mintOptions);
    if (createMelt) {
      const newAddress = meltAuthorityAddress || (await storage.getCurrentAddress());
      const meltAuthorityOutput = {
        type: 'melt',
        address: newAddress,
        value: _constants.TOKEN_MELT_MASK,
        timelock: null,
        authorities: 2n
      };
      if (data !== null && data.length !== 0 && !isCreateNFT) {
        txData.outputs.splice(-data.length, 0, meltAuthorityOutput);
      } else {
        txData.outputs.push(meltAuthorityOutput);
      }
    }

    // Set create token tx version value
    txData.version = _constants.CREATE_TOKEN_TX_VERSION;
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
  async prepareDelegateAuthorityTxData(token, authorityInput,
  // Authority input
  address, storage, createAnother = true) {
    const outputs = [{
      type: (0, _address.getAddressType)(address, storage.config.getNetwork()),
      address,
      token,
      authorities: authorityInput.authorities,
      value: authorityInput.value,
      timelock: null
    }];
    if (createAnother) {
      const newAddress = await storage.getCurrentAddress();
      outputs.push({
        type: (0, _address.getAddressType)(newAddress, storage.config.getNetwork()),
        address: newAddress,
        token,
        authorities: authorityInput.authorities,
        value: authorityInput.value,
        timelock: null
      });
    }
    return {
      outputs,
      inputs: [authorityInput],
      tokens: [token]
    };
  },
  /**
   * Prepare transaction data to destroy authority utxos
   *
   * @param authorityInputs Authority inputs to destroy
   * @returns {IDataTx} Transaction data
   */
  prepareDestroyAuthorityTxData(authorityInputs) {
    return {
      inputs: authorityInputs,
      outputs: [],
      tokens: []
    };
  }
};
var _default = exports.default = tokens;