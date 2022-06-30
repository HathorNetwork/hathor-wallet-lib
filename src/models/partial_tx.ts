/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Input from './input';
import Output from './output';
import Address from './address';
import Transaction from './transaction';
import Network from './network';

import P2PKH from './p2pkh';
import P2SH from './p2sh';
import ScriptData from './script_data';

import transaction from '../transaction';
import helpers from '../utils/helpers';
import { IndexOOBError, UnsupportedScriptError } from '../errors';

import txApi from '../api/txApi';
import { TOKEN_AUTHORITY_MASK, TOKEN_INDEX_MASK, HATHOR_TOKEN_CONFIG } from '../constants';

type InputData = {
  tx_id: string,
  index: number,
  address: string,
  data?: Buffer,
};

type OutputData = {
  type: string,
  value: number,
  tokenData: number,
  address?: string,
  data?: string,
  timelock?: number,
};

// Transaction data to use with helpers
type TxData = {
  inputs: InputData[],
  outputs: OutputData[],
  tokens: string[],
  weight?: number,
  nonce?: number,
  version?: number,
  timestamp?: number,
};

/**
 * Extended version of the Input class with extra data
 * We need the extra data to calculate the balance of the PartialTx
 */
export class ProposalInput extends Input {
  token: string;
  value: number;
  address: string;

  constructor(hash: string, index: number, token: string, value: number, address: string) {
    super(hash, index);
    this.token = token;
    this.value = value;
    this.address = address;
  }

  /**
   * Return an object with the relevant input data
   *
   * @return {InputData}
   * @memberof ProposalInput
   * @inner
   */
  toData(): InputData {
    return {
      tx_id: this.hash,
      index: this.index,
      address: this.address,
    };
  }
}

type outputOptionsType = {
  tokenData?: number | undefined;
  timelock?: number | null | undefined;
};

/**
 * Extended version of the Output class with extra data
 * We need the extra data to calculate the token_data of the
 * output on the final transaction and to track which outputs are change.
 */
export class ProposalOutput extends Output {
  token: string;
  isChange: boolean;

  /**
   * We do not set tokenData because the token array is not yet formed
   */
  constructor(value: number, script: Buffer, token: string, isChange: boolean, options: outputOptionsType = {}) {
    super(value, script, options);
    this.token = token;
    this.isChange = isChange;
  }

  setTokenData(tokenData: number) {
    this.tokenData = tokenData;
  }

  /**
   * Return an object with the relevant output data
   *
   * @throws {UnsupportedScriptError} Script must be P2SH or P2PKH
   *
   * @return {OutputData}
   * @memberof ProposalOutput
   * @inner
   */
  toData(tokenData: number, network: Network): OutputData {
    const script = this.parseScript(network);
    if (!(script instanceof P2PKH || script instanceof P2SH)) {
      throw new UnsupportedScriptError('Unsupported script type');
    }

    this.setTokenData(tokenData);

    const data: OutputData = {
      type: script.getType(),
      value: this.value,
      tokenData: tokenData,
      address: script.address.base58,
    };
    if (script.timelock) {
      data.timelock = script.timelock;
    }

    return data
  }
}

/**
 * This class purpose is to hold and modify the state of the partial transaction.
 * It is also used to serialize and deserialize the partial transaction state.
 */
export class PartialTx {
  static prefix: string = 'PartialTx';

  inputs: ProposalInput[];
  outputs: ProposalOutput[];
  network: Network;

  constructor(network: Network) {
    this.inputs = [];
    this.outputs = [];
    this.network = network;
  }

  /**
   * Convert the PartialTx into a complete TxData ready to be signed or serialized.
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
   *
   * @return {TxData}
   * @memberof PartialTx
   * @inner
   */
  getTxData(): TxData {
    const tokenSet = new Set<string>();
    for (const output of this.outputs) {
      tokenSet.add(output.token);
    }
    for (const input of this.inputs) {
      tokenSet.add(input.token);
    }

    // Remove HTR from tokens array
    tokenSet.delete(HATHOR_TOKEN_CONFIG.uid);
    const tokens = Array.from(tokenSet);

    // The outputs tokenData will be recalculated maintaining the authority bit
    const data = {
      tokens,
      inputs: this.inputs.map(i => i.toData()),
      outputs: this.outputs.map(o => o.toData(
        (o.tokenData & TOKEN_AUTHORITY_MASK) | tokens.indexOf(o.token)+1,
        this.network
      )),
    };

    transaction.completeTx(data);

    return data;
  }

  /**
   * Create a Transaction instance from the PartialTx.
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
   *
   * @return {Transaction}
   * @memberof PartialTx
   * @inner
   */
  getTx(): Transaction {
    return helpers.createTxFromData(this.getTxData(), this.network);
  }

  /**
   * Calculate balance for all tokens from inputs and outputs.
   *
   * @return {Record<string, Record<string, number>>}
   * @memberof PartialTx
   * @inner
   */
  calculateTokenBalance(): Record<string, Record<string, number>> {
    const tokenBalance: Record<string, Record<string, number>> = {};
    for (const input of this.inputs) {
      if (!tokenBalance[input.token]) {
        tokenBalance[input.token] = {inputs: 0, outputs: 0};
      }
      tokenBalance[input.token].inputs += input.value;
    }

    for (const output of this.outputs) {
      if (!tokenBalance[output.token]) {
        tokenBalance[output.token] = {inputs: 0, outputs: 0};
      }

      // Ignore authority outputs for token balance
      if (!output.isAuthority()) {
        tokenBalance[output.token].outputs += output.value;
      }
    }

    return tokenBalance;
  }

  /**
   * Return true if the balance of the outputs match the balance of the inputs for all tokens.
   *
   * @return {boolean}
   * @memberof PartialTx
   * @inner
   */
  isComplete(): boolean {
    const tokenBalance = this.calculateTokenBalance();

    // Calculated the final balance for all tokens
    // return if all are 0
    return Object.values(tokenBalance).every(v => v.inputs === v.outputs);
  }

  /**
   * Add an UTXO as input on the PartialTx.
   * This method is async because we need to fetch information on the inputs (token, value)
   *
   * @param {string} txId The transaction id of the UTXO.
   * @param {number} index The index of the UTXO.
   *
   * @return {Promise<void>}
   * @memberof PartialTx
   * @inner
   */
  async addInput(txId: string, index: number): Promise<void> {
    // fetch token + value from txId + index
    await txApi.getTransaction(txId, (data) => {
      const utxo = data.tx.outputs[index];
      const token = utxo.token_data === 0 ? HATHOR_TOKEN_CONFIG : data.tx.tokens[utxo.token_data - 1];
      this.inputs.push(new ProposalInput(txId, index, token.uid, utxo.value, utxo.decoded.address));
    });
  }


  /**
   * Add an output to the PartialTx.
   *
   * @param {number} value The amount of tokens on the output.
   * @param {Buffer} script The output script.
   * @param {string} token The token UID.
   * @param {boolean} isChange If this is a change output.
   *
   * @memberof PartialTx
   * @inner
   */
  addOutput(
    value: number,
    script: Buffer,
    token: string,
    tokenData: number,
    isChange: boolean,
  ) {
    this.outputs.push(new ProposalOutput(
      value,
      script,
      token,
      isChange,
      { tokenData },
    ));
  }

  /**
   * Serialize the current PartialTx into an UTF8 string.
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
   *
   * @returns {string}
   * @memberof PartialTx
   * @inner
   */
  serialize(): string {
    const changeOutputs: number[] = [];
    this.outputs.forEach((output, index) => {
      if (output.isChange) {
        changeOutputs.push(index);
      }
    });
    const tx = this.getTx();
    const arr = [PartialTx.prefix, tx.toHex(), ...changeOutputs];
    return arr.join('|');
  }

  /**
   * Deserialize and create an instance of PartialTx
   * This method is async because we need to fetch information on the inputs (token, value)
   *
   * @param {string} serialized The serialized PartialTx
   * @param {Network} network Network used when parsing the output scripts
   *
   * @throws {SyntaxError} serialized argument should be valid.
   * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
   *
   * @returns {Promise<PartialTx>}
   * @memberof PartialTx
   * @static
   */
  static async deserialize(serialized: string, network: Network): Promise<PartialTx> {

    const dataArr = serialized.split('|');
    const changeOutputs = dataArr.slice(2).map(x => +x);

    if (dataArr.length < 2 || dataArr[0] !== 'PartialTx' || !changeOutputs.every(x => Number.isInteger(x))) {
      throw new SyntaxError('Invalid PartialTx');
    }

    const txHex = dataArr[1];
    const tx = helpers.createTxFromHex(txHex, network);

    const instance = new PartialTx(network);

    for (const input of tx.inputs) {
      await instance.addInput(input.hash, input.index);
    }

    for (const [index, output] of tx.outputs.entries()) {
      // validate script
      const script = output.parseScript(network);
      if (!(script instanceof P2PKH || script instanceof P2SH)) {
        throw new UnsupportedScriptError('Unsupported script type');
      }

      const tokenIndex = output.tokenData & TOKEN_INDEX_MASK;
      const token = tokenIndex === 0 ? HATHOR_TOKEN_CONFIG.uid : tx.tokens[tokenIndex-1];
      instance.addOutput(
        output.value,
        output.script,
        token,
        output.tokenData,
        changeOutputs.indexOf(index) > -1,
      );
    }

    return instance;

  }
}

/**
 * This class is meant to aggregate input data for a transaction.
 *
 * The `hash` is an identifier of the transaction (usually the dataToSign in hex format)
 * this way any input data added should identify that it is from the same transaction.
 *
 * The input data is saved instead of the signature to allow collecting from MultiSig wallets
 * since for an input we can have multiple signatures.
 */
export class PartialTxInputData {
  static prefix: string = 'PartialTxInputData';

  data: Record<number, Buffer>;
  hash: string;
  inputsLen: number;

  constructor(hash: string, inputsLen: number) {
    this.data = {};
    this.hash = hash;
    this.inputsLen = inputsLen;
  }

  /**
   * Add an input data to the record.
   *
   * @param {number} index The input index this data relates to.
   * @param {Buffer} inputData Input data bytes.
   *
   * @throws {IndexOOBError} index should be inside the inputs array.
   *
   * @memberof PartialTxInputData
   * @inner
   */
  addData(index: number, inputData: Buffer) {
    if (index >= this.inputsLen) {
      throw new IndexOOBError(`Index ${index} is out of bounds for the ${this.inputsLen} inputs`);
    }
    this.data[index] = inputData;
  }

  /**
   * Return true if we have an input data for each input.
   *
   * @return {boolean}
   * @memberof PartialTxInputData
   * @inner
   */
  isComplete(): boolean {
    return Object.values(this.data).length === this.inputsLen;
  }

  /**
   * Serialize the current PartialTxInputData into an UTF8 string.
   *
   * @returns {string}
   * @memberof PartialTxInputData
   * @inner
   */
  serialize(): string {
    const arr = [PartialTxInputData.prefix, this.hash];
    for (const [index, buf] of Object.entries(this.data)) {
      arr.push(`${index}:${buf.toString('hex')}`);
    }
    return arr.join('|');
  }

  /**
   * Deserialize the PartialTxInputData and merge with local data.
   *
   * @param {string} serialized The serialized PartialTxInputData
   *
   * @throws {SyntaxError} serialized argument should be valid.
   * @memberof PartialTxInputData
   * @static
   */
  addSignatures(serialized: string) {
    const arr = serialized.split('|');
    if (arr.length < 3 || arr[0] != 'PartialTxInputData' || arr[1] !== this.hash) {
      throw new SyntaxError('Invalid PartialTxInputData');
    }
    for (const part of arr.slice(2)) {
      const parts = part.split(':');
      if (parts.length !== 2) {
        throw new SyntaxError('Invalid PartialTxInputData');
      }

      // This may overwrite an input data but we are allowing this
      this.data[+parts[0]] = Buffer.from(parts[1], 'hex');
    }
  }
};
