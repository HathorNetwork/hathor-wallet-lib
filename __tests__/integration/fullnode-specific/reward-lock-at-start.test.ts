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
import walletApi, { MiningInfoBestEffortResponse } from '../../../src/api/wallet';
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

/**
 * Lets exactly one of the fullnode's dashboard messages reach the wallet: the first one sent once
 * the wallet is syncing, when its first history sync waits for the network height. The others are
 * dropped, so the height the wallet stores stays the one this message carried.
 *
 * @returns The height that message carried
 */
function deliverOneDashboardMessageOnceSyncing(connection: Connection, wallet: HathorWallet) {
  const { websocket } = connection;
  if (!websocket) {
    throw new Error('The connection has no websocket');
  }
  const deliver = websocket.emit.bind(websocket);
  let syncing = false;
  let delivered = false;
  wallet.on('state', state => {
    if (state === HathorWallet.SYNCING) {
      syncing = true;
    }
  });
  return new Promise<number>(resolve => {
    jest.spyOn(websocket, 'emit').mockImplementation((event, ...args) => {
      if (event !== 'dashboard') {
        return deliver(event, ...args);
      }
      if (!syncing || delivered) {
        return true;
      }
      delivered = true;
      resolve((args[0] as { best_block_height: number }).best_block_height);
      return deliver(event, ...args);
    });
  });
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

  const noHeightAtStart: [string, () => Promise<MiningInfoBestEffortResponse>][] = [
    [
      'the fullnode answers without its height',
      () => Promise.resolve({ height: null, message: 'no synced peer' }),
    ],
    [
      'the height request fails',
      () =>
        Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    ],
  ];

  it.each(noHeightAtStart)(
    'should take the network height from the websocket before the first history walk when %s',
    async (_case, answer) => {
      const heightRequest = jest
        .spyOn(walletApi, 'getMiningInfoBestEffort')
        .mockImplementation(answer);
      const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
      const connection = generateConnection();
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
      const websocketHeight = deliverOneDashboardMessageOnceSyncing(connection, wallet);
      const warn = jest.spyOn(wallet.logger, 'warn');

      // The reward is mined when the wallet connects, before the first history walk.
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

      await wallet.start();
      expect(mined).toHaveLength(1);
      const [block] = await Promise.all([mined[0], waitForWalletReady(wallet)]);

      // start() got no height and said the first sync would wait for the websocket's, which came.
      expect(heightRequest).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('waits up to'), expect.anything());
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('either'));

      // The walk ran with the height of the one dashboard message the wallet got.
      const height = await websocketHeight;
      expect(height).toBeGreaterThanOrEqual(block.height);
      expect(await wallet.storage.getCurrentHeight()).toBe(height);
      expect(await wallet.storage.getTx(block.txId)).toMatchObject({ height: block.height });

      // The test network mines a block a second and locks rewards for one block, so that height
      // may already be past the lock. The reward counts as locked exactly when it is not.
      const rewardLock = wallet.storage.version!.reward_spend_min_blocks;
      const locked = height < block.height + rewardLock ? block.reward : 0n;
      const [{ balance }] = await wallet.getBalance(NATIVE_TOKEN_UID);
      expect(balance).toEqual({ unlocked: block.reward - locked, locked });
    }
  );
});
