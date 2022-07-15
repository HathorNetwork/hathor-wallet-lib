/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MAX_OUTPUT_VALUE_32, MAX_OUTPUT_VALUE, TOKEN_AUTHORITY_MASK, TOKEN_MINT_MASK, TOKEN_MELT_MASK, TOKEN_INDEX_MASK } from '../constants';
import { OutputValueError, ParseError } from '../errors';
import helpers from '../utils/helpers';
import P2PKH from './p2pkh';
import P2SH from './p2sh';
import ScriptData from './script_data';
import Network from './network';
import { unpackToInt, unpackLen, bytesToOutputValue } from '../utils/buffer';
import { parseP2PKH, parseP2SH, parseScriptData } from '../utils/scripts';
import _ from 'lodash';

type optionsType = {
  tokenData?: number | undefined,
  // FIXME: Timelock as an option is not used, it is extracted from the decoded script.
  timelock?: number | null | undefined,
};


class Output {
  // Output value as an integer
  value: number;
  // tokenData of the output
  tokenData: number;
  // Output script
  script: Buffer;
  // Decoded output script
  decodedScript: P2PKH | P2SH | ScriptData | null;

  constructor(value: number, script: Buffer, options: optionsType = {}) {
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
    arr.push(helpers.intToBytes(this.script.length, 2));
    arr.push(this.script);
    return arr;
  }

  parseScript(network: Network): P2PKH | P2SH | ScriptData | null {
    // It's still unsure how expensive it is to throw an exception in JavaScript. Some languages are really
    // inefficient when it comes to exceptions while others are totally efficient. If it is efficient,
    // we can keep throwing the error. Otherwise, we should just return null
    // because this method will be used together with others when we are trying to parse a given script.

    try {
      let parsedScript;
      if (P2PKH.identify(this.script)) {
        // This is a P2PKH script
        parsedScript = parseP2PKH(this.script, network);
      } else if (P2SH.identify(this.script)) {
        // This is a P2SH script
        parsedScript = parseP2SH(this.script, network);
      } else {
        // defaults to data script
        parsedScript = parseScriptData(this.script);
      }
      this.decodedScript = parsedScript;
      return parsedScript;
    } catch (error) {
      if (error instanceof ParseError) {
        // We don't know how to parse this script
        return null;
      } else {
        throw error;
      }
    }
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
    let value, tokenData, scriptLen, script;

    // Value
    [value, outputBuffer] = bytesToOutputValue(outputBuffer);

    // Token data
    [tokenData, outputBuffer] = unpackToInt(1, false, outputBuffer);

    // Script
    [scriptLen, outputBuffer] = unpackToInt(2, false, outputBuffer);

    [script, outputBuffer] = unpackLen(scriptLen, outputBuffer);

    const output = new Output(value, script, {tokenData});
    output.parseScript(network);

    return [output, outputBuffer];
  }
}

export default Output;
