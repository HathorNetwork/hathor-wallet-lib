/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { HATHOR_BIP44_CODE, HATHOR_TOKEN_CONFIG, TOKEN_MINT_MASK, AUTHORITY_TOKEN_DATA, TOKEN_MELT_MASK } from '../constants';
import Mnemonic from 'bitcore-mnemonic';
import { crypto, util, Address as bitcoreAddress } from 'bitcore-lib';
import walletApi from './api/walletApi';
import wallet from '../utils/wallet';
import helpers from '../utils/helpers';
import transaction from '../utils/transaction';
import tokens from '../utils/tokens';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Output from '../models/output';
import Input from '../models/input';
import Address from '../models/address';
import Network from '../models/network';
import MineTransaction from './mineTransaction';
import { shuffle } from 'lodash';
import bitcore from 'bitcore-lib';
import {
  AddressInfoObject,
  GetBalanceObject,
  GetAddressesObject,
  GetHistoryObject,
  TxProposalUpdateResponseData,
  SendManyTxOptionsParam,
  SendTxOptionsParam,
  WalletStatus,
  Utxo,
  OutputRequestObj,
  InputRequestObj
} from './types';
import { SendTxError, UtxoError, WalletRequestError, WalletError } from '../errors';

// Time in milliseconds berween each polling to check wallet status
// if it ended loading and became ready
const WALLET_STATUS_POLLING_INTERVAL = 3000;

enum walletState {
  NOT_STARTED = 'Not started',
  LOADING = 'Loading',
  READY = 'Ready',
}

class HathorWalletServiceWallet extends EventEmitter {
  // String with 24 words separated by space
  seed: string;
  // String with wallet passphrase
  passphrase: string;
  // Wallet id from the wallet service
  walletId: string | null;
  // Network in which the wallet is connected ('mainnet' or 'testnet')
  network: Network
  // Xpub of the wallet
  private xpub: string | null
  // State of the wallet. One of the walletState enum options
  private state: string
  // Variable to prevent start sending more than one tx concurrently
  private isSendingTx: boolean
  // ID of tx proposal
  private txProposalId: string | null
  // Auth token to be used in the wallet API requests to wallet service
  private authToken: string | null
  // Wallet status interval
  private walletStatusInterval: ReturnType<typeof setInterval> | null
  // Variable to store the possible addresses to use that are after the last used address
  private newAddresses: AddressInfoObject[]
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
    this.txProposalId = null;
    this.xpub = null;

    this.network = network;

    this.authToken = null;
    this.walletStatusInterval = null;

    // TODO When we integrate the real time events from the wallet service
    // we will need to have a trigger to update this array every new transaction
    // because the new tx might have used one of those addresses
    // so we just need to call await this.getNewAddresses(); on the new tx event
    this.newAddresses = [];
    this.indexToUse = -1;
    // TODO should we have a debug mode?
  }

  /**
   * Start wallet: load the wallet data, update state and start polling wallet status until it's ready
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async start() {
    this.setState(walletState.LOADING);
    const xpub = wallet.getXPubKeyFromSeed(this.seed, {passphrase: this.passphrase, networkName: this.network.name});
    const xpubChangeDerivation = wallet.xpubDeriveChild(xpub, 0);
    const firstAddress = wallet.getAddressAtIndex(xpubChangeDerivation, 0, this.network.name);
    this.xpub = xpub;
    const handleCreate = async (data: WalletStatus) => {
      this.walletId = data.walletId;
      if (data.status === 'creating') {
        this.walletStatusInterval = setInterval(async () => {
          await this.startPollingStatus();
        }, WALLET_STATUS_POLLING_INTERVAL);
      } else {
        await this.onWalletReady();
      }
    }

    const data = await walletApi.createWallet(this.xpub, firstAddress);
    await handleCreate(data.status);
  }

  /**
   * Return wallet auth token
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  getAuthToken(): string | null {
    return this.authToken;
  }

  /**
   * When the wallet starts, it might take some seconds for the wallet service to completely load all addresses
   * This method is responsible for polling the wallet status until it's ready
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async startPollingStatus() {
    const data = await walletApi.getWalletStatus(this);
    if (data.status.status === 'ready') {
      clearInterval(this.walletStatusInterval!);
      await this.onWalletReady();
    } else if (data.status.status !== 'creating') {
      // If it's still creating, then the setInterval must run again
      throw new WalletRequestError('Error getting wallet status.');
    }
  }

  /**
   * Check if wallet is ready and throw error if not ready
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  private failIfWalletNotReady() {
    if (!this.isReady()) {
      throw new WalletError('Wallet not ready');
    }
  }

  /**
   * Method executed when wallet is ready
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  private async onWalletReady() {
    this.setState(walletState.READY);
    await this.getNewAddresses();
  }

  /**
   * Get all addresses of the wallet
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getAllAddresses(): Promise<GetAddressesObject[]> {
    this.failIfWalletNotReady();
    const data = await walletApi.getAddresses(this);
    return data.addresses;
  }

  /**
   * Get the new addresses to be used by this wallet, i.e. the last GAP LIMIT unused addresses
   * Then it updates this.newAddresses and this.indexToUse that handle the addresses to use
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  private async getNewAddresses() {
    this.failIfWalletNotReady();
    const data = await walletApi.getNewAddresses(this);
    this.newAddresses = data.addresses;
    this.indexToUse = 0;
  }

  /**
   * Get the balance of the wallet for a specific token
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getBalance(token: string | null = null): Promise<GetBalanceObject[]> {
    this.failIfWalletNotReady();
    const data = await walletApi.getBalances(this, token);
    return data.balances;
  }

  /**
   * Get the history of the wallet for a specific token
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getTxHistory(options: { token?: string } = {}): Promise<GetHistoryObject[]> {
    // TODO Add pagination parameters
    this.failIfWalletNotReady();
    const requestOptions = Object.assign({ token: null }, options);
    const { token } = requestOptions;
    const data = await walletApi.getHistory(this, token);
    return data.history;
  }

  /**
   * Get utxo from tx id and index
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getUtxoFromId(txId: string, index: number): Promise<Utxo | null> {
    const data = await walletApi.getUtxos(this, { txId, index });
    const utxos = data.utxos;
    if (utxos.length === 0) {
      // No utxo for this txId/index or is not from the requested wallet
      return null;
    } else {
      if (utxos.length > 1) {
        throw new UtxoError(`Expected to receive only one utxo for txId ${txId} and index ${index} but received ${utxos.length}.`);
      }

      return utxos[0];
    }
  }

  /**
   * Get utxos for filling a transaction
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getUtxos(options: { tokenId?: string, authority?: number, addresses?: string[], totalAmount?: number, count?: number } = {}): Promise<{ utxos: Utxo[], changeAmount: number }> {
    type optionsType = {
      tokenId: string,
      authority: number | null,
      addresses: string[] | null,
      totalAmount: number | null,
      count: number,
      ignoreLocked: boolean,
    };
    const newOptions: optionsType = Object.assign({
      tokenId: HATHOR_TOKEN_CONFIG.uid,
      authority: null,
      addresses: null,
      totalAmount: null,
      count: 1,
    }, options);

    if (!newOptions.authority && !newOptions.totalAmount) {
      throw new UtxoError('We need the total amount of utxos if it\'s not an authority request.');
    }

    newOptions['ignoreLocked'] = true;

    const data = await walletApi.getUtxos(this, newOptions);
    let changeAmount = 0;
    let utxos: Utxo[] = []
    if (data.utxos.length === 0) {
      // No utxos available for the requested filter
      utxos = data.utxos;
    } else if (newOptions.authority) {
      // Requests an authority utxo, then I return the count of requested authority utxos
      utxos = data.utxos.slice(0, newOptions.count);
    } else {
      // We got an array of utxos, then we must check if there is enough amount to fill the totalAmount
      // and slice the least possible utxos
      const ret = transaction.selectUtxos(data.utxos, newOptions.totalAmount!);
      changeAmount = ret.changeAmount;
      utxos = ret.utxos;
    }
    return { utxos, changeAmount };
  }

  /**
   * Signs a message using xpriv derivation path m/44'/280'/0'
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  signMessage(timestamp: number): string {
    const xpriv = wallet.getXPrivKeyFromSeed(this.seed, {passphrase: this.passphrase, networkName: this.network.name});
    const derivedPrivKey = wallet.deriveXpriv(xpriv, '0\'');
    const address = derivedPrivKey.publicKey.toAddress(this.network.getNetwork()).toString();

    const message = new bitcore.Message(String(timestamp).concat(this.walletId!).concat(address));

    return message.sign(derivedPrivKey.privateKey);
  }

  /**
   * Validate that the wallet auth token is valid
   * If it's not valid, requests a new one and update
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async validateAndRenewAuthToken() {
    const now = new Date();
    const timestampNow = Math.floor(now.getTime() / 1000);

    const validateJWTExpireDate = (token) => {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace('-', '+').replace('_', '/');
      const decodedData = JSON.parse(Buffer.from(base64, 'base64').toString('binary'));

      // If the token will expire in the next 60 seconds (or has already expired)
      const delta = 60;
      if (timestampNow + delta > decodedData.exp) {
        return false;
      }

      return true;
    }

    if (!this.authToken || !validateJWTExpireDate(this.authToken)) {
      const sign = this.signMessage(timestampNow);
      const data = await walletApi.createAuthToken(timestampNow, this.xpub!, sign);
      this.authToken = data.token;
    }
  }

  /**
   * Send a transaction from an array of outputs and inputs
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async sendManyOutputsTransaction(outputs: OutputRequestObj[], options: { inputs?: InputRequestObj[], changeAddress?: string } = {}): Promise<TxProposalUpdateResponseData> {
    this.failIfWalletNotReady();
    const newOptions = Object.assign({
      inputs: [],
      changeAddress: null
    }, options);
    return await this.createAndSendTx(outputs, newOptions);
  }

  /**
   * Send a transaction to a single output
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async sendTransaction(address: string, value: number, options: { token?: string, changeAddress?: string } = {}): Promise<TxProposalUpdateResponseData> {
    this.failIfWalletNotReady();
    const newOptions = Object.assign({
      token: '00',
      changeAddress: null
    }, options);
    const { token, changeAddress } = newOptions;
    const outputs = [{ address, value, token }];
    return await this.createAndSendTx(outputs, { inputs: [], changeAddress });
  }

  /**
   * Send transaction
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async createAndSendTx(outputs: OutputRequestObj[], options: { inputs?: InputRequestObj[], changeAddress?: string } = {}): Promise<TxProposalUpdateResponseData> {
    type optionsType = {
      inputs: InputRequestObj[],
      changeAddress: string | null,
    };
    const newOptions: optionsType = Object.assign({
      inputs: [],
      changeAddress: null
    }, options);
    const { inputs } = newOptions;

    // We get the full outputs amount for each token
    // This is useful for (i) getting the utxos for each one
    // in case it's not sent and (ii) create the token array of the tx
    const amountOutputMap = {};
    for (const output of outputs) {
      if (output.token in amountOutputMap) {
        amountOutputMap[output.token] += output.value;
      } else {
        amountOutputMap[output.token] = output.value;
      }
    }

    // We need this array to get the addressPath for each input used and be able to sign the input data
    const utxosAddressPath: string[] = [];
    let changeOutputAdded = false;
    if (inputs.length === 0) {
      // Need to get utxos
      // We already know the full amount for each token
      // Now we can get the utxos and (if needed) change amount for each token
      for (const token in amountOutputMap) {
        const { utxos, changeAmount } = await this.getUtxos({ tokenId: token, totalAmount: amountOutputMap[token] });
        if (utxos.length === 0) {
          throw new UtxoError(`No utxos available to fill the request. Token: ${token} - Amount: ${amountOutputMap[token]}.`);
        }

        for (const utxo of utxos) {
          inputs.push({ txId: utxo.txId, index: utxo.index });
          utxosAddressPath.push(utxo.addressPath);
        }

        if (changeAmount) {
          changeOutputAdded = true;
          const changeAddress = newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
          outputs.push({ address: changeAddress, value: changeAmount, token });
        }
      }
    } else {
      const amountInputMap = {};
      for (const input of inputs) {
        const utxo = await this.getUtxoFromId(input.txId, input.index);
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

      for (const tokenId in amountOutputMap) {
        if (!(tokenId in amountInputMap)) {
          throw new SendTxError(`Invalid input selection. Token ${tokenId} is in the outputs but there are no inputs for it.`);
        }

        if (amountInputMap[tokenId] < amountOutputMap[tokenId]) {
          throw new SendTxError(`Invalid input selection. Sum of inputs for token ${tokenId} is smaller than the sum of outputs.`);
        }

        if (amountInputMap[tokenId] > amountOutputMap[tokenId]) {
          changeOutputAdded = true;
          const changeAmount = amountInputMap[tokenId] - amountOutputMap[tokenId];
          const changeAddress = newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
          outputs.push({ address: changeAddress, value: changeAmount, token: tokenId });
        }
      }
    }

    if (changeOutputAdded) {
      outputs = shuffle(outputs);
    }

    const tokens = Object.keys(amountOutputMap);
    const htrIndex = tokens.indexOf(HATHOR_TOKEN_CONFIG.uid);
    if (htrIndex > -1) {
      tokens.splice(htrIndex, 1);
    }

    const inputsObj: Input[] = [];
    for (const i of inputs) {
      inputsObj.push(new Input(i.txId, i.index));
    }

    const outputsObj: Output[] = [];
    for (const o of outputs) {
      const address = new Address(o.address, { network: this.network });
      if (!address.isValid()) {
        throw new SendTxError(`Address ${o.address} is not valid.`);
      }
      const tokenData = (o.token in tokens) ? tokens.indexOf(o.token) + 1 : 0;
      const outputOptions = { tokenData, timelock: o.timelock || null };
      outputsObj.push(new Output(o.value, address, outputOptions));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = tokens;
    tx.prepareToSend();
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      const inputData = this.getInputData(dataToSignHash, utxosAddressPath[idx]);
      inputObj.setData(inputData);
    }

    return await this.executeSendTransaction(tx);
  }

  /**
   * Calculate input data from dataToSign and addressPath
   * Get the private key corresponding to the addressPath,
   * calculate the signature and add the public key
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  getInputData(dataToSignHash: Buffer, addressPath: string): Buffer {
    const code = new Mnemonic(this.seed);
    const xpriv = code.toHDPrivateKey(this.passphrase, this.network.bitcoreNetwork);
    const derivedKey = xpriv.deriveNonCompliantChild(addressPath);
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
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async executeSendTransaction(transaction: Transaction): Promise<TxProposalUpdateResponseData> {
    const mineTransaction = new MineTransaction(transaction);
    mineTransaction.start();

    const data = await Promise.resolve(mineTransaction.promise);

    transaction.parents = data.parents;
    transaction.timestamp = data.timestamp;
    transaction.nonce = data.nonce;
    transaction.weight = data.weight;

    const txHex = transaction.toHex();

    const responseData = await walletApi.createTxProposal(this, txHex);
    this.txProposalId = responseData.txProposalId;
    return await walletApi.updateTxProposal(this, this.txProposalId!, txHex);
  }

  /**
   * Return if wallet is ready to be used
   *
   * @memberof HathorWalletServiceWallet
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
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  setState(state: string) {
    this.state = state;
    this.emit('state', state);
  }

  /**
   * Stop the wallet
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  stop() {
    this.walletId = null;
    this.state = walletState.NOT_STARTED;
  }

  /**
   * Get address at specific index
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  getAddressAtIndex(index: number): string {
    const code = new Mnemonic(this.seed);
    const xpriv = code.toHDPrivateKey(this.passphrase, this.network.bitcoreNetwork);
    const privkey = xpriv.deriveNonCompliantChild(`m/44'/${HATHOR_BIP44_CODE}'/0'/0`);
    const key = privkey.deriveNonCompliantChild(index);
    const address = bitcoreAddress(key.publicKey, this.network.getNetwork());
    return address.toString();
  }

  /**
   * Get the current address to be used
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  getCurrentAddress({ markAsUsed = false } = {}): AddressInfoObject {
    const newAddressesLen = this.newAddresses.length;
    if (this.indexToUse > newAddressesLen - 1) {
      const addressInfo = this.newAddresses[newAddressesLen - 1];
      return {...addressInfo, info: 'GAP_LIMIT_REACHED'};
    }

    const addressInfo = this.newAddresses[this.indexToUse];
    if (markAsUsed) {
      this.indexToUse += 1;
    }
    return addressInfo;
  }

  /**
   * Get the next address after the current available
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  getNextAddress(): AddressInfoObject {
    // First we mark the current address as used, then return the next
    this.getCurrentAddress({ markAsUsed: true });
    return this.getCurrentAddress();
  }

  getAddressIndex(address: string) {
    throw new WalletError('Not implemented.');
  }

  isAddressMine(address: string) {
    throw new WalletError('Not implemented.');
  }

  getTx(id: string) {
    throw new WalletError('Not implemented.');
  }

  getAddressInfo(address: string, options = {}) {
    throw new WalletError('Not implemented.');
  }

  consolidateUtxos(destinationAddress: string, options = {}) {
    throw new WalletError('Not implemented.');
  }

  /**
   * Create a new custom token in the network
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async createNewToken(name: string, symbol: string, amount: number, options = {}): Promise<TxProposalUpdateResponseData>  {
    this.failIfWalletNotReady();
    type optionsType = {
      address: string | null,
      changeAddress: string | null,
      createMintAuthority: boolean,
      createMeltAuthority: boolean,
    };
    const newOptions: optionsType = Object.assign({
      address: null,
      changeAddress: null,
      createMintAuthority: true,
      createMeltAuthority: true,
    }, options);

    // 1. Calculate HTR deposit needed
    const deposit = tokens.getDepositAmount(amount);

    // 2. Get utxos for HTR
    const { utxos, changeAmount } = await this.getUtxos({ tokenId: HATHOR_TOKEN_CONFIG.uid, totalAmount: deposit });
    if (utxos.length === 0) {
      throw new UtxoError(`No utxos available to fill the request. Token: HTR - Amount: ${deposit}.`);
    }

    // 3. Create the transaction object with the inputs and outputs (new token amount, change address with HTR, mint/melt authorities - depending on parameters)
    const inputsObj: Input[] = [];
    for (const utxo of utxos) {
      inputsObj.push(new Input(utxo.txId, utxo.index));
    }

    // Create outputs
    const outputsObj: Output[] = [];
    // a. Token amount
    const addressToUse = newOptions.address || this.getCurrentAddress({ markAsUsed: true }).address;
    const address = new Address(addressToUse, {network: this.network});
    if (!address.isValid()) {
      throw new SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    outputsObj.push(new Output(amount, address, {tokenData: 1}));

    if (newOptions.createMintAuthority) {
      // b. Mint authority
      outputsObj.push(new Output(TOKEN_MINT_MASK, address, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (newOptions.createMeltAuthority) {
      // c. Melt authority
      outputsObj.push(new Output(TOKEN_MELT_MASK, address, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (changeAmount) {
      // d. HTR change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, {network: this.network});
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      outputsObj.push(new Output(changeAmount, changeAddress));
    }

    const tx = new CreateTokenTransaction(name, symbol, inputsObj, outputsObj);
    tx.prepareToSend();
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      const inputData = this.getInputData(dataToSignHash, utxos[idx].addressPath);
      inputObj.setData(inputData);
    }

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }

  /**
   * Mint new token units
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async mintTokens(token: string, amount: number, options = {}): Promise<TxProposalUpdateResponseData> {
    this.failIfWalletNotReady();
    type optionsType = {
      address: string | null,
      changeAddress: string | null,
      createAnotherMint: boolean
    };
    const newOptions: optionsType = Object.assign({
      address: null,
      changeAddress: null,
      createAnotherMint: true,
    }, options);

    // 1. Calculate HTR deposit needed
    const deposit = tokens.getDepositAmount(amount);

    // 2. Get utxos for HTR
    const { utxos, changeAmount } = await this.getUtxos({ tokenId: HATHOR_TOKEN_CONFIG.uid, totalAmount: deposit });
    if (utxos.length === 0) {
      throw new UtxoError(`No utxos available to fill the request. Token: HTR - Amount: ${deposit}.`);
    }

    // 3. Get mint authority
    const ret = await this.getUtxos({ tokenId: token, authority: TOKEN_MINT_MASK });
    if (ret.utxos.length === 0) {
      throw new UtxoError(`No authority utxo available for minting tokens. Token: ${token}.`);
    }
    // it's safe to assume that we have an utxo in the array
    const mintUtxo = ret.utxos[0];

    // 4. Create inputs from utxos
    const inputsObj: Input[] = [];
    for (const utxo of utxos) {
      // First add HTR utxos
      inputsObj.push(new Input(utxo.txId, utxo.index));
    }

    // Then add a single mint authority utxo
    inputsObj.push(new Input(mintUtxo.txId, mintUtxo.index));

    // Create outputs
    const outputsObj: Output[] = [];
    // a. Token amount
    const addressToUse = newOptions.address || this.getCurrentAddress({ markAsUsed: true }).address;
    const address = new Address(addressToUse, {network: this.network});
    if (!address.isValid()) {
      throw new SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    outputsObj.push(new Output(amount, address, {tokenData: 1}));

    if (newOptions.createAnotherMint) {
      // b. Mint authority
      outputsObj.push(new Output(TOKEN_MINT_MASK, address, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (changeAmount) {
      // c. HTR change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, {network: this.network});
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      outputsObj.push(new Output(changeAmount, changeAddress));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];
    tx.prepareToSend();
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // We have an array of utxos and the last input is the one with the authority
      const addressPath = idx === tx.inputs.length - 1 ? mintUtxo.addressPath : utxos[idx].addressPath;
      const inputData = this.getInputData(dataToSignHash, addressPath);
      inputObj.setData(inputData);
    }

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }

  /**
   * Melt custom token units
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async meltTokens(token: string, amount: number, options = {}): Promise<TxProposalUpdateResponseData> {
    this.failIfWalletNotReady();
    type optionsType = {
      address: string | null,
      changeAddress: string | null,
      createAnotherMelt: boolean
    };
    const newOptions: optionsType = Object.assign({
      address: null,
      changeAddress: null,
      createAnotherMelt: true,
    }, options);

    // 1. Calculate HTR deposit needed
    const withdraw = tokens.getWithdrawAmount(amount);

    // 2. Get utxos for custom token to melt
    const { utxos, changeAmount } = await this.getUtxos({ tokenId: token, totalAmount: amount });
    if (utxos.length === 0) {
      throw new UtxoError(`Not enough tokens to be melted. Token: ${token} - Amount: ${amount}.`);
    }

    // 3. Get mint authority
    const ret = await this.getUtxos({ tokenId: token, authority: TOKEN_MELT_MASK });
    if (ret.utxos.length === 0) {
      throw new UtxoError(`No authority utxo available for melting tokens. Token: ${token}.`);
    }
    // it's safe to assume that we have an utxo in the array
    const meltUtxo = ret.utxos[0];

    // 4. Create inputs from utxos
    const inputsObj: Input[] = [];
    for (const utxo of utxos) {
      // First add HTR utxos
      inputsObj.push(new Input(utxo.txId, utxo.index));
    }

    // Then add a single mint authority utxo (it's safe to assume that we have an utxo in the array)
    inputsObj.push(new Input(meltUtxo.txId, meltUtxo.index));

    // Create outputs
    const outputsObj: Output[] = [];
    // a. Deposit back
    const addressToUse = newOptions.address || this.getCurrentAddress({ markAsUsed: true }).address;
    const address = new Address(addressToUse, {network: this.network});
    if (!address.isValid()) {
      throw new SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    if (withdraw) {
      // We may have nothing to get back
      outputsObj.push(new Output(withdraw, address, {tokenData: 0}));
    }

    if (newOptions.createAnotherMelt) {
      // b. Mint authority
      outputsObj.push(new Output(TOKEN_MELT_MASK, address, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (changeAmount) {
      // c. Token change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, {network: this.network});
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      outputsObj.push(new Output(changeAmount, changeAddress, {tokenData: 1}));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];
    tx.prepareToSend();
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // We have an array of utxos and the last input is the one with the authority
      const addressPath = idx === tx.inputs.length - 1 ? meltUtxo.addressPath : utxos[idx].addressPath;
      const inputData = this.getInputData(dataToSignHash, addressPath);
      inputObj.setData(inputData);
    }

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }

  /**
   * Transfer (delegate) authority outputs to another address
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async delegateAuthority(token: string, type: string, address: string, options = {}): Promise<TxProposalUpdateResponseData> {
    this.failIfWalletNotReady();
    type optionsType = {
      anotherAuthorityAddress: string | null,
      createAnotherAuthority: boolean
    };
    const newOptions: optionsType = Object.assign({
      anotherAuthorityAddress: null,
      createAnotherAuthority: true,
    }, options);

    let authority, mask;
    if (type === 'mint') {
      authority = 1;
      mask = TOKEN_MINT_MASK;
    } else if (type === 'melt') {
      authority = 2;
      mask = TOKEN_MELT_MASK;
    } else {
      throw new WalletError('Type options are mint and melt for delegate authority method.')
    }

    // 1. Get authority utxo to spend
    const ret = await this.getUtxos({ tokenId: token, authority });
    if (ret.utxos.length === 0) {
      throw new UtxoError(`No authority utxo available for delegating authority. Token: ${token} - Type ${type}.`);
    }
    // it's safe to assume that we have an utxo in the array
    const utxo = ret.utxos[0];

    // 2. Create input from utxo
    const inputsObj: Input[] = [];
    inputsObj.push(new Input(utxo.txId, utxo.index));

    // Create outputs
    const outputsObj: Output[] = [];
    const addressObj = new Address(address, {network: this.network});
    if (!addressObj.isValid()) {
      throw new SendTxError(`Address ${address} is not valid.`);
    }

    outputsObj.push(new Output(mask, addressObj, {tokenData: AUTHORITY_TOKEN_DATA}));

    if (newOptions.createAnotherAuthority) {
      const anotherAddressStr = newOptions.anotherAuthorityAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const anotherAddress = new Address(anotherAddressStr, {network: this.network});
      if (!anotherAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.anotherAuthorityAddress} is not valid.`);
      }
      outputsObj.push(new Output(mask, anotherAddress, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];
    tx.prepareToSend();

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();
    const inputData = this.getInputData(dataToSignHash, utxo.addressPath);
    inputsObj[0].setData(inputData);

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }

  /**
   * Destroy authority outputs
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async destroyAuthority(token: string, type: string, count: number): Promise<TxProposalUpdateResponseData> {
    this.failIfWalletNotReady();
    let authority, mask;
    if (type === 'mint') {
      authority = 1;
      mask = TOKEN_MINT_MASK;
    } else if (type === 'melt') {
      authority = 2;
      mask = TOKEN_MELT_MASK;
    } else {
      throw new WalletError('Type options are mint and melt for destroy authority method.')
    }

    // 1. Get authority utxo to spend
    const ret = await this.getUtxos({ tokenId: token, authority, count });
    if (ret.utxos.length < count) {
      throw new UtxoError(`Not enough authority utxos available for destroying. Token: ${token} - Type ${type}. Requested quantity ${count} - Available quantity ${ret.utxos.length}`);
    }

    // 1. Create input from utxo
    const inputsObj: Input[] = [];
    for (const utxo of ret.utxos) {
      inputsObj.push(new Input(utxo.txId, utxo.index));
    }

    // No outputs because we are just destroying the authority utxos

    const tx = new Transaction(inputsObj, []);
    tx.tokens = [token];
    tx.prepareToSend();

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      const inputData = this.getInputData(dataToSignHash, ret.utxos[idx].addressPath);
      inputObj.setData(inputData);
    }

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }
}

export default HathorWalletServiceWallet;
