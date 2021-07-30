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
import Output from '../models/output';
import Input from '../models/input';
import Address from '../models/address';
import { HATHOR_TOKEN_CONFIG } from '../constants';
import { shuffle } from 'lodash';
import { SendTxError, UtxoError, WalletError, WalletRequestError } from '../errors';
import { OutputRequestObj, InputRequestObj } from './types';

type optionsType = {
  outputs?: OutputRequestObj[],
  inputs?: InputRequestObj[],
  changeAddress?: string | null,
  transaction?: Transaction | null,
};

class SendTransactionWalletService extends EventEmitter {
  // Wallet that is sending the transaction
  private wallet: HathorWalletServiceWallet;
  // Outputs to prepare the transaction
  private outputs: OutputRequestObj[];
  // Optional inputs to prepare the transaction
  private inputs: InputRequestObj[];
  // Optional change address to prepare the transaction
  private changeAddress: string | null;
  // Transaction object to be used after it's already prepared
  private transaction: Transaction | null;
  // MineTransaction object
  private mineTransaction: MineTransaction | null;

  constructor(wallet: HathorWalletServiceWallet, options: optionsType = {}) {
    super();

    const newOptions: optionsType = Object.assign({
      outputs: [],
      inputs: [],
      changeAddress: null,
      transaction: null,
    }, options);

    this.wallet = wallet;
    this.outputs = newOptions.outputs!;
    this.inputs = newOptions.inputs!;
    this.changeAddress = newOptions.changeAddress!;
    this.transaction = newOptions.transaction!;
    this.mineTransaction = null;
  }

  /**
   * Prepare transaction data to send
   * Get utxos from wallet service, creates change outpus and returns a Transaction object
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async prepareTx(): Promise<{ transaction: Transaction, utxosAddressPath: string[] }> {
    if (this.outputs.length === 0) {
      throw new WalletError('Can\'t prepare transactions with no outputs.');
    }
    this.emit('prepare-tx-start');
    // We get the full outputs amount for each token
    // This is useful for (i) getting the utxos for each one
    // in case it's not sent and (ii) create the token array of the tx
    const amountOutputMap = {};
    for (const output of this.outputs) {
      if (output.token in amountOutputMap) {
        amountOutputMap[output.token] += output.value;
      } else {
        amountOutputMap[output.token] = output.value;
      }
    }

    // We need this array to get the addressPath for each input used and be able to sign the input data
    const utxosAddressPath: string[] = [];
    let changeOutputAdded = false;
    if (this.inputs.length === 0) {
      // Need to get utxos
      // We already know the full amount for each token
      // Now we can get the utxos and (if needed) change amount for each token
      for (const token in amountOutputMap) {
        const { utxos, changeAmount } = await this.wallet.getUtxos({ tokenId: token, totalAmount: amountOutputMap[token] });
        if (utxos.length === 0) {
          throw new UtxoError(`No utxos available to fill the request. Token: ${token} - Amount: ${amountOutputMap[token]}.`);
        }

        for (const utxo of utxos) {
          this.inputs.push({ txId: utxo.txId, index: utxo.index });
          utxosAddressPath.push(utxo.addressPath);
        }

        if (changeAmount) {
          changeOutputAdded = true;
          const changeAddress = this.changeAddress || this.wallet.getCurrentAddress({ markAsUsed: true }).address;
          this.outputs.push({ address: changeAddress, value: changeAmount, token });
        }
      }
    } else {
      const amountInputMap = {};
      for (const input of this.inputs) {
        const utxo = await this.wallet.getUtxoFromId(input.txId, input.index);
        if (utxo === null) {
          throw new UtxoError(`Invalid input selection. Input ${input.txId} at index ${input.index}.`);
        }

        if (!(utxo.tokenId in amountOutputMap)) {
          throw new SendTxError(`Invalid input selection. Input ${input.txId} at index ${input.index} has token ${utxo.tokenId} that is not on the outputs.`);
        }

        utxosAddressPath.push(utxo.addressPath);

        if (utxo.tokenId in amountInputMap) {
          amountInputMap[utxo.tokenId] += utxo.value;
        } else {
          amountInputMap[utxo.tokenId] = utxo.value;
        }
      }

      for (const t in amountOutputMap) {
        if (!(t in amountInputMap)) {
          throw new SendTxError(`Invalid input selection. Token ${t} is in the outputs but there are no inputs for it.`);
        }

        if (amountInputMap[t] < amountOutputMap[t]) {
          throw new SendTxError(`Invalid input selection. Sum of inputs for token ${t} is smaller than the sum of outputs.`);
        }

        if (amountInputMap[t] > amountOutputMap[t]) {
          changeOutputAdded = true;
          const changeAmount = amountInputMap[t] - amountOutputMap[t];
          const changeAddress = this.changeAddress || this.wallet.getCurrentAddress({ markAsUsed: true }).address;
          this.outputs.push({ address: changeAddress, value: changeAmount, token: t });
        }
      }
    }

    if (changeOutputAdded) {
      this.outputs = shuffle(this.outputs);
    }

    const tokens = Object.keys(amountOutputMap);
    const htrIndex = tokens.indexOf(HATHOR_TOKEN_CONFIG.uid);
    if (htrIndex > -1) {
      tokens.splice(htrIndex, 1);
    }

    const inputsObj: Input[] = [];
    for (const i of this.inputs) {
      inputsObj.push(new Input(i.txId, i.index));
    }

    const outputsObj: Output[] = [];
    for (const o of this.outputs) {
      const address = new Address(o.address, { network: this.wallet.network });
      if (!address.isValid()) {
        throw new SendTxError(`Address ${o.address} is not valid.`);
      }
      const tokenData = (o.token in tokens) ? tokens.indexOf(o.token) + 1 : 0;
      const outputOptions = { tokenData, timelock: o.timelock || null };
      outputsObj.push(new Output(o.value, address, outputOptions));
    }

    this.transaction = new Transaction(inputsObj, outputsObj);
    this.transaction.tokens = tokens;
    this.transaction.prepareToSend();

    this.emit('prepare-tx-end', this.transaction);
    return { transaction: this.transaction, utxosAddressPath };
  }

  /**
   * Signs the inputs of a transaction
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  signTx(utxosAddressPath: string[]) {
    if (this.transaction === null) {
      throw new WalletError('Can\'t sign transaction if it\'s null.');
    }
    this.emit('sign-tx-start');
    const dataToSignHash = this.transaction.getDataToSignHash();

    for (const [idx, inputObj] of this.transaction.inputs.entries()) {
      const inputData = this.wallet.getInputData(dataToSignHash, utxosAddressPath[idx]);
      inputObj.setData(inputData);
    }

    this.emit('sign-tx-end', this.transaction);
  }

  /**
   * Mine the transaction
   * Expects this.transaction to be prepared and signed
   * Emits MineTransaction events while the process is ongoing
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  mineTx(options = {}): MineTransaction {
    if (this.transaction === null) {
      throw new WalletError('Can\'t mine transaction if it\'s null.');
    }
    type mineOptionsType = {
      startMiningTx: boolean,
      maxTxMiningRetries: number,
    };
    const newOptions: mineOptionsType = Object.assign({
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
      this.emit('send-error', message);
    })

    this.mineTransaction.on('unexpected-error', (message) => {
      this.emit('send-error', message);
    })

    this.mineTransaction.on('success', (data) => {
      this.transaction!.parents = data.parents;
      this.transaction!.timestamp = data.timestamp;
      this.transaction!.nonce = data.nonce;
      this.transaction!.weight = data.weight;
      this.emit('mine-tx-ended', data);
    })

    if (newOptions.startMiningTx) {
      this.mineTransaction.start();
    }

    return this.mineTransaction;
  }

  /**
   * Create and send a tx proposal to wallet service
   * Expects this.transaction to be prepared, signed and mined
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async handleSendTxProposal() {
    if (this.transaction === null) {
      throw new WalletError('Can\'t push transaction if it\'s null.');
    }
    this.emit('send-tx-start', this.transaction);
    const txHex = this.transaction.toHex();

    try {
      const responseData = await walletApi.createTxProposal(this.wallet, txHex);
      const txProposalId = responseData.txProposalId;
      const sendData = await walletApi.updateTxProposal(this.wallet, txProposalId, txHex);
      this.transaction.updateHash();
      this.emit('send-tx-success', this.transaction);
    } catch (err) {
      if (err instanceof WalletRequestError) {
        this.emit('send-error', 'Error sending tx proposal.');
      } else {
        throw err;
      }
    }
  }

  /**
   * Run sendTransaction from mining, i.e. expects this.transaction to be prepared and signed
   * then it will mine and handle tx proposal
   *
   * 'until' parameter can be 'mine-tx', in order to only mine the transaction without propagating
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  runFromMining(until = null) {
    try {
      this.mineTx();
      if (until === 'mine-tx') {
        return;
      }

      this.once('mine-tx-ended', (data) => {
        this.handleSendTxProposal();
      });
    } catch (err) {
      if (err instanceof WalletError) {
        this.emit('send-error', err);
      } else {
        throw err;
      }
    }
  }

  /**
   * Run sendTransaction from preparing, i.e. prepare, sign, mine and send the tx
   *
   * 'until' parameter can be 'prepare-tx' (it will stop before signing the tx), 'sign-tx' (it will stop before mining the tx),
   * or 'mine-tx' (it will stop before send tx proposal, i.e. propagating the tx)
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async run(until = null) {
    try {
      const preparedData = await this.prepareTx();
      if (until === 'prepare-tx') {
        return;
      }

      this.signTx(preparedData.utxosAddressPath);
      if (until === 'sign-tx') {
        return;
      }

      this.runFromMining(until);
    } catch (err) {
      if (err instanceof WalletError) {
        this.emit('send-error', err);
      } else {
        throw err;
      }
    }
  }
}

export default SendTransactionWalletService;