/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { 
  HATHOR_BIP44_CODE,
  HATHOR_TOKEN_CONFIG,
  TOKEN_MINT_MASK,
  AUTHORITY_TOKEN_DATA,
  TOKEN_MELT_MASK,
  WALLET_SERVICE_AUTH_DERIVATION_PATH,
} from '../constants';
import Mnemonic from 'bitcore-mnemonic';
import { crypto, util, Address as bitcoreAddress } from 'bitcore-lib';
import wallet from '../wallet';
import walletApi from './api/walletApi';
import walletUtils from '../utils/wallet';
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
import assert from 'assert';
import WalletServiceConnection from './connection';
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
  IHathorWallet,
  WsTransaction,
  TxOutput,
  CreateWalletAuthData,
  ConnectionState,
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
  // String with wallet passphrase
  passphrase: string;
  // Wallet id from the wallet service
  walletId: string | null;
  // Network in which the wallet is connected ('mainnet' or 'testnet')
  network: Network;
  // Method to request the password from the client
  private requestPassword: Function;
  // String with 24 words separated by space
  private seed: string | null;
  // Xpub of the wallet
  private xpub: string | null;
  // Xpriv of the wallet
  private xpriv: string | null;
  // Xpriv of the auth derivation path
  private authPrivKey: bitcore.HDPrivateKey | null;
  // State of the wallet. One of the walletState enum options
  private state: string;
  // Variable to prevent start sending more than one tx concurrently
  private isSendingTx: boolean;
  // ID of tx proposal
  private txProposalId: string | null;
  // Auth token to be used in the wallet API requests to wallet service
  private authToken: string | null;
  // Wallet status interval
  // Variable to store the possible addresses to use that are after the last used address
  private newAddresses: AddressInfoObject[];
  // Index of the address to be used by the wallet
  private indexToUse: number;
  // WalletService-ready connection class
  private conn: WalletServiceConnection;
  // Flag to indicate if the wallet was already connected when the webscoket conn is established
  private firstConnection: boolean;

  constructor({
    requestPassword,
    seed,
    xpriv,
    xpub,
    network,
    passphrase = '',
  }) {
    super();

    if (!seed && !xpriv && !xpub) {
      throw Error('You must explicitly provide the seed, xpriv or the xpub.');
    }

    if (seed && xpriv) {
      throw Error('You cannot provide both a seed and an xpriv.');
    }

    if (xpriv && passphrase !== '') {
      throw Error('You can\'t use xpriv with passphrase.');
    }

    if (seed) {
      // It will throw InvalidWords error in case is not valid
      walletUtils.wordsValid(seed);
    }

    // Setup the connection so clients can listen to its events before it is started
    this.conn = new WalletServiceConnection();
    this.state = walletState.NOT_STARTED;

    this.xpriv = xpriv;
    this.seed = seed;
    this.xpub = xpub;

    this.passphrase = passphrase

    this.requestPassword = requestPassword;

    // ID of wallet after created on wallet service
    this.walletId = null;
    this.isSendingTx = false;
    this.txProposalId = null;
    this.xpub = null;
    this.authPrivKey = null;

    this.network = network;
    networkInstance.setNetwork(this.network.name);

    this.authToken = null;
    this.firstConnection = true;

    this.newAddresses = [];
    this.indexToUse = -1;
    // TODO should we have a debug mode?
  }

  /**
   * Remove sensitive data from memory
   *
   * NOTICE: This won't remove data from memory immediately, we have to wait until javascript
   * garbage collect it. JavaScript currently does not provide a standard way to trigger
   * garbage collection
   **/
  clearSensitiveData() {
    this.seed = null;
    this.authPrivKey = null;
  }

  /**
   * Get auth xpubkey from seed
   *
   * @param {String} seed 24 words
   * @param {Object} options Options with passphrase and networkName
   *
   * @return {String} auth xpubkey
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  static getAuthXPubKeyFromSeed(seed: string, options: { passphrase?: string, networkName?: string } = {}): string {
    const methodOptions = Object.assign({
      passphrase: '',
      networkName: 'mainnet',
    }, options);

    const xpriv = walletUtils.getXPrivKeyFromSeed(seed, methodOptions);
    const privkey = HathorWalletServiceWallet.deriveAuthPrivateKey(xpriv);

    return privkey.xpubkey;
  }

  /**
   * Derive private key from root to the auth specific purpose derivation path
   *
   * @param {HDPrivateKey} xpriv The wallet's root xpriv
   *
   * @return {HDPrivateKey} Derived private key at the auth derivation path
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  static deriveAuthPrivateKey(xpriv: bitcore.HDPrivateKey): bitcore.HDPrivateKey {
    const ret = xpriv.deriveNonCompliantChild(WALLET_SERVICE_AUTH_DERIVATION_PATH);

    return ret;
  }

  /**
   * getWalletIdFromXPub: Get the wallet id given the xpubkey
   *
   * @param xpub - The xpubkey
   * @returns The wallet id
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  static getWalletIdFromXPub(xpub: string) {
    return crypto.Hash.sha256sha256(Buffer.from(xpub)).toString('hex');
  }

  /**
   * Start wallet: load the wallet data, update state and start polling wallet status until it's ready
   *
   * @param {Object} optionsParams Options parameters
   *  {
   *   'pinCode': PIN to encrypt the auth xpriv on storage
   *   'password': Password to decrypt xpriv information
   *  }
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async start({ pinCode, password }) {
    if (!pinCode) {
      throw new Error('Pin code is required when starting the wallet.');
    }

    this.setState(walletState.LOADING);

    const {
      xpub,
      authXpub,
      xpubkeySignature,
      authXpubkeySignature,
      timestampNow,
      firstAddress,
      authDerivedPrivKey,
    } = this.generateCreateWalletAuthData(pinCode);

    if (this.seed) {
      wallet.executeGenerateWallet(
        this.seed,
        this.passphrase,
        pinCode,
        password,
        false,
      );
    } else if (this.xpriv) {
      // executeGenerateWalletFromXPriv expects a xpriv on the change level path
      const accountLevelPrivKey = new bitcore.HDPrivateKey(this.xpriv);
      const changeLevelPrivKey = accountLevelPrivKey.deriveNonCompliantChild(0);

      wallet.executeGenerateWalletFromXPriv(
        changeLevelPrivKey.xprivkey,
        pinCode,
        false,
        false, // multisig not yet implemented on wallet service
      );
    }

    this.xpub = xpub;
    this.authPrivKey = authDerivedPrivKey;

    const handleCreate = async (data: WalletStatus) => {
      this.walletId = data.walletId;

      if (data.status === 'creating') {
        // If the wallet status is creating, we should wait until it is ready
        // before continuing
        await this.pollForWalletStatus();
      } else if (data.status !== 'ready') {
        // At this stage, if the wallet is not `ready` or `creating` we should
        // throw an error as there are only three states: `ready`, `creating` or `error`
        throw new WalletRequestError(ErrorMessages.WALLET_STATUS_ERROR);
      }

      await this.onWalletReady();
    };

    const data = await walletApi.createWallet(
      this,
      xpub,
      xpubkeySignature,
      authXpub,
      authXpubkeySignature,
      timestampNow,
      firstAddress,
    );

    await handleCreate(data.status);

    this.clearSensitiveData();
  }

  generateCreateWalletAuthData(pinCode: string): CreateWalletAuthData {
    let xpriv: bitcore.HDPrivateKey;
    let xpub: string;
    let authXpub: string;
    let xprivAccountPath: string;
    let authDerivedPrivKey: bitcore.HDPrivateKey;

    const now = new Date();
    const timestampNow = Math.floor(now.getTime() / 1000); // in seconds

    if (this.seed) {
      xpriv = walletUtils.getXPrivKeyFromSeed(this.seed, {passphrase: this.passphrase, networkName: this.network.name});
      xpub = walletUtils.getXPubKeyFromSeed(this.seed, {passphrase: this.passphrase, networkName: this.network.name});
      authXpub = HathorWalletServiceWallet.getAuthXPubKeyFromSeed(this.seed, {
        passphrase: this.passphrase,
        networkName: this.network.name,
      });
      xprivAccountPath = walletUtils.deriveXpriv(xpriv, '0\'');
      authDerivedPrivKey = HathorWalletServiceWallet.deriveAuthPrivateKey(xpriv);
    } else if (this.xpriv) {
      // this.xpriv is already on account path
      xpriv = bitcore.HDPrivateKey(this.xpriv);
      xpub = xpriv.xpubkey;
      xprivAccountPath = xpriv;

      // If the wallet is being loaded from the xpriv, we assume we already have the authXPriv on storage, so just fetch it
      authDerivedPrivKey = wallet.getAuthPrivKey(pinCode);
      authXpub = authDerivedPrivKey.xpubkey;
    } else {
      throw new Error('generateCreateWalletAuthData called without seed or xpriv in memory.')
    }

    const walletId: string = HathorWalletServiceWallet.getWalletIdFromXPub(xpub);

    // prove we own the xpubkey
    const xpubkeySignature = this.signMessage(xprivAccountPath, timestampNow, walletId);

    // prove we own the auth_xpubkey
    const authXpubkeySignature = this.signMessage(authDerivedPrivKey, timestampNow, walletId);

    const xpubChangeDerivation = walletUtils.xpubDeriveChild(xpub, 0);
    const firstAddress = walletUtils.getAddressAtIndex(xpubChangeDerivation, 0, this.network.name);

    return {
      xpub,
      xpubkeySignature,
      authXpub,
      authXpubkeySignature,
      timestampNow,
      firstAddress,
      authDerivedPrivKey,
    };
  }

  /**
   * onUpdateTx: Event called when a transaction is updated
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  onUpdateTx(updatedTx) {
    this.emit('update-tx', updatedTx);
  }

  /**
   * onNewTx: Event called when a new transaction is received on the websocket feed
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async onNewTx(newTx: WsTransaction) {
    const outputs: TxOutput[] = newTx.outputs;
    let shouldGetNewAddresses = false;

    for (const output of outputs) {
      if (this.newAddresses.find((newAddress) => newAddress.address === output.decoded.address)) {
        // break early
        shouldGetNewAddresses = true;
        break;
      }
    }

    // We need to update the `newAddresses` array on every new transaction
    // because the new tx might have used one of those addresses and we try to guarantee
    // that every transaction uses a new address for increased privacy
    if (shouldGetNewAddresses) {
      await this.getNewAddresses();
    }

    this.emit('new-tx', newTx)
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
   * Returns the balance for each token in tx, if the input/output belongs to this wallet
   *
   * This method is meant to keep compatibility with the old facade
   *
   * @param {Object} tx Transaction data with array of inputs and outputs
   *
   * @return {Object} Object with each token and it's balance in this tx for this wallet
   **/
  async getTxBalance(tx: WsTransaction, optionsParam = {}): Promise<{[tokenId: string]: number}> {
    const options = Object.assign({ includeAuthorities: false }, optionsParam);

    const addresses: string[] = [];

    const generator = this.getAllAddresses();

    // We are not using for async (...) to maintain compatibility with older nodejs versions
    // if we ever deprecate older node versions, we can refactor this to the new, cleaner syntax
    let nextAddress;
    while (!(nextAddress = await generator.next()).done) {
      addresses.push(nextAddress.value.address);
    }

    const balance = {};
    for (const txout of tx.outputs) {
      if (wallet.isAuthorityOutput(txout)) {
        if (options.includeAuthorities) {
          if (!balance[txout.token]) {
            balance[txout.token] = 0;
          }
        }
        continue;
      }
      if (txout.decoded && txout.decoded.address
          && addresses.includes(txout.decoded.address)) {
        if (!balance[txout.token]) {
          balance[txout.token] = 0;
        }
        balance[txout.token] += txout.value;
      }
    }

    for (const txin of tx.inputs) {
      if (wallet.isAuthorityOutput(txin)) {
        if (options.includeAuthorities) {
          if (!balance[txin.token]) {
            balance[txin.token] = 0;
          }
        }
        continue;
      }
      if (txin.decoded && txin.decoded.address
          && addresses.includes(txin.decoded.address)) {
        if (!balance[txin.token]) {
          balance[txin.token] = 0;
        }
        balance[txin.token] -= txin.value;
      }
    }

    return balance;
  }

  /**
   * When the wallet starts, it might take some seconds for the wallet service to completely load all addresses
   * This method is responsible for polling the wallet status until it's ready
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async pollForWalletStatus(): Promise<void> {
    return new Promise((resolve, reject) => {
      const pollIntervalTimer = setInterval(async () => {
        const data = await walletApi.getWalletStatus(this);

        if (data.status.status === 'ready') {
          clearInterval(pollIntervalTimer);
          return resolve();
        } else if (data.status.status !== 'creating') {
          // Only possible states are 'ready', 'creating' and 'error', if status
          // is not ready or creating, we should reject the promise
          clearInterval(pollIntervalTimer);
          return reject(new WalletRequestError('Error getting wallet status.'));
        }
      }, WALLET_STATUS_POLLING_INTERVAL);
    });
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
    // We should wait for new addresses before setting wallet to ready
    await this.getNewAddresses(true);

    this.setupConnection();
    this.setState(walletState.READY);
  }

  setupConnection() {
    if (!this.walletId) {
      // This should never happen
      throw new Error('Tried to setup connection but wallet_id is not set.');
    }

    this.conn.setWalletId(this.walletId);
    this.conn.on('new-tx', (newTx: WsTransaction) => this.onNewTx(newTx));
    this.conn.on('update-tx', (updatedTx) => this.onUpdateTx(updatedTx));
    this.conn.on('state', (newState: ConnectionState) => this.onConnectionChangedState(newState));
    this.conn.start();
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   *
   * Since the wallet service facade holds no data (as opposed to
   * the old facade, where the wallet facade receives a storage object),
   * the client needs to handle the data reload, so we just emit an event
   * to indicate that a reload is necessary.
   *
   * @param {Number} newState Enum of new state after change
   **/
  onConnectionChangedState(newState: ConnectionState) {
    if (newState === ConnectionState.CONNECTED) {
      // We don't need to reload data if this is the first
      // connection
      if (!this.firstConnection) {
        this.emit('reload-data');
      }

      this.firstConnection = false;
    }
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
  private async getNewAddresses(ignoreWalletReady = false) {
    if (!ignoreWalletReady) {
      this.failIfWalletNotReady();
    }
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
  signMessage(xpriv: bitcore.HDPrivateKey, timestamp: number, walletId: string): string {
    const address = xpriv.publicKey.toAddress(this.network.getNetwork()).toString();
    const message = new bitcore.Message(String(timestamp).concat(walletId).concat(address));

    return message.sign(xpriv.privateKey);
  }

  /**
   * Validate that the wallet auth token is valid
   * If it's not valid, requests a new one and update
   *
   * @param {string} usePassword Accepts the password as a parameter so we don't have to ask
   * the client for it if we already have it in memory
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async validateAndRenewAuthToken(usePassword?: string): Promise<void> {
    if (!this.walletId) {
      throw new Error('Wallet not ready yet.');
    }

    const now = new Date();
    const timestampNow = Math.floor(now.getTime() / 1000);

    const validateJWTExpireDate = (token: string): boolean => {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace('-', '+').replace('_', '/');
      const decodedData = JSON.parse(Buffer.from(base64, 'base64').toString('binary'));

      // If the token will expire in the next 60 seconds (or has already expired)
      const delta = 60;
      if (timestampNow + delta > decodedData.exp) {
        return false;
      }

      return true;
    };

    if (!this.authToken || !validateJWTExpireDate(this.authToken)) {
      let privKey = this.authPrivKey;

      if (!privKey) {
        // Request the client for the PIN
        const password = usePassword ? usePassword : await this.requestPassword();

        // Use it to get the words from the storage
        privKey = wallet.getAuthPrivKey(password);
      }

      await this.renewAuthToken(privKey, timestampNow);
    } else {
      // If we have received the user PIN, we should renew the token anyway
      // without blocking this method's promise
      if (usePassword) {
        const privKey = wallet.getAuthPrivKey(usePassword);
        this.renewAuthToken(privKey, timestampNow);
      }
    }
  }

  /**
   * Renew the auth token on the wallet service
   *
   * @param {HDPrivateKey} privKey - private key to sign the auth message
   * @param {number} timestamp - Current timestamp to assemble the signature
   * @param {string} walletId - The initialized wallet identifier on the wallet service
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async renewAuthToken(privKey: bitcore.HDPrivateKey, timestamp: number) {
    if (!this.walletId) {
      throw new Error('Wallet not ready yet.');
    }

    const sign = this.signMessage(privKey, timestamp, this.walletId);
    const data = await walletApi.createAuthToken(this, timestamp, privKey.xpubkey, sign);

    this.authToken = data.token;
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
  getInputData(xprivkey: string, dataToSignHash: Buffer, addressPath: number): Buffer {
    const xpriv = bitcore.HDPrivateKey(xprivkey);
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
  stop({ cleanStorage = true } = {}) {
    this.walletId = null;
    this.state = walletState.NOT_STARTED;
    this.firstConnection = true;
    this.removeAllListeners();

    if (cleanStorage) {
      wallet.cleanWallet({
        endConnection: false,
        connection: this.conn,
      });
    }

    this.conn.stop();
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
   * Gets the network model object
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  getNetworkObject() {
    return this.network;
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
      pinCode: string | null,
    };
    const newOptions: optionsType = Object.assign({
      address: null,
      changeAddress: null,
      createMintAuthority: true,
      createMeltAuthority: true,
      nftData: null,
      pinCode: null,
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

    if (!newOptions.pinCode) {
      throw new Error('PIN not specified in prepareCreateNewToken options');
    }

    const xprivkey = wallet.getXprivKey(newOptions.pinCode);

    for (const [idx, inputObj] of tx.inputs.entries()) {
      const inputData = this.getInputData(
        xprivkey,
        dataToSignHash,
        HathorWalletServiceWallet.getAddressIndexFromFullPath(utxosAddressPath[idx]),
      );
      inputObj.setData(inputData);
    }

    tx.prepareToSend();
    return tx;
  }

  /**
   * Expects a BIP44 path at the address level and returns the address index
   *
   * @param {string} fullPath - The full BIP44 path for the address index
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  static getAddressIndexFromFullPath(fullPath: string): number {
    const parts = fullPath.split('/');

    assert.equal(6, parts.length);

    return parseInt(parts[5], 10);
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
      createAnotherMint: boolean,
      pinCode: string | null,
    };
    const newOptions: optionsType = Object.assign({
      address: null,
      changeAddress: null,
      createAnotherMint: true,
      pinCode: null,
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

    if (!newOptions.pinCode) {
      throw new Error('PIN not specified in prepareMintTokensData options');
    }

    const xprivkey = wallet.getXprivKey(newOptions.pinCode);

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // We have an array of utxos and the last input is the one with the authority
      const addressPath = idx === tx.inputs.length - 1 ? mintUtxo.addressPath : utxos[idx].addressPath;
      const inputData = this.getInputData(
        xprivkey,
        dataToSignHash,
        HathorWalletServiceWallet.getAddressIndexFromFullPath(addressPath),
      );
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
      createAnotherMelt: boolean,
      pinCode: string | null,
    };
    const newOptions: optionsType = Object.assign({
      address: null,
      changeAddress: null,
      createAnotherMelt: true,
      pinCode: null,
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

    if (!newOptions.pinCode) {
      throw new Error('PIN not specified in prepareMeltTokensData options');
    }

    const xprivkey = wallet.getXprivKey(newOptions.pinCode);

    for (const [idx, inputObj] of tx.inputs.entries()) {
      // We have an array of utxos and the last input is the one with the authority
      const addressPath = idx === tx.inputs.length - 1 ? meltUtxo.addressPath : utxos[idx].addressPath;
      const inputData = this.getInputData(
        xprivkey,
        dataToSignHash,
        HathorWalletServiceWallet.getAddressIndexFromFullPath(addressPath),
      );
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
      createAnotherAuthority: boolean,
      pinCode: string | null,
    };
    const newOptions: optionsType = Object.assign({
      anotherAuthorityAddress: null,
      createAnotherAuthority: true,
      pinCode: null,
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

    if (!newOptions.pinCode) {
      throw new Error('PIN not specified in prepareDelegateAuthorityData options');
    }

    const xprivkey = wallet.getXprivKey(newOptions.pinCode);

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();
    const inputData = this.getInputData(
      xprivkey,
      dataToSignHash,
      HathorWalletServiceWallet.getAddressIndexFromFullPath(utxo.addressPath),
    );
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
  async prepareDestroyAuthorityData(token: string, type: string, count: number, options = {}): Promise<Transaction> {
    this.failIfWalletNotReady();

    type optionsType = {
      pinCode: string | null,
    };

    const newOptions: optionsType = Object.assign({
      pinCode: null,
    }, options);

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

    if (!newOptions.pinCode) {
      throw new Error('PIN not specified in prepareDestroyAuthorityData options');
    }

    const xprivkey = wallet.getXprivKey(newOptions.pinCode);

    for (const [idx, inputObj] of tx.inputs.entries()) {
      const inputData = this.getInputData(
        xprivkey,
        dataToSignHash,
        HathorWalletServiceWallet.getAddressIndexFromFullPath(ret.utxos[idx].addressPath),
      );
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
  async destroyAuthority(token: string, type: string, count: number, options = {}): Promise<Transaction> {
    this.failIfWalletNotReady();
    const tx = await this.prepareDestroyAuthorityData(token, type, count, options);
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
