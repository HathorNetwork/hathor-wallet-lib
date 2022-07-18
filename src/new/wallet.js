/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import wallet from '../wallet';
import { HATHOR_TOKEN_CONFIG, HATHOR_BIP44_CODE, P2SH_ACCT_PATH } from "../constants";
import tokens from '../tokens';
import transaction from '../transaction';
import version from '../version';
import walletApi from '../api/wallet';
import storage from '../storage';
import { hexToBuffer } from '../utils/buffer';
import helpers from '../utils/helpers';
import walletUtils from '../utils/wallet';
import MemoryStore from '../memory_store';
import config from '../config';
import SendTransaction from './sendTransaction';
import Network from '../models/network';
import { AddressError, WalletError } from '../errors';
import { ErrorMessages } from '../errorMessages';
import P2SHSignature from '../models/p2sh_signature';
import { HDPrivateKey, HDPublicKey, crypto } from 'bitcore-lib';

const ERROR_MESSAGE_PIN_REQUIRED = 'Pin is required.';
const ERROR_CODE_PIN_REQUIRED = 'PIN_REQUIRED';

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
 **/
class HathorWallet extends EventEmitter {
  /**
   * @param param
   * @param {ConnectionState} param.connection A connection to the server
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
   */
  constructor({
    connection,

    store,

    seed,
    passphrase = '',

    xpriv,

    xpub,

    tokenUid = HATHOR_TOKEN_CONFIG.uid,

    password = null,
    pinCode = null,

    // debug mode
    debug = false,
    // Callback to be executed before reload data
    beforeReloadCallback = null,
    multisig = null,
    preCalculatedAddresses = null,
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
      throw Error('You can\'t use xpriv with passphrase.');
    }

    if (connection.state !== ConnectionState.CLOSED) {
      throw Error('You can\'t share connections.');
    }

    if (multisig) {
      if (!(multisig.pubkeys && multisig.numSignatures)) {
        throw Error('Multisig configuration requires both pubkeys and numSignatures.');
      } else if (multisig.pubkeys.length < multisig.numSignatures) {
        throw Error('Multisig configuration invalid.');
      }
    }

    this.conn = connection;
    wallet.setConnection(connection);

    this.state = HathorWallet.CLOSED;
    this.serverInfo = null;

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

    this.store = null;
    if (store) {
      this.store = store;
    } else {
      // Creating default store
      this.store = new MemoryStore();
    }
    storage.setStore(this.store);

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

    // This object stores pre-processed data that helps speed up the return of getBalance and getTxHistory
    this.preProcessedData = {};

    if (multisig) {
      this.multisig = {
        pubkeys: multisig.pubkeys,
        numSignatures: multisig.numSignatures,
      };
    }
  }

  /**
   * Gets the current server url from connection
   */
  getServerUrl() {
    return this.conn.getCurrentServer();
  }

  /**
   * Gets the current network from connection
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
   **/
  async getVersionData() {
    const versionData = await version.checkApiVersion();

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
   * On this facade, we should call wallet.changeServer and also update the config singleton
   *
   * @param {String} newServer The new server to change to
   *
   * @memberof HathorWallet
   * @inner
   **/
  changeServer(newServer) {
    wallet.changeServer(newServer);
    config.setServerUrl(newServer);
  }

  /**
   * Enable debug mode.
   **/
  enableDebugMode() {
    this.debug = true;
  }

  /**
   * Disable debug mode.
   **/
  disableDebugMode() {
    this.debug = false;
  }

  /**
   * Test if this wallet started only with an xpub
   */
  isFromXPub() {
    return Boolean(this.xpub);
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   *
   * @param {Number} newState Enum of new state after change
   **/
  onConnectionChangedState(newState) {
    if (newState === ConnectionState.CONNECTED) {
      storage.setStore(this.store);
      this.setState(HathorWallet.SYNCING);

      // If it's the first connection we just load the history
      // otherwise we are reloading data, so we must execute some cleans
      // before loading the full data again
      let promise;
      if (this.firstConnection) {
        this.firstConnection = false;
        promise = wallet.loadAddressHistory(
          0,
          wallet.getGapLimit(),
          this.conn,
          this.store,
          this.preCalculatedAddresses
        );
      } else {
        if (this.beforeReloadCallback) {
          this.beforeReloadCallback();
        }
        promise = wallet.reloadData({connection: this.conn, store: this.store});
      }

      promise.then(() => {
        this.setState(HathorWallet.READY);
      }).catch((error) => {
        this.setState(HathorWallet.ERROR);
        console.error('Error loading wallet', {error});
      })
    } else {
      this.serverInfo = null;
      if (this.walletStopped) {
        this.setState(HathorWallet.CLOSED);
      } else {
        // Otherwise we just lost websocket connection
        this.setState(HathorWallet.CONNECTING);
      }
    }
  }

  /**
   * Sign and return all signatures of the inputs belonging to this wallet.
   *
   * @param {string} txHex hex representation of the transaction.
   * @param {string} pin PIN to decrypt the private key
   *
   * @return {string} serialized P2SHSignature data
   *
   * @memberof HathorWallet
   * @inner
   */
  getAllSignatures(txHex, pin) {
    storage.setStore(this.store);
    const tx = helpers.createTxFromHex(txHex, this.getNetworkObject());
    const hash = tx.getDataToSignHash();
    const walletData = wallet.getWalletData();
    const historyTransactions = walletData['historyTransactions'] || {};
    const accessData = storage.getItem('wallet:accessData');
    const privateKeyStr = wallet.decryptData(accessData.mainKey, pin);
    const key = HDPrivateKey(privateKeyStr);
    const signatures = {};

    for (const {index, input} of tx.inputs.map((input, index) => ({index, input}))) {
      if (!(input.hash in historyTransactions)) {
        continue;
      }

      const histTx = historyTransactions[input.hash];
      const address = histTx.outputs[input.index].decoded.address;
      // get address index
      const addressIndex = wallet.getAddressIndex(address);
      if (addressIndex === null || addressIndex === undefined) {
        // The transaction is on our history but this input is not ours
        continue;
      }

      const derivedKey = key.deriveNonCompliantChild(addressIndex);
      const privateKey = derivedKey.privateKey;

      // derive key to address index
      const sig = crypto.ECDSA.sign(hash, privateKey, 'little').set({
        nhashtype: crypto.Signature.SIGHASH_ALL
      });

      signatures[index] = sig.toString();
    }
    const p2shSig = new P2SHSignature(accessData.multisig.pubkey, signatures);
    return p2shSig.serialize();
  }

  /**
   * Assemble transaction from hex and collected p2sh_signatures.
   *
   * @param {string} txHex hex representation of the transaction.
   * @param {Array} signatures Array of serialized p2sh_signatures (string).
   *
   * @return {Transaction} with input data created from the signatures.
   *
   * @throws {Error} if there are not enough signatures for an input
   *
   * @memberof HathorWallet
   * @inner
   */
  assemblePartialTransaction(txHex, signatures) {
    storage.setStore(this.store);
    const tx = helpers.createTxFromHex(txHex, this.getNetworkObject());
    const walletData = wallet.getWalletData();
    const historyTransactions = walletData['historyTransactions'] || {};
    const accessData = storage.getItem('wallet:accessData');
    const multisigData = accessData.multisig;
    const xpub = HDPublicKey(accessData.xpubkey);

    // Deserialize P2SHSignature for all signatures
    // XXX: the .sort here is very important since the fullnode requires the signatures
    // in the same order as the pubkeys in the redeemScript and the order chosen for the
    // pubkeys is the order of the sorted account path pubkey (hex encoded). This sort
    // only works because the serialized signature starts with the account path pubkey.
    const p2shSignatures = signatures.sort().map(sig => P2SHSignature.deserialize(sig));

    for (const {index, input} of tx.inputs.map((input, index) => ({index, input}))) {
      if (!(input.hash in historyTransactions)) {
        continue;
      }

      const histTx = historyTransactions[input.hash];
      const address = histTx.outputs[input.index].decoded.address;
      // get address index
      const addressIndex = wallet.getAddressIndex(address);
      if (addressIndex === null || addressIndex === undefined) {
        // The transaction is on our history but this input is not ours
        continue;
      }

      const redeemScript = walletUtils.createP2SHRedeemScript(multisigData.pubkeys, multisigData.numSignatures, addressIndex);
      const sigs = [];
      for (const p2shSig of p2shSignatures) {
        try {
          sigs.push(hexToBuffer(p2shSig.signatures[index]));
        } catch (e) {
          // skip if there is no signature, or if it's not hex
          continue
        }
      }
      const inputData = walletUtils.getP2SHInputData(sigs, redeemScript);
      tx.inputs[index].setData(inputData);
    }

    return tx;
  }

  /**
   * Old getAllAddresses method used to keep compatibility
   * with some methods that used to need it
   *
   * @return {Array} Array of addresses (string)
   *
   * @memberof HathorWallet
   * @inner
   **/
  _getAllAddressesRaw() {
    storage.setStore(this.store);
    return wallet.getAllAddresses();
  }

  /**
   * Return all addresses of the wallet with info of each of them
   *
   * @return {Promise<Array>} Array of objects { address, index, transactions } where transactions is the count of txs for this address
   *
   * @memberof HathorWallet
   * @inner
   **/
  async * getAllAddresses() {
    storage.setStore(this.store);
    // This algorithm is bad at performance
    // but we must add the count of transactions
    // in order to replicate the same return as the new
    // wallet service facade
    // This is really fast for a normal quantity of addresses in a wallet
    const transactionsByAddress = this.getTransactionsCountByAddress();
    const addresses = wallet.getAllAddresses();
    for (const address of addresses) {
      const ret = {
        address,
        index: transactionsByAddress[address].index,
        transactions: transactionsByAddress[address].transactions,
      };
      yield ret;
    }
  }

  /**
   * Auxiliar method to get the quantity of transactions by each address of the wallet
   *
   * @return {Record<string,{index:number,transactions:number}>} Object mapping addresses to entries
   * @example
   * const tcba = hWallet.getTransactionsCountByAddress();
   * const {index, transactions} = tcba['WQketbSbvVixaRHWDAZdFBBpoPGsQ21Zpc'];
   * if (transactions > 0) console.log(`Address on index ${index} has transactions.`);
   * @memberof HathorWallet
   * @inner
   **/
  getTransactionsCountByAddress() {
    storage.setStore(this.store);
    const walletData = wallet.getWalletData();
    const addressKeys = walletData.keys;
    const transactionsByAddress = {};
    for (const key in addressKeys) {
      transactionsByAddress[key] = {
        index: addressKeys[key].index,
        transactions: 0,
      };
    }

    const historyTransactions = 'historyTransactions' in walletData ? walletData['historyTransactions'] : {};
    for (const tx_id in historyTransactions) {
      const tx = historyTransactions[tx_id];
      const foundAddresses = [];
      for (const el of [...tx.outputs, ...tx.inputs]) {
        const address = el.decoded.address;
        if (address in transactionsByAddress && foundAddresses.indexOf(address) === -1) {
          transactionsByAddress[address].transactions += 1;
          foundAddresses.push(address);
        }
      }
    }

    return transactionsByAddress;
  }

  /**
   * Get address from specific derivation index
   *
   * @return {string} Address
   *
   * @memberof HathorWallet
   * @inner
   **/
  getAddressAtIndex(index) {
    storage.setStore(this.store);
    return wallet.getAddressAtIndex(index);
  }

  /**
   * Get address to be used in the wallet
   *
   * @param [options]
   * @param {boolean} [options.markAsUsed=false] if true, we will locally mark this address as used
   *                                             and won't return it again to be used
   *
   * @return {{ address:string, index:number, addressPath:string }}
   *
   * @memberof HathorWallet
   * @inner
   **/
  getCurrentAddress({ markAsUsed = false } = {}) {
    storage.setStore(this.store);
    let address;
    if (markAsUsed) {
      address = wallet.getAddressToUse(this.conn);
    } else {
      address = wallet.getCurrentAddress();
    }
    const index = this.getAddressIndex(address);
    let addressPath;
    if (wallet.isWalletMultiSig()) {
      addressPath = `${P2SH_ACCT_PATH}/0/${index}`;
    } else {
      addressPath = `m/44'/${HATHOR_BIP44_CODE}'/0'/0/${index}`;
    }

    return { address, index, addressPath };
  }

  /**
   * Get the next address after the current available
   */
  getNextAddress() {
    // First we mark the current address as used, then return the next
    this.getCurrentAddress({ markAsUsed: true });
    return this.getCurrentAddress();
  }

  /**
   * Called when a new message arrives from websocket.
   **/
  handleWebsocketMsg(wsData) {
    if (wsData.type === 'wallet:address_history') {
      this.onNewTx(wsData);
    }
  }

  /**
   * Get balance for a token
   *
   * @remarks
   * Getting token name and symbol is not easy, so we return empty strings
   *
   * @param {string} token
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
   **/
  async getBalance(token = null) {
    storage.setStore(this.store);
    // TODO if token is null we should get the balance for each token I have
    // but we don't use it in the wallets, so I won't implement it
    if (token === null) {
      throw new WalletError('Not implemented.');
    }
    const uid = token || this.token.uid;
    const balanceByToken = await this.getPreProcessedData('balanceByToken');
    const balance = uid in balanceByToken ? balanceByToken[uid] : { available: 0, locked: 0, transactions: 0 };
    return [{
      token: { // Getting token name and symbol is not easy, so we return empty strings
        id: uid,
        name: '',
        symbol: ''
      },
      balance: {
        unlocked: balance.available,
        locked: balance.locked,
      },
      transactions: balance.transactions,
      lockExpires: null,
      tokenAuthorities : {
        unlocked: {
          mint: this.selectAuthorityUtxo(uid, wallet.isMintOutput.bind(wallet)) !== null,
          melt: this.selectAuthorityUtxo(uid, wallet.isMeltOutput.bind(wallet)) !== null,
        },
        locked: {
          mint: false,
          melt: false
        }
      },
    }];
  }

  /**
   * Get transaction history
   *
   * @param options
   * @param {string} [options.token_id]
   * @param {number} [options.count]
   * @param {number} [options.skip]
   * @return {Promise<{
   *   txId:string,
   *   timestamp:number,
   *   tokenUid:string,
   *   balance:number,
   *   voided:boolean
   * }[]>} Array of transactions
   * @memberof HathorWallet
   * @inner
   **/
  async getTxHistory(options = {}) {
    storage.setStore(this.store);
    const newOptions = Object.assign({ token_id: HATHOR_TOKEN_CONFIG.uid, count: 15, skip: 0 }, options);
    const { skip, count } = newOptions;
    const uid = newOptions.token_id || this.token.uid;
    const historyByToken = await this.getPreProcessedData('historyByToken');
    const historyArray = uid in historyByToken ? historyByToken[uid] : [];
    const slicedHistory = historyArray.slice(skip, skip+count);
    return slicedHistory;
  }

  /**
   * Get tokens that this wallet has transactions
   *
   * @return {Promise<string[]>} Array of strings (token uid)
   *
   * @memberof HathorWallet
   * @inner
   **/
  async getTokens() {
    storage.setStore(this.store);
    return this.getPreProcessedData('tokens');
  }

  /**
   * Get a transaction data from the wallet
   *
   * @param {string} id Hash of the transaction to get data from
   *
   * @return {DecodedTx|null} Data from the transaction to get.
   *                          Can be null if the wallet does not contain the tx.
   */
  getTx(id) {
    const history = this.getFullHistory();
    if (id in history) {
      return history[id];
    } else {
      return null;
    }
  }

  /**
   * Get information of a given address
   *
   * @typedef {Object} AddressInfoOptions
   * @property {string} token Optionally filter transactions by this token uid (Default: HTR)
   *
   * @typedef {Object} AddressInfo
   * @property {number} total_amount_received Sum of the amounts received
   * @property {number} total_amount_sent Sum of the amounts sent
   * @property {number} total_amount_available Amount available to transfer
   * @property {number} total_amount_locked Amount locked and thus no available to transfer
   * @property {number} token Token used to calculate the amounts received, sent, available and locked
   * @property {number} index Derivation path for the given address
   *
   * @param {string} address Address to get information of
   * @param {AddressInfoOptions} options Optional parameters to filter the results
   *
   * @return {AddressInfo} Aggregated information about the given address
   *
   */
  getAddressInfo(address, options = {}) {
    storage.setStore(this.store);
    const { token = HATHOR_TOKEN_CONFIG.uid } = options;

    // Throws an error if the address does not belong to this wallet
    if (!this.isAddressMine(address)) {
      throw new AddressError('Address does not belong to this wallet.');
    }

    // Derivation path index
    const index = this.getAddressIndex(address);

    // All transactions for this address
    const historyTransactions = Object.values(this.getFullHistory());

    // Address information that will be calculated below
    const addressInfo = {
      total_amount_received: 0,
      total_amount_sent: 0,
      total_amount_available: 0,
      total_amount_locked: 0,
      token,
      index
    };

    // Iterate through transactions
    historyTransactions.forEach(transaction => {
      // Voided transactions should be ignored
      if (transaction.is_voided) {
        return;
      };

      // Iterate through outputs
      transaction.outputs.forEach(output => {
        const is_address_valid = output.decoded && output.decoded.address === address;
        const is_token_valid = token === output.token;
        const is_authority = wallet.isAuthorityOutput(output);
        if (!is_address_valid || !is_token_valid || is_authority) {
          return;
        }

        const is_spent = output.spent_by !== null;
        // wallet.canUseUnspentTx handles locking by timelock, by blockHeight and by utxos already being used by this wallet.
        const is_locked = !wallet.canUseUnspentTx(output, transaction.height);

        addressInfo.total_amount_received += output.value;

        if (is_spent) {
          addressInfo.total_amount_sent += output.value;
          return;
        }

        if (is_locked) {
          addressInfo.total_amount_locked += output.value;
        } else {
          addressInfo.total_amount_available += output.value;
        }
      });
    });

    return addressInfo;
  }

  /**
   * Get utxos of the wallet addresses
   *
   * @typedef {Object} UtxoOptions
   * @property {number} max_utxos - Maximum number of utxos to aggregate. Default to MAX_INPUTS (255).
   * @property {string} token - Token to filter the utxos. If not sent, we select only HTR utxos.
   * @property {string} filter_address - Address to filter the utxos.
   * @property {number} amount_smaller_than - Maximum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount lower than this value. Integer representation of decimals, i.e. 100 = 1.00.
   * @property {number} amount_bigger_than - Minimum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount bigger than this value. Integer representation of decimals, i.e. 100 = 1.00.
   * @property {number} maximum_amount - Limit the maximum total amount to consolidate summing all utxos. Integer representation of decimals, i.e. 100 = 1.00.
   * @property {boolean} only_available_utxos - Use only available utxos (not locked)
   *
   * @typedef {Object} UtxoDetails
   * @property {number} total_amount_available - Maximum number of utxos to aggregate. Default to MAX_INPUTS (255).
   * @property {number} total_utxos_available - Token to filter the utxos. If not sent, we select only HTR utxos.
   * @property {number} total_amount_locked - Address to filter the utxos.
   * @property {number} total_utxos_locked - Maximum limit of utxo amount to filter the utxos list. We will consolidate only utxos that have an amount lower than this value. Integer representation of decimals, i.e. 100 = 1.00.
   * @property {{ address: string, amount: number, tx_id: string, locked: boolean, index: number }[]} utxos - Array of utxos
   *
   * @param {UtxoOptions} options Utxo filtering options
   *
   * @return {UtxoDetails} Utxos and meta information about it
   *
   */
  getUtxos(options = {}) {
    storage.setStore(this.store);
    const historyTransactions = Object.values(this.getFullHistory());
    const utxoDetails = {
      total_amount_available: 0,
      total_utxos_available: 0,
      total_amount_locked: 0,
      total_utxos_locked: 0,
      utxos: [],
    };

    // Iterate through transactions
    for (let i = 0; i < historyTransactions.length; i++) {
      const transaction = historyTransactions[i];

      // Voided transactions should be ignored
      if (transaction.is_voided) continue;

      // Iterate through outputs
      for (let j = 0; j < transaction.outputs.length; j++) {
        const output = transaction.outputs[j];

        const is_unspent = output.spent_by === null;
        // wallet.canUseUnspentTx handles locking by timelock, by blockHeight and by utxos already being used by this wallet.
        const locked = !wallet.canUseUnspentTx(output, transaction.height);
        const is_mine = this.isAddressMine(output.decoded.address);
        if (!is_unspent || (locked && options.only_available_utxos) || !is_mine) {
          // No other filtering required
          continue;
        }

        const filters = wallet.filterUtxos(output, utxoDetails, options);
        const is_authority = wallet.isAuthorityOutput(output);

        // Max amount reached, continue to find a smaller amount
        if (!filters.is_max_amount_valid) {
          continue;
        }

        // Max utxos.length reached, no more utxo should be added
        if (!filters.is_max_utxos_valid) {
          return utxoDetails;
        }

        if (filters.is_all_filters_valid && !is_authority) {
          utxoDetails.utxos.push({
            address: output.decoded.address,
            amount: output.value,
            tx_id: transaction.tx_id,
            locked,
            index: j,
          });
          if (!locked) {
            utxoDetails.total_utxos_available++;
            utxoDetails.total_amount_available += output.value;
          } else {
            utxoDetails.total_utxos_locked++;
            utxoDetails.total_amount_locked += output.value;
          }
        }
      }
    }

    return utxoDetails;
  }

  /**
   * Prepare all required data to consolidate utxos.
   *
   * @typedef {Object} PrepareConsolidateUtxosDataResult
   * @property {{ address: string, value: number }[]} outputs - Destiny of the consolidated utxos
   * @property {{ hash: string, index: number }[]} inputs - Inputs for the consolidation transaction
   * @property {{ uid: string, name: string, symbol: string }} token - HTR or custom token
   * @property {{ address: string, amount: number, tx_id: string, locked: boolean, index: number }[]} utxos - Array of utxos that will be consolidated
   * @property {number} total_amount - Amount to be consolidated
   *
   * @param {string} destinationAddress Address of the consolidated utxos
   * @param {UtxoOptions} options Utxo filtering options
   *
   * @return {PrepareConsolidateUtxosDataResult} Required data to consolidate utxos
   *
   */
  prepareConsolidateUtxosData(destinationAddress, options = {}) {
    storage.setStore(this.store);
    const utxoDetails = this.getUtxos({ ...options, only_available_utxos: true });
    const inputs = [];
    const utxos = [];
    let total_amount = 0;
    for (let i = 0; i < utxoDetails.utxos.length; i++) {
      if (inputs.length === transaction.getMaxInputsConstant()) {
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
    const outputs = [{
      address: destinationAddress,
      value: total_amount,
      token: options.token || HATHOR_TOKEN_CONFIG.uid
    }];

    return { outputs, inputs, utxos, total_amount };
  }

  /**
   * Consolidates many utxos into a single one for either HTR or exactly one custom token.
   *
   * @typedef {Object} ConsolidationResult
   * @property {number} total_utxos_consolidated - Number of utxos consolidated
   * @property {number} total_amount - Consolidated amount
   * @property {number} tx_id - Consolidated transaction id
   * @property {{ address: string, amount: number, tx_id: string, locked: boolean, index: number }[]} utxos - Array of consolidated utxos
   *
   * @param {string} destinationAddress Address of the consolidated utxos
   * @param {UtxoOptions} options Utxo filtering options
   *
   * @return {Promise<ConsolidationResult>} Indicates that the transaction is sent or not
   *
   */
  async consolidateUtxos(destinationAddress, options = {}) {
    if (this.isFromXPub()) {
      throw new WalletFromXPubGuard('consolidateUtxos');
    }
    storage.setStore(this.store);
    const { outputs, inputs, utxos, total_amount } = this.prepareConsolidateUtxosData(destinationAddress, options);

    if (!this.isAddressMine(destinationAddress)) {
      throw new Error('Utxo consolidation to an address not owned by this wallet isn\'t allowed.');
    }

    if (inputs.length === 0) {
      throw new Error("No available utxo to consolidate.");
    }

    const tx = await this.sendManyOutputsTransaction(outputs, { inputs });

    return {
      total_utxos_consolidated: utxos.length,
      total_amount,
      txId: tx.hash,
      utxos,
    };
  }

  /**
   * Get balance for a token (same as old method to be used for compatibility)
   *
   * @params {string} tokenUid Token uid
   *
   * @return {Object} Object with balance { available, locked }
   *
   * @memberof HathorWallet
   * @inner
   **/
  _getBalanceRaw(tokenUid) {
    storage.setStore(this.store);
    const uid = tokenUid || this.token.uid;
    const historyTransactions = this.getFullHistory();
    return wallet.calculateBalance(Object.values(historyTransactions), uid);
  }

  /**
   * @typedef DecodedTx
   * @property {string} tx_id
   * @property {number} version
   * @property {number} weight
   * @property {number} timestamp
   * @property {boolean} is_voided
   * @property {{
   *   value: number,
   *   token_data: number,
   *   script: string,
   *   decoded: { type: string, address: string, timelock: number|null },
   *   token: string,
   *   tx_id: string,
   *   index: number
   * }[]} inputs
   * @property {{
   *   value: number,
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
   * @return {Record<string,DecodedTx>} Object with transaction data { tx_id: { full_transaction_data }}
   *
   * @memberof HathorWallet
   * @inner
   **/
  getFullHistory() {
    storage.setStore(this.store);
    const data = wallet.getWalletData();
    const history = 'historyTransactions' in data ? data['historyTransactions'] : {};
    return history;
  }

  /**
   * Prepare history and balance and save on a cache object
   * to be used as pre processed data
   *
   * @memberof HathorWallet
   * @inner
   **/
  async preProcessWalletData() {
    storage.setStore(this.store);
    const transactionCountByToken = {};
    const history = this.getFullHistory();
    const tokensHistory = {};
    // iterate through all txs received and map all tokens this wallet has, with
    // its history and balance
    for (const tx of Object.values(history)) {
      // we first get all tokens present in this tx (that belong to the user) and
      // the corresponding balances
      /* eslint-disable no-await-in-loop */
      const balances = await this.getTxBalance(tx, { includeAuthorities: true });
      for (const [tokenUid, tokenTxBalance] of Object.entries(balances)) {
        let tokenHistory = tokensHistory[tokenUid];
        if (tokenHistory === undefined) {
          tokenHistory = [];
          tokensHistory[tokenUid] = tokenHistory;
        }
        // add this tx to the history of the corresponding token
        tokenHistory.push({
          txId: tx.tx_id,
          timestamp: tx.timestamp,
          tokenUid,
          balance: tokenTxBalance,
          voided: tx.is_voided,
        });
      }

      const tokensSeen = [];
      for (const el of [...tx.outputs, ...tx.inputs]) {
        if (this.isAddressMine(el.decoded.address) && !(el.token in tokensSeen)) {
          if (!(el.token in transactionCountByToken)) {
            transactionCountByToken[el.token] = 0;
          }
          tokensSeen.push(el.token);
          transactionCountByToken[el.token] += 1;
        }
      }
    }

    const tokensBalance = {};
    for (const tokenUid of Object.keys(tokensHistory)) {
      const totalBalance = this._getBalanceRaw(tokenUid);
      totalBalance['transactions'] = transactionCountByToken[tokenUid];
      // update token total balance
      tokensBalance[tokenUid] = totalBalance;
    }

    // in the end, sort (in place) all tx lists in descending order by timestamp
    for (const txList of Object.values(tokensHistory)) {
      txList.sort((elem1, elem2) => elem2.timestamp - elem1.timestamp);
    }

    this.setPreProcessedData('tokens', Object.keys(tokensHistory));
    this.setPreProcessedData('historyByToken', tokensHistory);
    this.setPreProcessedData('balanceByToken', tokensBalance);
  }

  /**
   * When a new tx arrives in the websocket we must update the
   * pre processed data to reflects in the methods using it
   * So we calculate the new token balance and update the history
   *
   * @param {Object} tx Full transaction object from websocket data
   * @param {boolean} isNew If the transaction is new or an update
   *
   * @memberof HathorWallet
   * @inner
   **/
  async onTxArrived(tx, isNew) {
    const tokensHistory = await this.getPreProcessedData('historyByToken');
    const tokensBalance = await this.getPreProcessedData('balanceByToken');
    // we first get all tokens present in this tx (that belong to the user) and
    // the corresponding balances
    const balances = await this.getTxBalance(tx, { includeAuthorities: true });
    for (const [tokenUid, tokenTxBalance] of Object.entries(balances)) {
      if (isNew) {
        let tokenHistory = tokensHistory[tokenUid];
        if (tokenHistory === undefined) {
          // If it's a new token
          tokenHistory = [];
          tokensHistory[tokenUid] = tokenHistory;
        }

        // add this tx to the history of the corresponding token
        tokenHistory.push({
          txId: tx.tx_id,
          timestamp: tx.timestamp,
          tokenUid,
          balance: tokenTxBalance,
          voided: tx.is_voided,
        });

        // in the end, sort (in place) all tx lists in descending order by timestamp
        tokenHistory.sort((elem1, elem2) => elem2.timestamp - elem1.timestamp);
      } else {
        const currentHistory = tokensHistory[tokenUid];
        const txIndex = currentHistory.findIndex((el) => el.tx_id === tx.tx_id);

        const newHistory = [...currentHistory];
        newHistory[txIndex] = {
          txId: tx.tx_id,
          timestamp: tx.timestamp,
          tokenUid,
          balance: tokenTxBalance,
          voided: tx.is_voided,
        };
        tokensHistory[tokenUid] = newHistory;
      }

      // Update token balance
      const totalBalance = this._getBalanceRaw(tokenUid);
      if (tokenUid in tokensBalance) {
        totalBalance['transactions'] = tokensBalance[tokenUid].transactions + 1;
      } else {
        totalBalance['transactions'] = 1;
      }
      // update token total balance
      tokensBalance[tokenUid] = totalBalance;
    }

    this.setPreProcessedData('tokens', Object.keys(tokensHistory));
    this.setPreProcessedData('historyByToken', tokensHistory);
    this.setPreProcessedData('balanceByToken', tokensBalance);
  }

  /**
   * Set data in the pre processed object
   *
   * @param {string} key Key of the pre processed object to be added
   * @param {Any} value Value of the pre processed object to be added
   *
   * @memberof HathorWallet
   * @inner
   **/
  setPreProcessedData(key, value) {
    this.preProcessedData[key] = value;
  }

  /**
   * Get data in the pre processed object
   * If pre processed data is empty, we generate it and return
   *
   * @param {string} key Key of the pre processed object to get the value
   *
   * @return {Any} Value of the pre processed object
   *
   * @memberof HathorWallet
   * @inner
   **/
  async getPreProcessedData(key) {
    if (Object.keys(this.preProcessedData).length === 0) {
      await this.preProcessWalletData();
    }
    return this.preProcessedData[key];
  }

  setState(state) {
    if (state === HathorWallet.READY && state !== this.state) {
      // Became ready now, so we prepare new localStorage data
      // to support using this facade interchangable with wallet service
      // facade in both wallets

      // Notice: preProcessWalletData is currently async because `getTxBalance`
      // is async but it resolves instantly -- we only changed `getTxBalance` to async
      // to match signatures with the new facade. If we ever need to do something really
      // async on preProcessWalletData and wait for it before setting state to READY, we
      // probably should refactor setState to be async
      this.preProcessWalletData();
    }
    this.state = state;
    this.emit('state', state);
  }

  onNewTx(wsData) {
    storage.setStore(this.store);
    const newTx = wsData.history;

    // TODO we also have to update some wallet lib data? Lib should do it by itself
    const walletData = wallet.getWalletData();
    const historyTransactions = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
    const allTokens = 'allTokens' in walletData ? walletData.allTokens : [];

    let isNewTx = true;
    if (newTx.tx_id in historyTransactions) {
      isNewTx = false;
    }

    wallet.updateHistoryData(historyTransactions, allTokens, [newTx], null, walletData, null, this.conn, this.store);

    this.onTxArrived(newTx, isNewTx);

    if (isNewTx) {
      this.emit('new-tx', newTx);
    } else {
      this.emit('update-tx', newTx);
    }
    return;
  };

  /**
   * Send a transaction with a single output
   *
   * @param {string} address Output address
   * @param {Number} value Output value
   * @param [options] Options parameters
   * @param {string} [options.changeAddress] address of the change output
   * @param {string} [options.token] token uid
   *
   * @return {Promise<Transaction>} Promise that resolves when transaction is sent
   **/
  async sendTransaction(address, value, options = {}) {
    if (this.isFromXPub()) {
      throw new WalletFromXPubGuard('sendTransaction');
    }
    const newOptions = Object.assign({
      token: '00',
      changeAddress: null
    }, options);
    const { token, changeAddress } = newOptions;
    const outputs = [{ address, value, token }];
    return this.sendManyOutputsTransaction(outputs, { inputs: [], changeAddress });
  }

  /**
   * Send a transaction from its outputs
   *
   * @param {{
   *   address: string,
   *   value: number,
   *   timelock?: number,
   *   token: string
   * }[]} outputs Array of proposed outputs
   * @param [options]
   * @param {{
   *   txId: string,
   *   index: number,
   *   token: string
   * }[]} [options.inputs] Array of proposed inputs
   * @param {string} [options.changeAddress] address of the change output
   * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
   * @param {string} [options.pincode] pin to decrypt xpriv information.
   *                                   Optional but required if not set in this
   *
   * @return {Promise<Transaction>} Promise that resolves when transaction is sent
   **/
  async sendManyOutputsTransaction(outputs, options = {}) {
    if (this.isFromXPub()) {
      throw new WalletFromXPubGuard('sendManyOutputsTransaction');
    }
    storage.setStore(this.store);
    const newOptions = Object.assign({
      inputs: [],
      changeAddress: null,
      startMiningTx: true,
      pinCode: null
    }, options);

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      return {success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED};
    }
    const { inputs, changeAddress } = newOptions;
    const sendTransaction = new SendTransaction({
      outputs,
      inputs,
      changeAddress,
      pin,
      network: this.getNetworkObject()
    });
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
   **/
  start(optionsParams = {}) {
    const options = Object.assign({ pinCode: null, password: null }, optionsParams);
    const pinCode = options.pinCode || this.pinCode;
    const password = options.password || this.password;
    if (!this.xpub && !pinCode) {
      return Promise.reject({success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED});
    }

    if (this.seed && !password) {
      return Promise.reject({success: false, message: 'Password is required.', error: 'PASSWORD_REQUIRED'});
    }
    storage.setStore(this.store);
    storage.setItem('wallet:server', this.conn.currentServer);
    storage.setItem('wallet:multisig', !!this.multisig);

    this.conn.on('state', this.onConnectionChangedState);
    this.conn.on('wallet-update', this.handleWebsocketMsg);

    let ret;
    if (this.seed) {
      ret = wallet.executeGenerateWallet(this.seed, this.passphrase, pinCode, password, false, this.multisig);
    } else if (this.xpriv) {
      ret = wallet.executeGenerateWalletFromXPriv(this.xpriv, pinCode, false, this.multisig);
    } else if (this.xpub) {
      ret = wallet.executeGenerateWalletFromXPub(this.xpub, false, this.multisig);
    } else {
      throw "This should never happen";
    }
    if (ret !== null) {
      throw "This should never happen";
    }

    this.clearSensitiveData();
    this.getTokenData();
    this.serverInfo = null;
    this.walletStopped = false;
    this.setState(HathorWallet.CONNECTING);

    const promise = new Promise((resolve, reject) => {
      version.checkApiVersion().then((info) => {
        // Check network version to avoid blunders.
        if (info.network.indexOf(this.conn.network) >= 0) {
          this.serverInfo = info;
          this.conn.start();
          resolve(info);
        } else {
          this.setState(HathorWallet.CLOSED);
          reject(`Wrong network. server=${info.network} expected=${this.conn.network}`);
        }
      }, (error) => {
        this.setState(HathorWallet.CLOSED);
        reject(error);
      });
    });
    return promise;
  }

  /**
   * Close the connections and stop emitting events.
   **/
  stop({ cleanStorage = true } = {}) {
    storage.setStore(this.store);
    this.setState(HathorWallet.CLOSED);
    this.removeAllListeners();

    if (cleanStorage) {
      wallet.cleanWallet({ endConnection: false, connection: this.conn });
    }

    this.serverInfo = null;
    this.firstConnection = true;
    this.walletStopped = true;
    this.conn.stop()
  }

  /**
   * Create SendTransaction object and run from mining
   * Returns a promise that resolves when the send succeeds
   *
   * @param {Transaction} transaction Transaction object to be mined and pushed to the network
   *
   * @return {Promise} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   */
  async handleSendPreparedTransaction(transaction) {
    const sendTransaction = new SendTransaction({ transaction, network: this.getNetworkObject() });
    return sendTransaction.runFromMining();
  }

  /**
   * Prepare create token transaction data before mining
   *
   * @param {Transaction} transaction Transaction object to be mined and pushed to the network
   *
   * @param {string} name Name of the token
   * @param {string} symbol Symbol of the token
   * @param {number} amount Quantity of the token to be minted
   * @param {Object} options Options parameters
   *  {
   *   'address': address of the minted token,
   *   'changeAddress': address of the change output,
   *   'startMiningTx': boolean to trigger start mining (default true)
   *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
   *   'createMint': if should create mint authority when creating the token
   *   'createMelt': if should create melt authority when creating the token
   *   'nftData': data string for NFT
   *  }
   *
   * @return {Promise} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   */
  async prepareCreateNewToken(name, symbol, amount, options = {}) {
    if (this.isFromXPub()) {
      throw new WalletFromXPubGuard('createNewToken');
    }
    storage.setStore(this.store);
    const newOptions = Object.assign({
      address: null,
      changeAddress: null,
      startMiningTx: true,
      pinCode: null,
      createMint: true,
      createMelt: true,
      nftData: null
    }, options);
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      return Promise.reject({success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED});
    }
    const mintAddress = newOptions.address || this.getCurrentAddress().address;

    const ret = tokens.generateCreateTokenData(mintAddress, name, symbol, amount, pin, newOptions);

    if (!ret.success) {
      return Promise.reject(ret);
    }

    return helpers.createTxFromData(ret.preparedData, this.getNetworkObject());
  }

  /**
   * @typedef BaseTransactionResponse
   * @property {{hash:string, index:number, data:Buffer}[]} inputs
   * @property {{value:number, script:Buffer, tokenData:number, decodedScript:*}[]} outputs
   * @property {number} version
   * @property {number} weight
   * @property {number} nonce
   * @property {number} timestamp
   * @property {string[]} parents
   * @property {string[]} tokens
   * @property {string} hash
   * @property {*} _dataToSignCache
   */

  /**
   * @typedef CreateNewTokenResponse
   * @extends BaseTransactionResponse
   * @property {string} name
   * @property {string} symbol
   */

  /**
   * Create a new token for this wallet
   *
   * @param {string} name Name of the token
   * @param {string} symbol Symbol of the token
   * @param {number} amount Quantity of the token to be minted
   * @param [options] Options parameters
   * @param {string} [options.address] address of the minted token
   * @param {string} [options.changeAddress] address of the change output
   * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
   * @param {string} [options.pinCode] pin to decrypt xpriv information.
   *                                   Optional but required if not set in this
   *
   * @return {Promise<CreateNewTokenResponse>}
   * @memberof HathorWallet
   * @inner
   **/
  async createNewToken(name, symbol, amount, options = {}) {
    const tx = await this.prepareCreateNewToken(name, symbol, amount, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Select authority utxo for mint or melt. Depends on the callback received as parameter
   * We could add an {options} parameter to allow common filters (e.g. mint authority, melt authority, p2pkh) to improve this method later.
   *
   * @param {string} tokenUid UID of the token to select the authority utxo
   * @param {function} filterUTXOs Callback to check if the output is the authority I want (isMeltOutput or isMintOutput)
   * @param {Object} options Object with custom options.
   *  {
   *    'many': if should return many utxos or just one (default false),
   *    'skipSpent': if should not include spent utxos (default true)
   *  }
   *
   * @return {Array|null} Array of objects with {tx_id, index, address, authorities} of the authority output. Returns null in case there are no utxos for this type
   **/
  selectAuthorityUtxo(tokenUid, filterUTXOs, options = {}) {
    const newOptions = Object.assign({many: false, skipSpent: true}, options);
    const { many, skipSpent } = newOptions;
    const utxos = [];
    const walletData = wallet.getWalletData();
    for (const tx_id in walletData.historyTransactions) {
      const tx = walletData.historyTransactions[tx_id];
      if (tx.is_voided) {
        // Ignore voided transactions.
        continue;
      }

      for (const [index, output] of tx.outputs.entries()) {
        // This output is not mine
        if (!wallet.isAddressMine(output.decoded.address, walletData)) {
          continue;
        }

        // This token is not the one we are looking
        if (output.token !== tokenUid) {
          continue;
        }

        // If output was already used, we can't use it, unless requested in options
        if (output.spent_by && skipSpent) {
          continue;
        }

        if (!filterUTXOs(output)) {
          continue;
        }

        const ret = {tx_id, index, address: output.decoded.address, authorities: output.value};

        if (many) {
          // If many we push to the array to be returned later
          utxos.push(ret);
        } else {
          return [ret];
        }
      }
    }

    if (many) {
      return utxos;
    }
    return null;
  }

  /**
   * Transforms a list of transaction outputs to a list with the expected object format from the wallets
   *
   * @param {Array} txOutputs The list of tx_outputs to format
   *
   * @return {Array} Array of objects with {txId, index, address, authorities}. Returns an empty array in case there are no tx_outupts on the input parameter
   **/
  _formatTxOutputs(txOutputs) {
    if (!txOutputs) {
      return [];
    }

    return txOutputs.map((txOutput) => ({
      txId: txOutput.tx_id,
      index: txOutput.index,
      address: txOutput.address,
      authorities: txOutput.authorities,
    }));
  }

  /**
   * Get mint authorities
   * This is a helper method to call selectAuthorityUtxo without knowledge of the isMintOutput
   *
   * @param {string} tokenUid UID of the token to select the authority utxo
   * @param [options] Object with custom options.
   * @param {boolean} [options.many=false] if should return many utxos or just one (default false)
   * @param {boolean} [options.skipSpent=true] if should not include spent utxos (default true)
   *
   * @return {Promise<{
   *   txId: string,
   *   index: number,
   *   address: string,
   *   authorities: number
   * }[]>} Promise that resolves with an Array of objects with properties of the authority output.
   *       Returns an empty array in case there are no tx_outupts for this type.
   **/
  async getMintAuthority(tokenUid, options = {}) {
    const newOptions = Object.assign({many: false, skipSpent: true}, options);
    const txOutputs = this.selectAuthorityUtxo(tokenUid, wallet.isMintOutput.bind(wallet), newOptions);

    return this._formatTxOutputs(txOutputs);
  }

  /**
   * Get melt authorities
   * This is a helper method to call selectAuthorityUtxo without knowledge of the isMeltOutput
   *
   * @param {string} tokenUid UID of the token to select the authority utxo
   * @param [options] Object with custom options.
   * @param {boolean} [options.many=false] if should return many utxos or just one (default false)
   * @param {boolean} [options.skipSpent=true] if should not include spent utxos (default true)
   *
   * @return {Promise<{
   *   txId: string,
   *   index: number,
   *   address: string,
   *   authorities: number
   * }[]>} Promise that resolves with an Array of objects with properties of the authority output.
   *       Returns an empty array in case there are no tx_outupts for this type.
   **/
  async getMeltAuthority(tokenUid, options = {}) {
    const newOptions = Object.assign({many: false, skipSpent: true}, options);
    const txOutputs = this.selectAuthorityUtxo(tokenUid, wallet.isMeltOutput.bind(wallet), newOptions);

    return this._formatTxOutputs(txOutputs);
  }

  /**
   * Prepare mint transaction before mining
   *
   * @param {string} tokenUid UID of the token to mint
   * @param {number} amount Quantity to mint
   * @param {Object} options Options parameters
   *  {
   *   'address': destination address of the minted token
   *   'changeAddress': address of the change output
   *   'startMiningTx': boolean to trigger start mining (default true)
   *   'createAnotherMint': boolean to create another mint authority or not for the wallet
   *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
   *  }
   *
   * @return {Promise} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   **/
  async prepareMintTokensData(tokenUid, amount, options = {}) {
    if (this.isFromXPub()) {
      throw new WalletFromXPubGuard('mintTokens');
    }
    storage.setStore(this.store);
    const newOptions = Object.assign({
      address: null,
      changeAddress: null,
      createAnotherMint: true,
      startMiningTx: true,
      pinCode: null,
    }, options);

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      return Promise.reject({success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED});
    }

    const mintAddress = newOptions.address || this.getCurrentAddress().address;
    const mintInput = this.selectAuthorityUtxo(tokenUid, wallet.isMintOutput.bind(wallet));

    if (!mintInput || mintInput.length === 0) {
      return {success: false, message: 'Don\'t have mint authority output available.'}
    }

    const ret = tokens.generateMintData(mintInput[0], tokenUid, mintAddress, amount, null, pin, newOptions);
    if (!ret.success) {
      return Promise.reject(ret);
    }

    return helpers.createTxFromData(ret.preparedData, this.getNetworkObject());
  }

  /**
   * Mint tokens
   *
   * @param {string} tokenUid UID of the token to mint
   * @param {number} amount Quantity to mint
   * @param [options] Options parameters
   * @param {string} [options.address] destination address of the minted token
   *                                   (if not sent we choose the next available address to use)
   * @param {string} [options.changeAddress] address of the change output
   *                                   (if not sent we choose the next available address to use)
   * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
   * @param {boolean} [options.createAnotherMint] boolean to create another mint authority or not
   *                                              for the wallet
   * @param {string} [options.pinCode] pin to decrypt xpriv information.
   *                                   Optional but required if not set in this
   *
   * @return {Promise<BaseTransactionResponse>} Promise that resolves with transaction object
   *                                           if it succeeds or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   **/
  async mintTokens(tokenUid, amount, options = {}) {
    const tx = await this.prepareMintTokensData(tokenUid, amount, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare melt transaction before mining
   *
   * @param {string} tokenUid UID of the token to melt
   * @param {number} amount Quantity to melt
   * @param {Object} options Options parameters
   *  {
   *   'address': address of the HTR deposit back
   *   'changeAddress': address of the change output
   *   'createAnotherMelt': boolean to create another melt authority or not for the wallet
   *   'startMiningTx': boolean to trigger start mining (default true)
   *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
   *  }
   *
   * @return {Promise} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   **/
  async prepareMeltTokensData(tokenUid, amount, options = {}) {
    if (this.isFromXPub()) {
      throw new WalletFromXPubGuard('meltTokens');
    }
    storage.setStore(this.store);
    const newOptions = Object.assign({
      address: null,
      changeAddress: null,
      createAnotherMelt: true,
      startMiningTx: true,
      pinCode: null,
    }, options);

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      return Promise.reject({success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED});
    }

    const meltInput = this.selectAuthorityUtxo(tokenUid, wallet.isMeltOutput.bind(wallet));

    if (!meltInput || meltInput.length === 0) {
      return Promise.reject({success: false, message: 'Don\'t have melt authority output available.'});
    }

    // Always create another melt authority output
    const ret = tokens.generateMeltData(meltInput[0], tokenUid, amount, pin, newOptions.createAnotherMelt, { depositAddress: newOptions.address, changeAddress: newOptions.changeAddress });
    if (!ret.success) {
      return Promise.reject(ret);
    }

    return helpers.createTxFromData(ret.preparedData, this.getNetworkObject());
  }

  /**
   * Melt tokens
   *
   * @param {string} tokenUid UID of the token to melt
   * @param {number} amount Quantity to melt
   * @param [options] Options parameters
   * @param {string} [options.address]: address of the HTR deposit back
   * @param {string} [options.changeAddress] address of the change output
   * @param {boolean} [options.createAnotherMelt] boolean to create another melt authority or not
   *                                              for the wallet
   * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
   * @param {string} [options.pinCode] pin to decrypt xpriv information.
   *                                   Optional but required if not set in this
   *
   * @return {Promise<BaseTransactionResponse>} Promise that resolves with transaction object
   *                                            if it succeeds or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   **/
  async meltTokens(tokenUid, amount, options = {}) {
    const tx = await this.prepareMeltTokensData(tokenUid, amount, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare delegate authority transaction before mining
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {string} type Type of the authority to delegate 'mint' or 'melt'
   * @param {string} destinationAddress Destination address of the delegated authority
   * @param {Object} options Options parameters
   *  {
   *   'createAnother': if should create another authority for the wallet. Default to true
   *   'startMiningTx': boolean to trigger start mining (default true)
   *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
   *  }
   *
   * @return {Promise} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   **/
  async prepareDelegateAuthorityData(tokenUid, type, destinationAddress, options = {}) {
    if (this.isFromXPub()) {
      throw new WalletFromXPubGuard('delegateAuthority');
    }
    storage.setStore(this.store);
    const newOptions = Object.assign({ createAnother: true, startMiningTx: true, pinCode: null }, options);
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      return Promise.reject({success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED});
    }
    const { createAnother, startMiningTx } = newOptions;
    let filterUtxos;
    if (type === 'mint') {
      filterUtxos = wallet.isMintOutput.bind(wallet);
    } else if (type === 'melt') {
      filterUtxos = wallet.isMeltOutput.bind(wallet);
    } else {
      throw new Error('This should never happen.')
    }

    const delegateInput = this.selectAuthorityUtxo(tokenUid, filterUtxos);

    if (delegateInput.length === 0) {
      return Promise.reject({success: false, message: ErrorMessages.NO_UTXOS_AVAILABLE});
    }

    const { tx_id, index, address } = delegateInput[0];

    const ret = tokens.generateDelegateAuthorityData(tx_id, index, address, tokenUid, destinationAddress, createAnother, type, pin);

    if (!ret.success) {
      return Promise.reject(ret);
    }

    return helpers.createTxFromData(ret.preparedData, this.getNetworkObject());
  }

  /**
   * Delegate authority
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {'mint'|'melt'} type Type of the authority to delegate 'mint' or 'melt'
   * @param {string} destinationAddress Destination address of the delegated authority
   * @param [options] Options parameters
   * @param {boolean} [options.createAnother=true] Should create another authority for the wallet.
   *                                               Default to true
   * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
   * @param {string} [options.pinCode] pin to decrypt xpriv information.
   *                                   Optional but required if not set in this
   *
   * @return {Promise<BaseTransactionResponse>} Promise that resolves with transaction object
   *                                            if it succeeds or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   **/
  async delegateAuthority(tokenUid, type, destinationAddress, options = {}) {
    const tx = await this.prepareDelegateAuthorityData(tokenUid, type, destinationAddress, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare destroy authority transaction before mining
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {string} type Type of the authority to delegate 'mint' or 'melt'
   * @param {number} count How many authority outputs to destroy
   * @param {Object} options Options parameters
   *  {
   *   'startMiningTx': boolean to trigger start mining (default true)
   *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
   *  }
   *
   * @return {Promise} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   **/
  async prepareDestroyAuthorityData(tokenUid, type, count, options = {}) {
    if (this.isFromXPub()) {
      throw new WalletFromXPubGuard('destroyAuthority');
    }
    storage.setStore(this.store);
    const newOptions = Object.assign({ startMiningTx: true, pinCode: null }, options);
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      return Promise.reject({success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED});
    }
    let filterUtxos;
    if (type === 'mint') {
      filterUtxos = wallet.isMintOutput.bind(wallet);
    } else if (type === 'melt') {
      filterUtxos = wallet.isMeltOutput.bind(wallet);
    } else {
      throw new Error('This should never happen.')
    }

    const destroyInputs = this.selectAuthorityUtxo(tokenUid, filterUtxos, { many: true });

    if (destroyInputs.length < count) {
      return Promise.reject({ success: false, message: ErrorMessages.NO_UTXOS_AVAILABLE, errorData: { requestedQuantity: count, availableQuantity: destroyInputs.length } });
    }

    const data = [];
    for (const utxo of destroyInputs) {
      const { tx_id, address, index } = utxo;
      data.push({ tx_id, address, index, token: tokenUid });
      // Even though count is expected as a number, I am using ==
      // in case someone sends a string in the future
      if (data.length >= count) {
        break;
      }
    }

    const ret = tokens.generateDestroyAuthorityData(data, pin);
    if (!ret.success) {
      return Promise.reject(ret);
    }

    return helpers.createTxFromData(ret.preparedData, this.getNetworkObject());
  }

  /**
   * Destroy authority
   *
   * @param {string} tokenUid UID of the token to destroy the authority
   * @param {'mint'|'melt'} type Type of the authority to destroy: 'mint' or 'melt'
   * @param {number} count How many authority outputs to destroy
   * @param [options] Options parameters
   * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
   * @param {string} [options.pinCode] pin to decrypt xpriv information.
   *                                   Optional but required if not set in this
   *
   * @return {Promise<BaseTransactionResponse>} Promise that resolves with transaction object
   *                                            if it succeeds or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   **/
  async destroyAuthority(tokenUid, type, count, options = {}) {
    const tx = await this.prepareDestroyAuthorityData(tokenUid, type, count, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Remove sensitive data from memory
   *
   * NOTICE: This won't remove data from memory immediately, we have to wait until javascript
   * garbage collect it. JavaScript currently does not provide a standard way to trigger
   * garbage collection
   **/
  clearSensitiveData() {
    this.xpriv = undefined;
    this.seed = undefined;
  }

  /**
   * Get all authorities utxos for specific token
   *
   * @param {string} tokenUid UID of the token to delegate the authority
   * @param {string} type Type of the authority to delegate 'mint' or 'melt'
   *
   * @return {Array} Array of objects with {tx_id, index, address} of the authority output.
   **/
  getAuthorityUtxos(tokenUid, type) {
    storage.setStore(this.store);
    let filterUtxos;
    if (type === 'mint') {
      filterUtxos = wallet.isMintOutput.bind(wallet);
    } else if (type === 'melt') {
      filterUtxos = wallet.isMeltOutput.bind(wallet);
    } else {
      throw new Error('This should never happen.')
    }

    return this.selectAuthorityUtxo(tokenUid, filterUtxos, { many: true });
  }

  getTokenData() {
    storage.setStore(this.store);
    if (this.tokenUid === HATHOR_TOKEN_CONFIG.uid) {
      // Hathor token we don't get from the full node
      this.token = HATHOR_TOKEN_CONFIG;
    } else {
      // Get token info from full node
      // XXX This request might take longer than the ws connection to start
      // so it's possible (but hard to happen) that the wallet will change to
      // READY state with token still null.
      // I will keep it like that for now but to protect from this
      // we should change to READY only after both things finish
      walletApi.getGeneralTokenInfo(this.tokenUid, (response) => {
        if (response.success) {
          this.token = {
            uid: this.tokenUid,
            name: response.name,
            symbol: response.symbol,
          }
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
  async getTokenDetails(tokenId) {
    const result = await new Promise((resolve) => {
      return walletApi.getGeneralTokenInfo(tokenId, resolve);
    });

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
   * @return {boolean}
   **/
  isAddressMine(address) {
    return wallet.isAddressMine(address);
  }

  /**
   * Get index of address
   * Returns null if address does not belong to the wallet
   *
   * @param {string} address Address to get the index
   *
   * @return {Number}
   **/
  getAddressIndex(address) {
    return wallet.getAddressIndex(address);
  }

  /**
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
   **/
  async getTxBalance(tx, optionsParam = {}) {
    const options = Object.assign({ includeAuthorities: false }, optionsParam)
    storage.setStore(this.store);
    const addresses = this._getAllAddressesRaw();
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
   * Return the addresses of the tx that belongs to this wallet
   * The address might be in the input or output
   * Removes duplicates
   *
   * @param {Object} tx Transaction data with array of inputs and outputs
   *
   * @return {Set} Set of strings with addresses
   **/
  getTxAddresses(tx) {
    storage.setStore(this.store);
    const addresses = new Set();
    for (const txout of tx.outputs) {
      if (txout.decoded && txout.decoded.address && this.isAddressMine(txout.decoded.address)) {
        addresses.add(txout.decoded.address);
      }
    }

    for (const txin of tx.inputs) {
      if (txin.decoded && txin.decoded.address && this.isAddressMine(txin.decoded.address)) {
        addresses.add(txin.decoded.address);
      }
    }

    return addresses;
  }

  /**
   * Create an NFT for this wallet
   *
   * @param {string} name Name of the token
   * @param {string} symbol Symbol of the token
   * @param {number} amount Quantity of the token to be minted
   * @param {string} data NFT data string
   * @param [options] Options parameters
   * @param {string} [options.address] address of the minted token,
   * @param {string} [options.changeAddress] address of the change output,
   * @param {boolean} [options.startMiningTx=true] boolean to trigger start mining (default true)
   * @param {string} [options.pinCode] pin to decrypt xpriv information.
   *                                   Optional but required if not set in this
   * @param {boolean} [options.createMint=false] should create mint authority
   * @param {boolean} [options.createMelt=false] should create melt authority
   *
   * @return {Promise<CreateNewTokenResponse>}
   *
   * @memberof HathorWallet
   * @inner
   **/
  async createNFT(name, symbol, amount, data, options = {}) {
    const newOptions = Object.assign({
      address: null,
      changeAddress: null,
      startMiningTx: true,
      pinCode: null,
      createMint: false,
      createMelt: false,
    }, options);
    newOptions['nftData'] = data;
    const tx = await this.prepareCreateNewToken(name, symbol, amount, newOptions);
    return this.handleSendPreparedTransaction(tx);
  }
}

// State constants.
HathorWallet.CLOSED =  0;
HathorWallet.CONNECTING = 1;
HathorWallet.SYNCING = 2;
HathorWallet.READY = 3;
HathorWallet.ERROR = 4;

export default HathorWallet;
