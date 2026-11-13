/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A stop() that comes while start() runs. start() rejects with WalletStoppedError and the wallet
 * does not connect, whether the stop() comes before start() reached the fullnode or while it waits
 * for the fullnode's version and network height.
 */

import HathorWallet from '../../../src/new/wallet';
import { WalletStoppedError } from '../../../src/errors';
import {
  mergePrecalculatedAddresses,
  precalculationHelpers,
} from '../helpers/wallet-precalculation.helper';
import { DEFAULT_PASSWORD, DEFAULT_PIN_CODE, generateConnection } from '../helpers/wallet.helper';
import { getGapLimitConfig } from '../utils/core.util';

async function newWallet() {
  const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
  const connection = generateConnection();
  const wallet = new HathorWallet({
    seed: walletData.words,
    connection,
    password: DEFAULT_PASSWORD,
    pinCode: DEFAULT_PIN_CODE,
    preCalculatedAddresses: mergePrecalculatedAddresses(
      walletData.addresses,
      walletData.shieldedAddresses
    ),
    scanPolicy: getGapLimitConfig(),
  });
  return { wallet, connection };
}

describe('[Fullnode] stop() while start() runs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should reject start() with WalletStoppedError when stop() comes right after it', async () => {
    const { wallet, connection } = await newWallet();
    const connect = jest.spyOn(connection, 'start');

    const [started, stopped] = await Promise.allSettled([wallet.start(), wallet.stop()]);

    expect(stopped.status).toBe('fulfilled');
    expect(started.status).toBe('rejected');
    expect((started as PromiseRejectedResult).reason).toBeInstanceOf(WalletStoppedError);
    expect(connect).not.toHaveBeenCalled();
    expect(wallet.state).toBe(HathorWallet.CLOSED);
  });

  it('should reject start() with WalletStoppedError when stop() comes while it asks the fullnode for its version and height', async () => {
    const { wallet, connection } = await newWallet();
    const connect = jest.spyOn(connection, 'start');

    // start() sets CONNECTING right before it asks the fullnode for its version and network height
    let stopped: Promise<void> | null = null;
    wallet.on('state', state => {
      if (state === HathorWallet.CONNECTING && !stopped) {
        stopped = wallet.stop();
      }
    });

    const [started] = await Promise.allSettled([wallet.start()]);
    expect(stopped).not.toBeNull();
    await stopped;

    expect(started.status).toBe('rejected');
    expect((started as PromiseRejectedResult).reason).toBeInstanceOf(WalletStoppedError);
    expect(connect).not.toHaveBeenCalled();
    expect(wallet.state).toBe(HathorWallet.CLOSED);
  });
});
