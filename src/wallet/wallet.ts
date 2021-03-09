/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { HATHOR_BIP44_CODE } from '../constants';
import walletApi from './api/walletApi';
import wallet from '../utils/wallet';
import helpers from '../utils/helpers';
import Transaction from '../models/transaction';
import Output from '../models/output';
import Input from '../models/input';
import Address from '../models/address';

enum walletState {
  NOT_STARTED = 'Not started',
  LOADING = 'Loading',
  READY = 'Ready',
}

class HathorWallet extends EventEmitter {
  // String with 24 words separated by space
  seed: string;
  // String with wallet passphrase
  passphrase: string;
  // Wallet id from the wallet service
  walletId: string;
  // State of the wallet. One of the walletState enum options
  private state: string

  constructor(seed: string, options = { passphrase: '' }) {
    super();

    const { passphrase } = options;

    if (!seed) {
      throw Error('You must explicitly provide the seed.');
    }

    this.state = walletState.NOT_STARTED;
    // TODO Validate seed
    this.seed = seed;
    this.passphrase = passphrase

    // ID of wallet after created on wallet service
    this.walletId = null;

    // Time in milliseconds berween each polling to check wallet status
    // if it ended loading and became ready
    this.WALLET_STATUS_POLLING_TIMEOUT = 3000;

    // Variable to prevent start sending more than one tx concurrently
    this.isSendingTx = false;

    // ID of tx proposal
    this.txProposalId = null;
  }

  /**
   * Start wallet: load the wallet data, update state and start polling wallet status until it's ready
   *
   * @memberof HathorWallet
   * @inner
   */
  async start() {
    this.setState(walletState.LOADING);
    const xpub = wallet.getXPubKeyFromSeed(this.seed, {passphrase: this.passphrase});
    try {
      const res = await walletApi.createWallet(xpub);
      if (res.sucess || res.error === 'wallet-already-loaded') {
        this.walletId = res.status.walletId;
        if (res.status.status === 'creating') {
          this.startPollingStatus();
        } else {
          this.setState(walletState.LOADING);
        }
      } else {
        // TODO is there any other possible error to handle here?
      }
    } catch(err) {
      // TODO How to handle error
      console.log('Error sending create wallet request', err);
    }
  }

  startPollingStatus() {
    try {
      const res = await walletApi.getWalletStatus(this.walletId);
      if (res.sucess) {
        if (res.status.status === 'creating') {
          setTimeout(() => {
            this.startPollingStatus();
          }, this.WALLET_STATUS_POLLING_TIMEOUT);
        } else if (res.status.status === 'ready') {
          this.setState(walletState.READY);
        } else {
          // TODO What other status might have?
        }
      } else {
        // TODO is there any other possible error to handle here?
      }
    } catch(err) {
      // TODO How to handle error
      console.log('Error sending create wallet request', err);
    }
  }

  async getAllAddresses(): string[] {
    return await walletApi.getAddresses(this.walletId);
  }

  getAddressAtIndex(index: number): string {
    // TODO we don't have this API implemented
  }

  getCurrentAddress(): string {
    // TODO we don't have this API implemented
  }

  getBalance(tokenUid: string = null) {
    return await walletApi.getBalances(this.walletId, tokenUid);
  }

  getTxHistory(options: { tokenUid?: string } = {}) {
    const requestOptions = Object.assign({ tokenUid: null }, options);
    const { tokenUid } = requestOptions;
    return await walletApi.getHistory(this.walletId, tokenUid);
  }

  getTx(id) {
    // TODO we don't have this API implemented
  }

  getUtxos(options = {}) {
    // TODO we don't have this API implemented
  }

  isAddressMine(address) {
    // TODO we don't have this API implemented
  }

  async sendManyOutputsTransaction(outputs, options = { inputs: [], changeAddress: null }) {
    return await this.sendTxProposal(outputs, options);
  }

  async sendTransaction(address, value, options = { token: null, changeAddress: null }) {
    const outputs = [{ address, value, token }];
    return await this.sendTxProposal(outputs, { inputs: [], changeAddress });
  }

  async sendTxProposal(outputs, options = { inputs: [], changeAddress: null }) {
    const response = await walletApi.createTxProposal(this.walletId, outputs, inputs);
    if (response.success) {
      this.txProposalId = response.txProposalId;

      const inputsObj = [];
      for (const i of response.inputs) {
        inputsObj.push(new Input(i.txId, i.index));
      }

      const outputsObj = [];
      for (const o of response.outputs) {
        // TODO handle custom tokens
        outputsObj.push(new Output(o.value, o.address));
      }

      const tx = new Transaction(inputsObj, outputsObj);
      const dataToSignHash = tx.getDataToSignHash();

      for (const [idx, inputObj] of tx.inputs.entries()) {
        const inputData = this.getInputData(dataToSignHash, response.inputs[idx].addressIndex);
        inputObj.setData(inputData);
      }

      await this.executeSendTransaction(tx);
    }
  }

  getInputData(dataToSignHash, addressIndex) {
    const code = new Mnemonic(words);
    const xpriv = code.toHDPrivateKey(passphrase, network.getNetwork());
    const derivedKey = xpriv.derive(`m/44'/${HATHOR_BIP44_CODE}'/0'/0/${addressIndex}`);
    const privateKey = derivedKey.privateKey;

    const sig = crypto.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
      nhashtype: crypto.Signature.SIGHASH_ALL
    });

    const arr = [];
    helpers.pushDataToStack(arr, sig.toDER());
    helpers.pushDataToStack(arr, derivedKey.publicKey.toBuffer());
    return util.buffer.concat(arr);
  }

  executeSendTransaction(transaction: Transaction) {
    const sendTransaction = new SendTransaction(transaction);
    sendTransaction.start();

    const data = await Promise.resolve(sendTransaction.promise);

    const inputsData = []
    for (const input of transaction.inputs) {
      inputsData.push(input.data.toString('base64'));
    }

    return await walletApi.updateTxProposal(this.txProposalId, data.timestamp, data.nonce, data.weight, data.parents, inputsData);
  }

  isReady(): boolean {
    return this.state === walletState.READY;
  }

  /**
   * Update wallet state and emit 'state' event
   *
   * @param {string} state New wallet state
   *
   * @memberof HathorWallet
   * @inner
   */
  setState(state: string) {
    this.state = state;
    this.emit('state', state);
  }
}

export default HathorWallet;
