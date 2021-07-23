/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import walletApi from './api/walletApi';
import MineTransaction from './mineTransaction';
import HathorWalletServiceWallet from './wallet';
import Transaction from '../models/transaction';

type optionsType = {
  maxTxMiningRetries?: number,
};

class SendTransaction extends EventEmitter {
  // Transaction to be mined and sent
  transaction: Transaction;
  // Wallet that is sending the transaction
  wallet: HathorWalletServiceWallet;
  // Object that handles mining the transaction
  mineTransaction: MineTransaction;
  // Promise that will resolve when the sent is successful
  promise: Promise<Transaction>;
  constructor(transaction: Transaction, wallet: HathorWalletServiceWallet, options: optionsType = {}) {
    super();

    const defaultOptions: optionsType = {
      maxTxMiningRetries: 3,
    };
    const newOptions = Object.assign(defaultOptions, options);

    this.transaction = transaction;
    this.wallet = wallet;

    this.mineTransaction = new MineTransaction(this.transaction, { maxTxMiningRetries: newOptions.maxTxMiningRetries! });

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
      this.emit('send-error', message);
    })

    this.mineTransaction.on('unexpected-error', (message) => {
      this.emit('unexpected-error', message);
    })

    this.mineTransaction.on('success', (data) => {
      this.transaction.parents = data.parents;
      this.transaction.timestamp = data.timestamp;
      this.transaction.nonce = data.nonce;
      this.transaction.weight = data.weight;
      this.handleSendTxProposal();
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
  }

  /**
   */
  async handleSendTxProposal() {
    const txHex = this.transaction.toHex();

    const response = await walletApi.createTxProposal(this.wallet, txHex);
    if (response.status === 201) {
      const responseData = response.data;
      const txProposalId = responseData.txProposalId;
      const sendResponse = await walletApi.updateTxProposal(this.wallet, txProposalId, txHex);
      if (sendResponse.status === 200 && sendResponse.data.success) {
        this.emit('send-success', this.transaction);
      } else {
        this.emit('send-error', 'Error sending tx proposal.');
      }
    } else {
      this.emit('send-error', 'Error sending tx proposal.');
    }
  }

  /**
   * Start object (submit job)
   */
  start() {
    this.mineTransaction.start();
  }
}

export default SendTransaction;