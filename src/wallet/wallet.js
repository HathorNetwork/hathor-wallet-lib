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
    seed,
    passphrase = '',
  } = {}) {
    super();

    if (!seed) {
      throw Error('You must explicitly provide the seed.');
    }

    this.state = HathorWallet.CLOSED;
    this.seed = seed;
  }
}

// State constants.
HathorWallet.CLOSED =  0;
HathorWallet.CONNECTING = 1;
HathorWallet.SYNCING = 2;
HathorWallet.READY = 3;

export default HathorWallet;
