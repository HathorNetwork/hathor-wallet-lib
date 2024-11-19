"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _events = require("events");
var _lodash = require("lodash");
var _walletApi = _interopRequireDefault(require("./api/walletApi"));
var _mineTransaction = _interopRequireDefault(require("./mineTransaction"));
var _wallet = _interopRequireDefault(require("./wallet"));
var _helpers = _interopRequireDefault(require("../utils/helpers"));
var _p2pkh = _interopRequireDefault(require("../models/p2pkh"));
var _transaction = _interopRequireDefault(require("../models/transaction"));
var _output = _interopRequireDefault(require("../models/output"));
var _input = _interopRequireDefault(require("../models/input"));
var _address = _interopRequireDefault(require("../models/address"));
var _constants = require("../constants");
var _errors = require("../errors");
var _types = require("./types");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class SendTransactionWalletService extends _events.EventEmitter {
  constructor(wallet, options = {}) {
    super();
    // Wallet that is sending the transaction
    _defineProperty(this, "wallet", void 0);
    // Outputs to prepare the transaction
    _defineProperty(this, "outputs", void 0);
    // Optional inputs to prepare the transaction
    _defineProperty(this, "inputs", void 0);
    // Optional change address to prepare the transaction
    _defineProperty(this, "changeAddress", void 0);
    // Transaction object to be used after it's already prepared
    _defineProperty(this, "transaction", void 0);
    // MineTransaction object
    _defineProperty(this, "mineTransaction", void 0);
    // PIN to load the seed from memory
    _defineProperty(this, "pin", void 0);
    const newOptions = {
      outputs: [],
      inputs: [],
      changeAddress: null,
      transaction: null,
      ...options
    };
    this.wallet = wallet;
    this.outputs = newOptions.outputs;
    this.inputs = newOptions.inputs;
    this.changeAddress = newOptions.changeAddress;
    this.transaction = newOptions.transaction;
    this.mineTransaction = null;
    this.pin = newOptions.pin;
  }

  /**
   * Prepare transaction data to send
   * Get utxos from wallet service, creates change outpus and returns a Transaction object
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async prepareTx() {
    if (this.outputs.length === 0) {
      throw new _errors.WalletError("Can't prepare transactions with no outputs.");
    }
    this.emit('prepare-tx-start');
    // We get the full outputs amount for each token
    // This is useful for (i) getting the utxos for each one
    // in case it's not sent and (ii) create the token array of the tx
    const tokenAmountMap = {};
    for (const output of this.outputs) {
      if (output.token in tokenAmountMap) {
        tokenAmountMap[output.token] += output.value;
      } else {
        tokenAmountMap[output.token] = output.value;
      }
    }

    // We need this array to get the addressPath for each input used and be able to sign the input data
    let utxosAddressPath;
    if (this.inputs.length === 0) {
      // Need to get utxos
      // We already know the full amount for each token
      // Now we can get the utxos and (if needed) change amount for each token
      utxosAddressPath = await this.selectUtxosToUse(tokenAmountMap);
    } else {
      // If the user selected the inputs, we must validate that
      // all utxos are valid and the sum is enought to fill the outputs
      utxosAddressPath = await this.validateUtxos(tokenAmountMap);
    }

    // Create tokens array, in order to calculate each output tokenData
    // if HTR appears in the array, we must remove it
    // because we don't add HTR to the transaction tokens array
    const tokens = Object.keys(tokenAmountMap);
    const htrIndex = tokens.indexOf(_constants.NATIVE_TOKEN_UID);
    if (htrIndex > -1) {
      tokens.splice(htrIndex, 1);
    }

    // Transform input data in Input model object
    const inputsObj = [];
    for (const i of this.inputs) {
      inputsObj.push(this.inputDataToModel(i));
    }

    // Transform output data in Output model object
    const outputsObj = [];
    for (const o of this.outputs) {
      outputsObj.push(this.outputDataToModel(o, tokens));
    }

    // Create the transaction object, add weight and timestamp
    this.transaction = new _transaction.default(inputsObj, outputsObj);
    this.transaction.tokens = tokens;
    this.emit('prepare-tx-end', this.transaction);
    return {
      transaction: this.transaction,
      utxosAddressPath
    };
  }

  /**
   * Map input data to an input object
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  // eslint-disable-next-line class-methods-use-this -- XXX: This method should be made static
  inputDataToModel(input) {
    return new _input.default(input.txId, input.index);
  }

  /**
   * Map output data to an output object
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  outputDataToModel(output, tokens) {
    if (output.type === _types.OutputType.DATA) {
      return _helpers.default.createDataScriptOutput(output.data);
    }
    const address = new _address.default(output.address, {
      network: this.wallet.network
    });
    if (!address.isValid()) {
      throw new _errors.SendTxError(`Address ${output.address} is not valid.`);
    }
    const tokenData = tokens.indexOf(output.token) > -1 ? tokens.indexOf(output.token) + 1 : 0;
    const outputOptions = {
      tokenData
    };
    const p2pkh = new _p2pkh.default(address, {
      timelock: output.timelock || null
    });
    const p2pkhScript = p2pkh.createScript();
    return new _output.default(output.value, p2pkhScript, outputOptions);
  }

  /**
   * Check if the utxos selected are valid and the sum is enough to
   * fill the outputs. If needed, create change output
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async validateUtxos(tokenAmountMap) {
    const amountInputMap = {};
    const utxosAddressPath = [];
    for (const input of this.inputs) {
      const utxo = await this.wallet.getUtxoFromId(input.txId, input.index);
      if (utxo === null) {
        throw new _errors.UtxoError(`Invalid input selection. Input ${input.txId} at index ${input.index}.`);
      }
      if (!(utxo.tokenId in tokenAmountMap)) {
        throw new _errors.SendTxError(`Invalid input selection. Input ${input.txId} at index ${input.index} has token ${utxo.tokenId} that is not on the outputs.`);
      }
      utxosAddressPath.push(utxo.addressPath);
      if (utxo.tokenId in amountInputMap) {
        amountInputMap[utxo.tokenId] += utxo.value;
      } else {
        amountInputMap[utxo.tokenId] = utxo.value;
      }
    }
    for (const t in tokenAmountMap) {
      if (!(t in amountInputMap)) {
        throw new _errors.SendTxError(`Invalid input selection. Token ${t} is in the outputs but there are no inputs for it.`);
      }
      if (amountInputMap[t] < tokenAmountMap[t]) {
        throw new _errors.SendTxError(`Invalid input selection. Sum of inputs for token ${t} is smaller than the sum of outputs.`);
      }
      if (amountInputMap[t] > tokenAmountMap[t]) {
        const changeAmount = amountInputMap[t] - tokenAmountMap[t];
        const changeAddress = this.changeAddress || this.wallet.getCurrentAddress({
          markAsUsed: true
        }).address;
        this.outputs.push({
          address: changeAddress,
          value: changeAmount,
          token: t,
          type: _helpers.default.getOutputTypeFromAddress(changeAddress, this.wallet.network)
        });
        // If we add a change output, then we must shuffle it
        this.outputs = (0, _lodash.shuffle)(this.outputs);
      }
    }
    return utxosAddressPath;
  }

  /**
   * Select utxos to be used in the transaction
   * Get utxos from wallet service and creates change output if needed
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async selectUtxosToUse(tokenAmountMap) {
    const utxosAddressPath = [];
    for (const token in tokenAmountMap) {
      const {
        utxos,
        changeAmount
      } = await this.wallet.getUtxos({
        tokenId: token,
        totalAmount: tokenAmountMap[token]
      });
      if (utxos.length === 0) {
        throw new _errors.UtxoError(`No utxos available to fill the request. Token: ${token} - Amount: ${tokenAmountMap[token]}.`);
      }
      for (const utxo of utxos) {
        this.inputs.push({
          txId: utxo.txId,
          index: utxo.index
        });
        utxosAddressPath.push(utxo.addressPath);
      }
      if (changeAmount) {
        const changeAddress = this.changeAddress || this.wallet.getCurrentAddress({
          markAsUsed: true
        }).address;
        this.outputs.push({
          address: changeAddress,
          value: changeAmount,
          token,
          type: _helpers.default.getOutputTypeFromAddress(changeAddress, this.wallet.network)
        });
        // If we add a change output, then we must shuffle it
        this.outputs = (0, _lodash.shuffle)(this.outputs);
      }
    }
    return utxosAddressPath;
  }

  /**
   * Signs the inputs of a transaction
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async signTx(utxosAddressPath) {
    if (this.transaction === null) {
      throw new _errors.WalletError("Can't sign transaction if it's null.");
    }
    this.emit('sign-tx-start');
    const dataToSignHash = this.transaction.getDataToSignHash();
    const xprivkey = await this.wallet.storage.getMainXPrivKey(this.pin || '');
    for (const [idx, inputObj] of this.transaction.inputs.entries()) {
      const inputData = this.wallet.getInputData(xprivkey, dataToSignHash,
      // the wallet service returns the full BIP44 path, but we only need the address path:
      _wallet.default.getAddressIndexFromFullPath(utxosAddressPath[idx]));
      inputObj.setData(inputData);
    }

    // Now that the tx is completed with the data of the input
    // we can add the timestamp and calculate the weight
    this.transaction.prepareToSend();
    this.emit('sign-tx-end', this.transaction);
  }

  /**
   * Mine the transaction
   * Expects this.transaction to be prepared and signed
   * Emits MineTransaction events while the process is ongoing
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  mineTx(options = {}) {
    if (this.transaction === null) {
      throw new _errors.WalletError("Can't mine transaction if it's null.");
    }
    const newOptions = {
      startMiningTx: true,
      maxTxMiningRetries: 3,
      ...options
    };
    this.mineTransaction = new _mineTransaction.default(this.transaction, {
      maxTxMiningRetries: newOptions.maxTxMiningRetries
    });
    this.mineTransaction.on('mining-started', () => {
      this.emit('mine-tx-started');
    });
    this.mineTransaction.on('estimation-updated', data => {
      this.emit('estimation-updated', data);
    });
    this.mineTransaction.on('job-submitted', data => {
      this.emit('job-submitted', data);
    });
    this.mineTransaction.on('job-done', data => {
      this.emit('job-done', data);
    });
    this.mineTransaction.on('error', message => {
      this.emit('send-error', message);
    });
    this.mineTransaction.on('unexpected-error', message => {
      this.emit('send-error', message);
    });
    this.mineTransaction.on('success', data => {
      this.emit('mine-tx-ended', data);
    });
    if (newOptions.startMiningTx) {
      this.mineTransaction.start();
    }
    return this.mineTransaction.promise;
  }

  /**
   * Create and send a tx proposal to wallet service
   * Expects this.transaction to be prepared, signed and mined
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async handleSendTxProposal() {
    if (this.transaction === null) {
      throw new _errors.WalletError("Can't push transaction if it's null.");
    }
    this.emit('send-tx-start', this.transaction);
    const txHex = this.transaction.toHex();
    try {
      const responseData = await _walletApi.default.createTxProposal(this.wallet, txHex);
      const {
        txProposalId
      } = responseData;
      await _walletApi.default.updateTxProposal(this.wallet, txProposalId, txHex);
      this.transaction.updateHash();
      this.emit('send-tx-success', this.transaction);
      return this.transaction;
    } catch (err) {
      if (err instanceof _errors.WalletRequestError) {
        const errMessage = 'Error sending tx proposal.';
        this.emit('send-error', errMessage);
        throw new _errors.SendTxError(errMessage);
      } else {
        throw err;
      }
    }
  }

  /**
   * Run sendTransaction from mining, i.e. expects this.transaction to be prepared and signed
   * then it will mine and handle tx proposal
   *
   * 'until' parameter can be 'mine-tx', in order to only mine the transaction without propagating
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async runFromMining(until = null) {
    try {
      // This will await until mine tx is fully completed
      // mineTx method returns a promise that resolves when
      // mining succeeds or rejects when there is an error
      const mineData = await this.mineTx();
      this.transaction.parents = mineData.parents;
      this.transaction.timestamp = mineData.timestamp;
      this.transaction.nonce = mineData.nonce;
      this.transaction.weight = mineData.weight;
      if (until === 'mine-tx') {
        return this.transaction;
      }
      const tx = await this.handleSendTxProposal();
      return tx;
    } catch (err) {
      if (err instanceof _errors.WalletError) {
        this.emit('send-error', err.message);
      }
      throw err;
    }
  }

  /**
   * Run sendTransaction from preparing, i.e. prepare, sign, mine and send the tx
   *
   * 'until' parameter can be 'prepare-tx' (it will stop before signing the tx), 'sign-tx' (it will stop before mining the tx),
   * or 'mine-tx' (it will stop before send tx proposal, i.e. propagating the tx)
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async run(until = null) {
    try {
      const preparedData = await this.prepareTx();
      if (until === 'prepare-tx') {
        return this.transaction;
      }
      await this.signTx(preparedData.utxosAddressPath);
      if (until === 'sign-tx') {
        return this.transaction;
      }
      const tx = await this.runFromMining(until);
      return tx;
    } catch (err) {
      if (err instanceof _errors.WalletError) {
        this.emit('send-error', err.message);
      }
      throw err;
    }
  }
}
var _default = exports.default = SendTransactionWalletService;