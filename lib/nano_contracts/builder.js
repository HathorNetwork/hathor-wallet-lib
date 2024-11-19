"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _lodash = require("lodash");
var _output = _interopRequireDefault(require("../models/output"));
var _input = _interopRequireDefault(require("../models/input"));
var _nano_contract = _interopRequireDefault(require("./nano_contract"));
var _address = require("../utils/address");
var _constants = require("../constants");
var _serializer = _interopRequireDefault(require("./serializer"));
var _errors = require("../errors");
var _types = require("./types");
var _nano = _interopRequireDefault(require("../api/nano"));
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class NanoContractTransactionBuilder {
  constructor() {
    _defineProperty(this, "blueprintId", void 0);
    // nano contract ID, null if initialize
    _defineProperty(this, "ncId", void 0);
    _defineProperty(this, "method", void 0);
    _defineProperty(this, "actions", void 0);
    _defineProperty(this, "caller", void 0);
    _defineProperty(this, "args", void 0);
    _defineProperty(this, "transaction", void 0);
    _defineProperty(this, "wallet", void 0);
    this.blueprintId = null;
    this.ncId = null;
    this.method = null;
    this.actions = null;
    this.caller = null;
    this.args = null;
    this.transaction = null;
    this.wallet = null;
  }

  /**
   * Set object method attribute
   *
   * @param method Method name
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setMethod(method) {
    this.method = method;
    return this;
  }

  /**
   * Set object actions attribute
   *
   * @param actions List of actions
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setActions(actions) {
    // Check if there's only one action for each token
    if (actions) {
      const tokens = actions.map(action => action.token);
      const tokensSet = new Set(tokens);
      if (tokens.length !== tokensSet.size) {
        throw new Error('More than one action per token is not allowed.');
      }
    }
    this.actions = actions;
    return this;
  }

  /**
   * Set object args attribute
   *
   * @param args List of arguments
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setArgs(args) {
    this.args = args;
    return this;
  }

  /**
   * Set object caller attribute
   *
   * @param caller caller public key
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setCaller(caller) {
    this.caller = caller;
    return this;
  }

  /**
   * Set object blueprintId attribute
   *
   * @param blueprintId Blueprint id
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setBlueprintId(blueprintId) {
    this.blueprintId = blueprintId;
    return this;
  }

  /**
   * Set object ncId attribute
   *
   * @param {ncId} Nano contract id
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setNcId(ncId) {
    this.ncId = ncId;
    return this;
  }

  /**
   * Set object wallet attribute
   *
   * @param {wallet} Wallet object building this transaction
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setWallet(wallet) {
    this.wallet = wallet;
    return this;
  }

  /**
   * Execute a deposit action
   * Create inputs (and maybe change outputs) to complete the deposit
   *
   * @param {action} Action to be completed (must be a deposit type)
   * @param {tokens} Array of tokens to get the token data correctly
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async executeDeposit(action, tokens) {
    if (action.type !== _types.NanoContractActionType.DEPOSIT) {
      throw new _errors.NanoContractTransactionError("Can't execute a deposit with an action which type is differente than deposit.");
    }
    if (!action.amount || !action.token) {
      throw new _errors.NanoContractTransactionError('Amount and token are required for deposit action.');
    }
    const changeAddressParam = action.changeAddress;
    if (changeAddressParam && !(await this.wallet.isAddressMine(changeAddressParam))) {
      throw new _errors.NanoContractTransactionError('Change address must belong to the same wallet.');
    }

    // Get the utxos with the amount of the deposit and create the inputs
    const utxoOptions = {
      token: action.token
    };
    if (action.address) {
      utxoOptions.filter_address = action.address;
    }
    const utxosData = await this.wallet.getUtxosForAmount(action.amount, utxoOptions);
    const inputs = [];
    for (const utxo of utxosData.utxos) {
      inputs.push(new _input.default(utxo.txId, utxo.index));
    }
    const outputs = [];
    const network = this.wallet.getNetworkObject();
    // If there's a change amount left in the utxos, create the change output
    if (utxosData.changeAmount) {
      const changeAddressStr = changeAddressParam || (await this.wallet.getCurrentAddress()).address;
      // This will throw AddressError in case the adress is invalid
      // this handles p2pkh and p2sh scripts
      const outputScript = (0, _address.createOutputScriptFromAddress)(changeAddressStr, network);
      const tokenIndex = action.token === _constants.NATIVE_TOKEN_UID ? 0 : tokens.findIndex(token => token === action.token) + 1;
      const outputObj = new _output.default(utxosData.changeAmount, outputScript, {
        tokenData: tokenIndex
      });
      outputs.push(outputObj);
    }
    return [inputs, outputs];
  }

  /**
   * Execute a withdrawal action
   * Create outputs to complete the withdrawal
   *
   * @param {action} Action to be completed (must be a withdrawal type)
   * @param {tokens} Array of tokens to get the token data correctly
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  executeWithdrawal(action, tokens) {
    if (action.type !== _types.NanoContractActionType.WITHDRAWAL) {
      throw new _errors.NanoContractTransactionError("Can't execute a withdrawal with an action which type is differente than withdrawal.");
    }
    if (!action.address || !action.amount || !action.token) {
      throw new _errors.NanoContractTransactionError('Address, amount and token are required for withdrawal action.');
    }
    // Create the output with the withdrawal address and amount

    // This will throw AddressError in case the adress is invalid
    // this handles p2pkh and p2sh scripts
    const outputScript = (0, _address.createOutputScriptFromAddress)(action.address, this.wallet.getNetworkObject());
    const tokenIndex = action.token === _constants.NATIVE_TOKEN_UID ? 0 : tokens.findIndex(token => token === action.token) + 1;
    const output = new _output.default(action.amount, outputScript, {
      tokenData: tokenIndex
    });
    return output;
  }

  /**
   * Build the nano contract transaction
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async build() {
    if (this.method === _constants.NANO_CONTRACTS_INITIALIZE_METHOD && !this.blueprintId) {
      // Initialize needs the blueprint ID
      throw new _errors.NanoContractTransactionError('Missing blueprint id. Parameter blueprintId in data');
    }
    if (this.method !== _constants.NANO_CONTRACTS_INITIALIZE_METHOD) {
      // Get the blueprint id from the nano transaction in the full node
      if (!this.ncId) {
        throw new _errors.NanoContractTransactionError(`Nano contract ID cannot be null for method ${this.method}`);
      }
      let response;
      try {
        response = await this.wallet.getFullTxById(this.ncId);
      } catch {
        // Error getting nano contract transaction data from the full node
        throw new _errors.NanoContractTransactionError(`Error getting nano contract transaction data with id ${this.ncId} from the full node`);
      }
      if (response.tx.version !== _constants.NANO_CONTRACTS_VERSION) {
        throw new _errors.NanoContractTransactionError(`Transaction with id ${this.ncId} is not a nano contract transaction.`);
      }
      this.blueprintId = response.tx.nc_blueprint_id;
    }
    if (!this.blueprintId || !this.method || !this.caller) {
      throw new _errors.NanoContractTransactionError('Must have blueprint id, method and caller.');
    }

    // Validate if the arguments match the expected method arguments
    await (0, _utils.validateAndUpdateBlueprintMethodArgs)(this.blueprintId, this.method, this.args);

    // Transform actions into inputs and outputs
    let inputs = [];
    let outputs = [];
    let tokens = [];
    if (this.actions) {
      const tokenSet = new Set();
      for (const action of this.actions) {
        // Get token list
        if (action.token !== _constants.NATIVE_TOKEN_UID) {
          tokenSet.add(action.token);
        }
      }
      tokens = Array.from(tokenSet);
      for (const action of this.actions) {
        // Call action
        if (action.type === _types.NanoContractActionType.DEPOSIT) {
          const ret = await this.executeDeposit(action, tokens);
          inputs = (0, _lodash.concat)(inputs, ret[0]);
          outputs = (0, _lodash.concat)(outputs, ret[1]);
        } else if (action.type === _types.NanoContractActionType.WITHDRAWAL) {
          const output = this.executeWithdrawal(action, tokens);
          outputs = (0, _lodash.concat)(outputs, output);
        } else {
          throw new Error('Invalid type for nano contract action.');
        }
      }
    }

    // Serialize the method arguments
    const serializedArgs = [];
    if (this.args) {
      const serializer = new _serializer.default();
      const blueprintInformation = await _nano.default.getBlueprintInformation(this.blueprintId);
      const methodArgs = (0, _lodash.get)(blueprintInformation, `public_methods.${this.method}.args`, []);
      if (!methodArgs) {
        throw new _errors.NanoContractTransactionError(`Blueprint does not have method ${this.method}.`);
      }
      if (this.args.length !== methodArgs.length) {
        throw new _errors.NanoContractTransactionError(`Method needs ${methodArgs.length} parameters but data has ${this.args.length}.`);
      }
      for (const [index, arg] of methodArgs.entries()) {
        const serialized = serializer.serializeFromType(this.args[index], arg.type);
        serializedArgs.push(serialized);
      }
    }
    const ncId = this.method === _constants.NANO_CONTRACTS_INITIALIZE_METHOD ? this.blueprintId : this.ncId;
    if (ncId == null) {
      // This was validated in the beginning of the method but the linter was complaining about it
      throw new Error('This should never happen.');
    }
    return new _nano_contract.default(inputs, outputs, tokens, ncId, this.method, serializedArgs, this.caller, null);
  }
}
var _default = exports.default = NanoContractTransactionBuilder;