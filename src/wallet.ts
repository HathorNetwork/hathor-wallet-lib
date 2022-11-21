/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import Connection from 'src/connection';
import { MemoryStorage } from './storage/memory_storage';
import { Store } from './storage/store';
import { IStore } from './types';

export enum WalletState {
  CLOSED = 0,
  CONNECTING = 1,
  SYNCING = 2,
  READY = 3,
  ERROR = 4,
};

type MultisigDataType = {
  pubkeys: string[],
  numSignatures: number,
};

type WalletStartOptionsType = {
  connection: Connection,
  store?: IStore,
  tokenUid: string,
  seed?: string,
  xpriv?: string,
  xpub?: string,
  passphrase?: string,
  multisig?: MultisigDataType,
  preCalculatedAddresses?: string[],
};

export class HathorWallet extends EventEmitter {
  static readonly CLOSED: WalletState = WalletState.CLOSED;
  static readonly CONNECTING: WalletState = WalletState.CONNECTING;
  static readonly SYNCING: WalletState = WalletState.SYNCING;
  static readonly READY: WalletState = WalletState.READY;
  static readonly ERROR: WalletState = WalletState.ERROR;

  conn: Connection;
  store: IStore;
  state: WalletState;
  // serverInfo: string|null;

  seed?: string;
  xpriv?: string;
  xpub?: string;
  passphare?: string;

  tokenUid: string;
  preCalculatedAddresses?: string[];
  multisig: MultisigDataType|null = null;

  constructor({
    connection,
    store,
    tokenUid = '00', // HATHOR_TOKEN_CONFIG.uid
    seed,
    passphrase,
    xpriv,
    xpub,
    multisig,
    preCalculatedAddresses,
  }: WalletStartOptionsType) {
    super();

    // assert Connection: typing
    if (!seed && !xpriv && !xpub ) {
      throw new Error('You must explicitly provide the seed, xpriv or the xpub.');
    }
    
    if (seed && xpriv) {
      throw Error('You cannot provide both a seed and an xpriv.');
    }

    if (xpriv && passphrase !== '') {
      throw Error('You can\'t use xpriv with passphrase.');
    }

    // FIXME: connection.state is protected and we do not have a getter method
    // if (connection.state !== ConnectionState.CLOSED) {
    //   throw Error('You can\'t share connections.');
    // }
    if (connection.getState() !== ConnectionState.CLOSED) {
      throw Error('You can\'t share connections.');
    }

    if (multisig) {
      // assert pubkeys and numSignatures: typing
      if (multisig.pubkeys.length < multisig.numSignatures) {
        throw new Error('Multisig configuration invalid.');
      }
    }

    this.conn = connection;
    this.state = HathorWallet.CLOSED;

    this.seed = seed;
    this.xpriv = xpriv;
    this.xpub = xpub;

    this.passphare = passphrase;

    // XXX: We may have a started storage or continue from reliable integration
    // The store instance should track this, any inconsistence should be alerted from there.
    // this.firstConnection = true;
    
    this.tokenUid = tokenUid;

    if (store) {
      this.store = store;
    } else {
      // Default memory store
      const storage = new MemoryStorage();
      this.store = new Store(storage);
    }

    this.preCalculatedAddresses = preCalculatedAddresses;

    if (multisig) {
      this.multisig = multisig;
    }
  }

  // start/stop
  async start({
    pinCode = null,
    password = null,
  }: { pinCode: string|null, password: string|null} = {}): Promise<void> {
    // check storage integrity
    // save server connection info on storage

    // set handlers for connection events
    // this.conn.on('state', this.handleConnectionStateChange);
    // this.conn.on('websocket', this.handleWebsocketMsg);

    // generate wallet data (seed, xpriv, xpub, etc)
    // set wallet as open
    // start/check storage
    // generate addresses as per scanning policy
    // load history in the background or await?
    // Should we wait for the connection to the fullnode to be open before starting the loadhistory?

    // clear sensitive data
    this.clearSensitiveData();
    // set state
    this.setState(HathorWallet.CONNECTING);
    // connect to full node, checkApiVersion and network then return a promise
    return version.checkApiVersion().then((data) => {
      // Check network version to avoid blunders
      if (data.network.indexOf(this.conn.network) >= 0) {
        this.serverInfo = info;
        this.conn.start();
        return info;
      } else {
        this.setState(HathorWallet.CLOSED);
        throw new Error(`Wrong network. server=${data.network} expected=${this.conn.network}`);
      }
    }, error => {
      this.setState(HathorWallet.CLOSED);
      throw error;
    });
  }

  /**
   * Wallet methods we should implement as minimal
   * 
   * setState: set and emit state
   * clearSensitiveData: clear sensitive data
   * onNewTx/handleWebsocketMesg/onTxArrived: handler for new transactions
   * getBalance: get balance for a token
   * signTx: sign a transaction
   * sendTx: send a transaction
   * sendSimpleTx: send a simple transaction (only one output)
   */

  /**
   * Wallet config methods
   * - get/set ServerUrl
   * - getNetwork
   * - getNetworkObject
   * - getVersionData
   * - enable/disable debugMode
   * - isFromXpub??
   * - setState
   * - clearSensitiveData
   */

  /**
   * Event handlers
   * 
   * - connection state changed
   * - handleWebsocketMsg
   *    - May be changed with reliable integrations
   * - onTxArrived/onNewTx
   */

  /**
   * Methods
   * 
   * - getAllSignatures
   *    - p2sh only, change to getSignaturesP2SH?
   * - assemblePartialTransaction
   *    - p2sh only, change to assembleTransactionP2SH?
   * - getAllAddresses
   * - getAddressAtIndex
   * - getCurrentAddress/getNextAddress
   * - getBalance
   * - getTxHistory/getFullHistory
   * - getTokens
   * - getTx
   * - getAddressInfo
   * - getUtxos
   * - getAllUtxos
   * - getUtxosForAmount
   * - markUtxoSelected
   * - consolidateUtxos
   * - sendTransaction (sendSimpleTransaction or sendTokensToAddress)
   * - sendManyOutputsTransaction
   * - createNewToken
   * - getMintAuthority/getMeltAuthority/getAuthorityUtxos
   * - mintTokens/meltTokens
   * - delegateAuthority
   * - destroyAuthority
   * - getTokenData/getTokenDetails
   * - isAddressMine/getAddressIndex
   * - getTxBalance/getTxAddresses
   * - createNFT
   * - getWalletInputInfo
   * - getSignatures
   * - signTx
   */

  /**
   * Methods we should move to a helper
   * 
   * - getAddressPathForIndex
   *    - Only difference is if the wallet is multisig or not, which can be a parameter.
   *  
   */

  /**
   * Methods being deprecated
   * 
   * - getTransactionsCountByAddress
   *    - Should come from store, not scan all addresses and all history on one method
   * - preProcessWalletData
   *    - pre processed data (tokens, historyByToken, balanceByToken) will be processed and saved on the store
   */

}