/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  CREATE_TOKEN_TX_VERSION,
  TOKEN_INFO_VERSION,
  MAX_TOKEN_NAME_SIZE,
  MAX_TOKEN_SYMBOL_SIZE,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK
} from '../constants'
import { util } from 'bitcore-lib';
import { unpackToInt, unpackLen } from '../utils/buffer';
import helpers from '../utils/helpers';
import Input from './input';
import Output from './output';
import Transaction, {HistoryTransaction} from './transaction'
import Network from './network';
import { CreateTokenTxInvalid, InvalidOutputsError, NftValidationError } from '../errors';
import buffer from 'buffer';
import { clone } from 'lodash';
import ScriptData from "./script_data";
import {OutputType} from "../wallet/types";

type optionsType = {
  weight?: number,
  nonce?: number,
  timestamp?: number | null,
  parents?: string[],
  tokens?: string[],
  hash?: string | null,
};


class CreateTokenTransaction extends Transaction {
  name: string;
  symbol: string;

  constructor(name: string, symbol: string, inputs: Input[], outputs: Output[], options: optionsType = {}) {
    const defaultOptions: optionsType = {
      weight: 0,
      nonce: 0,
      timestamp: null,
      parents: [],
      tokens: [],
      hash: null,
    };
    const newOptions = Object.assign(defaultOptions, options);

    super(inputs, outputs, newOptions);
    this.version = CREATE_TOKEN_TX_VERSION;
    this.name = name;
    this.symbol = symbol;
  }

  /**
   * Return transaction data to sign in inputs
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  getDataToSign(): Buffer {
    if (this._dataToSignCache !== null) {
      return this._dataToSignCache!;
    }

    let arr: any[] = []
    this.serializeFundsFields(arr, false);

    this._dataToSignCache = util.buffer.concat(arr);
    return this._dataToSignCache!;
  }

  /**
   * Serialize tx to bytes
   *
   * @return {Buffer}
   * @memberof Transaction
   * @inner
   */
  toBytes(): Buffer {
    let arr: any = []
    // Serialize first the funds part
    //
    this.serializeFundsFields(arr, true);

    // Graph fields
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);

    return util.buffer.concat(arr);
  }

  /**
   * Serialize funds fields
   * version, len inputs, len outputs, inputs, outputs and token info
   *
   * @param {Buffer[]} array Array of buffer to push the serialized fields
   * @param {boolean} addInputData If should add input data when serializing it
   *
   * @memberof Transaction
   * @inner
   */
  serializeFundsFields(array: Buffer[], addInputData: boolean) {
    // Tx version
    array.push(helpers.intToBytes(this.version, 2))

    // Funds len and fields
    this.serializeFundsFieldsLen(array);
    this.serializeInputsOutputs(array, addInputData);

    // Create token tx need to add extra information
    this.serializeTokenInfo(array);
  }

  /**
   * Serialize create token tx info to bytes
   *
   * @return {Array} array of bytes
   * @memberof Transaction
   * @inner
   */
  serializeTokenInfo(array: Buffer[]) {
    if (!(this.name) || !(this.symbol)) {
      throw new CreateTokenTxInvalid('Token name and symbol are required when creating a new token');
    }

    if (this.name.length > MAX_TOKEN_NAME_SIZE) {
      throw new CreateTokenTxInvalid(`Token name size is ${this.name.length} but maximum size is ${MAX_TOKEN_NAME_SIZE}`);
    }

    if (this.symbol.length > MAX_TOKEN_SYMBOL_SIZE) {
      throw new CreateTokenTxInvalid(`Token symbol size is ${this.symbol.length} but maximum size is ${MAX_TOKEN_SYMBOL_SIZE}`);
    }

    const nameBytes = buffer.Buffer.from(this.name, 'utf8');
    const symbolBytes = buffer.Buffer.from(this.symbol, 'utf8');
    // Token info version
    array.push(helpers.intToBytes(TOKEN_INFO_VERSION, 1));
    // Token name size
    array.push(helpers.intToBytes(nameBytes.length, 1));
    // Token name
    array.push(nameBytes);
    // Token symbol size
    array.push(helpers.intToBytes(symbolBytes.length, 1));
    // Token symbol
    array.push(symbolBytes);
  }

  getTokenInfoFromBytes(buf: Buffer): Buffer {
    let tokenInfoVersion, lenName, lenSymbol, bufName, bufSymbol;

    [tokenInfoVersion, buf] = unpackToInt(1, false, buf);

    if (tokenInfoVersion !== TOKEN_INFO_VERSION) {
      throw new CreateTokenTxInvalid(`Unknown token info version: ${tokenInfoVersion}`);
    }

    [lenName, buf] = unpackToInt(1, false, buf);

    if (lenName > MAX_TOKEN_NAME_SIZE) {
      throw new CreateTokenTxInvalid(`Token name size is ${lenName} but maximum size is ${MAX_TOKEN_NAME_SIZE}`);
    }

    [bufName, buf] = unpackLen(lenName, buf);
    this.name = bufName.toString('utf-8');


    [lenSymbol, buf] = unpackToInt(1, false, buf);

    if (lenSymbol > MAX_TOKEN_SYMBOL_SIZE) {
      throw new CreateTokenTxInvalid(`Token symbol size is ${lenSymbol} but maximum size is ${MAX_TOKEN_SYMBOL_SIZE}`);
    }

    [bufSymbol, buf] = unpackLen(lenSymbol, buf);
    this.symbol = bufSymbol.toString('utf-8');

    return buf;
  }

  /**
   * Gets funds fields (version, inputs, outputs) from bytes
   * and saves them in `this`
   *
   * @param {Buffer} buf Buffer with bytes to get fields
   * @param {Network} network Network to get output addresses first byte
   *
   * @return {Buffer} Rest of buffer after getting the fields
   * @memberof CreateTokenTransaction
   * @inner
   */
  getFundsFieldsFromBytes(buf: Buffer, network: Network): Buffer {
    // Tx version
    [this.version, buf] = unpackToInt(2, false, buf);

    let lenInputs, lenOutputs;

    // Len inputs
    [lenInputs, buf] = unpackToInt(1, false, buf);

    // Len outputs
    [lenOutputs, buf] = unpackToInt(1, false, buf);

    // Inputs array
    for (let i=0; i<lenInputs; i++) {
      let input;
      [input, buf] = Input.createFromBytes(buf);
      this.inputs.push(input);
    }

    // Outputs array
    for (let i=0; i<lenOutputs; i++) {
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
    tx.getGraphFieldsFromBytes(txBuffer);

    tx.updateHash();

    return tx;
  }


  /**
   * Creates a Transaction instance from an instance of a wallet's history
   * @param {HistoryTransaction} historyTx A transaction formatted as an instance of a wallet history
   *
   * @memberof Transaction
   * @static
   * @inner
   *
   * @example
   * const historyTx = myHathorWallet.getTx(myTxHash);
   * const txInstance = Transaction.createFromHistoryObject(historyTx);
   */
  static createFromHistoryObject(historyTx: HistoryTransaction) {
    if (!historyTx?.token_name || !historyTx?.token_symbol) {
      throw new CreateTokenTxInvalid(`Missing token name or symbol`);
    }

    const inputs = historyTx.inputs.map(i => new Input(i.tx_id, i.index))
    const outputs = historyTx.outputs.map(Output.createFromHistoryObject);

    return new CreateTokenTransaction(
      historyTx.token_name,
      historyTx.token_symbol,
      inputs,
      outputs,
      {...historyTx});
  }

  /**
   * Checks if this transaction is the creation of an NFT following the NFT Standard Creation.
   * @see https://github.com/HathorNetwork/rfcs/blob/master/text/0032-nft-standard.md#transaction-standard
   * @throws {NftValidationError} Will throw an error if the NFT is not valid
   *
   * @param {Network} network Network to get output addresses first byte
   * @returns {void} If this function does not throw, the NFT is valid
   */
  validateNftCreation(network: Network): void {
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
    if (firstOutput.value !== 1 || !firstOutput.isTokenHTR()) {
      throw new NftValidationError(`First output is not a valid NFT fee`);
    }
    // NFT creation Datascript must be of type data
    if (!(firstOutput.parseScript(network) instanceof ScriptData)) {
      throw new NftValidationError(`First output is not a fee DataScript`)
    }

    // Iterating on all but the first output for validation and counting authorities
    let mintOutputs = 0;
    let meltOutputs = 0;
    for (let index=1; index < this.outputs.length; ++index) {
      const output = this.outputs[index];

      // Must have a valid length
      if (!output.hasValidLength()) {
        throw new InvalidOutputsError(`Output at index ${index} script is too long.`)
      }

      // Ensuring the type of the output is valid
      const validTypes = [OutputType.P2PKH.toString(), OutputType.P2SH.toString()];
      const outputType = output.getType(network)?.toLowerCase() || '';
      if (!validTypes.includes(outputType)) {
        throw new NftValidationError(`Output at index ${index} is not of a valid type`)
      }

      // Ensuring the script size for each output is correct ( must be either 25 or 30 depending on the timelock )
      if (!(output.script.length === 25 || output.script.length === 30)) {
        throw new NftValidationError(`Output at index ${index} has an invalid length`)
      }

      // Counting authority outputs
      if (output.isAuthority()) {
        mintOutputs += (output.value & TOKEN_MINT_MASK) > 0 ? 1 : 0;
        meltOutputs += (output.value & TOKEN_MELT_MASK) > 0 ? 1 : 0;
      }
    }

    // Validating maximum of 1 mint and/or melt outputs
    if (mintOutputs > 1 || meltOutputs > 1) {
      throw new NftValidationError('A maximum of 1 of each mint and melt is allowed');
    }
  }
}

export default CreateTokenTransaction;
