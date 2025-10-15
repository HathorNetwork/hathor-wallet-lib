/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import buffer from 'buffer';
import { clone } from 'lodash';
import {
  CREATE_TOKEN_TX_VERSION,
  MAX_TOKEN_NAME_SIZE,
  MAX_TOKEN_SYMBOL_SIZE,
  DEFAULT_SIGNAL_BITS,
} from '../constants';
import { unpackToInt, unpackLen, intToBytes } from '../utils/buffer';
import Input from './input';
import Output from './output';
import Transaction from './transaction';
import Network from './network';
import { CreateTokenTxInvalid, InvalidOutputsError, NftValidationError } from '../errors';
import ScriptData from './script_data';
import { OutputType } from '../wallet/types';
import { TokenVersion } from '../types';
import type Header from '../headers/base';

type optionsType = {
  signalBits?: number;
  weight?: number;
  nonce?: number;
  timestamp?: number | null;
  parents?: string[];
  tokens?: string[];
  hash?: string | null;
  headers?: Header[];
  tokenVersion?: TokenVersion;
};

class CreateTokenTransaction extends Transaction {
  name: string;

  symbol: string;

  tokenVersion: TokenVersion;

  constructor(
    name: string,
    symbol: string,
    inputs: Input[],
    outputs: Output[],
    options: optionsType = {}
  ) {
    const defaultOptions: optionsType = {
      signalBits: DEFAULT_SIGNAL_BITS,
      weight: 0,
      nonce: 0,
      timestamp: null,
      parents: [],
      tokens: [],
      hash: null,
      headers: [],
      tokenVersion: TokenVersion.DEPOSIT, // Default to version 1 for backward compatibility
    };
    const newOptions = Object.assign(defaultOptions, options);

    super(inputs, outputs, newOptions);
    this.version = CREATE_TOKEN_TX_VERSION;
    this.name = name;
    this.symbol = symbol;
    this.tokenVersion = newOptions.tokenVersion!;
  }

  /**
   * Serialize funds fields
   * signal bits, version, len inputs, len outputs, inputs, outputs and token info
   *
   * @param {Buffer[]} array Array of buffer to push the serialized fields
   * @param {boolean} addInputData If should add input data when serializing it
   *
   * @memberof Transaction
   * @inner
   */
  serializeFundsFields(array: Buffer[], addInputData: boolean) {
    // Signal bits
    array.push(intToBytes(this.signalBits, 1));

    // Tx version
    array.push(intToBytes(this.version, 1));

    // Funds len and fields
    this.serializeFundsFieldsLen(array);
    this.serializeInputsOutputs(array, addInputData);

    // Create token tx need to add extra information
    this.serializeTokenInfo(array);
  }

  /**
   * Serialize create token tx info to bytes
   *
   * @param {Buffer[]} array of bytes
   * @memberof Transaction
   * @inner
   */
  serializeTokenInfo(array: Buffer[]) {
    if (!this.name || !this.symbol) {
      throw new CreateTokenTxInvalid(
        'Token name and symbol are required when creating a new token'
      );
    }

    if (this.name.length > MAX_TOKEN_NAME_SIZE) {
      throw new CreateTokenTxInvalid(
        `Token name size is ${this.name.length} but maximum size is ${MAX_TOKEN_NAME_SIZE}`
      );
    }

    if (this.symbol.length > MAX_TOKEN_SYMBOL_SIZE) {
      throw new CreateTokenTxInvalid(
        `Token symbol size is ${this.symbol.length} but maximum size is ${MAX_TOKEN_SYMBOL_SIZE}`
      );
    }

    const nameBytes = buffer.Buffer.from(this.name, 'utf8');
    const symbolBytes = buffer.Buffer.from(this.symbol, 'utf8');
    // Token info version
    array.push(intToBytes(this.tokenVersion, 1));
    // Token name size
    array.push(intToBytes(nameBytes.length, 1));
    // Token name
    array.push(nameBytes);
    // Token symbol size
    array.push(intToBytes(symbolBytes.length, 1));
    // Token symbol
    array.push(symbolBytes);
  }

  getTokenInfoFromBytes(srcBuf: Buffer): Buffer {
    let tokenVersion;
    let lenName;
    let lenSymbol;
    let bufName;
    let bufSymbol;
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    /* eslint-disable prefer-const -- To split these declarations into const + let would be confusing */
    [tokenVersion, buf] = unpackToInt(1, false, buf);

    // Validate that the version is within the known enum values
    const validVersions = new Set([TokenVersion.DEPOSIT, TokenVersion.FEE]);
    if (!(tokenVersion in validVersions)) {
      throw new CreateTokenTxInvalid(`Invalid token version: ${tokenVersion}`);
    }

    this.tokenVersion = tokenVersion as TokenVersion;

    [lenName, buf] = unpackToInt(1, false, buf);

    if (lenName > MAX_TOKEN_NAME_SIZE) {
      throw new CreateTokenTxInvalid(
        `Token name size is ${lenName} but maximum size is ${MAX_TOKEN_NAME_SIZE}`
      );
    }

    [bufName, buf] = unpackLen(lenName, buf);
    this.name = bufName.toString('utf-8');

    [lenSymbol, buf] = unpackToInt(1, false, buf);

    if (lenSymbol > MAX_TOKEN_SYMBOL_SIZE) {
      throw new CreateTokenTxInvalid(
        `Token symbol size is ${lenSymbol} but maximum size is ${MAX_TOKEN_SYMBOL_SIZE}`
      );
    }

    [bufSymbol, buf] = unpackLen(lenSymbol, buf);
    this.symbol = bufSymbol.toString('utf-8');
    /* eslint-enable prefer-const */

    return buf;
  }

  /**
   * Gets funds fields (signalBits, version, inputs, outputs) from bytes
   * and saves them in `this`
   *
   * @param srcBuf Buffer with bytes to get fields
   * @param network Network to get output addresses first byte
   *
   * @return Rest of buffer after getting the fields
   * @memberof CreateTokenTransaction
   * @inner
   */
  getFundsFieldsFromBytes(srcBuf: Buffer, network: Network): Buffer {
    // Copies buffer locally, not to change the original parameter
    let buf = Buffer.from(srcBuf);

    // Signal bits
    [this.signalBits, buf] = unpackToInt(1, false, buf);

    // Tx version
    [this.version, buf] = unpackToInt(1, false, buf);

    let lenInputs;
    let lenOutputs;

    // Len inputs
    // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
    [lenInputs, buf] = unpackToInt(1, false, buf);

    // Len outputs
    // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
    [lenOutputs, buf] = unpackToInt(1, false, buf);

    // Inputs array
    for (let i = 0; i < lenInputs; i++) {
      let input;
      [input, buf] = Input.createFromBytes(buf);
      this.inputs.push(input);
    }

    // Outputs array
    for (let i = 0; i < lenOutputs; i++) {
      let output;
      [output, buf] = Output.createFromBytes(buf, network);
      this.outputs.push(output);
    }

    return buf;
  }

  /**
   * Create transaction object from bytes
   *
   * @param {Buffer} buf Buffer with bytes to get transaction fields
   * @param {Network} network Network to get output addresses first byte
   *
   * @return {CreateTokenTransaction} Transaction object
   * @memberof CreateTokenTransaction
   * @static
   * @inner
   */
  static createFromBytes(buf: Buffer, network: Network): CreateTokenTransaction {
    const tx = new CreateTokenTransaction('', '', [], []);

    // Cloning buffer so we don't mutate anything sent by the user
    // as soon as it's available natively we should use an immutable buffer
    let txBuffer = clone(buf);

    txBuffer = tx.getFundsFieldsFromBytes(txBuffer, network);
    txBuffer = tx.getTokenInfoFromBytes(txBuffer);
    txBuffer = tx.getGraphFieldsFromBytes(txBuffer);
    tx.getHeadersFromBytes(txBuffer, network);

    tx.updateHash();

    return tx;
  }

  /**
   * Checks if this transaction is the creation of an NFT following the NFT Standard Creation.
   * @see https://github.com/HathorNetwork/rfcs/blob/master/text/0032-nft-standard.md#transaction-standard
   * @throws {NftValidationError} Will throw an error if the NFT is not valid
   *
   * @param {Network} network Network to get output addresses first byte
   * @returns {void} If this function does not throw, the NFT is valid
   */
  validateNft(network: Network): void {
    // An invalid transaction will fail here too
    this.validate();

    // No need to check the tx version, it is enforced by the class constructor

    /*
     * NFT creation must have at least a DataScript output (the first one) and a Token P2PKH output.
     * Also validating maximum outputs of transactions in general
     */
    if (this.outputs.length < 2) {
      throw new NftValidationError(`Tx has less than the minimum required amount of outputs`);
    }

    // Validating the first output
    const firstOutput = this.outputs[0];

    // NFT creation DataScript output must have value 1 and must be of HTR
    if (firstOutput.value !== 1n || !firstOutput.isTokenHTR()) {
      throw new NftValidationError(`First output is not a valid NFT data output`);
    }
    // NFT creation Datascript must be of type data
    if (!(firstOutput.parseScript(network) instanceof ScriptData)) {
      throw new NftValidationError(`First output is not a DataScript`);
    }

    // Iterating on all but the first output for validation and counting authorities
    let mintOutputs = 0;
    let meltOutputs = 0;
    for (let index = 1; index < this.outputs.length; ++index) {
      const output = this.outputs[index];

      // Must have a valid length
      if (!output.hasValidLength()) {
        throw new InvalidOutputsError(`Output at index ${index} script is too long.`);
      }

      // Ensuring the type of the output is valid
      const validTypes = [OutputType.P2PKH.toString(), OutputType.P2SH.toString()];
      const outputType = output.getType(network)?.toLowerCase() || '';
      if (!validTypes.includes(outputType)) {
        throw new NftValidationError(`Output at index ${index} is not of a valid type`);
      }

      // Counting authority outputs
      mintOutputs += output.isMint() ? 1 : 0;
      meltOutputs += output.isMelt() ? 1 : 0;
    }

    // Validating maximum of 1 mint and/or melt outputs
    if (mintOutputs > 1 || meltOutputs > 1) {
      throw new NftValidationError('A maximum of 1 of each mint and melt is allowed');
    }
  }
}

export default CreateTokenTransaction;
