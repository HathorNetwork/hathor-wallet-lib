'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _opcodes = require('./opcodes');

var _constants = require('./constants');

var _bitcoreLib = require('bitcore-lib');

var _errors = require('./errors');

var _date = require('./date');

var _date2 = _interopRequireDefault(_date);

var _helpers = require('./helpers');

var _helpers2 = _interopRequireDefault(_helpers);

var _wallet = require('./wallet');

var _wallet2 = _interopRequireDefault(_wallet);

var _buffer = require('buffer');

var _buffer2 = _interopRequireDefault(_buffer);

var _long = require('long');

var _long2 = _interopRequireDefault(_long);

var _wallet3 = require('./api/wallet');

var _wallet4 = _interopRequireDefault(_wallet3);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Transaction utils with methods to serialize, create and handle transactions
 *
 * @namespace Transaction
 */

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var transaction = {
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
  intToBytes: function intToBytes(number, bytes) {
    var arr = new ArrayBuffer(bytes);
    var view = new DataView(arr);
    if (bytes === 1) {
      // byteOffset = 0; isLittleEndian = false
      view.setUint8(0, number, false);
    } else if (bytes === 2) {
      // byteOffset = 0; isLittleEndian = false
      view.setUint16(0, number, false);
    } else if (bytes === 4) {
      view.setUint32(0, number, false);
    }
    return _buffer2.default.Buffer.from(arr);
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
  signedIntToBytes: function signedIntToBytes(number, bytes) {
    var arr = new ArrayBuffer(bytes);
    var view = new DataView(arr);
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
      var long = _long2.default.fromNumber(number, false);
      arr = long.toBytesBE();
    }
    return _buffer2.default.Buffer.from(arr);
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
  floatToBytes: function floatToBytes(number, bytes) {
    var arr = new ArrayBuffer(bytes);
    var view = new DataView(arr);
    if (bytes === 8) {
      // byteOffset = 0; isLitteEndian = false
      view.setFloat64(0, number, false);
    }
    return _buffer2.default.Buffer.from(arr);
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
  decodeAddress: function decodeAddress(address) {
    try {
      return _bitcoreLib.encoding.Base58.decode(address);
    } catch (e) {
      throw new _errors.AddressError('Invalid base58 address');
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
  validateAddress: function validateAddress(address, addressBytes) {
    var errorMessage = 'Invalid address: ' + address;
    // Validate address length
    if (addressBytes.length !== 25) {
      throw new _errors.AddressError(errorMessage);
    }

    // Validate address checksum
    var checksum = addressBytes.slice(-4);
    var addressSlice = addressBytes.slice(0, -4);
    var correctChecksum = this.getChecksum(addressSlice);
    if (!_bitcoreLib.util.buffer.equals(checksum, correctChecksum)) {
      throw new _errors.AddressError(errorMessage);
    }

    // Validate version byte. Should be the p2pkh or p2sh
    var firstByte = addressBytes[0];
    if (firstByte !== _constants.P2PKH_BYTE && firstByte !== _constants.P2SH_BYTE) {
      throw new _errors.AddressError(errorMessage);
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
  getChecksum: function getChecksum(bytes) {
    return _bitcoreLib.crypto.Hash.sha256sha256(bytes).slice(0, 4);
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
  pushDataToStack: function pushDataToStack(stack, data) {
    // In case data has length bigger than 75, we need to add a pushdata opcode
    if (data.length > 75) {
      stack.push(_opcodes.OP_PUSHDATA1);
    }
    stack.push(this.intToBytes(data.length, 1));
    stack.push(data);
  },


  /**
   * Create output script
   * 
   * @param {string} address Address in base58
   * @param {number} [timelock] Timelock in timestamp
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  createOutputScript: function createOutputScript(address, timelock) {
    var arr = [];
    var addressBytes = this.decodeAddress(address);
    if (this.validateAddress(address, addressBytes)) {
      var addressHash = addressBytes.slice(1, -4);
      if (timelock) {
        var timelockBytes = this.intToBytes(timelock, 4);
        this.pushDataToStack(arr, timelockBytes);
        arr.push(_opcodes.OP_GREATERTHAN_TIMESTAMP);
      }
      arr.push(_opcodes.OP_DUP);
      arr.push(_opcodes.OP_HASH160);
      // addressHash has a fixed size of 20 bytes, so no need to push OP_PUSHDATA1
      arr.push(this.intToBytes(addressHash.length, 1));
      arr.push(addressHash);
      arr.push(_opcodes.OP_EQUALVERIFY);
      arr.push(_opcodes.OP_CHECKSIG);
      return _bitcoreLib.util.buffer.concat(arr);
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
  createInputData: function createInputData(signature, publicKey) {
    var arr = [];
    this.pushDataToStack(arr, signature);
    this.pushDataToStack(arr, publicKey);
    return _bitcoreLib.util.buffer.concat(arr);
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
  dataToSign: function dataToSign(txData) {
    var arr = [];
    // Tx version
    arr.push(this.intToBytes(_constants.DEFAULT_TX_VERSION, 2));
    // Len inputs
    arr.push(this.intToBytes(txData.inputs.length, 1));
    // Len outputs
    arr.push(this.intToBytes(txData.outputs.length, 1));
    // Len tokens
    arr.push(this.intToBytes(txData.tokens.length, 1));

    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = txData.tokens[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        var token = _step.value;

        arr.push(new _bitcoreLib.encoding.BufferReader(token).buf);
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }

    var _iteratorNormalCompletion2 = true;
    var _didIteratorError2 = false;
    var _iteratorError2 = undefined;

    try {
      for (var _iterator2 = txData.inputs[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
        var inputTx = _step2.value;

        arr.push(_bitcoreLib.util.buffer.hexToBuffer(inputTx.tx_id));
        arr.push(this.intToBytes(inputTx.index, 1));
        // Input data will be fixed to 0 for now
        arr.push(this.intToBytes(0, 2));
      }
    } catch (err) {
      _didIteratorError2 = true;
      _iteratorError2 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion2 && _iterator2.return) {
          _iterator2.return();
        }
      } finally {
        if (_didIteratorError2) {
          throw _iteratorError2;
        }
      }
    }

    var _iteratorNormalCompletion3 = true;
    var _didIteratorError3 = false;
    var _iteratorError3 = undefined;

    try {
      for (var _iterator3 = txData.outputs[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
        var outputTx = _step3.value;

        arr.push(this.outputValueToBytes(outputTx.value));
        // Token data
        arr.push(this.intToBytes(outputTx.tokenData, 1));

        var outputScript = this.createOutputScript(outputTx.address, outputTx.timelock);
        arr.push(this.intToBytes(outputScript.length, 2));
        arr.push(outputScript);
      }
    } catch (err) {
      _didIteratorError3 = true;
      _iteratorError3 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion3 && _iterator3.return) {
          _iterator3.return();
        }
      } finally {
        if (_didIteratorError3) {
          throw _iteratorError3;
        }
      }
    }

    return _bitcoreLib.util.buffer.concat(arr);
  },


  /*
   * Add input data to each input of tx data
   *
   * @param {Object} data Object with inputs and outputs {'inputs': [{'tx_id', 'index', 'token'}], 'outputs': ['address', 'value', 'timelock']}
   * @param {Buffer} dataToSign data to sign the transaction in bytes
   * @param {string} pin PIN to decrypt the private key
   *
   * @return {Object} data
   *
   * @memberof Transaction
   * @inner
   */
  signTx: function signTx(data, dataToSign, pin) {
    var hashbuf = this.getDataToSignHash(dataToSign);

    var walletData = _wallet2.default.getWalletData();
    if (walletData === null) {
      return data;
    }
    var keys = walletData.keys;
    var _iteratorNormalCompletion4 = true;
    var _didIteratorError4 = false;
    var _iteratorError4 = undefined;

    try {
      for (var _iterator4 = data.inputs[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
        var input = _step4.value;

        var index = keys[input.address].index;
        input['data'] = this.getSignature(index, hashbuf, pin);
      }
    } catch (err) {
      _didIteratorError4 = true;
      _iteratorError4 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion4 && _iterator4.return) {
          _iterator4.return();
        }
      } finally {
        if (_didIteratorError4) {
          throw _iteratorError4;
        }
      }
    }

    return data;
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
  getSignature: function getSignature(index, hash, pin) {
    var accessData = localStorage.getItem('wallet:accessData');
    var encryptedPrivateKey = localStorage.memory ? accessData.mainKey : JSON.parse(accessData).mainKey;
    var privateKeyStr = _wallet2.default.decryptData(encryptedPrivateKey, pin);
    var key = (0, _bitcoreLib.HDPrivateKey)(privateKeyStr);
    var derivedKey = key.derive(index);
    var privateKey = derivedKey.privateKey;

    var sig = _bitcoreLib.crypto.ECDSA.sign(hash, privateKey, 'little').set({
      nhashtype: _bitcoreLib.crypto.Signature.SIGHASH_ALL
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
  getDataToSignHash: function getDataToSignHash(dataToSign) {
    var hashbuf = _bitcoreLib.crypto.Hash.sha256sha256(dataToSign);
    return new _bitcoreLib.encoding.BufferReader(hashbuf).readReverse();
  },


  /**
   * Calculate the minimum tx weight
   * 
   * @param {Object} txData Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index'}],
   *  'outputs': ['address', 'value', 'timelock'],
   *  'version': 1,
   *  'weight': 0,
   *  'nonce': 0,
   *  'timestamp': 1,
   * }
   *
   * @return {number} Minimum weight calculated (float)
   * @memberof Transaction
   * @inner
   */
  calculateTxWeight: function calculateTxWeight(txData) {
    var txSize = this.txToBytes(txData).length;

    // XXX Parents are calculated only in the server but we need to consider them here
    // Parents are always two and have 32 bytes each
    txSize += 64;

    var sumOutputs = 0;
    var _iteratorNormalCompletion5 = true;
    var _didIteratorError5 = false;
    var _iteratorError5 = undefined;

    try {
      for (var _iterator5 = txData.outputs[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
        var output = _step5.value;

        sumOutputs += output.value;
      }

      // We need to take into consideration the decimal places because it is inside the amount.
      // For instance, if one wants to transfer 20 HTRs, the amount will be 2000.
    } catch (err) {
      _didIteratorError5 = true;
      _iteratorError5 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion5 && _iterator5.return) {
          _iterator5.return();
        }
      } finally {
        if (_didIteratorError5) {
          throw _iteratorError5;
        }
      }
    }

    var amount = sumOutputs / 10 ** _constants.DECIMAL_PLACES;

    var txWeightConstants = this.getTransactionWeightConstants();

    var weight = txWeightConstants.txWeightCoefficient * Math.log2(txSize) + 4 / (1 + txWeightConstants.txMinWeightK / amount) + 4;

    // Make sure the calculated weight is at least the minimum
    weight = Math.max(weight, txWeightConstants.txMinWeight);
    // FIXME precision difference between backend and frontend (weight (17.76246721531992) is smaller than the minimum weight (17.762467215319923))
    return weight + 1e-6;
  },


  /**
   * Complete the txData
   *
   * Add weight, nonce, version, and timestamp to the txData
   * 
   * @param {Object} txData Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index'}],
   *  'outputs': ['address', 'value', 'timelock'],
   * }
   *
   * @memberof Transaction
   * @inner
   */
  completeTx: function completeTx(incompleteTxData) {
    incompleteTxData['weight'] = 0;
    incompleteTxData['nonce'] = 0;
    incompleteTxData['version'] = _constants.DEFAULT_TX_VERSION;
    incompleteTxData['timestamp'] = _date2.default.dateToTimestamp(new Date());
    var minimumWeight = this.calculateTxWeight(incompleteTxData);
    incompleteTxData['weight'] = minimumWeight;
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
  txToBytes: function txToBytes(txData) {
    var arr = [];
    // Serialize first the funds part
    //
    // Tx version
    arr.push(this.intToBytes(_constants.DEFAULT_TX_VERSION, 2));
    // Len tokens
    arr.push(this.intToBytes(txData.tokens.length, 1));
    // Len inputs
    arr.push(this.intToBytes(txData.inputs.length, 1));
    // Len outputs
    arr.push(this.intToBytes(txData.outputs.length, 1));

    var _iteratorNormalCompletion6 = true;
    var _didIteratorError6 = false;
    var _iteratorError6 = undefined;

    try {
      for (var _iterator6 = txData.tokens[Symbol.iterator](), _step6; !(_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done); _iteratorNormalCompletion6 = true) {
        var token = _step6.value;

        arr.push(new _bitcoreLib.encoding.BufferReader(token).buf);
      }
    } catch (err) {
      _didIteratorError6 = true;
      _iteratorError6 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion6 && _iterator6.return) {
          _iterator6.return();
        }
      } finally {
        if (_didIteratorError6) {
          throw _iteratorError6;
        }
      }
    }

    var _iteratorNormalCompletion7 = true;
    var _didIteratorError7 = false;
    var _iteratorError7 = undefined;

    try {
      for (var _iterator7 = txData.inputs[Symbol.iterator](), _step7; !(_iteratorNormalCompletion7 = (_step7 = _iterator7.next()).done); _iteratorNormalCompletion7 = true) {
        var inputTx = _step7.value;

        arr.push(_bitcoreLib.util.buffer.hexToBuffer(inputTx.tx_id));
        arr.push(this.intToBytes(inputTx.index, 1));
        arr.push(this.intToBytes(inputTx.data.length, 2));
        arr.push(inputTx.data);
      }
    } catch (err) {
      _didIteratorError7 = true;
      _iteratorError7 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion7 && _iterator7.return) {
          _iterator7.return();
        }
      } finally {
        if (_didIteratorError7) {
          throw _iteratorError7;
        }
      }
    }

    var _iteratorNormalCompletion8 = true;
    var _didIteratorError8 = false;
    var _iteratorError8 = undefined;

    try {
      for (var _iterator8 = txData.outputs[Symbol.iterator](), _step8; !(_iteratorNormalCompletion8 = (_step8 = _iterator8.next()).done); _iteratorNormalCompletion8 = true) {
        var outputTx = _step8.value;

        arr.push(this.outputValueToBytes(outputTx.value));
        // Token data
        arr.push(this.intToBytes(outputTx.tokenData, 1));

        var outputScript = this.createOutputScript(outputTx.address, outputTx.timelock);
        arr.push(this.intToBytes(outputScript.length, 2));
        arr.push(outputScript);
      }

      // Now serialize the graph part
      //
      // Weight is a float with 8 bytes
    } catch (err) {
      _didIteratorError8 = true;
      _iteratorError8 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion8 && _iterator8.return) {
          _iterator8.return();
        }
      } finally {
        if (_didIteratorError8) {
          throw _iteratorError8;
        }
      }
    }

    arr.push(this.floatToBytes(txData.weight, 8));
    // Timestamp
    arr.push(this.intToBytes(txData.timestamp, 4));
    // Len parents (parents will be calculated in the backend)
    arr.push(this.intToBytes(0, 1));

    // Add nonce in the end
    arr.push(this.intToBytes(txData.nonce, 4));
    return _bitcoreLib.util.buffer.concat(arr);
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
  outputValueToBytes: function outputValueToBytes(value) {
    if (value > _constants.MAX_OUTPUT_VALUE) {
      throw new _errors.OutputValueError('Maximum value is ' + _helpers2.default.prettyValue(_constants.MAX_OUTPUT_VALUE));
    }
    if (value > _constants.MAX_OUTPUT_VALUE_32) {
      return this.signedIntToBytes(-value, 8);
    } else {
      return this.signedIntToBytes(value, 4);
    }
  },


  /**
   * Complete and send a transaction to the full node
   *
   * @param {Object} data Object with inputs and outputs
   * {
   *  'inputs': [{'tx_id', 'index', 'token'}],
   *  'outputs': ['address', 'value', 'timelock', 'tokenData'],
   * }
   * @param {string} pin Pin to decrypt data
   *
   * @return {Promise}
   * @memberof Transaction
   * @inner
   */
  sendTransaction: function sendTransaction(data, pin) {
    var dataToSign = transaction.dataToSign(data);
    data = transaction.signTx(data, dataToSign, pin);
    // Completing data in the same object
    transaction.completeTx(data);
    var txBytes = transaction.txToBytes(data);
    var txHex = _bitcoreLib.util.buffer.bufferToHex(txBytes);
    var promise = new Promise(function (resolve, reject) {
      _wallet4.default.sendTokens(txHex, function (response) {
        if (response.success) {
          resolve();
        } else {
          reject(response.message);
        }
      }, function (e) {
        // Error in request
        reject(e);
      });
    });
    return promise;
  },


  /**
   * Save txMinWeight and txWeightCoefficient to localStorage
   *
   * @param {number} txMinWeight Minimum allowed weight for a tx (float)
   * @param {number} txWeightCoefficient Coefficient to be used when calculating tx weight (float)
   *
   * @memberof Transaction
   * @inner
   */
  updateTransactionWeightConstants: function updateTransactionWeightConstants(txMinWeight, txWeightCoefficient, txMinWeightK) {
    localStorage.setItem('wallet:txMinWeight', txMinWeight);
    localStorage.setItem('wallet:txWeightCoefficient', txWeightCoefficient);
    localStorage.setItem('wallet:txMinWeightK', txMinWeightK);
  },


  /**
   * Return the transaction weight constants that was saved using a response from the backend
   *
   * @return {Object} Object with the parameters {'txMinWeight', 'txWeightCoefficient', 'txMinWeightK'}
   *
   * @memberof Transaction
   * @inner
   */
  getTransactionWeightConstants: function getTransactionWeightConstants() {
    return { 'txMinWeight': parseFloat(localStorage.getItem('wallet:txMinWeight')),
      'txWeightCoefficient': parseFloat(localStorage.getItem('wallet:txWeightCoefficient')),
      'txMinWeightK': parseFloat(localStorage.getItem('wallet:txMinWeightK')) };
  }
};

exports.default = transaction;