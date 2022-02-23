/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { OP_GREATERTHAN_TIMESTAMP, OP_DUP, OP_HASH160, OP_EQUALVERIFY, OP_CHECKSIG, OP_PUSHDATA1 } from './opcodes';
import { DECIMAL_PLACES, CREATE_TOKEN_TX_VERSION, DEFAULT_TX_VERSION, TOKEN_INFO_VERSION, MAX_OUTPUT_VALUE_32, MAX_OUTPUT_VALUE, TOKEN_AUTHORITY_MASK, STRATUM_TIMEOUT_RETURN_CODE } from './constants';
import { HDPrivateKey, crypto, encoding, util } from 'bitcore-lib';
import { AddressError, OutputValueError, ConstantNotSet, CreateTokenTxInvalid, MaximumNumberInputsError, MaximumNumberOutputsError, MaximumNumberParentsError } from './errors';
import { hexToBuffer } from './utils/buffer';
import helpersUtils from './utils/helpers';
import dateFormatter from './date';
import helpers from './helpers';
import network from './network';
import wallet from './wallet';
import storage from './storage';
import buffer from 'buffer';
import Long from 'long';
import walletApi from './api/wallet';
import { get } from 'lodash';
import Address from './models/address';
import P2PKH from './models/p2pkh';
import P2SH from './models/p2sh';
import ScriptData from './models/script_data';
import P2SHSignature from './models/p2sh_signature';


/**
 * Transaction utils with methods to serialize, create and handle transactions
 *
 * @namespace Transaction
 */

const transaction = {
  /**
   * Should never be accessed directly, only through updateTransactionWeightConstants or getTransactionWeightConstants
   *
   * _weightConstants {Object} Holds the constants used to calculate a transaction's weight {
   *   txMinWeight {number} Minimum allowed weight for a tx (float)
   *   txWeightCoefficient {number} Coefficient to be used when calculating tx weight (float)
   *   txMinWeightK {number} TODO
   * }
   */
  _weightConstants: null,

  /**
   * Should never be accessed directly, only through updateMaxInputsConstant or getMaxInputsConstant
   *
   * _maxInputsConstant {number} Maximum number of inputs allowed in a transaction
   */
  _maxInputsConstant: null,

  /**
   * Should never be accessed directly, only through updateMaxOutputsConstant or getMaxOutputsConstant
   *
   * _maxOutputsConstant {number} Maximum number of outputs allowed in a transaction
   */
  _maxOutputsConstant: null,

  /**
   * Transform int to bytes
   *
   * @param {number} number Integer to be transformed to bytes
   * @param {number} bytes How many bytes this number uses
   *
   * @return {Buffer} number in bytes
   * @memberof Transaction
   * @inner
   */
  intToBytes(number, bytes) {
    let arr = new ArrayBuffer(bytes);
    let view = new DataView(arr);
    if (bytes === 1) {
      // byteOffset = 0; isLittleEndian = false
      view.setUint8(0, number, false);
    } else if (bytes === 2) {
      // byteOffset = 0; isLittleEndian = false
      view.setUint16(0, number, false);
    } else if (bytes === 4) {
      view.setUint32(0, number, false);
    }
    return buffer.Buffer.from(arr);
  },

  /**
   * Transform signed int to bytes (1, 2, or 4 bytes)
   *
   * @param {number} number Integer to be transformed to bytes
   * @param {number} bytes How many bytes this number uses
   *
   * @return {Buffer} number in bytes
   * @memberof Transaction
   * @inner
   */
  signedIntToBytes(number, bytes) {
    let arr = new ArrayBuffer(bytes);
    let view = new DataView(arr);
    if (bytes === 1) {
      // byteOffset = 0; isLittleEndian = false
      view.setInt8(0, number, false);
    } else if (bytes === 2) {
      // byteOffset = 0; isLittleEndian = false
      view.setInt16(0, number, false);
    } else if (bytes === 4) {
      view.setInt32(0, number, false);
    } else if (bytes === 8) {
      // In case of 8 bytes I need to handle the int with a Long lib
      let long = Long.fromNumber(number, false);
      arr = long.toBytesBE();
    }
    return buffer.Buffer.from(arr);
  },

  /**
   * Transform float to bytes
   *
   * @param {number} number Integer to be transformed to bytes
   * @param {number} bytes How many bytes this number uses
   *
   * @return {Buffer} number in bytes
   * @memberof Transaction
   * @inner
   */
  floatToBytes(number, bytes) {
    let arr = new ArrayBuffer(bytes);
    let view = new DataView(arr);
    if (bytes === 8) {
      // byteOffset = 0; isLitteEndian = false
      view.setFloat64(0, number, false);
    }
    return buffer.Buffer.from(arr);
  },

  /**
   * Check if address is a valid string
   *
   * @param {string} address Address in base58
   *
   * @return {boolean} If address is valid
   * @memberof Transaction
   * @inner
   */
  isAddressValid(address) {
    try {
      const addressBytes = this.decodeAddress(address);
      return this.validateAddress(address, addressBytes);
    } catch (e) {
      if (e instanceof AddressError) {
        return false;
      }
      throw e;
    }
  },

  /**
   * Decode address in base58 to bytes
   *
   * @param {string} address Address in base58
   *
   * @return {Buffer} address in bytes
   * @memberof Transaction
   * @inner
   */
  decodeAddress(address) {
    try {
      return encoding.Base58.decode(address);
    } catch (e) {
      throw new AddressError('Invalid base58 address');
    }
  },

  /**
   * Validate if the address is valid
   *
   * 1. Address must have 25 bytes
   * 2. Address checksum must be valid
   * 3. Address first byte must match one of the options for P2PKH or P2SH
   *
   * @param {string} address Address in base58
   * @param {Buffer} addressBytes Address in bytes
   *
   * @throws {AddressError} Will throw an error if address is not valid
   *
   * @return {boolean}
   * @memberof Transaction
   * @inner
   */
  validateAddress(address, addressBytes) {
    const errorMessage = `Invalid address: ${address}`;
    // Validate address length
    if (addressBytes.length !== 25) {
      throw new AddressError(errorMessage);
    }

    // Validate address checksum
    const checksum = addressBytes.slice(-4);
    const addressSlice = addressBytes.slice(0, -4);
    const correctChecksum = this.getChecksum(addressSlice);
    if (!util.buffer.equals(checksum, correctChecksum)) {
      throw new AddressError(errorMessage);
    }

    // Validate version byte. Should be the p2pkh or p2sh
    if (network.isVersionByteValid(addressBytes[0])) {
      throw new AddressError(errorMessage);
    }
    return true;
  },

  /**
   * Return the checksum of the bytes passed
   * Checksum is calculated as the 4 first bytes of the double sha256
   *
   * @param {Buffer} bytes Data from where the checksum is calculated
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  getChecksum(bytes) {
    return crypto.Hash.sha256sha256(bytes).slice(0, 4);
  },

  /**
   * Push data to the stack checking if need to add the OP_PUSHDATA1 opcode
   * We push the length of data and the data
   * In case the data has length > 75, we need to push the OP_PUSHDATA1 before the length
   * We always push bytes
   *
   * @param {Array} stack Stack of bytes from the script
   * @param {Buffer} data Data to be pushed to stack
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  pushDataToStack(stack, data) {
    // In case data has length bigger than 75, we need to add a pushdata opcode
    if (data.length > 75) {
      stack.push(OP_PUSHDATA1);
    }
    stack.push(this.intToBytes(data.length, 1));
    stack.push(data);
  },

  /**
   * Create output script
   *
   * @param {Object} output Output object with {address, timelock} or {data}
   *
   * @throws {AddressError} If the address of the P2PKH output is invalid
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  createOutputScript(output) {
    if (output.type === 'data') {
      // Data script for NFT
      const scriptData = new ScriptData(output.data);
      return scriptData.createScript();
    } else if (output.type === 'p2sh') {
      // P2SH
      const address = new Address(output.address, { network });
      // This will throw AddressError in case the address is invalid
      address.validateAddress();
      const p2sh = new P2SH(address, { timelock: output.timelock });
      return p2sh.createScript();
    } else if (output.type === 'p2pkh' || output.type === undefined) {
      // P2PKH
      // for compatibility reasons we will accept an output without type as p2pkh as fallback
      const address = new Address(output.address, { network });
      // This will throw AddressError in case the address is invalid
      address.validateAddress();
      const p2pkh = new P2PKH(address, { timelock: output.timelock });
      return p2pkh.createScript();
    } else {
      throw new Error('Invalid output for creating script.');
    }
  },

  /**
   * Create input data
   *
   * @param {Buffer} signature Input signature
   * @param {Buffer} publicKey Input public key
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  createInputData(signature, publicKey) {
    let arr = [];
    this.pushDataToStack(arr, signature);
    this.pushDataToStack(arr, publicKey);
    return util.buffer.concat(arr);
  },

  /**
   * Return transaction data to sign in inputs
   *
   * @param {Object} txData Object with inputs and outputs {'inputs': [{'tx_id', 'index', 'token'}], 'outputs': ['address', 'value', 'timelock', 'tokenData'], 'tokens': [uid, uid2]}
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  dataToSign(txData) {
    let arr = []
    // Tx version
    arr.push(this.intToBytes(txData.version, 2))

    // Len tokens
    if ('tokens' in txData) {
      // Create token tx does not have tokens array
      arr.push(this.intToBytes(txData.tokens.length, 1))
    }

    // Len inputs
    arr.push(this.intToBytes(txData.inputs.length, 1))
    // Len outputs
    arr.push(this.intToBytes(txData.outputs.length, 1))

    // Tokens data
    if ('tokens' in txData) {
      // Create token tx does not have tokens array
      for (const token of txData.tokens) {
        arr.push(new encoding.BufferReader(token).buf);
      }
    }

    for (let inputTx of txData.inputs) {
      arr.push(hexToBuffer(inputTx.tx_id));
      arr.push(this.intToBytes(inputTx.index, 1));
      // Input data will be fixed to 0 for now
      arr.push(this.intToBytes(0, 2));
    }

    for (let outputTx of txData.outputs) {
      arr.push(this.outputValueToBytes(outputTx.value));
      // Token data
      arr.push(this.intToBytes(outputTx.tokenData, 1));

      const outputScript = this.createOutputScript(outputTx);
      arr.push(this.intToBytes(outputScript.length, 2));
      arr.push(outputScript);
    }

    if (txData.version === CREATE_TOKEN_TX_VERSION) {
      // Create token tx need to add extra information
      arr = [...arr, ...this.serializeTokenInfo(txData)];
    }

    return util.buffer.concat(arr);
  },

  /*
   * Add input data to each input of tx data that belongs to the wallet loaded
   *
   * @param {Object} data Object with inputs and outputs {'inputs': [{'tx_id', 'index', 'token', 'address'}], 'outputs': ['address', 'value', 'timelock']}
   * @param {Buffer} dataToSign data to sign the transaction in bytes
   * @param {string} pin PIN to decrypt the private key
   *
   * @return {Object} data
   *
   * @memberof Transaction
   * @inner
   */
  signTx(data, dataToSign, pin) {
    const hashbuf = this.getDataToSignHash(dataToSign);

    const walletData = wallet.getWalletData();
    if (walletData === null) {
      return data;
    }
    const keys = walletData.keys;
    for (const input of data.inputs) {
      if (input.address in keys) {
        // We will only sign the inputs that belong to the loaded wallet
        const index = keys[input.address].index;
        input['data'] = this.getSignature(index, hashbuf, pin);
      }
    }
    return data;
  },

  getAllSignatures(txHex, network, pin) {
    const tx = helpersUtils.createTxFromHex(txHex, network);
    const hash = tx.getDataToSignHash();
    const accessData = storage.getItem('wallet:accessData');
    const privateKeyStr = wallet.decryptData(accessData.mainKey, pin);
    const key = HDPrivateKey(privateKeyStr);
    const signatures = {};

    for (const {index, value} of tx.inputs.map((value, index) => ({index, value}))) {
      // get address index
      const addressIndex = walet.getAddressIndex(input.address);
      if (!addressIndex) continue;

      const derivedKey = key.deriveNonCompliantChild(index);
      const privateKey = derivedKey.privateKey;

      // derive key to address index
      const sig = crypto.ECDSA.sign(hash, privateKey, 'little').set({
        nhashtype: crypto.Signature.SIGHASH_ALL
      });

      signatures[index] = sig.toDER();
    }
    const p2shSig = P2SHSignature(key.xpubkey, signatures);
    return p2shSig.serialize();
  },

  /*
   * Get signature of an input based in the private key
   *
   * @param {number} index Index of the address to get the private key
   * @param {Buffer} hash hashed data to sign the transaction
   * @param {string} pin PIN to decrypt the private key
   *
   * @return {Buffer} input data
   *
   * @memberof Transaction
   * @inner
   */
  getSignature(index, hash, pin) {
    const accessData = storage.getItem('wallet:accessData');
    const encryptedPrivateKey = accessData.mainKey;
    const privateKeyStr = wallet.decryptData(encryptedPrivateKey, pin);
    const key = HDPrivateKey(privateKeyStr)
    const derivedKey = key.deriveNonCompliantChild(index);
    const privateKey = derivedKey.privateKey;

    const sig = crypto.ECDSA.sign(hash, privateKey, 'little').set({
      nhashtype: crypto.Signature.SIGHASH_ALL
    });
    return this.createInputData(sig.toDER(), derivedKey.publicKey.toBuffer());
  },

  /*
   * Execute hash of the data to sign
   *
   * @param {Buffer} dataToSign data to sign the transaction in bytes
   *
   * @return {Buffer} data to sign hashed
   *
   * @memberof Transaction
   * @inner
   */
  getDataToSignHash(dataToSign) {
    const hashbuf = crypto.Hash.sha256sha256(dataToSign);
    return new encoding.BufferReader(hashbuf).readReverse();
  },

  /**
   * Calculate the minimum tx weight
   *
   * @param {Object} txData Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index'}],
   *  'outputs': [{'address', 'value', 'tokenData'}],
   *  'version': 1,
   *  'weight': 0,
   *  'nonce': 0,
   *  'timestamp': 1,
   * }
   *
   * @throws {ConstantNotSet} If the weight constants are not set yet
   * @throws {MaximumNumberParentsError} If the tx has more parents than the maximum allowed
   *
   * @return {number} Minimum weight calculated (float)
   * @memberof Transaction
   * @inner
   */
  calculateTxWeight(txData) {
    let txSize = this.txToBytes(txData).length;

    if (txData.parents && txData.parents.length > 2) {
      throw new MaximumNumberParentsError(`Transaction has ${txData.parents.length} parents and can have at most 2.`);
    }

    // Parents may not be sent in txData
    const parents = get(txData, 'parents') || [];
    txSize += 64 - (32 * parents.length);

    let sumOutputs = this.getOutputsSum(txData.outputs);
    // Preventing division by 0 when handling authority methods that have no outputs
    sumOutputs = Math.max(1, sumOutputs);

    // We need to take into consideration the decimal places because it is inside the amount.
    // For instance, if one wants to transfer 20 HTRs, the amount will be 2000.
    const amount = sumOutputs / (10 ** DECIMAL_PLACES);

    const txWeightConstants = this.getTransactionWeightConstants();

    let weight = (txWeightConstants.txWeightCoefficient * Math.log2(txSize) + 4 / (1 + txWeightConstants.txMinWeightK / amount) + 4);

    // Make sure the calculated weight is at least the minimum
    weight = Math.max(weight, txWeightConstants.txMinWeight)
    // FIXME precision difference between backend and frontend (weight (17.76246721531992) is smaller than the minimum weight (17.762467215319923))
    return weight + 1e-6;
  },

  /**
   * Calculate the sum of outputs. Authority outputs are ignored.
   *
   * @param {Array} outputs
   * [{
   *  'address': str,
   *  'value': int,
   *  'tokenData': int,
   * }]
   *
   * @return {number} Sum of outputs
   * @memberof Transaction
   * @inner
   */
  getOutputsSum(outputs) {
    let sumOutputs = 0;
    for (let output of outputs) {
      if (this.isTokenDataAuthority(output.tokenData)) {
        continue
      }
      sumOutputs += output.value;
    }
    return sumOutputs;
  },

  /**
   * Complete the txData
   *
   * Add weight, nonce, version, and timestamp to the txData
   *
   * @param {Object} txData Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index'}],
   *  'outputs': [{'address', 'value', 'tokenData'}],
   * }
   *
   * @throws {ConstantNotSet} If the weight constants are not set yet
   *
   * @memberof Transaction
   * @inner
   */
  completeTx(incompleteTxData) {
    // Generate new tx data.
    const newData = Object.assign({
      weight: 0,
      nonce: 0,
      version: DEFAULT_TX_VERSION,
      timestamp: dateFormatter.dateToTimestamp(new Date()),
    }, incompleteTxData);

    // Update incompleteTxData.
    Object.assign(incompleteTxData, newData);
  },

  /**
   * Update weight from tx data (if not set yet)
   *
   * @param {Object} data Object with complete tx data
   * {
   *  'inputs': [{'tx_id', 'index'}],
   *  'outputs': ['address', 'value', 'timelock'],
   *  'nonce': 0,
   *  'version': 1,
   *  'timestamp': 123,
   * }
   *
   * @memberof Transaction
   * @inner
   */
  setWeightIfNeeded(data) {
    // Calculate tx weight if needed.
    if (!('weight' in data) || data.weight === 0) {
      let minimumWeight = this.calculateTxWeight(data);
      data['weight'] = minimumWeight;
    }
  },

  /**
   * Serialize tx to bytes
   *
   * @param {Object} txData Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index', 'token'}],
   *  'outputs': ['address', 'value', 'timelock', 'tokenData'],
   *  'tokens': [uid, uid2],
   *  'version': 1,
   *  'weight': 0,
   *  'nonce': 0,
   *  'timestamp': 1,
   * }
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  txToBytes(txData) {
    let arr = []
    // Serialize first the funds part
    //
    // Tx version
    arr.push(this.intToBytes(txData.version, 2))
    if ('tokens' in txData) {
      // Len tokens
      arr.push(this.intToBytes(txData.tokens.length, 1))
    }
    // Len inputs
    arr.push(this.intToBytes(txData.inputs.length, 1))
    // Len outputs
    arr.push(this.intToBytes(txData.outputs.length, 1))

    if ('tokens' in txData) {
      for (const token of txData.tokens) {
        arr.push(new encoding.BufferReader(token).buf);
      }
    }

    for (let inputTx of txData.inputs) {
      arr.push(hexToBuffer(inputTx.tx_id));
      arr.push(this.intToBytes(inputTx.index, 1));
      arr.push(this.intToBytes(inputTx.data.length, 2));
      arr.push(inputTx.data);
    }

    for (let outputTx of txData.outputs) {
      arr.push(this.outputValueToBytes(outputTx.value));
      // Token data
      arr.push(this.intToBytes(outputTx.tokenData, 1));

      const outputScript = this.createOutputScript(outputTx);
      arr.push(this.intToBytes(outputScript.length, 2));
      arr.push(outputScript);
    }

    if (txData.version === CREATE_TOKEN_TX_VERSION) {
      // Add create token tx serialization
      arr = [...arr, ...this.serializeTokenInfo(txData)];
    }

    // Now serialize the graph part
    //
    // Weight is a float with 8 bytes
    arr.push(this.floatToBytes(txData.weight, 8));
    // Timestamp
    arr.push(this.intToBytes(txData.timestamp, 4))
    if (txData.parents) {
      arr.push(this.intToBytes(txData.parents.length, 1))
      for (const parent of txData.parents) {
        arr.push(hexToBuffer(parent));
      }
    } else {
      // Len parents (parents will be calculated in the backend)
      arr.push(this.intToBytes(0, 1))
    }

    // Add nonce in the end
    arr.push(this.intToBytes(txData.nonce, 4));
    return util.buffer.concat(arr);
  },

  /**
   * Get the bytes from the output value
   * If value is above the maximum for 32 bits we get from 8 bytes, otherwise only 4 bytes
   *
   * @param {number} value Output value
   *
   * @throws {OutputValueError} Will throw an error if output value is invalid
   *
   * @return {Buffer}
   *
   * @memberof Transaction
   * @inner
   */
  outputValueToBytes(value) {
    if (value <= 0) {
      throw new OutputValueError('Output value must be positive');
    }
    if (value > MAX_OUTPUT_VALUE) {
      throw new OutputValueError(`Maximum value is ${helpers.prettyValue(MAX_OUTPUT_VALUE)}`);
    }
    if (value > MAX_OUTPUT_VALUE_32) {
      return this.signedIntToBytes(-value, 8);
    } else {
      return this.signedIntToBytes(value, 4);
    }
  },

  /**
   * Validate transaction information.
   * For now, we only verify the maximum number of inputs and outputs.
   *
   * @param {Object} data Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index', 'token', 'address'}],
   *  'outputs': ['address', 'value', 'timelock', 'tokenData'],
   * }
   *
   * @throws {MaximumNumberInputsError} If the tx has more inputs than the maximum allowed
   * @throws {MaximumNumberOutputsError} If the tx has more outputs than the maximum allowed
   *
   * @memberof Transaction
   * @inner
   */
  verifyTxData(data) {
    const maxNumberInputs = transaction.getMaxInputsConstant();
    const maxNumberOutputs = transaction.getMaxOutputsConstant();

    if (data.inputs.length > maxNumberInputs) {
      throw new MaximumNumberInputsError(`Transaction has ${data.inputs.length} inputs and can have at most ${maxNumberInputs}.`);
    }

    if (data.outputs.length > maxNumberOutputs) {
      throw new MaximumNumberOutputsError(`Transaction has ${data.outputs.length} outputs and can have at most ${maxNumberOutputs}.`);
    }
  },

  /**
   * Prepare a transaction without propagating to the network.
   *
   * @param {Object} data Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index', 'token', 'address'}],
   *  'outputs': ['address', 'value', 'timelock', 'tokenData'],
   * }
   * @param {string} pin Pin to decrypt data
   * @param {Object} {
   *   {number} minimumTimestamp Default is 0.
   * }
   *
   * @return {Object} data
   * @memberof Transaction
   **/
  prepareData(data, pin, options) {
    const fnOptions = Object.assign({
      minimumTimestamp: 0,
      getSignature: true,
      completeTx: true,
    }, options);

    const { minimumTimestamp, getSignature, completeTx } = fnOptions;
    if (completeTx) {
      // Completing data in the same object
      transaction.completeTx(data);
    }

    if (getSignature) {
      const dataToSign = transaction.dataToSign(data);
      data = transaction.signTx(data, dataToSign, pin);
    }

    transaction.verifyTxData(data);

    if (data.timestamp < minimumTimestamp) {
      data.timestamp = minimumTimestamp;
    }

    // Set weight only after completing all the fields
    transaction.setWeightIfNeeded(data);

    return data;
  },

  /**
   * Complete and send a transaction to the full node
   *
   * @param {Object} data Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index', 'token', 'address'}],
   *  'outputs': ['address', 'value', 'timelock', 'tokenData'],
   * }
   * @param {string} pin Pin to decrypt data
   * @param {Object} {
   *   {number} minimumTimestamp Default is 0.
   * }
   *
   * @return {Promise}
   * @memberof Transaction
   * @inner
   */
  sendTransaction(data, pin, options) {
    try {
      data = transaction.prepareData(data, pin, options);
    } catch (e) {
      const message = helpers.handlePrepareDataError(e);
      return Promise.reject(message);
    }
    return transaction.sendPreparedTransaction(data);
  },

  /**
   * Get tx data and return it in hexadecimal
   *
   * @param {Object} data Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index', 'token', 'address'}],
   *  'outputs': ['address', 'value', 'timelock', 'tokenData'],
   * }
   *
   * @return {String} Hexadecimal of a serialized tx
   * @memberof Transaction
   * @inner
   */
  getTxHexFromData(data) {
    const txBytes = transaction.txToBytes(data);
    return util.buffer.bufferToHex(txBytes);
  },

  /**
   * Send a transaction to the full node. This transaction must have
   * already been prepared, i.e., it must be complete.
   *
   * @param {Object} data Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index', 'token', 'address'}],
   *  'outputs': ['address', 'value', 'timelock', 'tokenData'],
   * }
   *
   * @return {Promise}
   * @memberof Transaction
   * @inner
   */
  sendPreparedTransaction(data) {
    const promise = new Promise((resolve, reject) => {
      const txHex = this.getTxHexFromData(data);
      walletApi.sendTokens(txHex, (response) => {
        if (response.success) {
          resolve(response);
        } else {
          let message = '';
          if (response.return_code === STRATUM_TIMEOUT_RETURN_CODE) {
            message = 'Timeout solving transaction\'s proof-of-work.\n\nAll transactions need to solve a proof-of-work as an anti spam mechanism. Currently, Hathor Labs provides this service for free, but their servers may be fully loaded right now.\n\nThe bigger the transactions, the harder it is to solve the proof-of-work. Please, wait a few moments and try again soon. If you can split your transaction into smaller ones it might be easier to send them.';
          } else {
            message = response.message;
          }
          reject(message);
        }
      }).catch((e) => {
        // Error in request
        reject(e.message);
      });
    });
    return promise;
  },

  /**
   * Save txMinWeight, txWeightCoefficient and txMinWeightK
   *
   * @param {number} txMinWeight Minimum allowed weight for a tx (float)
   * @param {number} txWeightCoefficient Coefficient to be used when calculating tx weight (float)
   * @param {number} txMinWeightK TODO
   *
   * @memberof Transaction
   * @inner
   */
  updateTransactionWeightConstants(txMinWeight, txWeightCoefficient, txMinWeightK) {
    const constants = { txMinWeight, txWeightCoefficient, txMinWeightK };
    this._weightConstants = constants;
  },

  /**
   * Return the transaction weight constants that was saved using a response from the backend
   *
   * @return {Object} Object with the parameters {'txMinWeight', 'txWeightCoefficient', 'txMinWeightK'}
   *
   * @throws {ConstantNotSet} If the weight constants are not set yet
   *
   * @memberof Transaction
   * @inner
   */
  getTransactionWeightConstants() {
    if (this._weightConstants === null) {
      throw new ConstantNotSet('Transaction weight constants are not set');
    }
    return this._weightConstants;
  },

  /**
   * Clear weight constants
   *
   * @memberof Transaction
   * @inner
   */
  clearTransactionWeightConstants() {
    this._weightConstants = null;
  },

  /**
   * Serialize create token tx info to bytes
   *
   * @param {Object} txData Object with name and symbol of token
   * {
   *  'name': 'TokenName',
   *  'symbol': 'TKN',
   * }
   *
   * @return {Array} array of bytes
   * @memberof Transaction
   * @inner
   */
  serializeTokenInfo(txData) {
    if (!('name' in txData) || !('symbol' in txData)) {
      throw new CreateTokenTxInvalid('Token name and symbol are required when creating a new token');
    }

    const nameBytes = buffer.Buffer.from(txData.name, 'utf8');
    const symbolBytes = buffer.Buffer.from(txData.symbol, 'utf8');
    const arr = [];
    // Token info version
    arr.push(this.intToBytes(TOKEN_INFO_VERSION, 1));
    // Token name size
    arr.push(this.intToBytes(nameBytes.length, 1));
    // Token name
    arr.push(nameBytes);
    // Token symbol size
    arr.push(this.intToBytes(symbolBytes.length, 1));
    // Token symbol
    arr.push(symbolBytes);
    return arr;
  },

  /*
   * Returns if token data indicates an authority output or not
   *
   * @param {number} tokenData The token data
   *
   * @return {boolean} if token data indicates authority output
   *
   * @memberof Transaction
   * @inner
   */
  isTokenDataAuthority(tokenData) {
    return (tokenData & TOKEN_AUTHORITY_MASK) > 0
  },

  /**
   * Save max inputs constant
   *
   * @param {number} maxInputs Maximum number of inputs allowed in a transaction
   *
   * @memberof Transaction
   * @inner
   */
  updateMaxInputsConstant(maxInputs) {
    this._maxInputsConstant = maxInputs;
  },

  /**
   * Return the maximum number of inputs
   *
   * @return {number}
   *
   * @throws {ConstantNotSet} If the constant was not set yet
   *
   * @memberof Transaction
   * @inner
   */
  getMaxInputsConstant() {
    if (this._maxInputsConstant === null) {
      throw new ConstantNotSet('Maximum number of inputs constants is not set yet');
    }
    return this._maxInputsConstant;
  },

  /**
   * Clear max number of inputs constant
   *
   * @memberof Transaction
   * @inner
   */
  clearMaxInputsConstant() {
    this._maxInputsConstant = null;
  },

  /**
   * Save max outputs constant
   *
   * @param {number} maxOutputs Maximum number of outputs allowed in a transaction
   *
   * @memberof Transaction
   * @inner
   */
  updateMaxOutputsConstant(maxOutputs) {
    this._maxOutputsConstant = maxOutputs;
  },

  /**
   * Return the maximum number of outputs
   *
   * @return {number}
   *
   * @throws {ConstantNotSet} If the constant was not set yet
   *
   * @memberof Transaction
   * @inner
   */
  getMaxOutputsConstant() {
    if (this._maxOutputsConstant === null) {
      throw new ConstantNotSet('Maximum number of outputs constants is not set yet');
    }
    return this._maxOutputsConstant;
  },

  /**
   * Clear max number of outputs constant
   *
   * @memberof Transaction
   * @inner
   */
  clearMaxOutputsConstant() {
    this._maxOutputsConstant = null;
  },
}

export default transaction;
