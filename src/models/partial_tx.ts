/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get } from 'lodash';

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
  tokenData: number;
  value: number;
  address: string;

  constructor(
    hash: string,
    index: number,
    value: number,
    address: string,
    {
      token = HATHOR_TOKEN_CONFIG.uid,
      tokenData = 0,
    }: {
      token?: string;
      tokenData?: number,
    } = {},
  ) {
    super(hash, index);
    this.value = value;
    this.tokenData = tokenData;
    this.token = token;
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
    const data: InputData = {
      tx_id: this.hash,
      index: this.index,
      address: this.address,
    };

    return data;
  }

  isAuthority(): boolean {
    return (this.tokenData & TOKEN_AUTHORITY_MASK) > 0;
  }
}

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
  constructor(
    value: number,
    script: Buffer,
    {
      isChange = false,
      token = HATHOR_TOKEN_CONFIG.uid,
      tokenData = 0,
    }: {
      token?: string,
      isChange?: boolean,
      tokenData?: number,
    } = {},
  ) {
    super(value, script, { tokenData });
    this.token = token;
    this.isChange = isChange;
  }

  /**
   * Set the value of the property tokenData
   *
   * @param {number} tokenData
   */
  setTokenData(tokenData: number) {
    this.tokenData = tokenData;
  }

  /**
   * Return an object with the relevant output data
   *
   * @param {number} tokenIndex Index of the token on the tokens array plus 1 (0 meaning HTR)
   * @param {Network} network Network used to generate addresses in
   *
   * @returns {OutputData}
   *
   * @throws {UnsupportedScriptError} Script must be P2SH or P2PKH
   * @memberof ProposalOutput
   * @inner
   */
  toData(tokenIndex: number, network: Network): OutputData {
    const script = this.parseScript(network);
    if (!(script instanceof P2PKH || script instanceof P2SH)) {
      throw new UnsupportedScriptError('Unsupported script type');
    }

    const authority = this.tokenData & TOKEN_AUTHORITY_MASK;

    // This will keep authority bit while updating the index bits
    this.setTokenData(authority | tokenIndex);

    const data: OutputData = {
      type: script.getType(),
      value: this.value,
      tokenData: this.tokenData,
      address: script.address.base58,
    };
    if (script.timelock) {
      data.timelock = script.timelock;
    }

    return data
  }
}

export const PartialTxPrefix = 'PartialTx';
/**
 * This class purpose is to hold and modify the state of the partial transaction.
 * It is also used to serialize and deserialize the partial transaction state.
 */
export class PartialTx {

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
   * @returns {TxData}
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
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

    const data = {
      tokens,
      inputs: this.inputs.map(i => i.toData()),
      outputs: this.outputs.map(o => o.toData(tokens.indexOf(o.token)+1, this.network)),
    };

    transaction.completeTx(data);

    return data;
  }

  /**
   * Create a Transaction instance from the PartialTx.
   *
   * @returns {Transaction}
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
   * @memberof PartialTx
   * @inner
   */
  getTx(): Transaction {
    return helpers.createTxFromData(this.getTxData(), this.network);
  }

  /**
   * Calculate balance for all tokens from inputs and outputs.
   *
   * @returns {Record<string, {inputs: number, outputs: number}}
   * @memberof PartialTx
   * @inner
   */
  calculateTokenBalance(): Record<string, {inputs: number, outputs: number}> {
    const tokenBalance: Record<string, {inputs: number, outputs: number}> = {};
    for (const input of this.inputs) {
      if (!tokenBalance[input.token]) {
        tokenBalance[input.token] = {inputs: 0, outputs: 0};
      }

      // Ignore authority inputs for token balance
      if (!input.isAuthority()) {
        tokenBalance[input.token].inputs += input.value;
      }
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
   * @returns {boolean}
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
   *
   * @param {string} txId The transaction id of the UTXO.
   * @param {number} index The index of the UTXO.
   * @param {number} value Value of the UTXO.
   * @param {number} tokenData The token data of the utxo with at least the authority bit.
   * @param {string} address base58 address
   * @param {Object} [options]
   * @param {string} [options.token='00'] The token UID.
   *
   * @memberof PartialTx
   * @inner
   */
  addInput(
    txId: string,
    index: number,
    value: number,
    address: string,
    {
      token = HATHOR_TOKEN_CONFIG.uid,
      tokenData = 0,
    }: {
      token?: string;
      tokenData?: number;
    } = {},
  ) {
    this.inputs.push(new ProposalInput(txId, index, value, address, { token, tokenData }));
  }


  /**
   * Add an output to the PartialTx.
   *
   * @param {number} value The amount of tokens on the output.
   * @param {Buffer} script The output script.
   * @param {number} tokenData The token data of the output with at least the authority bit.
   * @param {Object} [options]
   * @param {string} [options.token='00'] The token UID.
   * @param {boolean|null} [options.isChange=false] isChange If this is a change output.
   *
   * @memberof PartialTx
   * @inner
   */
  addOutput(
    value: number,
    script: Buffer,
    {
      token = HATHOR_TOKEN_CONFIG.uid,
      tokenData = 0,
      isChange = false,
    }: {
      token?: string,
      isChange?: boolean,
      tokenData?: number,
    } = {},
  ) {
    this.outputs.push(new ProposalOutput(
      value,
      script,
      { token, tokenData, isChange },
    ));
  }

  /**
   * Serialize the current PartialTx into an UTF8 string.
   *
   * The serialization will join 4 parts:
   * - Fixed prefix
   * - transaction: in hex format
   * - inputs metadata: a colon-separated list of address, token, tokenData and value
   * - outputs metadata: change outputs indexes
   *
   * Example: PartialTx|00010102...ce|W...vjPi,00,0,1b:W...vjPi,0000389...8c,1,d|1:2
   * Obs: ellipsis were used to abreviate long parts, there are no ellipsis on the serialized string
   *
   *
   * @returns {string}
   *
   * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
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
    // tokenData(1 byte), token(32 bytes | 1 byte), value(variable bytes with max 16)
    const inputArr = this.inputs.map(i => [
        i.address,
        i.token,
        i.tokenData.toString(16),
        i.value.toString(16),
      ].join(','));
    const arr = [
      PartialTxPrefix,
      tx.toHex(),
      inputArr.join(':'),
      changeOutputs.map(o => o.toString(16)).join(':'), // array of change outputs
    ];
    return arr.join('|');
  }

  /**
   * Deserialize and create an instance of PartialTx
   *
   * @param {string} serialized The serialized PartialTx
   * @param {Network} network Network used when parsing the output scripts
   *
   * @returns {PartialTx}
   *
   * @throws {SyntaxError} serialized argument should be valid.
   * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
   * @memberof PartialTx
   * @static
   */
  static deserialize(serialized: string, network: Network): PartialTx {

    const dataArr = serialized.split('|');
    const txHex = dataArr[1];

    if (dataArr.length !== 4 || dataArr[0] !== PartialTxPrefix) {
      throw new SyntaxError('Invalid PartialTx');
    }

    const inputArr = dataArr[2] && dataArr[2].split(':').map(h => {
      const parts = h.split(',');
      const meta = {
        address: parts[0],
        token: parts[1],
        tokenData: parseInt(parts[2], 16),
        value: parseInt(parts[3], 16)
      };
      if (isNaN(meta.value) || isNaN(meta.tokenData)) {
        throw new SyntaxError('Invalid PartialTx');
      }
      return meta;
    }) || [];
    const changeOutputs = dataArr[3].split(':').map(x => parseInt(x, 16));

    const tx = helpers.createTxFromHex(txHex, network);

    const instance = new PartialTx(network);

    for (const [index, input] of tx.inputs.entries()) {
      const inputMeta = inputArr[index];
      instance.addInput(
        input.hash,
        input.index,
        inputMeta.value,
        inputMeta.address,
        { token: inputMeta.token, tokenData: inputMeta.tokenData },
      );
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
        { token, tokenData: output.tokenData, isChange: changeOutputs.indexOf(index) > -1 },
      );
    }

    return instance;

  }

  /**
   * Check the content of the current PartialTx with the fullnode
   *
   * @returns {Promise<boolean>}
   */
  async validate(): Promise<boolean> {
    const promises: Promise<boolean>[] = [];

    for (const input of this.inputs) {
      const p: Promise<boolean> = new Promise((resolve, reject) => {
        txApi.getTransaction(input.hash, (data) => {
          const utxo = get(data, `tx.outputs[${input.index}]`);
          if (!utxo) {
            return resolve(false);
          }

          const token = utxo.token_data === 0 ? HATHOR_TOKEN_CONFIG : get(data, `tx.tokens[${utxo.token_data - 1}]`);

          return resolve((
            input.token === token.uid
            && input.value === utxo.value
            && input.tokenData === utxo.token_data
            && input.address === utxo.decoded.address
          ));
        })
        .then(result => {
          // should have already resolved
          reject(new Error('API client did not use the callback'));
        })
        .catch(err => reject(err));
      });
      promises.push(p);
    }

    // Check that every promise returns true
    return Promise.all(promises).then(responses => {
      return responses.every(x => x);
    });
  }
}

export const PartialTxInputDataPrefix = 'PartialTxInputData';

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
   * @returns {boolean}
   * @memberof PartialTxInputData
   * @inner
   */
  isComplete(): boolean {
    return Object.values(this.data).length === this.inputsLen;
  }

  /**
   * Serialize the current PartialTxInputData into an UTF8 string.
   *
   * The serialization will join 3 informations:
   * - Fixed prefix
   * - hash: to identify the transaction which these signatures belong to
   * - inputs data: index and data
   *
   * Example: PartialTxInputData|000ca...fe|0:00abc|1:00123
   * Obs: ellipsis is used to abreviate, there are no ellipsis on the serialized string
   *
   * @returns {string}
   * @memberof PartialTxInputData
   * @inner
   */
  serialize(): string {
    const arr = [PartialTxInputDataPrefix, this.hash];
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
    if (arr.length < 2 || arr[0] != PartialTxInputDataPrefix || arr[1] !== this.hash) {
      // Only the first 2 parts are required
      // The third onward are the signatures, which can be an empty array
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
