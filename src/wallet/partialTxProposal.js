/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { PartialTx, PartialTxInputData } from '../models/partial_tx';
import Address from '../models/address';
import P2SH from '../models/p2sh';
import P2PKH from '../models/p2pkh';
import { AddressError, IncompletePartialTxError, InsufficientFundsError } from '../errors';
import wallet from '../wallet';
import Network from '../models/network';

import transaction from '../transaction';
import helpers from '../utils/helpers';
import { Transaction } from 'bitcore-lib';

class PartialTxProposal {

  /**
   * @param {Object} options
   * @param {PartialTx|null} [options.partialTx]
   * @param {Network|null} [options.network]
   */
  constructor({ partialTx = null, network = null }) {
    this.network = network || new Network('mainnet');
    this.partialTx = partialTx || new PartialTx(network);
    this.signatures = null;
    this.txdata = null;
    this.transaction = null;
  }

  /**
   * Create a PartialTxProposal instance from the serialized string.
   *
   * @param {string} serialized Serialized PartialTx data
   * @param {Object} [options]
   * @param {Network} [options.network] network
   *
   * @throws {SyntaxError} serialized argument should be a valid PartialTx.
   * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
   *
   * @returns {PartialTxProposal}
   */
  static async fromPartialTx(serialized, options = {}) {
    const { network } = Object.assign({ network: null }, options);

    const partialTx = await PartialTx.deserialize(serialized, network);
    return new PartialTxProposal({partialTx, network});
  }

  /**
   * Add inputs sending the amount of tokens specified, may add a change output.
   *
   * @param {string} token UID of token that is being sent
   * @param {number} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {string} [options.changeAddress] If we add change, use this address instead of getting a new one from the wallet.
   * @param {boolean} [options.markAsSelected] Mark the utxo with `selected_as_input`.
   *
   * @throws InsufficientFundsError
   */
  async addSend(token, value, options = {}) {
    this.resetSignatures();

    const { changeAddress, markAsSelected } = Object.assign({ changeAddress: wallet.getCurrentAddress(), markAsSelected: true }, options);

    const walletData = wallet.getWalletData();
    const historyTransactions = walletData['historyTransactions'] || {};
    const newData = wallet.getInputsFromAmount(historyTransactions, value, token);
    if (newData.inputsAmount < value) {
      throw new InsufficientFundsError(`Not enough tokens to send.`);
    }

    for (const input of newData.inputs) {
      await this.addInput(input.tx_id, input.index, { markAsSelected });
    }

    // add change output if needed
    if (newData.inputsAmount > value) {
      this.addOutput(
        token,
        newData.inputsAmount - value,
        changeAddress,
        { isChange: true },
      );
    }
  }

  /**
   * Add outputs receiving the amount of tokens specified.
   *
   * @param {string} token UID of token that is being sent
   * @param {number} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {number} [options.timelock] UNIX timestamp of the timelock.
   *
   */
  addReceive(token, value, options) {
    this.resetSignatures();

    const { timelock } = Object.assign({ timelock: null }, options);
    // get an address of our wallet and add the output
    const address = wallet.getCurrentAddress();
    this.addOutput(token, value, address, {timelock});
  }

  /**
   * Add an UTXO as input on the partial data.
   * This need to be async since we may need to fetch the transaction.
   *
   * @param {string} hash Transaction hash
   * @param {number} index UTXO index on the outputs of the transaction.
   * @param {Object} [options]
   * @param {boolean} [options.markAsSelected] Mark the utxo with `selected_as_input`.
   *
   * @returns {Promise<void>}
   */
  async addInput(hash, index, options = {}) {
    this.resetSignatures();

    const { markAsSelected } = Object.assign({ markAsSelected: true }, options);
    if (markAsSelected) {
      const walletData = wallet.getWalletData();
      const historyTransactions = walletData['historyTransactions'] || {};

      // The input may not be present on the loaded wallet's history
      if(hash in historyTransactions) {
        historyTransactions[hash].outputs[index]['selected_as_input'] = true;
      }
    }

    await this.partialTx.addInput(hash, index);
  }

  /**
   * Add an output to the partial data.
   *
   * @param {string} token UID of token that is being sent.
   * @param {number} value Quantity of tokens being sent.
   * @param {string} address Create the output script for this address.
   * @param {Object} [options]
   * @param {number} [options.timelock] UNIX timestamp of the timelock.
   * @param {boolean} [options.isChange] If the output should be considered as change.
   *
   * @throws AddressError
   */
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
        throw new AddressError('Unsupported address type');
    }
    this.partialTx.addOutput(value, script.createScript(), token, isChange);
  }


  /**
   * Reset any data calculated from the partial tx.
   */
  resetSignatures() {
    this.signatures = null;
    this.transaction = null;
    this.txdata = null;
  }

  /**
   * Unmark all inputs currently on the partial tx as not `selected_as_input`.
   */
  unmarkAsSelected() {
    const walletData = wallet.getWalletData();
    const historyTransactions = walletData['historyTransactions'] || {};

    for(const input of this.partialTx.inputs) {
      // The input may not be present on the loaded wallet's history
      if(input.hash in historyTransactions) {
        historyTransactions[input.hash].outputs[input.index]['selected_as_input'] = false;
      }
    }
  }

  /**
   * Returns true if the transaction funds are balanced and the signatures match all inputs.
   *
   * @returns {boolean}
   */
  isComplete() {
    return this.signatures && this.partialTx.isComplete() && this.signatures.isComplete();
  }

  /**
   * Create the data to sign from the current transaction signing the loaded wallet inputs.
   *
   * @param {string} pin The loaded wallet's pin to sign the transaction.
   *
   * @throws {IncompletePartialTxError} Inputs and outputs balance should match before signing.
   * @throws {UnsupportedScriptError} When we have an unsupported output script.
   * @throws {IndexOOBError} input index should be inside the inputs array.
   */
  signData(pin) {
    if (!this.partialTx.isComplete()) {
      // partialTx is not complete, we cannot sign it.
      throw new IncompletePartialTxError('Cannot sign incomplete data');
    }

    // save data and sign inputs from the loaded wallet
    this.txdata = transaction.prepareData(this.partialTx.getTxData(), pin);

    const dataToSign = transaction.dataToSign(this.txdata);

    this.signatures = new PartialTxInputData(
      dataToSign.toString('hex'),
      this.txdata.inputs.length
    );

    for (const [index, input] of this.txdata.inputs.entries()) {
      if ('data' in input && input.data.length > 0) {
        // add all signatures we know of this tx
        this.signatures.addData(index, input.data);
      }
    }
  }

  /**
   * Create and return the Transaction instance if we have all signatures.
   *
   * @throws IncompletePartialTxError
   *
   * @returns {Transaction}
   */
  prepareTx() {
    if (!this.isComplete()) {
      throw new IncompletePartialTxError('Incomplete data or signatures');
    }

    if (this.transaction !== null) {
      return this.transaction;
    }

    for (const [index, inputData] of Object.entries(this.signatures.data)) {
      this.txdata.inputs[index].data = inputData;
    }

    // XXX: We need to recalculate weight since the last time it was calculated may not have had all signatures
    this.txdata.weight = 0;
    transaction.setWeightIfNeeded(this.txdata);

    this.transaction = helpers.createTxFromData(this.txdata, this.network);

    return this.transaction;
  }
}

export default PartialTxProposal;
