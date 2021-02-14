/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { OP_GREATERTHAN_TIMESTAMP, OP_DUP, OP_HASH160, OP_EQUALVERIFY, OP_CHECKSIG } from '../opcodes';
import { MAX_OUTPUT_VALUE_32, MAX_OUTPUT_VALUE, TOKEN_AUTHORITY_MASK, TOKEN_MINT_MASK, TOKEN_MELT_MASK, TOKEN_INDEX_MASK } from '../constants';
import { OutputValueError } from '../errors';
import { util } from 'bitcore-lib';
import helpers from '../utils/helpers';
import Address from './address';

type optionsType = {
  tokenData?: number,
  timelock?: number | null,
};

const defaultOptions = {
  tokenData: 0,
  timelock: null,
};


class Output {
  // Output value as an integer
  value: number;
  // Address object of the value destination
  address: Address;
  // tokenData of the output
  tokenData: number;
  // Timestamp of the timelock of the output
  timelock: number | null;

  constructor(value: number, address: Address, options: optionsType = defaultOptions) {
    const newOptions = Object.assign(defaultOptions, options);
    const { tokenData, timelock} = newOptions;

    if (!value) {
      throw new OutputValueError('Value must be a positive number.');
    }

    if (!address) {
      throw Error('You must provide an address.');
    }

    this.value = value;
    this.address = address;
    this.tokenData = tokenData;
    this.timelock = timelock;
  }

  /**
   * Get the bytes from the output value
   * If value is above the maximum for 32 bits we get from 8 bytes, otherwise only 4 bytes
   *
   * @throws {OutputValueError} Will throw an error if output value is invalid
   *
   * @return {Buffer}
   *
   * @memberof Transaction
   * @inner
   */
  valueToBytes(): Buffer {
    if (this.value <= 0) {
      throw new OutputValueError('Output value must be positive');
    }
    if (this.value > MAX_OUTPUT_VALUE) {
      throw new OutputValueError(`Maximum value is ${helpers.prettyValue(MAX_OUTPUT_VALUE)}`);
    }
    if (this.value > MAX_OUTPUT_VALUE_32) {
      return helpers.signedIntToBytes(-this.value, 8);
    } else {
      return helpers.signedIntToBytes(this.value, 4);
    }
  }

  /*
   * Returns if output is authority
   *
   * @return {boolean} If it's an authority output or not
   *
   * @memberof Output
   * @inner
   */
  isAuthority(): boolean {
    return (this.tokenData & TOKEN_AUTHORITY_MASK) > 0;
  }

  /*
   * Verifies if output is of mint
   *
   * @return {boolean} if output is mint
   *
   * @memberof Output
   * @inner
   */
  isMint(): boolean {
    return this.isAuthority() && ((this.value & TOKEN_MINT_MASK) > 0);
  }

  /*
   * Verifies if output is of melt
   *
   * @return {boolean} if output is melt
   *
   * @memberof Output
   * @inner
   */
  isMelt(): boolean {
    return this.isAuthority() && ((this.value & TOKEN_MELT_MASK) > 0);
  }

  /**
   * Get index of token list of the output.
   * It already subtracts 1 from the final result,
   * so if this returns 0, it's the first token, i.e.
   * tokenData = 1, then getTokenIndex = 0.
   * For HTR output (tokenData = 0) it will return -1.
   *
   * @return {number} Index of the token of this output
   *
   * @memberof Output
   * @inner
   */
  getTokenIndex(): number {
    return (this.tokenData & TOKEN_INDEX_MASK) - 1;
  }
  
  /**
   * Create a P2PKH script
   * 
   * @return {Buffer}
   * @memberof Output
   * @inner
   */
  createScript(): Buffer {
    const arr: Buffer[] = [];
    const addressBytes = this.address.decode();
    const addressHash = addressBytes.slice(1, -4);
    if (this.timelock) {
      let timelockBytes = helpers.intToBytes(this.timelock, 4);
      helpers.pushDataToStack(arr, timelockBytes);
      arr.push(OP_GREATERTHAN_TIMESTAMP);
    }
    arr.push(OP_DUP);
    arr.push(OP_HASH160);
    // addressHash has a fixed size of 20 bytes, so no need to push OP_PUSHDATA1
    arr.push(helpers.intToBytes(addressHash.length, 1));
    arr.push(addressHash);
    arr.push(OP_EQUALVERIFY);
    arr.push(OP_CHECKSIG);
    return util.buffer.concat(arr);
  }

  /**
   * Serialize an output to bytes
   *
   * @return {Buffer[]}
   * @memberof Output
   * @inner
   */
  serialize(): Buffer[] {
    const arr: Buffer[] = [];
    arr.push(this.valueToBytes());
    // Token data
    arr.push(helpers.intToBytes(this.tokenData, 1));
    const outputScript = this.createScript();
    arr.push(helpers.intToBytes(outputScript.length, 2));
    arr.push(outputScript);
    return arr;
  }
}

export default Output;