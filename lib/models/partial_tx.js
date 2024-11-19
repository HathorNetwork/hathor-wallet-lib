"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ProposalOutput = exports.ProposalInput = exports.PartialTxPrefix = exports.PartialTxInputDataPrefix = exports.PartialTxInputData = exports.PartialTx = void 0;
var _lodash = require("lodash");
var _input = _interopRequireDefault(require("./input"));
var _output = _interopRequireDefault(require("./output"));
var _p2pkh = _interopRequireDefault(require("./p2pkh"));
var _p2sh = _interopRequireDefault(require("./p2sh"));
var _transaction = _interopRequireDefault(require("../utils/transaction"));
var _helpers = _interopRequireDefault(require("../utils/helpers"));
var _errors = require("../errors");
var _txApi = _interopRequireDefault(require("../api/txApi"));
var _constants = require("../constants");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ // eslint-disable-next-line max-classes-per-file -- These classes are well organized within this file
/**
 * Extended version of the Input class with extra data
 * We need the extra data to calculate the balance of the PartialTx
 */
class ProposalInput extends _input.default {
  constructor(hash, index, value, address, {
    token = _constants.NATIVE_TOKEN_UID,
    authorities = 0n
  } = {}) {
    super(hash, index);
    _defineProperty(this, "token", void 0);
    _defineProperty(this, "authorities", void 0);
    _defineProperty(this, "value", void 0);
    _defineProperty(this, "address", void 0);
    this.value = value;
    this.authorities = authorities;
    this.token = token;
    this.address = address;
  }

  /**
   * Return an object with the relevant input data
   *
   * @return {IDataInput}
   * @memberof ProposalInput
   * @inner
   */
  toData() {
    const data = {
      txId: this.hash,
      index: this.index,
      address: this.address,
      token: this.token,
      value: this.value,
      authorities: this.authorities
    };
    if (this.data) {
      data.data = this.data.toString('hex');
    }
    return data;
  }
  isAuthority() {
    return this.authorities > 0;
  }
}

/**
 * Extended version of the Output class with extra data
 * We need the extra data to calculate the token_data of the
 * output on the final transaction and to track which outputs are change.
 */
exports.ProposalInput = ProposalInput;
class ProposalOutput extends _output.default {
  constructor(value, script, {
    isChange = false,
    token = _constants.NATIVE_TOKEN_UID,
    authorities = 0n
  } = {}) {
    let tokenData = 0;
    if (authorities > 0) {
      tokenData |= _constants.TOKEN_AUTHORITY_MASK;
    }
    if (token !== _constants.NATIVE_TOKEN_UID) {
      // We set this to avoid isTokenHTR from returning true
      tokenData |= 1;
    }
    super(value, script, {
      tokenData
    });
    _defineProperty(this, "token", void 0);
    _defineProperty(this, "isChange", void 0);
    _defineProperty(this, "authorities", void 0);
    this.token = token;
    this.isChange = isChange;
    this.authorities = authorities;
  }

  /**
   * Set the value of the property tokenData
   *
   * @param {number} tokenData
   */
  setTokenData(tokenData) {
    this.tokenData = tokenData;
  }

  /**
   * Return an object with the relevant output data
   *
   * @param {number} tokenIndex Index of the token on the tokens array plus 1 (0 meaning HTR)
   * @param {Network} network Network used to generate addresses in
   *
   * @returns {IDataOutput}
   *
   * @throws {UnsupportedScriptError} Script must be P2SH or P2PKH
   * @memberof ProposalOutput
   * @inner
   */
  toData(tokenIndex, network) {
    const script = this.parseScript(network);
    if (!(script instanceof _p2pkh.default || script instanceof _p2sh.default)) {
      throw new _errors.UnsupportedScriptError('Unsupported script type');
    }
    const tokenData = (this.authorities > 0 ? _constants.TOKEN_AUTHORITY_MASK : 0) | tokenIndex;

    // This will keep authority bit while updating the index bits
    this.setTokenData(tokenData);
    const data = {
      type: script.getType(),
      value: this.value,
      address: script.address.base58,
      authorities: this.authorities,
      token: this.token,
      timelock: script.timelock
    };
    return data;
  }
}
exports.ProposalOutput = ProposalOutput;
const PartialTxPrefix = exports.PartialTxPrefix = 'PartialTx';
/**
 * This class purpose is to hold and modify the state of the partial transaction.
 * It is also used to serialize and deserialize the partial transaction state.
 */
class PartialTx {
  constructor(network) {
    _defineProperty(this, "inputs", void 0);
    _defineProperty(this, "outputs", void 0);
    _defineProperty(this, "network", void 0);
    this.inputs = [];
    this.outputs = [];
    this.network = network;
  }

  /**
   * Convert the PartialTx into a complete TxData ready to be signed or serialized.
   *
   * @returns {TxData}
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
   * @memberof PartialTx
   * @inner
   */
  getTxData() {
    const tokenSet = new Set();
    for (const output of this.outputs) {
      tokenSet.add(output.token);
    }
    for (const input of this.inputs) {
      tokenSet.add(input.token);
    }

    // Remove HTR from tokens array
    tokenSet.delete(_constants.NATIVE_TOKEN_UID);
    const tokens = Array.from(tokenSet);
    const data = {
      version: _constants.DEFAULT_TX_VERSION,
      tokens,
      inputs: this.inputs.map(i => i.toData()),
      outputs: this.outputs.map(o => o.toData(tokens.indexOf(o.token) + 1, this.network))
    };
    return data;
  }

  /**
   * Create a Transaction instance from the PartialTx.
   *
   * @returns {Transaction}
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
   * @memberof PartialTx
   * @inner
   */
  getTx() {
    return _transaction.default.createTransactionFromData(this.getTxData(), this.network);
  }

  /**
   * Calculate balance for all tokens from inputs and outputs.
   *
   * @returns {Record<string, {inputs: number, outputs: number}}
   * @memberof PartialTx
   * @inner
   */
  calculateTokenBalance() {
    const tokenBalance = {};
    for (const input of this.inputs) {
      if (!tokenBalance[input.token]) {
        tokenBalance[input.token] = {
          inputs: 0n,
          outputs: 0n
        };
      }

      // Ignore authority inputs for token balance
      if (!input.isAuthority()) {
        tokenBalance[input.token].inputs += input.value;
      }
    }
    for (const output of this.outputs) {
      if (!tokenBalance[output.token]) {
        tokenBalance[output.token] = {
          inputs: 0n,
          outputs: 0n
        };
      }

      // Ignore authority outputs for token balance
      if (!output.isAuthority()) {
        tokenBalance[output.token].outputs += output.value;
      }
    }
    return tokenBalance;
  }

  /**
   * Return true if the balance of the outputs match the balance of the inputs for all tokens.
   *
   * @returns {boolean}
   * @memberof PartialTx
   * @inner
   */
  isComplete() {
    const tokenBalance = this.calculateTokenBalance();

    // Calculated the final balance for all tokens
    // return if all are 0
    return Object.values(tokenBalance).every(v => v.inputs === v.outputs);
  }

  /**
   * Add an UTXO as input on the PartialTx.
   *
   * @param {string} txId The transaction id of the UTXO.
   * @param {number} index The index of the UTXO.
   * @param {OutputValueType} value Value of the UTXO.
   * @param {OutputValueType} authorities The authority information of the utxo.
   * @param {string} address base58 address
   * @param {Object} [options]
   * @param {string} [options.token='00'] The token UID.
   *
   * @memberof PartialTx
   * @inner
   */
  addInput(txId, index, value, address, {
    token = _constants.NATIVE_TOKEN_UID,
    authorities = 0n
  } = {}) {
    this.inputs.push(new ProposalInput(txId, index, value, address, {
      token,
      authorities
    }));
  }

  /**
   * Add an output to the PartialTx.
   *
   * @param {OutputValueType} value The amount of tokens on the output.
   * @param {Buffer} script The output script.
   * @param {OutputValueType} authorities The authority information of the output.
   * @param {Object} [options]
   * @param {string} [options.token='00'] The token UID.
   * @param {boolean|null} [options.isChange=false] isChange If this is a change output.
   *
   * @memberof PartialTx
   * @inner
   */
  addOutput(value, script, {
    token = _constants.NATIVE_TOKEN_UID,
    authorities = 0n,
    isChange = false
  } = {}) {
    this.outputs.push(new ProposalOutput(value, script, {
      token,
      authorities,
      isChange
    }));
  }

  /**
   * Serialize the current PartialTx into an UTF8 string.
   *
   * The serialization will join 4 parts:
   * - Fixed prefix
   * - transaction: in hex format
   * - inputs metadata: a colon-separated list of address, token, authorities and value
   * - outputs metadata: change outputs indexes
   *
   * Example: PartialTx|00010102...ce|W...vjPi,00,0,1b:W...vjPi,0000389...8c,1,d|1:2
   * Obs: ellipsis were used to abreviate long parts, there are no ellipsis on the serialized string
   *
   *
   * @returns {string}
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
   * @memberof PartialTx
   * @inner
   */
  serialize() {
    const changeOutputs = [];
    this.outputs.forEach((output, index) => {
      if (output.isChange) {
        changeOutputs.push(index);
      }
    });
    const tx = this.getTx();
    const inputArr = this.inputs.map(i => [i.address, i.token, i.authorities.toString(16), i.value.toString(16)].join(','));
    const arr = [PartialTxPrefix, tx.toHex(), inputArr.join(':'), changeOutputs.map(o => o.toString(16)).join(':') // array of change outputs
    ];
    return arr.join('|');
  }

  /**
   * Deserialize and create an instance of PartialTx
   *
   * @param {string} serialized The serialized PartialTx
   * @param {Network} network Network used when parsing the output scripts
   *
   * @returns {PartialTx}
   *
   * @throws {SyntaxError} serialized argument should be valid.
   * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
   * @memberof PartialTx
   * @static
   */
  static deserialize(serialized, network) {
    const dataArr = serialized.split('|');
    const txHex = dataArr[1];
    if (dataArr.length !== 4 || dataArr[0] !== PartialTxPrefix) {
      throw new SyntaxError('Invalid PartialTx');
    }
    const inputArr = dataArr[2] && dataArr[2].split(':').map(h => {
      const parts = h.split(',');
      const meta = {
        address: parts[0],
        token: parts[1],
        authorities: BigInt(`0x${parts[2]}`),
        value: BigInt(`0x${parts[3]}`)
      };
      if (Number.isNaN(meta.value) || Number.isNaN(meta.authorities)) {
        throw new SyntaxError('Invalid PartialTx');
      }
      return meta;
    }) || [];
    const changeOutputs = dataArr[3].split(':').map(x => parseInt(x, 16));
    const tx = _helpers.default.createTxFromHex(txHex, network);
    const instance = new PartialTx(network);
    for (const [index, input] of tx.inputs.entries()) {
      const inputMeta = inputArr[index];
      instance.addInput(input.hash, input.index, inputMeta.value, inputMeta.address, {
        token: inputMeta.token,
        authorities: inputMeta.authorities
      });
    }
    for (const [index, output] of tx.outputs.entries()) {
      // validate script
      const script = output.parseScript(network);
      if (!(script instanceof _p2pkh.default || script instanceof _p2sh.default)) {
        throw new _errors.UnsupportedScriptError('Unsupported script type');
      }
      let authorities = 0n;
      if (output.isMint()) {
        authorities += _constants.TOKEN_MINT_MASK;
      }
      if (output.isMelt()) {
        authorities += _constants.TOKEN_MELT_MASK;
      }
      const token = output.isTokenHTR() ? _constants.NATIVE_TOKEN_UID : tx.tokens[output.getTokenIndex()];
      instance.addOutput(output.value, output.script, {
        token,
        authorities,
        isChange: changeOutputs.indexOf(index) > -1
      });
    }
    return instance;
  }

  /**
   * Check the content of the current PartialTx with the fullnode
   *
   * @returns {Promise<boolean>}
   */
  async validate() {
    const promises = [];
    for (const input of this.inputs) {
      const p = new Promise((resolve, reject) => {
        _txApi.default.getTransaction(input.hash, data => {
          const utxo = (0, _lodash.get)(data, `tx.outputs[${input.index}]`);
          if (!utxo) {
            return resolve(false);
          }
          const tokenUid = utxo.token_data === 0 ? _constants.NATIVE_TOKEN_UID : (0, _lodash.get)(data, `tx.tokens[${(utxo.token_data & _constants.TOKEN_INDEX_MASK) - 1}].uid`);
          const isAuthority = (utxo.token_data & _constants.TOKEN_AUTHORITY_MASK) > 0;
          const isMint = isAuthority && (utxo.value & _constants.TOKEN_MINT_MASK) > 0;
          const isMelt = isAuthority && (utxo.value & _constants.TOKEN_MELT_MASK) > 0;
          const authorityCheck = isAuthority === input.authorities > 0 && isMint === (input.authorities & _constants.TOKEN_MINT_MASK) > 0 && isMelt === (input.authorities & _constants.TOKEN_MELT_MASK) > 0;
          return resolve(authorityCheck && input.token === tokenUid && input.value === utxo.value && input.address === utxo.decoded.address);
        }).then(result => {
          // should have already resolved
          reject(new Error('API client did not use the callback'));
        }).catch(err => reject(err));
      });
      promises.push(p);
    }

    // Check that every promise returns true
    return Promise.all(promises).then(responses => responses.every(x => x));
  }
}
exports.PartialTx = PartialTx;
const PartialTxInputDataPrefix = exports.PartialTxInputDataPrefix = 'PartialTxInputData';

/**
 * This class is meant to aggregate input data for a transaction.
 *
 * The `hash` is an identifier of the transaction (usually the dataToSign in hex format)
 * this way any input data added should identify that it is from the same transaction.
 *
 * The input data is saved instead of the signature to allow collecting from MultiSig wallets
 * since for an input we can have multiple signatures.
 */
class PartialTxInputData {
  constructor(hash, inputsLen) {
    _defineProperty(this, "data", void 0);
    _defineProperty(this, "hash", void 0);
    _defineProperty(this, "inputsLen", void 0);
    this.data = {};
    this.hash = hash;
    this.inputsLen = inputsLen;
  }

  /**
   * Add an input data to the record.
   *
   * @param {number} index The input index this data relates to.
   * @param {Buffer} inputData Input data bytes.
   *
   * @throws {IndexOOBError} index should be inside the inputs array.
   *
   * @memberof PartialTxInputData
   * @inner
   */
  addData(index, inputData) {
    if (index >= this.inputsLen) {
      throw new _errors.IndexOOBError(`Index ${index} is out of bounds for the ${this.inputsLen} inputs`);
    }
    this.data[index] = inputData;
  }

  /**
   * Return true if we have an input data for each input.
   *
   * @returns {boolean}
   * @memberof PartialTxInputData
   * @inner
   */
  isComplete() {
    return Object.values(this.data).length === this.inputsLen;
  }

  /**
   * Serialize the current PartialTxInputData into an UTF8 string.
   *
   * The serialization will join 3 informations:
   * - Fixed prefix
   * - hash: to identify the transaction which these signatures belong to
   * - inputs data: index and data
   *
   * Example: PartialTxInputData|000ca...fe|0:00abc|1:00123
   * Obs: ellipsis is used to abreviate, there are no ellipsis on the serialized string
   *
   * @returns {string}
   * @memberof PartialTxInputData
   * @inner
   */
  serialize() {
    const arr = [PartialTxInputDataPrefix, this.hash];
    for (const [index, buf] of Object.entries(this.data)) {
      arr.push(`${index}:${buf.toString('hex')}`);
    }
    return arr.join('|');
  }

  /**
   * Deserialize the PartialTxInputData and merge with local data.
   *
   * @param {string} serialized The serialized PartialTxInputData
   *
   * @throws {SyntaxError} serialized argument should be valid.
   * @memberof PartialTxInputData
   * @static
   */
  addSignatures(serialized) {
    const arr = serialized.split('|');
    if (arr.length < 2 || arr[0] !== PartialTxInputDataPrefix || arr[1] !== this.hash) {
      // Only the first 2 parts are required, the third onward are the signatures which can be empty
      // When collecting the input data from atomic-swap participants a participant may not have inputs to sign
      // allowing the empty input data array case will make this a noop instead of throwing an error.
      throw new SyntaxError('Invalid PartialTxInputData');
    }
    for (const part of arr.slice(2)) {
      const parts = part.split(':');
      if (parts.length !== 2) {
        throw new SyntaxError('Invalid PartialTxInputData');
      }

      // This may overwrite an input data but we are allowing this
      this.data[+parts[0]] = Buffer.from(parts[1], 'hex');
    }
  }
}
exports.PartialTxInputData = PartialTxInputData;