/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { OP_PUSHDATA1 } from '../opcodes';
import { DECIMAL_PLACES, DEFAULT_TX_VERSION, CREATE_TOKEN_TX_VERSION } from '../constants';
import buffer from 'buffer';
import Long from 'long';
import Transaction from '../models/transaction';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import ScriptData from '../models/script_data';
import CreateTokenTransaction from '../models/create_token_transaction';
import Input from '../models/input';
import Output from '../models/output';
import Network from '../models/network';
import Address from '../models/address';
import { hexToBuffer, unpackToInt } from '../utils/buffer';
import { crypto, encoding, Address as bitcoreAddress } from 'bitcore-lib';
import { clone } from 'lodash';
import { ParseError } from '../errors';
import { ErrorMessages } from '../errorMessages';

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
   *
   * @memberof Helpers
   * @inner
   */
  prettyValue(value: number): string {
    const fixedPlaces = (value/10**DECIMAL_PLACES).toFixed(DECIMAL_PLACES);
    const integerPart = fixedPlaces.split('.')[0];
    const decimalPart = fixedPlaces.split('.')[1];
    return `${this.prettyIntegerValue(parseInt(integerPart))}.${decimalPart}`;
  },

  /**
   * Get the formatted value for an integer number
   *
   * @param {number} value Amount to be formatted
   *
   * @return {string} Formatted value
   *
   * @memberof Helpers
   * @inner
   */
  prettyIntegerValue(value: number): string {
    const integerFormated = new Intl.NumberFormat('en-US').format(Math.abs(value));
    const signal = value < 0 ? '-' : '';
    return `${signal}${integerFormated}`;
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
   * @memberof Helpers
   * @inner
   */
  intToBytes(value: number, bytes: number): Buffer {
    let arr = new ArrayBuffer(bytes);
    let view = new DataView(arr);
    if (bytes === 1) {
      // byteOffset = 0;
      view.setUint8(0, value);
    } else if (bytes === 2) {
      // byteOffset = 0; isLittleEndian = false
      view.setUint16(0, value, false);
    } else if (bytes === 4) {
      // byteOffset = 0; isLittleEndian = false
      view.setUint32(0, value, false);
    }
    return buffer.Buffer.from(arr);
  },

  /**
   * Transform signed int to bytes (1, 2, or 4 bytes)
   *
   * @param {number} value Integer to be transformed to bytes
   * @param {number} bytes How many bytes this number uses
   *
   * @return {Buffer} number in bytes
   * @memberof Helpers
   * @inner
   */
  signedIntToBytes(value: number, bytes: number): Buffer {
    let arr = new ArrayBuffer(bytes);
    let view = new DataView(arr);
    if (bytes === 1) {
      // byteOffset = 0
      view.setInt8(0, value);
    } else if (bytes === 2) {
      // byteOffset = 0; isLittleEndian = false
      view.setInt16(0, value, false);
    } else if (bytes === 4) {
      view.setInt32(0, value, false);
    } else if (bytes === 8) {
      // In case of 8 bytes I need to handle the int with a Long lib
      let long = Long.fromNumber(value, false);
      arr = long.toBytesBE();
    }
    return buffer.Buffer.from(arr);
  },

  /**
   * Transform float to bytes
   *
   * @param {number} value Integer to be transformed to bytes
   * @param {number} bytes How many bytes this number uses
   *
   * @return {Buffer} number in bytes
   * @memberof Helpers
   * @inner
   */
  floatToBytes(value: number, bytes: number): Buffer {
    let arr = new ArrayBuffer(bytes);
    let view = new DataView(arr);
    if (bytes === 8) {
      // byteOffset = 0; isLitteEndian = false
      view.setFloat64(0, value, false);
    }
    return buffer.Buffer.from(arr);
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
  pushDataToStack(stack: Buffer[], data: Buffer) {
    // In case data has length bigger than 75, we need to add a pushdata opcode
    if (data.length > 75) {
      stack.push(OP_PUSHDATA1);
    }
    stack.push(this.intToBytes(data.length, 1));
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

    const addr = bitcoreAddress.fromScriptHash(scriptHash, network);

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
    const promise: Promise<void> = new Promise((resolve, reject) => {
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
   * Create NFT output from data string
   *
   * @memberof Helpers
   * @inner
   */
  createNFTOutput(data: string): Output {
    const scriptData = new ScriptData(data);
    // Value 1 and token HTR
    return new Output(1, scriptData.createScript());
  },
}

export default helpers;
