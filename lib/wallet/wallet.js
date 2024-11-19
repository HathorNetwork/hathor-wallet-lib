"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _events = require("events");
var _bitcoreLib = _interopRequireWildcard(require("bitcore-lib"));
var _assert = _interopRequireDefault(require("assert"));
var _constants = require("../constants");
var _crypto = require("../utils/crypto");
var _walletApi = _interopRequireDefault(require("./api/walletApi"));
var _address = require("../utils/address");
var _wallet = _interopRequireDefault(require("../utils/wallet"));
var _helpers = _interopRequireDefault(require("../utils/helpers"));
var _transaction = _interopRequireDefault(require("../utils/transaction"));
var _tokens = _interopRequireDefault(require("../utils/tokens"));
var _config = _interopRequireDefault(require("../config"));
var _p2pkh = _interopRequireDefault(require("../models/p2pkh"));
var _transaction2 = _interopRequireDefault(require("../models/transaction"));
var _create_token_transaction = _interopRequireDefault(require("../models/create_token_transaction"));
var _output = _interopRequireDefault(require("../models/output"));
var _input = _interopRequireDefault(require("../models/input"));
var _address2 = _interopRequireDefault(require("../models/address"));
var _network = _interopRequireDefault(require("../network"));
var _storage = require("../storage");
var _connection = _interopRequireDefault(require("./connection"));
var _sendTransactionWalletService = _interopRequireDefault(require("./sendTransactionWalletService"));
var _types = require("./types");
var _errors = require("../errors");
var _errorMessages = require("../errorMessages");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _awaitAsyncGenerator(e) { return new _OverloadYield(e, 0); }
function _wrapAsyncGenerator(e) { return function () { return new AsyncGenerator(e.apply(this, arguments)); }; }
function AsyncGenerator(e) { var r, t; function resume(r, t) { try { var n = e[r](t), o = n.value, u = o instanceof _OverloadYield; Promise.resolve(u ? o.v : o).then(function (t) { if (u) { var i = "return" === r ? "return" : "next"; if (!o.k || t.done) return resume(i, t); t = e[i](t).value; } settle(n.done ? "return" : "normal", t); }, function (e) { resume("throw", e); }); } catch (e) { settle("throw", e); } } function settle(e, n) { switch (e) { case "return": r.resolve({ value: n, done: !0 }); break; case "throw": r.reject(n); break; default: r.resolve({ value: n, done: !1 }); } (r = r.next) ? resume(r.key, r.arg) : t = null; } this._invoke = function (e, n) { return new Promise(function (o, u) { var i = { key: e, arg: n, resolve: o, reject: u, next: null }; t ? t = t.next = i : (r = t = i, resume(e, n)); }); }, "function" != typeof e.return && (this.return = void 0); }
AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function () { return this; }, AsyncGenerator.prototype.next = function (e) { return this._invoke("next", e); }, AsyncGenerator.prototype.throw = function (e) { return this._invoke("throw", e); }, AsyncGenerator.prototype.return = function (e) { return this._invoke("return", e); };
function _OverloadYield(e, d) { this.v = e, this.k = d; } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Time in milliseconds berween each polling to check wallet status
// if it ended loading and became ready
const WALLET_STATUS_POLLING_INTERVAL = 3000;
var walletState = /*#__PURE__*/function (walletState) {
  walletState["NOT_STARTED"] = "Not started";
  walletState["LOADING"] = "Loading";
  walletState["READY"] = "Ready";
  return walletState;
}(walletState || {});
class HathorWalletServiceWallet extends _events.EventEmitter {
  constructor({
    requestPassword,
    seed = null,
    xpriv = null,
    authxpriv = null,
    xpub = null,
    network,
    passphrase = '',
    enableWs = true,
    storage = null
  }) {
    super();
    // String with wallet passphrase
    _defineProperty(this, "passphrase", void 0);
    // Wallet id from the wallet service
    _defineProperty(this, "walletId", void 0);
    // Network in which the wallet is connected ('mainnet' or 'testnet')
    _defineProperty(this, "network", void 0);
    // Method to request the password from the client
    _defineProperty(this, "requestPassword", void 0);
    // String with 24 words separated by space
    _defineProperty(this, "seed", void 0);
    // Xpub of the wallet
    _defineProperty(this, "xpub", void 0);
    // Xpriv of the wallet on the account derivation path
    _defineProperty(this, "xpriv", void 0);
    // Xpriv of the auth derivation path
    _defineProperty(this, "authPrivKey", void 0);
    // State of the wallet. One of the walletState enum options
    _defineProperty(this, "state", void 0);
    // Variable to prevent start sending more than one tx concurrently
    _defineProperty(this, "isSendingTx", void 0);
    // ID of tx proposal
    _defineProperty(this, "txProposalId", void 0);
    // Auth token to be used in the wallet API requests to wallet service
    _defineProperty(this, "authToken", void 0);
    // Wallet status interval
    // Variable to store the possible addresses to use that are after the last used address
    _defineProperty(this, "newAddresses", void 0);
    // Index of the address to be used by the wallet
    _defineProperty(this, "indexToUse", void 0);
    // WalletService-ready connection class
    _defineProperty(this, "conn", void 0);
    // Flag to indicate if the wallet was already connected when the websocket conn is established
    _defineProperty(this, "firstConnection", void 0);
    // Flag to indicate if the websocket connection is enabled
    _defineProperty(this, "_isWsEnabled", void 0);
    _defineProperty(this, "storage", void 0);
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
      _wallet.default.wordsValid(seed);
    }
    if (!storage) {
      const store = new _storage.MemoryStore();
      this.storage = new _storage.Storage(store);
    } else {
      this.storage = storage;
    }

    // Setup the connection so clients can listen to its events before it is started
    this.conn = new _connection.default();
    this._isWsEnabled = enableWs;
    this.state = walletState.NOT_STARTED;
    this.xpriv = xpriv;
    this.seed = seed;
    this.xpub = xpub;
    if (authxpriv && !_bitcoreLib.default.HDPrivateKey.isValidSerialized(authxpriv)) {
      throw new Error('authxpriv parameter is an invalid hd privatekey');
    }
    this.authPrivKey = authxpriv ? _bitcoreLib.default.HDPrivateKey(authxpriv) : null;
    this.passphrase = passphrase;
    this.requestPassword = requestPassword;

    // ID of wallet after created on wallet service
    this.walletId = null;
    this.isSendingTx = false;
    this.txProposalId = null;
    this.xpub = null;
    this.network = network;
    _network.default.setNetwork(this.network.name);
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
  async changeServer(newServer) {
    await this.storage.store.setItem('wallet:wallet_service:base_server', newServer);
    _config.default.setWalletServiceBaseUrl(newServer);
  }

  /**
   * Sets the websocket server to connect on config singleton and storage
   *
   * @param {String} newServer - The new websocket server to set the config and storage to
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async changeWsServer(newServer) {
    await this.storage.store.setItem('wallet:wallet_service:ws_server', newServer);
    _config.default.setWalletServiceBaseWsUrl(newServer);
  }

  /**
   * Gets the stored websocket and base server urls
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getServerUrlsFromStorage() {
    const walletServiceBaseUrl = await this.storage.store.getItem('wallet:wallet_service:base_server');
    const walletServiceWsUrl = await this.storage.store.getItem('wallet:wallet_service:ws_server');
    return {
      walletServiceBaseUrl,
      walletServiceWsUrl
    };
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
  static getAuthXPubKeyFromSeed(seed, options = {}) {
    const methodOptions = {
      passphrase: '',
      networkName: 'mainnet',
      ...options
    };
    const xpriv = _wallet.default.getXPrivKeyFromSeed(seed, methodOptions);
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
  static deriveAuthPrivateKey(xpriv) {
    return xpriv.deriveNonCompliantChild(_constants.WALLET_SERVICE_AUTH_DERIVATION_PATH);
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
  static getWalletIdFromXPub(xpub) {
    return _wallet.default.getWalletIdFromXPub(xpub);
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
  async start({
    pinCode,
    password
  } = {}) {
    if (!pinCode) {
      throw new Error('Pin code is required when starting the wallet.');
    }
    this.setState(walletState.LOADING);
    let hasAccessData;
    try {
      const accessData = await this.storage.getAccessData();
      hasAccessData = !!accessData;
    } catch (err) {
      if (err instanceof _errors.UninitializedWalletError) {
        hasAccessData = false;
      } else {
        throw err;
      }
    }
    if (!hasAccessData) {
      let accessData;
      if (this.seed) {
        if (!password) {
          throw new Error('Password is required when starting the wallet from the seed.');
        }
        accessData = _wallet.default.generateAccessDataFromSeed(this.seed, {
          passphrase: this.passphrase,
          pin: pinCode,
          password,
          networkName: this.network.name
          // multisig: not implemented on wallet service yet
        });
      } else if (this.xpriv) {
        // generateAccessDataFromXpriv expects a xpriv on the change level path
        const accountLevelPrivKey = new _bitcoreLib.default.HDPrivateKey(this.xpriv);
        const changeLevelPrivKey = accountLevelPrivKey.deriveNonCompliantChild(0);
        accessData = _wallet.default.generateAccessDataFromXpriv(changeLevelPrivKey.xprivkey, {
          pin: pinCode,
          authXpriv: this.authPrivKey.xprivkey
          // multisig: not implemented on wallet service yet
        });
      } else {
        throw new Error('WalletService facade initialized without seed or xprivkey');
      }
      await this.storage.saveAccessData(accessData);
    }
    const {
      xpub,
      authXpub,
      xpubkeySignature,
      authXpubkeySignature,
      timestampNow,
      firstAddress,
      authDerivedPrivKey
    } = await this.generateCreateWalletAuthData(pinCode);
    this.xpub = xpub;
    this.authPrivKey = authDerivedPrivKey;
    const handleCreate = async data => {
      this.walletId = data.walletId;
      if (data.status === 'creating') {
        // If the wallet status is creating, we should wait until it is ready
        // before continuing
        await this.pollForWalletStatus();
      } else if (data.status !== 'ready') {
        // At this stage, if the wallet is not `ready` or `creating` we should
        // throw an error as there are only three states: `ready`, `creating` or `error`
        throw new _errors.WalletRequestError(_errorMessages.ErrorMessages.WALLET_STATUS_ERROR, {
          cause: data.status
        });
      }
      await this.onWalletReady();
    };
    const data = await _walletApi.default.createWallet(this, xpub, xpubkeySignature, authXpub, authXpubkeySignature, timestampNow, firstAddress);
    await handleCreate(data.status);
    this.clearSensitiveData();
  }

  /**
   * Returns version data from the connected fullnode
   * */
  async getVersionData() {
    return _walletApi.default.getVersionData(this);
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
  async generateCreateWalletAuthData(pinCode) {
    let xpub;
    let authXpub;
    let privKeyAccountPath;
    let authDerivedPrivKey;
    const now = Date.now();
    const timestampNow = Math.floor(now / 1000); // in seconds

    if (this.seed) {
      // getXPrivKeyFromSeed returns a HDPrivateKey on the root path
      const privKey = _wallet.default.getXPrivKeyFromSeed(this.seed, {
        passphrase: this.passphrase,
        networkName: this.network.name
      });
      // getXPubKeyFromSeed returns a xpubkey on the account level path
      xpub = _wallet.default.getXPubKeyFromSeed(this.seed, {
        passphrase: this.passphrase,
        networkName: this.network.name
      });
      authXpub = HathorWalletServiceWallet.getAuthXPubKeyFromSeed(this.seed, {
        passphrase: this.passphrase,
        networkName: this.network.name
      });
      privKeyAccountPath = _wallet.default.deriveXpriv(privKey, "0'");
      authDerivedPrivKey = HathorWalletServiceWallet.deriveAuthPrivateKey(privKey);
    } else if (this.xpriv) {
      // this.xpriv is already on the account derivation path
      privKeyAccountPath = _bitcoreLib.default.HDPrivateKey(this.xpriv);
      xpub = privKeyAccountPath.xpubkey;

      // If the wallet is being loaded from the xpriv, we assume we already have the authXPriv on storage, so just fetch it
      authDerivedPrivKey = _bitcoreLib.default.HDPrivateKey.fromString(await this.storage.getAuthPrivKey(pinCode));
      authXpub = authDerivedPrivKey.xpubkey;
    } else {
      throw new Error('generateCreateWalletAuthData called without seed or xpriv in memory.');
    }
    const walletId = HathorWalletServiceWallet.getWalletIdFromXPub(xpub);

    // prove we own the xpubkey
    const xpubkeySignature = this.signMessage(privKeyAccountPath, timestampNow, walletId);

    // prove we own the auth_xpubkey
    const authXpubkeySignature = this.signMessage(authDerivedPrivKey, timestampNow, walletId);
    const xpubChangeDerivation = _wallet.default.xpubDeriveChild(xpub, 0);
    const {
      base58: firstAddress
    } = (0, _address.deriveAddressFromXPubP2PKH)(xpubChangeDerivation, 0, this.network.name);
    return {
      xpub,
      xpubkeySignature,
      authXpub,
      authXpubkeySignature,
      timestampNow,
      firstAddress,
      authDerivedPrivKey
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
  async onNewTx(newTx) {
    const {
      outputs
    } = newTx;
    let shouldGetNewAddresses = false;
    for (const output of outputs) {
      if (this.newAddresses.find(newAddress => newAddress.address === output.decoded.address)) {
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
  getAuthToken() {
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
  async getTxBalance(tx, optionsParam = {}) {
    const options = {
      includeAuthorities: false,
      ...optionsParam
    };
    const addresses = [];
    const generator = this.getAllAddresses();

    // We are not using for async (...) to maintain compatibility with older nodejs versions
    // if we ever deprecate older node versions, we can refactor this to the new, cleaner syntax
    let nextAddress = await generator.next();
    while (!nextAddress.done) {
      addresses.push(nextAddress.value.address);
      nextAddress = await generator.next();
    }
    const balance = {};
    for (const txout of tx.outputs) {
      if (_transaction.default.isAuthorityOutput(txout)) {
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
      if (_transaction.default.isAuthorityOutput(txin)) {
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
  async pollForWalletStatus() {
    return new Promise((resolve, reject) => {
      const pollIntervalTimer = setInterval(async () => {
        const data = await _walletApi.default.getWalletStatus(this);
        if (data.status.status === 'ready') {
          clearInterval(pollIntervalTimer);
          resolve();
        } else if (data.status.status !== 'creating') {
          // Only possible states are 'ready', 'creating' and 'error', if status
          // is not ready or creating, we should reject the promise
          clearInterval(pollIntervalTimer);
          reject(new _errors.WalletRequestError('Error getting wallet status.', {
            cause: data.status
          }));
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
  failIfWalletNotReady() {
    if (!this.isReady()) {
      throw new _errors.WalletError('Wallet not ready');
    }
  }

  /**
   * Method executed when wallet is ready
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async onWalletReady() {
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
    this.conn.on('new-tx', newTx => this.onNewTx(newTx));
    this.conn.on('update-tx', updatedTx => this.onUpdateTx(updatedTx));
    this.conn.on('state', newState => this.onConnectionChangedState(newState));
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
  onConnectionChangedState(newState) {
    if (newState === _types.ConnectionState.CONNECTED) {
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
  getAllAddresses() {
    var _this = this;
    return _wrapAsyncGenerator(function* () {
      _this.failIfWalletNotReady();
      const data = yield _awaitAsyncGenerator(_walletApi.default.getAddresses(_this));
      for (const address of data.addresses) {
        yield address;
      }
    })();
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
  async getNewAddresses(ignoreWalletReady = false) {
    // If the user is sure the wallet service has already loaded his wallet, he can ignore the check
    if (!ignoreWalletReady) {
      // We should fail if the wallet is not ready because the wallet service address load mechanism is
      // asynchronous, so we will get an empty or partial array of addresses if they are not all loaded.
      this.failIfWalletNotReady();
    }
    const data = await _walletApi.default.getNewAddresses(this);
    this.newAddresses = data.addresses;
    this.indexToUse = 0;
  }

  /**
   * Get the balance of the wallet for a specific token
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getBalance(token = null) {
    this.failIfWalletNotReady();
    const data = await _walletApi.default.getBalances(this, token);
    return data.balances;
  }
  async getTokens() {
    this.failIfWalletNotReady();
    const data = await _walletApi.default.getTokens(this);
    return data.tokens;
  }

  /**
   * Get the history of the wallet for a specific token
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getTxHistory(options = {}) {
    this.failIfWalletNotReady();
    const data = await _walletApi.default.getHistory(this, options);
    return data.history;
  }

  /**
   * Get utxo from tx id and index
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getUtxoFromId(txId, index) {
    const data = await _walletApi.default.getTxOutputs(this, {
      txId,
      index,
      skipSpent: true // This is the API default, but we should be explicit about it
    });
    const utxos = data.txOutputs;
    if (utxos.length === 0) {
      // No utxo for this txId/index or is not from the requested wallet
      return null;
    }
    if (utxos.length > 1) {
      throw new _errors.UtxoError(`Expected to receive only one utxo for txId ${txId} and index ${index} but received ${utxos.length}.`);
    }
    return utxos[0];
  }

  /**
   * Get utxos for filling a transaction
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getUtxos(options = {}) {
    const newOptions = {
      tokenId: _constants.NATIVE_TOKEN_UID,
      authority: null,
      addresses: null,
      totalAmount: null,
      count: 1,
      ...options,
      ignoreLocked: true,
      skipSpent: true // We only want UTXOs
    };
    if (!newOptions.authority && !newOptions.totalAmount) {
      throw new _errors.UtxoError("We need the total amount of utxos if it's not an authority request.");
    }
    const data = await _walletApi.default.getTxOutputs(this, newOptions);
    let changeAmount = 0n;
    let utxos = [];
    if (data.txOutputs.length === 0) {
      // No utxos available for the requested filter
      utxos = data.txOutputs;
    } else if (newOptions.authority) {
      // Requests an authority utxo, then I return the count of requested authority utxos
      utxos = data.txOutputs.slice(0, newOptions.count);
    } else {
      // We got an array of utxos, then we must check if there is enough amount to fill the totalAmount
      // and slice the least possible utxos
      const ret = _transaction.default.selectUtxos(data.txOutputs, newOptions.totalAmount);
      changeAmount = ret.changeAmount;
      utxos = ret.utxos;
    }
    return {
      utxos,
      changeAmount
    };
  }

  /**
   * Signs a message using xpriv derivation path m/44'/280'/0'
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  signMessage(hdPrivKey, timestamp, walletId) {
    const address = hdPrivKey.publicKey.toAddress(this.network.getNetwork()).toString();
    const message = String(timestamp).concat(walletId).concat(address);
    return (0, _crypto.signMessage)(message, hdPrivKey.privateKey);
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
  async validateAndRenewAuthToken(usePassword) {
    if (!this.walletId) {
      throw new Error('Wallet not ready yet.');
    }
    const now = new Date();
    const timestampNow = Math.floor(now.getTime() / 1000);
    const validateJWTExpireDate = token => {
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
        const password = usePassword || (await this.requestPassword());

        // Use it to get the words from the storage
        privKey = _bitcoreLib.default.HDPrivateKey.fromString(await this.storage.getAuthPrivKey(password));
      }
      await this.renewAuthToken(privKey, timestampNow);
    } else if (usePassword) {
      // If we have received the user PIN, we should renew the token anyway
      // without blocking this method's promise

      const privKey = _bitcoreLib.default.HDPrivateKey.fromString(await this.storage.getAuthPrivKey(usePassword));
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
  async renewAuthToken(privKey, timestamp) {
    if (!this.walletId) {
      throw new Error('Wallet not ready yet.');
    }
    const sign = this.signMessage(privKey, timestamp, this.walletId);
    const data = await _walletApi.default.createAuthToken(this, timestamp, privKey.xpubkey, sign);
    this.authToken = data.token;
  }

  /**
   * Creates and send a transaction from an array of inputs and outputs
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async sendManyOutputsTransaction(outputs, options = {}) {
    this.failIfWalletNotReady();
    const newOptions = {
      inputs: [],
      changeAddress: null,
      ...options
    };
    const {
      inputs,
      changeAddress,
      pinCode
    } = newOptions;
    const sendTransactionOutputs = outputs.map(output => {
      const typedOutput = output;
      if (typedOutput.type === _types.OutputType.DATA) {
        typedOutput.value = 1n;
        typedOutput.token = _constants.NATIVE_TOKEN_UID;
      } else {
        typedOutput.type = _helpers.default.getOutputTypeFromAddress(typedOutput.address, this.network);
      }
      return typedOutput;
    });
    const sendTransaction = new _sendTransactionWalletService.default(this, {
      outputs: sendTransactionOutputs,
      inputs,
      changeAddress,
      pin: pinCode
    });
    return sendTransaction.run();
  }

  /**
   * Creates and send a simple transaction with one output
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async sendTransaction(address, value, options = {}) {
    this.failIfWalletNotReady();
    const newOptions = {
      token: '00',
      changeAddress: undefined,
      ...options
    };
    const {
      token,
      changeAddress,
      pinCode
    } = newOptions;
    const outputs = [{
      address,
      value,
      token
    }];
    return this.sendManyOutputsTransaction(outputs, {
      inputs: [],
      changeAddress,
      pinCode
    });
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
  getInputData(xprivkey, dataToSignHash, addressPath) {
    const xpriv = _bitcoreLib.default.HDPrivateKey(xprivkey);
    const derivedKey = xpriv.deriveNonCompliantChild(addressPath);
    const {
      privateKey
    } = derivedKey;
    const arr = [];
    _helpers.default.pushDataToStack(arr, _transaction.default.getSignature(dataToSignHash, privateKey));
    _helpers.default.pushDataToStack(arr, derivedKey.publicKey.toBuffer());
    return _bitcoreLib.util.buffer.concat(arr);
  }

  /**
   * Return if wallet is ready to be used
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  isReady() {
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
  setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  /**
   * Stop the wallet
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async stop({
    cleanStorage = true
  } = {}) {
    this.walletId = null;
    this.state = walletState.NOT_STARTED;
    this.firstConnection = true;
    this.removeAllListeners();
    await this.storage.handleStop({
      cleanStorage
    });
    this.conn.stop();
  }

  /**
   * Get address at specific index
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async getAddressAtIndex(index) {
    const {
      addresses
    } = await _walletApi.default.getAddresses(this, index);
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
  async getAddressPrivKey(pinCode, addressIndex) {
    const mainXPrivKey = await this.storage.getMainXPrivKey(pinCode);
    const addressHDPrivKey = new _bitcoreLib.default.HDPrivateKey(mainXPrivKey).derive(addressIndex);
    return addressHDPrivKey;
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
  getCurrentAddress({
    markAsUsed = false
  } = {}) {
    const newAddressesLen = this.newAddresses.length;
    if (this.indexToUse > newAddressesLen - 1) {
      const addressInfo = this.newAddresses[newAddressesLen - 1];
      return {
        ...addressInfo,
        info: 'GAP_LIMIT_REACHED'
      };
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
  async signMessageWithAddress(message, index, pinCode) {
    const addressHDPrivKey = await this.getAddressPrivKey(pinCode, index);
    const signedMessage = (0, _crypto.signMessage)(message, addressHDPrivKey.privateKey);
    return signedMessage;
  }

  /**
   * Get the next address after the current available
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  getNextAddress() {
    // First we mark the current address as used, then return the next
    this.getCurrentAddress({
      markAsUsed: true
    });
    return this.getCurrentAddress();
  }

  /* eslint-disable class-methods-use-this -- Methods are not yet implemented */
  getAddressIndex(address) {
    throw new _errors.WalletError('Not implemented.');
  }
  isAddressMine(address) {
    throw new _errors.WalletError('Not implemented.');
  }
  getTx(id) {
    throw new _errors.WalletError('Not implemented.');
  }
  getAddressInfo(address, options = {}) {
    throw new _errors.WalletError('Not implemented.');
  }
  consolidateUtxos(destinationAddress, options = {}) {
    throw new _errors.WalletError('Not implemented.');
  }
  getFullHistory() {
    throw new _errors.WalletError('Not implemented.');
  }
  /* eslint-enable class-methods-use-this */

  /**
   * Checks if the given array of addresses belongs to the caller wallet
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async checkAddressesMine(addresses) {
    const response = await _walletApi.default.checkAddressesMine(this, addresses);
    return response.addresses;
  }

  /**
   * Create SendTransaction object and run from mining
   * Returns a promise that resolves when the send succeeds
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async handleSendPreparedTransaction(transactionObj) {
    const sendTransaction = new _sendTransactionWalletService.default(this, {
      transaction: transactionObj
    });
    return sendTransaction.runFromMining();
  }

  /**
   * Prepare create new token data, sign the inputs and returns an object ready to be mined
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareCreateNewToken(name, symbol, amount, options = {}) {
    this.failIfWalletNotReady();
    const newOptions = {
      address: null,
      changeAddress: null,
      createMintAuthority: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMeltAuthority: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      nftData: null,
      pinCode: null,
      signTx: true,
      ...options
    };
    if (newOptions.mintAuthorityAddress && !newOptions.allowExternalMintAuthorityAddress) {
      // Validate that the mint authority address belongs to the wallet
      const checkAddressMineMap = await this.checkAddressesMine([newOptions.mintAuthorityAddress]);
      if (!checkAddressMineMap[newOptions.mintAuthorityAddress]) {
        throw new _errors.SendTxError('The mint authority address must belong to your wallet.');
      }
    }
    if (newOptions.meltAuthorityAddress && !newOptions.allowExternalMeltAuthorityAddress) {
      // Validate that the melt authority address belongs to the wallet
      const checkAddressMineMap = await this.checkAddressesMine([newOptions.meltAuthorityAddress]);
      if (!checkAddressMineMap[newOptions.meltAuthorityAddress]) {
        throw new _errors.SendTxError('The melt authority address must belong to your wallet.');
      }
    }
    const isNFT = newOptions.nftData !== null;
    const depositPercent = this.storage.getTokenDepositPercentage();
    // 1. Calculate HTR deposit needed
    let deposit = _tokens.default.getDepositAmount(amount, depositPercent);
    if (isNFT) {
      // For NFT we have a fee of 0.01 HTR, then the deposit utxo query must get an additional 1
      deposit += 1n;
    }

    // 2. Get utxos for HTR
    const {
      utxos,
      changeAmount
    } = await this.getUtxos({
      tokenId: _constants.NATIVE_TOKEN_UID,
      totalAmount: deposit
    });
    if (utxos.length === 0) {
      throw new _errors.UtxoError(`No utxos available to fill the request. Token: HTR - Amount: ${deposit}.`);
    }
    const utxosAddressPath = [];
    // 3. Create the transaction object with the inputs and outputs (new token amount, change address with HTR, mint/melt authorities - depending on parameters)
    const inputsObj = [];
    for (const utxo of utxos) {
      inputsObj.push(new _input.default(utxo.txId, utxo.index));
      utxosAddressPath.push(utxo.addressPath);
    }

    // Create outputs
    const outputsObj = [];
    // NFT transactions must have the first output as the script data
    if (isNFT) {
      outputsObj.push(_helpers.default.createNFTOutput(newOptions.nftData));
    }
    // a. Token amount
    const addressToUse = newOptions.address || this.getCurrentAddress({
      markAsUsed: true
    }).address;
    const address = new _address2.default(addressToUse, {
      network: this.network
    });
    if (!address.isValid()) {
      throw new _errors.SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    const p2pkhScript = address.getScript();
    outputsObj.push(new _output.default(amount, p2pkhScript, {
      tokenData: 1
    }));
    if (newOptions.createMintAuthority) {
      // b. Mint authority
      const mintAuthorityAddress = newOptions.mintAuthorityAddress || this.getCurrentAddress({
        markAsUsed: true
      }).address;
      const mintAuthorityAddressObj = new _address2.default(mintAuthorityAddress, {
        network: this.network
      });
      if (!mintAuthorityAddressObj.isValid()) {
        throw new _errors.SendTxError(`Address ${newOptions.mintAuthorityAddress} is not valid.`);
      }
      const p2pkhMintAuthorityScript = mintAuthorityAddressObj.getScript();
      outputsObj.push(new _output.default(_constants.TOKEN_MINT_MASK, p2pkhMintAuthorityScript, {
        tokenData: _constants.AUTHORITY_TOKEN_DATA
      }));
    }
    if (newOptions.createMeltAuthority) {
      // c. Melt authority
      const meltAuthorityAddress = newOptions.meltAuthorityAddress || this.getCurrentAddress({
        markAsUsed: true
      }).address;
      const meltAuthorityAddressObj = new _address2.default(meltAuthorityAddress, {
        network: this.network
      });
      if (!meltAuthorityAddressObj.isValid()) {
        throw new _errors.SendTxError(`Address ${newOptions.meltAuthorityAddress} is not valid.`);
      }
      const p2pkhMeltAuthorityScript = meltAuthorityAddressObj.getScript();
      outputsObj.push(new _output.default(_constants.TOKEN_MELT_MASK, p2pkhMeltAuthorityScript, {
        tokenData: _constants.AUTHORITY_TOKEN_DATA
      }));
    }
    if (changeAmount) {
      // d. HTR change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({
        markAsUsed: true
      }).address;
      const changeAddress = new _address2.default(changeAddressStr, {
        network: this.network
      });
      if (!changeAddress.isValid()) {
        throw new _errors.SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new _p2pkh.default(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript();
      outputsObj.push(new _output.default(changeAmount, p2pkhChangeScript));
    }
    const tx = new _create_token_transaction.default(name, symbol, inputsObj, outputsObj);

    // Sign transaction
    if (newOptions.signTx) {
      const dataToSignHash = tx.getDataToSignHash();
      if (!newOptions.pinCode) {
        throw new Error('PIN not specified in prepareCreateNewToken options');
      }
      const xprivkey = await this.storage.getMainXPrivKey(newOptions.pinCode);
      for (const [idx, inputObj] of tx.inputs.entries()) {
        const inputData = this.getInputData(xprivkey, dataToSignHash, HathorWalletServiceWallet.getAddressIndexFromFullPath(utxosAddressPath[idx]));
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
  static getAddressIndexFromFullPath(fullPath) {
    const parts = fullPath.split('/');
    _assert.default.equal(6, parts.length);
    return parseInt(parts[5], 10);
  }

  /**
   * Helper method to get authority tx_outputs
   * Uses the getTxOutputs API method to return one or many authorities
   */
  async _getAuthorityTxOutput(options) {
    const {
      txOutputs
    } = await _walletApi.default.getTxOutputs(this, options);
    return txOutputs.map(txOutput => ({
      txId: txOutput.txId,
      index: txOutput.index,
      address: txOutput.address,
      authorities: txOutput.authorities
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
  async getMintAuthority(tokenId, options = {}) {
    const newOptions = {
      many: false,
      skipSpent: true,
      ...options
    };
    return this._getAuthorityTxOutput({
      tokenId,
      authority: _constants.TOKEN_MINT_MASK,
      skipSpent: newOptions.skipSpent,
      maxOutputs: newOptions.many ? undefined : 1
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
  async getMeltAuthority(tokenId, options = {}) {
    const newOptions = {
      many: false,
      skipSpent: true,
      ...options
    };
    return this._getAuthorityTxOutput({
      tokenId,
      authority: _constants.TOKEN_MELT_MASK,
      skipSpent: newOptions.skipSpent,
      maxOutputs: newOptions.many ? undefined : 1
    });
  }

  /**
   * Create a new custom token in the network
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async createNewToken(name, symbol, amount, options = {}) {
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
  async prepareMintTokensData(token, amount, options = {}) {
    this.failIfWalletNotReady();
    const newOptions = {
      address: null,
      changeAddress: null,
      createAnotherMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      pinCode: null,
      signTx: true,
      ...options
    };
    if (newOptions.mintAuthorityAddress && !newOptions.allowExternalMintAuthorityAddress) {
      // Validate that the mint authority address belongs to the wallet
      const checkAddressMineMap = await this.checkAddressesMine([newOptions.mintAuthorityAddress]);
      if (!checkAddressMineMap[newOptions.mintAuthorityAddress]) {
        throw new _errors.SendTxError('The mint authority address must belong to your wallet.');
      }
    }

    // 1. Calculate HTR deposit needed
    const depositPercent = this.storage.getTokenDepositPercentage();
    const deposit = _tokens.default.getDepositAmount(amount, depositPercent);

    // 2. Get utxos for HTR
    const {
      utxos,
      changeAmount
    } = await this.getUtxos({
      tokenId: _constants.NATIVE_TOKEN_UID,
      totalAmount: deposit
    });
    if (utxos.length === 0) {
      throw new _errors.UtxoError(`No utxos available to fill the request. Token: HTR - Amount: ${deposit}.`);
    }

    // 3. Get mint authority
    const ret = await this.getUtxos({
      tokenId: token,
      authority: _constants.TOKEN_MINT_MASK
    });
    if (ret.utxos.length === 0) {
      throw new _errors.UtxoError(`No authority utxo available for minting tokens. Token: ${token}.`);
    }
    // it's safe to assume that we have an utxo in the array
    const mintUtxo = ret.utxos[0];

    // 4. Create inputs from utxos
    const inputsObj = [];
    for (const utxo of utxos) {
      // First add HTR utxos
      inputsObj.push(new _input.default(utxo.txId, utxo.index));
    }

    // Then add a single mint authority utxo
    inputsObj.push(new _input.default(mintUtxo.txId, mintUtxo.index));

    // Create outputs
    const outputsObj = [];
    // a. Token amount
    const addressToUse = newOptions.address || this.getCurrentAddress({
      markAsUsed: true
    }).address;
    const address = new _address2.default(addressToUse, {
      network: this.network
    });
    if (!address.isValid()) {
      throw new _errors.SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    const p2pkhScript = address.getScript();
    outputsObj.push(new _output.default(amount, p2pkhScript, {
      tokenData: 1
    }));
    if (newOptions.createAnotherMint) {
      // b. Mint authority
      const authorityAddress = newOptions.mintAuthorityAddress || this.getCurrentAddress({
        markAsUsed: true
      }).address;
      const authorityAddressObj = new _address2.default(authorityAddress, {
        network: this.network
      });
      if (!authorityAddressObj.isValid()) {
        throw new _errors.SendTxError(`Address ${newOptions.mintAuthorityAddress} is not valid.`);
      }
      const p2pkhAuthorityScript = authorityAddressObj.getScript();
      outputsObj.push(new _output.default(_constants.TOKEN_MINT_MASK, p2pkhAuthorityScript, {
        tokenData: _constants.AUTHORITY_TOKEN_DATA
      }));
    }
    if (changeAmount) {
      // c. HTR change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({
        markAsUsed: true
      }).address;
      const changeAddress = new _address2.default(changeAddressStr, {
        network: this.network
      });
      if (!changeAddress.isValid()) {
        throw new _errors.SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new _p2pkh.default(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript();
      outputsObj.push(new _output.default(changeAmount, p2pkhChangeScript));
    }
    const tx = new _transaction2.default(inputsObj, outputsObj);
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
        const addressPath = idx === tx.inputs.length - 1 ? mintUtxo.addressPath : utxos[idx].addressPath;
        const inputData = this.getInputData(xprivkey, dataToSignHash, HathorWalletServiceWallet.getAddressIndexFromFullPath(addressPath));
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
  async mintTokens(token, amount, options = {}) {
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
  async getTokenDetails(tokenId) {
    const response = await _walletApi.default.getTokenDetails(this, tokenId);
    const {
      details
    } = response;
    return details;
  }

  /**
   * Prepare melt token data, sign the inputs and returns an object ready to be mined
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  async prepareMeltTokensData(token, amount, options = {}) {
    this.failIfWalletNotReady();
    const newOptions = {
      address: null,
      changeAddress: null,
      createAnotherMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      pinCode: null,
      signTx: true,
      ...options
    };
    if (newOptions.meltAuthorityAddress && !newOptions.allowExternalMeltAuthorityAddress) {
      // Validate that the melt authority address belongs to the wallet
      const checkAddressMineMap = await this.checkAddressesMine([newOptions.meltAuthorityAddress]);
      if (!checkAddressMineMap[newOptions.meltAuthorityAddress]) {
        throw new _errors.SendTxError('The melt authority address must belong to your wallet.');
      }
    }

    // 1. Calculate HTR deposit needed
    const depositPercent = this.storage.getTokenDepositPercentage();
    const withdraw = _tokens.default.getWithdrawAmount(amount, depositPercent);

    // 2. Get utxos for custom token to melt
    const {
      utxos,
      changeAmount
    } = await this.getUtxos({
      tokenId: token,
      totalAmount: amount
    });
    if (utxos.length === 0) {
      throw new _errors.UtxoError(`Not enough tokens to be melted. Token: ${token} - Amount: ${amount}.`);
    }

    // 3. Get mint authority
    const ret = await this.getUtxos({
      tokenId: token,
      authority: _constants.TOKEN_MELT_MASK
    });
    if (ret.utxos.length === 0) {
      throw new _errors.UtxoError(`No authority utxo available for melting tokens. Token: ${token}.`);
    }
    // it's safe to assume that we have an utxo in the array
    const meltUtxo = ret.utxos[0];

    // 4. Create inputs from utxos
    const inputsObj = [];
    for (const utxo of utxos) {
      // First add HTR utxos
      inputsObj.push(new _input.default(utxo.txId, utxo.index));
    }

    // Then add a single mint authority utxo (it's safe to assume that we have an utxo in the array)
    inputsObj.push(new _input.default(meltUtxo.txId, meltUtxo.index));

    // Create outputs
    const outputsObj = [];
    // a. Deposit back
    const addressToUse = newOptions.address || this.getCurrentAddress({
      markAsUsed: true
    }).address;
    const address = new _address2.default(addressToUse, {
      network: this.network
    });
    if (!address.isValid()) {
      throw new _errors.SendTxError(`Address ${newOptions.address} is not valid.`);
    }
    const p2pkh = new _p2pkh.default(address);
    const p2pkhScript = p2pkh.createScript();
    if (withdraw) {
      // We may have nothing to get back
      outputsObj.push(new _output.default(withdraw, p2pkhScript, {
        tokenData: 0
      }));
    }
    if (newOptions.createAnotherMelt) {
      // b. Melt authority
      const authorityAddress = newOptions.meltAuthorityAddress || this.getCurrentAddress({
        markAsUsed: true
      }).address;
      const authorityAddressObj = new _address2.default(authorityAddress, {
        network: this.network
      });
      if (!authorityAddressObj.isValid()) {
        throw new _errors.SendTxError(`Address ${newOptions.meltAuthorityAddress} is not valid.`);
      }
      const p2pkhAuthorityScript = authorityAddressObj.getScript();
      outputsObj.push(new _output.default(_constants.TOKEN_MELT_MASK, p2pkhAuthorityScript, {
        tokenData: _constants.AUTHORITY_TOKEN_DATA
      }));
    }
    if (changeAmount) {
      // c. Token change output
      const changeAddressStr = newOptions.changeAddress || this.getCurrentAddress({
        markAsUsed: true
      }).address;
      const changeAddress = new _address2.default(changeAddressStr, {
        network: this.network
      });
      if (!changeAddress.isValid()) {
        throw new _errors.SendTxError(`Address ${newOptions.changeAddress} is not valid.`);
      }
      const p2pkhChange = new _p2pkh.default(changeAddress);
      const p2pkhChangeScript = p2pkhChange.createScript();
      outputsObj.push(new _output.default(changeAmount, p2pkhChangeScript, {
        tokenData: 1
      }));
    }
    const tx = new _transaction2.default(inputsObj, outputsObj);
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
        const addressPath = idx === tx.inputs.length - 1 ? meltUtxo.addressPath : utxos[idx].addressPath;
        const inputData = this.getInputData(xprivkey, dataToSignHash, HathorWalletServiceWallet.getAddressIndexFromFullPath(addressPath));
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
  async meltTokens(token, amount, options = {}) {
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
  async prepareDelegateAuthorityData(token, type, address, {
    anotherAuthorityAddress = null,
    createAnother = true,
    pinCode = null
  }) {
    this.failIfWalletNotReady();
    let authority;
    let mask;
    if (type === 'mint') {
      authority = 1n;
      mask = _constants.TOKEN_MINT_MASK;
    } else if (type === 'melt') {
      authority = 2n;
      mask = _constants.TOKEN_MELT_MASK;
    } else {
      throw new _errors.WalletError('Type options are mint and melt for delegate authority method.');
    }

    // 1. Get authority utxo to spend
    const ret = await this.getUtxos({
      tokenId: token,
      authority
    });
    if (ret.utxos.length === 0) {
      throw new _errors.UtxoError(`No authority utxo available for delegating authority. Token: ${token} - Type ${type}.`);
    }
    // it's safe to assume that we have an utxo in the array
    const utxo = ret.utxos[0];

    // 2. Create input from utxo
    const inputsObj = [];
    inputsObj.push(new _input.default(utxo.txId, utxo.index));

    // Create outputs
    const outputsObj = [];
    const addressObj = new _address2.default(address, {
      network: this.network
    });
    if (!addressObj.isValid()) {
      throw new _errors.SendTxError(`Address ${address} is not valid.`);
    }
    const p2pkh = new _p2pkh.default(addressObj);
    const p2pkhScript = p2pkh.createScript();
    outputsObj.push(new _output.default(mask, p2pkhScript, {
      tokenData: _constants.AUTHORITY_TOKEN_DATA
    }));
    if (createAnother) {
      const anotherAddressStr = anotherAuthorityAddress || this.getCurrentAddress({
        markAsUsed: true
      }).address;
      const anotherAddress = new _address2.default(anotherAddressStr, {
        network: this.network
      });
      if (!anotherAddress.isValid()) {
        throw new _errors.SendTxError(`Address ${anotherAuthorityAddress} is not valid.`);
      }
      const p2pkhAnotherAddress = new _p2pkh.default(anotherAddress);
      const p2pkhAnotherAddressScript = p2pkhAnotherAddress.createScript();
      outputsObj.push(new _output.default(mask, p2pkhAnotherAddressScript, {
        tokenData: _constants.AUTHORITY_TOKEN_DATA
      }));
    }
    const tx = new _transaction2.default(inputsObj, outputsObj);
    tx.tokens = [token];
    if (!pinCode) {
      throw new Error('PIN not specified in prepareDelegateAuthorityData options');
    }
    const xprivkey = await this.storage.getMainXPrivKey(pinCode);

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();
    const inputData = this.getInputData(xprivkey, dataToSignHash, HathorWalletServiceWallet.getAddressIndexFromFullPath(utxo.addressPath));
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
  async delegateAuthority(token, type, address, options) {
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
  async prepareDestroyAuthorityData(token, type, count, {
    pinCode = null
  }) {
    this.failIfWalletNotReady();
    let authority;
    if (type === 'mint') {
      authority = 1n;
    } else if (type === 'melt') {
      authority = 2n;
    } else {
      throw new _errors.WalletError('Type options are mint and melt for destroy authority method.');
    }

    // 1. Get authority utxo to spend
    const ret = await this.getUtxos({
      tokenId: token,
      authority,
      count
    });
    if (ret.utxos.length < count) {
      throw new _errors.UtxoError(`Not enough authority utxos available for destroying. Token: ${token} - Type ${type}. Requested quantity ${count} - Available quantity ${ret.utxos.length}`);
    }

    // 1. Create input from utxo
    const inputsObj = [];
    for (const utxo of ret.utxos) {
      inputsObj.push(new _input.default(utxo.txId, utxo.index));
    }

    // No outputs because we are just destroying the authority utxos

    const tx = new _transaction2.default(inputsObj, []);
    tx.tokens = [token];

    // Set input data
    const dataToSignHash = tx.getDataToSignHash();
    if (!pinCode) {
      throw new Error('PIN not specified in prepareDestroyAuthorityData options');
    }
    const xprivkey = await this.storage.getMainXPrivKey(pinCode);
    for (const [idx, inputObj] of tx.inputs.entries()) {
      const inputData = this.getInputData(xprivkey, dataToSignHash, HathorWalletServiceWallet.getAddressIndexFromFullPath(ret.utxos[idx].addressPath));
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
  async destroyAuthority(token, type, count, options) {
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
  async createNFT(name, symbol, amount, data, options = {}) {
    this.failIfWalletNotReady();
    const newOptions = {
      address: null,
      changeAddress: null,
      createMintAuthority: false,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMeltAuthority: false,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      ...options
    };
    newOptions.nftData = data;
    const tx = await this.prepareCreateNewToken(name, symbol, amount, newOptions);
    return this.handleSendPreparedTransaction(tx);
  }
  async getTxById(txId) {
    this.failIfWalletNotReady();
    const data = await _walletApi.default.getTxById(this, txId);
    return data;
  }
  async getFullTxById(txId) {
    this.failIfWalletNotReady();
    const data = await _walletApi.default.getFullTxById(this, txId);
    return data;
  }
  async getTxConfirmationData(txId) {
    this.failIfWalletNotReady();
    const data = await _walletApi.default.getTxConfirmationData(this, txId);
    return data;
  }
  async graphvizNeighborsQuery(txId, graphType, maxLevel) {
    this.failIfWalletNotReady();
    const data = await _walletApi.default.graphvizNeighborsQuery(this, txId, graphType, maxLevel);
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
  isWsEnabled() {
    return this._isWsEnabled;
  }

  /**
   * Check if the pin used to encrypt the main key is valid.
   * @param {string} pin
   * @returns {Promise<boolean>}
   */
  async checkPin(pin) {
    return this.storage.checkPin(pin);
  }

  /**
   * Check if the password used to encrypt the seed is valid.
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async checkPassword(password) {
    return this.storage.checkPassword(password);
  }

  /**
   * @param {string} pin
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async checkPinAndPassword(pin, password) {
    return (await this.checkPin(pin)) && this.checkPassword(password); // The promise from checkPassword will be returned
  }

  /**
   * Check if the wallet is a hardware wallet.
   * @returns {Promise<boolean>}
   */
  // eslint-disable-next-line class-methods-use-this -- The method returns a hardcoded value
  async isHardwareWallet() {
    // We currently do not have support for hardware wallets
    // in the wallet-service facade.
    return false;
  }
}
var _default = exports.default = HathorWalletServiceWallet;