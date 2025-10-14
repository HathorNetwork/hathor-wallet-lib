/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import bitcore, { util } from 'bitcore-lib';
import assert from 'assert';
import {
  NATIVE_TOKEN_UID,
  TOKEN_MINT_MASK,
  AUTHORITY_TOKEN_DATA,
  TOKEN_MELT_MASK,
  WALLET_SERVICE_AUTH_DERIVATION_PATH,
  P2SH_ACCT_PATH,
  P2PKH_ACCT_PATH,
} from '../constants';
import { decryptData, signMessage } from '../utils/crypto';
import walletApi from './api/walletApi';
import { deriveAddressFromXPubP2PKH } from '../utils/address';
import walletUtils from '../utils/wallet';
import helpers from '../utils/helpers';
import transaction from '../utils/transaction';
import tokens from '../utils/tokens';
import config from '../config';
import P2PKH from '../models/p2pkh';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Output from '../models/output';
import Input from '../models/input';
import Address from '../models/address';
import Network from '../models/network';
import networkInstance from '../network';
import { MemoryStore, Storage } from '../storage';
import WalletServiceConnection from './connection';
import SendTransactionWalletService from './sendTransactionWalletService';
import {
  AddressInfoObject,
  GetBalanceObject,
  GetAddressesObject,
  GetHistoryObject,
  WalletStatus,
  Utxo,
  OutputType,
  OutputSendTransaction,
  OutputRequestObj,
  DataScriptOutputRequestObj,
  InputRequestObj,
  TransactionFullObject,
  IHathorWallet,
  WsTransaction,
  CreateWalletAuthData,
  ConnectionState,
  TokenDetailsObject,
  AuthorityTxOutput,
  GetTxOutputsOptions,
  WalletServiceServerUrls,
  FullNodeVersionData,
  WalletAddressMap,
  TxByIdTokensResponseData,
  DelegateAuthorityOptions,
  DestroyAuthorityOptions,
  FullNodeTxResponse,
  FullNodeTxConfirmationDataResponse,
  GetAddressDetailsObject,
  CreateTokenOptionsInput,
} from './types';
import {
  SendTxError,
  UtxoError,
  WalletRequestError,
  WalletError,
  UninitializedWalletError,
  WalletFromXPubGuard,
  PinRequiredError,
} from '../errors';
import { ErrorMessages } from '../errorMessages';
import { IStorage, IWalletAccessData, OutputValueType, WalletType, IHistoryTx } from '../types';
import NanoContractTransactionBuilder from '../nano_contracts/builder';
import {
  NanoContractVertexType,
  NanoContractBuilderCreateTokenOptions,
  CreateNanoTxData,
} from '../nano_contracts/types';
import { WalletServiceStorageProxy } from './walletServiceStorageProxy';

// Time in milliseconds berween each polling to check wallet status
// if it ended loading and became ready
const WALLET_STATUS_POLLING_INTERVAL = 1000;

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
  private requestPassword: () => Promise<string>;

  // String with 24 words separated by space
  private seed: string | null;

  // Xpub of the wallet
  private xpub: string | null;

  // Xpriv of the wallet on the account derivation path
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

  // Flag to indicate if the wallet was already connected when the websocket conn is established
  private firstConnection: boolean;

  // Flag to indicate if the websocket connection is enabled
  private readonly _isWsEnabled: boolean;

  public storage: IStorage;

  constructor({
    requestPassword,
    seed = null,
    xpriv = null,
    authxpriv = null,
    xpub = null,
    network,
    passphrase = '',
    enableWs = true,
    storage = null,
  }: {
    requestPassword: () => Promise<string>;
    seed?: string | null;
    xpriv?: string | null;
    authxpriv?: string | null;
    xpub?: string | null;
    network: Network;
    passphrase?: string;
    enableWs?: boolean;
    storage?: IStorage | null;
  }) {
    super();

    if (!seed && !xpriv && !xpub) {
      throw Error('You must explicitly provide the seed, xpriv or the xpub.');
    }

    if (seed && xpriv) {
      throw Error('You cannot provide both a seed and an xpriv.');
    }

    if (xpriv && passphrase !== '') {
      throw Error("You can't use xpriv with passphrase.");
    }

    if (xpriv && !authxpriv) {
      throw new Error('You must provide both the account path xpriv and auth path xpriv.');
    }

    if (seed) {
      // It will throw InvalidWords error in case is not valid
      walletUtils.wordsValid(seed);
    }

    if (!storage) {
      const store = new MemoryStore();
      this.storage = new Storage(store);
    } else {
      this.storage = storage;
    }

    // Setup the connection so clients can listen to its events before it is started
    this.conn = new WalletServiceConnection();
    this._isWsEnabled = enableWs;
    this.state = walletState.NOT_STARTED;

    this.xpriv = xpriv;
    this.seed = seed;
    this.xpub = xpub;
    if (authxpriv && !bitcore.HDPrivateKey.isValidSerialized(authxpriv)) {
      throw new Error('authxpriv parameter is an invalid hd privatekey');
    }
    this.authPrivKey = authxpriv ? bitcore.HDPrivateKey(authxpriv) : null;

    this.passphrase = passphrase;

    this.requestPassword = requestPassword;

    // ID of wallet after created on wallet service
    this.walletId = null;
    this.isSendingTx = false;
    this.txProposalId = null;

    this.network = network;
    networkInstance.setNetwork(this.network.name);

    this.authToken = null;
    this.firstConnection = true;

    this.newAddresses = [];
    this.indexToUse = -1;
    // TODO should we have a debug mode?
  }

  /**
   * Sets the server to connect on config singleton and storage
   *
   * @param {String} newServer - The new server to set the config and storage to
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async changeServer(newServer: string) {
    await this.storage.store.setItem('wallet:wallet_service:base_server', newServer);
    config.setWalletServiceBaseUrl(newServer);
  }

  /**
   * Sets the websocket server to connect on config singleton and storage
   *
   * @param {String} newServer - The new websocket server to set the config and storage to
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async changeWsServer(newServer: string) {
    await this.storage.store.setItem('wallet:wallet_service:ws_server', newServer);
    config.setWalletServiceBaseWsUrl(newServer);
  }

  /**
   * Gets the stored websocket and base server urls
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getServerUrlsFromStorage(): Promise<WalletServiceServerUrls> {
    const walletServiceBaseUrl = (await this.storage.store.getItem(
      'wallet:wallet_service:base_server'
    )) as string;
    const walletServiceWsUrl = (await this.storage.store.getItem(
      'wallet:wallet_service:ws_server'
    )) as string;

    return {
      walletServiceBaseUrl,
      walletServiceWsUrl,
    };
  }

  /**
   * Get server URL from config object
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  // eslint-disable-next-line class-methods-use-this
  getServerUrl(): string {
    return config.getServerUrl();
  }

  /**
   * Remove sensitive data from memory
   *
   * NOTICE: This won't remove data from memory immediately, we have to wait until javascript
   * garbage collect it. JavaScript currently does not provide a standard way to trigger
   * garbage collection
   * */
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
  static getAuthXPubKeyFromSeed(
    seed: string,
    options: { passphrase?: string; networkName?: string } = {}
  ): string {
    const methodOptions = {
      passphrase: '',
      networkName: 'mainnet',
      ...options,
    };

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
    return xpriv.deriveNonCompliantChild(WALLET_SERVICE_AUTH_DERIVATION_PATH);
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
    return walletUtils.getWalletIdFromXPub(xpub);
  }

  /**
   * Start wallet: load the wallet data, update state and start polling wallet status until it's ready
   *
   * @param {Object} optionsParams Options parameters
   *  {
   *   'pinCode': PIN to encrypt the auth xpriv on storage
   *   'password': Password to decrypt xpriv information
   *   'waitReady': Whether to wait for the wallet to be ready (default: true)
   *  }
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async start({
    pinCode,
    password,
    waitReady = true,
  }: { pinCode?: string; password?: string; waitReady?: boolean } = {}) {
    if (!pinCode) {
      throw new Error('Pin code is required when starting the wallet.');
    }

    this.setState(walletState.LOADING);

    let accessData: IWalletAccessData | null = null;
    try {
      accessData = await this.storage.getAccessData();
    } catch (err) {
      if (!(err instanceof UninitializedWalletError)) {
        throw err;
      }
    }

    if (!accessData) {
      if (this.seed) {
        if (!password) {
          throw new Error('Password is required when starting the wallet from the seed.');
        }
        accessData = walletUtils.generateAccessDataFromSeed(this.seed, {
          passphrase: this.passphrase,
          pin: pinCode,
          password,
          networkName: this.network.name,
          // multisig: not implemented on wallet service yet
        });
      } else if (this.xpriv) {
        // generateAccessDataFromXpriv expects a xpriv on the change level path
        const accountLevelPrivKey = new bitcore.HDPrivateKey(this.xpriv);
        const changeLevelPrivKey = accountLevelPrivKey.deriveNonCompliantChild(0);

        accessData = walletUtils.generateAccessDataFromXpriv(changeLevelPrivKey.xprivkey, {
          pin: pinCode,
          authXpriv: this.authPrivKey.xprivkey!,
          // multisig: not implemented on wallet service yet
        });
      } else {
        throw new Error('WalletService facade initialized without seed or xprivkey');
      }

      await this.storage.saveAccessData(accessData);
    }

    let renewPromise: Promise<void> | null = null;
    if (accessData.acctPathKey) {
      // We can preemtively request/renew the auth token so the wallet can wait for this process
      // to finish while we derive and request the wallet creation.
      // This call will fail is the wallet is being created for the first time.
      const acctKey = decryptData(accessData.acctPathKey, pinCode);
      const privKeyAccountPath = bitcore.HDPrivateKey(acctKey);
      const walletId = HathorWalletServiceWallet.getWalletIdFromXPub(privKeyAccountPath.xpubkey);
      this.walletId = walletId;
      renewPromise = this.validateAndRenewAuthToken(pinCode);
    }

    const {
      xpub,
      authXpub,
      xpubkeySignature,
      authXpubkeySignature,
      timestampNow,
      firstAddress,
      authDerivedPrivKey,
    } = await this.generateCreateWalletAuthData(accessData, pinCode);

    if (!renewPromise) {
      // we need to start the process to renew the auth token If for any reason we had to
      // derive the account path xpubkey on the method above.
      const walletId = HathorWalletServiceWallet.getWalletIdFromXPub(xpub);
      this.walletId = walletId;
      renewPromise = this.validateAndRenewAuthToken(pinCode);
    }

    this.xpub = xpub;
    this.authPrivKey = authDerivedPrivKey;

    const handleCreate = async (data: WalletStatus, tokenRenewPromise: Promise<void> | null) => {
      this.walletId = data.walletId;

      if (data.status === 'creating') {
        // If the wallet status is creating, we should wait until it is ready
        // before continuing
        await this.pollForWalletStatus();
      } else if (data.status !== 'ready') {
        // At this stage, if the wallet is not `ready` or `creating` we should
        // throw an error as there are only three states: `ready`, `creating` or `error`
        throw new WalletRequestError(ErrorMessages.WALLET_STATUS_ERROR, { cause: data.status });
      }

      if (tokenRenewPromise !== null) {
        try {
          await tokenRenewPromise;
        } catch (err) {
          this.authToken = null;
        }
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
      firstAddress
    );

    // Set walletId immediately after wallet creation
    this.walletId = data.status.walletId;

    // If waitReady is false, return immediately after wallet creation
    if (!waitReady) {
      this.clearSensitiveData();
      return;
    }

    // If auth token api fails we can still retry during wallet creation status polling.
    let renewPromise2: Promise<void> | null = null;
    try {
      // Here we await the first auth token api call before continuing the startup process.
      await renewPromise;
    } catch (err) {
      // If the wallet was being created the api would fail, but we will try to request a new token
      // now that the wallet was created and before it is ready.
      this.authToken = null;
      const walletId = HathorWalletServiceWallet.getWalletIdFromXPub(xpub);
      this.walletId = walletId;
      renewPromise2 = this.validateAndRenewAuthToken(pinCode);
    }

    await handleCreate(data.status, renewPromise2);

    this.clearSensitiveData();
  }

  /**
   * Returns version data from the connected fullnode
   * */
  async getVersionData(): Promise<FullNodeVersionData> {
    return walletApi.getVersionData(this);
  }

  /**
   * Detects if we are loading from the seed or the account path and returns the
   * required information for authentication
   *
   * @param pinCode The pincode to be used to encrypt the auth xprivkey
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async generateCreateWalletAuthData(
    accessData: IWalletAccessData,
    pinCode: string
  ): Promise<CreateWalletAuthData> {
    let privKey: bitcore.HDPrivateKey;
    let privKeyAccountPath: bitcore.HDPrivateKey;
    let authDerivedPrivKey: bitcore.HDPrivateKey;

    const now = Date.now();
    const timestampNow = Math.floor(now / 1000); // in seconds

    if (accessData.acctPathKey) {
      const acctKey = decryptData(accessData.acctPathKey, pinCode);
      privKeyAccountPath = bitcore.HDPrivateKey(acctKey);
    } else if (this.seed) {
      // Derive from seed present in memory
      // getXPrivKeyFromSeed returns a HDPrivateKey on the root path
      privKey = walletUtils.getXPrivKeyFromSeed(this.seed, {
        passphrase: this.passphrase,
        networkName: this.network.name,
      });
      privKeyAccountPath = privKey.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    } else if (this.xpriv) {
      privKeyAccountPath = bitcore.HDPrivateKey(this.xpriv);
    } else {
      throw new Error('Cannot derive account path key');
    }
    const xpub = privKeyAccountPath.xpubkey;

    if (accessData.authKey) {
      const authKey = decryptData(accessData.authKey, pinCode);
      authDerivedPrivKey = bitcore.HDPrivateKey(authKey);
    } else if (this.seed) {
      // Derive from seed present in memory
      if (!privKey) {
        privKey = walletUtils.getXPrivKeyFromSeed(this.seed, {
          passphrase: this.passphrase,
          networkName: this.network.name,
        });
      }
      authDerivedPrivKey = HathorWalletServiceWallet.deriveAuthPrivateKey(privKey);
    } else {
      try {
        authDerivedPrivKey = bitcore.HDPrivateKey.fromString(
          await this.storage.getAuthPrivKey(pinCode)
        );
      } catch (err) {
        throw new Error('Cannot fetch or derive auth path key');
      }
    }
    const authXpub = authDerivedPrivKey.xpubkey;

    const walletId: string = HathorWalletServiceWallet.getWalletIdFromXPub(xpub);

    // prove we own the xpubkey
    const xpubkeySignature = this.signMessage(privKeyAccountPath, timestampNow, walletId);

    // prove we own the auth_xpubkey
    const authXpubkeySignature = this.signMessage(authDerivedPrivKey, timestampNow, walletId);
    const xpubChangeDerivation = walletUtils.xpubDeriveChild(xpub, 0);
    const { base58: firstAddress } = deriveAddressFromXPubP2PKH(
      xpubChangeDerivation,
      0,
      this.network.name
    );

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
    const { outputs } = newTx;
    let shouldGetNewAddresses = false;

    for (const output of outputs) {
      // Check if the output's decoded address matches any of the wallet's new addresses
      if (
        output.decoded &&
        output.decoded.address &&
        this.newAddresses.find(newAddress => newAddress.address === output.decoded.address)
      ) {
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

    this.emit('new-tx', newTx);
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
   * */
  async getTxBalance(
    tx: IHistoryTx,
    optionsParam = {}
  ): Promise<{ [tokenId: string]: OutputValueType }> {
    const options = { includeAuthorities: false, ...optionsParam };

    const addresses: string[] = [];

    const generator = this.getAllAddresses();

    // We are not using for async (...) to maintain compatibility with older nodejs versions
    // if we ever deprecate older node versions, we can refactor this to the new, cleaner syntax
    let nextAddress = await generator.next();
    while (!nextAddress.done) {
      addresses.push(nextAddress.value.address);
      nextAddress = await generator.next();
    }

    const balance: { [tokenId: string]: OutputValueType } = {};
    for (const txout of tx.outputs) {
      if (transaction.isAuthorityOutput(txout)) {
        if (options.includeAuthorities) {
          if (!balance[txout.token]) {
            balance[txout.token] = 0n;
          }
        }
        continue;
      }
      if (txout.decoded && txout.decoded.address && addresses.includes(txout.decoded.address)) {
        if (!balance[txout.token]) {
          balance[txout.token] = 0n;
        }
        balance[txout.token] += txout.value;
      }
    }

    for (const txin of tx.inputs) {
      if (transaction.isAuthorityOutput(txin)) {
        if (options.includeAuthorities) {
          if (!balance[txin.token]) {
            balance[txin.token] = 0n;
          }
        }
        continue;
      }
      if (txin.decoded && txin.decoded.address && addresses.includes(txin.decoded.address)) {
        if (!balance[txin.token]) {
          balance[txin.token] = 0n;
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
          resolve();
        } else if (data.status.status !== 'creating') {
          // Only possible states are 'ready', 'creating' and 'error', if status
          // is not ready or creating, we should reject the promise
          clearInterval(pollIntervalTimer);
          reject(new WalletRequestError('Error getting wallet status.', { cause: data.status }));
        }
      }, WALLET_STATUS_POLLING_INTERVAL);
    });
  }

  /**
   * Check if wallet is ready and throw error if not ready
   *
   * @memberof HathorWalletServiceWallet
   * @public
   */
  public failIfWalletNotReady() {
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

    if (this.isWsEnabled()) {
      this.setupConnection();
    }
    this.setState(walletState.READY);
  }

  setupConnection() {
    if (!this.walletId) {
      // This should never happen
      throw new Error('Tried to setup connection but wallet_id is not set.');
    }

    this.conn.setWalletId(this.walletId);
    this.conn.on('new-tx', (newTx: WsTransaction) => this.onNewTx(newTx));
    this.conn.on('update-tx', updatedTx => this.onUpdateTx(updatedTx));
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
   * */
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
  async *getAllAddresses(): AsyncGenerator<GetAddressesObject> {
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
   * @param ignoreWalletReady Will download new addresses even if the wallet is not set to ready
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  private async getNewAddresses(ignoreWalletReady: boolean = false) {
    // If the user is sure the wallet service has already loaded his wallet, he can ignore the check
    if (!ignoreWalletReady) {
      // We should fail if the wallet is not ready because the wallet service address load mechanism is
      // asynchronous, so we will get an empty or partial array of addresses if they are not all loaded.
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
  async getTxHistory(
    options: { token_id?: string; count?: number; skip?: number } = {}
  ): Promise<GetHistoryObject[]> {
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
    const data = await walletApi.getTxOutputs(this, {
      txId,
      index,
      skipSpent: true, // This is the API default, but we should be explicit about it
    });
    const utxos = data.txOutputs;
    if (utxos.length === 0) {
      // No utxo for this txId/index or is not from the requested wallet
      return null;
    }
    if (utxos.length > 1) {
      throw new UtxoError(
        `Expected to receive only one utxo for txId ${txId} and index ${index} but received ${utxos.length}.`
      );
    }

    return utxos[0];
  }

  /**
   * Get utxos of the wallet addresses
   *
   * @param options Utxo filtering options
   * @param {number} [options.max_utxos] - Maximum number of utxos to aggregate. Default to MAX_INPUTS (255).
   * @param {string} [options.token] - Token to filter the utxos. If not sent, we select only HTR utxos.
   * @param {number} [options.authorities] - Authorities to filter the utxos. If not sent, we select only non authority utxos.
   * @param {string} [options.filter_address] - Address to filter the utxos.
   * @param {number} [options.amount_smaller_than] - Maximum limit of utxo amount to filter the utxos list.
   * @param {number} [options.amount_bigger_than] - Minimum limit of utxo amount to filter the utxos list.
   * @param {number} [options.max_amount] - Limit the maximum total amount to consolidate summing all utxos.
   * @param {boolean} [options.only_available_utxos] - Use only available utxos (not locked)
   *
   * @returns Promise that resolves with utxos and meta information about them
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getUtxos(
    options: {
      token?: string;
      authorities?: number;
      max_utxos?: number;
      filter_address?: string;
      amount_smaller_than?: number;
      amount_bigger_than?: number;
      max_amount?: number;
      only_available_utxos?: boolean;
    } = {}
  ): Promise<{
    total_amount_available: bigint;
    total_utxos_available: bigint;
    total_amount_locked: bigint;
    total_utxos_locked: bigint;
    utxos: {
      address: string;
      amount: bigint;
      tx_id: string;
      locked: boolean;
      index: number;
    }[];
  }> {
    this.failIfWalletNotReady();

    const newOptions = {
      token: options.token,
      authorities: options.authorities,
      max_utxos: options.max_utxos,
      filter_address: options.filter_address,
      amount_smaller_than: options.amount_smaller_than,
      amount_bigger_than: options.amount_bigger_than,
      max_amount: options.max_amount,
      only_available_utxos: options.only_available_utxos,
    };

    const mappedOptions = {
      tokenId: newOptions.token || NATIVE_TOKEN_UID,
      authority: newOptions.authorities ? BigInt(newOptions.authorities) : undefined,
      addresses: newOptions.filter_address ? [newOptions.filter_address] : undefined,
      totalAmount: newOptions.max_amount ? BigInt(newOptions.max_amount) : undefined,
      smallerThan: newOptions.amount_smaller_than,
      biggerThan: newOptions.amount_bigger_than,
      maxOutputs: newOptions.max_utxos || 255,
      ignoreLocked: true,
      skipSpent: newOptions.only_available_utxos !== false,
    };

    // Call the internal API to get UTXOs
    const data = await walletApi.getTxOutputs(this, mappedOptions);
    const filteredUtxos = data.txOutputs;

    // Build the UtxoDetails response matching fullnode wallet interface
    const utxoDetails = {
      total_amount_available: 0n,
      total_utxos_available: 0n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [] as {
        address: string;
        amount: bigint;
        tx_id: string;
        locked: boolean;
        index: number;
      }[],
    };

    // For wallet service, we'll assume all UTXOs are available (not locked)
    // since the wallet service handles locking differently
    for (const utxo of filteredUtxos) {
      const utxoInfo = {
        address: utxo.address,
        amount: utxo.value,
        tx_id: utxo.txId,
        locked: false, // Wallet service UTXOs are typically available
        index: utxo.index,
      };

      utxoDetails.utxos.push(utxoInfo);
      utxoDetails.total_amount_available += utxo.value;
      utxoDetails.total_utxos_available += 1n;
    }

    return utxoDetails;
  }

  /**
   * Get utxos for filling a transaction
   *
   * @param amount The total amount needed
   * @param options Options for filtering utxos
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getUtxosForAmount(
    amount: OutputValueType,
    options: {
      token?: string;
      filter_address?: string;
    } = {}
  ): Promise<{ utxos: Utxo[]; changeAmount: OutputValueType }> {
    if (amount <= 0) {
      throw new UtxoError('Total amount must be a positive integer.');
    }

    const newOptions = {
      tokenId: options.token || NATIVE_TOKEN_UID,
      addresses: options.filter_address ? [options.filter_address] : undefined,
      totalAmount: amount,
      ignoreLocked: true,
      skipSpent: true,
    };

    if (!newOptions.totalAmount) {
      throw new UtxoError('We need the total amount of utxos.');
    }

    const data = await walletApi.getTxOutputs(this, newOptions);

    // Use selectUtxos to handle all error conditions and utxo selection
    const ret = transaction.selectUtxos(data.txOutputs, newOptions.totalAmount!);
    return { utxos: ret.utxos, changeAmount: ret.changeAmount };
  }

  /**
   * Signs a message using xpriv derivation path m/44'/280'/0'
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  signMessage(hdPrivKey: bitcore.HDPrivateKey, timestamp: number, walletId: string): string {
    const address = hdPrivKey.publicKey.toAddress(this.network.getNetwork()).toString();
    const message = String(timestamp).concat(walletId).concat(address);

    return signMessage(message, hdPrivKey.privateKey);
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
      // Check if we're in read-only mode (no auth private key available)
      // In read-only mode, we need to use the read-only auth token endpoint
      if (!this.authPrivKey && !usePassword && this.xpub) {
        // Read-only mode: renew using xpubkey without signature
        await this.getReadOnlyAuthToken();
        return;
      }

      let privKey = this.authPrivKey;

      if (!privKey) {
        // Request the client for the PIN
        const password = usePassword || (await this.requestPassword());

        // Use it to get the words from the storage
        privKey = bitcore.HDPrivateKey.fromString(await this.storage.getAuthPrivKey(password));
      }

      await this.renewAuthToken(privKey, timestampNow);
    } else if (usePassword) {
      // If we have received the user PIN, we should renew the token anyway
      // without blocking this method's promise

      const privKey = bitcore.HDPrivateKey.fromString(
        await this.storage.getAuthPrivKey(usePassword)
      );

      this.renewAuthToken(privKey, timestampNow);
    }
  }

  /**
   * Renew the auth token on the wallet service
   *
   * @param {HDPrivateKey} privKey - private key to sign the auth message
   * @param {number} timestamp - Current timestamp to assemble the signature
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
   * Get read-only auth token using only the xpubkey (no signature required)
   * This allows read-only access to wallet data without needing private keys
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getReadOnlyAuthToken(): Promise<string> {
    if (!this.xpub) {
      throw new Error('xpub is required to get read-only auth token.');
    }

    if (!this.walletId) {
      // Derive walletId from xpub if not set
      this.walletId = HathorWalletServiceWallet.getWalletIdFromXPub(this.xpub);
    }

    const data = await walletApi.createReadOnlyAuthToken(this, this.xpub);
    this.authToken = data.token;

    return data.token;
  }

  /**
   * Start wallet in read-only mode using only the xpubkey
   * This allows querying wallet data without needing private keys or authentication
   *
   * @throws {WalletRequestError} If wallet is not initialized or not ready
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async startReadOnly(): Promise<void> {
    if (!this.xpub) {
      throw new Error('xpub is required to start wallet in read-only mode.');
    }

    this.setState(walletState.LOADING);

    // Derive walletId from xpub
    const walletId = HathorWalletServiceWallet.getWalletIdFromXPub(this.xpub);
    this.walletId = walletId;

    // Get read-only auth token
    await this.getReadOnlyAuthToken();

    // Check wallet status to ensure it's ready
    const walletStatus = await walletApi.getWalletStatus(this);

    if (walletStatus.status.status === 'creating') {
      // If the wallet is still being created, poll until it's ready
      await this.pollForWalletStatus();
    } else if (walletStatus.status.status !== 'ready') {
      // If wallet is in error state or doesn't exist
      throw new WalletRequestError(
        'Wallet must be initialized and ready before starting in read-only mode.',
        { cause: walletStatus.status }
      );
    }

    // Wallet is ready, complete the startup process
    await this.onWalletReady();
  }

  /**
   * Create a SendTransaction instance to send a transaction with possibly multiple outputs.
   *
   * @param outputs Array of proposed outputs
   * @param options Options parameters
   *
   * @return Promise<SendTransactionWalletService>
   */
  async sendManyOutputsSendTransaction(
    outputs: Array<OutputRequestObj | DataScriptOutputRequestObj>,
    options: { inputs?: InputRequestObj[]; changeAddress?: string; pinCode?: string } = {}
  ): Promise<SendTransactionWalletService> {
    this.failIfWalletNotReady();
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('sendManyOutputsSendTransaction');
    }
    const newOptions = {
      inputs: [],
      changeAddress: null,
      pinCode: null,
      ...options,
    };

    const { inputs, changeAddress, pinCode } = newOptions;

    // PIN validation - request from client if not provided
    const pin = pinCode || (await this.requestPassword());
    if (!pin) {
      throw new Error('Pin is required.');
    }

    const sendTransactionOutputs = outputs.map(output => {
      const typedOutput = output as OutputSendTransaction;
      if (typedOutput.type === OutputType.DATA) {
        typedOutput.value = 1n;
        typedOutput.token = NATIVE_TOKEN_UID;
      } else {
        typedOutput.type = helpers.getOutputTypeFromAddress(typedOutput.address!, this.network);
      }

      return typedOutput;
    });
    const sendTransaction = new SendTransactionWalletService(this, {
      outputs: sendTransactionOutputs,
      inputs,
      changeAddress,
      pin,
    });
    return sendTransaction;
  }

  /**
   * Creates and send a transaction from an array of inputs and outputs
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async sendManyOutputsTransaction(
    outputs: Array<OutputRequestObj | DataScriptOutputRequestObj>,
    options: { inputs?: InputRequestObj[]; changeAddress?: string; pinCode?: string } = {}
  ): Promise<Transaction> {
    const sendTransaction = await this.sendManyOutputsSendTransaction(outputs, options);
    return sendTransaction.run();
  }

  /**
   * Creates and send a simple transaction with one output
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async sendTransaction(
    address: string,
    value: OutputValueType,
    options: { token?: string; changeAddress?: string; pinCode?: string } = {}
  ): Promise<Transaction> {
    this.failIfWalletNotReady();
    const newOptions = {
      token: '00',
      changeAddress: undefined,
      ...options,
    };
    const { token, changeAddress, pinCode } = newOptions;
    const outputs = [{ address, value, token }];
    return this.sendManyOutputsTransaction(outputs, { inputs: [], changeAddress, pinCode });
  }

  /**
   * Calculate input data from dataToSign and addressPath
   * Get the private key corresponding to the addressPath,
   * calculate the signature and add the public key
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  // eslint-disable-next-line class-methods-use-this -- XXX: This method should be made static
  getInputData(xprivkey: string, dataToSignHash: Buffer, addressPath: number): Buffer {
    const xpriv = bitcore.HDPrivateKey(xprivkey);
    const derivedKey = xpriv.deriveNonCompliantChild(addressPath);
    const { privateKey } = derivedKey;

    const arr = [];
    helpers.pushDataToStack(arr, transaction.getSignature(dataToSignHash, privateKey));
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
  async stop({ cleanStorage = true } = {}) {
    this.walletId = null;
    this.state = walletState.NOT_STARTED;
    this.firstConnection = true;
    this.removeAllListeners();

    await this.storage.handleStop({ cleanStorage });
    this.conn.stop();
  }

  /**
   * Get address at specific index
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getAddressAtIndex(index: number): Promise<string> {
    const { addresses } = await walletApi.getAddresses(this, index);

    if (addresses.length <= 0) {
      throw new Error('Error getting wallet addresses.');
    }

    return addresses[0].address;
  }

  /**
   * Returns an address' privateKey given an index and the encryption password
   *
   * @param {string} pinCode - The PIN used to encrypt data in accessData
   * @param {number} addressIndex - The address' index to fetch
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getAddressPrivKey(pinCode: string, addressIndex: number): Promise<bitcore.HDPrivateKey> {
    const mainXPrivKey = await this.storage.getMainXPrivKey(pinCode);
    const addressHDPrivKey = new bitcore.HDPrivateKey(mainXPrivKey).derive(addressIndex);

    return addressHDPrivKey;
  }

  /**
   * Gets the network name
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  getNetwork(): string {
    return this.getNetworkObject().name;
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
      return { ...addressInfo, info: 'GAP_LIMIT_REACHED' };
    }

    const addressInfo = this.newAddresses[this.indexToUse];
    if (markAsUsed) {
      this.indexToUse += 1;
    }
    return addressInfo;
  }

  /**
   * Returns a base64 encoded signed message with an address' private key given an
   * address index
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async signMessageWithAddress(message: string, index: number, pinCode: string): Promise<string> {
    const addressHDPrivKey: bitcore.HDPrivateKey = await this.getAddressPrivKey(pinCode, index);
    const signedMessage: string = signMessage(message, addressHDPrivKey.privateKey);

    return signedMessage;
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

  /**
   * Get the address index of a base58 address
   *
   * @param {string} address Address to check
   * @returns {number | null} The address index or undefined
   */
  async getAddressIndex(address: string): Promise<number | null> {
    try {
      const addressDetails = await this.getAddressDetails(address);
      const addressIndex = addressDetails?.index;

      return addressIndex;
    } catch (_e) {
      // Return null if the address is not found
      return null;
    }
  }

  /**
   * Check if an address belongs to this wallet
   *
   * @param {string} address Address to check
   * @returns {boolean} True if the address belongs to this wallet
   */
  async isAddressMine(address: string): Promise<boolean> {
    // Use the checkAddressesMine API to verify if the address belongs to the wallet
    const response = await this.checkAddressesMine([address]);
    return response[address] === true;
  }

  /**
   * Get private key from address
   *
   * @param {string} address The address to get the private key for
   * @param {Object} options Options
   * @param {string} [options.pinCode] PIN code to decrypt the private key
   *
   * @returns {Promise<bitcore.PrivateKey>} Private key for this address
   */
  async getPrivateKeyFromAddress(
    address: string,
    options: { pinCode?: string } = {}
  ): Promise<bitcore.PrivateKey> {
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('getPrivateKeyFromAddress');
    }

    // First get the address index
    const addressIndex = await this.getAddressIndex(address);
    if (addressIndex === null) {
      throw new WalletError(`Address ${address} does not belong to this wallet`);
    }

    // Request PIN if not provided
    const pin = options.pinCode || (await this.requestPassword());

    // Get the HD private key for this address
    const addressHDPrivKey = await this.getAddressPrivKey(pin, addressIndex);

    // Return just the private key (not the HD key)
    return addressHDPrivKey.privateKey;
  }

  /**
   * Verify address belongs to wallet and return its index
   * @private
   */
  private async getAddressIndexIfOwned(address: string): Promise<number> {
    const addressDetails = await this.getAddressDetails(address);
    if (addressDetails?.index === undefined) {
      throw new Error(
        `Address used to sign the transaction (${address}) does not belong to the wallet.`
      );
    }
    return addressDetails.index;
  }

  /**
   * Get caller address from address index for nano contract operations
   * @private
   */
  private async getCallerAddressFromIndex(pin: string, addressIndex: number): Promise<Address> {
    const addressPrivKey = await this.getAddressPrivKey(pin, addressIndex);
    const callerAddress = new Address(
      addressPrivKey.publicKey.toAddress(this.network.getNetwork()).toString(),
      { network: this.network }
    );
    return callerAddress;
  }

  /**
   * Get the seqnum to be used in a nano header for the address
   */
  async getNanoHeaderSeqnum(address: string): Promise<number> {
    const addressInfo = await walletApi.getAddressDetails(this, address);

    return addressInfo.data.seqnum + 1;
  }

  /**
   * Get detailed information about a specific address from the wallet service
   *
   * @param address The address to get details for
   * @returns Promise that resolves with address details including index, transactions count, and seqnum
   */
  async getAddressDetails(address: string): Promise<GetAddressDetailsObject> {
    const addressDetails = await walletApi.getAddressDetails(this, address);
    return addressDetails.data;
  }

  // eslint-disable-next-line class-methods-use-this
  async markUtxoSelected(): Promise<void> {
    // XXX: Currently a no-op... We currently have a very specific mechanism for
    // locking utxos, which is the createTxProposal/sendTxProposal, that is very
    // tightly coupled to the regular send transaction method.
  }

  /* eslint-disable-next-line class-methods-use-this */
  getTx(id: string) {
    throw new WalletError('Not implemented.');
  }

  /* eslint-disable class-methods-use-this */
  getAddressInfo(address: string, options = {}) {
    throw new WalletError('Not implemented.');
  }

  /* eslint-disable class-methods-use-this */
  consolidateUtxos(destinationAddress: string, options = {}) {
    throw new WalletError('Not implemented.');
  }

  /* eslint-disable class-methods-use-this */
  getFullHistory(): TransactionFullObject[] {
    throw new WalletError('Not implemented.');
  }

  /**
   * Checks if the given array of addresses belongs to the caller wallet
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async checkAddressesMine(addresses: string[]): Promise<WalletAddressMap> {
    const response = await walletApi.checkAddressesMine(this, addresses);

    return response.addresses;
  }

  /**
   * Create SendTransaction object and run from mining
   * Returns a promise that resolves when the send succeeds
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async handleSendPreparedTransaction(transactionObj: Transaction): Promise<Transaction> {
    const sendTransaction = new SendTransactionWalletService(this, { transaction: transactionObj });
    return sendTransaction.runFromMining();
  }

  /**
   * Prepare create new token data, sign the inputs and returns an object ready to be mined
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareCreateNewToken(
    name: string,
    symbol: string,
    amount: OutputValueType,
    options = {}
  ): Promise<CreateTokenTransaction> {
    this.failIfWalletNotReady();
    type optionsType = {
      address: string | null;
      changeAddress: string | null;
      createMint: boolean;
      mintAuthorityAddress: string | null;
      allowExternalMintAuthorityAddress: boolean | null;
      createMelt: boolean;
      meltAuthorityAddress: string | null;
      allowExternalMeltAuthorityAddress: boolean | null;
      data: string[] | null;
      isCreateNFT: boolean;
      pinCode: string | null;
      signTx: boolean;
    };
    const newOptions: optionsType = {
      address: null,
      changeAddress: null,
      createMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      data: null,
      isCreateNFT: false,
      pinCode: null,
      signTx: true,
      ...options,
    };

    if (newOptions.mintAuthorityAddress && !newOptions.allowExternalMintAuthorityAddress) {
      // Validate that the mint authority address belongs to the wallet
      const checkAddressMineMap = await this.checkAddressesMine([newOptions.mintAuthorityAddress]);
      if (!checkAddressMineMap[newOptions.mintAuthorityAddress]) {
        throw new SendTxError('The mint authority address must belong to your wallet.');
      }
    }

    if (newOptions.meltAuthorityAddress && !newOptions.allowExternalMeltAuthorityAddress) {
      // Validate that the melt authority address belongs to the wallet
      const checkAddressMineMap = await this.checkAddressesMine([newOptions.meltAuthorityAddress]);
      if (!checkAddressMineMap[newOptions.meltAuthorityAddress]) {
        throw new SendTxError('The melt authority address must belong to your wallet.');
      }
    }

    const depositPercent = this.storage.getTokenDepositPercentage();
    // 1. Calculate HTR deposit needed
    let deposit = tokens.getDepositAmount(amount, depositPercent);

    if (newOptions.data && newOptions.data.length > 0) {
      // For data outputs, we have a fee of 0.01 HTR per data output
      deposit += tokens.getDataFee(newOptions.data.length);
    }

    // 2. Get utxos for HTR
    const { utxos, changeAmount } = await this.getUtxosForAmount(deposit, {
      token: NATIVE_TOKEN_UID,
    });
    if (utxos.length === 0) {
      throw new UtxoError(
        `No utxos available to fill the request. Token: HTR - Amount: ${deposit}.`
      );
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
    const dataOutputs: Output[] = [];
    if (newOptions.data && newOptions.data.length > 0) {
      for (const dataString of newOptions.data) {
        dataOutputs.push(helpers.createNFTOutput(dataString));
      }
    }

    if (newOptions.isCreateNFT && dataOutputs.length > 0) {
      outputsObj.push(...dataOutputs);
    }

    // a. Token amount
    const addressToUse = newOptions.address || this.getCurrentAddress({ markAsUsed: true }).address;
    const address = new Address(addressToUse, { network: this.network });
    if (!address.isValid()) {
      throw new SendTxError(`Address ${newOptions.address} is not valid.`);
    }

    const p2pkhScript = address.getScript();
    outputsObj.push(new Output(amount, p2pkhScript, { tokenData: 1 }));

    if (newOptions.createMint) {
      // b. Mint authority
      const mintAuthorityAddress =
        newOptions.mintAuthorityAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const mintAuthorityAddressObj = new Address(mintAuthorityAddress, { network: this.network });
      if (!mintAuthorityAddressObj.isValid()) {
        throw new SendTxError(`Address ${newOptions.mintAuthorityAddress} is not valid.`);
      }

      const p2pkhMintAuthorityScript = mintAuthorityAddressObj.getScript();
      outputsObj.push(
        new Output(TOKEN_MINT_MASK, p2pkhMintAuthorityScript, { tokenData: AUTHORITY_TOKEN_DATA })
      );
    }

    if (changeAmount) {
      // c. HTR change output
      const changeAddressStr =
        newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, { network: this.network });
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new P2PKH(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript();
      outputsObj.push(new Output(changeAmount, p2pkhChangeScript));
    }

    if (newOptions.createMelt) {
      // d. Melt authority
      const meltAuthorityAddress =
        newOptions.meltAuthorityAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const meltAuthorityAddressObj = new Address(meltAuthorityAddress, { network: this.network });
      if (!meltAuthorityAddressObj.isValid()) {
        throw new SendTxError(`Address ${newOptions.meltAuthorityAddress} is not valid.`);
      }

      const p2pkhMeltAuthorityScript = meltAuthorityAddressObj.getScript();
      outputsObj.push(
        new Output(TOKEN_MELT_MASK, p2pkhMeltAuthorityScript, { tokenData: AUTHORITY_TOKEN_DATA })
      );
    }

    if (!newOptions.isCreateNFT && dataOutputs.length > 0) {
      outputsObj.push(...dataOutputs);
    }

    const tx = new CreateTokenTransaction(name, symbol, inputsObj, outputsObj);

    // Sign transaction
    if (newOptions.signTx) {
      const dataToSignHash = tx.getDataToSignHash();

      if (!newOptions.pinCode) {
        throw new Error('PIN not specified in prepareCreateNewToken options');
      }

      const xprivkey = await this.storage.getMainXPrivKey(newOptions.pinCode);

      for (const [idx, inputObj] of tx.inputs.entries()) {
        const inputData = this.getInputData(
          xprivkey,
          dataToSignHash,
          HathorWalletServiceWallet.getAddressIndexFromFullPath(utxosAddressPath[idx])
        );
        inputObj.setData(inputData);
      }
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
   * Helper method to get authority tx_outputs
   * Uses the getTxOutputs API method to return one or many authorities
   */
  async _getAuthorityTxOutput(options: {
    tokenId: string;
    authority: OutputValueType;
    skipSpent: boolean;
    maxOutputs?: number;
    filterAddress?: string | null;
  }): Promise<AuthorityTxOutput[]> {
    const apiOptions: GetTxOutputsOptions = {
      tokenId: options.tokenId,
      authority: options.authority,
      skipSpent: options.skipSpent,
      maxOutputs: options.maxOutputs,
    };

    if (options.filterAddress) {
      apiOptions.addresses = [options.filterAddress];
    }

    const { txOutputs } = await walletApi.getTxOutputs(this, apiOptions);

    return txOutputs.map(txOutput => ({
      txId: txOutput.txId,
      index: txOutput.index,
      address: txOutput.address,
      authorities: txOutput.authorities,
    }));
  }

  /**
   * Get mint authorities
   * Uses the getTxOutputs API method to return one or many mint authorities
   *
   * @param tokenId of the token to select the authority utxo
   * @param options Object with custom options.
   *  {
   *    'many': if should return many utxos or just one (default false),
   *    'skipSpent': if should not include spent utxos (default true)
   *  }
   *
   * @return Promise that resolves with an Array of objects with {txId, index, address, authorities} of the authority output.
   * Returns an empty array in case there are no tx outputs for this type
   * */
  async getMintAuthority(
    tokenId: string,
    options: { many?: boolean; skipSpent?: boolean } = {}
  ): Promise<AuthorityTxOutput[]> {
    const newOptions = { many: false, skipSpent: true, ...options };

    return this._getAuthorityTxOutput({
      tokenId,
      authority: TOKEN_MINT_MASK,
      skipSpent: newOptions.skipSpent,
      maxOutputs: newOptions.many ? undefined : 1,
    });
  }

  /**
   * Get melt authorities
   * Uses the getTxOutputs API method to return one or many melt authorities
   *
   * @param tokenId of the token to select the authority utxo
   * @param options Object with custom options.
   *  {
   *    'many': if should return many utxos or just one (default false),
   *    'skipSpent': if should not include spent utxos (default true)
   *  }
   *
   * @return Promise that resolves with an Array of objects with {txId, index, address, authorities} of the authority output.
   * Returns an empty array in case there are no tx outputs for this type
   * */
  async getMeltAuthority(
    tokenId: string,
    options: { many?: boolean; skipSpent?: boolean } = {}
  ): Promise<AuthorityTxOutput[]> {
    const newOptions = { many: false, skipSpent: true, ...options };

    return this._getAuthorityTxOutput({
      tokenId,
      authority: TOKEN_MELT_MASK,
      skipSpent: newOptions.skipSpent,
      maxOutputs: newOptions.many ? undefined : 1,
    });
  }

  /**
   * Get authority utxo
   *
   * @param tokenUid UID of the token to select the authority utxo
   * @param authority The authority to filter ('mint' or 'melt')
   * @param options Object with custom options.
   *  {
   *    'many': if should return many utxos or just one (default false),
   *    'only_available_utxos': If we should filter for available utxos (default false),
   *    'filter_address': Address to filter the utxo to get (default null)
   *  }
   *
   * @return Promise that resolves with an Array of objects with {txId, index, address, authorities} of the authority output.
   * Returns an empty array in case there are no tx outputs for this type
   * */
  async getAuthorityUtxo(
    tokenUid: string,
    authority: string,
    options: {
      many?: boolean;
      only_available_utxos?: boolean;
      filter_address?: string | null;
    } = {}
  ): Promise<AuthorityTxOutput[]> {
    let authorityValue: OutputValueType;
    if (authority === 'mint') {
      authorityValue = TOKEN_MINT_MASK;
    } else if (authority === 'melt') {
      authorityValue = TOKEN_MELT_MASK;
    } else {
      throw new Error('Invalid authority value.');
    }

    const newOptions = {
      many: false,
      only_available_utxos: false,
      filter_address: null,
      ...options,
    };

    return this._getAuthorityTxOutput({
      tokenId: tokenUid,
      authority: authorityValue,
      skipSpent: newOptions.only_available_utxos,
      maxOutputs: newOptions.many ? undefined : 1,
      filterAddress: newOptions.filter_address,
    });
  }

  /**
   * Create a new custom token in the network
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async createNewToken(
    name: string,
    symbol: string,
    amount: OutputValueType,
    options = {}
  ): Promise<Transaction> {
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
  async prepareMintTokensData(
    token: string,
    amount: OutputValueType,
    options = {}
  ): Promise<Transaction> {
    this.failIfWalletNotReady();
    type optionsType = {
      address: string | null;
      changeAddress: string | null;
      createAnotherMint: boolean;
      mintAuthorityAddress: string | null;
      allowExternalMintAuthorityAddress: boolean;
      pinCode: string | null;
      signTx: boolean;
    };
    const newOptions: optionsType = {
      address: null,
      changeAddress: null,
      createAnotherMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      pinCode: null,
      signTx: true,
      ...options,
    };

    if (newOptions.mintAuthorityAddress && !newOptions.allowExternalMintAuthorityAddress) {
      // Validate that the mint authority address belongs to the wallet
      const checkAddressMineMap = await this.checkAddressesMine([newOptions.mintAuthorityAddress]);
      if (!checkAddressMineMap[newOptions.mintAuthorityAddress]) {
        throw new SendTxError('The mint authority address must belong to your wallet.');
      }
    }

    // 1. Calculate HTR deposit needed
    const depositPercent = this.storage.getTokenDepositPercentage();
    const deposit = tokens.getDepositAmount(amount, depositPercent);

    // 2. Get utxos for HTR
    const { utxos, changeAmount } = await this.getUtxosForAmount(deposit, {
      token: NATIVE_TOKEN_UID,
    });
    if (utxos.length === 0) {
      throw new UtxoError(
        `No utxos available to fill the request. Token: HTR - Amount: ${deposit}.`
      );
    }

    // 3. Get mint authority
    const mintAuthorities = await this.getMintAuthority(token, { many: false, skipSpent: true });
    if (mintAuthorities.length === 0) {
      throw new UtxoError(`No authority utxo available for minting tokens. Token: ${token}.`);
    }
    // it's safe to assume that we have an utxo in the array
    const mintUtxo = mintAuthorities[0];

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
    const address = new Address(addressToUse, { network: this.network });
    if (!address.isValid()) {
      throw new SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    const p2pkhScript = address.getScript();
    outputsObj.push(new Output(amount, p2pkhScript, { tokenData: 1 }));

    if (newOptions.createAnotherMint) {
      // b. Mint authority
      const authorityAddress =
        newOptions.mintAuthorityAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const authorityAddressObj = new Address(authorityAddress, { network: this.network });
      if (!authorityAddressObj.isValid()) {
        throw new SendTxError(`Address ${newOptions.mintAuthorityAddress} is not valid.`);
      }
      const p2pkhAuthorityScript = authorityAddressObj.getScript();
      outputsObj.push(
        new Output(TOKEN_MINT_MASK, p2pkhAuthorityScript, { tokenData: AUTHORITY_TOKEN_DATA })
      );
    }

    if (changeAmount) {
      // c. HTR change output
      const changeAddressStr =
        newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, { network: this.network });
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new P2PKH(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript();
      outputsObj.push(new Output(changeAmount, p2pkhChangeScript));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];

    // Sign transaction
    if (newOptions.signTx) {
      const dataToSignHash = tx.getDataToSignHash();

      if (!newOptions.pinCode) {
        throw new Error('PIN not specified in prepareMintTokensData options');
      }

      const xprivkey = await this.storage.getMainXPrivKey(newOptions.pinCode);

      for (const [idx, inputObj] of tx.inputs.entries()) {
        // We have an array of utxos and the last input is the one with the authority
        let addressIndex: number;
        if (idx === tx.inputs.length - 1) {
          // This is the mint authority input
          const mintUtxoAddressIndex = await this.getAddressIndex(mintUtxo.address);
          if (mintUtxoAddressIndex === null) {
            throw new Error(`Authority address ${mintUtxo.address} not found in wallet`);
          }
          addressIndex = mintUtxoAddressIndex;
        } else {
          // This is a regular HTR input
          addressIndex = HathorWalletServiceWallet.getAddressIndexFromFullPath(
            utxos[idx].addressPath
          );
        }
        const inputData = this.getInputData(xprivkey, dataToSignHash, addressIndex);
        inputObj.setData(inputData);
      }
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
  async mintTokens(token: string, amount: OutputValueType, options = {}): Promise<Transaction> {
    this.failIfWalletNotReady();
    const tx = await this.prepareMintTokensData(token, amount, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Call get token details API
   *
   * @param tokenId Token uid to get the token details
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getTokenDetails(tokenId: string): Promise<TokenDetailsObject> {
    const response = await walletApi.getTokenDetails(this, tokenId);
    const { details } = response;

    return details;
  }

  /**
   * Prepare melt token data, sign the inputs and returns an object ready to be mined
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareMeltTokensData(
    token: string,
    amount: OutputValueType,
    options = {}
  ): Promise<Transaction> {
    this.failIfWalletNotReady();
    type optionsType = {
      address: string | null;
      changeAddress: string | null;
      createAnotherMelt: boolean;
      meltAuthorityAddress: string | null;
      allowExternalMeltAuthorityAddress: boolean;
      pinCode: string | null;
      signTx: boolean;
    };
    const newOptions: optionsType = {
      address: null,
      changeAddress: null,
      createAnotherMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      pinCode: null,
      signTx: true,
      ...options,
    };

    if (newOptions.meltAuthorityAddress && !newOptions.allowExternalMeltAuthorityAddress) {
      // Validate that the melt authority address belongs to the wallet
      const checkAddressMineMap = await this.checkAddressesMine([newOptions.meltAuthorityAddress]);
      if (!checkAddressMineMap[newOptions.meltAuthorityAddress]) {
        throw new SendTxError('The melt authority address must belong to your wallet.');
      }
    }

    // 1. Calculate HTR deposit needed
    const depositPercent = this.storage.getTokenDepositPercentage();
    const withdraw = tokens.getWithdrawAmount(amount, depositPercent);

    // 2. Get utxos for custom token to melt
    const { utxos, changeAmount } = await this.getUtxosForAmount(amount, { token });
    if (utxos.length === 0) {
      throw new UtxoError(`Not enough tokens to be melted. Token: ${token} - Amount: ${amount}.`);
    }

    // 3. Get melt authority
    const meltAuthorities = await this.getMeltAuthority(token, { many: false, skipSpent: true });
    if (meltAuthorities.length === 0) {
      throw new UtxoError(`No authority utxo available for melting tokens. Token: ${token}.`);
    }
    // it's safe to assume that we have an utxo in the array
    const meltUtxo = meltAuthorities[0];

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
    const address = new Address(addressToUse, { network: this.network });
    if (!address.isValid()) {
      throw new SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    const p2pkh = new P2PKH(address);
    const p2pkhScript = p2pkh.createScript();
    if (withdraw) {
      // We may have nothing to get back
      outputsObj.push(new Output(withdraw, p2pkhScript, { tokenData: 0 }));
    }

    if (newOptions.createAnotherMelt) {
      // b. Melt authority
      const authorityAddress =
        newOptions.meltAuthorityAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const authorityAddressObj = new Address(authorityAddress, { network: this.network });
      if (!authorityAddressObj.isValid()) {
        throw new SendTxError(`Address ${newOptions.meltAuthorityAddress} is not valid.`);
      }
      const p2pkhAuthorityScript = authorityAddressObj.getScript();
      outputsObj.push(
        new Output(TOKEN_MELT_MASK, p2pkhAuthorityScript, {
          tokenData: AUTHORITY_TOKEN_DATA,
        })
      );
    }

    if (changeAmount) {
      // c. Token change output
      const changeAddressStr =
        newOptions.changeAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const changeAddress = new Address(changeAddressStr, { network: this.network });
      if (!changeAddress.isValid()) {
        throw new SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new P2PKH(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript();
      outputsObj.push(new Output(changeAmount, p2pkhChangeScript, { tokenData: 1 }));
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];

    // Sign transaction
    if (newOptions.signTx) {
      const dataToSignHash = tx.getDataToSignHash();

      if (!newOptions.pinCode) {
        throw new Error('PIN not specified in prepareMeltTokensData options');
      }

      const xprivkey = await this.storage.getMainXPrivKey(newOptions.pinCode);

      for (const [idx, inputObj] of tx.inputs.entries()) {
        // We have an array of utxos and the last input is the one with the authority
        let addressIndex: number;
        if (idx === tx.inputs.length - 1) {
          // This is the melt authority input
          const meltUtxoAddressIndex = await this.getAddressIndex(meltUtxo.address);
          if (meltUtxoAddressIndex === null) {
            throw new Error(`Authority address ${meltUtxo.address} not found in wallet`);
          }
          addressIndex = meltUtxoAddressIndex;
        } else {
          // This is a regular token input
          addressIndex = HathorWalletServiceWallet.getAddressIndexFromFullPath(
            utxos[idx].addressPath
          );
        }
        const inputData = this.getInputData(xprivkey, dataToSignHash, addressIndex);
        inputObj.setData(inputData);
      }
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
  async meltTokens(token: string, amount: OutputValueType, options = {}): Promise<Transaction> {
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
  async prepareDelegateAuthorityData(
    token: string,
    type: string,
    address: string,
    {
      anotherAuthorityAddress = null,
      createAnother = true,
      pinCode = null,
    }: DelegateAuthorityOptions
  ): Promise<Transaction> {
    this.failIfWalletNotReady();

    let mask: OutputValueType;
    if (type === 'mint') {
      mask = TOKEN_MINT_MASK;
    } else if (type === 'melt') {
      mask = TOKEN_MELT_MASK;
    } else {
      throw new WalletError('Type options are mint and melt for delegate authority method.');
    }

    // 1. Get authority utxo to spend
    const authorityUtxos =
      type === 'mint'
        ? await this.getMintAuthority(token, { many: false, skipSpent: true })
        : await this.getMeltAuthority(token, { many: false, skipSpent: true });
    if (authorityUtxos.length === 0) {
      throw new UtxoError(
        `No authority utxo available for delegating authority. Token: ${token} - Type ${type}.`
      );
    }
    // it's safe to assume that we have an utxo in the array
    const utxo = authorityUtxos[0];

    // 2. Create input from utxo
    const inputsObj: Input[] = [];
    inputsObj.push(new Input(utxo.txId, utxo.index));

    // Create outputs
    const outputsObj: Output[] = [];
    const addressObj = new Address(address, { network: this.network });
    if (!addressObj.isValid()) {
      throw new SendTxError(`Address ${address} is not valid.`);
    }

    const p2pkh = new P2PKH(addressObj);
    const p2pkhScript = p2pkh.createScript();
    outputsObj.push(new Output(mask, p2pkhScript, { tokenData: AUTHORITY_TOKEN_DATA }));

    if (createAnother) {
      const anotherAddressStr =
        anotherAuthorityAddress || this.getCurrentAddress({ markAsUsed: true }).address;
      const anotherAddress = new Address(anotherAddressStr, { network: this.network });
      if (!anotherAddress.isValid()) {
        throw new SendTxError(`Address ${anotherAuthorityAddress} is not valid.`);
      }
      const p2pkhAnotherAddress = new P2PKH(anotherAddress);
      const p2pkhAnotherAddressScript = p2pkhAnotherAddress.createScript();
      outputsObj.push(
        new Output(mask, p2pkhAnotherAddressScript, {
          tokenData: AUTHORITY_TOKEN_DATA,
        })
      );
    }

    const tx = new Transaction(inputsObj, outputsObj);
    tx.tokens = [token];

    if (!pinCode) {
      throw new Error('PIN not specified in prepareDelegateAuthorityData options');
    }

    const xprivkey = await this.storage.getMainXPrivKey(pinCode);

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();
    const addressIndex = await this.getAddressIndex(utxo.address);
    if (addressIndex === null) {
      throw new Error(`Authority address ${utxo.address} not found in wallet`);
    }
    const inputData = this.getInputData(xprivkey, dataToSignHash, addressIndex);
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
  async delegateAuthority(
    token: string,
    type: string,
    address: string,
    options: DelegateAuthorityOptions
  ): Promise<Transaction> {
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
  async prepareDestroyAuthorityData(
    token: string,
    type: string,
    count: number,
    { pinCode = null }: DestroyAuthorityOptions
  ): Promise<Transaction> {
    this.failIfWalletNotReady();

    if (type !== 'mint' && type !== 'melt') {
      throw new WalletError('Type options are mint and melt for destroy authority method.');
    }

    // 1. Get authority utxo to spend
    const authorityUtxos =
      type === 'mint'
        ? await this.getMintAuthority(token, { many: true, skipSpent: true })
        : await this.getMeltAuthority(token, { many: true, skipSpent: true });
    if (authorityUtxos.length < count) {
      throw new UtxoError(
        `Not enough authority utxos available for destroying. Token: ${token} - Type ${type}. Requested quantity ${count} - Available quantity ${authorityUtxos.length}`
      );
    }
    const ret = { utxos: authorityUtxos.slice(0, count) };

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

    if (!pinCode) {
      throw new Error('PIN not specified in prepareDestroyAuthorityData options');
    }

    const xprivkey = await this.storage.getMainXPrivKey(pinCode);

    for (const [idx, inputObj] of tx.inputs.entries()) {
      const addressIndex = await this.getAddressIndex(ret.utxos[idx].address);
      if (addressIndex === null) {
        throw new Error(`Authority address ${ret.utxos[idx].address} not found in wallet`);
      }
      const inputData = this.getInputData(xprivkey, dataToSignHash, addressIndex);
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
  async destroyAuthority(
    token: string,
    type: string,
    count: number,
    options: DestroyAuthorityOptions
  ): Promise<Transaction> {
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
  async createNFT(
    name: string,
    symbol: string,
    amount: OutputValueType,
    data: string,
    options = {}
  ): Promise<Transaction> {
    this.failIfWalletNotReady();
    type optionsType = {
      address: string | null;
      changeAddress: string | null;
      createMintAuthority: boolean;
      mintAuthorityAddress: string | null;
      allowExternalMintAuthorityAddress: boolean | null;
      createMeltAuthority: boolean;
      meltAuthorityAddress: string | null;
      allowExternalMeltAuthorityAddress: boolean | null;
      data?: string[];
      isCreateNFT?: boolean;
    };
    const newOptions: optionsType = {
      address: null,
      changeAddress: null,
      createMintAuthority: false,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMeltAuthority: false,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      ...options,
    };
    newOptions.data = [data];
    newOptions.isCreateNFT = true;
    const tx = await this.prepareCreateNewToken(name, symbol, amount, newOptions);
    return this.handleSendPreparedTransaction(tx);
  }

  async getTxById(txId: string): Promise<TxByIdTokensResponseData> {
    this.failIfWalletNotReady();
    const data = await walletApi.getTxById(this, txId);
    return data;
  }

  async getFullTxById(txId: string): Promise<FullNodeTxResponse> {
    this.failIfWalletNotReady();

    return walletApi.getFullTxById(this, txId);
  }

  async getTxConfirmationData(txId: string): Promise<FullNodeTxConfirmationDataResponse> {
    this.failIfWalletNotReady();

    const data = await walletApi.getTxConfirmationData(this, txId);
    return data;
  }

  async graphvizNeighborsQuery(txId: string, graphType: string, maxLevel: number): Promise<string> {
    this.failIfWalletNotReady();

    const data = await walletApi.graphvizNeighborsQuery(this, txId, graphType, maxLevel);
    return data;
  }

  /**
   * Check if websocket connection is enabled
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   *
   * @returns {boolean} If wallet has websocket connection enabled
   */
  isWsEnabled(): boolean {
    return this._isWsEnabled;
  }

  /**
   * Check if the pin used to encrypt the main key is valid.
   * @param {string} pin
   * @returns {Promise<boolean>}
   */
  async checkPin(pin: string): Promise<boolean> {
    return this.storage.checkPin(pin);
  }

  /**
   * Check if the password used to encrypt the seed is valid.
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async checkPassword(password: string): Promise<boolean> {
    return this.storage.checkPassword(password);
  }

  /**
   * @param {string} pin
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async checkPinAndPassword(pin: string, password: string): Promise<boolean> {
    return (await this.checkPin(pin)) && this.checkPassword(password); // The promise from checkPassword will be returned
  }

  /**
   * Check if the wallet is a hardware wallet.
   * @returns {Promise<boolean>}
   */
  // eslint-disable-next-line class-methods-use-this -- The method returns a hardcoded value
  async isHardwareWallet(): Promise<boolean> {
    // We currently do not have support for hardware wallets
    // in the wallet-service facade.
    return false;
  }

  /**
   * Get address path from specific derivation index
   *
   * @param {number} index Address path index
   *
   * @return {Promise<string>} Address path for the given index
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getAddressPathForIndex(index: number): Promise<string> {
    const walletType = await this.storage.getWalletType();
    if (walletType === WalletType.MULTISIG) {
      // P2SH
      return `${P2SH_ACCT_PATH}/0/${index}`;
    }

    // P2PKH
    return `${P2PKH_ACCT_PATH}/0/${index}`;
  }

  /**
   * Create a nano contract transaction and return the SendTransaction object
   *
   * @param {string} method Method of nano contract to have the transaction created
   * @param {string} address Address that will be used to sign the nano contract transaction
   * @param {CreateNanoTxData} [data]
   * @param {CreateNanoTxOptions} [options]
   *
   * @returns {Promise<any>} SendTransaction-compatible object
   */
  async createNanoContractTransaction(
    method: string,
    address: string,
    data: CreateNanoTxData,
    options: { pinCode?: string } = {}
  ): Promise<SendTransactionWalletService> {
    this.failIfWalletNotReady();

    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('createNanoContractTransaction');
    }

    const newOptions = { pinCode: null, ...options };
    const pin = newOptions.pinCode;
    if (!pin) {
      throw new PinRequiredError('Pin is required.');
    }

    // Verify address belongs to wallet and get its index
    const addressIndex = await this.getAddressIndexIfOwned(address);

    // Get the caller address
    const callerAddress = await this.getCallerAddressFromIndex(pin, addressIndex);

    // Build and send transaction
    const actions = data.actions || [];
    const args = data.args || [];

    const builder = new NanoContractTransactionBuilder()
      .setMethod(method)
      .setWallet(this)
      .setBlueprintId(data.blueprintId as string)
      .setNcId(data.ncId as string)
      .setCaller(callerAddress)
      .setActions(actions)
      .setArgs(args)
      .setVertexType(NanoContractVertexType.TRANSACTION);

    const tx = await builder.build();
    // Use the standard utility to sign and prepare the transaction
    return this.prepareNanoSendTransactionWalletService(tx, address, pin);
  }

  /**
   * Create and send a nano contract transaction
   *
   * @param {string} method Method of nano contract to have the transaction created
   * @param {string} address Address that will be used to sign the nano contract transaction
   * @param {CreateNanoTxData} [data]
   * @param {CreateNanoTxOptions} [options]
   *
   * @returns {Promise<Transaction>} Transaction object returned from execution
   */
  async createAndSendNanoContractTransaction(
    method: string,
    address: string,
    data: CreateNanoTxData,
    options: { pinCode?: string } = {}
  ): Promise<Transaction> {
    const sendTransaction = await this.createNanoContractTransaction(
      method,
      address,
      data,
      options
    );
    const result = await sendTransaction.runFromMining();
    if (!result) {
      throw new Error('Failed to send nano contract transaction');
    }
    return result;
  }

  /**
   * Create and send a Create Token Transaction with nano header
   *
   * @param {string} method Method of nano contract to have the transaction created
   * @param {string} address Address that will be used to sign the nano contract transaction
   * @param {object} data Nano contract data (blueprintId, ncId, actions, args)
   * @param {object} createTokenOptions Options for token creation (mint/melt authorities, NFT, etc)
   * @param {object} options Options (pinCode)
   *
   * @returns {Promise<Transaction>}
   */
  async createAndSendNanoContractCreateTokenTransaction(
    method: string,
    address: string,
    data: CreateNanoTxData,
    createTokenOptions: CreateTokenOptionsInput,
    options: { pinCode?: string } = {}
  ): Promise<Transaction> {
    const sendTransaction = await this.createNanoContractCreateTokenTransaction(
      method,
      address,
      data,
      createTokenOptions,
      options
    );
    const result = await sendTransaction.runFromMining();
    if (!result) {
      throw new Error('Failed to send nano contract create token transaction');
    }
    return result;
  }

  /**
   * Custom nano contract transaction preparation for wallet-service facade
   * Signs the nano contract transaction using the wallet's own key derivation logic
   *
   * @param tx Nano contract transaction to sign
   * @param address Address to use for signing (must belong to this wallet)
   * @param pinCode PIN code to decrypt the private key
   * @returns SendTransactionWalletService instance with the signed and prepared transaction
   */
  async prepareNanoSendTransactionWalletService(
    tx: Transaction,
    address: string,
    pinCode: string
  ): Promise<SendTransactionWalletService> {
    // Get the index for the address
    const addressDetails = await this.getAddressDetails(address);
    const addressIndex = addressDetails?.index;

    if (addressIndex === undefined) {
      throw new Error(
        `Address used to sign the transaction (${address}) does not belong to the wallet.`
      );
    }

    const storageProxy = new WalletServiceStorageProxy(this, this.storage);

    await transaction.signTransaction(tx, storageProxy.createProxy(), pinCode);

    // Finalize the transaction
    tx.prepareToSend();

    const sendTransaction = new SendTransactionWalletService(this, {
      transaction: tx,
      pin: pinCode,
    });
    return sendTransaction;
  }

  /**
   * Create a Create Token Transaction with nano header and return the SendTransaction object
   *
   * @param {string} method Method of nano contract to have the transaction created
   * @param {string} address Address that will be used to sign the nano contract transaction
   * @param {object} data Nano contract data (blueprintId, ncId, actions, args)
   * @param {object} createTokenOptions Options for token creation (mint/melt authorities, NFT, etc)
   * @param {object} options Options (pinCode)
   *
   * @returns {Promise<SendTransactionWalletService>}
   */
  async createNanoContractCreateTokenTransaction(
    method: string,
    address: string,
    data: CreateNanoTxData,
    createTokenOptions: CreateTokenOptionsInput,
    options: { pinCode?: string } = {}
  ): Promise<SendTransactionWalletService> {
    this.failIfWalletNotReady();
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('createNanoContractCreateTokenTransaction');
    }
    const newOptions = { pinCode: null, ...options };
    const pin = newOptions.pinCode;
    if (!pin) {
      throw new PinRequiredError('Pin is required.');
    }

    // Verify address belongs to wallet and get its index
    const addressIndex = await this.getAddressIndexIfOwned(address);

    // Get the caller address
    const callerAddress = await this.getCallerAddressFromIndex(pin, addressIndex);

    // Build and send transaction
    const actions = data.actions || [];
    const args = data.args || [];

    const mergedCreateTokenOptions: NanoContractBuilderCreateTokenOptions = {
      changeAddress: null,
      createMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      data: null,
      isCreateNFT: false,
      ...createTokenOptions,
    } as NanoContractBuilderCreateTokenOptions;

    const builder = new NanoContractTransactionBuilder()
      .setMethod(method)
      .setWallet(this)
      .setBlueprintId(data.blueprintId as string)
      .setNcId(data.ncId as string)
      .setCaller(callerAddress)
      .setActions(actions)
      .setArgs(args)
      .setVertexType(NanoContractVertexType.CREATE_TOKEN_TRANSACTION, mergedCreateTokenOptions);

    const tx = await builder.build();

    return this.prepareNanoSendTransactionWalletService(tx, address, pin);
  }
}

export default HathorWalletServiceWallet;
