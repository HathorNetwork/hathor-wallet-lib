/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { OP_PUSHDATA1 } from '../opcodes';
import { DECIMAL_PLACES, DEFAULT_TX_VERSION, CREATE_TOKEN_TX_VERSION } from '../constants';
import path from 'path';
import buffer from 'buffer';
import Transaction from '../models/transaction';
import { HistoryTransaction, HistoryTransactionOutput } from '../models/types';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import ScriptData from '../models/script_data';
import CreateTokenTransaction from '../models/create_token_transaction';
import Input from '../models/input';
import Output from '../models/output';
import Network from '../models/network';
import Address from '../models/address';
import { hexToBuffer, unpackToInt, intToBytes, signedIntToBytes, floatToBytes } from './buffer';
import { prettyValue, prettyIntegerValue } from './numbers';
import { crypto, encoding, Address as bitcoreAddress } from 'bitcore-lib';
import { clone } from 'lodash';
import { AddressError, OutputValueError, ConstantNotSet, CreateTokenTxInvalid, MaximumNumberInputsError, MaximumNumberOutputsError, ParseError } from '../errors';

import { ErrorMessages } from '../errorMessages';
import config from '../config';

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
  roundFloat(n: number): number {
    return Math.round(n*100)/100
  },

  /**
   * Get the formatted value with decimal places and thousand separators
   *
   * @param {number} value Amount to be formatted
   *
   * @return {string} Formatted value
   * @deprecated Import this function directly from `utils/numbers.ts`
   *
   * @memberof Helpers
   * @inner
   */
  prettyValue: prettyValue,

  /**
   * Get the formatted value for an integer number
   *
   * @param {number} value Amount to be formatted
   *
   * @return {string} Formatted value
   * @deprecated Import this function directly from `utils/numbers.ts`
   *
   * @memberof Helpers
   * @inner
   */
  prettyIntegerValue: prettyIntegerValue,

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
  isVersionAllowed(version: string, minVersion: string): boolean {
    // Verifies if the version in parameter is allowed to make requests to other min version
    if (version.includes('beta') !== minVersion.includes('beta')) {
      // If one version is beta and the other is not, it's not allowed to use it
      return false;
    }

    // Clean the version string to have an array of integers
    // Check for each value if the version is allowed
    let versionTestArr = this.getCleanVersionArray(version);
    let minVersionArr = this.getCleanVersionArray(minVersion);
    for (let i=0; i<minVersionArr.length; i++) {
      if (minVersionArr[i] > versionTestArr[i]) {
        return false;
      } else if (minVersionArr[i] < versionTestArr[i]) {
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
  getCleanVersionArray(version: string): string[] {
    return version.replace(/[^\d.]/g, '').split('.');
  },

  /**
   * Transform int to bytes
   *
   * @param {number} value Integer to be transformed to bytes
   * @param {number} bytes How many bytes this number uses
   *
   * @return {Buffer} number in bytes
   * @deprecated Import this function directly from `utils/buffer.ts`
   * @memberof Helpers
   * @inner
   */
  intToBytes: intToBytes,

  /**
   * Transform signed int to bytes (1, 2, or 4 bytes)
   *
   * @param {number} value Integer to be transformed to bytes
   * @param {number} bytes How many bytes this number uses
   *
   * @return {Buffer} number in bytes
   * @deprecated Import this function directly from `utils/buffer.ts`
   * @memberof Helpers
   * @inner
   */
  signedIntToBytes: signedIntToBytes,

  /**
   * Transform float to bytes
   *
   * @param {number} value Integer to be transformed to bytes
   * @param {number} bytes How many bytes this number uses
   *
   * @return {Buffer} number in bytes
   * @deprecated Import this function directly from `utils/buffer.ts`
   * @memberof Helpers
   * @inner
   */
  floatToBytes: floatToBytes,

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
  pushDataToStack(stack: Buffer[], data: Buffer) {
    // In case data has length bigger than 75, we need to add a pushdata opcode
    if (data.length > 75) {
      stack.push(OP_PUSHDATA1);
    }
    stack.push(intToBytes(data.length, 1));
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
  pushIntToStack(stack: Buffer[], value: number) {
    if (value < 0 || value > 16) {
      throw new Error('Invalid OP_N, must be [0,16].');
    }
    // OP_0 is 0x50 (hex) or 80 (decimal), and OP_N is n + OP_0
    stack.push(Buffer.from([value+80]));
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
  getChecksum(bytes: Buffer): Buffer {
    return crypto.Hash.sha256sha256(bytes).slice(0, 4);
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
  encodeAddress(addressHash: Buffer, network: Network): Address {
    if (addressHash.length !== 20) {
      throw new Error('Expect address hash that must have 20 bytes.');
    }

    const addressVersionBytes = buffer.Buffer.from([network.versionBytes.p2pkh]);

    // With this sliced address we can calculate the checksum
    const slicedAddress = buffer.Buffer.concat([addressVersionBytes, addressHash]);
    const checksum = this.getChecksum(slicedAddress);
    const addressBytes = buffer.Buffer.concat([slicedAddress, checksum]);
    return new Address(encoding.Base58.encode(addressBytes), {network});
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
  encodeAddressP2SH(scriptHash: Buffer, network: Network): Address {
    if (scriptHash.length !== 20) {
      throw new Error('Expect script hash that must have 20 bytes.');
    }

    const addr = bitcoreAddress.fromScriptHash(scriptHash, network.getNetwork());

    return new Address(addr.toString(), {network});
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
  createTxFromBytes(bytes: Buffer, network: Network): Transaction | CreateTokenTransaction {
    if (!network) {
      throw new ParseError('Invalid network parameter.');
    }

    // We should clone the buffer being sent in order to never mutate
    // what comes from outside the library
    // as soon as it's available natively we should use an immutable buffer
    const cloneBuffer = clone(bytes);

    // Get version
    const [version, ] = unpackToInt(2, false, cloneBuffer);

    if (version === DEFAULT_TX_VERSION) {
      return Transaction.createFromBytes(cloneBuffer, network);
    } else if (version === CREATE_TOKEN_TX_VERSION) {
      return CreateTokenTransaction.createFromBytes(cloneBuffer, network);
    } else {
      throw new ParseError('We currently support only the Transaction and CreateTokenTransaction types. Other types will be supported in the future.');
    }
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
  createTxFromHex(hex: string, network: Network): Transaction | CreateTokenTransaction {
    return this.createTxFromBytes(hexToBuffer(hex), network);
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
  async sleep(milliseconds: number): Promise<void> {
    const promise: Promise<void> = new Promise(resolve => {
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
  createTxFromData(data, network: Network): Transaction | CreateTokenTransaction {
    const inputs: Input[] = [];
    for (const input of data.inputs) {
      const inputObj = new Input(
        input.tx_id,
        input.index,
        {
          data: input.data
        }
      );
      inputs.push(inputObj);
    }

    const outputs: Output[] = [];
    for (const output of data.outputs) {
      let outputObj;
      if (output.type === 'data') {
        // Is NFT output
        outputObj = this.createNFTOutput(output.data);
      } else if (output.type === 'p2sh') {
        // P2SH
        const address = new Address(output.address, { network });
        // This will throw AddressError in case the adress is invalid
        address.validateAddress();
        const p2sh = new P2SH(address, { timelock: output.timelock || null });
        const p2shScript = p2sh.createScript()
        outputObj = new Output(
          output.value,
          p2shScript,
          { tokenData: output.tokenData }
        );
      } else if (output.type === 'p2pkh' || output.type === undefined) {
        // P2PKH
        // for compatibility reasons we will accept an output without type as p2pkh as fallback
        const address = new Address(output.address, { network });
        // This will throw AddressError in case the adress is invalid
        address.validateAddress();
        const p2pkh = new P2PKH(address, { timelock: output.timelock || null });
        const p2pkhScript = p2pkh.createScript()
        outputObj = new Output(
          output.value,
          p2pkhScript,
          { tokenData: output.tokenData }
        );
      } else {
        throw new Error('Invalid output type.');
      }
      outputs.push(outputObj);
    }

    const options = {
      version: data.version,
      weight: data.weight,
      timestamp: data.timestamp,
      tokens: data.tokens
    }

    if (data.version === CREATE_TOKEN_TX_VERSION) {
      return new CreateTokenTransaction(
        data.name,
        data.symbol,
        inputs,
        outputs,
        options
      );
    } else if (data.version === DEFAULT_TX_VERSION) {
      return new Transaction(
        inputs,
        outputs,
        options
      );
    } else {
        throw new ParseError(ErrorMessages.UNSUPPORTED_TX_TYPE);
    }
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
  createTxFromHistoryObject(historyTx: HistoryTransaction): Transaction | CreateTokenTransaction {
    // Processing a token creation transaction
    const isCreateTokenTx = historyTx.version === CREATE_TOKEN_TX_VERSION

    if (isCreateTokenTx && (!historyTx?.token_name || !historyTx?.token_symbol)) {
      throw new CreateTokenTxInvalid(`Missing token name or symbol`)
    }

    const inputs = historyTx.inputs.map(i => new Input(i.tx_id, i.index))
    const outputs = historyTx.outputs.map(this.createOutputFromHistoryObject)

    if (isCreateTokenTx) {
      return new CreateTokenTransaction(
        historyTx.token_name!,
        historyTx.token_symbol!,
        inputs,
        outputs,
        {...historyTx})
    } else {
      return new Transaction(
        inputs,
        outputs,
        {...historyTx}
      )
    }
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
  createOutputFromHistoryObject(historyOutput: HistoryTransactionOutput): Output {
    return new Output(
      historyOutput.value,
      Buffer.from(historyOutput.script, 'base64'),
      {
        timelock: historyOutput.decoded.timelock || null,
        tokenData: historyOutput.token_data,
      }
    );
  },

  /**
   * Create NFT output from data string
   *
   * @memberof Helpers
   * @inner
   */
  createNFTOutput(data: string): Output {
    return this.createDataScriptOutput(data);
  },

  /**
   * Create an output with data script
   *
   * @memberof Helpers
   * @inner
   */
  createDataScriptOutput(data: string): Output {
    const scriptData = new ScriptData(data);
    // Value 1 and token HTR
    return new Output(1, scriptData.createScript());
  },

  /**
   * From the base58 of an address we get the type of it, i.e. 'p2pkh' or 'p2sh'
   *
   * @memberof Helpers
   * @inner
   */
  getOutputTypeFromAddress(address: string, network: Network): string {
    const addressObj = new Address(address, { network });
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
  getWSServerURL(url: string|null = null): string {
    let serverURL: string;
    if (url === null) {
      serverURL = config.getServerUrl();
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
    serverURL = path.join(`${pieces.join(':')}`, 'ws/');
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
  handlePrepareDataError(e: unknown): string {
    if (e instanceof AddressError ||
        e instanceof OutputValueError ||
        e instanceof ConstantNotSet ||
        e instanceof CreateTokenTxInvalid ||
        e instanceof MaximumNumberOutputsError ||
        e instanceof MaximumNumberInputsError) {
      return e.message;
    } else {
      // Unhandled error
      throw e;
    }
  },
}

export default helpers;
