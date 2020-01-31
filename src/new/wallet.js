/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import networkInstance from '../network';
import wallet from '../wallet';
import { GAP_LIMIT, HATHOR_TOKEN_CONFIG, DEFAULT_SERVER } from '../constants';
import transaction from '../transaction';
import tokens from '../tokens';
import version from '../version';
import ws from '../WebSocketHandler';
import storage from '../storage';
import MemoryStore from '../memory_store';
import walletApi from '../api/wallet';

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
class Wallet extends EventEmitter {
  constructor({ network, server, seed, tokenUid }) {
    super();

    networkInstance.setNetwork(network);
    this.network = network;

    this.state = Wallet.CLOSED;
    this.serverInfo = null;

    this.onConnectionChange = this.onConnectionChange.bind(this);
    this.handleWebsocketMsg = this.handleWebsocketMsg.bind(this);
    this.onAddressesLoaded = this.onAddressesLoaded.bind(this);

    this.seed = seed;
    this.server = server;
    if (!this.server) {
      // We set the default server of the lib
      this.server = DEFAULT_SERVER;

    }

    // tokenUid is optional so we can get the token of the wallet
    this.token = null;
    this.tokenUid = tokenUid;


    this.passphrase = '';
    // XXX Update it so we don't have fixed pin/password
    this.pinCode = '123';
    this.password = '123';
  }

  /**
   * Called when loading the history of transactions.
   * It is called every HTTP Request to get the history of a set of addresses.
   * Usually, this is called multiple times.
   * The `historyTransactions` contains all transactions, including the ones from a previous call to this method.
   *
   * @param {Object} result {historyTransactions, allTokens, newSharedAddress, newSharedIndex, addressesFound}
   **/
  onAddressesLoaded(result) {
    this.emit('more-addresses-loaded', result);
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   **/
  onConnectionChange(value) {
    if (value) {
      this.setState(Wallet.SYNCING);
      wallet.loadAddressHistory(0, GAP_LIMIT).then(() => {
        this.setState(Wallet.READY);
      }).catch((error) => {
        throw error;
      })
    } else {
      // CONNECTING or CLOSED?
      this.serverInfo = null;
      this.setState(Wallet.CONNECTING);
    }
  }

  getAddressToUse() {
    return wallet.getAddressToUse();
  }

  getCurrentAddress() {
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

  reloadData() {
    // TODO Reload data?
    console.log('reloadData');
  }

  getBalance(tokenUid) {
    if (!tokenUid && !this.token) {
      throw Error('Token must be set in the class instance or passed as parameter in the method.')
    }
    const uid = tokenUid || this.token.uid;
    const historyTransactions = this.getTxHistory();
    return wallet.calculateBalance(Object.values(historyTransactions), uid);
  }

  getTxHistory() {
    const data = wallet.getWalletData();
    const historyTransactions = 'historyTransactions' in data ? data['historyTransactions'] : {};
    return historyTransactions;
  }

  setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  onNewTx(wsData) {
    const newTx = wsData.history;

    // TODO we also have to update some wallet lib data? Lib should do it by itself
    const walletData = wallet.getWalletData();
    const historyTransactions = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
    const allTokens = 'allTokens' in walletData ? walletData.allTokens : [];

    let isNewTx = true;
    if (newTx.tx_id in historyTransactions) {
      isNewTx = false;
    }

    wallet.updateHistoryData(historyTransactions, allTokens, [newTx], null, walletData);

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
   * @param {Object} data Array of {'address', 'value', 'token'}
   */
  sendMultiTokenTransaction(data) {
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
        return;
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
    const txToken = token || this.token;
    if (!txToken) {
      throw Error('Token must be set in the class instance or passed as parameter in the method.')
    }
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

    const walletData = wallet.getWalletData();
    const historyTxs = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
    const ret = wallet.prepareSendTokensData(data, txToken, true, historyTxs, [txToken]);

    if (!ret.success) {
      return Promise.reject(ret.message);
    }

    return transaction.sendTransaction(ret.data, this.pinCode);
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    const store = new MemoryStore();
    storage.setStore(store);
    storage.setItem('wallet:server', this.server);

    ws.on('is_online', this.onConnectionChange);
    ws.on('reload_data', this.reloadData);
    ws.on('addresses_loaded', this.onAddressesLoaded);
    ws.on('wallet', this.handleWebsocketMsg);

    wallet.executeGenerateWallet(this.seed, this.passphrase, this.pinCode, this.password, false);

    this.getTokenData();
    this.serverInfo = null;
    this.setState(Wallet.CONNECTING);

    const promise = new Promise((resolve, reject) => {
      version.checkApiVersion().then((info) => {
        // Check network version to avoid blunders.
        if (info.network.indexOf(this.network) >= 0) {
          ws.setup();
          this.serverInfo = info;
          resolve(info);
        } else {
          this.setState(Wallet.CLOSED);
          reject(`Wrong network. server=${info.network} expected=${this.network}`);
        }
      }, (error) => {
        console.log('Version error:', error);
        this.setState(Wallet.CLOSED);
        reject(error);
      });
    });
    return promise;
  }

  /**
   * Close the connections and stop emitting events.
   **/
  stop() {
    // TODO Double check that we are properly cleaning things up.
    // See: https://github.com/HathorNetwork/hathor-wallet-headless/pull/1#discussion_r369859701
    ws.stop()
    ws.removeListener('is_online', this.onConnectionChange);
    ws.removeListener('reload_data', this.reloadData);
    ws.removeListener('addresses_loaded', this.onAddressesLoaded);
    ws.removeListener('wallet', this.handleWebsocketMsg);
    this.serverInfo = null;
    this.setState(Wallet.CLOSED);
  }

  /**
   * Returns the balance for each token in tx, if the input/output belongs to this wallet
   */
  getTxBalance(tx) {
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
    if (this.tokenUid) {
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
  }

  isReady() {
    return this.state === Wallet.READY;
  }
}

// State constants.
Wallet.CLOSED =  0;
Wallet.CONNECTING = 1;
Wallet.SYNCING = 2;
Wallet.READY = 3;

Wallet.getHumanState = (state) => {
  const map = {
    [Wallet.CLOSED]: 'Closed',
    [Wallet.CONNECTING]: 'Connecting',
    [Wallet.SYNCING]: 'Syncing',
    [Wallet.READY]: 'Ready',
  }

  if (state in map) {
    return map[state];
  } else {
    return 'Unknown';
  }
}

export default Wallet;