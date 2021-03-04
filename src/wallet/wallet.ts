/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import walletApi from './api/walletApi';
import wallet from '../utils/wallet';

enum walletState {
  NOT_STARTED = 'Not started',
  LOADING = 'Loading',
  READY = 'Ready',
}

class HathorWallet extends EventEmitter {
  // String with 24 words separated by space
  seed: string;
  // String with wallet passphrase
  passphrase: string;
  // Wallet id from the wallet service
  walletId: string;
  // State of the wallet. One of the walletState enum options
  private state: string

  constructor(seed: string, options = { passphrase: '' }) {
    super();

    const { passphrase } = options;

    if (!seed) {
      throw Error('You must explicitly provide the seed.');
    }

    this.state = walletState.NOT_STARTED;
    // TODO Validate seed
    this.seed = seed;
    this.passphrase = passphrase

    this.walletId = null;
  }

  /**
   * Start wallet: load the wallet data, update state and start polling wallet status until it's ready
   *
   * @memberof HathorWallet
   * @inner
   */
  start() {
    this.setState(walletState.LOADING);
    const xpub = wallet.getXPubKeyFromSeed(this.seed, {passphrase: this.passphrase});
    console.log('XPUB', xpub);
    console.log(xpub);
    walletApi.createWallet(xpub).then((res) => {
      if (res.sucess) {
        this.walletId = res.status.walletId;
        this.startPollingStatus();
      } else {
      }
    }, (err) => {
      // TODO How to handle error
      console.log('Error sending create wallet request', err);
    });
    // TODO load data and start polling
  }

  startPollingStatus() {
    // TODO
  }

  /**
   * Update wallet state and emit 'state' event
   *
   * @param {string} state New wallet state
   *
   * @memberof HathorWallet
   * @inner
   */
  setState(state: string) {
    this.state = state;
    this.emit('state', state);
  }
}

export default HathorWallet;
