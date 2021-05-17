/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { HATHOR_BIP44_CODE } from '../constants';
import Mnemonic from 'bitcore-mnemonic';
import { crypto, util, Address as bitcoreAddress } from 'bitcore-lib';
import walletApi from './api/walletApi';
import wallet from '../utils/wallet';
import helpers from '../utils/helpers';
import Transaction from '../models/transaction';
import Output from '../models/output';
import Input from '../models/input';
import Address from '../models/address';
import Network from '../models/network';
import MineTransaction from './mineTransaction';
import HathorWalletInterface from './interface';
import { AddressInfoObject, GetBalanceObject, GetAddressesObject, GetHistoryObject, TxProposalUpdateResponseData, SendManyTxOptionsParam, SendTxOptionsParam } from './types';

// Time in milliseconds berween each polling to check wallet status
// if it ended loading and became ready
const WALLET_STATUS_POLLING_TIMEOUT = 3000;

const WALLET_NOT_READY_ERROR = 'WALLET_NOT_READY';

enum walletState {
  NOT_STARTED = 'Not started',
  LOADING = 'Loading',
  READY = 'Ready',
}

class HathorWalletServiceWallet extends EventEmitter implements HathorWalletInterface {
  // String with 24 words separated by space
  seed: string;
  // String with wallet passphrase
  passphrase: string;
  // Wallet id from the wallet service
  walletId: string | null;
  // Network in which the wallet is connected ('mainnet' or 'testnet')
  network: Network
  // State of the wallet. One of the walletState enum options
  private state: string
  // Variable to prevent start sending more than one tx concurrently
  private isSendingTx: boolean
  // Variable to store the possible addresses to use that are after the last used address
  private addressesToUse: AddressInfoObject[]
  // Index of the address to be used by the wallet
  private indexToUse: number

  constructor(seed: string, network: Network, options = { passphrase: '' }) {
    super();

    const { passphrase } = options;

    if (!seed) {
      throw Error('You must explicitly provide the seed.');
    }

    this.state = walletState.NOT_STARTED;

    // It will throw InvalidWords error in case is not valid
    wallet.wordsValid(seed);
    this.seed = seed;
    this.passphrase = passphrase

    // ID of wallet after created on wallet service
    this.walletId = null;
    this.isSendingTx = false;

    this.network = network;

    this.addressesToUse = [];
    this.indexToUse = -1;
    // TODO should we have a debug mode?
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
        await this.onWalletReady();
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

  /**
   * When the wallet starts, it might take some seconds for the wallet service to completely load all addresses
   * This method is responsible for polling the wallet status until it's ready
   *
   * @memberof HathorWallet
   * @inner
   */
  private async startPollingStatus() {
    try {
      const res = await walletApi.getWalletStatus(this.walletId!);
      const data = res.data;
      if (res.status === 200 && data.success) {
        if (data.status.status === 'creating') {
          setTimeout(async () => {
            await this.startPollingStatus();
          }, WALLET_STATUS_POLLING_TIMEOUT);
        } else if (data.status.status === 'ready') {
          await this.onWalletReady();
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

  private checkWalletReady() {
    if (!this.isReady()) {
      throw new Error('Wallet not ready');
    }
  }

  private async onWalletReady() {
    await this.getAddressesToUse();
    this.setState(walletState.READY);
  }

  private async getAddressesToUse() {
    const response = await walletApi.getAddressesToUse(this.walletId!);
    let addresses: AddressInfoObject[] = [];
    if (response.status === 200 && response.data.success === true) {
      addresses = response.data.addresses;
      this.addressesToUse = addresses;
      this.indexToUse = 0;
    } else {
      // TODO What error should be handled here?
    }
  }

  /**
   * Get all addresses of the wallet
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAllAddresses(): Promise<GetAddressesObject[]> {
    this.checkWalletReady();
    const response = await walletApi.getAddresses(this.walletId!);
    let addresses: GetAddressesObject[] = [];
    if (response.status === 200 && response.data.success === true) {
      addresses = response.data.addresses;
    } else {
      // TODO What error should be handled here?
    }
    return addresses;
  }

  /**
   * Get the balance of the wallet for a specific token
   *
   * @memberof HathorWallet
   * @inner
   */
  async getBalance(token: string | null = null): Promise<GetBalanceObject[]> {
    this.checkWalletReady();
    // If token is null we get the balance for all tokens
    const response = await walletApi.getBalances(this.walletId!, token);
    let balance: GetBalanceObject[] = [];
    if (response.status === 200 && response.data.success === true) {
      balance = response.data.balances;
    } else {
      // TODO What error should be handled here?
    }
    return balance;
  }

  /**
   * Get the history of the wallet for a specific token
   *
   * @memberof HathorWallet
   * @inner
   */
  async getTxHistory(options: { token?: string } = {}): Promise<GetHistoryObject[]> {
    this.checkWalletReady();
    // TODO Add pagination parameters
    const requestOptions = Object.assign({ token: null }, options);
    const { token } = requestOptions;
    const response = await walletApi.getHistory(this.walletId!, token);
    let history: GetHistoryObject[] = []
    if (response.status === 200 && response.data.success === true) {
      history = response.data.history;
    } else {
      // TODO What error should be handled here?
    }
    return history
  }

  /**
   * Send a transaction from an array of outputs and inputs
   *
   * @memberof HathorWallet
   * @inner
   */
  async sendManyOutputsTransaction(outputs, options: SendManyTxOptionsParam): Promise<TxProposalUpdateResponseData> {
    this.checkWalletReady();
    return await this.sendTxProposal(outputs, options);
  }

  /**
   * Send a transaction to a single output
   *
   * @memberof HathorWallet
   * @inner
   */
  async sendTransaction(address, value, options: SendTxOptionsParam = { token: '00', changeAddress: undefined }): Promise<TxProposalUpdateResponseData> {
    this.checkWalletReady();
    const newOptions = Object.assign({
      token: '00',
      changeAddress: undefined
    }, options);
    const { token, changeAddress } = newOptions;
    const outputs = [{ address, value, token }];
    return await this.sendTxProposal(outputs, { inputs: [], changeAddress });
  }

  /**
   * Send a transaction proposal
   *
   * @memberof HathorWallet
   * @inner
   */
  private async sendTxProposal(outputs, options: SendManyTxOptionsParam): Promise<TxProposalUpdateResponseData> {
    const newOptions = Object.assign({
      inputs: [],
      changeAddress: undefined
    }, options);
    const { inputs, changeAddress } = newOptions;
    const response = await walletApi.createTxProposal(this.walletId!, outputs, inputs);
    if (response.status === 201) {
      const responseData = response.data;

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

      return await this.executeSendTransaction(tx, responseData.txProposalId);
    } else {
      throw new Error('Error creating tx proposal.')
    }
  }

  /**
   * Calculate input data from dataToSign and addressPath
   * Get the private key corresponding to the addressPath,
   * calculate the signature and add the public key
   *
   * @memberof HathorWallet
   * @inner
   */
  private getInputData(dataToSignHash: Buffer, addressPath: string): Buffer {
    const code = new Mnemonic(this.seed);
    const xpriv = code.toHDPrivateKey(this.passphrase, this.network.bitcoreNetwork);
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

  /**
   * Mine transaction and update tx proposal
   *
   * @memberof HathorWallet
   * @inner
   */
  private async executeSendTransaction(transaction: Transaction, txProposalId: string): Promise<TxProposalUpdateResponseData> {
    const mineTransaction = new MineTransaction(transaction);
    mineTransaction.start();

    const data = await Promise.resolve(mineTransaction.promise);

    const inputsData: string[] = []
    for (const input of transaction.inputs) {
      inputsData.push(input.data!.toString('base64'));
    }

    let ret: TxProposalUpdateResponseData;
    const response = await walletApi.updateTxProposal(txProposalId, data.timestamp, data.nonce, data.weight, data.parents, inputsData);
    if (response.status === 200 && response.data.success === true) {
      ret = response.data;
    } else {
      throw new Error('Error updating tx proposal.')
    }
    return ret;
  }

  /**
   * Return if wallet is ready to be used
   *
   * @memberof HathorWallet
   * @inner
   */
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
  private setState(state: string) {
    this.state = state;
    this.emit('state', state);
  }

  /**
   * Stop the wallet
   *
   * @memberof HathorWallet
   * @inner
   */
  stop() {
    this.walletId = null;
    this.state = walletState.NOT_STARTED;
  }

  /**
   * Get address at specific index
   *
   * @memberof HathorWallet
   * @inner
   */
  getAddressAtIndex(index: number): string {
    const code = new Mnemonic(this.seed);
    const xpriv = code.toHDPrivateKey(this.passphrase, this.network.bitcoreNetwork);
    const privkey = xpriv.derive(`m/44'/${HATHOR_BIP44_CODE}'/0'/0`);
    const key = privkey.derive(index);
    const address = bitcoreAddress(key.publicKey, this.network.getNetwork());
    return address.toString();
  }

  /**
   * Get the current address to be used
   */
  getCurrentAddress({ markAsUsed = false } = {}): AddressInfoObject {
    const addressesToUseLen = this.addressesToUse.length;
    if (this.indexToUse > addressesToUseLen - 1) {
      const addressInfo = this.addressesToUse[addressesToUseLen - 1];
      return {address: addressInfo.address, index: addressInfo.index, error: 'GAP_LIMIT_REACHED'};
    }

    const addressInfo = this.addressesToUse[this.indexToUse];
    if (markAsUsed) {
      this.indexToUse += 1;
    }
    return addressInfo;
  }

  /**
   * Get the next address after the current available
   */
  getNextAddress(): AddressInfoObject {
    // First we mark the current address as used, then return the next
    this.getCurrentAddress({ markAsUsed: true });
    return this.getCurrentAddress();
  }

  getAddressIndex(address: string) {
    throw new Error('Not implemented.');
  }

  isAddressMine(address: string) {
    throw new Error('Not implemented.');
  }

  getTx(id: string) {
    throw new Error('Not implemented.');
  }

  getAddressInfo(address: string, options = {}) {
    throw new Error('Not implemented.');
  }

  getUtxos(options = {}) {
    throw new Error('Not implemented.');
  }

  consolidateUtxos(destinationAddress: string, options = {}) {
    throw new Error('Not implemented.');
  }

  createNewToken(name: string, symbol: string, amount: number, options = { address: null, changeAddress: null }) {
    throw new Error('Not implemented.');
  }

  mintTokens(token: string, amount: number, options = { address: null, changeAddress: null }) {
    throw new Error('Not implemented.');
  }

  meltTokens(token: string, amount: number, options = { depositAddress: null, changeAddress: null }) {
    throw new Error('Not implemented.');
  }
}

export default HathorWalletServiceWallet;
