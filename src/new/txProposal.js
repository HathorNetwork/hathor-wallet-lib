/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { TxProposalData, TxProposalSignature } from '../models/tx_proposal';
import Address from '../models/address';
import P2SH from '../models/p2sh';
import P2PKH from '../models/p2pkh';
import { WalletError, SendTxError } from '../errors';
import wallet from '../wallet';

import transaction from '../transaction';
import helpers from '../utils/helpers';
import { ErrorMessages } from '../errorMessages';

class TxProposal {
  /**
   * @param {Network} network
   */
  constructor(network) {
    this.network = network;
    this.proposal = new TxProposalData(network);
    this.signatures = null;
    this.data = null;
    this.transaction = null;
  }

  async setData(serialized) {
    this.resetSignatures();
    this.proposal = await TxProposalData.deserialize(serialized, this.network);
  }

  async addSend(token, value) {
    this.resetSignatures();
    // search and add inputs (maybe change outputs) adding 'value' tokens of 'token' to the proposal
    const walletData = wallet.getWalletData();
    const historyTransactions = walletData['historyTransactions'] || {};
    const newData = wallet.getInputsFromAmount(historyTransactions, value, token);
    if (newData.inputsAmount < value) {
      // insufficient funds
      throw new Error('insufficient funds');
    }

    for (const input of newData.inputs) {
      await this.addInput(input.tx_id, input.index);
    }

    // add change output if needed
    if (newData.inputsAmount > value) {
      this.addOutput(
        token,
        newData.inputsAmount - value,
        wallet.getCurrentAddress(),
        {isChange: true});
    }
  }

  addReceive(token, value, options) {
    this.resetSignatures();
    const {timelock} = Object.assign({timelock:null}, options);
    // get an address of our wallet and add the output
    const address = wallet.getCurrentAddress();
    this.addOutput(token, value, address, {timelock});
  }

  async addInput(hash, index) {
    this.resetSignatures();
    await this.proposal.addInput(hash, index);
  }

  addOutput(token, value, address, {timelock = null, isChange = false }) {
    this.resetSignatures();

    const addr = new Address(address, {network: this.network});
    let script;
    switch(addr.getType()) {
      case 'p2sh':
        script = new P2SH(addr, { timelock });
        break
      case 'p2pkh':
        script = new P2PKH(addr, { timelock });
        break
      default:
        throw new Error('Unsupported script type');
    }
    this.proposal.addOutput(value, script.createScript(), token, isChange);
  }

  resetSignatures() {
    this.signatures = null;
    this.transaction = null;
    this.data = null;
  }

  isComplete() {
    return this.signatures && this.proposal.isComplete() && this.signatures.isComplete();
  }

  signData(pin) {
    if (!this.proposal.isComplete()) {
      // proposal is not complete, we cannot sign it.
      throw new Error('Cannot sign incomplete data');
    }

    // save data and sign inputs from the loaded wallet
    this.data = transaction.prepareData(this.proposal.getTxData(), pin);

    const dataToSign = transaction.dataToSign(this.data);

    this.signatures = new TxProposalSignature(
      dataToSign.toString('hex'),
      this.data.inputs.length
    );

    for (const [index, input] of this.data.inputs.entries()) {
      if ('data' in input && input.data.length > 0) {
        // add all signatures we know of this tx
        this.signatures.addData(index, input.data);
      }
    }
  }

  prepareTx() {
    if (!this.isComplete()) {
      throw new Error('Incomplete data and signatures');
    }

    if (this.transaction !== null) {
      return this.transaction;
    }

    for (const [index, inputData] of Object.entries(this.signatures.data)) {
      this.data.inputs[index].data = inputData;
    }

    // XXX: We need to recalculate weight since the last time it was calculated may not have had all signatures
    this.data.weight = 0;
    transaction.setWeightIfNeeded(this.data);

    this.transaction = helpers.createTxFromData(this.data, this.network);

    return this.transaction;
  }
}

export default TxProposal;
