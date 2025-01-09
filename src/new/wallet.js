/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get } from 'lodash';
import bitcore, { HDPrivateKey } from 'bitcore-lib';
import EventEmitter from 'events';
import { NATIVE_TOKEN_UID, P2SH_ACCT_PATH, P2PKH_ACCT_PATH } from '../constants';
import tokenUtils from '../utils/tokens';
import walletApi from '../api/wallet';
import versionApi from '../api/version';
import { hexToBuffer } from '../utils/buffer';
import { signMessage } from '../utils/crypto';
import helpers from '../utils/helpers';
import { createP2SHRedeemScript } from '../utils/scripts';
import walletUtils from '../utils/wallet';
import SendTransaction from './sendTransaction';
import Network from '../models/network';
import {
  AddressError,
  NanoContractTransactionError,
  PinRequiredError,
  TxNotFoundError,
  WalletError,
  WalletFromXPubGuard,
} from '../errors';
import { ErrorMessages } from '../errorMessages';
import P2SHSignature from '../models/p2sh_signature';
import {
  SCANNING_POLICY,
  TxHistoryProcessingStatus,
  WalletType,
  HistorySyncMode,
  getDefaultLogger,
} from '../types';
import transactionUtils from '../utils/transaction';
import Queue from '../models/queue';
import {
  scanPolicyStartAddresses,
  checkScanningPolicy,
  getHistorySyncMethod,
  getSupportedSyncMode,
} from '../utils/storage';
import txApi from '../api/txApi';
import { MemoryStore, Storage } from '../storage';
import { deriveAddressP2PKH, deriveAddressP2SH, getAddressFromPubkey } from '../utils/address';
import NanoContractTransactionBuilder from '../nano_contracts/builder';
import { prepareNanoSendTransaction } from '../nano_contracts/utils';
import { IHistoryTxSchema } from '../schemas';
import GLL from '../sync/gll';
import { WalletTxTemplateInterpreter, TransactionTemplate } from '../template/transaction';

/**
 * @typedef {import('../models/create_token_transaction').default} CreateTokenTransaction
 * @typedef {import('../models/transaction').default} Transaction
 */

const ERROR_MESSAGE_PIN_REQUIRED = 'Pin is required.';

/**
 * TODO: This should be removed when this file is migrated to typescript
 * we need this here because the typescript enum from the Connection file is
 * not being correctly transpiled here, returning `undefined` for ConnectionState.CLOSED.
 */
const ConnectionState = {
  CLOSED: 0,
  CONNECTING: 1,
  CONNECTED: 2,
};

/**
 * This is a Wallet that is supposed to be simple to be used by a third-party app.
 *
 * This class handles all the details of syncing, including receiving the same transaction
 * multiple times from the server. It also keeps the balance of the tokens updated.
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - SYNCING: When it has connected and is syncing the transaction history.
 * - READY: When it is ready to be used.
 *
 * You can subscribe for the following events:
 * - state: Fired when the state of the Wallet changes.
 * - new-tx: Fired when a new tx arrives.
 * - update-tx: Fired when a known tx is updated. Usually, it happens when one of its outputs is spent.
 * - more-addresses-loaded: Fired when loading the history of transactions. It is fired multiple times,
 *                          one for each request sent to the server.
 */
class HathorWallet extends EventEmitter {
  /**
   * @param {Object} param
   * @param {FullnodeConnection} param.connection A connection to the server
   * @param {import('../types').IStorage} param.storage A storage
   * @param {string} param.seed 24 words separated by space
   * @param {string} [param.passphrase=''] Wallet passphrase
   * @param {string} [param.xpriv]
   * @param {string} [param.xpub]
   * @param {string} [param.tokenUid] UID of the token to handle on this wallet
   * @param {string} [param.password] Password to encrypt the seed
   * @param {string} [param.pinCode] PIN to execute wallet actions
   * @param {boolean} [param.debug] Activates debug mode
   * @param {{pubkeys:string[],numSignatures:number}} [param.multisig]
   * @param {string[]} [param.preCalculatedAddresses] An array of pre-calculated addresses
   * @param {import('../types').AddressScanPolicyData} [param.scanPolicy] config specific to
   * @param {import('../types').ILogger} [param.logger] The logger instance to use
   * the address scan policy.
   */
  constructor({
    connection,
    storage,

    seed,
    passphrase = '',

    xpriv,

    xpub,

    tokenUid = NATIVE_TOKEN_UID,

    password = null,
    pinCode = null,

    // debug mode
    debug = false,
    // Callback to be executed before reload data
    beforeReloadCallback = null,
    multisig = null,
    preCalculatedAddresses = null,
    scanPolicy = null,
    logger = null,
  } = {}) {
    super();

    if (!connection) {
      throw Error('You must provide a connection.');
    }

    if (!seed && !xpriv && !xpub) {
      throw Error('You must explicitly provide the seed, xpriv or the xpub.');
    }

    if (seed && xpriv) {
      throw Error('You cannot provide both a seed and an xpriv.');
    }

    if (xpriv && passphrase !== '') {
      throw Error("You can't use xpriv with passphrase.");
    }

    if (connection.state !== ConnectionState.CLOSED) {
      throw Error("You can't share connections.");
    }

    if (multisig) {
      if (!(multisig.pubkeys && multisig.numSignatures)) {
        throw Error('Multisig configuration requires both pubkeys and numSignatures.');
      } else if (multisig.pubkeys.length < multisig.numSignatures) {
        throw Error('Multisig configuration invalid.');
      }
    }

    this.logger = logger || getDefaultLogger();
    if (storage) {
      /**
       * @type {import('../types').IStorage}
       */
      this.storage = storage;
    } else {
      // Default to a memory store
      const store = new MemoryStore();
      /**
       * @type {import('../types').IStorage}
       */
      this.storage = new Storage(store);
    }
    this.storage.setLogger(this.logger);
    /**
     * @type {import('./connection').default}
     */
    this.conn = connection;
    this.conn.startControlHandlers(this.storage);

    this.state = HathorWallet.CLOSED;

    this.xpriv = xpriv;
    this.seed = seed;
    this.xpub = xpub;

    // tokenUid is optional so we can get the token of the wallet
    this.token = null;
    this.tokenUid = tokenUid;

    this.passphrase = passphrase;
    this.pinCode = pinCode;
    this.password = password;

    this.preCalculatedAddresses = preCalculatedAddresses;

    this.onConnectionChangedState = this.onConnectionChangedState.bind(this);
    this.handleWebsocketMsg = this.handleWebsocketMsg.bind(this);

    // Used to know if the wallet is loading data for the first time
    // or if it's reloading it (e.g. after a ws reconnection).
    // The reload must execute some cleanups, that's why it's important
    // to differentiate both actions
    this.firstConnection = true;

    // Debug mode. It is used to include debugging information
    // when a problem occurs.
    this.debug = debug;

    // The reload is called automatically in the lib when the ws reconnects
    // this callback gives a chance to the apps to run a method before reloading data in the lib
    this.beforeReloadCallback = beforeReloadCallback;

    // Set to true when stop() method is called
    this.walletStopped = false;

    if (multisig) {
      this.multisig = {
        pubkeys: multisig.pubkeys,
        numSignatures: multisig.numSignatures,
      };
    }

    this.wsTxQueue = new Queue();
    this.newTxPromise = Promise.resolve();

    this.scanPolicy = scanPolicy;
    this.isSignedExternally = this.storage.hasTxSignatureMethod();

    this.historySyncMode = HistorySyncMode.POLLING_HTTP_API;

    this.txTemplateInterpreter = new WalletTxTemplateInterpreter(this);
  }

  /**
   * Gets the current server url from connection
   * @return {string} The server url. Ex.: 'http://server.com:8083'
   */
  getServerUrl() {
    return this.conn.getCurrentServer();
  }

  /**
   * Gets the current network from connection
   * @return {string} The network name. Ex.: 'mainnet', 'testnet'
   */
  getNetwork() {
    return this.conn.getCurrentNetwork();
  }

  /**
   * Gets the network model object
   */
  getNetworkObject() {
    return new Network(this.getNetwork());
  }

  /**
   * Gets version data from the fullnode
   *
   * @return {FullNodeVersionData} The data information from the fullnode
   *
   * @memberof HathorWallet
   * @inner
   * */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async getVersionData() {
    const versionData = await new Promise((resolve, reject) => {
      versionApi.getVersion(resolve).catch(error => reject(error));
    });

    return {
      // The new facade returns the timestamp of when this information was cached, since we don't
      // cache this information on the fullnode, it is ok to just return the current timestamp.
      // This is currently not being used on hathor official wallets
      timestamp: Date.now(),
      version: versionData.version,
      network: versionData.network,
      minWeight: versionData.min_weight,
      minTxWeight: versionData.min_tx_weight,
      minTxWeightCoefficient: versionData.min_tx_weight_coefficient,
      minTxWeightK: versionData.min_tx_weight_k,
      tokenDepositPercentage: versionData.token_deposit_percentage,
      rewardSpendMinBlocks: versionData.reward_spend_min_blocks,
      maxNumberInputs: versionData.max_number_inputs,
      maxNumberOutputs: versionData.max_number_outputs,
    };
  }

  /**
   * Set the server url to connect to
   * @param {String} newServer The new server to change to
   *
   * @memberof HathorWallet
   * @inner
   * */
  changeServer(newServer) {
    this.storage.config.setServerUrl(newServer);
  }

  /**
   * Set the value of the gap limit for this wallet instance.
   * @param {number} value The new gap limit value
   * @returns {Promise<void>}
   */
  async setGapLimit(value) {
    return this.storage.setGapLimit(value);
  }

  /**
   * Load more addresses if configured to index-limit scanning policy.
   * @param {number} count Number of addresses to load
   * @returns {Promise<number>} The index of the last address loaded
   */
  async indexLimitLoadMore(count) {
    const scanPolicy = await this.storage.getScanningPolicy();
    if (scanPolicy !== SCANNING_POLICY.INDEX_LIMIT) {
      throw new Error('Wallet is not configured for index-limit scanning policy');
    }

    const limits = await this.storage.getIndexLimit();
    if (!limits) {
      throw new Error('Index limit scanning policy config error');
    }
    const newEndIndex = limits.endIndex + count;
    await this.indexLimitSetEndIndex(newEndIndex);
    return newEndIndex;
  }

  /**
   * Set the value of the index limit end for this wallet instance.
   * @param {number} endIndex The new index limit value
   * @returns {Promise<void>}
   */
  async indexLimitSetEndIndex(endIndex) {
    const scanPolicy = await this.storage.getScanningPolicy();
    if (scanPolicy !== SCANNING_POLICY.INDEX_LIMIT) {
      throw new Error('Wallet is not configured for index-limit scanning policy');
    }

    const limits = await this.storage.getIndexLimit();
    if (!limits) {
      throw new Error('Index limit scanning policy config error');
    }

    if (endIndex <= limits.endIndex) {
      // Cannot unload addresses from storage.
      return;
    }

    const newPolicyData = {
      ...limits,
      endIndex,
      policy: SCANNING_POLICY.INDEX_LIMIT,
    };
    await this.storage.setScanningPolicyData(newPolicyData);
    // Force loading more addresses and process history if any tx is found
    await this.scanAddressesToLoad(true);
  }

  /**
   * Get the value of the gap limit for this wallet instance.
   * @returns {Promise<number>}
   */
  async getGapLimit() {
    return this.storage.getGapLimit();
  }

  /**
   * Get the access data object from storage.
   * @returns {Promise<import('../types').IWalletAccessData>}
   */
  async getAccessData() {
    const accessData = await this.storage.getAccessData();
    if (!accessData) {
      throw new WalletError('Wallet was not initialized.');
    }
    return accessData;
  }

  /**
   * Get the configured wallet type.
   * @returns {Promise<string>} The wallet type
   */
  async getWalletType() {
    const accessData = await this.getAccessData();
    return accessData.walletType;
  }

  /**
   * Get the multisig data object from storage.
   * Only works if the wallet is a multisig wallet.
   *
   * @returns {Promise<import('../types').IMultisigData>}
   */
  async getMultisigData() {
    const accessData = await this.getAccessData();
    if (accessData.walletType !== WalletType.MULTISIG) {
      throw new WalletError('Wallet is not a multisig wallet.');
    }
    if (!accessData.multisigData) {
      throw new WalletError('Multisig data not found in storage');
    }

    return accessData.multisigData;
  }

  /**
   * Enable debug mode.
   * */
  enableDebugMode() {
    this.debug = true;
  }

  /**
   * Disable debug mode.
   */
  disableDebugMode() {
    this.debug = false;
  }

  /**
   * Check that this wallet is readonly.
   * This can be shortcircuted if the wallet is meant to be signed externally.
   * @returns {Promise<boolean>}
   */
  async isReadonly() {
    if (this.isSignedExternally) {
      return false;
    }
    return this.storage.isReadonly();
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   *
   * @param {Number} newState Enum of new state after change
   */
  async onConnectionChangedState(newState) {
    if (newState === ConnectionState.CONNECTED) {
      this.setState(HathorWallet.SYNCING);

      try {
        // If it's the first connection we just load the history
        // otherwise we are reloading data, so we must execute some cleans
        // before loading the full data again
        if (this.firstConnection) {
          this.firstConnection = false;
          const addressesToLoad = await scanPolicyStartAddresses(this.storage);
          await this.syncHistory(addressesToLoad.nextIndex, addressesToLoad.count);
        } else {
          if (this.beforeReloadCallback) {
            this.beforeReloadCallback();
          }
          await this.reloadStorage();
        }
        this.setState(HathorWallet.PROCESSING);
      } catch (error) {
        this.setState(HathorWallet.ERROR);
        this.logger.error('Error loading wallet', { error });
      }
    } else if (this.walletStopped) {
      this.setState(HathorWallet.CLOSED);
    } else {
      // Otherwise we just lost websocket connection
      this.setState(HathorWallet.CONNECTING);
    }
  }

  /**
   * Sign and return all signatures of the inputs belonging to this wallet.
   *
   * @param {string} txHex hex representation of the transaction.
   * @param {string} pin PIN to decrypt the private key
   *
   * @async
   * @return {Promise<string>} serialized P2SHSignature data
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAllSignatures(txHex, pin) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('getAllSignatures');
    }
    const tx = helpers.createTxFromHex(txHex, this.getNetworkObject());
    const accessData = await this.storage.getAccessData();
    if (accessData === null) {
      throw new Error('Wallet is not initialized');
    }

    const signatures = {};

    for (const signatureInfo of await this.getSignatures(tx, { pinCode: pin })) {
      const { inputIndex, signature } = signatureInfo;
      signatures[inputIndex] = signature;
    }

    const p2shSig = new P2SHSignature(accessData.multisigData.pubkey, signatures);
    return p2shSig.serialize();
  }

  /**
   * Assemble transaction from hex and collected p2sh_signatures.
   *
   * @param {string} txHex hex representation of the transaction.
   * @param {Array} signatures Array of serialized p2sh_signatures (string).
   *
   * @return {Promise<Transaction>} with input data created from the signatures.
   *
   * @throws {Error} if there are not enough signatures for an input
   *
   * @memberof HathorWallet
   * @inner
   */
  async assemblePartialTransaction(txHex, signatures) {
    const tx = helpers.createTxFromHex(txHex, this.getNetworkObject());
    const accessData = await this.storage.getAccessData();
    if (accessData === null) {
      throw new Error('Wallet was not started');
    }
    const { multisigData } = accessData;
    if (!multisigData) {
      throw new Error('Cannot call this method from a p2pkh wallet');
    }

    // Deserialize P2SHSignature for all signatures
    // XXX: the .sort here is very important since the fullnode requires the signatures
    // in the same order as the pubkeys in the redeemScript and the order chosen for the
    // pubkeys is the order of the sorted account path pubkey (hex encoded). This sort
    // only works because the serialized signature starts with the account path pubkey.
    const p2shSignatures = signatures.sort().map(sig => P2SHSignature.deserialize(sig));

    for await (const { tx: spentTx, input, index } of this.storage.getSpentTxs(tx.inputs)) {
      const spentUtxo = spentTx.outputs[input.index];
      const storageAddress = await this.storage.getAddressInfo(spentUtxo.decoded.address);
      if (storageAddress === null) {
        // The transaction is on our history but this input is not ours
        continue;
      }

      const redeemScript = createP2SHRedeemScript(
        multisigData.pubkeys,
        multisigData.numSignatures,
        storageAddress.bip32AddressIndex
      );
      const sigs = [];
      for (const p2shSig of p2shSignatures) {
        try {
          sigs.push(hexToBuffer(p2shSig.signatures[index]));
        } catch (e) {
          // skip if there is no signature, or if it's not hex
          continue;
        }
      }
      const inputData = walletUtils.getP2SHInputData(sigs, redeemScript);
      tx.inputs[index].setData(inputData);
    }

    return tx;
  }

  /**
   * Return all addresses of the wallet with info of each of them
   *
   * @async
   * @generator
   * @returns {AsyncGenerator<{address: string, index: number, transactions: number}>} transactions is the count of txs for this address
   * @memberof HathorWallet
   * */
  async *getAllAddresses() {
    // We add the count of transactions
    // in order to replicate the same return as the new
    // wallet service facade
    for await (const address of this.storage.getAllAddresses()) {
      yield {
        address: address.base58,
        index: address.bip32AddressIndex,
        transactions: address.numTransactions,
      };
    }
  }

  /**
   * Get address from specific derivation index
   *
   * @return {Promise<string>} Address
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAddressAtIndex(index) {
    let address = await this.storage.getAddressAtIndex(index);

    if (address === null) {
      if ((await this.storage.getWalletType()) === 'p2pkh') {
        address = await deriveAddressP2PKH(index, this.storage);
      } else {
        address = await deriveAddressP2SH(index, this.storage);
      }
      await this.storage.saveAddress(address);
    }
    return address.base58;
  }

  /**
   * Get address path from specific derivation index
   *
   * @param {number} index Address path index
   *
   * @return {Promise<string>} Address path for the given index
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAddressPathForIndex(index) {
    const walletType = await this.storage.getWalletType();
    if (walletType === WalletType.MULTISIG) {
      // P2SH
      return `${P2SH_ACCT_PATH}/0/${index}`;
    }

    // P2PKH
    return `${P2PKH_ACCT_PATH}/0/${index}`;
  }

  /**
   * Get address to be used in the wallet
   *
   * @param [options]
   * @param {boolean} [options.markAsUsed=false] if true, we will locally mark this address as used
   *                                             and won't return it again to be used
   *
   * @return {Promise<{ address:string, index:number, addressPath:string }>}
   *
   * @memberof HathorWallet
   * @inner
   */
  async getCurrentAddress({ markAsUsed = false } = {}) {
    const address = await this.storage.getCurrentAddress(markAsUsed);
    const index = await this.getAddressIndex(address);
    const addressPath = await this.getAddressPathForIndex(index);

    return { address, index, addressPath };
  }

  /**
   * Get the next address after the current available
   *
   * @return {Promise<{ address:string, index:number, addressPath:string }>}
   */
  async getNextAddress() {
    // First we mark the current address as used, then return the next
    await this.getCurrentAddress({ markAsUsed: true });
    return this.getCurrentAddress();
  }

  /**
   * Called when a new message arrives from websocket.
   */
  handleWebsocketMsg(wsData) {
    if (wsData.type === 'wallet:address_history') {
      if (this.state !== HathorWallet.READY) {
        // Cannot process new transactions from ws when the wallet is not ready.
        // So we will enqueue this message to be processed later
        this.wsTxQueue.enqueue(wsData);
      } else {
        this.newTxPromise = this.newTxPromise.then(() => this.onNewTx(wsData));
      }
    }
  }

  /**
   * Get balance for a token
   *
   * @param {string|null|undefined} token
   *
   * @return {Promise<{
   *   token: {id:string, name:string, symbol:string},
   *   balance: {unlocked:number, locked:number},
   *   transactions:number,
   *   lockExpires:number|null,
   *   tokenAuthorities: {unlocked: {mint:number,melt:number}, locked: {mint:number,melt:number}}
   * }[]>} Array of balance for each token
   *
   * @memberof HathorWallet
   * @inner
   * */
  async getBalance(token = null) {
    // TODO if token is null we should get the balance for each token I have
    // but we don't use it in the wallets, so I won't implement it
    if (token === null) {
      throw new WalletError('Not implemented.');
    }
    const uid = token || this.token.uid;
    let tokenData = await this.storage.getToken(uid);
    if (tokenData === null) {
      // We don't have the token on storage, so we need to return an empty default response
      tokenData = {
        uid,
        numTransactions: 0,
        balance: {
          tokens: { unlocked: 0n, locked: 0n },
          authorities: {
            mint: { unlocked: 0n, locked: 0n },
            melt: { unlocked: 0n, locked: 0n },
          },
        },
      };
    }
    return [
      {
        token: {
          id: tokenData.uid,
          name: tokenData.name,
          symbol: tokenData.symbol,
        },
        balance: tokenData.balance.tokens,
        transactions: tokenData.numTransactions,
        lockExpires: null,
        tokenAuthorities: {
          unlocked: {
            mint: tokenData.balance.authorities.mint.unlocked,
            melt: tokenData.balance.authorities.melt.unlocked,
          },
          locked: {
            mint: tokenData.balance.authorities.mint.locked,
            melt: tokenData.balance.authorities.melt.locked,
          },
        },
      },
    ];
  }

  /**
   * Summarizes the IHistoryTx that comes from wallet token's history.
   *
   * @typedef {Object} SummaryHistoryTx
   * @property {string} txId - Transaction hash
   * @property {number} balance
   * @property {number} timestamp
   * @property {boolean} voided
   * @property {number} version
   * @property {string} [ncId] - Nano Contract transaction hash
   * @property {string} [ncMethod] - Nano Contract method called
   * @property {Address} [ncCaller] - Nano Contract transaction's signing address
   * @property {string} [firstBlock] - Hash of the first block that validates the transaction
   */

  /**
   * Get transaction history
   *
   * @param options
   * @param {string} [options.token_id]
   * @param {number} [options.count]
   * @param {number} [options.skip]
   *
   * @return {Promise<SummaryHistoryTx[]>} Array of transactions
   *
   * @memberof HathorWallet
   * @inner
   * */
  async getTxHistory(options = {}) {
    const newOptions = {
      token_id: NATIVE_TOKEN_UID,
      count: 15,
      skip: 0,
      ...options,
    };
    const { skip } = newOptions;
    let { count } = newOptions;
    const uid = newOptions.token_id || this.token.uid;

    const txs = [];
    let it = 0;
    for await (const tx of this.storage.tokenHistory(uid)) {
      if (it < skip) {
        it++;
        continue;
      }
      if (count <= 0) {
        break;
      }
      const txbalance = await this.getTxBalance(tx);
      const txHistory = {
        txId: tx.tx_id,
        timestamp: tx.timestamp,
        voided: tx.is_voided,
        balance: txbalance[uid] || 0n,
        version: tx.version,
        ncId: tx.nc_id,
        ncMethod: tx.nc_method,
        ncCaller: tx.nc_pubkey && getAddressFromPubkey(tx.nc_pubkey, this.getNetworkObject()),
        firstBlock: tx.first_block,
      };
      txs.push(txHistory);
      count--;
    }
    return txs;
  }

  /**
   * Get tokens that this wallet has transactions
   *
   * @return {Promise<string[]>} Array of strings (token uid)
   *
   * @memberof HathorWallet
   * @inner
   * */
  async getTokens() {
    const tokens = [];
    for await (const token of this.storage.getAllTokens()) {
      tokens.push(token.uid);
    }
    return tokens;
  }

  /**
   * Get a transaction data from the wallet
   *
   * @param {string} id Hash of the transaction to get data from
   *
   * @return {Promise<DecodedTx|null>} Data from the transaction to get.
   *                          Can be null if the wallet does not contain the tx.
   */
  async getTx(id) {
    return this.storage.getTx(id);
  }

  /**
   * @typedef AddressInfoOptions
   * @property {string} token Optionally filter transactions by this token uid (Default: HTR)
   */

  /**
   * @typedef AddressInfo
   * @property {number} total_amount_received Sum of the amounts received
   * @property {number} total_amount_sent Sum of the amounts sent
   * @property {number} total_amount_available Amount available to transfer
   * @property {number} total_amount_locked Amount locked and thus no available to transfer
   * @property {number} token Token used to calculate the amounts received, sent, available and locked
   * @property {number} index Derivation path for the given address
   */

  /**
   * Get information of a given address
   *
   * @param {string} address Address to get information of
   * @param {AddressInfoOptions} options Optional parameters to filter the results
   *
   * @returns {Promise<AddressInfo>} Aggregated information about the given address
   *
   */
  async getAddressInfo(address, options = {}) {
    const { token = NATIVE_TOKEN_UID } = options;

    // Throws an error if the address does not belong to this wallet
    if (!(await this.storage.isAddressMine(address))) {
      throw new AddressError('Address does not belong to this wallet.');
    }

    // Derivation path index
    const addressData = await this.storage.getAddressInfo(address);
    const index = addressData.bip32AddressIndex;

    // Address information that will be calculated below
    const addressInfo = {
      total_amount_received: 0n,
      total_amount_sent: 0n,
      total_amount_available: 0n,
      total_amount_locked: 0n,
      token,
      index,
    };

    // Iterate through transactions
    for await (const tx of this.storage.txHistory()) {
      // Voided transactions should be ignored
      if (tx.is_voided) {
        continue;
      }

      // Iterate through outputs
      for (const output of tx.outputs) {
        const is_address_valid = output.decoded && output.decoded.address === address;
        const is_token_valid = token === output.token;
        const is_authority = transactionUtils.isAuthorityOutput(output);
        if (!is_address_valid || !is_token_valid || is_authority) {
          continue;
        }

        const is_spent = output.spent_by !== null;
        const is_time_locked = transactionUtils.isOutputLocked(output);
        // XXX: we currently do not check heightlock on the helper, checking here for compatibility
        const nowHeight = await this.storage.getCurrentHeight();
        const rewardLock = this.storage.version?.reward_spend_min_blocks;
        const is_height_locked = transactionUtils.isHeightLocked(tx.height, nowHeight, rewardLock);
        const is_locked = is_time_locked || is_height_locked;

        addressInfo.total_amount_received += output.value;

        if (is_spent) {
          addressInfo.total_amount_sent += output.value;
          continue;
        }

        if (is_locked) {
          addressInfo.total_amount_locked += output.value;
        } else {
          addressInfo.total_amount_available += output.value;
        }
      }
    }

    return addressInfo;
  }

  /**
   *
   * @typedef UtxoOptions
   * @property {number} [max_utxos] - Maximum number of utxos to aggregate. Default to MAX_INPUTS (255).
   * @property {string} [token] - Token to filter the utxos. If not sent, we select only HTR utxos.
   * @property {number} [authorities] - Authorities to filter the utxos. If not sent, we select only non authority utxos.
   * @property {string} [filter_address] - Address to filter the utxos.
   * @property {number} [amount_smaller_than] - Maximum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount lower than or equal to this value. Integer representation of decimals, i.e. 100 = 1.00.
   * @property {number} [amount_bigger_than] - Minimum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount bigger than or equal to this value. Integer representation of decimals, i.e. 100 = 1.00.
   * @property {number} [max_amount] - Limit the maximum total amount to consolidate summing all utxos. Integer representation of decimals, i.e. 100 = 1.00.
   * @property {boolean} [only_available_utxos] - Use only available utxos (not locked)
   */

  /**
   * @typedef UtxoInfo
   * @property {string} address - Address that owns the UTXO.
   * @property {number} amount - Amount of tokens.
   * @property {string} tx_id - Original transaction id.
   * @property {boolean} locked - If the output is currently locked.
   * @property {number} index - Index on the output array of the original tx.
   */

  /**
   * @typedef UtxoDetails
   * @property {number} total_amount_available - Maximum number of utxos to aggregate. Default to MAX_INPUTS (255).
   * @property {number} total_utxos_available - Token to filter the utxos. If not sent, we select only HTR utxos.
   * @property {number} total_amount_locked - Address to filter the utxos.
   * @property {number} total_utxos_locked - Maximum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount lower than this value. Integer representation of decimals, i.e. 100 = 1.00.
   * @property {UtxoInfo[]} utxos - Array of utxos
   */

  /**
   * Get utxos of the wallet addresses
   *
   * @param {UtxoOptions} options Utxo filtering options
   *
   * @return {Promise<UtxoDetails>} Utxos and meta information about it
   *
   */
  async getUtxos(options = {}) {
    const newOptions = {
      token: options.token,
      authorities: 0,
      max_utxos: options.max_utxos,
      filter_address: options.filter_address,
      amount_smaller_than: options.amount_smaller_than,
      amount_bigger_than: options.amount_bigger_than,
      max_amount: options.max_amount,
      only_available_utxos: options.only_available_utxos,
    };
    /** @type {UtxoDetails} */
    const utxoDetails = {
      total_amount_available: 0n,
      total_utxos_available: 0n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [],
    };
    const nowTs = Math.floor(Date.now() / 1000);
    const isTimeLocked = timestamp => timestamp && nowTs && nowTs < timestamp;
    const nowHeight = await this.storage.getCurrentHeight();
    const rewardLock = this.storage.version?.reward_spend_min_blocks;

    for await (const utxo of this.storage.selectUtxos(newOptions)) {
      const isLocked =
        isTimeLocked(utxo.timelock) ||
        transactionUtils.isHeightLocked(utxo.height, nowHeight, rewardLock);

      const utxoInfo = {
        address: utxo.address,
        amount: utxo.value,
        tx_id: utxo.txId,
        locked: !!isLocked,
        index: utxo.index,
      };

      utxoDetails.utxos.push(utxoInfo);
      if (isLocked) {
        utxoDetails.total_amount_locked += utxo.value;
        utxoDetails.total_utxos_locked += 1n;
      } else {
        utxoDetails.total_amount_available += utxo.value;
        utxoDetails.total_utxos_available += 1n;
      }
    }
    return utxoDetails;
  }

  /**
   * @typedef Utxo
   * @property {string} txId
   * @property {number} index
   * @property {string} tokenId
   * @property {string} address
   * @property {string} value
   * @property {OutputValueType} authorities
   * @property {number|null} timelock
   * @property {number|null} heightlock
   * @property {boolean} locked
   * @property {string} addressPath
   */

  /**
   * Generates all available utxos
   *
   * @param [options] Utxo filtering options
   * @param {string} [options.token='00'] - Search for UTXOs of this token UID.
   * @param {string|null} [options.filter_address=null] - Address to filter the utxos.
   *
   * @async
   * @generator
   * @yields {Utxo} all available utxos
   */
  async *getAvailableUtxos(options = {}) {
    // This method only returns available utxos
    for await (const utxo of this.storage.selectUtxos({ ...options, only_available_utxos: true })) {
      const addressIndex = await this.getAddressIndex(utxo.address);
      const addressPath = await this.getAddressPathForIndex(addressIndex);
      yield {
        txId: utxo.txId,
        index: utxo.index,
        tokenId: utxo.token,
        address: utxo.address,
        value: utxo.value,
        authorities: utxo.authorities,
        timelock: utxo.timelock,
        heightlock: null,
        locked: false,
        addressPath,
      };
    }
  }

  /**
   * Get utxos of the wallet addresses to fill the amount specified.
   *
   * @param {Object} [options] Utxo filtering options
   * @param {string} [options.token='00'] - Search for UTXOs of this token UID.
   * @param {string|null} [options.filter_address=null] - Address to filter the utxos.
   *
   * @return {Promise<{utxos: Utxo[], changeAmount: OutputValueType}>} Utxos and change information.
   */
  async getUtxosForAmount(amount, options = {}) {
    const newOptions = {
      token: NATIVE_TOKEN_UID,
      filter_address: null,
      ...options,
      order_by_value: 'desc',
    };

    const utxos = [];
    for await (const utxo of this.getAvailableUtxos(newOptions)) {
      utxos.push(utxo);
    }

    return transactionUtils.selectUtxos(
      utxos.filter(utxo => utxo.authorities === 0n),
      amount
    );
  }

  /**
   * Mark UTXO selected_as_input.
   *
   * @param {string} txId Transaction id of the UTXO
   * @param {number} index Output index of the UTXO
   * @param {boolean} [value=true] The value to set the utxos.
   * @param {number?} [ttl=null]
   */
  async markUtxoSelected(txId, index, value = true, ttl = null) {
    await this.storage.utxoSelectAsInput({ txId, index }, value, ttl);
  }

  /**
   * Prepare all required data to consolidate utxos.
   *
   * @typedef {Object} PrepareConsolidateUtxosDataResult
   * @property {{ address: string, value: OutputValueType }[]} outputs - Destiny of the consolidated utxos
   * @property {{ hash: string, index: number }[]} inputs - Inputs for the consolidation transaction
   * @property {{ uid: string, name: string, symbol: string }} token - HTR or custom token
   * @property {UtxoInfo[]} utxos - Array of utxos that will be consolidated
   * @property {number} total_amount - Amount to be consolidated
   *
   * @param {string} destinationAddress Address of the consolidated utxos
   * @param {UtxoOptions} options Utxo filtering options
   *
   * @return {Promise<PrepareConsolidateUtxosDataResult>} Required data to consolidate utxos
   *
   */
  async prepareConsolidateUtxosData(destinationAddress, options = {}) {
    const utxoDetails = await this.getUtxos({ ...options, only_available_utxos: true });
    const inputs = [];
    const utxos = [];
    let total_amount = 0n;
    for (let i = 0; i < utxoDetails.utxos.length; i++) {
      if (inputs.length === this.storage.version.max_number_inputs) {
        // Max number of inputs reached
        break;
      }
      const utxo = utxoDetails.utxos[i];
      inputs.push({
        txId: utxo.tx_id,
        index: utxo.index,
      });
      utxos.push(utxo);
      total_amount += utxo.amount;
    }
    const outputs = [
      {
        address: destinationAddress,
        value: total_amount,
        token: options.token || NATIVE_TOKEN_UID,
      },
    ];

    return { outputs, inputs, utxos, total_amount };
  }

  /**
   * @typedef ConsolidationResultSendTx
   * @property {number} total_utxos_consolidated - Number of utxos consolidated
   * @property {number} total_amount - Consolidated amount
   * @property {SendTransaction} sendTx - instance that will send the transaction.
   * @property {UtxoInfo[]} utxos - Array of consolidated utxos
   */

  /**
   * Consolidates many utxos into a single one for either HTR or exactly one custom token.
   *
   * @param {string} destinationAddress Address of the consolidated utxos
   * @param {UtxoOptions} options Utxo filtering options
   *
   * @return {Promise<ConsolidationResultSendTx>}
   *
   */
  async consolidateUtxosSendTransaction(destinationAddress, options = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('consolidateUtxos');
    }
    const { outputs, inputs, utxos, total_amount } = await this.prepareConsolidateUtxosData(
      destinationAddress,
      options
    );

    if (!(await this.isAddressMine(destinationAddress))) {
      throw new Error("Utxo consolidation to an address not owned by this wallet isn't allowed.");
    }

    if (inputs.length === 0) {
      throw new Error('No available utxo to consolidate.');
    }

    const sendTx = await this.sendManyOutputsSendTransaction(outputs, { inputs });

    return {
      total_utxos_consolidated: utxos.length,
      total_amount,
      utxos,
      sendTx,
    };
  }

  /**
   * @typedef ConsolidationResult
   * @property {number} total_utxos_consolidated - Number of utxos consolidated
   * @property {number} total_amount - Consolidated amount
   * @property {string} txId - Consolidated transaction id
   * @property {UtxoInfo[]} utxos - Array of consolidated utxos
   */

  /**
   * Consolidates many utxos into a single one for either HTR or exactly one custom token.
   *
   * @param {string} destinationAddress Address of the consolidated utxos
   * @param {UtxoOptions} options Utxo filtering options
   *
   * @return {Promise<ConsolidationResult>} Indicates that the transaction is sent or not
   *
   */
  async consolidateUtxos(destinationAddress, options = {}) {
    const { total_utxos_consolidated, total_amount, sendTx, utxos } =
      await this.consolidateUtxosSendTransaction(destinationAddress, options);

    const tx = await sendTx.run();

    return {
      total_utxos_consolidated,
      total_amount,
      txId: tx.hash,
      utxos,
    };
  }

  /**
   * @typedef DecodedTx
   * @property {string} tx_id
   * @property {number} version
   * @property {number} weight
   * @property {number} timestamp
   * @property {boolean} is_voided
   * @property {{
   *   value: OutputValueType,
   *   token_data: number,
   *   script: string,
   *   decoded: { type: string, address: string, timelock: number|null },
   *   token: string,
   *   tx_id: string,
   *   index: number
   * }[]} inputs
   * @property {{
   *   value: OutputValueType,
   *   token_data: number,
   *   script: string,
   *   decoded: { type: string, address: string, timelock: number|null },
   *   token: string,
   *   spent_by: string|null,
   *   selected_as_input?: boolean
   * }[]} outputs
   * @property {string[]} parents
   */

  /**
   * Get full wallet history (same as old method to be used for compatibility)
   *
   * @return {Promise<Record<string,DecodedTx>>} Object with transaction data { tx_id: { full_transaction_data }}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async getFullHistory() {
    const history = {};
    for await (const tx of this.storage.txHistory()) {
      history[tx.tx_id] = tx;
    }
    return history;
  }

  /**
   * Process the transactions on the websocket transaction queue as if they just arrived.
   *
   * @memberof HathorWallet
   * @inner
   */
  async processTxQueue() {
    let wsData = this.wsTxQueue.dequeue();

    while (wsData !== undefined) {
      // save new txdata
      await this.onNewTx(wsData);
      wsData = this.wsTxQueue.dequeue();
      // We should release the event loop for other threads
      // This effectively awaits 0 seconds
      // but it schedule the next iteration to run after other threads.
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    }

    await this.storage.processHistory();
  }

  /**
   * Check if we need to load more addresses and load them if needed.
   * The configured scanning policy will be used to determine the loaded addresses.
   * @param {boolean} processHistory If we should process the txs found on the loaded addresses.
   *
   * @returns {Promise<void>}
   */
  async scanAddressesToLoad(processHistory = false) {
    // check address scanning policy and load more addresses if needed
    const loadMoreAddresses = await checkScanningPolicy(this.storage);
    if (loadMoreAddresses !== null) {
      await this.syncHistory(loadMoreAddresses.nextIndex, loadMoreAddresses.count, processHistory);
    }
  }

  /**
   * Call the method to process data and resume with the correct state after processing.
   *
   * @returns {Promise} A promise that resolves when the wallet is done processing the tx queue.
   */
  async onEnterStateProcessing() {
    // Started processing state now, so we prepare the local data to support using this facade interchangable with wallet service facade in both wallets
    try {
      await this.processTxQueue();
      this.setState(HathorWallet.READY);
    } catch (e) {
      this.setState(HathorWallet.ERROR);
    }
  }

  setState(state) {
    if (state === HathorWallet.PROCESSING && state !== this.state) {
      // XXX: will not await this so we can process history on background.
      this.onEnterStateProcessing().catch(e => {
        this.logger.error(e);
        this.setState(HathorWallet.ERROR);
      });
    }
    this.state = state;
    this.emit('state', state);
  }

  async onNewTx(wsData) {
    const parseResult = IHistoryTxSchema.safeParse(wsData.history);
    if (!parseResult.success) {
      this.logger.error(parseResult.error);
      return;
    }
    const newTx = parseResult.data;
    const storageTx = await this.storage.getTx(newTx.tx_id);
    const isNewTx = storageTx === null;

    newTx.processingStatus = TxHistoryProcessingStatus.PROCESSING;

    // Save the transaction in the storage
    await this.storage.addTx(newTx);

    await this.scanAddressesToLoad();
    // Process history to update metadatas
    await this.storage.processHistory();

    newTx.processingStatus = TxHistoryProcessingStatus.FINISHED;
    // Save the transaction in the storage
    await this.storage.addTx(newTx);

    if (isNewTx) {
      this.emit('new-tx', newTx);
    } else {
      this.emit('update-tx', newTx);
    }
  }

  /**
   * Send a transaction with a single output
   *
   * @param {string} address Output address
   * @param {Number} value Output value
   * @param [options] Options parameters
   * @param {string} [options.changeAddress] address of the change output
   * @param {string} [options.token] token uid
   * @param {string} [options.pinCode] pin to decrypt the private key
   *
   * @return {Promise<SendTransaction>} Promise that resolves when transaction is sent
   */
  async sendTransactionInstance(address, value, options = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('sendTransaction');
    }
    const newOptions = {
      token: '00',
      changeAddress: null,
      ...options,
    };
    const { token, changeAddress, pinCode } = newOptions;
    const outputs = [{ address, value, token }];
    return this.sendManyOutputsSendTransaction(outputs, { inputs: [], changeAddress, pinCode });
  }

  /**
   * Send a transaction with a single output
   *
   * @param {string} address Output address
   * @param {Number} value Output value
   * @param [options] Options parameters
   * @param {string} [options.changeAddress] address of the change output
   * @param {string} [options.token] token uid
   * @param {string} [options.pinCode] pin to decrypt the private key
   *
   * @return {Promise<Transaction>} Promise that resolves when transaction is sent
   */
  async sendTransaction(address, value, options = {}) {
    const sendTx = await this.sendTransactionInstance(address, value, options);
    return sendTx.run();
  }

  /**
   * @typedef {Object} ProposedOutput
   * @property {string} address
   * @property {import('../types').OutputValueType} value
   * @property {number?} timelock
   * @property {string} token
   */

  /**
   * @typedef {Object} ProposedInput
   * @property {string} txId
   * @property {number} index
   * @property {string} token
   */

  /**
   * @typedef {Object} SendManyOutputsOptions
   * @property {ProposedInput[]?} inputs Array of proposed inputs
   * @property  {string?} [changeAddress] address of the change output
   * @property  {boolean?} [startMiningTx=true] to trigger start mining
   * @property  {string?} [pinCode] pin to decrypt xpriv information.
   */

  /**
   * Create a SendTransaction instance to send a transaction with possibly multiple outputs.
   *
   * @param {ProposedOutput[]} outputs Array of proposed outputs
   * @param {SendManyOutputsOptions?} [options={}]
   *
   * @return {Promise<SendTransaction>}
   */
  async sendManyOutputsSendTransaction(outputs, options = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('sendManyOutputsTransaction');
    }
    const newOptions = {
      inputs: [],
      changeAddress: null,
      startMiningTx: true,
      pinCode: null,
      ...options,
    };

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }
    const { inputs, changeAddress } = newOptions;
    return new SendTransaction({
      storage: this.storage,
      outputs,
      inputs,
      changeAddress,
      pin,
    });
  }

  /**
   * Send a transaction from its outputs
   *
   * @param {ProposedOutput[]} outputs Array of proposed outputs
   * @param {SendManyOutputsOptions?} [options={}]
   *
   * @return {Promise<Transaction>} Promise that resolves when transaction is sent
   */
  async sendManyOutputsTransaction(outputs, options = {}) {
    const sendTransaction = await this.sendManyOutputsSendTransaction(outputs, options);
    return sendTransaction.run();
  }

  /**
   * Connect to the server and start emitting events.
   *
   * @param {Object} optionsParams Options parameters
   *  {
   *   'pinCode': pin to decrypt xpriv information. Required if not set in object.
   *   'password': password to decrypt xpriv information. Required if not set in object.
   *  }
   */
  async start(optionsParams = {}) {
    const options = { pinCode: null, password: null, ...optionsParams };
    const pinCode = options.pinCode || this.pinCode;
    const password = options.password || this.password;
    if (!this.xpub && !pinCode) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }

    if (this.seed && !password) {
      throw new Error('Password is required.');
    }

    // Check database consistency
    await this.storage.store.validate();
    await this.storage.setScanningPolicyData(this.scanPolicy || null);

    this.storage.config.setNetwork(this.conn.network);
    this.storage.config.setServerUrl(this.conn.getCurrentServer());
    this.conn.on('state', this.onConnectionChangedState);
    this.conn.on('wallet-update', this.handleWebsocketMsg);

    if (this.preCalculatedAddresses) {
      for (const [index, addr] of this.preCalculatedAddresses.entries()) {
        await this.storage.saveAddress({
          base58: addr,
          bip32AddressIndex: index,
        });
      }
    }

    let accessData = await this.storage.getAccessData();
    if (!accessData) {
      if (this.seed) {
        accessData = walletUtils.generateAccessDataFromSeed(this.seed, {
          multisig: this.multisig,
          passphrase: this.passphrase,
          pin: pinCode,
          password,
          networkName: this.conn.network,
        });
      } else if (this.xpriv) {
        accessData = walletUtils.generateAccessDataFromXpriv(this.xpriv, {
          multisig: this.multisig,
          pin: pinCode,
        });
      } else if (this.xpub) {
        accessData = walletUtils.generateAccessDataFromXpub(this.xpub, {
          multisig: this.multisig,
        });
      } else {
        throw new Error('This should never happen');
      }
      await this.storage.saveAccessData(accessData);
    }

    this.clearSensitiveData();
    this.getTokenData();
    this.walletStopped = false;
    this.setState(HathorWallet.CONNECTING);

    const info = await new Promise((resolve, reject) => {
      versionApi.getVersion(resolve).catch(error => reject(error));
    });
    if (info.network.indexOf(this.conn.network) >= 0) {
      this.storage.setApiVersion(info);
      await this.storage.saveNativeToken();
      this.conn.start();
    } else {
      this.setState(HathorWallet.CLOSED);
      throw new Error(`Wrong network. server=${info.network} expected=${this.conn.network}`);
    }
    return info;
  }

  /**
   * Close the connections and stop emitting events.
   */
  async stop({ cleanStorage = true, cleanAddresses = false, cleanTokens = false } = {}) {
    this.setState(HathorWallet.CLOSED);
    this.removeAllListeners();

    await this.storage.handleStop({
      connection: this.conn,
      cleanStorage,
      cleanAddresses,
      cleanTokens,
    });

    this.firstConnection = true;
    this.walletStopped = true;
    this.conn.stop();
  }

  /**
   * Returns an address' HDPrivateKey given an index and the encryption password
   *
   * @param {string} pinCode - The PIN used to encrypt data in accessData
   * @param {number} addressIndex - The address' index to fetch
   *
   * @returns {Promise<HDPrivateKey>} Promise that resolves with the HDPrivateKey
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAddressPrivKey(pinCode, addressIndex) {
    const mainXPrivKey = await this.storage.getMainXPrivKey(pinCode);
    const addressHDPrivKey = new bitcore.HDPrivateKey(mainXPrivKey).derive(addressIndex);

    return addressHDPrivKey;
  }

  /**
   * Returns a base64 encoded signed message with an address' private key given an
   * andress index
   *
   * @param {string} message - The message to sign
   * @param {number} index - The address index to sign with
   * @param {string} pinCode - The PIN used to encrypt data in accessData
   *
   * @return {Promise} Promise that resolves with the signed message
   *
   * @memberof HathorWallet
   * @inner
   */
  async signMessageWithAddress(message, index, pinCode) {
    const addressHDPrivKey = await this.getAddressPrivKey(pinCode, index);
    const signedMessage = signMessage(message, addressHDPrivKey.privateKey);

    return signedMessage;
  }

  /**
   * Create SendTransaction object and run from mining
   * Returns a promise that resolves when the send succeeds
   *
   * @param {Transaction} transaction Transaction object to be mined and pushed to the network
   *
   * @return {Promise<Transaction|CreateTokenTransaction>} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   * @deprecated
   */
  async handleSendPreparedTransaction(transaction) {
    const sendTransaction = new SendTransaction({ storage: this.storage, transaction });
    return sendTransaction.runFromMining();
  }

  /**
   * @typedef {Object} CreateTokenOptions
   *
   * @property {string?} [address] address of the minted token
   * @property {string?} [changeAddress] address of the change output
   * @property {boolean?} [startMiningTx=true] trigger start mining
   * @property {string?} [pinCode] pin to decrypt xpriv information.
   * @property {boolean?} [createMint=true] should create mint authority
   * @property {string?} [mintAuthorityAddress] the address to send the mint authority created
   * @property {boolean?} [allowExternalMintAuthorityAddress=false] allow the mint authority address to be from another wallet
   * @property {boolean?} [createMelt=true] should create melt authority
   * @property {string?} [meltAuthorityAddress] the address to send the melt authority created
   * @property {boolean?} [allowExternalMeltAuthorityAddress=false] allow the melt authority address
   *                                                                    to be from another wallet
   * @property {string[]?} [data=null] list of data strings using utf8 encoding to add each as a data script output
   * @property {boolean?} [signTx=true] sign transaction instance
   * @property {boolean?} [isCreateNFT=false] if the create token is an NFT creation call
   */

  /**
   * Prepare create token transaction data before mining
   *
   * @param {string} name Name of the token
   * @param {string} symbol Symbol of the token
   * @param {OutputValueType} amount Quantity of the token to be minted
   * @param {CreateTokenOptions} [options] Options parameters
   *
   * @return {Promise<CreateTokenTransaction>} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   */
  async prepareCreateNewToken(name, symbol, amount, options = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('createNewToken');
    }
    const newOptions = {
      address: null,
      changeAddress: null,
      startMiningTx: true,
      pinCode: null,
      createMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      data: null,
      isCreateNFT: false,
      signTx: true,
      ...options,
    };

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }

    if (newOptions.mintAuthorityAddress && !newOptions.allowExternalMintAuthorityAddress) {
      // Validate that the mint authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newOptions.mintAuthorityAddress);
      if (!isAddressMine) {
        throw new Error('The mint authority address must belong to your wallet.');
      }
    }

    if (newOptions.meltAuthorityAddress && !newOptions.allowExternalMeltAuthorityAddress) {
      // Validate that the melt authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newOptions.meltAuthorityAddress);
      if (!isAddressMine) {
        throw new Error('The melt authority address must belong to your wallet.');
      }
    }

    const mintAddress = newOptions.address || (await this.getCurrentAddress()).address;

    const txData = await tokenUtils.prepareCreateTokenData(
      mintAddress,
      name,
      symbol,
      amount,
      this.storage,
      {
        changeAddress: newOptions.changeAddress,
        createMint: newOptions.createMint,
        mintAuthorityAddress: newOptions.mintAuthorityAddress,
        createMelt: newOptions.createMelt,
        meltAuthorityAddress: newOptions.meltAuthorityAddress,
        data: newOptions.data,
        isCreateNFT: newOptions.isCreateNFT,
      }
    );
    return transactionUtils.prepareTransaction(txData, pin, this.storage, {
      signTx: newOptions.signTx,
    });
  }

  /**
   * Builds a SendTransaction instance that will create a new token for this wallet
   *
   * @param {string} name Name of the token
   * @param {string} symbol Symbol of the token
   * @param {OutputValueType} amount Quantity of the token to be minted
   * @param {CreateTokenOptions} [options] Options parameters
   *
   * @return {Promise<SendTransaction>}
   * @memberof HathorWallet
   * @inner
   * */
  async createNewTokenSendTransaction(name, symbol, amount, options = {}) {
    const transaction = await this.prepareCreateNewToken(name, symbol, amount, options);
    return new SendTransaction({ storage: this.storage, transaction });
  }

  /**
   * Create a new token for this wallet
   *
   * @param {string} name Name of the token
   * @param {string} symbol Symbol of the token
   * @param {OutputValueType} amount Quantity of the token to be minted
   * @param {CreateTokenOptions} [options] Options parameters
   *
   * @return {Promise<CreateTokenTransaction>}
   * @memberof HathorWallet
   * @inner
   * */
  async createNewToken(name, symbol, amount, options = {}) {
    const sendTx = await this.createNewTokenSendTransaction(name, symbol, amount, options);
    return sendTx.runFromMining();
  }

  /**
   * Get mint authorities
   *
   * @param {string} tokenUid UID of the token to select the authority utxo
   * @param {Object} [options] Object with custom options.
   * @param {boolean} [options.many=false] if should return many utxos or just one (default false)
   * @param {boolean} [options.only_available_utxos=false] If we should filter for available utxos.
   *
   * @return {Promise<{
   *   txId: string,
   *   index: number,
   *   address: string,
   *   authorities: OutputValueType
   * }[]>} Promise that resolves with an Array of objects with properties of the authority output.
   *       The "authorities" field actually contains the output value with the authority masks.
   *       Returns an empty array in case there are no tx_outupts for this type.
   * */
  async getMintAuthority(tokenUid, options = {}) {
    const newOptions = {
      token: tokenUid,
      authorities: 1n, // mint authority
      only_available_utxos: options.only_available_utxos ?? false,
    };
    if (!options.many) {
      // limit number of utxos to select if many is false
      newOptions.max_utxos = 1;
    }
    const utxos = [];
    for await (const utxo of this.storage.selectUtxos(newOptions)) {
      utxos.push(utxo);
    }
    return utxos;
  }

  /**
   * Get melt authorities
   *
   * @param {string} tokenUid UID of the token to select the authority utxo
   * @param {Object} [options] Object with custom options.
   * @param {boolean} [options.many=false] if should return many utxos or just one (default false)
   * @param {boolean} [options.only_available_utxos=false] If we should filter for available utxos.
   *
   * @return {Promise<{
   *   txId: string,
   *   index: number,
   *   address: string,
   *   authorities: OutputValueType
   * }[]>} Promise that resolves with an Array of objects with properties of the authority output.
   *       The "authorities" field actually contains the output value with the authority masks.
   *       Returns an empty array in case there are no tx_outupts for this type.
   * */
  async getMeltAuthority(tokenUid, options = {}) {
    const newOptions = {
      token: tokenUid,
      authorities: 2n, // melt authority
      only_available_utxos: options.only_available_utxos ?? false,
    };
    if (!options.many) {
      // limit number of utxos to select if many is false
      newOptions.max_utxos = 1;
    }
    const utxos = [];
    for await (const utxo of this.storage.selectUtxos(newOptions)) {
      utxos.push(utxo);
    }
    return utxos;
  }

  /**
   * @typedef {Object} MintTokensOptions
   * @property {string?} [address] destination address of the minted token
   *                                   (if not sent we choose the next available address to use)
   * @property {string?} [changeAddress] address of the change output
   *                                   (if not sent we choose the next available address to use)
   * @property {boolean?} [startMiningTx=true] boolean to trigger start mining (default true)
   * @property {boolean?} [createAnotherMint] boolean to create another mint authority or not for the wallet
   * @property {string?} [mintAuthorityAddress] address to send the new mint authority created
   * @property {boolean?} [allowExternalMintAuthorityAddress=false] allow the mint authority address to be from another wallet
   * @property {boolean?} [unshiftData] whether to unshift the data script output
   * @property {string[]|null?} [data=null] list of data strings using utf8 encoding to add each as a data script output
   * @property {boolean?} [signTx=true] sign transaction instance
   * @property {string?} [pinCode] pin to decrypt xpriv information.
   */

  /**
   * Prepare mint transaction before mining
   *
   * @param {string} tokenUid UID of the token to mint
   * @param {OutputValueType} amount Quantity to mint
   * @param {MintTokensOptions} [options] Options parameters
   *
   * @return {Promise<Transaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async prepareMintTokensData(tokenUid, amount, options = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('mintTokens');
    }
    const newOptions = {
      address: null,
      changeAddress: null,
      createAnotherMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      unshiftData: false,
      data: null,
      pinCode: null,
      signTx: true,
      ...options,
    };

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }

    if (newOptions.mintAuthorityAddress && !newOptions.allowExternalMintAuthorityAddress) {
      // Validate that the mint authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newOptions.mintAuthorityAddress);
      if (!isAddressMine) {
        throw new Error('The mint authority address must belong to your wallet.');
      }
    }

    const mintAddress = newOptions.address || (await this.getCurrentAddress()).address;

    const mintInput = await this.getMintAuthority(tokenUid, {
      many: false,
      only_available_utxos: true,
    });

    if (!mintInput || mintInput.length === 0) {
      throw new Error("Don't have mint authority output available.");
    }

    const mintOptions = {
      token: tokenUid,
      mintInput: mintInput[0],
      createAnotherMint: newOptions.createAnotherMint,
      changeAddress: newOptions.changeAddress,
      mintAuthorityAddress: newOptions.mintAuthorityAddress,
      unshiftData: newOptions.unshiftData,
      data: newOptions.data,
    };
    const txData = await tokenUtils.prepareMintTxData(
      mintAddress,
      amount,
      this.storage,
      mintOptions
    );
    return transactionUtils.prepareTransaction(txData, pin, this.storage, {
      signTx: newOptions.signTx,
    });
  }

  /**
   * Mint tokens - SendTransaction
   * Create a SendTransaction instance with a prepared mint tokens transaction.
   *
   * @param {string} tokenUid UID of the token to mint
   * @param {OutputValueType} amount Quantity to mint
   * @param {MintTokensOptions?} [options={}] Options parameters
   *
   * @return {Promise<SendTransaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async mintTokensSendTransaction(tokenUid, amount, options = {}) {
    const transaction = await this.prepareMintTokensData(tokenUid, amount, options);
    return new SendTransaction({ storage: this.storage, transaction });
  }

  /**
   * Mint tokens
   *
   * @param {string} tokenUid UID of the token to mint
   * @param {OutputValueType} amount Quantity to mint
   * @param {MintTokensOptions?} [options={}] Options parameters
   *
   * @return {Promise<Transaction>} Promise that resolves with transaction object
   *
   * @memberof HathorWallet
   * @inner
   * */
  async mintTokens(tokenUid, amount, options = {}) {
    const sendTx = await this.mintTokensSendTransaction(tokenUid, amount, options);
    return sendTx.runFromMining();
  }

  /**
   * @typedef {Object} MeltTokensOptions
   * @property {string?} [address] address of the HTR deposit back.
   * @property {string?} [changeAddress] address of the change output.
   * @property {boolean?} [createAnotherMelt=true] create another melt authority or not.
   * @property {string?} [meltAuthorityAddress=null] where to send the new melt authority created.
   * @property {boolean?} [allowExternalMeltAuthorityAddress=false] allow the melt authority address to be from another wallet.
   * @property {boolean?} [unshiftData=false] Add the data outputs in the start of the output list.
   * @property {string[]?} [data=null] list of data script output to add, UTF-8 encoded.
   * @property {string?} [pinCode=null] pin to decrypt xpriv information. Optional but required if not set in this.
   * @property {boolean?} [signTx=true] Sign transaction instance.
   * @property {boolean?} [startMiningTx=true] boolean to trigger start mining
   */

  /**
   * Prepare melt transaction before mining
   *
   * @param {string} tokenUid UID of the token to melt
   * @param {OutputValueType} amount Quantity to melt
   * @param {MeltTokensOptions} [options={}] Options parameters
   *
   * @return {Promise<Transaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async prepareMeltTokensData(tokenUid, amount, options = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('meltTokens');
    }
    const newOptions = {
      address: null,
      changeAddress: null,
      createAnotherMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      unshiftData: false,
      data: null,
      pinCode: null,
      signTx: true,
      ...options,
    };

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }

    if (newOptions.meltAuthorityAddress && !newOptions.allowExternalMeltAuthorityAddress) {
      // Validate that the melt authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newOptions.meltAuthorityAddress);
      if (!isAddressMine) {
        throw new Error('The melt authority address must belong to your wallet.');
      }
    }

    const meltInput = await this.getMeltAuthority(tokenUid, {
      many: false,
      only_available_utxos: true,
    });

    if (!meltInput || meltInput.length === 0) {
      throw new Error("Don't have melt authority output available.");
    }

    const meltOptions = {
      createAnotherMelt: newOptions.createAnotherMelt,
      meltAuthorityAddress: newOptions.meltAuthorityAddress,
      changeAddress: newOptions.changeAddress,
      unshiftData: newOptions.unshiftData,
      data: newOptions.data,
    };
    const txData = await tokenUtils.prepareMeltTxData(
      tokenUid,
      meltInput[0],
      newOptions.address || (await this.getCurrentAddress()).address,
      amount,
      this.storage,
      meltOptions
    );
    return transactionUtils.prepareTransaction(txData, pin, this.storage, {
      signTx: newOptions.signTx,
    });
  }

  /**
   * Melt tokens - SendTransaction
   * Create a SendTransaction instance with a prepared melt tokens transaction.
   *
   * @param {string} tokenUid UID of the token to melt
   * @param {OutputValueType} amount Quantity to melt
   * @param {MeltTokensOptions} [options] Options parameters
   *
   * @return {Promise<SendTransaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async meltTokensSendTransaction(tokenUid, amount, options = {}) {
    const transaction = await this.prepareMeltTokensData(tokenUid, amount, options);
    return new SendTransaction({ storage: this.storage, transaction });
  }

  /**
   * Melt tokens
   *
   * @param {string} tokenUid UID of the token to melt
   * @param {OutputValueType} amount Quantity to melt
   * @param {MeltTokensOptions} [options] Options parameters
   *
   * @return {Promise<Transaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async meltTokens(tokenUid, amount, options = {}) {
    const sendTx = await this.meltTokensSendTransaction(tokenUid, amount, options);
    return sendTx.runFromMining();
  }

  /**
   * @typedef {Object} DelegateAuthorityOptions
   * @property {boolean?} [options.createAnother=true] Should create another authority for the wallet.
   * @property {boolean?} [options.startMiningTx=true] boolean to trigger start mining.
   * @property {string?} [options.pinCode] pin to decrypt xpriv information.
   */

  /**
   * Prepare delegate authority transaction before mining
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {string} type Type of the authority to delegate 'mint' or 'melt'
   * @param {string} destinationAddress Destination address of the delegated authority
   * @param {DelegateAuthorityOptions} [options] Options parameters
   *
   * @return {Promise<Transaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async prepareDelegateAuthorityData(tokenUid, type, destinationAddress, options = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('delegateAuthority');
    }
    const newOptions = { createAnother: true, pinCode: null, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }
    const { createAnother } = newOptions;
    let delegateInput;
    if (type === 'mint') {
      delegateInput = await this.getMintAuthority(tokenUid, {
        many: false,
        only_available_utxos: true,
      });
    } else if (type === 'melt') {
      delegateInput = await this.getMeltAuthority(tokenUid, {
        many: false,
        only_available_utxos: true,
      });
    } else {
      throw new Error('This should never happen.');
    }

    if (delegateInput.length === 0) {
      throw new Error({ success: false, message: ErrorMessages.NO_UTXOS_AVAILABLE });
    }

    const txData = await tokenUtils.prepareDelegateAuthorityTxData(
      tokenUid,
      delegateInput[0],
      destinationAddress,
      this.storage,
      createAnother
    );

    return transactionUtils.prepareTransaction(txData, pin, this.storage);
  }

  /**
   * Delegate authority - Send Transaction
   * Create a SendTransaction instance ready to mine a delegate authority transaction.
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {'mint'|'melt'} type Type of the authority to delegate 'mint' or 'melt'
   * @param {string} destinationAddress Destination address of the delegated authority
   * @param {DelegateAuthorityOptions} [options] Options parameters
   *
   * @return {Promise<SendTransaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async delegateAuthoritySendTransaction(tokenUid, type, destinationAddress, options = {}) {
    const transaction = await this.prepareDelegateAuthorityData(
      tokenUid,
      type,
      destinationAddress,
      options
    );
    return new SendTransaction({ storage: this.storage, transaction });
  }

  /**
   * Delegate authority
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {'mint'|'melt'} type Type of the authority to delegate 'mint' or 'melt'
   * @param {string} destinationAddress Destination address of the delegated authority
   * @param {DelegateAuthorityOptions} [options] Options parameters
   *
   * @return {Promise<Transaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async delegateAuthority(tokenUid, type, destinationAddress, options = {}) {
    const sendTx = await this.delegateAuthoritySendTransaction(
      tokenUid,
      type,
      destinationAddress,
      options
    );
    return sendTx.runFromMining();
  }

  /**
   * @typedef {Object} DestroyAuthorityOptions
   * @param {boolean?} [startMiningTx=true] trigger start mining
   * @param {string?} [pinCode] pin to decrypt xpriv information.
   */

  /**
   * Prepare destroy authority transaction before mining
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {string} type Type of the authority to delegate 'mint' or 'melt'
   * @param {number} count How many authority outputs to destroy
   * @param {DestroyAuthorityOptions} [options] Options parameters
   *
   * @return {Promise<Transaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async prepareDestroyAuthorityData(tokenUid, type, count, options = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('destroyAuthority');
    }
    const newOptions = { pinCode: null, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }
    let destroyInputs;
    if (type === 'mint') {
      destroyInputs = await this.getMintAuthority(tokenUid, {
        many: true,
        only_available_utxos: true,
      });
    } else if (type === 'melt') {
      destroyInputs = await this.getMeltAuthority(tokenUid, {
        many: true,
        only_available_utxos: true,
      });
    } else {
      throw new Error('This should never happen.');
    }

    if (destroyInputs.length < count) {
      throw new Error(ErrorMessages.NO_UTXOS_AVAILABLE);
    }

    const data = [];
    for (const utxo of destroyInputs) {
      // FIXME: select utxos passing count to the method
      data.push(utxo);
      // Even though count is expected as a number, I am using ==
      // in case someone sends a string in the future
      if (data.length >= count) {
        break;
      }
    }

    const txData = tokenUtils.prepareDestroyAuthorityTxData(data);
    return transactionUtils.prepareTransaction(txData, pin, this.storage);
  }

  /**
   * Destroy authority - SendTransaction
   * Creates a SendTransaction instance with a prepared destroy transaction.
   *
   * @param {string} tokenUid UID of the token to destroy the authority
   * @param {'mint'|'melt'} type Type of the authority to destroy: 'mint' or 'melt'
   * @param {number} count How many authority outputs to destroy
   * @param {DestroyAuthorityOptions} [options] Options parameters
   *
   * @return {Promise<SendTransaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async destroyAuthoritySendTransaction(tokenUid, type, count, options = {}) {
    const transaction = await this.prepareDestroyAuthorityData(tokenUid, type, count, options);
    return new SendTransaction({ storage: this.storage, transaction });
  }

  /**
   * Destroy authority
   *
   * @param {string} tokenUid UID of the token to destroy the authority
   * @param {'mint'|'melt'} type Type of the authority to destroy: 'mint' or 'melt'
   * @param {number} count How many authority outputs to destroy
   * @param {DestroyAuthorityOptions} [options] Options parameters
   *
   * @return {Promise<Transaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async destroyAuthority(tokenUid, type, count, options = {}) {
    const sendTx = await this.destroyAuthoritySendTransaction(tokenUid, type, count, options);
    return sendTx.runFromMining();
  }

  /**
   * Remove sensitive data from memory
   *
   * NOTICE: This won't remove data from memory immediately, we have to wait until javascript
   * garbage collect it. JavaScript currently does not provide a standard way to trigger
   * garbage collection
   * */
  clearSensitiveData() {
    this.xpriv = undefined;
    this.seed = undefined;
  }

  /**
   * Get all authorities utxos for specific token
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {"mint"|"melt"} type Type of the authority to search for: 'mint' or 'melt'
   *
   * @return {{tx_id: string, index: number, address: string, authorities: OutputValueType}[]}
   *    Array of the authority outputs.
   * */
  async getAuthorityUtxos(tokenUid, type) {
    if (type === 'mint') {
      return this.getMintAuthority(tokenUid, { many: true });
    }
    if (type === 'melt') {
      return this.getMeltAuthority(tokenUid, { many: true });
    }
    throw new Error('This should never happen.');
  }

  getTokenData() {
    if (this.tokenUid === NATIVE_TOKEN_UID) {
      // Hathor token we don't get from the full node
      this.token = this.storage.getNativeTokenData();
    } else {
      // XXX: This request is not awaited
      // Get token info from full node
      // XXX This request might take longer than the ws connection to start
      // so it's possible (but hard to happen) that the wallet will change to
      // READY state with token still null.
      // I will keep it like that for now but to protect from this
      // we should change to READY only after both things finish
      walletApi.getGeneralTokenInfo(this.tokenUid, response => {
        if (response.success) {
          this.token = {
            uid: this.tokenUid,
            name: response.name,
            symbol: response.symbol,
          };
        } else {
          throw Error(response.message);
        }
      });
    }
  }

  /**
   * Call get token details API
   *
   * @param tokenId Token uid to get the token details
   *
   * @return {Promise<{
   *   totalSupply: number,
   *   totalTransactions: number,
   *   tokenInfo: {
   *     name: string,
   *     symbol: string,
   *   },
   *   authorities: {
   *     mint: boolean,
   *     melt: boolean,
   *   },
   * }>} token details
   */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async getTokenDetails(tokenId) {
    const result = await new Promise((resolve, reject) => {
      walletApi.getGeneralTokenInfo(tokenId, resolve).catch(error => reject(error));
    });

    if (!result.success) {
      throw new Error(result.message);
    }

    const { name, symbol, mint, melt, total, transactions_count } = result;

    // Transform to the same format the wallet service facade responds
    return {
      totalSupply: total,
      totalTransactions: transactions_count,
      tokenInfo: {
        name,
        symbol,
      },
      authorities: {
        mint: mint.length > 0,
        melt: melt.length > 0,
      },
    };
  }

  isReady() {
    return this.state === HathorWallet.READY;
  }

  /**
   * Check if address is from the loaded wallet
   *
   * @param {string} address Address to check
   *
   * @return {Promise<boolean>}
   * */
  async isAddressMine(address) {
    return this.storage.isAddressMine(address);
  }

  /**
   * Check if a list of addresses are from the loaded wallet
   *
   * @param {string[]} addresses Addresses to check
   *
   * @return {Object} Object with the addresses and whether it belongs or not { address: boolean }
   * */
  async checkAddressesMine(addresses) {
    const promises = [];
    for (const address of addresses) {
      promises.push(this.storage.isAddressMine(address).then(mine => ({ address, mine })));
    }

    const results = await Promise.all(promises);
    return results.reduce((acc, result) => {
      acc[result.address] = result.mine;
      return acc;
    }, {});
  }

  /**
   * Get index of address
   * Returns null if address does not belong to the wallet
   *
   * @param {string} address Address to get the index
   *
   * @return {Promise<number | null>}
   * */
  async getAddressIndex(address) {
    const addressInfo = await this.storage.getAddressInfo(address);
    return get(addressInfo, 'bip32AddressIndex', null);
  }

  /**
   * FIXME: does not differentiate between locked and unlocked, also ignores authorities
   * Returns the balance for each token in tx, if the input/output belongs to this wallet
   *
   * @param {DecodedTx} tx Decoded transaction with populated data from local wallet history
   * @param [optionsParam]
   * @param {boolean} [optionsParam.includeAuthorities=false] Retrieve authority balances if true
   *
   * @return {Promise<Record<string,number>>} Promise that resolves with an object with each token
   *                                          and it's balance in this tx for this wallet
   *
   * @example
   * const decodedTx = hathorWalletInstance.getTx(txHash);
   * const txBalance = await hathorWalletInstance.getTxBalance(decodedTx);
   * */
  async getTxBalance(tx, optionsParam = {}) {
    const balance = {};
    const fullBalance = await transactionUtils.getTxBalance(tx, this.storage);

    // We need to map balance for backwards compatibility
    for (const [token, tokenBalance] of Object.entries(fullBalance)) {
      balance[token] = tokenBalance.tokens.locked + tokenBalance.tokens.unlocked;
    }

    return balance;
  }

  /**
   * Return the addresses of the tx that belongs to this wallet
   * The address might be in the input or output
   * Removes duplicates
   *
   * @param {DecodedTx} tx Transaction data with array of inputs and outputs
   *
   * @return {Set<string>} Set of strings with addresses
   * */
  async getTxAddresses(tx) {
    const addresses = new Set();
    for (const io of [...tx.outputs, ...tx.inputs]) {
      if (io.decoded && io.decoded.address && (await this.isAddressMine(io.decoded.address))) {
        addresses.add(io.decoded.address);
      }
    }

    return addresses;
  }

  /**
   * @typedef {Omit<CreateTokenOptions, 'data'|'isCreateNFT'>} CreateNFTOptions
   */

  /**
   * Create a SendTransaction instance with a create NFT transaction prepared.
   *
   * @param {string} name Name of the token
   * @param {string} symbol Symbol of the token
   * @param {OutputValueType} amount Quantity of the token to be minted
   * @param {string} data NFT data string using utf8 encoding
   * @param {CreateNFTOptions?} [options={}] Options parameters
   *
   * @return {Promise<SendTransaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async createNFTSendTransaction(name, symbol, amount, data, options = {}) {
    /** @type {CreateTokenOptions} */
    const newOptions = {
      address: null,
      changeAddress: null,
      startMiningTx: true,
      pinCode: null,
      createMint: false,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMelt: false,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      ...options,
    };
    newOptions.data = [data];
    newOptions.isCreateNFT = true;
    const transaction = await this.prepareCreateNewToken(name, symbol, amount, newOptions);
    return new SendTransaction({ storage: this.storage, transaction });
  }

  /**
   * Create an NFT for this wallet
   *
   * @param {string} name Name of the token
   * @param {string} symbol Symbol of the token
   * @param {OutputValueType} amount Quantity of the token to be minted
   * @param {string} data NFT data string using utf8 encoding
   * @param {CreateNFTOptions?} [options={}] Options parameters
   *
   * @return {Promise<CreateTokenTransaction>}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async createNFT(name, symbol, amount, data, options = {}) {
    const sendTx = await this.createNFTSendTransaction(name, symbol, amount, data, options);
    return sendTx.runFromMining();
  }

  /**
   * Identify all inputs from the loaded wallet
   *
   * @param {Transaction} tx The transaction
   *
   * @returns {Promise<{
   * inputIndex: number,
   * addressIndex: number,
   * addressPath: string,
   * }[]>} List of indexes and their associated address index
   */
  async getWalletInputInfo(tx) {
    const walletInputs = [];

    for await (const { tx: spentTx, input, index } of this.storage.getSpentTxs(tx.inputs)) {
      const addressInfo = await this.storage.getAddressInfo(
        spentTx.outputs[input.index].decoded.address
      );
      if (addressInfo === null) {
        continue;
      }
      const addressPath = await this.getAddressPathForIndex(addressInfo.bip32AddressIndex);
      walletInputs.push({
        inputIndex: index,
        addressIndex: addressInfo.bip32AddressIndex,
        addressPath,
      });
    }

    return walletInputs;
  }

  /**
   * Get signatures for all inputs of the loaded wallet.
   *
   * @param {Transaction} tx The transaction to be signed
   * @param [options]
   * @param {string} [options.pinCode] PIN to decrypt the private key.
   *                                   Optional but required if not set in this
   *
   * @async
   * @returns {Promise<{
   * inputIndex: number,
   * addressIndex: number,
   * addressPath: string,
   * signature: string,
   * pubkey: string,
   * }>} Input and signature information
   */
  async getSignatures(tx, { pinCode = null } = {}) {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('getSignatures');
    }
    const pin = pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }
    const signatures = await this.storage.getTxSignatures(tx, pin);
    const sigInfoArray = [];
    for (const sigData of signatures.inputSignatures) {
      sigInfoArray.push({
        ...sigData,
        pubkey: sigData.pubkey.toString('hex'),
        signature: sigData.signature.toString('hex'),
        addressPath: await this.getAddressPathForIndex(sigData.addressIndex),
      });
    }
    return sigInfoArray;
  }

  /**
   * Sign all inputs of the given transaction.
   *   OBS: only for P2PKH wallets.
   *
   * @param {Transaction} tx The transaction to be signed
   * @param [options]
   * @param {string} [options.pinCode] PIN to decrypt the private key.
   *                                   Optional but required if not set in this
   *
   * @returns {Promise<Transaction>} The signed transaction
   */
  async signTx(tx, options = {}) {
    for (const sigInfo of await this.getSignatures(tx, options)) {
      const { signature, pubkey, inputIndex } = sigInfo;
      const inputData = transactionUtils.createInputData(
        Buffer.from(signature, 'hex'),
        Buffer.from(pubkey, 'hex')
      );
      tx.inputs[inputIndex].setData(inputData);
    }

    return tx;
  }

  /**
   * Guard to check if the response is a transaction not found response
   *
   * @param {Object} data The request response data
   *
   * @throws {TxNotFoundError} If the returned error was a transaction not found
   */
  static _txNotFoundGuard(data) {
    if (get(data, 'message', '') === 'Transaction not found') {
      throw new TxNotFoundError();
    }
  }

  /**
   * Queries the fullnode for a transaction
   *
   * @param {string} txId The transaction to query
   *
   * @returns {FullNodeTxResponse} Transaction data in the fullnode
   */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async getFullTxById(txId) {
    const tx = await new Promise((resolve, reject) => {
      txApi
        .getTransaction(txId, resolve)
        // txApi will call the `resolve` callback and end the promise chain,
        // so if it falls here, we should throw
        .then(() => reject(new Error('API client did not use the callback')))
        .catch(err => reject(err));
    });
    if (!tx.success) {
      HathorWallet._txNotFoundGuard(tx);

      throw new Error(`Invalid transaction ${txId}`);
    }

    return tx;
  }

  /**
   * Queries the fullnode for a transaction confirmation data
   *
   * @param {string} txId The transaction to query
   *
   * @returns {FullNodeTxConfirmationDataResponse} Transaction confirmation data
   */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async getTxConfirmationData(txId) {
    const confirmationData = await new Promise((resolve, reject) => {
      txApi
        .getConfirmationData(txId, resolve)
        .then(() => reject(new Error('API client did not use the callback')))
        .catch(err => reject(err));
    });

    if (!confirmationData.success) {
      HathorWallet._txNotFoundGuard(confirmationData);

      throw new Error(`Invalid transaction ${txId}`);
    }

    return confirmationData;
  }

  /**
   * Queries the fullnode for a graphviz graph, given a graph type and txId
   *
   * @param {string} txId The transaction to query
   * @param {string} graphType The graph type to query
   * @param {string} maxLevel Max level to render
   *
   * @returns {Promise<string>} The graphviz digraph
   */
  async graphvizNeighborsQuery(txId, graphType, maxLevel) {
    const url = `${this.storage.config.getServerUrl()}graphviz/neighbours.dot?tx=${txId}&graph_type=${graphType}&max_level=${maxLevel}`;
    const graphvizData = await new Promise((resolve, reject) => {
      txApi
        .getGraphviz(url, resolve)
        .then(() => reject(new Error('API client did not use the callback')))
        .catch(err => reject(err));
    });

    // The response will either be a string with the graphviz data or an object
    // { success: boolean, message: string } so we need to check if the response has
    // the `success` key
    if (Object.hasOwnProperty.call(graphvizData, 'success') && !graphvizData.success) {
      HathorWallet._txNotFoundGuard(graphvizData);

      throw new Error(`Invalid transaction ${txId}`);
    }

    return graphvizData;
  }

  /**
   * This function is responsible for getting the details of each token in the transaction.
   * @param {string} txId - Transaction id
   * @returns {Promise<{
   *   success: boolean
   *   txTokens: Array<{
   *     txId: string,
   *     timestamp: number,
   *     version: number,
   *     voided: boolean,
   *     weight: number,
   *     tokenName: string,
   *     tokenSymbol: string,
   *     balance: number
   *   }>
   * }>} Array of token details
   * @example
   * {
   *   success: true,
   *   txTokens: [
   *     {
   *      txId: '000021e7addbb94a8e43d7f1237d556d47efc4d34800c5923ed3a75bf5a2886e';
   *      timestamp: 123456789;
   *      version: 1;
   *      voided: false;
   *      weight: 18.5;
   *      tokenId: '00',
   *      tokenName: 'Hathor',
   *      tokenSymbol: 'HTR',
   *      balance: 100,
   *     },
   *   ],
   * }
   * @throws {Error} (propagation) Invalid transaction
   * @throws {Error} (propagation) Client did not use the callback
   * @throws {Error} (propagation) Transaction not found
   * @throws {Error} Transaction does not have any balance for this wallet
   * @throws {Error} Token uid not found in tokens list
   * @throws {Error} Token uid not found in tx
   */
  async getTxById(txId) {
    /**
     * Hydrate input and output with token uid
     * @param {Transaction.input|Transaction.output} io - Input or output
     * @param {Array} tokens - Array of token configs
     * @example
     * {
     *   ...output,
     *   token: '00',
     * }
     * @throws {Error} Token uid not found in tokens list
     */
    const hydrateWithTokenUid = (io, tokens) => {
      const { token_data } = io;

      if (token_data === 0) {
        return {
          ...io,
          token: NATIVE_TOKEN_UID,
        };
      }

      const tokenIdx = tokenUtils.getTokenIndexFromData(token_data);
      const tokenUid = tokens[tokenIdx - 1]?.uid;
      if (!tokenUid) {
        throw new Error(`Invalid token_data ${token_data}, token not found in tokens list`);
      }

      return {
        ...io,
        token: tokenUid,
      };
    };

    /**
     * @throws {Error} Invalid transaction
     * @throws {Error} Client did not use the callback
     * @throws {Error} Transaction not found
     */
    const fullTx = await this.getFullTxById(txId);
    fullTx.tx.outputs = fullTx.tx.outputs.map(output =>
      hydrateWithTokenUid(output, fullTx.tx.tokens)
    );
    fullTx.tx.inputs = fullTx.tx.inputs.map(input => hydrateWithTokenUid(input, fullTx.tx.tokens));

    // Get the balance of each token in the transaction that belongs to this wallet
    // sample output: { 'A': 100, 'B': 10 }, where 'A' and 'B' are token UIDs
    const tokenBalances = await this.getTxBalance(fullTx.tx);
    const { length: hasBalance } = Object.keys(tokenBalances);
    if (!hasBalance) {
      throw new Error(`Transaction ${txId} does not have any balance for this wallet`);
    }

    const listTokenUid = Object.keys(tokenBalances);
    const txTokens = listTokenUid.map(uid => {
      /**
       * Retrieves the token config from the transaction.
       * @param {string} tokenUid
       * @returns {TokenInfo} Token config
       */
      const getToken = tokenUid => {
        if (tokenUid === NATIVE_TOKEN_UID) {
          return this.storage.getNativeTokenData();
        }

        const token = fullTx.tx.tokens.find(tokenElem => tokenElem.uid === tokenUid);
        if (!token) {
          throw new Error(`Token ${tokenUid} not found in tx`);
        }

        return token;
      };

      const isVoided = fullTx.meta.voided_by.length > 0;
      const token = getToken(uid);
      const tokenBalance = tokenBalances[uid];

      const tokenDetails = {
        txId,
        timestamp: fullTx.tx.timestamp,
        version: fullTx.tx.version,
        voided: isVoided,
        weight: fullTx.tx.weight,
        tokenId: token.uid,
        tokenName: token.name,
        tokenSymbol: token.symbol,
        balance: tokenBalance,
      };
      return tokenDetails;
    });

    return { success: true, txTokens };
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
    return (await this.checkPin(pin)) && this.checkPassword(password); // The promise from checkPassword will be returned here
  }

  /**
   * Check if the wallet is a hardware wallet.
   * @returns {Promise<boolean>}
   */
  async isHardwareWallet() {
    return this.storage.isHardwareWallet();
  }

  /**
   * @typedef {Object} CreateNanoTxOptions
   * @property {string?} [pinCode] PIN to decrypt the private key.
   */

  /**
   * @typedef {Object} CreateNanoTxData
   * @property {string?} [blueprintId=null] ID of the blueprint to create the nano contract. Required if method is initialize.
   * @property {string?} [ncId=null] ID of the nano contract to execute method. Required if method is not initialize
   * @property {NanoContractAction[]?} [actions] List of actions to execute in the nano contract transaction
   * @property {any[]} [args] List of arguments for the method to be executed in the transaction
   *
   */

  /**
   * Create and send a nano contract transaction
   *
   * @param {string} method Method of nano contract to have the transaction created
   * @param {string} address Address that will be used to sign the nano contract transaction
   * @param {CreateNanoTxData} [data]
   * @param {CreateNanoTxOptions} [options]
   *
   * @returns {Promise<NanoContract>}
   */
  async createAndSendNanoContractTransaction(method, address, data, options = {}) {
    const sendTransaction = await this.createNanoContractTransaction(
      method,
      address,
      data,
      options
    );
    return sendTransaction.runFromMining();
  }

  /**
   * Create a nano contract transaction and return the SendTransaction object
   *
   * @param {string} method Method of nano contract to have the transaction created
   * @param {string} address Address that will be used to sign the nano contract transaction
   * @param {CreateNanoTxData} [data]
   * @param {CreateNanoTxOptions} [options]
   *
   * @returns {Promise<SendTransaction>}
   */
  async createNanoContractTransaction(method, address, data, options = {}) {
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('createNanoContractTransaction');
    }
    const newOptions = { pinCode: null, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new PinRequiredError(ERROR_MESSAGE_PIN_REQUIRED);
    }

    // Get caller pubkey
    const addressInfo = await this.storage.getAddressInfo(address);
    if (!addressInfo) {
      throw new NanoContractTransactionError(
        `Address used to sign the transaction (${address}) does not belong to the wallet.`
      );
    }
    const pubkeyStr = await this.storage.getAddressPubkey(addressInfo.bip32AddressIndex);

    // Build and send transaction
    const builder = new NanoContractTransactionBuilder()
      .setMethod(method)
      .setWallet(this)
      .setBlueprintId(data.blueprintId)
      .setNcId(data.ncId)
      .setCaller(Buffer.from(pubkeyStr, 'hex'))
      .setActions(data.actions)
      .setArgs(data.args);

    const nc = await builder.build();
    return prepareNanoSendTransaction(nc, pin, this.storage);
  }

  /**
   * Generate and return the PrivateKey for an address
   *
   * @param {string} address Address to get the PrivateKey from
   * @param [options]
   * @param {string} [options.pinCode] PIN to decrypt the private key.
   *                                   Optional but required if not set in this
   *
   * @returns {Promise<HDPrivateKey>}
   */
  async getPrivateKeyFromAddress(address, options = {}) {
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('getPrivateKeyFromAddress');
    }
    const newOptions = { pinCode: null, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new PinRequiredError(ERROR_MESSAGE_PIN_REQUIRED);
    }

    const addressIndex = await this.getAddressIndex(address);
    if (addressIndex === null) {
      throw new AddressError('Address does not belong to the wallet.');
    }

    const xprivkey = await this.storage.getMainXPrivKey(pin);
    const key = HDPrivateKey(xprivkey);
    // Derive key to addressIndex
    const derivedKey = key.deriveNonCompliantChild(addressIndex);
    return derivedKey.privateKey;
  }

  /**
   * Set the external tx signing method.
   * @param {EcdsaTxSign|null} method
   */
  setExternalTxSigningMethod(method) {
    this.isSignedExternally = !!method;
    this.storage.setTxSignatureMethod(method);
  }

  /**
   * Set the history sync mode.
   * @param {HistorySyncMode} mode
   */
  setHistorySyncMode(mode) {
    this.historySyncMode = mode;
  }

  /**
   * @param {number} startIndex
   * @param {number} count
   * @param {boolean} [shouldProcessHistory=false]
   * @returns {Promise<void>}
   */
  async syncHistory(startIndex, count, shouldProcessHistory = false) {
    if (!(await getSupportedSyncMode(this.storage)).includes(this.historySyncMode)) {
      throw new Error('Trying to use an unsupported sync method for this wallet.');
    }
    let syncMode = this.historySyncMode;
    if (
      [HistorySyncMode.MANUAL_STREAM_WS, HistorySyncMode.XPUB_STREAM_WS].includes(
        this.historySyncMode
      ) &&
      !(await this.conn.hasCapability('history-streaming'))
    ) {
      // History sync mode is streaming but fullnode is not streaming capable.
      // We revert to the http polling default.
      this.logger.debug(
        'Either fullnode does not support history-streaming or has not sent a capabilities event'
      );
      this.logger.debug('Falling back to http polling API');
      syncMode = HistorySyncMode.POLLING_HTTP_API;
    }
    const syncMethod = getHistorySyncMethod(syncMode);
    // This will add the task to the GLL queue and return a promise that
    // resolves when the task finishes executing
    await GLL.add(async () => {
      await syncMethod(startIndex, count, this.storage, this.conn, shouldProcessHistory);
    });
  }

  /**
   * Reload all addresses and transactions from the full node
   */
  async reloadStorage() {
    await this.conn.onReload();

    // unsub all addresses
    for await (const address of this.storage.getAllAddresses()) {
      this.conn.unsubscribeAddress(address.base58);
    }
    const accessData = await this.storage.getAccessData();
    if (accessData != null) {
      // Clean entire storage
      await this.storage.cleanStorage(true, true);
      // Reset access data
      await this.storage.saveAccessData(accessData);
    }
    const addressesToLoad = await scanPolicyStartAddresses(this.storage);
    await this.syncHistory(addressesToLoad.nextIndex, addressesToLoad.count);
  }

  /**
   * Build a transaction from a template.
   *
   * @param {z.input<typeof TransactionTemplate>} template
   * @param [options]
   * @param {boolean} [options.signTx] If the transaction should be signed.
   * @param {string} [options.pinCode] PIN to decrypt the private key.
   * @returns {Promise<Transaction|CreateTokenTransaction>}
   */
  async buildTxTemplate(template, options) {
    const newOptions = {
      signTx: false,
      pinCode: null,
      ...options,
    };
    const instructions = TransactionTemplate.parse(template);
    const tx = await this.txTemplateInterpreter.build(instructions, this.debug);
    if (newOptions.signTx) {
      await transactionUtils.signTransaction(tx, this.storage, newOptions.pinCode || this.pinCode);
      tx.prepareToSend();
    }
    return tx;
  }

  /**
   * Run a transaction template and send the transaction.
   *
   * @param {z.input<typeof TransactionTemplate>} template
   * @param {string|undefined} pinCode
   * @returns {Promise<Transaction|CreateTokenTransaction>}
   */
  async runTxTemplate(template, pinCode) {
    const transaction = await this.buildTxTemplate(template, {
      signTx: true,
      pinCode,
    });
    return this.handleSendPreparedTransaction(transaction);
  }
}

// State constants.
HathorWallet.CLOSED = 0;
HathorWallet.CONNECTING = 1;
HathorWallet.SYNCING = 2;
HathorWallet.READY = 3;
HathorWallet.ERROR = 4;
HathorWallet.PROCESSING = 5;

export default HathorWallet;
