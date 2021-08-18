/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import { MIN_POLLING_INTERVAL, SELECT_OUTPUTS_TIMEOUT, HATHOR_TOKEN_CONFIG } from '../constants';
import transaction from '../transaction';
import helpers from '../utils/helpers';
import txApi from '../api/txApi';
import txMiningApi from '../api/txMining';
import { WalletError, SendTxError, OutputValueError, ConstantNotSet, MaximumNumberOutputsError, MaximumNumberInputsError } from '../errors';
import { ErrorMessages } from '../errorMessages';
import wallet from '../wallet';
import oldHelpers from '../helpers';
import storage from '../storage';
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
    transaction=null,
    outputs=[],
    inputs=[],
    changeAddress=null,
    pin=null
  } = {}) {
    super();

    this.transaction = transaction;
    this.outputs = outputs;
    this.inputs = inputs;
    this.changeAddress = changeAddress;
    this.pin = pin;

    // Promise that resolves when push tx finishes with success
    // or rejects in case of an error
    this.promise = new Promise((resolve, reject) => {
      this.on('send-tx-success', (tx) => {
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
    this.unexpectedPushTxError = ErrorMessages.UNEXPECTED_PUSH_TX_ERROR;

    // Stores the setTimeout object to set selected outputs as false
    this._unmarkAsSelectedTimer = null;
  }

  /**
   * Prepare transaction data from inputs and outputs
   * Fill the inputs if needed, create output change if needed and sign inputs
   *
   * @throws SendTxError
   *
   * @return {Transaction} Transaction object prepared to be mined
   *
   * @memberof SendTransaction
   * @inner
   */
  prepareTx() {
    const tokensData = {};
    const HTR_UID = HATHOR_TOKEN_CONFIG.uid;

    // PrepareSendTokensData method expects all inputs/outputs for each token
    // then the first step is to separate the inputs/outputs for each token
    const getDefaultData = () => {
      return { outputs: [], inputs: [] };
    };

    for (const output of this.outputs) {
      if (!(output.token in tokensData)) {
        tokensData[output.token] = getDefaultData();
      }
    }

    // Get tokens array (HTR is not included)
    const tokens = Object.keys(tokensData).filter((token) => {
      return token !== HTR_UID;
    });

    for (const output of this.outputs) {
      let tokenData;
      if (output.token === HTR_UID) {
        // HTR
        tokenData = 0;
      } else {
        tokenData = tokens.indexOf(output.token) + 1;
      }

      tokensData[output.token].outputs.push({
        address: output.address,
        value: output.value,
        timelock: output.timelock ? output.timelock : null,
        tokenData,
      });
    }

    const walletData = wallet.getWalletData();
    const historyTxs = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
    for (const input of this.inputs) {
      const inputTx = historyTxs[input.txId];
      if (!inputTx || inputTx.outputs.length < input.index + 1) {
        const err = new SendTxError(ErrorMessages.INVALID_INPUT);
        err.errorData = { txId: input.txId, index: input.index };
        throw err;
      }
      const token = inputTx.outputs[input.index].token;

      tokensData[input.token].inputs.push({
        tx_id: input.txId,
        index: input.index,
        token,
      });
    }

    const fullTxData = Object.assign({tokens}, getDefaultData());

    const tokensUids = tokens.map((token) => { return {uid: token} });
    for (const tokenUid in tokensData) {
      // For each token key in tokensData we prepare the data
      const partialData = tokensData[tokenUid];
      let chooseInputs = true;
      if (partialData.inputs.length > 0) {
        chooseInputs = false;
      }

      // Warning: prepareSendTokensData(...) might modify `partialData`. It might add inputs in the inputs array
      // if chooseInputs = true and also the change output to the outputs array, if needed.
      // it's not a problem to send the token without the symbol/name. This is used only for error message but
      // it will increase the complexity of the parameters a lot to add the full token in each output/input.
      // With the wallet service this won't be needed anymore, so I think it's fine [pedroferreira 04-19-2021]
      const ret = wallet.prepareSendTokensData(partialData, {uid: tokenUid}, chooseInputs, historyTxs, tokensUids, { changeAddress: this.changeAddress });

      if (!ret.success) {
        ret.debug = {
          balance: wallet.calculateBalance(Object.values(historyTxs), tokenUid),
          partialData: partialData, // this might not be the original `partialData`
          tokenUid,
          ...ret.debug
        };
        throw new SendTxError(ret.message);
      }

      fullTxData.inputs = [...fullTxData.inputs, ...ret.data.inputs];
      fullTxData.outputs = [...fullTxData.outputs, ...ret.data.outputs];
    }

    let preparedData = null;
    try {
      preparedData = transaction.prepareData(fullTxData, this.pin);
      this.transaction = helpers.createTxFromData(preparedData);
      return this.transaction;
    } catch(e) {
      const message = oldHelpers.handlePrepareDataError(e);
      throw new SendTxError(message);
    }
  }

  /**
   * Mine the transaction
   * Expects this.transaction to be prepared and signed
   * Emits MineTransaction events while the process is ongoing
   *
   * @params {Object} options Optional object with {'startMiningTx', 'maxTxMiningRetries'}
   *
   * @throws WalletError
   *
   * @memberof SendTransaction
   * @inner
   */
  mineTx(options = {}) {
    if (this.transaction === null) {
      throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    this.updateOutputSelected(true);

    const newOptions = Object.assign({
      startMiningTx: true,
      maxTxMiningRetries: 3,
    }, options);

    this.mineTransaction = new MineTransaction(this.transaction, { maxTxMiningRetries: newOptions.maxTxMiningRetries });

    this.mineTransaction.on('mining-started', () => {
      this.emit('mine-tx-started');
    });

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
      this.transaction.parents = data.parents;
      this.transaction.timestamp = data.timestamp;
      this.transaction.nonce = data.nonce;
      this.transaction.weight = data.weight;
      this.emit('mine-tx-ended', data);
    })

    if (newOptions.startMiningTx) {
      this.mineTransaction.start();
    }

    return this.mineTransaction;
  }

  /**
   * Push tx to the network
   * If success, emits 'send-tx-success' event, otherwise emits 'send-error' event.
   *
   * @memberof SendTransaction
   * @inner
   */
  handlePushTx() {
    if (this.transaction === null) {
      throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    this.emit('send-tx-start', this.transaction);
    const txHex = this.transaction.toHex();
    txApi.pushTx(txHex, false, (response) => {
      if (response.success) {
        this.transaction.updateHash();
        this.emit('send-tx-success', this.transaction);
        if (this._unmarkAsSelectedTimer !== null) {
          // After finishing the push_tx we can clearTimeout to unmark
          clearTimeout(this._unmarkAsSelectedTimer);
          this._unmarkAsSelectedTimer = null;
        }
      } else {
        this.updateOutputSelected(false);
        this.emit('send-error', response.message);
      }
    }).catch(() => {
      this.updateOutputSelected(false);
      this.emit('send-error', this.unexpectedPushTxError);
    });
  }

  /**
   * Run sendTransaction from mining, i.e. expects this.transaction to be prepared and signed
   * then it will mine and push tx
   *
   * 'until' parameter can be 'mine-tx', in order to only mine the transaction without propagating
   *
   * @memberof SendTransaction
   * @inner
   */
  async runFromMining(until = null) {
    const promise = new Promise((resolve, reject) => {
      try {
        this.mineTx();
        if (until === 'mine-tx') {
          resolve(this.transaction);
          return;
        }

        this.on('mine-tx-ended', (data) => {
          this.handlePushTx();
        });

        this.once('send-tx-success', (data) => {
          resolve(this.transaction);
        });
      } catch (err) {
        reject(err);
        if (err instanceof WalletError) {
          this.emit('send-error', err.message);
        } else {
          throw err;
        }
      }
    });
    return promise;
  }

  /**
   * Method created for compatibility reasons
   * some people might be using the old facade and this start method just calls runFromMining
   *
   * @memberof SendTransaction
   * @inner
   */
  start() {
    this.runFromMining();
  }

  /**
   * Run sendTransaction from preparing, i.e. prepare, sign, mine and push the tx
   *
   * 'until' parameter can be 'prepare-tx' (it will stop before signing the tx),
   * or 'mine-tx' (it will stop before send tx proposal, i.e. propagating the tx)
   *
   * @memberof SendTransaction
   * @inner
   */
  async run(until = null) {
    const promise = new Promise((resolve, reject) => {
      try {
        this.prepareTx();
        if (until === 'prepare-tx') {
          resolve(this.transaction);
          return;
        }

        const miningPromise = this.runFromMining(until);
        miningPromise.then((data) => {
          resolve(data);
        }, (err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
        if (err instanceof WalletError) {
          this.emit('send-error', err.message);
        } else {
          throw err;
        }
      }
    });
    return promise;
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
    for (const input of this.transaction.inputs) {
      if (input.hash in historyTransactions) {
        historyTransactions[input.hash].outputs[input.index]['selected_as_input'] = selected;
      } else {
        // This isn't supposed to happen but it's definitely happening in a race condition.
        console.log(`updateOutputSelected: Error updating output as selected=${selected}. ${input.hash} is not in the storage data. Transactions history length: ${Object.values(historyTransactions).length}`);
      }
    }
    wallet.saveAddressHistory(historyTransactions, allTokens);

    if (selected && this._unmarkAsSelectedTimer === null) {
      // Schedule to set all those outputs as not selected later
      const myStore = storage.store;
      this._unmarkAsSelectedTimer = setTimeout(() => {
        this.updateOutputSelected(false, myStore);
      }, SELECT_OUTPUTS_TIMEOUT);
    } else if (!selected && this._unmarkAsSelectedTimer !== null) {
      // If we unmark the outputs as selected we can already clear the timeout
      clearTimeout(this._unmarkAsSelectedTimer);
      this._unmarkAsSelectedTimer = null;
    }
  }
}

export default SendTransaction;
