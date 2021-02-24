/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import wallet from '../wallet';
import { HATHOR_TOKEN_CONFIG } from '../constants';
import transaction from '../transaction';
import tokens from '../tokens';
import version from '../version';
import walletApi from '../api/wallet';
import storage from '../storage';
import helpers from '../helpers';
import MemoryStore from '../memory_store';
import Connection from './connection';
import SendTransaction from './sendTransaction';

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

    tokenUid = HATHOR_TOKEN_CONFIG.uid,

    // XXX Update it so we don't have fixed pin/password
    password = '123',
    pinCode = '123',

    // debug mode
    debug = false,
  } = {}) {
    super();

    if (!connection) {
      throw Error('You must provide a connection.');
    }

    if (!seed) {
      throw Error('You must explicitly provide the seed.');
    }

    if (connection.state !== Connection.CLOSED) {
      throw Error('You can\'t share connections.');
    }

    this.conn = connection;
    wallet.setConnection(connection);

    this.state = HathorWallet.CLOSED;
    this.serverInfo = null;

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
        promise = wallet.reloadData({connection: this.conn, store: this.store});
      }

      promise.then(() => {
        this.setState(HathorWallet.READY);
      }).catch((error) => {
        throw error;
      })
    } else {
      // CONNECTING or CLOSED?
      this.serverInfo = null;
      this.setState(HathorWallet.CONNECTING);
    }
  }

  getAllAddresses() {
    storage.setStore(this.store);
    return wallet.getAllAddresses();
  }

  getAddressAtIndex(index) {
    storage.setStore(this.store);
    return wallet.getAddressAtIndex(index);
  }

  getCurrentAddress({ markAsUsed = false } = {}) {
    storage.setStore(this.store);
    if (markAsUsed) {
      return wallet.getAddressToUse(this.conn);
    }
    return wallet.getCurrentAddress();
  }

  /**
   * Called when a new message arrives from websocket.
   **/
  handleWebsocketMsg(wsData) {
    if (wsData.type === 'wallet:address_history') {
      this.onNewTx(wsData);
    }
  }

  getBalance(tokenUid) {
    storage.setStore(this.store);
    const uid = tokenUid || this.token.uid;
    const historyTransactions = this.getTxHistory();
    return wallet.calculateBalance(Object.values(historyTransactions), uid);
  }

  getTxHistory() {
    storage.setStore(this.store);
    const data = wallet.getWalletData();
    const historyTransactions = 'historyTransactions' in data ? data['historyTransactions'] : {};
    return historyTransactions;
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

  setState(state) {
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

    // TODO XXX Uncomment the following block to keep track of the balance.
    /*
    // We need to reload it because it was modified by updateHistoryData.
    const newWalletData = wallet.getWalletData();
    const { keys } = newWalletData;

    const updatedHistoryMap = {};
    const updatedBalanceMap = {};
    const balances = this.getTxBalance(newTx);

    // we now loop through all tokens present in the new tx to get the new history and balance
    for (const [tokenUid, tokenTxBalance] of Object.entries(balances)) {
      // we may not have this token yet, so state.tokensHistory[tokenUid] would return undefined
      const currentHistory = state.tokensHistory[tokenUid] || [];
      const newTokenHistory = addTxToSortedList(tokenUid, tx, tokenTxBalance, currentHistory);
      updatedHistoryMap[tokenUid] = newTokenHistory;
      // totalBalance should not be confused with tokenTxBalance. The latter is the balance of the new
      // tx, while the former is the total balance of the token, considering all tx history
      const totalBalance = getBalance(tokenUid);
      updatedBalanceMap[tokenUid] = totalBalance;
    }
    const newTokensHistory = Object.assign({}, state.tokensHistory, updatedHistoryMap);
    const newTokensBalance = Object.assign({}, state.tokensBalance, updatedBalanceMap);

    storage.setItem('local:tokens:history', newTokensHistory);
    storage.setItem('local:tokens:balance', newTokensBalance);
    */
  };

  /**
   * Send a transaction with multi tokens
   *
   * @param {Object} data Array of {'address', 'value', 'token'}
   *
   * @return {Promise} Promise resolved when transaction is sent.
   */
  sendMultiTokenTransaction(data) {
    storage.setStore(this.store);
    const txData = {
      inputs: [],
      outputs: []
    }

    const walletData = wallet.getWalletData();
    const historyTxs = 'historyTransactions' in walletData ? walletData.historyTransactions : {};

    // First I need an array with all tokens
    const allTokens = [];
    for (const d of data) {
      if (allTokens.indexOf(d.token) === -1) {
        allTokens.push(d.token);
      }
    }

    for (const d of data) {
      const dataOutput = {'address': d.address, 'value': d.value, 'tokenData': tokens.getTokenIndex(allTokens, d.token.uid)};
      const partialData = {'inputs': [], 'outputs': [dataOutput]}
      const result = wallet.prepareSendTokensData(partialData, d.token, true, historyTxs, allTokens);

      if (!result.success) {
        return Promise.reject(new Error(result.message));
      }

      const dataToken = result.data;

      txData['inputs'] = [...txData['inputs'], ...dataToken['inputs']];
      txData['outputs'] = [...txData['outputs'], ...dataToken['outputs']];
    }

    txData.tokens = tokens.filterTokens(allTokens, HATHOR_TOKEN_CONFIG).map((token) => token.uid);

    const updateOutputs = (val) => {
      const historyTxs = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
      for (const input of txData.inputs) {
        historyTxs[input.tx_id]['outputs'][input.index]['spent_by'] = val;
      }
    }

    // TODO XXX Setting input as spent by, so it won't be chosen again
    updateOutputs('2');

    const promise = new Promise((resolve, reject) => {
      transaction.sendTransaction(txData, this.pinCode).then((result) => {
        if (result.success === false) {
          // XXX Setting outputs as spent_by null again
          updateOutputs(null);
        }
        resolve(result);
      }, (error) => {
        // XXX Setting outputs as spent_by null again
        updateOutputs(null);
        reject(error);
      });
    })

    return promise;
  }

  /**
   * Send tokens to only one address.
   *
   * @param {String} address Address to send the tokens
   * @param {number} value Amount of tokens to be sent
   * @param {Object} token Token object {'uid', 'name', 'symbol'}. Optional parameter if user already set on the class
   * @param {Object} options Options parameters
   *  {
   *   'changeAddress': address of the change output
   *  }
   *
   * @return {Object} In case of success, an object with {success: true, sendTransaction, promise}, where sendTransaction is a
   * SendTransaction object that emit events while the tx is being sent and promise resolves when the sending is done
   * In case of error, an object with {success: false, message}
   *
   **/
  sendTransaction(address, value, token, options = { changeAddress: null }) {
    storage.setStore(this.store);
    const ret = this.prepareTransaction(address, value, token, options);

    if (ret.success) {
      return this.sendPreparedTransaction(ret.data);
    } else {
      return ret;
    }
  }

  /**
   * Prepare transaction data to be sent
   *
   * @param {String} address Address to send the tokens
   * @param {number} value Amount of tokens to be sent
   * @param {Object} token Token object {'uid', 'name', 'symbol'}. Optional parameter if user already set on the class
   * @param {Object} options Options parameters
   *  {
   *   'changeAddress': address of the change output
   *  }
   *
   * @return {Object} Object with {success: false, message} in case of an error, or {success: true, data}, otherwise
   **/
  prepareTransaction(address, value, token, options = { changeAddress: null }) {
    storage.setStore(this.store);
    const txToken = token || this.token;
    const isHathorToken = txToken.uid === HATHOR_TOKEN_CONFIG.uid;
    // XXX This allow only one token to be sent
    // XXX This method allow only one output
    const tokenData = (isHathorToken ? 0 : 1);
    const data = {
      tokens: isHathorToken ? [] : [txToken.uid],
      inputs: [],
      outputs: [{
        address, value, tokenData
      }],
    };

    return this.completeTxData(data, txToken, options);
  }

  /**
   * Complete transaction data with inputs
   *
   * @param {Object} data Partial data that will be completed with inputs
   * @param {Object} token Token object {'uid', 'name', 'symbol'}. Optional parameter if user already set on the class
   * @param {Object} options Options parameters
   *  {
   *   'changeAddress': address of the change output
   *  }
   *
   * @return {Object} Object with 'success' and completed 'data' in case of success, and 'message' in case of error
   **/
  completeTxData(partialData, token, options = { changeAddress: null }) {
    const txToken = token || this.token;
    const walletData = wallet.getWalletData();
    const historyTxs = 'historyTransactions' in walletData ? walletData.historyTransactions : {};

    let chooseInputs = true;
    if (partialData.inputs.length > 0) {
      chooseInputs = false;
    }

    // Warning: prepareSendTokensData(...) might modify `partialData`.
    const ret = wallet.prepareSendTokensData(partialData, txToken, chooseInputs, historyTxs, [txToken], options);

    if (!ret.success) {
      ret.debug = {
        balance: this.getBalance(txToken.uid),
        partialData: partialData, // this might not be the original `partialData`
        txToken: txToken,
        ...ret.debug
      };
      return ret;
    }

    let preparedData = null;
    try {
      preparedData = transaction.prepareData(ret.data, this.pinCode);
    } catch(e) {
      const message = helpers.handlePrepareDataError(e);
      return {success: false, message};
    }

    return {success: true, data: preparedData};
  }

  /**
   * Send a transaction from its outputs
   * Currently does not have support to send custom tokens, only HTR
   *
   * @param {Array} outputs Array of outputs with each element as an object with {'address', 'value'}
   * @param {Array} inputs Array of inputs with each element as an object with {'hash', 'index'}
   * @param {Object} token Token object {'uid', 'name', 'symbol'}. Optional parameter if user already set on the class
   * @param {Object} options Options parameters
   *  {
   *   'changeAddress': address of the change output
   *  }
   *
   * @return {Promise} Promise that resolves when transaction is sent
   **/
  sendManyOutputsTransaction(outputs, inputs = [], token = null, options = { changeAddress: null }) {
    // XXX To accept here multi tokens in the same tx would be a bit more complicated because
    // the method prepareSendTokensData would need a bigger refactor.
    // I believe we should refactor all of that code (and it will be done on wallet-service)
    // so I decided to change this method to accept only one token, which is enough for our needs right now
    storage.setStore(this.store);
    const txToken = token || this.token;
    const isHathorToken = txToken.uid === HATHOR_TOKEN_CONFIG.uid;
    const data = {
      tokens: isHathorToken ? [] : [txToken.uid],
      inputs: [],
      outputs: [],
    };

    for (const output of outputs) {
      data.outputs.push({address: output.address, value: output.value, tokenData: isHathorToken ? 0 : 1})
    }

    for (const input of inputs) {
      data.inputs.push({tx_id: input.hash, index: input.index, token: HATHOR_TOKEN_CONFIG.uid });
    }

    const ret = this.completeTxData(data, txToken, options);

    if (ret.success) {
      return this.sendPreparedTransaction(ret.data);
    } else {
      return ret;
    }
  }

  /**
   * Send a full prepared transaction
   * Just transform data object to bytes, then hexadecimal and send it to full node.
   *
   * @param {Object} data Full transaction data
   *
   * @return {Object} Object with {success: true, sendTransaction, promise}, where sendTransaction is a
   * SendTransaction object that emit events while the tx is being sent and promise resolves when the sending is done
   **/
  sendPreparedTransaction(data) {
    storage.setStore(this.store);
    const sendTransaction = new SendTransaction({data});
    sendTransaction.start();
    const ret = {success: true, promise: sendTransaction.promise, sendTransaction};
    if (this.debug) {
      ret.debug = {
        balanceHTR: this.getBalance(),
        data: data,
      };
    }
    return ret;
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    storage.setStore(this.store);
    storage.setItem('wallet:server', this.conn.currentServer);

    this.conn.on('state', this.onConnectionChangedState);
    this.conn.on('wallet-update', this.handleWebsocketMsg);

    wallet.executeGenerateWallet(this.seed, this.passphrase, this.pinCode, this.password, false);

    this.getTokenData();
    this.serverInfo = null;
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
  stop() {
    storage.setStore(this.store);
    // TODO Double check that we are properly cleaning things up.
    // See: https://github.com/HathorNetwork/hathor-wallet-headless/pull/1#discussion_r369859701
    this.conn.stop()
    this.conn.removeListener('is_online', this.onConnectionChangedState);
    this.conn.removeListener('wallet-update', this.handleWebsocketMsg);

    this.serverInfo = null;
    this.setState(HathorWallet.CLOSED);
    this.firstConnection = true;
  }

  /**
   * Returns the balance for each token in tx, if the input/output belongs to this wallet
   */
  getTxBalance(tx) {
    storage.setStore(this.store);
    const myKeys = []; // TODO
    const balance = {};
    for (const txout of tx.outputs) {
      if (wallet.isAuthorityOutput(txout)) {
        continue;
      }
      if (txout.decoded && txout.decoded.address
          && txout.decoded.address in myKeys) {
        if (!balance[txout.token]) {
          balance[txout.token] = 0;
        }
        balance[txout.token] += txout.value;
      }
    }

    for (const txin of tx.inputs) {
      if (wallet.isAuthorityOutput(txin)) {
        continue;
      }
      if (txin.decoded && txin.decoded.address
          && txin.decoded.address in myKeys) {
        if (!balance[txin.token]) {
          balance[txin.token] = 0;
        }
        balance[txin.token] -= txin.value;
      }
    }

    return balance;
  }

  /**
   * Create a new token for this wallet
   *
   * @param {String} name Name of the token
   * @param {String} symbol Symbol of the token
   * @param {number} amount Quantity of the token to be minted
   * @param {String} address Optional parameter for the destination of the created token
   * @param {Object} options Options parameters
   *  {
   *   'changeAddress': address of the change output
   *  }
   *
   * @return {Object} Object with {success: true, sendTransaction, promise}, where sendTransaction is a
   * SendTransaction object that emit events while the tx is being sent and promise resolves when the sending is done
   **/
  createNewToken(name, symbol, amount, address, options = { changeAddress: null }) {
    storage.setStore(this.store);
    const mintAddress = address || this.getCurrentAddress();
    const ret = tokens.createToken(mintAddress, name, symbol, amount, this.pinCode, options);

    if (ret.success) {
      const sendTransaction = ret.sendTransaction;
      sendTransaction.start();
      return {success: true, promise: sendTransaction.promise, sendTransaction};
    } else {
      return ret;
    }

  }

  /**
   * Select authority utxo for mint or melt. Depends on the callback received as parameter
   * We could add an {options} parameter to allow common filters (e.g. mint authority, melt authority, p2pkh) to improve this method later.
   *
   * @param {String} tokenUid UID of the token to select the authority utxo
   * @param {function} filterUTXOs Callback to check if the output is the authority I want (isMeltOutput or isMintOutput)
   *
   * @return {Object} Object with {tx_id, index, address} of the authority output. Returns null in case there are no utxos for this type
   **/
  selectAuthorityUtxo(tokenUid, filterUTXOs) {
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

        // If output was already used, we can't use it
        if (output.spent_by) {
          continue;
        }

        if (filterUTXOs(output)) {
          return {tx_id, index, address: output.decoded.address};
        }
      }
    }
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
   *  }
   *
   * @return {Object} Object with {success: true, sendTransaction, promise}, where sendTransaction is a
   * SendTransaction object that emit events while the tx is being sent and promise resolves when the sending is done
   **/
  mintTokens(tokenUid, amount, address, options = { changeAddress: null }) {
    storage.setStore(this.store);
    const mintAddress = address || this.getCurrentAddress();
    const mintInput = this.selectAuthorityUtxo(tokenUid, wallet.isMintOutput.bind(wallet));

    if (mintInput === null) {
      return {success: false, message: 'Don\'t have mint authority output available.'}
    }

    const ret = tokens.mintTokens(mintInput, tokenUid, mintAddress, amount, null, this.pinCode, options);

    if (ret.success) {
      const sendTransaction = ret.sendTransaction;
      sendTransaction.start();
      return {success: true, promise: sendTransaction.promise, sendTransaction};
    } else {
      return ret;
    }
  }

  /**
   * Melt tokens
   *
   * @param {String} tokenUid UID of the token to melt
   * @param {number} amount Quantity to melt
   * @param {Object} options Options parameters
   *  {
   *   'depositAddress': address of the HTR deposit back
   *   'changeAddress': address of the change output
   *  }
   *
   * @return {Object} Object with {success: true, sendTransaction, promise}, where sendTransaction is a
   * SendTransaction object that emit events while the tx is being sent and promise resolves when the sending is done
   **/
  meltTokens(tokenUid, amount, options = { depositAddress: null, changeAddress: null }) {
    storage.setStore(this.store);
    const meltInput = this.selectAuthorityUtxo(tokenUid, wallet.isMeltOutput.bind(wallet));

    if (meltInput === null) {
      return {success: false, message: 'Don\'t have melt authority output available.'}
    }

    // Always create another melt authority output
    const ret = tokens.meltTokens(meltInput, tokenUid, amount, this.pinCode, true, options);
    if (ret.success) {
      const sendTransaction = ret.sendTransaction;
      sendTransaction.start();
      return {success: true, promise: sendTransaction.promise, sendTransaction};
    } else {
      return ret;
    }
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
}

// State constants.
HathorWallet.CLOSED =  0;
HathorWallet.CONNECTING = 1;
HathorWallet.SYNCING = 2;
HathorWallet.READY = 3;

export default HathorWallet;
