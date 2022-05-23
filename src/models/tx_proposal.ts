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

class ProposalInput extends Input {
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

class ProposalOutput extends Output {
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
   * @return {OutputData}
   * @memberof ProposalOutput
   */
  toData(tokenData: number, network: Network) {
    const script = this.parseScript(network);
    if (!(script instanceof P2PKH || script instanceof P2SH)) {
      throw new Error('invalid output');
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
export class TxProposalData {
  inputs: ProposalInput[];
  outputs: ProposalOutput[];
  network: Network;

  constructor(network?: Network) {
    this.inputs = [];
    this.outputs = [];
    this.network = network || new Network('mainnet');
  }

  /**
   * 
   *
   * @return {TxData}
   * @memberof TxProposalData
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
   * 
   *
   * @return {Transaction}
   * @memberof TxProposalData
   * @inner
   */
  getTx() {
    return helpers.createTxFromData(this.getTxData(), this.network);
  }

  /**
   * 
   *
   * @return {Boolean}
   * @memberof TxProposalData
   * @inner
   */
  isComplete() {
    const tokenBalance: Record<string, number> = {};
    for (const input of this.inputs) {
      if (!(input.token in tokenBalance)) {
        tokenBalance[input.token] = 0;
      }
      tokenBalance[input.token] += input.value;
    }

    for (const output of this.outputs) {
      if (!(output.token in tokenBalance)) {
        // There is a token on the outputs that is not on the inputs
        return false;
      }

      tokenBalance[output.token] -= output.value;
    }

    // Calculated the final balance for all tokens
    // return if all are 0
    return Object.values(tokenBalance).every(v => v === 0);
  }

  async addInput(txId: string, index: number) {
    // fetch token + value from txId + index
    await txApi.getTransaction(txId, (data) => {
      const utxo = data.tx.outputs[index];
      const token = utxo.token_data === 0 ? HATHOR_TOKEN_CONFIG.uid : data.tx.tokens[utxo.token_data - 1];
      this.inputs.push(new ProposalInput(txId, index, token.uid, utxo.value, utxo.decoded.address));
    });
  }

  addOutput(value: number, script: Buffer, token: string, isChange: Boolean) {
    this.outputs.push(new ProposalOutput(
      value,
      script,
      token,
      isChange,
    ));
  }

  /**
   * 
   *
   * @returns {string}
   * @memberof TxProposalData
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
    const data = {
      "txHex": tx.toHex(),
      changeOutputs,
    };

    return Buffer.from(JSON.stringify(data)).toString('hex');
  }

  /**
   * Deserialize and create an instance of TxProposalData
   * This method is async because we need to fetch information on the inputs (token, value)
   *
   * @returns {Promise}
   * @memberof TxProposalData
   * @static
   */
  static async deserialize(serialized: string, network: Network) {
    const dataStr = Buffer.from(serialized, 'hex').toString();
    let data;
    try {
      data = JSON.parse(dataStr);
    } catch(err) {
      // TODO
      // SyntaxError for parsing json
      throw new Error('Invalid serialization');
    }

    if (!(data.txHex && data.changeOutputs)) {
      throw new Error('invalid data');
    }

    const netw = network || new Network('mainnet');

    const tx = helpers.createTxFromHex(data.txHex, netw);

    const proposal = new TxProposalData(netw);

    for (const input of tx.inputs) {
      await proposal.addInput(input.hash, input.index);
    }

    for (const [index, output] of tx.outputs.entries()) {
      // validate script
      const script = output.parseScript(netw);
      if (!(script instanceof P2PKH || script instanceof P2SH)) {
        throw new Error('Unsupported script type');
      }

      if (output.isAuthority()) {
        // TODO: we dont allow passing authority on atomic swap?
        throw new Error('no authority outputs');
      }

      const tokenIndex = output.tokenData & TOKEN_INDEX_MASK;
      const token = tokenIndex === 0 ? HATHOR_TOKEN_CONFIG.uid : tx.tokens[tokenIndex-1];
      proposal.addOutput(
        output.value,
        output.script,
        token,
        index in data.changeOutputs,
      );
    }

    return proposal;
  }
}

export class TxProposalSignature {
  data: Record<number, Buffer>;
  txId: string;
  inputsLen: number;

  constructor(txId: string, inputsLen: number) {
    this.data = {};
    this.txId = txId;
    this.inputsLen = inputsLen;
  }

  addData(index: number, inputData: Buffer) {
    if (index >= this.inputsLen) {
      throw new Error('input data OOB');
    }
    this.data[index] = inputData;
  }

  isComplete() {
    return Object.values(this.data).length === this.inputsLen;
  }

  serialize() {
    const arr = [this.txId];
    for (const [index, buf] of Object.entries(this.data)) {
      arr.push(`${index}:${buf.toString('hex')}`);
    }
    return arr.join('|');
  }

  addSignatures(serialized: string) {
    const arr = serialized.split('|');
    const txId = arr[0];
    if (txId !== this.txId) {
      throw new Error('Signatures for another tx');
    }
    for (const part of arr.slice(1)) {
      const parts = part.split(':');
      // This may overwrite an input data but we are allowing this
      this.data[+parts[0]] = Buffer.from(parts[1], 'hex');
    }
  }
};
