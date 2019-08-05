/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import buffer from 'buffer';
import { crypto, util } from 'bitcore-lib';
import transaction from './transaction';
import wallet from './wallet';
import storage from './storage';
import helpers from './helpers';
import walletApi from './api/wallet';
import { InsufficientTokensError } from './errors';
import { HATHOR_TOKEN_CONFIG, TOKEN_CREATION_MASK, TOKEN_MINT_MASK, TOKEN_MELT_MASK, AUTHORITY_TOKEN_DATA } from './constants';


/**
 * Methods to create and handle tokens
 *
 * @namespace Tokens
 */

const tokens = {
  /**
   * Create a token UID from the tx_id and index that the tx is spending to create the token
   *
   * @param {string} txID Transaction id in hexadecimal of the output that is being spent when creating the token
   * @param {number} index Index of the output that is being spent when creating the token
   *
   * @return {Buffer} UID of the token in bytes
   *
   * @memberof Tokens
   * @inner
   */
  getTokenUID(txID, index) {
    let arr = [];
    arr.push(util.buffer.hexToBuffer(txID));
    arr.push(transaction.intToBytes(index, 1));
    return crypto.Hash.sha256(util.buffer.concat(arr));
  },

  /**
   * Add a new token to the storage and redux
   *
   * @param {string} uid Token uid
   * @param {string} name Token name
   * @param {string} symbol Token synbol
   *
   * @return {Array} array of token configs with new added one
   *
   * @memberof Tokens
   * @inner
   */
  addToken(uid, name, symbol) {
    const newConfig = {'name': name, 'symbol': symbol, 'uid': uid};
    let tokens = this.getTokens();
    tokens.push(newConfig);
    this.saveToStorage(tokens);
    return tokens;
  },

  /**
   * Edit token name and symbol. Save in storage and redux
   *
   * @param {string} uid Token uid to be edited
   * @param {string} name New token name
   * @param {string} synbol New token symbol
   *
   * @return {Array} array of token configs with edited one
   *
   * @memberof Tokens
   * @inner
   */
  editToken(uid, name, symbol) {
    const tokens = this.getTokens();
    const filteredTokens = tokens.filter((token) => token.uid !== uid);
    const newConfig = {uid, name, symbol};
    const editedTokens = [...filteredTokens, newConfig];
    this.saveToStorage(editedTokens);
    return editedTokens;
  },

  /**
   * Unregister token from storage and redux
   *
   * @param {string} uid Token uid to be unregistered
   *
   * @return {Array} array of token configs without the unregister one
   *
   * @memberof Tokens
   * @inner
   */
  unregisterToken(uid) {
    const tokens = this.getTokens();
    const filteredTokens = tokens.filter((token) => token.uid !== uid);
    this.saveToStorage(filteredTokens);
    return filteredTokens;
  },

  /**
   * Validation token by configuration string
   * Check if string is valid and, if uid is passed, check also if uid matches
   *
   * @param {string} config Token configuration string
   * @param {string} uid Uid to check if matches with uid from config (optional)
   *
   * @return {Object} {success: boolean, message: in case of failure, tokenData: object with token data in case of success}
   *
   * @memberof Tokens
   * @inner
   */
  validateTokenToAddByConfigurationString(config, uid) {
    const tokenData = this.getTokenFromConfigurationString(config);
    if (tokenData === null) {
      return {success: false, message: 'Invalid configuration string'};
    }
    if (uid && uid !== tokenData.uid) {
      return {success: false, message: `Configuration string uid does not match: ${uid} != ${tokenData.uid}`};
    }

    const validation = this.validateTokenToAddByUid(tokenData.uid);
    if (validation.success) {
      return {success: true, tokenData: tokenData};
    } else {
      return validation;
    }
  },

  /**
   * Validation token by uid. Check if already exist
   *
   * @param {string} uid Uid to check for existence
   *
   * @return {Object} {success: boolean, message: in case of failure}
   *
   * @memberof Tokens
   * @inner
   */
  validateTokenToAddByUid(uid) {
    const existedToken = this.tokenExists(uid);
    if (existedToken) {
      return {success: false, message: `You already have this token: ${uid} (${existedToken.name})`};
    }

    return {success: true};
  },

  /**
   * Returns the saved tokens in storage
   *
   * @return {Object} Array of objects ({'name', 'symbol', 'uid'}) of saved tokens
   *
   * @memberof Tokens
   * @inner
   */
  getTokens() {
    let dataToken = storage.getItem('wallet:tokens');
    if (!dataToken) {
      dataToken = [HATHOR_TOKEN_CONFIG];
    }
    return dataToken;
  },

  /**
   * Updates the saved tokens in storage
   *
   * @param {Object} Array of objects ({'name', 'symbol', 'uid'}) with new tokens
   *
   * @memberof Tokens
   * @inner
   *
   */
  saveToStorage(newTokens) {
    storage.setItem('wallet:tokens', newTokens);
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
    const checksum = transaction.getChecksum(buffer.Buffer.from(partialConfig));
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
    const correctChecksum = transaction.getChecksum(buffer.Buffer.from(configWithoutChecksum));
    if (correctChecksum.toString('hex') !== checksum[0]) {
      return null;
    }
    const uid = configArr.pop();
    const symbol = configArr.pop();
    // Assuming that the name might have : on it
    const name = configArr.join(':');
    return {uid, name, symbol};
  },

  /**
   * Indicates if a token with this uid was already added in the wallet
   *
   * @param {string} uid UID of the token to search
   *
   * @return {Object|null} Token if uid already exists, else null
   *
   * @memberof Tokens
   * @inner
   */
  tokenExists(uid) {
    const tokens = this.getTokens();
    for (const token of tokens) {
      if (token.uid === uid) {
        return token;
      }
    }
    return null;
  },

  /**
   * Create the tx for the new token in the backend and creates a new mint and melt outputs to be used in the future
   *
   * @param {Object} input {'tx_id', 'index', 'token'} Hathor input to be spent to generate the token
   * @param {Object} output {'address', 'value', 'tokenData'} Hathor output to get the change of the input that generated the token
   * @param {string} address Address to receive the amount of the generated token
   * @param {string} name Name of the new token
   * @param {string} symbol Symbol of the new token
   * @param {number} mintAmount Amount of the new token that will be minted
   * @param {string} pin Pin to generate new addresses, if necessary
   *
   * @return {Promise} Promise that resolves when token is created or an error from the backend arrives
   *
   * @memberof Tokens
   * @inner
   */
  createToken(address, name, symbol, mintAmount, pin) {
    const promise = new Promise((resolve, reject) => {
      // get the input used to create token UID. We use getMintDepositInfo here as it'll raise an error
      // if we don't have enough HTR tokens for minting the requested amount and the token uid creation
      // tx will not be executed
      let inputs, outputs, outputChange;
      try {
        ({inputs, outputs} = this.getMintDepositInfo(mintAmount));
        const inputSum = outputs[0].value + mintAmount;
        outputChange = wallet.getOutputChange(inputSum, 0);
      } catch (e) {
        reject(e.message);
      }

      // Create authority output
      // First the tokens masks that will be the value for the authority output
      const tokenMasks = TOKEN_CREATION_MASK | TOKEN_MINT_MASK | TOKEN_MELT_MASK;
      // Create token uid
      const tokenUID = this.getTokenUID(inputs[0].tx_id, inputs[0].index);
      const authorityOutput = {'address': address, 'value': tokenMasks, 'tokenData': AUTHORITY_TOKEN_DATA};

      // Create tx data
      let txData = {'inputs': [inputs[0]], 'outputs': [authorityOutput, outputChange], 'tokens': [tokenUID]};

      // send initial tx
      const txPromise = transaction.sendTransaction(txData, pin);
      txPromise.then((response) => {
        // Save in storage new token configuration
        this.addToken(response.tx.tokens[0], name, symbol);
        const mintPromise = this.mintTokens(response.tx.hash, 0, address, response.tx.tokens[0], address, mintAmount, pin, {
          createAnotherMint: true,
          createMelt: true,
          minimumTimestamp: response.tx.timestamp + 1,
        });
        mintPromise.then(() => {
          resolve({uid: response.tx.tokens[0], name, symbol});
        }, (message) => {
          reject(message);
        });
      }, (message) => {
        reject(message);
      });
    });
    return promise;
  },

  /**
   * Generate mint data
   *
   * @param {string} txID Hash of the transaction to be used to mint tokens
   * @param {number} index Index of the output being spent
   * @param {string} addressSpent Address of the output being spent
   * @param {string} token Token uid to be minted
   * @param {string} address Address to receive the amount of the generated token
   * @param {number} amount Amount of the token that will be minted
   * @param {Object} options {
   *   {boolean} createAnotherMint If should create another mint output after spending this one
   *   {boolean} createMelt If should create a melt output (useful when creating a new token)
   * }
   *
   * @throws {InsufficientTokensError} If not enough tokens for deposit
   *
   * @return {Object} Mint data {'inputs', 'outputs', 'tokens'}
   *
   * @memberof Tokens
   * @inner
   */
  createMintData(txID, index, addressSpent, token, address, amount, options) {
    const fnOptions = Object.assign({
      createAnotherMint: true,
      createMelt: false,
    }, options);

    const { createAnotherMint, createMelt } = fnOptions;

    // get hathor deposit
    const {inputs, outputs} = this.getMintDepositInfo(amount);

    // Input targeting the output that contains the mint authority output
    inputs.push({'tx_id': txID, 'index': index, 'token': token, 'address': addressSpent});

    // Output1: Mint token amount
    outputs.push({'address': address, 'value': amount, 'tokenData': 1});

    if (createAnotherMint) {
      // Output2: new mint authority for this wallet
      const newAddress = wallet.getAddressToUse();
      outputs.push({'address': newAddress, 'value': TOKEN_MINT_MASK, 'tokenData': AUTHORITY_TOKEN_DATA});
    }

    if (createMelt) {
      // We create a melt output for this wallet when creating the token
      const newAddress2 = wallet.getAddressToUse();
      outputs.push({'address': newAddress2, 'value': TOKEN_MELT_MASK, 'tokenData': AUTHORITY_TOKEN_DATA});
    }

    // Create new data
    const newTxData = {'inputs': inputs, 'outputs': outputs, 'tokens': [token]};
    return newTxData;
  },

  /**
   * Mint new tokens
   *
   * @param {string} txID Hash of the transaction to be used to mint tokens
   * @param {number} index Index of the output being spent
   * @param {string} addressSpent Address of the output being spent
   * @param {string} token Token uid to be minted
   * @param {string} address Address to receive the amount of the generated token
   * @param {number} amount Amount of the token that will be minted
   * @param {string} pin Pin to generate new addresses, if necessary
   * @param {Object} {
   *   {number} minimumTimestamp Tx minimum timestamp (default = 0)
   *   {boolean} createAnotherMint If should create another mint output after spending this one
   *   {boolean} createMelt If should create a melt output (useful when creating a new token)
   * }
   *
   * @throws {InsufficientTokensError} If not enough tokens for deposit
   *
   * @return {Promise} Promise that resolves when token is minted or an error from the backend arrives
   *
   * @memberof Tokens
   * @inner
   */
  mintTokens(txID, index, addressSpent, token, address, amount, pin, options) {
    const fnOptions = Object.assign({
      createAnotherMint: true,
      createMelt: false,
      minimumTimestamp: 0,
    }, options);
    // Get mint data
    let newTxData = this.createMintData(txID, index, addressSpent, token, address, amount, fnOptions);
    return transaction.sendTransaction(newTxData, pin, fnOptions);
  },

  /**
   * Generate melt data
   *
   * @param {string} txID Hash of the transaction to be used to melt tokens
   * @param {number} index Index of the output being spent
   * @param {string} addressSpent Address of the output being spent
   * @param {string} token Token uid to be melted
   * @param {number} amount Amount of the token to be melted
   * @param {boolean} createAnotherMelt If should create another melt output after spending this one
   *
   * @return {Object} Melt data {'inputs', 'outputs', 'tokens'}
   *
   * @memberof Tokens
   * @inner
   */
  createMeltData(txID, index, addressSpent, token, amount, createAnotherMelt) {
    // Get inputs that sum at least the amount requested to melt
    const result = this.getMeltInputs(amount, token);

    // Can't find inputs to this amount
    if (result === null) return null;

    // First adding authority input with MELT capability that will be spent
    const authorityInput = {'tx_id': txID, 'index': index, 'token': token, 'address': addressSpent};
    // Then adding the inputs with the amounts
    const inputs = [authorityInput, ...result.inputs];
    const outputs = [];
    const tokens = [token];

    if (result.inputsAmount > amount) {
      // Need to create change output
      const newAddress = wallet.getAddressToUse();
      outputs.push({'address': newAddress, 'value': result.inputsAmount - amount, 'tokenData': 1});
    }

    if (createAnotherMelt) {
      // New melt authority for this wallet
      const newAddress = wallet.getAddressToUse();
      outputs.push({'address': newAddress, 'value': TOKEN_MELT_MASK, 'tokenData': AUTHORITY_TOKEN_DATA});
    }

    // Create new data
    const newTxData = {inputs, outputs, tokens};
    return newTxData;
  },

  /**
   * Melt tokens
   *
   * @param {string} txID Hash of the transaction to be used to melt tokens
   * @param {number} index Index of the output being spent
   * @param {string} addressSpent Address of the output being spent
   * @param {string} token Token uid to be melted
   * @param {number} amount Amount of the token to be melted
   * @param {string} pin Pin to generate new addresses, if necessary
   * @param {boolean} createAnotherMelt If should create another melt output after spending this one
   *
   * @return {Promise} Promise that resolves when tokens are melted or an error from the backend arrives. If can't find outputs that sum the total amount, returns null
   *
   * @memberof Tokens
   * @inner
   */
  meltTokens(txID, index, addressSpent, token, amount, pin, createAnotherMelt) {
    // Get melt data
    let newTxData = this.createMeltData(txID, index, addressSpent, token, amount, createAnotherMelt);
    return transaction.sendTransaction(newTxData, pin);
  },

  /**
   * Get inputs from the amount to be melted
   *
   * @param {number} amount Amount of the token to be melted and to get the inputs
   * @param {string} token Token uid that will be melted
   *
   * @return {Object} Object with {'inputsAmount': the total amount in the returned inputs, 'inputs': Array of inputs ({'tx_id', 'index', 'address', 'token'})} or null, if does not have this amount
   *
   * @memberof Tokens
   * @inner
   */
  getMeltInputs(amount, token) {
    const data = wallet.getWalletData();
    // If wallet has no data yet, return null
    if (data === null) {
      return null;
    }

    const inputs = [];
    let inputsAmount = 0;
    // Get history for this token
    const filteredHistory = wallet.filterHistoryTransactions(data.historyTransactions, token, false);

    for (const tx of filteredHistory) {
      if (tx.is_voided) {
        // Ignore voided transactions.
        continue;
      }
      for (const [index, txout] of tx.outputs.entries()) {
        if (wallet.isAuthorityOutput(txout)) {
          // Ignore authority outputs.
          continue;
        }
        // If output is still not spent, and is from this token, and is mine, add to inputs array and sum the value
        if (txout.spent_by === null && txout.token === token && wallet.isAddressMine(txout.decoded.address, data)) {
          inputs.push({'tx_id': tx.tx_id, 'index': index, 'token': token, 'address': txout.decoded.address});
          inputsAmount += txout.value;

          if (inputsAmount >= amount) {
            // If reached the requested amount, return
            return {inputs, inputsAmount};
          }
        }
      }
    }

    return null;
  },

  /**
   * Create delegate authority data
   *
   * @param {string} txID Hash of the transaction to be spent
   * @param {number} index Index of the output being spent
   * @param {string} addressSpent Address of the output being spent
   * @param {string} token Token uid to be delegated the authority
   * @param {string} address Destination address of the delegated authority output
   * @param {boolean} createAnother If should create another authority output for this wallet, after delegating this one
   * @param {string} type Authority type to be delegated ('mint' or 'melt')
   *
   * @return {Object} Delegate authority data {'inputs', 'outputs', 'tokens'}
   *
   * @memberof Tokens
   * @inner
   */
  createDelegateAuthorityData(txID, index, addressSpent, token, address, createAnother, type) {
    // First create the input with the authority that will be spent
    const input = {'tx_id': txID, 'index': index, 'token': token, 'address': addressSpent};

    // Setting the output value delegated, depending on the authority type
    const outputValue = type === 'mint' ? TOKEN_MINT_MASK : TOKEN_MELT_MASK;

    // Output1: Delegated output
    const outputs = [{'address': address, 'value': outputValue, 'tokenData': AUTHORITY_TOKEN_DATA}];

    if (createAnother) {
      // Output2: new authority for this wallet
      const newAddress = wallet.getAddressToUse();
      outputs.push({'address': newAddress, 'value': outputValue, 'tokenData': AUTHORITY_TOKEN_DATA});
    }

    // Create new data
    const newTxData = {'inputs': [input], 'outputs': outputs, 'tokens': [token]};
    return newTxData;
  },

  /**
   * Delegate authority outputs for an address (mint or melt authority)
   *
   * @param {string} txID Hash of the transaction to be spent
   * @param {number} index Index of the output being spent
   * @param {string} addressSpent Address of the output being spent
   * @param {string} token Token uid to be delegated the authority
   * @param {string} address Destination address of the delegated authority output
   * @param {boolean} createAnother If should create another authority output for this wallet, after delegating this one
   * @param {string} type Authority type to be delegated ('mint' or 'melt')
   * @param {string} pin Pin to generate new addresses, if necessary
   *
   * @return {Promise} Promise that resolves when transaction executing the delegate is completed
   *
   * @memberof Tokens
   * @inner
   */
  delegateAuthority(txID, index, addressSpent, token, address, createAnother, type, pin) {
    // Get delegate authority output data
    let newTxData = this.createDelegateAuthorityData(txID, index, addressSpent, token, address, createAnother, type);
    return transaction.sendTransaction(newTxData, pin);
  },

  /**
   * Destroy authority outputs
   *
   * @param {Object} data Array of objects each one containing the input with the authority being destroyed ({'tx_id', 'index', 'address', 'token'})
   * @param {string} pin Pin to generate new addresses, if necessary
   *
   * @return {Promise} Promise that resolves when transaction destroying the authority is completed
   *
   * @memberof Tokens
   * @inner
   */
  destroyAuthority(data, pin) {
    // Create new data without any output
    let newTxData = {'inputs': data, 'outputs': [], 'tokens': []};
    return transaction.sendTransaction(newTxData, pin);
  },

  /**
   * Filter an array of tokens removing one element
   *
   * @param {Object} tokens Array of token configs
   * @param {Object} toRemove Config of the token to be removed
   *
   * @return {Object} Array of token configs filtered
   *
   * @memberof Tokens
   * @inner
   */
  filterTokens(tokens, toRemove) {
    return tokens.filter((token) => token.uid !== toRemove.uid);
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
  getTokenIndex(tokens, uid) {
    // If token is Hathor, index is always 0
    // Otherwise, it is always the array index + 1
    if (uid === HATHOR_TOKEN_CONFIG.uid) {
      return 0;
    } else {
      const tokensWithoutHathor = this.filterTokens(tokens, HATHOR_TOKEN_CONFIG);
      const myIndex = tokensWithoutHathor.findIndex((token) => token.uid === uid);
      return myIndex + 1;
    }
  },

  /**
   * Get inputs and outputs for token mint deposit. The output will be the difference
   * between our inputs and the deposit amount.
   *
   * @param {int} mintAmount Amount of tokens to mint
   *
   * @throws {InsufficientTokensError} If not enough tokens for deposit
   *
   * @return {Object} Mint inputs/outputs data {'inputs', 'outputs'}
   *
   * @memberof Tokens
   * @inner
   */
  getMintDepositInfo(mintAmount) {
    const outputs = [];
    const data = wallet.getWalletData();
    const depositAmount = helpers.getDepositAmount(mintAmount);
    const htrInputs = wallet.getInputsFromAmount(data.historyTransactions, depositAmount, HATHOR_TOKEN_CONFIG.uid);
    if (htrInputs.inputsAmount < depositAmount) {
      throw new InsufficientTokensError(`Not enough tokens for deposit: ${depositAmount} required, ${htrInputs.inputsAmount} available`);
    }
    if (htrInputs.inputsAmount > depositAmount) {
      // Need to create change output
      const outputChange = wallet.getOutputChange(htrInputs.inputsAmount - depositAmount, 0);
      outputs.push(outputChange);
    }
    return {'inputs': htrInputs.inputs, 'outputs': outputs};
  },
}

export default tokens;
