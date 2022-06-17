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
  address?: string,
  data: Buffer,
};

type OutputData = {
  type: string,
  value: number,
  tokenData: number,
  address?: string,
  data?: string,
  timelock?: number,
};

type TxData = {
  inputs: InputData[],
  outputs: OutputData[],
  tokens: string[],
  weight?: number,
  nonce?: number,
  version?: number,
  timestamp?: number,
};

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
  toData() {
    return {
      tx_id: this.hash,
      index: this.index,
      data: Buffer.from([]),
      address: this.address,
    };
  }
}

export class ProposalOutput extends Output {
  token: string;
  isChange: Boolean;

  /**
   * We do not set tokenData because the token array is not yet formed
   */
  constructor(value: number, script: Buffer, token: string, isChange: Boolean) {
    super(value, script);
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
  toData(tokenData: number, network: Network) {
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
 * This class purpose is serialization/deserialization of signatures from a MultiSig participant
 * The structure of the serialized signature string is:
 * "<pubkey>|<index>:<signature>|<index>:<signature>|..."
 *
 * The `pubkey` is required so we can identify the original signer (and his position on the redeemScript)
 * The `<index>:<signature>` pair is the input index and the signature for that input.
 * The signature is formatted to DER and hex encoded.
 *
 * With this information we will be able to encode the signatures for all inputs on one string.
 * It also has all information needed to assemble the input data if you have enough participants' P2SHSignature serialized signatures.
 */
export class PartialTx {
  inputs: ProposalInput[];
  outputs: ProposalOutput[];
  network: Network;

  constructor(network?: Network) {
    this.inputs = [];
    this.outputs = [];
    this.network = network || new Network('mainnet');
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
  getTxData() {
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

    const data = {
      inputs: this.inputs.map(i => i.toData()),
      outputs: this.outputs.map(o => o.toData(tokens.indexOf(o.token)+1, this.network)),
      tokens
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
  getTx() {
    return helpers.createTxFromData(this.getTxData(), this.network);
  }

  /**
   * Calculate balance for all tokens from inputs and outputs.
   *
   * @return {Record<string, number>}
   * @memberof PartialTx
   * @inner
   */
  calculateTokenBalance() {
    const tokenBalance: Record<string, Record<string, number>> = {};
    for (const input of this.inputs) {
      if (!(input.token in tokenBalance)) {
        tokenBalance[input.token] = {inputs: 0, outputs: 0};
      }
      tokenBalance[input.token].inputs += input.value;
    }

    for (const output of this.outputs) {
      if (!(output.token in tokenBalance)) {
        tokenBalance[output.token] = {inputs: 0, outputs: 0};
      }

      tokenBalance[output.token].outputs += output.value;
    }

    return tokenBalance;
  }

  /**
   * Return true if the balance of the outputs match the balance of the inputs for all tokens.
   *
   * @return {Boolean}
   * @memberof PartialTx
   * @inner
   */
  isComplete() {
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
  async addInput(txId: string, index: number) {
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
   * @param {Boolean} isChange If this is a change output.
   *
   * @memberof PartialTx
   * @inner
   */
  addOutput(value: number, script: Buffer, token: string, isChange: Boolean) {
    this.outputs.push(new ProposalOutput(
      value,
      script,
      token,
      isChange,
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
  serialize() {
    const changeOutputs: number[] = [];
    this.outputs.forEach((output, index) => {
      if (output.isChange) {
        changeOutputs.push(index);
      }
    });
    const tx = this.getTx();
    const arr = ['PartialTx', tx.toHex(), changeOutputs.join('|')];
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
  static async deserialize(serialized: string, network: Network) {
    const netw = network || new Network('mainnet');

    const dataArr = serialized.split('|');
    const changeOutputs = dataArr.slice(2).map(x => +x);

    if (dataArr.length < 2 || dataArr[0] !== 'PartialTx' || !changeOutputs.every(x => Number.isInteger(x))) {
      throw new SyntaxError('Invalid PartialTx');
    }

    const txHex = dataArr[1];
    const tx = helpers.createTxFromHex(txHex, netw);

    const instance = new PartialTx(netw);

    for (const input of tx.inputs) {
      await instance.addInput(input.hash, input.index);
    }

    for (const [index, output] of tx.outputs.entries()) {
      // validate script
      const script = output.parseScript(netw);
      if (!(script instanceof P2PKH || script instanceof P2SH)) {
        throw new UnsupportedScriptError('Unsupported script type');
      }

      if (output.isAuthority()) {
        // TODO: we dont allow passing authority on atomic swap?
        throw new Error('Authority outputs are unsupported');
      }

      const tokenIndex = output.tokenData & TOKEN_INDEX_MASK;
      const token = tokenIndex === 0 ? HATHOR_TOKEN_CONFIG.uid : tx.tokens[tokenIndex-1];
      instance.addOutput(
        output.value,
        output.script,
        token,
        changeOutputs.indexOf(index) > -1,
      );
    }

    return instance;

  }
}

export class PartialTxInputData {
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
   * @return {Boolean}
   * @memberof PartialTxInputData
   * @inner
   */
  isComplete() {
    return Object.values(this.data).length === this.inputsLen;
  }

  /**
   * Serialize the current PartialTxInputData into an UTF8 string.
   *
   * @returns {string}
   * @memberof PartialTxInputData
   * @inner
   */
  serialize() {
    const arr = ['PartialTxInputData', this.hash];
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
