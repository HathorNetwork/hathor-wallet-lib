/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import { CREATE_TOKEN_TX_VERSION, MIN_POLLING_INTERVAL, SELECT_OUTPUTS_TIMEOUT } from '../constants';
import transaction from '../transaction';
import txApi from '../api/txApi';
import txMiningApi from '../api/txMining';
import { AddressError, OutputValueError, ConstantNotSet, MaximumNumberOutputsError, MaximumNumberInputsError } from '../errors';
import wallet from '../wallet';
import storage from '../storage';
import Input from '../models/input';
import Output from '../models/output';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Address from '../models/address';
import MineTransaction from '../wallet/mineTransaction';

/**
 * This is transaction mining class responsible for:
 *
 * - Submit a job to be mined;
 * - Update mining time estimation from time to time;
 * - Get back mining response;
 * - Push tx to the network;
 *
 * It emits the following events:
 * 'job-submitted': after job was submitted;
 * 'estimation-updated': after getting the job status;
 * 'job-done': after job is finished;
 * 'send-success': after push tx succeeds;
 * 'send-error': if an error happens;
 * 'unexpected-error': if an unexpected error happens;
 **/
class SendTransaction extends EventEmitter {
  /*
   * data {Object} Prepared tx data
   */
  constructor({
    data=null,
    maxTxMiningRetries=3,
  } = {}) {
    super();

    this.data = data;

    const inputs = [];
    for (const input of data.inputs) {
      const inputObj = new Input(
        input.tx_id,
        input.index,
        {
          data: input.data
        }
      );
      inputs.push(inputObj);
    }

    const outputs = [];
    for (const output of data.outputs) {
      const outputObj = new Output(
        output.value,
        new Address(output.address),
        {
          tokenData: output.tokenData,
          timelock: output.timelock
        }
      );
      outputs.push(outputObj);
    }

    const options = {
      version: data.version,
      weight: data.weight,
      timestamp: data.timestamp,
      tokens: data.tokens
    }

    let transaction = null;
    if (data.version === CREATE_TOKEN_TX_VERSION) {
      transaction = new CreateTokenTransaction(
        data.name,
        data.symbol,
        inputs,
        outputs,
        options
      );
    } else {
      transaction = new Transaction(
        inputs,
        outputs,
        options
      );
    }

    this.mineTransaction = new MineTransaction(transaction, { maxTxMiningRetries });

    this.mineTransaction.on('estimation-updated', (data) => {
      this.emit('estimation-updated', data);
    })

    this.mineTransaction.on('job-submitted', (data) => {
      this.emit('job-submitted', data);
    })

    this.mineTransaction.on('job-done', (data) => {
      this.emit('job-done', data);
    })

    this.mineTransaction.on('error', (message) => {
      this.updateOutputSelected(false);
      this.emit('send-error', message);
    })

    this.mineTransaction.on('unexpected-error', (message) => {
      this.updateOutputSelected(false);
      this.emit('unexpected-error', message);
    })

    this.mineTransaction.on('success', (data) => {
      this.data.nonce = data.nonce;
      this.data.parents = data.parents;
      this.data.timestamp = data.timestamp;
      this.handlePushTx();
    })

    // Promise that resolves when push tx finishes with success
    // or rejects in case of an error
    this.promise = new Promise((resolve, reject) => {
      this.on('send-success', (tx) => {
        resolve(tx);
      });

      this.on('send-error', (message) => {
        reject(message);
      });

      this.on('unexpected-error', (message) => {
        reject(message);
      });
    });

    // Error to be shown in case of an unexpected error when executing push tx
    this.unexpectedPushTxError = 'An unexpected error happened. Check if the transaction has been sent looking into the history and try again if it hasn\'t.';

    // Stores the setTimeout object to set selected outputs as false
    this._unmark_as_selected_timer = null;
  }

  /**
   * Push tx to the network
   * If success, emits 'send-success' event, otherwise emits 'send-error' event.
   */
  handlePushTx() {
    const txHex = transaction.getTxHexFromData(this.data);
    txApi.pushTx(txHex, false, (response) => {
      if (response.success) {
        this.emit('send-success', response.tx);
        if (this._unmark_as_selected_timer !== null) {
          // After finishing the push_tx we can clearTimeout to unmark
          clearTimeout(this._unmark_as_selected_timer);
          this._unmark_as_selected_timer = null;
        }
      } else {
        this.updateOutputSelected(false);
        this.emit('send-error', response.message);
      }
    }).catch(() => {
      this.updateOutputSelected(false);
      this.emit('send-error', this.unexpectedPushTxError);
    });;
  }

  /**
   * Start object (submit job)
   */
  start() {
    this.updateOutputSelected(true);
    this.mineTransaction.start();
  }

  /**
   * Update the outputs of the tx data in localStorage to set 'selected_as_input'
   * This will prevent the input selection algorithm to select the same input before the
   * tx arrives from the websocket and set the 'spent_by' key
   *
   * @param {boolean} selected If should set the selected parameter as true or false
   * @param {Object} store Optional store to use to select the localStorage
   *
   **/
  updateOutputSelected(selected, store = null) {
    if (store !== null) {
      storage.setStore(store);
    }

    const walletData = wallet.getWalletData();
    if (walletData === null) {
      // If the user resets the wallet right after sending the transaction, walletData might be null
      return;
    }

    const historyTransactions = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
    const allTokens = 'allTokens' in walletData ? walletData.allTokens : [];

    // Before sending the tx to be mined, we iterate through the inputs and set selected_as_input
    for (const input of this.data.inputs) {
      if (input.tx_id in historyTransactions) {
        historyTransactions[input.tx_id].outputs[input.index]['selected_as_input'] = selected;
      } else {
        // This isn't supposed to happen but it's definitely happening in a race condition.
        console.log(`updateOutputSelected: Error updating output as selected=${selected}. ${input.tx_id} is not in the storage data. Transactions history length: ${Object.values(historyTransactions).length}`);
      }
    }
    wallet.saveAddressHistory(historyTransactions, allTokens);

    if (selected && this._unmark_as_selected_timer === null) {
      // Schedule to set all those outputs as not selected later
      const myStore = storage.store;
      this._unmark_as_selected_timer = setTimeout(() => {
        this.updateOutputSelected(false, myStore);
      }, SELECT_OUTPUTS_TIMEOUT);
    } else if (!selected && this._unmark_as_selected_timer !== null) {
      // If we unmark the outputs as selected we can already clear the timeout
      clearTimeout(this._unmark_as_selected_timer);
      this._unmark_as_selected_timer = null;
    }
  }
}

export default SendTransaction;
