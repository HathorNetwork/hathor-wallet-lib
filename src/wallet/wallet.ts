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
import P2PKH from '../models/p2pkh';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Output from '../models/output';
import Input from '../models/input';
import Address from '../models/address';
import Network from '../models/network';
import networkInstance from '../network';
import MineTransaction from './mineTransaction';
import SendTransactionWalletService from './sendTransactionWalletService';
import { shuffle } from 'lodash';
import bitcore from 'bitcore-lib';
import {
  AddressInfoObject,
  GetBalanceObject,
  GetAddressesObject,
  GetHistoryObject,
  SendManyTxOptionsParam,
  SendTxOptionsParam,
  WalletStatus,
  Utxo,
  OutputRequestObj,
  InputRequestObj,
  SendTransactionEvents,
  SendTransactionResponse,
  TransactionFullObject,
  IHathorWallet
} from './types';
import { SendTxError, UtxoError, WalletRequestError, WalletError } from '../errors';
import { ErrorMessages } from '../errorMessages';

// Time in milliseconds berween each polling to check wallet status
// if it ended loading and became ready
const WALLET_STATUS_POLLING_INTERVAL = 3000;

enum walletState {
  NOT_STARTED = 'Not started',
  LOADING = 'Loading',
  READY = 'Ready',
}

class HathorWalletServiceWallet extends EventEmitter implements IHathorWallet {
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
    networkInstance.setNetwork(this.network.name);

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
      } else if (data.status === 'ready') {
        await this.onWalletReady();
      } else {
        throw new WalletRequestError(ErrorMessages.WALLET_STATUS_ERROR);
      }
    }

    const data = await walletApi.createWallet(this, this.xpub, firstAddress);
    await handleCreate(data.status);
  }

  onNewTx(wsData) {

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
  async * getAllAddresses(): AsyncGenerator<GetAddressesObject> {
    this.failIfWalletNotReady();
    const data = await walletApi.getAddresses(this);
    for (const address of data.addresses) {
      yield address;
    }
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

  async getTokens(): Promise<string[]> {
    this.failIfWalletNotReady();
    const data = await walletApi.getTokens(this);
    return data.tokens;
  }

  /**
   * Get the history of the wallet for a specific token
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getTxHistory(options: { token_id?: string, count?: number, skip?: number } = {}): Promise<GetHistoryObject[]> {
    this.failIfWalletNotReady();
    const data = await walletApi.getHistory(this, options);
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
      const data = await walletApi.createAuthToken(this, timestampNow, this.xpub!, sign);
      this.authToken = data.token;
    }
  }

  /**
   * Creates and send a transaction from an array of inputs and outputs
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async sendManyOutputsTransaction(outputs: OutputRequestObj[], options: { inputs?: InputRequestObj[], changeAddress?: string } = {}): Promise<Transaction> {
    this.failIfWalletNotReady();
    const newOptions = Object.assign({
      inputs: [],
      changeAddress: null
    }, options);
    const { inputs, changeAddress } = newOptions;
    const sendTransaction = new SendTransactionWalletService(this, { outputs, inputs, changeAddress });
    return sendTransaction.run();
  }

  /**
   * Creates and send a simple transaction with one output
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async sendTransaction(address: string, value: number, options: { token?: string, changeAddress?: string } = {}): Promise<Transaction> {
    this.failIfWalletNotReady();
    const newOptions = Object.assign({
      token: '00',
      changeAddress: null
    }, options);
    const { token, changeAddress } = newOptions;
    const outputs = [{ address, value, token }];
    return this.sendManyOutputsTransaction(outputs, { inputs: [], changeAddress });
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

  getFullHistory(): TransactionFullObject[] {
    throw new WalletError('Not implemented.');
  }

  /**
   * Create SendTransaction object and run from mining
   * Returns a promise that resolves when the send succeeds
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async handleSendPreparedTransaction(transaction: Transaction): Promise<Transaction> {
    const sendTransaction = new SendTransactionWalletService(this, { transaction });
    return sendTransaction.runFromMining();
  }

  /**
   * Prepare create new token data, sign the inputs and returns an object ready to be mined
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareCreateNewToken(name: string, symbol: string, amount: number, options = {}): Promise<CreateTokenTransaction>  {
    this.failIfWalletNotReady();
    type optionsType = {
      address: string | null,
      changeAddress: string | null,
      createMintAuthority: boolean,
      createMeltAuthority: boolean,
      nftData: string | null,
    };
    const newOptions: optionsType = Object.assign({
      address: null,
      changeAddress: null,
      createMintAuthority: true,
      createMeltAuthority: true,
      nftData: null,
    }, options);

    const isNFT = newOptions.nftData !== null;

    // 1. Calculate HTR deposit needed
    let deposit = tokens.getDepositAmount(amount);

    if (isNFT) {
      // For NFT we have a fee of 0.01 HTR, then the deposit utxo query must get an additional 1
      deposit += 1;
    }

    // 2. Get utxos for HTR
    const { utxos, changeAmount } = await this.getUtxos({ tokenId: HATHOR_TOKEN_CONFIG.uid, totalAmount: deposit });
    if (utxos.length === 0) {
      throw new UtxoError(`No utxos available to fill the request. Token: HTR - Amount: ${deposit}.`);
    }

    const utxosAddressPath: string[] = [];
    // 3. Create the transaction object with the inputs and outputs (new token amount, change address with HTR, mint/melt authorities - depending on parameters)
    const inputsObj: Input[] = [];
    for (const utxo of utxos) {
      inputsObj.push(new Input(utxo.txId, utxo.index));
      utxosAddressPath.push(utxo.addressPath);
    }

    // Create outputs
    const outputsObj: Output[] = [];
    // NFT transactions must have the first output as the script data
    if (isNFT) {
      outputsObj.push(helpers.createNFTOutput(newOptions.nftData!));
    }
    // a. Token amount
    const addressToUse = newOptions.address || this.getCurrentAddress({ markAsUsed: true }).address;
    const address = new Address(addressToUse, {network: this.network});
    if (!address.isValid()) {
      throw new SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    const p2pkh = new P2PKH(address);
    const p2pkhScript = p2pkh.createScript()
    outputsObj.push(new Output(amount, p2pkhScript, {tokenData: 1}));

    if (newOptions.createMintAuthority) {
      // b. Mint authority
      outputsObj.push(new Output(TOKEN_MINT_MASK, p2pkhScript, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (newOptions.createMeltAuthority) {
      // c. Melt authority
      outputsObj.push(new Output(TOKEN_MELT_MASK, p2pkhScript, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (changeAmount) {
      // d. HTR change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, {network: this.network});
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new P2PKH(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript()
      outputsObj.push(new Output(changeAmount, p2pkhChangeScript));
    }

    const tx = new CreateTokenTransaction(name, symbol, inputsObj, outputsObj);

    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      const inputData = this.getInputData(dataToSignHash, utxosAddressPath[idx]);
      inputObj.setData(inputData);
    }

    tx.prepareToSend();
    return tx;
  }

  /**
   * Create a new custom token in the network
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async createNewToken(name: string, symbol: string, amount: number, options = {}): Promise<Transaction>  {
    this.failIfWalletNotReady();
    const tx = await this.prepareCreateNewToken(name, symbol, amount, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare mint token data, sign the inputs and returns an object ready to be mined
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareMintTokensData(token: string, amount: number, options = {}): Promise<Transaction> {
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
    const p2pkh = new P2PKH(address);
    const p2pkhScript = p2pkh.createScript()
    outputsObj.push(new Output(amount, p2pkhScript, {tokenData: 1}));

    if (newOptions.createAnotherMint) {
      // b. Mint authority
      outputsObj.push(new Output(TOKEN_MINT_MASK, p2pkhScript, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (changeAmount) {
      // c. HTR change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, {network: this.network});
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new P2PKH(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript()
      outputsObj.push(new Output(changeAmount, p2pkhChangeScript));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // We have an array of utxos and the last input is the one with the authority
      const addressPath = idx === tx.inputs.length - 1 ? mintUtxo.addressPath : utxos[idx].addressPath;
      const inputData = this.getInputData(dataToSignHash, addressPath);
      inputObj.setData(inputData);
    }

    tx.prepareToSend();
    return tx;
  }

  /**
   * Mint new token units
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async mintTokens(token: string, amount: number, options = {}): Promise<Transaction> {
    this.failIfWalletNotReady();
    const tx = await this.prepareMintTokensData(token, amount, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare melt token data, sign the inputs and returns an object ready to be mined
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareMeltTokensData(token: string, amount: number, options = {}): Promise<Transaction> {
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
    const p2pkh = new P2PKH(address);
    const p2pkhScript = p2pkh.createScript()
    if (withdraw) {
      // We may have nothing to get back
      outputsObj.push(new Output(withdraw, p2pkhScript, {tokenData: 0}));
    }

    if (newOptions.createAnotherMelt) {
      // b. Mint authority
      outputsObj.push(new Output(TOKEN_MELT_MASK, p2pkhScript, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    if (changeAmount) {
      // c. Token change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, {network: this.network});
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new P2PKH(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript()
      outputsObj.push(new Output(changeAmount, p2pkhChangeScript, {tokenData: 1}));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // We have an array of utxos and the last input is the one with the authority
      const addressPath = idx === tx.inputs.length - 1 ? meltUtxo.addressPath : utxos[idx].addressPath;
      const inputData = this.getInputData(dataToSignHash, addressPath);
      inputObj.setData(inputData);
    }

    tx.prepareToSend();
    return tx;
  }

  /**
   * Melt custom token units
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async meltTokens(token: string, amount: number, options = {}): Promise<Transaction> {
    this.failIfWalletNotReady();
    const tx = await this.prepareMeltTokensData(token, amount, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare delegate authority data, sign the inputs and returns an object ready to be mined
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareDelegateAuthorityData(token: string, type: string, address: string, options = {}): Promise<Transaction> {
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

    const p2pkh = new P2PKH(addressObj);
    const p2pkhScript = p2pkh.createScript()
    outputsObj.push(new Output(mask, p2pkhScript, {tokenData: AUTHORITY_TOKEN_DATA}));

    if (newOptions.createAnotherAuthority) {
      const anotherAddressStr = newOptions.anotherAuthorityAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const anotherAddress = new Address(anotherAddressStr, {network: this.network});
      if (!anotherAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.anotherAuthorityAddress} is not valid.`);
      }
      const p2pkhAnotherAddress = new P2PKH(anotherAddress);
      const p2pkhAnotherAddressScript = p2pkhAnotherAddress.createScript()
      outputsObj.push(new Output(mask, p2pkhAnotherAddressScript, {tokenData: AUTHORITY_TOKEN_DATA}));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();
    const inputData = this.getInputData(dataToSignHash, utxo.addressPath);
    inputsObj[0].setData(inputData);

    tx.prepareToSend();
    return tx;
  }

  /**
   * Transfer (delegate) authority outputs to another address
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async delegateAuthority(token: string, type: string, address: string, options = {}): Promise<Transaction> {
    this.failIfWalletNotReady();
    const tx = await this.prepareDelegateAuthorityData(token, type, address, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Destroy authority outputs
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareDestroyAuthorityData(token: string, type: string, count: number): Promise<Transaction> {
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

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();

    for (const [idx, inputObj] of tx.inputs.entries()) {
      const inputData = this.getInputData(dataToSignHash, ret.utxos[idx].addressPath);
      inputObj.setData(inputData);
    }

    tx.prepareToSend();
    return tx;
  }

  /**
   * Destroy authority outputs
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async destroyAuthority(token: string, type: string, count: number): Promise<Transaction> {
    this.failIfWalletNotReady();
    const tx = await this.prepareDestroyAuthorityData(token, type, count);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Create an NFT in the network
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async createNFT(name: string, symbol: string, amount: number, data: string, options = {}): Promise<Transaction>  {
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
      createMintAuthority: false,
      createMeltAuthority: false,
    }, options);
    newOptions['nftData'] = data;
    const tx = await this.prepareCreateNewToken(name, symbol, amount, newOptions);
    return this.handleSendPreparedTransaction(tx);
  }
}

export default HathorWalletServiceWallet;
