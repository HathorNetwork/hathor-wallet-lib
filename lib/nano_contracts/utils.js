"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.validateAndUpdateBlueprintMethodArgs = exports.prepareNanoSendTransaction = exports.isNanoContractCreateTx = exports.getOracleInputData = exports.getOracleBuffer = void 0;
var _lodash = require("lodash");
var _bitcoreLib = require("bitcore-lib");
var _transaction = _interopRequireDefault(require("../utils/transaction"));
var _sendTransaction = _interopRequireDefault(require("../new/sendTransaction"));
var _script_data = _interopRequireDefault(require("../models/script_data"));
var _nano = _interopRequireDefault(require("../api/nano"));
var _buffer = require("../utils/buffer");
var _p2pkh = _interopRequireDefault(require("../models/p2pkh"));
var _p2sh = _interopRequireDefault(require("../models/p2sh"));
var _address = _interopRequireDefault(require("../models/address"));
var _errors = require("../errors");
var _types = require("../wallet/types");
var _scripts = require("../utils/scripts");
var _constants = require("../constants");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Sign a transaction and create a send transaction object
 *
 * @param tx Transaction to sign and send
 * @param pin Pin to decrypt data
 * @param storage Wallet storage object
 */
const prepareNanoSendTransaction = async (tx, pin, storage) => {
  await _transaction.default.signTransaction(tx, storage, pin);
  tx.prepareToSend();

  // Create and return a send transaction object
  return new _sendTransaction.default({
    storage,
    transaction: tx,
    pin
  });
};

/**
 * Get oracle buffer from oracle string (address in base58 or oracle data directly in hex)
 *
 * @param oracle Address in base58 or oracle data directly in hex
 * @param network Network to calculate the address
 */
exports.prepareNanoSendTransaction = prepareNanoSendTransaction;
const getOracleBuffer = (oracle, network) => {
  const address = new _address.default(oracle, {
    network
  });
  // First check if the oracle is a base58 address
  // In case of success, set the output script as oracle
  // Otherwise, it's a custom script in hexadecimal
  if (address.isValid()) {
    const outputScriptType = address.getType();
    let outputScript;
    if (outputScriptType === _types.OutputType.P2PKH) {
      outputScript = new _p2pkh.default(address);
    } else if (outputScriptType === _types.OutputType.P2SH) {
      outputScript = new _p2sh.default(address);
    } else {
      throw new _errors.OracleParseError('Invalid output script type.');
    }
    return outputScript.createScript();
  }

  // Oracle script is a custom script
  try {
    return (0, _buffer.hexToBuffer)(oracle);
  } catch (err) {
    // Invalid hex
    throw new _errors.OracleParseError('Invalid hex value for oracle script.');
  }
};

/**
 * Get oracle input data
 *
 * @param oracleData Oracle data
 * @param resultSerialized Result to sign with oracle data already serialized
 * @param wallet Hathor Wallet object
 */
exports.getOracleBuffer = getOracleBuffer;
const getOracleInputData = async (oracleData, resultSerialized, wallet) => {
  // Parse oracle script to validate if it's an address of this wallet
  const parsedOracleScript = (0, _scripts.parseScript)(oracleData, wallet.getNetworkObject());
  if (parsedOracleScript && !(parsedOracleScript instanceof _script_data.default)) {
    if (await wallet.storage.isReadonly()) {
      throw new _errors.WalletFromXPubGuard('getOracleInputData');
    }

    // This is only when the oracle is an address, otherwise we will have the signed input data
    const address = parsedOracleScript.address.base58;
    if (!wallet.isAddressMine(address)) {
      throw new _errors.OracleParseError('Oracle address is not from the loaded wallet.');
    }
    const oracleKey = await wallet.getPrivateKeyFromAddress(address);
    const signatureOracle = _transaction.default.getSignature(_bitcoreLib.crypto.Hash.sha256(resultSerialized), oracleKey);
    const oraclePubKeyBuffer = oracleKey.publicKey.toBuffer();
    return _transaction.default.createInputData(signatureOracle, oraclePubKeyBuffer);
  }

  // If it's not an address, we use the oracleInputData as the inputData directly
  return oracleData;
};

/**
 * Validate if nano contracts arguments match the expected ones from the blueprint method
 * It also converts arguments that come from clients in a different type than the expected,
 * e.g., bytes come as hexadecimal strings and address (bytes) come as base58 string.
 * We convert them to the expected type and update the original array of arguments
 *
 * @param blueprintId Blueprint ID
 * @param method Method name
 * @param args Arguments of the method to check if have the expected types
 *
 * Warning: This method can mutate the `args` parameter during its validation
 *
 * @throws NanoContractTransactionError in case the arguments are not valid
 * @throws NanoRequest404Error in case the blueprint ID does not exist on the full node
 */
exports.getOracleInputData = getOracleInputData;
const validateAndUpdateBlueprintMethodArgs = async (blueprintId, method, args) => {
  // Get the blueprint data from full node
  const blueprintInformation = await _nano.default.getBlueprintInformation(blueprintId);
  const methodArgs = (0, _lodash.get)(blueprintInformation, `public_methods.${method}.args`, []);
  if (!methodArgs) {
    throw new _errors.NanoContractTransactionError(`Blueprint does not have method ${method}.`);
  }

  // Args may come as undefined or null
  if (args == null) {
    if (methodArgs.length !== 0) {
      throw new _errors.NanoContractTransactionError(`Method needs ${methodArgs.length} parameters but no arguments were received.`);
    }
    return;
  }
  const argsLen = args.length;
  if (argsLen !== methodArgs.length) {
    throw new _errors.NanoContractTransactionError(`Method needs ${methodArgs.length} parameters but data has ${args.length}.`);
  }

  // Here we validate that the arguments sent in the data array of args has
  // the expected type for each parameter of the blueprint method
  // Besides that, there are arguments that come from the clients in a different way
  // that we expect, e.g. the bytes arguments come as hexadecimal, and the address
  // arguments come as base58 strings, so we converts them and update the original
  // array of arguments with the expected type
  for (const [index, arg] of methodArgs.entries()) {
    let typeToCheck = arg.type;
    if (typeToCheck.startsWith('SignedData')) {
      // Signed data will always be an hexadecimal with the
      // signature len, signature, and the data itself
      typeToCheck = 'str';
    }
    switch (typeToCheck) {
      case 'bytes':
      case 'TxOutputScript':
      case 'TokenUid':
      case 'ContractId':
      case 'VertexId':
        // Bytes arguments are sent in hexadecimal
        try {
          // eslint-disable-next-line no-param-reassign
          args[index] = (0, _buffer.hexToBuffer)(args[index]);
        } catch {
          // Data sent is not a hex
          throw new _errors.NanoContractTransactionError(`Invalid hexadecimal for argument number ${index + 1} for type ${arg.type}.`);
        }
        break;
      case 'int':
      case 'float':
      case 'Amount':
      case 'Timestamp':
        if (typeof args[index] !== 'number') {
          throw new _errors.NanoContractTransactionError(`Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`);
        }
        break;
      case 'str':
        if (typeof args[index] !== 'string') {
          throw new _errors.NanoContractTransactionError(`Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`);
        }
        break;
      // Creating a block {} in the case below
      // because we can't create a variable without it (linter - no-case-declarations)
      case 'Address':
        {
          const argValue = args[index];
          if (typeof argValue !== 'string') {
            throw new _errors.NanoContractTransactionError(`Expects argument number ${index + 1} type ${arg.type} but received type ${typeof argValue}.`);
          }
          try {
            const address = new _address.default(argValue);
            address.validateAddress();
            // eslint-disable-next-line no-param-reassign
            args[index] = address.decode();
          } catch {
            // Argument value is not a valid address
            throw new _errors.NanoContractTransactionError(`Argument ${argValue} is not a valid base58 address.`);
          }
          break;
        }
      default:
        // eslint-disable-next-line valid-typeof -- This rule is not suited for dynamic comparisons such as this one
        if (arg.type !== typeof args[index]) {
          throw new _errors.NanoContractTransactionError(`Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`);
        }
    }
  }
};

/**
 * Checks if a transaction is a nano contract create transaction
 *
 * @param tx History object from hathor core to check if it's a nano create tx
 */
exports.validateAndUpdateBlueprintMethodArgs = validateAndUpdateBlueprintMethodArgs;
const isNanoContractCreateTx = tx => {
  return tx.version === _constants.NANO_CONTRACTS_VERSION && tx.nc_method === _constants.NANO_CONTRACTS_INITIALIZE_METHOD;
};
exports.isNanoContractCreateTx = isNanoContractCreateTx;