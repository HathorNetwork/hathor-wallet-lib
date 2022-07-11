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
import Transaction from '../models/transaction';
import { AddressError, InvalidPartialTxError, InsufficientFundsError } from '../errors';
import wallet from '../wallet';
import Network from '../models/network';
import { HATHOR_TOKEN_CONFIG } from '../constants';

import transaction from '../transaction';
import helpers from '../utils/helpers';

import { OutputType } from './types';

class PartialTxProposal {

  network: Network;
  public partialTx: PartialTx;
  public signatures: PartialTxInputData|null;
  private transaction: Transaction|null;

  /**
   * @param {Network} network
   */
  constructor(network: Network) {
    this.network = network;
    this.partialTx = new PartialTx(this.network);
    this.signatures = null;
    this.transaction = null;
  }

  /**
   * Create a PartialTxProposal instance from the serialized string.
   *
   * @param {string} serialized Serialized PartialTx data
   * @param {Network} network network
   *
   * @throws {SyntaxError} serialized argument should be a valid PartialTx.
   * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
   *
   * @returns {PartialTxProposal}
   */
  static fromPartialTx(serialized: string, network: Network) {
    const partialTx = PartialTx.deserialize(serialized, network);
    const proposal = new PartialTxProposal(network);
    proposal.partialTx = partialTx;
    return proposal;
  }

  /**
   * Add inputs sending the amount of tokens specified, may add a change output.
   *
   * @param {string} token UID of token that is being sent
   * @param {number} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {string|null} [options.changeAddress=null] If we add change, use this address instead of getting a new one from the wallet.
   * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
   *
   * @throws InsufficientFundsError
   */
  addSend(
    token: string,
    value: number,
    { changeAddress = null, markAsSelected = true }: { changeAddress?: number|null, markAsSelected?: boolean } = {},
  ) {
    this.resetSignatures();

    const walletData = wallet.getWalletData();
    const historyTransactions = walletData['historyTransactions'] || {};
    const newData = wallet.getInputsFromAmount(historyTransactions, value, token);
    if (newData.inputsAmount < value) {
      throw new InsufficientFundsError(`Not enough tokens to send.`);
    }

    for (const input of newData.inputs) {
      // Since we chose the input from the historyTransactions, we can be sure this exists.
      const utxo = historyTransactions[input.tx_id].outputs[input.index];
      this.addInput(
        input.tx_id,
        input.index,
        utxo.value,
        {
          token: utxo.token,
          address: input.address,
          markAsSelected,
        });
    }

    // add change output if needed
    if (newData.inputsAmount > value) {
      const address = changeAddress || wallet.getCurrentAddress();
      this.addOutput(
        token,
        newData.inputsAmount - value,
        address,
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
   * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
   * @param {string|null} [options.address=null] Output address to receive the tokens.
   *
   */
  addReceive(
    token: string,
    value: number,
    { timelock = null, address = null }: { timelock?: number|null, address?: string|null } = {}) {
    this.resetSignatures();

    // get an address of our wallet and add the output
    const addr = address || wallet.getCurrentAddress();
    this.addOutput(token, value, addr, { timelock });
  }

  /**
   * Add an UTXO as input on the partial data.
   *
   * @param {string} hash Transaction hash
   * @param {number} index UTXO index on the outputs of the transaction.
   * @param {number} value UTXO value.
   * @param {Object} [options]
   * @param {string} [options.token='00'] Token UID in hex format.
   * @param {number} [options.tokenData=0] TokenData of the UTXO.
   * @param {string|null} [options.address=null] Address that owns the UTXO.
   * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
   */
  addInput(
    hash: string,
    index: number,
    value: number,
    {
      token = HATHOR_TOKEN_CONFIG.uid,
      tokenData = 0,
      address = null,
      markAsSelected = true,
    }: {
      token?: string,
      tokenData?: number,
      address?: string|null,
      markAsSelected?: boolean,
    } = {},
  ) {
    this.resetSignatures();

    if (markAsSelected) {
      const walletData = wallet.getWalletData();
      const historyTransactions = walletData['historyTransactions'] || {};

      // The input may not be present on the loaded wallet's history
      if(hash in historyTransactions) {
        historyTransactions[hash].outputs[index]['selected_as_input'] = true;
      }
    }

    this.partialTx.addInput(hash, index, value, tokenData, { token, address });
  }

  /**
   * Add an output to the partial data.
   *
   * @param {string} token UID of token that is being sent.
   * @param {number} value Quantity of tokens being sent.
   * @param {string} address Create the output script for this address.
   * @param {Object} [options]
   * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
   * @param {boolean} [options.isChange=false] If the output should be considered as change.
   * @param {number} [options.tokenData=0] TokenData of the Output.
   *
   * @throws AddressError
   */
  addOutput(
    token: string,
    value: number,
    address: string,
    {
      timelock = null,
      isChange = false,
      tokenData = 0
    }: { timelock?: number|null, isChange?: boolean, tokenData?: number } = {}
  ) {
    this.resetSignatures();

    const addr = new Address(address, {network: this.network});
    let script;
    switch(addr.getType()) {
      case OutputType.P2SH:
        script = new P2SH(addr, { timelock });
        break
      case OutputType.P2PKH:
        script = new P2PKH(addr, { timelock });
        break
      default:
        throw new AddressError('Unsupported address type');
    }
    this.partialTx.addOutput(value, script.createScript(), tokenData, { token, isChange });
  }

  /**
   * Reset any data calculated from the partial tx.
   */
  resetSignatures() {
    this.signatures = null;
    this.transaction = null;
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
    return (!!this.signatures) && this.partialTx.isComplete() && this.signatures.isComplete();
  }

  /**
   * Create the data to sign from the current transaction signing the loaded wallet inputs.
   *
   * @param {string} pin The loaded wallet's pin to sign the transaction.
   *
   * @throws {InvalidPartialTxError} Inputs and outputs balance should match before signing.
   * @throws {UnsupportedScriptError} When we have an unsupported output script.
   * @throws {IndexOOBError} input index should be inside the inputs array.
   */
  async signData(pin: string) {
    if (!this.partialTx.isComplete()) {
      // partialTx is not complete, we cannot sign it.
      throw new InvalidPartialTxError('Cannot sign incomplete data');
    }

    const tx: Transaction = this.partialTx.getTx();

    this.signatures = new PartialTxInputData(
      tx.getDataToSign().toString('hex'),
      tx.inputs.length
    );

    // The validation method populates the addresses
    const valid = await this.partialTx.validate();
    if (!valid) {
      throw new InvalidPartialTxError('Transaction data inconsistent with fullnode');
    }

    // sign inputs from the loaded wallet and save input data
    const txdata = transaction.prepareData(this.partialTx.getTxData(), pin);

    for (const [index, input] of txdata.inputs.entries()) {
      if ('data' in input && input.data.length > 0) {
        // add all signatures we know of this tx
        this.signatures.addData(index, input.data);
      }
    }
  }

  /**
   * Create and return the Transaction instance if we have all signatures.
   *
   * @throws InvalidPartialTxError
   *
   * @returns {Transaction}
   */
  prepareTx() {
    if (!this.partialTx.isComplete()) {
      throw new InvalidPartialTxError('Incomplete data');
    }

    if (this.signatures === null || !this.signatures.isComplete()) {
      throw new InvalidPartialTxError('Incomplete signatures');
    }

    if (this.transaction !== null) {
      return this.transaction;
    }

    const txdata = this.partialTx.getTxData();

    for (const [index, inputData] of Object.entries(this.signatures.data)) {
      txdata.inputs[index].data = inputData;
    }

    this.transaction = helpers.createTxFromData(
      transaction.prepareData(txdata, '', { getSignature: false }),
      this.network,
    );

    return this.transaction;
  }
}

export default PartialTxProposal;
