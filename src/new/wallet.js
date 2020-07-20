/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import wallet from '../wallet';
import { GAP_LIMIT, HATHOR_TOKEN_CONFIG } from '../constants';
import transaction from '../transaction';
import tokens from '../tokens';
import version from '../version';
import walletApi from '../api/wallet';
import storage from '../storage';
import MemoryStore from '../memory_store';
import Connection from './connection';
import WebSocketHandler from '../WebSocketHandler';

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
      WebSocketHandler.setup();
      wallet.loadAddressHistory(0, GAP_LIMIT, this.conn, this.store).then(() => {
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
        console.log('Error sending tx:', result.message);
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
   *
   * @return {Promise} Promise that resolves when transaction is sent
   **/
  sendTransaction(address, value, token) {
    storage.setStore(this.store);
    const ret = this.prepareTransaction(address, value, token);

    if (ret.success) {
      return transaction.sendTransaction(ret.data, this.pinCode);
    } else {
      return Promise.reject(ret.message);
    }
  }

  /**
   * Prepare transaction data to be sent
   *
   * @param {String} address Address to send the tokens
   * @param {number} value Amount of tokens to be sent
   * @param {Object} token Token object {'uid', 'name', 'symbol'}. Optional parameter if user already set on the class
   *
   * @return {Object} Object with {success: false, message} in case of an error, or {success: true, data}, otherwise
   **/
  prepareTransaction(address, value, token) {
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

    return this.completeTxData(data, txToken);
  }

  /**
   * Complete transaction data with inputs
   *
   * @param {Object} data Partial data that will be completed with inputs
   * @param {Object} token Token object {'uid', 'name', 'symbol'}. Optional parameter if user already set on the class
   *
   * @return {Object} Object with 'success' and completed 'data' in case of success, and 'message' in case of error
   **/
  completeTxData(partialData, token) {
    const txToken = token || this.token;
    const walletData = wallet.getWalletData();
    const historyTxs = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
    const ret = wallet.prepareSendTokensData(partialData, txToken, true, historyTxs, [txToken]);

    return ret
  }

  /**
   * Send a transaction from its outputs
   * Currently does not have support to send custom tokens, only HTR
   *
   * @param {Array} outputs Array of outputs with each element as an object with {'address', 'value'}
   *
   * @return {Promise} Promise that resolves when transaction is sent
   **/
  sendManyOutputsTransaction(outputs) {
    storage.setStore(this.store);
    const data = {
      tokens: [], // For now does not support custom tokens
      inputs: [],
      outputs: [],
    };

    for (const output of outputs) {
      data.outputs.push({address: output.address, value: output.value, tokenData: 0})
    }

    const ret = this.completeTxData(data);

    if (ret.success) {
      return transaction.sendTransaction(ret.data, this.pinCode);
    } else {
      return Promise.reject(ret.message);
    }
  }

  /**
   * Send a full prepared transaction
   * Just transform data object to bytes, then hexadecimal and send it to full node.
   *
   * @param {Object} data Full transaction data
   *
   * @return {Promise} Promise that resolves when transaction is sent
   **/
  sendPreparedTransaction(data) {
    storage.setStore(this.store);
    return transaction.sendPreparedTransaction(data);
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
        console.log('Version error:', error);
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
}

// State constants.
HathorWallet.CLOSED =  0;
HathorWallet.CONNECTING = 1;
HathorWallet.SYNCING = 2;
HathorWallet.READY = 3;

export default HathorWallet;
