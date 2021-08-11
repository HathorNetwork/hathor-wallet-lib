/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import wallet from '../wallet';
import { HATHOR_TOKEN_CONFIG, HATHOR_BIP44_CODE } from "../constants";
import tokens from '../tokens';
import transaction from '../transaction';
import version from '../version';
import walletApi from '../api/wallet';
import storage from '../storage';
import helpers from '../utils/helpers';
import MemoryStore from '../memory_store';
import Connection from './connection';
import SendTransaction from './sendTransaction';
import { AddressError } from '../errors';
import { ErrorMessages } from '../errorMessages';

const ERROR_MESSAGE_PIN_REQUIRED = 'Pin is required.';
const ERROR_CODE_PIN_REQUIRED = 'PIN_REQUIRED';

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
  /*
   * connection {Connection} A connection to the server
   * seed {String} 24 words separated by space
   * passphrase {String} Wallet passphrase
   * tokenUid {String} UID of the token to handle on this wallet
   * password {String} Password to encrypt the seed
   * pin {String} PIN to execute wallet actions
   */
  constructor({
    connection,

    store,

    seed,
    passphrase = '',

    xpriv,

    tokenUid = HATHOR_TOKEN_CONFIG.uid,

    password = null,
    pinCode = null,

    // debug mode
    debug = false,
    // Callback to be executed before reload data
    beforeReloadCallback = null,
  } = {}) {
    super();

    if (!connection) {
      throw Error('You must provide a connection.');
    }

    if (!seed && !xpriv) {
      throw Error('You must explicitly provide the seed or the xpriv.');
    }

    if (seed && xpriv) {
      throw Error('You cannot provide both a seed and an xpriv.');
    }

    if (xpriv && passphrase !== '') {
      throw Error('You can\'t use xpriv with passphrase.');
    }

    if (connection.state !== Connection.CLOSED) {
      throw Error('You can\'t share connections.');
    }

    this.conn = connection;
    wallet.setConnection(connection);

    this.state = HathorWallet.CLOSED;
    this.serverInfo = null;

    this.xpriv = xpriv;
    this.seed = seed;

    // tokenUid is optional so we can get the token of the wallet
    this.token = null;
    this.tokenUid = tokenUid;

    this.passphrase = passphrase;
    this.pinCode = pinCode;
    this.password = password;

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
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   *
   * @param {Number} newState Enum of new state after change
   **/
  onConnectionChangedState(newState) {
    if (newState === Connection.CONNECTED) {
      storage.setStore(this.store);
      this.setState(HathorWallet.SYNCING);

      // If it's the first connection we just load the history
      // otherwise we are reloading data, so we must execute some cleans
      // before loading the full data again
      let promise;
      if (this.firstConnection) {
        this.firstConnection = false;
        promise = wallet.loadAddressHistory(0, wallet.getGapLimit(), this.conn, this.store);
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
   * Old getAllAddresses method used to keep compatibility
   * with some methods that used to need it
   *
   * @return {Array} Array of addresses (string)
   *
   * @memberof HathorWallet
   * @inner
   **/
  getAllAddressesSimple() {
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
  async getAllAddresses() {
    storage.setStore(this.store);
    // This algorithm is bad at performance
    // but we must add the count of transactions
    // in order to replicate the same return as the new
    // wallet service facade
    // This is really fast for a normal quantity of addresses in a wallet
    const transactionsByAddress = this.getTransactionsCountByAddress();
    const addresses = wallet.getAllAddresses();
    const ret = [];
    for (const address of addresses) {
      ret.push({
        address,
        index: transactionsByAddress[address].index,
        transactions: transactionsByAddress[address].transactions,
      });
    }
    return Promise.resolve(ret);
  }

  /**
   * Auxiliar method to get the quantity of transactions by each address of the wallet
   *
   * @return {Object} {address: {index, transactions}}
   *
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
   * @params {Object} { markAsUsed } if true, we will locally mark this address as used and won't return it again to be used
   *
   * @return {Object} { address, index, addressPath }
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
    const addressPath = `m/44'/${HATHOR_BIP44_CODE}'/0'/0/${index}`;
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
   * @params {string} token
   *
   * @return {Promise<Array>} Array of balance for each token
   * {
   *   token: {id, name, symbol},
   *   balance: {unlocked. locked},
   *   transactions: number,
   *   lockExpires: number | null,
   *   tokenAuthorities: {unlocked: {mint, melt}. locked: {mint, melt}}
   * }
   *
   * @memberof HathorWallet
   * @inner
   **/
  getBalance(token = null) {
    storage.setStore(this.store);
    // TODO if token is null we should get the balance for each token I have
    // but we don't use it in the wallets, so I won't implement it
    const uid = token || this.token.uid;
    const balanceByToken = storage.getItem('old-facade:balanceByToken');
    const balance = uid in balanceByToken ? balanceByToken[uid] : { available: 0, locked: 0 };
    const history = this.getOldHistory();
    let transactions = 0;
    for (const tx of Object.values(history)) {
      for (const el of [...tx.outputs, ...tx.inputs]) {
        if (el.token === uid && this.isAddressMine(el.decoded.address)) {
          transactions += 1;
          break;
        }
      }
    }
    return Promise.resolve([{
      token: { // Getting token name and symbol is not easy, so we return empty strings
        id: uid,
        name: '',
        symbol: ''
      },
      balance: {
        unlocked: balance.available,
        locked: balance.locked,
      },
      transactions,
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
    }]);
  }

  /**
   * Get transaction history
   *
   * @params {Object} options {token_id, count, skip}
   *
   * @return {Promise<Array>} Array of balance for each token
   * {
   *   token: {id, name, symbol},
   *   balance: {unlocked. locked},
   *   transactions: number,
   *   lockExpires: number | null,
   *   tokenAuthorities: {unlocked: {mint, melt}. locked: {mint, melt}}
   * }
   *
   * @memberof HathorWallet
   * @inner
   **/
  getTxHistory(options = {}) {
    storage.setStore(this.store);
    const newOptions = Object.assign({ token_id: HATHOR_TOKEN_CONFIG.uid, count: 15, skip: 0 }, options);
    const { skip, count } = newOptions;
    const uid = newOptions.token_id || this.token.uid;
    const historyByToken = storage.getItem('old-facade:historyByToken');
    const historyArray = uid in historyByToken ? historyByToken[uid] : [];
    const slicedHistory = historyArray.slice(skip, skip+count);
    return Promise.resolve(slicedHistory);
  }

  /**
   * Get tokens that this wallet has transactions
   *
   * @return {Promise<Array>} Array of strings (token uid)
   *
   * @memberof HathorWallet
   * @inner
   **/
  getTokens() {
    storage.setStore(this.store);
    return Promise.resolve(storage.getItem('old-facade:tokens'));
  }

  /**
   * Get a transaction data from the wallet
   *
   * @param {String} id Hash of the transaction to get data from
   *
   * @return {Object} Data from the transaction to get. Can be null if the wallet does not contain the tx.
   *  'tx_id': String
   *  'version': Number
   *  'weight': Number
   *  'timestamp': Number
   *  'is_voided': boolean
   *  'inputs': Array(Object)
   *  'outputs': Array(Object)
   *  'parents': Array(String)
   */
  getTx(id) {
    const history = this.getTxHistory();
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
    const historyTransactions = Object.values(this.getTxHistory());

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
    const historyTransactions = Object.values(this.getTxHistory());
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
        hash: utxo.tx_id,
        index: utxo.index,
      });
      utxos.push(utxo);
      total_amount += utxo.amount;
    }
    const outputs = [{
      address: destinationAddress,
      value: total_amount,
    }];
    const token = {
      uid: options.token || HATHOR_TOKEN_CONFIG.uid,
      name: '',
      symbol: ''
    };

    return { outputs, inputs, token, utxos, total_amount };
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
    storage.setStore(this.store);
    const { outputs, inputs, token, utxos, total_amount } = this.prepareConsolidateUtxosData(destinationAddress, options);

    if (!this.isAddressMine(destinationAddress)) {
      throw new Error('Utxo consolidation to an address not owned by this wallet isn\'t allowed.');
    }

    if (inputs.length === 0) {
      throw new Error("No available utxo to consolidate.");
    }

    const result = this.sendManyOutputsTransaction(outputs, inputs, token);

    if (!result.success) {
      throw new Error(result.message);
    }

    const tx = await Promise.resolve(result.promise);

    return {
      total_utxos_consolidated: utxos.length,
      total_amount,
      tx_id: tx.tx_id,
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
  getOldBalance(tokenUid) {
    storage.setStore(this.store);
    const uid = tokenUid || this.token.uid;
    const historyTransactions = this.getOldHistory();
    return wallet.calculateBalance(Object.values(historyTransactions), uid);
  }

  /**
   * Get full wallet history (same as old method to be used for compatibility)
   *
   * @return {Object} Object with transaction data { tx_id: { full_transaction_data }}
   *
   * @memberof HathorWallet
   * @inner
   **/
  getOldHistory() {
    storage.setStore(this.store);
    const data = wallet.getWalletData();
    const history = 'historyTransactions' in data ? data['historyTransactions'] : {};
    return history;
  }

  /**
   * Prepare history and balance and save on storage
   * to prepare for the new signatures
   *
   * @memberof HathorWallet
   * @inner
   **/
  prepareHistoryAndBalanceByToken() {
    storage.setStore(this.store);
    const history = this.getOldHistory();
    const tokensHistory = {};
    // iterate through all txs received and map all tokens this wallet has, with
    // its history and balance
    for (const tx of Object.values(history)) {
      // we first get all tokens present in this tx (that belong to the user) and
      // the corresponding balances
      const balances = this.getTxBalance(tx);
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
          isVoided: tx.is_voided,
        });
      }
    }

    const tokensBalance = {};
    for (const tokenUid of Object.keys(tokensHistory)) {
      const totalBalance = this.getOldBalance(tokenUid);
      // update token total balance
      tokensBalance[tokenUid] = totalBalance;
    }

    // in the end, sort (in place) all tx lists in descending order by timestamp
    for (const txList of Object.values(tokensHistory)) {
      txList.sort((elem1, elem2) => elem2.timestamp - elem1.timestamp);
    }

    storage.setItem('old-facade:tokens', Object.keys(tokensHistory));
    storage.setItem('old-facade:historyByToken', tokensHistory);
    storage.setItem('old-facade:balanceByToken', tokensBalance);
  }

  setState(state) {
    if (state === HathorWallet.READY && state !== this.state) {
      // Became ready now, so we prepare new localStorage data
      // to support using this facade interchangable with wallet service
      // facade in both wallets
      this.prepareHistoryAndBalanceByToken();
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
   * @param {String} address Output address
   * @param {Number} value Output value
   * @param {Object} options Options parameters
   *  {
   *   'changeAddress': address of the change output
   *   'token': token uid
   *  }
   *
   * @return {Promise<Transaction>} Promise that resolves when transaction is sent
   **/
  sendTransaction(address, value, options = {}) {
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
   * @param {Array} outputs Array of outputs with each element as an object with {'address', 'value', 'timelock', 'token'}
   * @param {Array} inputs Array of inputs with each element as an object with {'txId', 'index', 'token'}
   * @param {Object} token Token object {'uid', 'name', 'symbol'}. Optional parameter if user already set on the class
   * @param {Object} options Options parameters
   *  {
   *   'changeAddress': address of the change output
   *   'startMiningTx': boolean to trigger start mining (default true)
   *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
   *  }
   *
   * @return {Promise<Transaction>} Promise that resolves when transaction is sent
   **/
  sendManyOutputsTransaction(outputs, options = {}) {
    storage.setStore(this.store);
    const newOptions = Object.assign({ inputs: [], changeAddress: null, startMiningTx: true, pinCode: null }, options);
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      return {success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED};
    }
    const { inputs, changeAddress } = newOptions;
    const sendTransaction = new SendTransaction({ outputs, inputs, changeAddress, pin });
    const promise = new Promise((resolve, reject) => {
      sendTransaction.on('send-tx-success', (transaction) => {
        resolve(transaction);
      });

      sendTransaction.on('send-error', (err) => {
        reject(err);
      });
    });

    sendTransaction.run();
    return promise;
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
    if (!pinCode) {
      return Promise.reject({success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED});
    }

    if (this.seed && !password) {
      return Promise.reject({success: false, message: 'Password is required.', error: 'PASSWORD_REQUIRED'});
    }
    storage.setStore(this.store);
    storage.setItem('wallet:server', this.conn.currentServer);

    this.conn.on('state', this.onConnectionChangedState);
    this.conn.on('wallet-update', this.handleWebsocketMsg);

    let ret;
    if (this.seed) {
      ret = wallet.executeGenerateWallet(this.seed, this.passphrase, pinCode, password, false);
    } else if (this.xpriv) {
      ret = wallet.executeGenerateWalletFromXPriv(this.xpriv, pinCode, false);
    } else {
      throw "This should never happen";
    }
    if (ret !== null) {
      throw "This should never happen";
    }

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

    // TODO Double check that we are properly cleaning things up.
    // See: https://github.com/HathorNetwork/hathor-wallet-headless/pull/1#discussion_r369859701
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
  handleSendPreparedTransaction(transaction) {
    const sendTransaction = new SendTransaction({ transaction });
    const promise = new Promise((resolve, reject) => {
      sendTransaction.on('send-tx-success', (transaction) => {
        resolve(transaction);
      });

      sendTransaction.on('send-error', (err) => {
        reject(err);
      });
    });

    sendTransaction.runFromMining();
    return promise;
  }

  /**
   * Prepare create token transaction data before mining
   *
   * @param {Transaction} transaction Transaction object to be mined and pushed to the network
   *
   * @param {String} name Name of the token
   * @param {String} symbol Symbol of the token
   * @param {number} amount Quantity of the token to be minted
   * @param {Object} options Options parameters
   *  {
   *   'address': address of the minted token,
   *   'changeAddress': address of the change output,
   *   'startMiningTx': boolean to trigger start mining (default true)
   *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
   *  }
   *
   * @return {Promise} Promise that resolves with transaction object if succeeds
   * or with error message if it fails
   *
   * @memberof HathorWallet
   * @inner
   */
  prepareCreateNewToken(name, symbol, amount, options = {}) {
    storage.setStore(this.store);
    const newOptions = Object.assign({ address: null, changeAddress: null, startMiningTx: true, pinCode: null }, options);
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      return Promise.reject({success: false, message: ERROR_MESSAGE_PIN_REQUIRED, error: ERROR_CODE_PIN_REQUIRED});
    }
    const mintAddress = newOptions.address || this.getCurrentAddress().address;

    const ret = tokens.getCreateTokenData(mintAddress, name, symbol, amount, pin, newOptions);

    if (!ret.success) {
      return Promise.reject(ret);
    }

    return Promise.resolve(helpers.createTxFromData(ret.preparedData));
  }

  /**
   * Create a new token for this wallet
   *
   * @param {String} name Name of the token
   * @param {String} symbol Symbol of the token
   * @param {number} amount Quantity of the token to be minted
   * @param {Object} options Options parameters
   *  {
   *   'address': address of the minted token,
   *   'changeAddress': address of the change output,
   *   'startMiningTx': boolean to trigger start mining (default true)
   *   'pinCode': pin to decrypt xpriv information. Optional but required if not set in this
   *  }
   *
   * @return {Object} Object with {success: true, sendTransaction, promise}, where sendTransaction is a
   * SendTransaction object that emit events while the tx is being sent and promise resolves when the sending is done
   *
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
   * @param {String} tokenUid UID of the token to select the authority utxo
   * @param {function} filterUTXOs Callback to check if the output is the authority I want (isMeltOutput or isMintOutput)
   * @param {Object} options Object with custom options.
   *  {
   *    'many': if should return many utxos or just one (default false),
   *    'skipSpent': if should not include spent utxos (default true)
   *  }
   *
   * @return {Array} Array of objects with {tx_id, index, address} of the authority output. Returns null in case there are no utxos for this type
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

        const ret = {tx_id, index, address: output.decoded.address};
        // If output was already used, we can't use it, unless requested in options
        if (output.spent_by) {
          if (skipSpent) {
            continue;
          }

          if (many) {
            // If many we push to the array to be returned later
            utxos.push(ret);
          } else {
            return [ret];
          }
        }

        if (filterUTXOs(output)) {
          if (many) {
            // If many we push to the array to be returned later
            utxos.push(ret);
          } else {
            return [ret];
          }
        }
      }
    }

    if (many) {
      return utxos;
    }
  }

  /**
   * Get mint authorities
   * This is a helper method to call selectAuthorityUtxo without knowledge of the isMintOutput
   *
   * @param {String} tokenUid UID of the token to select the authority utxo
   * @param {Object} options Object with custom options.
   *  {
   *    'many': if should return many utxos or just one (default false),
   *    'skipSpent': if should not include spent utxos (default true)
   *  }
   *
   * @return {Array} Array of objects with {tx_id, index, address} of the authority output. Returns null in case there are no utxos for this type
   **/
  getMintAuthority(tokenUid, options = {}) {
    const newOptions = Object.assign({many: false, skipSpent: true}, options);
    return this.selectAuthorityUtxo(tokenUid, wallet.isMintOutput.bind(wallet), newOptions);
  }

  /**
   * Get melt authorities
   * This is a helper method to call selectAuthorityUtxo without knowledge of the isMeltOutput
   *
   * @param {String} tokenUid UID of the token to select the authority utxo
   * @param {Object} options Object with custom options.
   *  {
   *    'many': if should return many utxos or just one (default false),
   *    'skipSpent': if should not include spent utxos (default true)
   *  }
   *
   * @return {Array} Array of objects with {tx_id, index, address} of the authority output. Returns null in case there are no utxos for this type
   **/
  getMeltAuthority(tokenUid, options = {}) {
    const newOptions = Object.assign({many: false, skipSpent: true}, options);
    return this.selectAuthorityUtxo(tokenUid, wallet.isMeltOutput.bind(wallet), newOptions);
  }

  /**
   * Prepare mint transaction before mining
   *
   * @param {String} tokenUid UID of the token to mint
   * @param {number} amount Quantity to mint
   * @param {String} address Optional parameter for the destination of the minted tokens
   * @param {Object} options Options parameters
   *  {
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
  prepareMintTokensData(tokenUid, amount, options = {}) {
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

    if (mintInput.length === 0) {
      return {success: false, message: 'Don\'t have mint authority output available.'}
    }

    const ret = tokens.getMintData(mintInput[0], tokenUid, mintAddress, amount, null, pin, newOptions);
    if (!ret.success) {
      return Promise.reject(ret);
    }

    return Promise.resolve(helpers.createTxFromData(ret.preparedData));
  }

  /**
   * Mint tokens
   *
   * @param {String} tokenUid UID of the token to mint
   * @param {number} amount Quantity to mint
   * @param {String} address Optional parameter for the destination of the minted tokens
   * @param {Object} options Options parameters
   *  {
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
  async mintTokens(tokenUid, amount, address, options = {}) {
    const tx = await this.prepareMintTokensData(tokenUid, amount, address, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare melt transaction before mining
   *
   * @param {String} tokenUid UID of the token to melt
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
  prepareMeltTokensData(tokenUid, amount, options = {}) {
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

    if (meltInput.length === 0) {
      return Promise.reject({success: false, message: 'Don\'t have melt authority output available.'});
    }

    // Always create another melt authority output
    const ret = tokens.getMeltData(meltInput[0], tokenUid, amount, pin, newOptions.createAnotherMelt, newOptions);
    if (!ret.success) {
      return Promise.reject(ret);
    }

    return Promise.resolve(helpers.createTxFromData(ret.preparedData));
  }

  /**
   * Melt tokens
   *
   * @param {String} tokenUid UID of the token to melt
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
  async meltTokens(tokenUid, amount, options = {}) {
    const tx = await this.prepareMeltTokensData(tokenUid, amount, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare delegate authority transaction before mining
   *
   * @param {String} tokenUid UID of the token to delegate the authority
   * @param {String} type Type of the authority to delegate 'mint' or 'melt'
   * @param {String} destinationAddress Destination address of the delegated authority
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
  prepareDelegateAuthorityData(tokenUid, type, destinationAddress, options = {}) {
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

    const ret = tokens.getDelegateAuthorityData(tx_id, index, address, tokenUid, destinationAddress, createAnother, type, pin);

    if (!ret.success) {
      return Promise.reject(ret);
    }

    return Promise.resolve(helpers.createTxFromData(ret.preparedData));
  }

  /**
   * Delegate authority
   *
   * @param {String} tokenUid UID of the token to delegate the authority
   * @param {String} type Type of the authority to delegate 'mint' or 'melt'
   * @param {String} destinationAddress Destination address of the delegated authority
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
  async delegateAuthority(tokenUid, type, destinationAddress, options = {}) {
    const tx = await this.prepareDelegateAuthorityData(tokenUid, type, destinationAddress, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Prepare destroy authority transaction before mining
   *
   * @param {String} tokenUid UID of the token to delegate the authority
   * @param {String} type Type of the authority to delegate 'mint' or 'melt'
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
  prepareDestroyAuthorityData(tokenUid, type, count, options = {}) {
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

    const ret = tokens.getDestroyAuthorityData(data, pin);
    if (!ret.success) {
      return Promise.reject(ret);
    }

    return Promise.resolve(helpers.createTxFromData(ret.preparedData));
  }

  /**
   * Destroy authority
   *
   * @param {String} tokenUid UID of the token to delegate the authority
   * @param {String} type Type of the authority to delegate 'mint' or 'melt'
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
  async destroyAuthority(tokenUid, type, count, options = {}) {
    const tx = await this.prepareDestroyAuthorityData(tokenUid, type, count, options);
    return this.handleSendPreparedTransaction(tx);
  }

  /**
   * Get all authorities utxos for specific token
   *
   * @param {String} tokenUid UID of the token to delegate the authority
   * @param {String} type Type of the authority to delegate 'mint' or 'melt'
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
   * @param {Object} tx Transaction data with array of inputs and outputs
   *
   * @return {Object} Object with each token and it's balance in this tx for this wallet
   **/
  getTxBalance(tx, optionsParam = {}) {
    const options = Object.assign({ includeAuthorities: false }, optionsParam)
    storage.setStore(this.store);
    const addresses = this.getAllAddressesSimple();
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
}

// State constants.
HathorWallet.CLOSED =  0;
HathorWallet.CONNECTING = 1;
HathorWallet.SYNCING = 2;
HathorWallet.READY = 3;
HathorWallet.ERROR = 4;

export default HathorWallet;
