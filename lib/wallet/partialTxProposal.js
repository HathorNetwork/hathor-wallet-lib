"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _partial_tx = require("../models/partial_tx");
var _address = _interopRequireDefault(require("../models/address"));
var _p2sh = _interopRequireDefault(require("../models/p2sh"));
var _p2pkh = _interopRequireDefault(require("../models/p2pkh"));
var _script_data = _interopRequireDefault(require("../models/script_data"));
var _errors = require("../errors");
var _constants = require("../constants");
var _transaction = _interopRequireDefault(require("../utils/transaction"));
var _date = _interopRequireDefault(require("../utils/date"));
var _types = require("./types");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _asyncIterator(r) { var n, t, o, e = 2; for ("undefined" != typeof Symbol && (t = Symbol.asyncIterator, o = Symbol.iterator); e--;) { if (t && null != (n = r[t])) return n.call(r); if (o && null != (n = r[o])) return new AsyncFromSyncIterator(n.call(r)); t = "@@asyncIterator", o = "@@iterator"; } throw new TypeError("Object is not async iterable"); }
function AsyncFromSyncIterator(r) { function AsyncFromSyncIteratorContinuation(r) { if (Object(r) !== r) return Promise.reject(new TypeError(r + " is not an object.")); var n = r.done; return Promise.resolve(r.value).then(function (r) { return { value: r, done: n }; }); } return AsyncFromSyncIterator = function (r) { this.s = r, this.n = r.next; }, AsyncFromSyncIterator.prototype = { s: null, n: null, next: function () { return AsyncFromSyncIteratorContinuation(this.n.apply(this.s, arguments)); }, return: function (r) { var n = this.s.return; return void 0 === n ? Promise.resolve({ value: r, done: !0 }) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); }, throw: function (r) { var n = this.s.return; return void 0 === n ? Promise.reject(r) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); } }, new AsyncFromSyncIterator(r); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class PartialTxProposal {
  /**
   * @param {Network} network
   */
  constructor(storage) {
    _defineProperty(this, "partialTx", void 0);
    _defineProperty(this, "signatures", void 0);
    _defineProperty(this, "transaction", void 0);
    _defineProperty(this, "storage", void 0);
    this.storage = storage;
    this.partialTx = new _partial_tx.PartialTx(storage.config.getNetwork());
    this.signatures = null;
    this.transaction = null;
  }

  /**
   * Create a PartialTxProposal instance from the serialized string.
   *
   * @param {string} serialized Serialized PartialTx data
   * @param {Network} network network
   *
   * @throws {SyntaxError} serialized argument should be a valid PartialTx.
   * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
   *
   * @returns {PartialTxProposal}
   */
  static fromPartialTx(serialized, storage) {
    const network = storage.config.getNetwork();
    const partialTx = _partial_tx.PartialTx.deserialize(serialized, network);
    const proposal = new PartialTxProposal(storage);
    proposal.partialTx = partialTx;
    return proposal;
  }

  /**
   * Add inputs sending the amount of tokens specified, may add a change output.
   *
   * @param {string} token UID of token that is being sent
   * @param {OutputValueType} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {Utxo[]|null} [options.utxos=[]] utxos to add to the partial transaction.
   * @param {string|null} [options.changeAddress=null] If we add change, use this address instead of getting a new one from the wallet.
   * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
   */
  async addSend(token, value, {
    utxos = [],
    changeAddress = null,
    markAsSelected = true
  } = {}) {
    this.resetSignatures();

    // Use the pool of utxos or all wallet utxos.
    let allUtxos;
    if (utxos && utxos.length > 0) {
      allUtxos = utxos;
    } else {
      allUtxos = [];
      var _iteratorAbruptCompletion = false;
      var _didIteratorError = false;
      var _iteratorError;
      try {
        for (var _iterator = _asyncIterator(this.storage.selectUtxos({
            token,
            authorities: 0n
          })), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
          const utxo = _step.value;
          {
            allUtxos.push({
              txId: utxo.txId,
              index: utxo.index,
              value: utxo.value,
              tokenId: utxo.token,
              address: utxo.address,
              authorities: 0n,
              timelock: utxo.timelock,
              heightlock: null,
              locked: false,
              addressPath: ''
            });
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
    }

    // Filter pool of utxos for only utxos from the token and not already in the partial tx
    const currentUtxos = this.partialTx.inputs.map(input => `${input.hash}-${input.index}`);
    const utxosToUse = allUtxos.filter(utxo => utxo.tokenId === token && !currentUtxos.includes(`${utxo.txId}-${utxo.index}`));
    const utxosDetails = _transaction.default.selectUtxos(utxosToUse, value);
    for (const utxo of utxosDetails.utxos) {
      this.addInput(utxo.txId, utxo.index, utxo.value, utxo.address, {
        token: utxo.tokenId,
        authorities: utxo.authorities,
        markAsSelected
      });
    }

    // add change output if needed
    if (utxosDetails.changeAmount > 0) {
      const address = changeAddress || (await this.storage.getCurrentAddress());
      this.addOutput(token, utxosDetails.changeAmount, address, {
        isChange: true
      });
    }
  }

  /**
   * Add outputs receiving the amount of tokens specified.
   *
   * @param {string} token UID of token that is being sent
   * @param {OutputValueType} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
   * @param {string|null} [options.address=null] Output address to receive the tokens.
   *
   */
  async addReceive(token, value, {
    timelock = null,
    address = null
  } = {}) {
    this.resetSignatures();

    // get an address of our wallet and add the output
    const addr = address || (await this.storage.getCurrentAddress());
    this.addOutput(token, value, addr, {
      timelock
    });
  }

  /**
   * Add an UTXO as input on the partial data.
   *
   * @param {string} hash Transaction hash
   * @param {number} index UTXO index on the outputs of the transaction.
   * @param {OutputValueType} value UTXO value.
   * @param {Object} [options]
   * @param {string} [options.token='00'] Token UID in hex format.
   * @param {OutputValueType} [options.authorities=0] Authority information of the UTXO.
   * @param {string|null} [options.address=null] Address that owns the UTXO.
   * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
   */
  addInput(hash, index, value, address, {
    token = _constants.NATIVE_TOKEN_UID,
    authorities = 0n,
    markAsSelected = true
  } = {}) {
    this.resetSignatures();
    if (markAsSelected) {
      this.storage.utxoSelectAsInput({
        txId: hash,
        index
      }, true);
    }
    this.partialTx.addInput(hash, index, value, address, {
      token,
      authorities
    });
  }

  /**
   * Add an output to the partial data.
   *
   * @param {string} token UID of token that is being sent.
   * @param {OutputValueType} value Quantity of tokens being sent.
   * @param {string} address Create the output script for this address.
   * @param {Object} [options]
   * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
   * @param {boolean} [options.isChange=false] If the output should be considered as change.
   * @param {OutputValueType} [options.authorities=0] Authority information of the Output.
   *
   * @throws AddressError
   */
  addOutput(token, value, address, {
    timelock = null,
    isChange = false,
    authorities = 0n
  } = {}) {
    this.resetSignatures();
    const addr = new _address.default(address, {
      network: this.storage.config.getNetwork()
    });
    let script;
    switch (addr.getType()) {
      case _types.OutputType.P2SH:
        script = new _p2sh.default(addr, {
          timelock
        });
        break;
      case _types.OutputType.P2PKH:
        script = new _p2pkh.default(addr, {
          timelock
        });
        break;
      default:
        throw new _errors.AddressError('Unsupported address type');
    }
    this.partialTx.addOutput(value, script.createScript(), {
      token,
      authorities,
      isChange
    });
  }

  /**
   * Calculate the token balance of the partial tx for a specific wallet.
   *
   * @returns {Record<string, Balance>}
   */
  async calculateBalance() {
    const currentTimestamp = _date.default.dateToTimestamp(new Date());
    const isTimelocked = timelock => currentTimestamp < timelock;
    const getEmptyBalance = () => ({
      balance: {
        unlocked: 0n,
        locked: 0n
      },
      authority: {
        unlocked: {
          mint: 0n,
          melt: 0n
        },
        locked: {
          mint: 0n,
          melt: 0n
        }
      }
    });
    const tokenBalance = {};
    for (const input of this.partialTx.inputs) {
      if (!(await this.storage.isAddressMine(input.address))) continue;
      if (!tokenBalance[input.token]) {
        tokenBalance[input.token] = getEmptyBalance();
      }
      if (input.isAuthority()) {
        // calculate authority balance
        tokenBalance[input.token].authority.unlocked.mint -= (input.value & _constants.TOKEN_MINT_MASK) > 0n ? 1n : 0n;
        tokenBalance[input.token].authority.unlocked.melt -= (input.value & _constants.TOKEN_MELT_MASK) > 0n ? 1n : 0n;
      } else {
        // calculate token balance
        tokenBalance[input.token].balance.unlocked -= input.value;
      }
    }
    for (const output of this.partialTx.outputs) {
      const decodedScript = output.decodedScript || output.parseScript(this.storage.config.getNetwork());

      // Catch data output and non-standard scripts cases
      if (decodedScript instanceof _script_data.default || !decodedScript) continue;
      if (!(await this.storage.isAddressMine(decodedScript.address.base58))) continue;
      if (!tokenBalance[output.token]) {
        tokenBalance[output.token] = getEmptyBalance();
      }
      if (output.isAuthority()) {
        /**
         * Calculate authorities
         */
        if (isTimelocked(decodedScript.timelock)) {
          // Locked output
          tokenBalance[output.token].authority.locked.mint += (output.value & _constants.TOKEN_MINT_MASK) > 0n ? 1n : 0n;
          tokenBalance[output.token].authority.locked.melt += (output.value & _constants.TOKEN_MELT_MASK) > 0n ? 1n : 0n;
        } else {
          // Unlocked output
          tokenBalance[output.token].authority.unlocked.mint += (output.value & _constants.TOKEN_MINT_MASK) > 0n ? 1n : 0n;
          tokenBalance[output.token].authority.unlocked.melt += (output.value & _constants.TOKEN_MELT_MASK) > 0n ? 1n : 0n;
        }
      } else if (isTimelocked(decodedScript.timelock)) {
        /**
         * Calculate token balances
         */
        // Locked output
        tokenBalance[output.token].balance.locked += output.value;
      } else {
        // Unlocked output
        tokenBalance[output.token].balance.unlocked += output.value;
      }
    }
    return tokenBalance;
  }

  /**
   * Reset any data calculated from the partial tx.
   */
  resetSignatures() {
    this.signatures = null;
    this.transaction = null;
  }

  /**
   * Unmark all inputs currently on the partial tx as not `selected_as_input`.
   *
   * @param {HathorWallet} wallet Wallet of the UTXOs.
   */
  unmarkAsSelected() {
    for (const input of this.partialTx.inputs) {
      this.storage.utxoSelectAsInput({
        txId: input.hash,
        index: input.index
      }, false);
    }
  }

  /**
   * Returns true if the transaction funds are balanced and the signatures match all inputs.
   *
   * @returns {boolean}
   */
  isComplete() {
    return !!this.signatures && this.partialTx.isComplete() && this.signatures.isComplete();
  }

  /**
   * Create the data to sign from the current transaction signing the loaded wallet inputs.
   *
   * @param {string} pin The loaded wallet's pin to sign the transaction.
   * @param {boolean} validate If we should validate the data with the fullnode before signing.
   *
   * @throws {InvalidPartialTxError} Inputs and outputs balance should match before signing.
   * @throws {UnsupportedScriptError} When we have an unsupported output script.
   * @throws {IndexOOBError} input index should be inside the inputs array.
   */
  async signData(pin, validate = true) {
    if (!this.partialTx.isComplete()) {
      // partialTx is not complete, we cannot sign it.
      throw new _errors.InvalidPartialTxError('Cannot sign incomplete data');
    }
    const tx = this.partialTx.getTx();
    this.signatures = new _partial_tx.PartialTxInputData(tx.getDataToSign().toString('hex'), tx.inputs.length);
    if (validate) {
      // The validation method populates the addresses
      const valid = await this.partialTx.validate();
      if (!valid) {
        throw new _errors.InvalidPartialTxError('Transaction data inconsistent with fullnode');
      }
    }

    // sign inputs from the loaded wallet and save input data
    await _transaction.default.signTransaction(tx, this.storage, pin);
    for (const [index, input] of tx.inputs.entries()) {
      if (input.data) {
        // add all signatures we know of this tx
        this.signatures.addData(index, input.data);
      }
    }
  }

  /**
   * Overwrites the proposal's signatures with the serialized contents in the parameters
   * @param serializedSignatures
   *
   * @throws {InvalidPartialTxError} Inputs and outputs balance should match before the signatures can be added.
   */
  setSignatures(serializedSignatures) {
    if (!this.partialTx.isComplete()) {
      // partialTx is not complete, we cannot sign it.
      throw new _errors.InvalidPartialTxError('Cannot sign incomplete data');
    }
    const tx = this.partialTx.getTx();

    // Validating signatures hash before setting them
    const arr = serializedSignatures.split('|');
    if (arr[1] !== tx.hash) {
      throw new _errors.InvalidPartialTxError('Signatures do not match tx hash');
    }

    // Creating an empty signatures object
    this.signatures = new _partial_tx.PartialTxInputData(tx.getDataToSign().toString('hex'), tx.inputs.length);

    // Setting the signatures data from the parameters
    this.signatures.addSignatures(serializedSignatures);
  }

  /**
   * Create and return the Transaction instance if we have all signatures.
   *
   * @throws InvalidPartialTxError
   *
   * @returns {Transaction}
   */
  prepareTx() {
    if (!this.partialTx.isComplete()) {
      throw new _errors.InvalidPartialTxError('Incomplete data');
    }
    if (this.signatures === null || !this.signatures.isComplete()) {
      throw new _errors.InvalidPartialTxError('Incomplete signatures');
    }
    if (this.transaction !== null) {
      return this.transaction;
    }
    for (const [index, inputData] of Object.entries(this.signatures.data)) {
      this.partialTx.inputs[index].setData(inputData);
    }
    this.transaction = this.partialTx.getTx();
    this.transaction.prepareToSend();
    return this.transaction;
  }
}
var _default = exports.default = PartialTxProposal;