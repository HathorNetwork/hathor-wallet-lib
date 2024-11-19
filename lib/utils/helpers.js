"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _path = _interopRequireDefault(require("path"));
var _buffer = _interopRequireDefault(require("buffer"));
var _bitcoreLib = require("bitcore-lib");
var _lodash = require("lodash");
var _opcodes = require("../opcodes");
var _constants = require("../constants");
var _transaction = _interopRequireDefault(require("../models/transaction"));
var _p2pkh = _interopRequireDefault(require("../models/p2pkh"));
var _p2sh = _interopRequireDefault(require("../models/p2sh"));
var _script_data = _interopRequireDefault(require("../models/script_data"));
var _create_token_transaction = _interopRequireDefault(require("../models/create_token_transaction"));
var _input = _interopRequireDefault(require("../models/input"));
var _output = _interopRequireDefault(require("../models/output"));
var _address = _interopRequireDefault(require("../models/address"));
var _buffer2 = require("./buffer");
var _errors = require("../errors");
var _errorMessages = require("../errorMessages");
var _config = _interopRequireDefault(require("../config"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Helper methods
 *
 * @namespace Helpers
 */

const helpers = {
  /**
   * Round float to closest int
   *
   * @param {number} n Number to be rounded
   *
   * @return {number} Closest integer to n passed
   *
   * @memberof Helpers
   * @inner
   */
  roundFloat(n) {
    return Math.round(n * 100) / 100;
  },
  /**
   * Validate if the passed version is valid, comparing with the minVersion
   *
   * @param {string} version Version to check if is valid
   * @param {string} minVersion Minimum allowed version
   *
   * @return {boolean}
   *
   * @memberof Helpers
   * @inner
   */
  isVersionAllowed(version, minVersion) {
    // Verifies if the version in parameter is allowed to make requests to other min version
    if (version.includes('beta') !== minVersion.includes('beta')) {
      // If one version is beta and the other is not, it's not allowed to use it
      return false;
    }

    // Clean the version string to have an array of integers
    // Check for each value if the version is allowed
    const versionTestArr = this.getCleanVersionArray(version);
    const minVersionArr = this.getCleanVersionArray(minVersion);
    for (let i = 0; i < minVersionArr.length; i++) {
      if (minVersionArr[i] > versionTestArr[i]) {
        return false;
      }
      if (minVersionArr[i] < versionTestArr[i]) {
        return true;
      }
    }
    return true;
  },
  /**
   * Get the version numbers separated by dot
   * For example: if you haver version 0.3.1-beta you will get ['0', '3', '1']
   *
   * @param {string} version
   *
   * @return {Array} Array of numbers with each version number
   *
   * @memberof Helpers
   * @inner
   */
  getCleanVersionArray(version) {
    return version.replace(/[^\d.]/g, '').split('.');
  },
  /**
   * Push data to the stack checking if need to add the OP_PUSHDATA1 opcode
   * We push the length of data and the data
   * In case the data has length > 75, we need to push the OP_PUSHDATA1 before the length
   * We always push bytes
   *
   * We update the array of Buffer sent as parameter, so we don't return a new one
   *
   * @param {Array} stack Stack of bytes from the script
   * @param {Buffer} data Data to be pushed to stack
   *
   * @memberof Helpers
   * @inner
   */
  pushDataToStack(stack, data) {
    // In case data has length bigger than 75, we need to add a pushdata opcode
    if (data.length > 75) {
      stack.push(_opcodes.OP_PUSHDATA1);
    }
    stack.push((0, _buffer2.intToBytes)(data.length, 1));
    stack.push(data);
  },
  /**
   * Push an integer to the stack
   * We always push an opcode representing the number from 0 to 16 (or OP_0 to OP_16)
   *
   * We update the array of Buffer sent as parameter, so we don't return a new one
   *
   * @param {Array} stack Stack of bytes from the script
   * @param {number} value number to be pushed on stack
   *
   * @memberof Helpers
   * @inner
   */
  pushIntToStack(stack, value) {
    if (value < 0 || value > 16) {
      throw new Error('Invalid OP_N, must be [0,16].');
    }
    // OP_0 is 0x50 (hex) or 80 (decimal), and OP_N is n + OP_0
    stack.push(Buffer.from([value + 80]));
  },
  /**
   * Return the checksum of the bytes passed
   * Checksum is calculated as the 4 first bytes of the double sha256
   *
   * @param {Buffer} bytes Data from where the checksum is calculated
   *
   * @return {Buffer}
   * @memberof Helpers
   * @inner
   */
  getChecksum(bytes) {
    return _bitcoreLib.crypto.Hash.sha256sha256(bytes).slice(0, 4);
  },
  /**
   * Get encoded address object from address hash (20 bytes) and network
   * We complete the address bytes with the network byte and checksum
   * then we encode to base 58 and create the address object
   *
   * @param {Buffer} addressHash 20 bytes of the address hash in the output script
   * @param {Network} network Network to get the address first byte parameter
   *
   * @return {Address}
   * @memberof Helpers
   * @inner
   */
  encodeAddress(addressHash, network) {
    if (addressHash.length !== 20) {
      throw new Error('Expect address hash that must have 20 bytes.');
    }
    const addressVersionBytes = _buffer.default.Buffer.from([network.versionBytes.p2pkh]);

    // With this sliced address we can calculate the checksum
    const slicedAddress = _buffer.default.Buffer.concat([addressVersionBytes, addressHash]);
    const checksum = this.getChecksum(slicedAddress);
    const addressBytes = _buffer.default.Buffer.concat([slicedAddress, checksum]);
    return new _address.default(_bitcoreLib.encoding.Base58.encode(addressBytes), {
      network
    });
  },
  /**
   * Get encoded address object from script hash (20 bytes) and network.
   * We use bitcore's Address module to build the address from the hash.
   *
   * @param {Buffer} scriptHash 20 bytes of the script hash in the output script
   * @param {Network} network Network to get the address first byte parameter
   *
   * @return {Address}
   * @memberof Helpers
   * @inner
   */
  encodeAddressP2SH(scriptHash, network) {
    if (scriptHash.length !== 20) {
      throw new Error('Expect script hash that must have 20 bytes.');
    }
    const addr = _bitcoreLib.Address.fromScriptHash(scriptHash, network.getNetwork());
    return new _address.default(addr.toString(), {
      network
    });
  },
  /**
   * Create a transaction from bytes
   * First we get the version value from the bytes to discover the
   * transaction type. We currently support only regular transactions and
   * create token transactions.
   *
   * @param {Buffer} bytes Transaction in bytes
   * @param {Network} network Network to get the address first byte parameter
   *
   * @throws ParseError if sequence of bytes is invalid or network is undefined/null
   *
   * @return {Transaction | CreateTokenTransaction}
   * @memberof Helpers
   * @inner
   */
  createTxFromBytes(bytes, network) {
    if (!network) {
      throw new _errors.ParseError('Invalid network parameter.');
    }

    // We should clone the buffer being sent in order to never mutate
    // what comes from outside the library
    // as soon as it's available natively we should use an immutable buffer
    const cloneBuffer = (0, _lodash.clone)(bytes);

    // Get version
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- No use for signalBits in this context
    const [_signalBits, buf] = (0, _buffer2.unpackToInt)(1, false, cloneBuffer);
    const [version] = (0, _buffer2.unpackToInt)(1, false, buf);
    if (version === _constants.DEFAULT_TX_VERSION) {
      return _transaction.default.createFromBytes(cloneBuffer, network);
    }
    if (version === _constants.CREATE_TOKEN_TX_VERSION) {
      return _create_token_transaction.default.createFromBytes(cloneBuffer, network);
    }
    throw new _errors.ParseError('We currently support only the Transaction and CreateTokenTransaction types. Other types will be supported in the future.');
  },
  /**
   * Create a transaction from hex
   * We transform the hex in bytes and call the function to get transaction from bytes
   *
   * @param {string} hex Transaction in hexadecimal
   * @param {Network} network Network to get the address first byte parameter
   *
   * @return {Transaction | CreateTokenTransaction}
   * @memberof Helpers
   * @inner
   */
  createTxFromHex(hex, network) {
    return this.createTxFromBytes((0, _buffer2.hexToBuffer)(hex), network);
  },
  /**
   * Asyncronous sleep
   * Creates a promise that will be resolved after sleep time
   *
   * @param {number} milliseconds Sleep time in milliseconds
   *
   * @return {Promise}
   * @memberof Helpers
   * @inner
   */
  async sleep(milliseconds) {
    const promise = new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, milliseconds);
    });
    return promise;
  },
  /**
   * Create a transaction from object data
   * We used to work only with data object to handle transactions in the past inside the lib
   * This method was created to transform those objects into Transaction class instances
   *
   * @param {Object} 'data': {'version', 'weight', 'timestamp', 'tokens', 'inputs': [{'tx_id', 'index'}], 'outputs': [{'address', 'value', 'tokenData', 'timelock'}]}
   *
   * if it's a create token transaction, then it expects 'name' and 'symbol' as well.
   *
   * @param {Network} network Network to get the address first byte parameter
   *
   * @throws {AddressError} If the address used in the P2PKH outputs is invalid
   *
   * @memberof Helpers
   * @inner
   */
  createTxFromData(data, network) {
    const inputs = [];
    for (const input of data.inputs) {
      const inputObj = new _input.default(input.tx_id, input.index, {
        data: input.data
      });
      inputs.push(inputObj);
    }
    const outputs = [];
    for (const output of data.outputs) {
      let outputObj;
      if (output.type === 'data') {
        // Is NFT output
        outputObj = this.createNFTOutput(output.data);
      } else if (output.type === 'p2sh') {
        // P2SH
        const address = new _address.default(output.address, {
          network
        });
        // This will throw AddressError in case the adress is invalid
        address.validateAddress();
        const p2sh = new _p2sh.default(address, {
          timelock: output.timelock || null
        });
        const p2shScript = p2sh.createScript();
        outputObj = new _output.default(output.value, p2shScript, {
          tokenData: output.tokenData
        });
      } else if (output.type === 'p2pkh' || output.type === undefined) {
        // P2PKH
        // for compatibility reasons we will accept an output without type as p2pkh as fallback
        const address = new _address.default(output.address, {
          network
        });
        // This will throw AddressError in case the adress is invalid
        address.validateAddress();
        const p2pkh = new _p2pkh.default(address, {
          timelock: output.timelock || null
        });
        const p2pkhScript = p2pkh.createScript();
        outputObj = new _output.default(output.value, p2pkhScript, {
          tokenData: output.tokenData
        });
      } else {
        throw new Error('Invalid output type.');
      }
      outputs.push(outputObj);
    }
    const options = {
      signalBits: data.signalBits,
      version: data.version,
      weight: data.weight,
      timestamp: data.timestamp,
      tokens: data.tokens
    };
    if (data.version === _constants.CREATE_TOKEN_TX_VERSION) {
      return new _create_token_transaction.default(data.name, data.symbol, inputs, outputs, options);
    }
    if (data.version === _constants.DEFAULT_TX_VERSION) {
      return new _transaction.default(inputs, outputs, options);
    }
    throw new _errors.ParseError(_errorMessages.ErrorMessages.UNSUPPORTED_TX_TYPE);
  },
  /**
   * Creates a Transaction instance from a populated object from the wallet's history methods.
   *
   * _Note_: This helper does not need a _Network_ parameter, since all the output scripts were already decoded.
   * @param {HistoryTransaction} historyTx A transaction formatted as an instance of a wallet history
   *
   * @memberof Helpers
   * @inner
   *
   * @example
   * const historyTx = myHathorWallet.getTx(myTxHash);
   * const txInstance = helpers.createTxFromHistoryObject(historyTx);
   */
  createTxFromHistoryObject(historyTx) {
    // Processing a token creation transaction
    const isCreateTokenTx = historyTx.version === _constants.CREATE_TOKEN_TX_VERSION;
    if (isCreateTokenTx && (!historyTx?.token_name || !historyTx?.token_symbol)) {
      throw new _errors.CreateTokenTxInvalid(`Missing token name or symbol`);
    }
    const inputs = historyTx.inputs.map(i => new _input.default(i.tx_id, i.index));
    const outputs = historyTx.outputs.map(this.createOutputFromHistoryObject);
    if (isCreateTokenTx) {
      return new _create_token_transaction.default(historyTx.token_name, historyTx.token_symbol, inputs, outputs, {
        ...historyTx
      });
    }
    return new _transaction.default(inputs, outputs, {
      ...historyTx
    });
  },
  /**
   * Creates an Output from an object extracted from the wallet's history.
   * @param {HistoryTransactionOutput} historyOutput An output from a tx populated and formatted by the wallet's
   *                                                 history methods
   *
   * @memberof Helpers
   * @inner
   *
   * @example
   * const historyTx = myHathorWallet.getTx(myTxHash);
   * const outputInstance = heleprs.createOutputFromHistoryObject(historyTx.outputs[0]);
   */
  createOutputFromHistoryObject(historyOutput) {
    return new _output.default(historyOutput.value, Buffer.from(historyOutput.script, 'base64'), {
      timelock: historyOutput.decoded.timelock || null,
      tokenData: historyOutput.token_data
    });
  },
  /**
   * Create NFT output from data string
   *
   * @memberof Helpers
   * @inner
   */
  createNFTOutput(data) {
    return this.createDataScriptOutput(data);
  },
  /**
   * Create an output with data script
   *
   * @memberof Helpers
   * @inner
   */
  createDataScriptOutput(data) {
    const scriptData = new _script_data.default(data);
    // Value 1 and token HTR
    return new _output.default(1n, scriptData.createScript());
  },
  /**
   * From the base58 of an address we get the type of it, i.e. 'p2pkh' or 'p2sh'
   *
   * @memberof Helpers
   * @inner
   */
  getOutputTypeFromAddress(address, network) {
    const addressObj = new _address.default(address, {
      network
    });
    return addressObj.getType();
  },
  /**
   * Get the URL to connect to the websocket from the server URL of the wallet
   *
   * @return {string} Websocket URL
   *
   * @memberof Helpers
   * @inner
   */
  getWSServerURL(url = null) {
    let serverURL;
    if (url === null) {
      serverURL = _config.default.getServerUrl();
    } else {
      serverURL = url;
    }
    const pieces = serverURL.split(':');
    const firstPiece = pieces.splice(0, 1);
    let protocol = '';
    if (firstPiece[0].indexOf('s') > -1) {
      // Has ssl
      protocol = 'wss';
    } else {
      // No ssl
      protocol = 'ws';
    }
    serverURL = _path.default.join(`${pieces.join(':')}`, 'ws/');
    serverURL = `${protocol}:/${serverURL}`;
    return serverURL;
  },
  /**
   * Handle error for method transaction.prepareData
   * Check if error is one of the expected and return the message
   * Otherwise, throws the unexpected error
   *
   * @param {unknown} e Error thrown
   *
   * @return {string} Error message
   * @memberof Helpers
   * @inner
   */
  handlePrepareDataError(e) {
    if (e instanceof _errors.AddressError || e instanceof _errors.OutputValueError || e instanceof _errors.ConstantNotSet || e instanceof _errors.CreateTokenTxInvalid || e instanceof _errors.MaximumNumberOutputsError || e instanceof _errors.MaximumNumberInputsError) {
      return e.message;
    }
    // Unhandled error
    throw e;
  },
  /**
   * Cleans a string for comparison. Remove multiple spaces, and spaces at the beginning and end, and transform to lowercase.
   *
   * @param {string} s String to be cleaned
   * @return {string} String after clean
   * @memberof Helpers
   */
  cleanupString(s) {
    return s.replace(/\s\s+/g, ' ').trim().toLowerCase();
  },
  /**
   * Axios fails merging this configuration to the default configuration because it has an issue
   * with circular structures: https://github.com/mzabriskie/axios/issues/370
   * Got this code from https://github.com/softonic/axios-retry/blob/master/es/index.mjs#L203
   *
   * Warning: This function mutates the `config` parameter
   *
   * @param {AxiosInstance} axios Axios instance
   * @param {AxiosRequestConfig} configObj New axios config
   *
   * @memberof Helpers
   * @inner
   */
  fixAxiosConfig(axios, configObj) {
    /* eslint-disable no-param-reassign */
    if (axios.defaults.httpAgent === configObj.httpAgent) {
      delete configObj.httpAgent;
    }
    if (axios.defaults.httpsAgent === configObj.httpsAgent) {
      delete configObj.httpsAgent;
    }
    configObj.transformRequest = [data => data];
    /* eslint-enable no-param-reassign */
  },
  /**
   * Returns a string with the short version of the id of a transaction
   * Returns {first12Chars}...{last12Chars}
   *
   * @param {string} hash Transaction ID to be shortened
   *
   * @return {string}
   * @memberof Helpers
   * @inner
   *
   */
  getShortHash(hash) {
    return `${hash.substring(0, 12)}...${hash.substring(52, 64)}`;
  },
  /**
   * Returns IDataInput formatted from an IUtxo object
   *
   * @param {IUtxo} utxo Utxo to get IDataInput from
   *
   * @return {IDataInput}
   * @memberof Helpers
   * @inner
   *
   */
  getDataInputFromUtxo(utxo) {
    return {
      txId: utxo.txId,
      index: utxo.index,
      value: utxo.value,
      authorities: utxo.authorities,
      token: utxo.token,
      address: utxo.address
    };
  },
  /**
   * The library network must be 'mainnet', 'testnet', or 'privatenet'
   * The full node has 'mainnet', 'testnet-bravo', 'nano-testnet-alpha' and
   * we must translate it into library networks.
   *
   * @param {string} fullNodeNetwork The network from full node API
   *
   * @memberof Helpers
   * @inner
   *
   */
  getNetworkFromFullNodeNetwork(fullNodeNetwork) {
    if (fullNodeNetwork === 'mainnet') {
      return fullNodeNetwork;
    }
    if (fullNodeNetwork.includes('testnet')) {
      return 'testnet';
    }
    return 'privatenet';
  }
};
var _default = exports.default = helpers;