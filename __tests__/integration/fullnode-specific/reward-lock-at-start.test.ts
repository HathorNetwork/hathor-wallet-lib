/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Block rewards inside the reward lock when a wallet starts.
 *
 * The first history walk tells which block rewards are reward-locked from the network height the
 * wallet knows at that moment, and nothing locks a reward again once it counted unlocked. The
 * websocket brings the height only with the fullnode's dashboard metrics, broadcast every second
 * and not on connect, so a wallet whose history loaded before the first of them counted its recent
 * rewards as unlocked.
 *
 * Which of the two comes first is a matter of timing. These tests hold the dashboard messages back
 * until the wallet is ready, which makes the order that used to fail certain. Everything else is
 * the real network. The dev miner pays its blocks to an empty script, so each test mines the
 * reward it needs from the fullnode's block template, paying a fresh wallet.
 */

import HathorWallet from '../../../src/new/wallet';
import Connection from '../../../src/new/connection';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { HistorySyncMode } from '../../../src/types';
import {
  mergePrecalculatedAddresses,
  precalculationHelpers,
} from '../helpers/wallet-precalculation.helper';
import {
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  waitForWalletReady,
} from '../helpers/wallet.helper';
import { fullnodeHeight, MinedBlock, mineBlockTo } from '../helpers/mining.helper';
import { delay, getGapLimitConfig } from '../utils/core.util';

/**
 * Keeps the websocket from delivering the fullnode's dashboard messages, which carry the network
 * height, until `release` hands over the held ones and lets the next ones through.
 */
function holdDashboardMessages(connection: Connection) {
  const { websocket } = connection;
  if (!websocket) {
    throw new Error('The connection has no websocket');
  }
  const deliver = websocket.emit.bind(websocket);
  const held: unknown[][] = [];
  let holding = true;
  jest.spyOn(websocket, 'emit').mockImplementation((event, ...args) => {
    if (holding && event === 'dashboard') {
      held.push(args);
      return true;
    }
    return deliver(event, ...args);
  });
  return {
    release() {
      holding = false;
      for (const args of held.splice(0)) {
        deliver('dashboard', ...args);
      }
    },
  };
}

async function waitForHeight(wallet: HathorWallet, height: number, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while ((await wallet.storage.getCurrentHeight()) < height) {
    if (Date.now() > deadline) {
      throw new Error(`The wallet did not reach height ${height} in ${timeout} ms`);
    }
    await delay(250);
  }
}

/** The HTR balance once it equals `expected`, or after `timeout` if it never does. */
async function htrBalanceOnceAt(
  wallet: HathorWallet,
  expected: { unlocked: bigint; locked: bigint },
  timeout = 30000
) {
  const deadline = Date.now() + timeout;
  let [{ balance }] = await wallet.getBalance(NATIVE_TOKEN_UID);
  while (
    (balance.unlocked !== expected.unlocked || balance.locked !== expected.locked) &&
    Date.now() < deadline
  ) {
    await delay(250);
    [{ balance }] = await wallet.getBalance(NATIVE_TOKEN_UID);
  }
  return balance;
}

describe('[Fullnode] block rewards inside the reward lock at start', () => {
  let wallet: HathorWallet | null = null;

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true, cleanAddresses: true });
      wallet = null;
    }
    jest.restoreAllMocks();
  });

  it.each([
    HistorySyncMode.POLLING_HTTP_API,
    HistorySyncMode.XPUB_STREAM_WS,
    HistorySyncMode.MANUAL_STREAM_WS,
  ])(
    'should count a reward inside the lock as locked when the history loads before any height message (%s)',
    async historySyncMode => {
      const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
      const connection = generateConnection();
      const dashboard = holdDashboardMessages(connection);
      wallet = new HathorWallet({
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
      wallet.setHistorySyncMode(historySyncMode);

      // The reward is mined when the wallet connects: after start() asked for the network height,
      // and before the history walk, which finds the block.
      const mined: Promise<MinedBlock>[] = [];
      const connect = connection.start.bind(connection);
      jest.spyOn(connection, 'start').mockImplementation(() => {
        const mining = mineBlockTo(walletData.addresses[0]);
        mined.push(mining);
        mining.then(
          () => connect(),
          () => connect()
        );
      });

      const heightBeforeStart = await fullnodeHeight();
      await wallet.start();
      expect(mined).toHaveLength(1);
      const [block] = await Promise.all([mined[0], waitForWalletReady(wallet)]);

      // A streaming wallet falls back to polling when the fullnode has not told it can stream.
      expect(wallet.storage.shieldedView.syncMode).toBe(historySyncMode);
      expect(await wallet.storage.getTx(block.txId)).toMatchObject({ height: block.height });
      const rewardLock = wallet.storage.version!.reward_spend_min_blocks;
      expect(rewardLock).toBeGreaterThan(0);

      // At the height the wallet knows, the block is inside the reward lock.
      const [{ balance: atStart }] = await wallet.getBalance(NATIVE_TOKEN_UID);
      expect(atStart).toEqual({ unlocked: 0n, locked: block.reward });
      // No dashboard message reached the wallet: it asked the fullnode for the height at start.
      const heightAtStart = await wallet.storage.getCurrentHeight();
      expect(heightAtStart).toBeGreaterThanOrEqual(heightBeforeStart);
      expect(heightAtStart).toBeLessThan(block.height);

      // Once the height messages flow, the reward unlocks as the height passes the lock.
      dashboard.release();
      await waitForHeight(wallet, block.height + rewardLock);
      expect(await htrBalanceOnceAt(wallet, { unlocked: block.reward, locked: 0n })).toEqual({
        unlocked: block.reward,
        locked: 0n,
      });
    }
  );
});
