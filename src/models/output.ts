/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import _ from 'lodash';
import {
  TOKEN_AUTHORITY_MASK,
  TOKEN_INDEX_MASK,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../constants';
import { OutputValueError } from '../errors';
import P2PKH from './p2pkh';
import P2SH from './p2sh';
import ScriptData from './script_data';
import Network from './network';
import {
  bytesToOutputValue,
  unpackLen,
  unpackToInt,
  intToBytes,
  bigIntToBytes,
} from '../utils/buffer';
import { outputValueToBytes } from '../utils/transaction';
import { parseScript as utilsParseScript } from '../utils/scripts';
import { OutputValueType } from '../types';

type optionsType = {
  tokenData?: number | undefined;
  // FIXME: Timelock as an option is not used, it is extracted from the decoded script.
  timelock?: number | null | undefined;
};

/**
 * Maximum length of an output script
 * @type {number}
 */
export const MAXIMUM_SCRIPT_LENGTH: number = 256;

class Output {
  // Output value as an integer
  value: OutputValueType;

  // tokenData of the output
  tokenData: number;

  // Output script
  script: Buffer;

  // Decoded output script
  decodedScript: P2PKH | P2SH | ScriptData | null;

  constructor(value: OutputValueType, script: Buffer, options: optionsType = {}) {
    const defaultOptions = {
      tokenData: 0,
    };

    const newOptions = Object.assign(defaultOptions, options);
    const { tokenData } = newOptions;

    if (!value) {
      throw new OutputValueError('Value must be a positive number.');
    }

    if (!script) {
      throw Error('You must provide a script.');
    }

    this.value = value;
    this.script = script;
    this.tokenData = tokenData;
    this.decodedScript = null;
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
    return outputValueToBytes(this.value);
  }

  /**
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

  /**
   * Verifies if output is of mint
   *
   * @return {boolean} if output is mint
   *
   * @memberof Output
   * @inner
   */
  isMint(): boolean {
    return this.isAuthority() && (this.value & TOKEN_MINT_MASK) > 0;
  }

  /**
   * Verifies if output is of melt
   *
   * @return {boolean} if output is melt
   *
   * @memberof Output
   * @inner
   */
  isMelt(): boolean {
    return this.isAuthority() && (this.value & TOKEN_MELT_MASK) > 0;
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
   * Checks if this output refers to the HTR token
   *
   * @return {boolean} True if it is HTR
   * @memberOf Output
   * @inner
   */
  isTokenHTR(): boolean {
    return this.getTokenIndex() === -1;
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
    arr.push(intToBytes(this.tokenData, 1));
    arr.push(intToBytes(this.script.length, 2));
    arr.push(this.script);
    return arr;
  }

  parseScript(network: Network): P2PKH | P2SH | ScriptData | null {
    this.decodedScript = utilsParseScript(this.script, network);
    return this.decodedScript;
  }

  /**
   * Create output object from bytes
   *
   * @param {Buffer} buf Buffer with bytes to get output fields
   * @param {Network} network Network to get output addresses first byte
   *
   * @return {[Output, Buffer]} Created output and rest of buffer bytes
   * @memberof Output
   * @static
   * @inner
   */
  static createFromBytes(buf: Buffer, network: Network): [Output, Buffer] {
    // Cloning buffer so we don't mutate anything sent by the user
    let outputBuffer = _.clone(buf);
    let value;
    let tokenData;
    let scriptLen;
    let script;

    /* eslint-disable prefer-const -- To split these declarations would be confusing.
     * In all of them the first parameter should be a const and the second a let. */
    // Value
    [value, outputBuffer] = bytesToOutputValue(outputBuffer);

    // Token data
    [tokenData, outputBuffer] = unpackToInt(1, false, outputBuffer);

    // Script
    [scriptLen, outputBuffer] = unpackToInt(2, false, outputBuffer);

    [script, outputBuffer] = unpackLen(scriptLen, outputBuffer);
    /* eslint-enable prefer-const */

    const output = new Output(value, script, { tokenData });
    output.parseScript(network);

    return [output, outputBuffer];
  }

  /**
   * Checks if the script length is within the valid limits
   *
   * @returns {boolean} True if the script is within valid limits
   *
   * @memberof Output
   * @inner
   */
  hasValidLength(): boolean {
    // No script can have more than the maximum length
    return this.script.length <= MAXIMUM_SCRIPT_LENGTH;
  }

  /**
   * Returns the type of the output, according to the specified network
   *
   * @param {Network} network Network to get output addresses first byte
   * @returns {string} Output type
   *
   * @memberof Output
   * @inner
   */
  getType(network: Network): string {
    const decodedScript = this.decodedScript || this.parseScript(network);
    return decodedScript?.getType() || '';
  }
}

export default Output;
