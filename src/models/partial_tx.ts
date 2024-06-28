/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get } from 'lodash';

import Input from './input';
import Output from './output';
import Transaction from './transaction';
import Network from './network';

import P2PKH from './p2pkh';
import P2SH from './p2sh';

import transactionUtils from '../utils/transaction';
import helpers from '../utils/helpers';
import { IndexOOBError, UnsupportedScriptError } from '../errors';

import txApi from '../api/txApi';
import {
  DEFAULT_TX_VERSION,
  NATIVE_TOKEN_UID,
  TOKEN_INDEX_MASK,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../constants';
import { IDataInput, IDataOutput, IDataTx } from '../types';

/**
 * Extended version of the Input class with extra data
 * We need the extra data to calculate the balance of the PartialTx
 */
export class ProposalInput extends Input {
  token: string;

  authorities: number;

  value: number;

  address: string;

  constructor(
    hash: string,
    index: number,
    value: number,
    address: string,
    {
      token = NATIVE_TOKEN_UID,
      authorities = 0,
    }: {
      token?: string;
      authorities?: number;
    } = {}
  ) {
    super(hash, index);
    this.value = value;
    this.authorities = authorities;
    this.token = token;
    this.address = address;
  }

  /**
   * Return an object with the relevant input data
   *
   * @return {IDataInput}
   * @memberof ProposalInput
   * @inner
   */
  toData(): IDataInput {
    const data: IDataInput = {
      txId: this.hash,
      index: this.index,
      address: this.address,
      token: this.token,
      value: this.value,
      authorities: this.authorities,
    };

    if (this.data) {
      data.data = this.data.toString('hex');
    }

    return data;
  }

  isAuthority(): boolean {
    return this.authorities > 0;
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

  authorities: number;

  constructor(
    value: number,
    script: Buffer,
    {
      isChange = false,
      token = NATIVE_TOKEN_UID,
      authorities = 0,
    }: {
      token?: string;
      isChange?: boolean;
      authorities?: number;
    } = {}
  ) {
    let tokenData = 0;
    if (authorities > 0) {
      tokenData |= TOKEN_AUTHORITY_MASK;
    }
    if (token !== NATIVE_TOKEN_UID) {
      // We set this to avoid isTokenHTR from returning true
      tokenData |= 1;
    }
    super(value, script, { tokenData });
    this.token = token;
    this.isChange = isChange;
    this.authorities = authorities;
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
   * @returns {IDataOutput}
   *
   * @throws {UnsupportedScriptError} Script must be P2SH or P2PKH
   * @memberof ProposalOutput
   * @inner
   */
  toData(tokenIndex: number, network: Network): IDataOutput {
    const script = this.parseScript(network);
    if (!(script instanceof P2PKH || script instanceof P2SH)) {
      throw new UnsupportedScriptError('Unsupported script type');
    }

    const tokenData = (this.authorities > 0 ? TOKEN_AUTHORITY_MASK : 0) | tokenIndex;

    // This will keep authority bit while updating the index bits
    this.setTokenData(tokenData);

    const data: IDataOutput = {
      type: script.getType(),
      value: this.value,
      address: script.address.base58,
      authorities: this.authorities,
      token: this.token,
      timelock: script.timelock,
    };

    return data;
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
  getTxData(): IDataTx {
    const tokenSet = new Set<string>();
    for (const output of this.outputs) {
      tokenSet.add(output.token);
    }
    for (const input of this.inputs) {
      tokenSet.add(input.token);
    }

    // Remove HTR from tokens array
    tokenSet.delete(NATIVE_TOKEN_UID);
    const tokens = Array.from(tokenSet);

    const data = {
      version: DEFAULT_TX_VERSION,
      tokens,
      inputs: this.inputs.map(i => i.toData()),
      outputs: this.outputs.map(o => o.toData(tokens.indexOf(o.token) + 1, this.network)),
    };

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
    return transactionUtils.createTransactionFromData(this.getTxData(), this.network);
  }

  /**
   * Calculate balance for all tokens from inputs and outputs.
   *
   * @returns {Record<string, {inputs: number, outputs: number}}
   * @memberof PartialTx
   * @inner
   */
  calculateTokenBalance(): Record<string, { inputs: number; outputs: number }> {
    const tokenBalance: Record<string, { inputs: number; outputs: number }> = {};
    for (const input of this.inputs) {
      if (!tokenBalance[input.token]) {
        tokenBalance[input.token] = { inputs: 0, outputs: 0 };
      }

      // Ignore authority inputs for token balance
      if (!input.isAuthority()) {
        tokenBalance[input.token].inputs += input.value;
      }
    }

    for (const output of this.outputs) {
      if (!tokenBalance[output.token]) {
        tokenBalance[output.token] = { inputs: 0, outputs: 0 };
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
   * @param {number} authorities The authority information of the utxo.
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
      token = NATIVE_TOKEN_UID,
      authorities = 0,
    }: {
      token?: string;
      authorities?: number;
    } = {}
  ) {
    this.inputs.push(new ProposalInput(txId, index, value, address, { token, authorities }));
  }

  /**
   * Add an output to the PartialTx.
   *
   * @param {number} value The amount of tokens on the output.
   * @param {Buffer} script The output script.
   * @param {number} authorities The authority information of the output.
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
      token = NATIVE_TOKEN_UID,
      authorities = 0,
      isChange = false,
    }: {
      token?: string;
      isChange?: boolean;
      authorities?: number;
    } = {}
  ) {
    this.outputs.push(new ProposalOutput(value, script, { token, authorities, isChange }));
  }

  /**
   * Serialize the current PartialTx into an UTF8 string.
   *
   * The serialization will join 4 parts:
   * - Fixed prefix
   * - transaction: in hex format
   * - inputs metadata: a colon-separated list of address, token, authorities and value
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
    const inputArr = this.inputs.map(i =>
      [i.address, i.token, i.authorities.toString(16), i.value.toString(16)].join(',')
    );
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

    const inputArr =
      (dataArr[2] &&
        dataArr[2].split(':').map(h => {
          const parts = h.split(',');
          const meta = {
            address: parts[0],
            token: parts[1],
            authorities: parseInt(parts[2], 16),
            value: parseInt(parts[3], 16),
          };
          if (Number.isNaN(meta.value) || Number.isNaN(meta.authorities)) {
            throw new SyntaxError('Invalid PartialTx');
          }
          return meta;
        })) ||
      [];
    const changeOutputs = dataArr[3].split(':').map(x => parseInt(x, 16));

    const tx = helpers.createTxFromHex(txHex, network);

    const instance = new PartialTx(network);

    for (const [index, input] of tx.inputs.entries()) {
      const inputMeta = inputArr[index];
      instance.addInput(input.hash, input.index, inputMeta.value, inputMeta.address, {
        token: inputMeta.token,
        authorities: inputMeta.authorities,
      });
    }

    for (const [index, output] of tx.outputs.entries()) {
      // validate script
      const script = output.parseScript(network);
      if (!(script instanceof P2PKH || script instanceof P2SH)) {
        throw new UnsupportedScriptError('Unsupported script type');
      }

      let authorities = 0;
      if (output.isMint()) {
        authorities += TOKEN_MINT_MASK;
      }
      if (output.isMelt()) {
        authorities += TOKEN_MELT_MASK;
      }

      const token = output.isTokenHTR()
        ? NATIVE_TOKEN_UID
        : tx.tokens[output.getTokenIndex()];
      instance.addOutput(output.value, output.script, {
        token,
        authorities,
        isChange: changeOutputs.indexOf(index) > -1,
      });
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
        txApi
          .getTransaction(input.hash, data => {
            const utxo = get(data, `tx.outputs[${input.index}]`);
            if (!utxo) {
              return resolve(false);
            }

            const tokenUid =
              utxo.token_data === 0
                ? NATIVE_TOKEN_UID
                : get(data, `tx.tokens[${(utxo.token_data & TOKEN_INDEX_MASK) - 1}].uid`);

            const isAuthority = (utxo.token_data & TOKEN_AUTHORITY_MASK) > 0;
            const isMint = isAuthority && (utxo.value & TOKEN_MINT_MASK) > 0;
            const isMelt = isAuthority && (utxo.value & TOKEN_MELT_MASK) > 0;

            const authorityCheck =
              isAuthority === input.authorities > 0 &&
              isMint === (input.authorities & TOKEN_MINT_MASK) > 0 &&
              isMelt === (input.authorities & TOKEN_MELT_MASK) > 0;

            return resolve(
              authorityCheck &&
                input.token === tokenUid &&
                input.value === utxo.value &&
                input.address === utxo.decoded.address
            );
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
    return Promise.all(promises).then(responses => responses.every(x => x));
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
      // Only the first 2 parts are required, the third onward are the signatures which can be empty
      // When collecting the input data from atomic-swap participants a participant may not have inputs to sign
      // allowing the empty input data array case will make this a noop instead of throwing an error.
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
}
