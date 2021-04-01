/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { HATHOR_BIP44_CODE } from '../constants';
import Mnemonic from 'bitcore-mnemonic';
import { crypto, util } from 'bitcore-lib';
import walletApi from './api/walletApi';
import wallet from '../utils/wallet';
import helpers from '../utils/helpers';
import Transaction from '../models/transaction';
import Output from '../models/output';
import Input from '../models/input';
import Address from '../models/address';
import Network from '../models/network';
import MineTransaction from './mineTransaction';

// Time in milliseconds berween each polling to check wallet status
// if it ended loading and became ready
const WALLET_STATUS_POLLING_TIMEOUT = 3000;

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
  walletId: string | null;
  // State of the wallet. One of the walletState enum options
  private state: string
  // Variable to prevent start sending more than one tx concurrently
  private isSendingTx: boolean
  // ID of tx proposal
  private txProposalId: string | null

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
    this.isSendingTx = false;
    this.txProposalId = null;

    // TODO set network
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
    const handleCreate = async (data) => {
      this.walletId = data.walletId;
      if (data.status === 'creating') {
        await this.startPollingStatus();
      } else {
        this.setState(walletState.READY);
      }
    }
    try {
      const res = await walletApi.createWallet(xpub);
      const data = res.data;
      if (res.status === 200 && data.success) {
        await handleCreate(data.status);
      } else {
        // TODO is there any other possible error to handle here?
      }
    } catch(error) {
      if (error.response.status === 400) {
        // Bad request
        // Check if error is 'wallet-already-loaded'
        const data = error.response.data;
        if (data && data.error === 'wallet-already-loaded') {
          // If it was already loaded, we have to check if it's ready
          await handleCreate(data.status);
        }
      }
      // TODO Should we handle another error?
    }
  }

  async startPollingStatus() {
    try {
      const res = await walletApi.getWalletStatus(this.walletId!);
      const data = res.data;
      if (res.status === 200 && data.success) {
        if (data.status.status === 'creating') {
          setTimeout(async () => {
            await this.startPollingStatus();
          }, WALLET_STATUS_POLLING_TIMEOUT);
        } else if (data.status.status === 'ready') {
          this.setState(walletState.READY);
        } else {
          // TODO What other status might have?
          // throw error?
        }
      } else {
        // TODO is there any other possible error to handle here?
      }
    } catch(err) {
      // TODO How to handle error
      console.log('Error sending create wallet request', err);
    }
  }

  async getAllAddresses(): Promise<string[]> {
    const response = await walletApi.getAddresses(this.walletId!);
    let addresses = [];
    if (response.status === 200 && response.data.success === true) {
      addresses = response.data.addresses;
    } else {
      // TODO What error should be handled here?
    }
    return addresses;
  }

  getAddressAtIndex(index: number) {
    // TODO we don't have this API implemented
  }

  getCurrentAddress() {
    // TODO we don't have this API implemented
  }

  async getBalance(tokenUid: string | null = null) {
    const response = await walletApi.getBalances(this.walletId!, tokenUid);
    let balance = null;
    if (response.status === 200 && response.data.success === true) {
      balance = response.data.balances;
    } else {
      // TODO What error should be handled here?
    }
    return balance;
  }

  async getTxHistory(options: { tokenUid?: string } = {}) {
    const requestOptions = Object.assign({ tokenUid: null }, options);
    const { tokenUid } = requestOptions;
    const response = await walletApi.getHistory(this.walletId!, tokenUid);
    let history = []
    if (response.status === 200 && response.data.success === true) {
      history = response.data.history;
    } else {
      // TODO What error should be handled here?
    }
    return history
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

  async sendTransaction(address, value, options: { token: string | null, changeAddress: string | null } = { token: '00', changeAddress: null }) {
    const newOptions = Object.assign({
      token: '00',
      changeAddress: null
    }, options);
    const { token, changeAddress } = newOptions;
    const outputs = [{ address, value, token }];
    return await this.sendTxProposal(outputs, { inputs: [], changeAddress });
  }

  async sendTxProposal(outputs, options = { inputs: [], changeAddress: null }) {
    const newOptions = Object.assign({
      inputs: [],
      changeAddress: null
    }, options);
    const { inputs, changeAddress } = newOptions;
    const response = await walletApi.createTxProposal(this.walletId!, outputs, inputs);
    if (response.status === 201) {
      const responseData = response.data;
      this.txProposalId = responseData.txProposalId;

      const inputsObj: Input[] = [];
      for (const i of responseData.inputs) {
        inputsObj.push(new Input(i.txId, i.index));
      }

      const outputsObj: Output[] = [];
      for (const o of responseData.outputs) {
        // TODO handle custom tokens
        outputsObj.push(new Output(o.value, new Address(o.address)));
      }

      const tx = new Transaction(inputsObj, outputsObj);
      tx.prepareToSend();
      const dataToSignHash = tx.getDataToSignHash();

      for (const [idx, inputObj] of tx.inputs.entries()) {
        const inputData = this.getInputData(dataToSignHash, responseData.inputs[idx].addressPath);
        inputObj.setData(inputData);
      }

      await this.executeSendTransaction(tx);
    }
  }

  getInputData(dataToSignHash, addressPath) {
    const code = new Mnemonic(this.seed);
    // It does not matter the network name to generate the xpriv
    const network = new Network('mainnet');
    const xpriv = code.toHDPrivateKey(this.passphrase, network.bitcoreNetwork);
    const derivedKey = xpriv.derive(addressPath);
    const privateKey = derivedKey.privateKey;

    const sig = crypto.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
      nhashtype: crypto.Signature.SIGHASH_ALL
    });

    const arr = [];
    helpers.pushDataToStack(arr, sig.toDER());
    helpers.pushDataToStack(arr, derivedKey.publicKey.toBuffer());
    return util.buffer.concat(arr);
  }

  async executeSendTransaction(transaction: Transaction) {
    const mineTransaction = new MineTransaction(transaction);
    mineTransaction.start();

    const data = await Promise.resolve(mineTransaction.promise);

    const inputsData: string[] = []
    for (const input of transaction.inputs) {
      inputsData.push(input.data!.toString('base64'));
    }

    return await walletApi.updateTxProposal(this.txProposalId!, data.timestamp, data.nonce, data.weight, data.parents, inputsData);
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
