/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { HATHOR_BIP44_CODE, HATHOR_TOKEN_CONFIG, TOKEN_MINT_MASK, AUTHORITY_TOKEN_DATA, TOKEN_MELT_MASK } from '../constants';
import Mnemonic from 'bitcore-mnemonic';
import { crypto as cryptoBL, util, Address as bitcoreAddress } from 'bitcore-lib';
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
import crypto from 'crypto';

// Time in milliseconds berween each polling to check wallet status
// if it ended loading and became ready
const WALLET_STATUS_POLLING_TIMEOUT = 3000;

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
    const xpub = wallet.getXPubKeyFromSeed(this.seed, {passphrase: this.passphrase, networkName: this.network.name});
    this.xpub = xpub;
    const handleCreate = async (data) => {
      this.walletId = data.walletId;
      if (data.status === 'creating') {
        await this.startPollingStatus();
      } else {
        this.setState(walletState.READY);
      }
    }
    try {
      const res = await walletApi.createWallet(this.xpub);
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
  async startPollingStatus() {
    try {
      await this.validateAndRenewAuthToken();
      const res = await walletApi.getWalletStatus(this.authToken!);
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

  /**
   * Get all addresses of the wallet
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAllAddresses(): Promise<string[]> {
    await this.validateAndRenewAuthToken();
    const response = await walletApi.getAddresses(this.authToken!);
    let addresses = [];
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
  async getBalance(token: string | null = null) {
    await this.validateAndRenewAuthToken();
    const response = await walletApi.getBalances(this.authToken!, token);
    let balance = null;
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
  async getTxHistory(options: { token?: string } = {}) {
    // TODO Add pagination parameters
    const requestOptions = Object.assign({ token: null }, options);
    const { token } = requestOptions;
    await this.validateAndRenewAuthToken();
    const response = await walletApi.getHistory(this.authToken!, token);
    let history = []
    if (response.status === 200 && response.data.success === true) {
      history = response.data.history;
    } else {
      // TODO What error should be handled here?
    }
    return history
  }

  /**
   * Get utxos for filling a transaction
   *
   * @memberof HathorWallet
   * @inner
   */
  async getUtxos(options: { tokenId?: string, authority?: number, addresses?: string[], totalAmount?: number, count?: number } = {}) {
    const newOptions = Object.assign({
      tokenId: HATHOR_TOKEN_CONFIG.uid,
      authority: null,
      address: null,
      totalAmount: null,
      count: 1,
    }, options);

    // @ts-ignore
    if (!newOptions.authority && !newOptions.totalAmount) {
      throw new Error('We need the total amount of utxos if it\'s not an authority request.');
    }

    // @ts-ignore
    newOptions['ignoreLocked'] = true;

    await this.validateAndRenewAuthToken();
    const response = await walletApi.getUtxos(this.authToken!, newOptions);
    let changeAmount = 0;
    let utxos = []
    if (response.status === 200 && response.data.success === true) {
      const retUtxos = response.data.utxos;
      if (retUtxos.length === 0) {
        // No utxos available for the requested filter
        utxos = retUtxos;
      // @ts-ignore
      } else if (newOptions.authority) {
        // Requests an authority utxo, then I return the count of requested authority utxos
        // @ts-ignore
        utxos = retUtxos.slice(0, newOptions.count);
      } else {
        // We got an array of utxos, then we must check if there is enough amount to fill the totalAmount
        // and slice the least possible utxos
        // @ts-ignore
        const ret = transaction.selectUtxos(retUtxos, newOptions.totalAmount);
        changeAmount = ret.changeAmount;
        utxos = ret.utxos;
      }
    } else {
      // TODO What error should be handled here?
    }
    return { utxos, changeAmount };
  }

  getAuthSign(timestamp: number) {
    const xpriv = wallet.getXPrivKeyFromSeed(this.seed, {passphrase: this.passphrase, networkName: this.network.name});
    const derivedPrivKey = wallet.deriveXpriv(xpriv, '0\'');
    const address = derivedPrivKey.publicKey.toAddress(this.network.getNetwork()).toString();
    // walletId == sha256sha256 of xpubkey as hex
    const hash1 = crypto.createHash('sha256');
    hash1.update(this.xpub!);
    const hash2 = crypto.createHash('sha256');
    hash2.update(hash1.digest());
    const walletId = hash2.digest('hex');

    const message = new bitcore.Message(String(timestamp).concat(walletId).concat(address));

    return message.sign(derivedPrivKey.privateKey);
  }

  // TODO docstring and typing
  async validateAndRenewAuthToken() {
    const now = new Date();
    const timestampNow = Math.floor(now.getTime() / 1000);

    const validateJWTExpireDate = (token) => {
      // TODO Try catch errors in token parse
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
      const sign = this.getAuthSign(timestampNow);
      const response = await walletApi.createAuthToken(timestampNow, this.xpub!, sign);
      if (response.status === 200 && response.data.success === true) {
        this.authToken = response.data.token;
      }
    }
  }

  /**
   * Send a transaction from an array of outputs and inputs
   *
   * @memberof HathorWallet
   * @inner
   */
  async sendManyOutputsTransaction(outputs, options = { inputs: [], changeAddress: null }) {
    return await this.createAndSendTx(outputs, options);
  }

  /**
   * Send a transaction to a single output
   *
   * @memberof HathorWallet
   * @inner
   */
  async sendTransaction(address, value, options: { token: string | null, changeAddress: string | null } = { token: '00', changeAddress: null }) {
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
   * @memberof HathorWallet
   * @inner
   */
  async createAndSendTx(outputs, options = { inputs: [], changeAddress: null }) {
    const newOptions = Object.assign({
      inputs: [],
      changeAddress: null
    }, options);
    const { inputs, changeAddress } = newOptions;


    // We get the full amount for each token
    // This is useful for (i) getting the utxos for each one
    // in case it's not sent and (ii) create the token array of the tx
    const amountTokenMap = {};
    for (const output of outputs) {
      if (output.token in amountTokenMap) {
        amountTokenMap[output.token] += output.value;
      } else {
        amountTokenMap[output.token] = output.value;
      }
    }

    // We need this array to get the addressPath for each input used and be able to sign the input data
    const utxosAddressPath = [];
    if (inputs.length === 0) {
      // Need to get utxos
      // We already know the full amount for each token
      // Now we can get the utxos and (if needed) change amount for each token
      for (const token in amountTokenMap) {
        const { utxos, changeAmount } = await this.getUtxos({ tokenId: token, totalAmount: amountTokenMap[token] });
        // TODO handle no utxos error

        for (const utxo of utxos) {
          // @ts-ignore
          inputs.push({ txId: utxo.txId, index: utxo.index });
          // @ts-ignore
          utxosAddressPath.push(utxo.addressPath);
        }

        if (changeAmount) {
          // TODO Get change address from wallet service if null
          outputs.push({ address: changeAddress, value: changeAmount, token });
        }
      }

      outputs = shuffle(outputs);
    }

    const tokens = Object.keys(amountTokenMap);
    const htrIndex = tokens.indexOf(HATHOR_TOKEN_CONFIG.uid);
    if (htrIndex > -1) {
      tokens.splice(htrIndex, 1);
    }

    const inputsObj: Input[] = [];
    for (const i of inputs) {
      // @ts-ignore
      inputsObj.push(new Input(i.txId, i.index));
    }

    const outputsObj: Output[] = [];
    for (const o of outputs) {
      const address = new Address(o.address, { network: this.network });
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

    await this.executeSendTransaction(tx);
  }

  /**
   * Calculate input data from dataToSign and addressPath
   * Get the private key corresponding to the addressPath,
   * calculate the signature and add the public key
   *
   * @memberof HathorWallet
   * @inner
   */
  getInputData(dataToSignHash: Buffer, addressPath: string): Buffer {
    const code = new Mnemonic(this.seed);
    const xpriv = code.toHDPrivateKey(this.passphrase, this.network.bitcoreNetwork);
    const derivedKey = xpriv.deriveNonCompliantChild(addressPath);
    const privateKey = derivedKey.privateKey;

    const sig = cryptoBL.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
      nhashtype: cryptoBL.Signature.SIGHASH_ALL
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
  async executeSendTransaction(transaction: Transaction) {
    const mineTransaction = new MineTransaction(transaction);
    mineTransaction.start();

    const data = await Promise.resolve(mineTransaction.promise);

    transaction.parents = data.parents;
    transaction.timestamp = data.timestamp;
    transaction.nonce = data.nonce;
    transaction.weight = data.weight;

    const txHex = transaction.toHex();

    await this.validateAndRenewAuthToken();
    const response = await walletApi.createTxProposal(this.authToken!, txHex);
    if (response.status === 201) {
      const responseData = response.data;
      this.txProposalId = responseData.txProposalId;
      await this.validateAndRenewAuthToken();
      const sendResponse = await walletApi.updateTxProposal(this.authToken!, this.txProposalId!, txHex);
      if (response.status === 200) {
        return sendResponse.data;
      } else {
        // TODO What error should be handled here?
      }
    } else {
      // TODO What error should be handled here?
    }
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
  setState(state: string) {
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
    const privkey = xpriv.deriveNonCompliantChild(`m/44'/${HATHOR_BIP44_CODE}'/0'/0`);
    const key = privkey.deriveNonCompliantChild(index);
    const address = bitcoreAddress(key.publicKey, this.network.getNetwork());
    return address.toString();
  }

  getCurrentAddress() {
    throw new Error('Not implemented.');
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

  consolidateUtxos(destinationAddress: string, options = {}) {
    throw new Error('Not implemented.');
  }

  async createNewToken(name: string, symbol: string, amount: number, options = {}) {
    const defaultOptions = {
      address: null,
      changeAddress: null,
      createMintAuthority: true,
      createMeltAuthority: true,
    };
    const newOptions = Object.assign(defaultOptions, options);

    // 1. Calculate HTR deposit needed
    const deposit = tokens.getDepositAmount(amount);

    // 2. Get utxos for HTR
    const { utxos, changeAmount } = await this.getUtxos({ tokenId: HATHOR_TOKEN_CONFIG.uid, totalAmount: deposit });

    // 3. Create the transaction object with the inputs and outputs (new token amount, change address with HTR, mint/melt authorities - depending on parameters)
    const inputsObj: Input[] = [];
    for (const utxo of utxos) {
      // @ts-ignore
      inputsObj.push(new Input(utxo.txId, utxo.index));
    }

    // Create outputs
    const outputsObj: Output[] = [];
    // a. Token amount
    // TODO get address to use from wallet service if it's null
    // @ts-ignore
    const address = new Address(newOptions.address, {network: this.network});
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
      // TODO get address to use from wallet service if it's null
      // @ts-ignore
      const changeAddress = new Address(newOptions.changeAddress, {network: this.network});
      outputsObj.push(new Output(changeAmount, changeAddress));
    }


    const tx = new CreateTokenTransaction(name, symbol, inputsObj, outputsObj);
    tx.prepareToSend();
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // @ts-ignore
      const inputData = this.getInputData(dataToSignHash, utxos[idx].addressPath);
      inputObj.setData(inputData);
    }

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }

  async mintTokens(token: string, amount: number, options = {}) {
    const defaultOptions = {
      address: null,
      changeAddress: null,
      createAnotherMint: true,
    };
    const newOptions = Object.assign(defaultOptions, options);

    // 1. Calculate HTR deposit needed
    const deposit = tokens.getDepositAmount(amount);

    // 2. Get utxos for HTR
    const { utxos, changeAmount } = await this.getUtxos({ tokenId: HATHOR_TOKEN_CONFIG.uid, totalAmount: deposit });
    // TODO handle utxos array being empty

    // 3. Get mint authority
    // @ts-ignore
    const ret = await this.getUtxos({ tokenId: token, authority: 1 });
    // TODO handle no authority utxo
    // it's safe to assume that we have an utxo in the array
    const mintUtxo = ret.utxos[0];

    // 4. Create inputs from utxos
    const inputsObj: Input[] = [];
    for (const utxo of utxos) {
      // First add HTR utxos
      // @ts-ignore
      inputsObj.push(new Input(utxo.txId, utxo.index));
    }

    // Then add a single mint authority utxo
    // @ts-ignore
    inputsObj.push(new Input(mintUtxo.txId, mintUtxo.index));

    // Create outputs
    const outputsObj: Output[] = [];
    // a. Token amount
    // TODO get address to use from wallet service if it's null
    // @ts-ignore
    const address = new Address(newOptions.address, {network: this.network});
    outputsObj.push(new Output(amount, address, {tokenData: 1}));

    if (newOptions.createAnotherMint) {
      // b. Mint authority
      outputsObj.push(new Output(TOKEN_MINT_MASK, address, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (changeAmount) {
      // c. HTR change output
      // TODO get address to use from wallet service if it's null
      // @ts-ignore
      const changeAddress = new Address(newOptions.changeAddress, {network: this.network});
      outputsObj.push(new Output(changeAmount, changeAddress));
    }


    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];
    tx.prepareToSend();
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // We have an array of utxos and the last input is the one with the authority
      // @ts-ignore
      const addressPath = idx === tx.inputs.length - 1 ? mintUtxo.addressPath : utxos[idx].addressPath;
      // @ts-ignore
      const inputData = this.getInputData(dataToSignHash, addressPath);
      inputObj.setData(inputData);
    }

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }

  async meltTokens(token: string, amount: number, options = {}) {
    const defaultOptions = {
      address: null, // address to send the deposit HTR back
      changeAddress: null, // change address of custom token after melt
      createAnotherMelt: true,
    };
    const newOptions = Object.assign(defaultOptions, options);

    // 1. Get utxos for HTR deposit and a mint utxo
    // 2. Calculate HTR deposit back
    // 3. Create the transaction object with the inputs (Custom token + melt authority) and outputs (HTR deposit amount back - if there is any, change address with custom token, melt authority - depending on parameters)
    // 4. Send tx proposal with create and send
    // 1. Calculate HTR deposit needed
    const withdraw = tokens.getWithdrawAmount(amount);

    // 2. Get utxos for custom token to melt
    const { utxos, changeAmount } = await this.getUtxos({ tokenId: token, totalAmount: amount });
    // TODO handle utxos array being empty

    // 3. Get mint authority
      // @ts-ignore
    const ret = await this.getUtxos({ tokenId: token, authority: 2 });
    // TODO handle no authority utxo
    // it's safe to assume that we have an utxo in the array
    const meltUtxo = ret.utxos[0];
    // TODO handle no authority utxo

    // 4. Create inputs from utxos
    const inputsObj: Input[] = [];
    for (const utxo of utxos) {
      // First add HTR utxos
      // @ts-ignore
      inputsObj.push(new Input(utxo.txId, utxo.index));
    }

    // Then add a single mint authority utxo (it's safe to assume that we have an utxo in the array)
    // @ts-ignore
    inputsObj.push(new Input(meltUtxo.txId, meltUtxo.index));

    // Create outputs
    const outputsObj: Output[] = [];
    // a. Deposit back
    // TODO get address to use from wallet service if it's null
    // @ts-ignore
    const address = new Address(newOptions.address, {network: this.network});
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
      // TODO get address to use from wallet service if it's null
      // @ts-ignore
      const changeAddress = new Address(newOptions.changeAddress, {network: this.network});
      outputsObj.push(new Output(changeAmount, changeAddress, {tokenData: 1}));
    }


    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];
    tx.prepareToSend();
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // We have an array of utxos and the last input is the one with the authority
      // @ts-ignore
      const addressPath = idx === tx.inputs.length - 1 ? meltUtxo.addressPath : utxos[idx].addressPath;
      // @ts-ignore
      const inputData = this.getInputData(dataToSignHash, addressPath);
      inputObj.setData(inputData);
    }

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }

  async delegateAuthority(token, type, address, options = {}) {
    const defaultOptions = {
      anotherAddress: null,
      createAnother: true,
    };
    const newOptions = Object.assign(defaultOptions, options);

    let authority, mask;
    if (type === 'mint') {
      authority = 1;
      mask = TOKEN_MINT_MASK;
    } else if (type === 'melt') {
      authority = 2;
      mask = TOKEN_MELT_MASK;
    } else {
      throw new Error('This should never happen.')
    }

    // 1. Get authority utxo to spend
    const ret = await this.getUtxos({ tokenId: token, authority });
    // TODO handle no authority utxo
    // it's safe to assume that we have an utxo in the array
    const utxo = ret.utxos[0];

    // 2. Create input from utxo
    const inputsObj: Input[] = [];
    // @ts-ignore
    inputsObj.push(new Input(utxo.txId, utxo.index));

    // Create outputs
    const outputsObj: Output[] = [];
    // @ts-ignore
    const addressObj = new Address(address, {network: this.network});

    outputsObj.push(new Output(mask, addressObj, {tokenData: AUTHORITY_TOKEN_DATA}));

    if (newOptions.createAnother) {
      // TODO get anotherAddress to use from wallet service if it's null
      // @ts-ignore
      const anotherAddress = new Address(newOptions.anotherAddress, {network: this.network});
      outputsObj.push(new Output(mask, anotherAddress, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];
    tx.prepareToSend();

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();
    // @ts-ignore
    const inputData = this.getInputData(dataToSignHash, utxo.addressPath);
    inputsObj[0].setData(inputData);

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }

  async destroyAuthority(token, type, count) {
    let authority, mask;
    if (type === 'mint') {
      authority = 1;
      mask = TOKEN_MINT_MASK;
    } else if (type === 'melt') {
      authority = 2;
      mask = TOKEN_MELT_MASK;
    } else {
      throw new Error('This should never happen.')
    }

    // 1. Get authority utxo to spend
    const ret = await this.getUtxos({ tokenId: token, authority, count });
    // TODO handle qty of authorities < count

    // 1. Create input from utxo
    const inputsObj: Input[] = [];
    for (const utxo of ret.utxos) {
      // @ts-ignore
      inputsObj.push(new Input(utxo.txId, utxo.index));
    }

    // No outputs because we are just destroying the authority utxos

    const tx = new Transaction(inputsObj, []);
    tx.tokens = [token];
    tx.prepareToSend();

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // @ts-ignore
      const inputData = this.getInputData(dataToSignHash, ret.utxos[idx].addressPath);
      inputObj.setData(inputData);
    }

    // 4. Send tx proposal with create and send
    return await this.executeSendTransaction(tx);
  }
}

export default HathorWalletServiceWallet;
