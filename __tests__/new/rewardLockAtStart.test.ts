/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../src/new/wallet';
import { MemoryStore, Storage } from '../../src/storage';
import versionApi from '../../src/api/version';
import walletApi from '../../src/api/wallet';
import {
  defaultCreateRequestInstance,
  registerNewCreateRequestInstance,
} from '../../src/api/axiosInstance';
import { handleWsDashboard } from '../../src/utils/connection';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import { ConnectionState } from '../../src/wallet/types';
import { IHistoryTx, ILogger } from '../../src/types';

/**
 * The network height a wallet uses to count block rewards as reward-locked.
 *
 * The first history walk reads the height once, and only rewards it counts
 * locked enter the locked-utxo index that unlocks them later. The fullnode's
 * websocket brings the height only with its dashboard metrics, every second and
 * not on connect, so start() asks the fullnode for it before connecting.
 */
describe('network height at start()', () => {
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

  // The axios mock from setupTests.js, shared by the whole test file
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const axiosMock = (global as any).mock;

  function makeConn() {
    return {
      getState: jest.fn().mockReturnValue(ConnectionState.CLOSED),
      getCurrentServer: jest.fn().mockReturnValue('https://fullnode'),
      getCurrentNetwork: jest.fn().mockReturnValue('testnet'),
      startControlHandlers: jest.fn(),
      removeMetricsHandlers: jest.fn(),
      on: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      onReload: jest.fn().mockResolvedValue(undefined),
      subscribeAddresses: jest.fn(),
      unsubscribeAddress: jest.fn(),
      emit: jest.fn(),
    };
  }

  function makeLogger(): ILogger & { warn: jest.Mock } {
    return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  }

  function mockVersion(network = 'testnet', rewardLock = 300) {
    jest.spyOn(versionApi, 'getVersion').mockImplementation(resolve => {
      resolve({ network, reward_spend_min_blocks: rewardLock } as never);
      return Promise.resolve() as never;
    });
  }

  function mockMiningInfo(data: unknown) {
    axiosMock.onGet('getmininginfo').reply(200, data);
  }

  /** The getmininginfo answer waits until release() is called. */
  function deferMiningInfo(data: unknown) {
    let release: () => void = () => {};
    axiosMock.onGet('getmininginfo').reply(
      () =>
        new Promise(resolve => {
          release = () => resolve([200, data]);
        })
    );
    return () => release();
  }

  function miningInfoRequests() {
    return axiosMock.history.get.filter(request => request.url === 'getmininginfo').length;
  }

  function buildWallet() {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const conn = makeConn();
    const logger = makeLogger();
    const hWallet = new HathorWallet({
      seed,
      storage,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: conn as any,
      password: '456',
      pinCode: '123',
      logger,
    });
    return { hWallet, store, storage, conn, logger };
  }

  async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 500; i++) {
      if (condition()) {
        return;
      }
      await new Promise(resolve => {
        setTimeout(resolve, 10);
      });
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  async function settle(): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, 50);
    });
  }

  beforeEach(() => {
    axiosMock.resetHistory();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    registerNewCreateRequestInstance(defaultCreateRequestInstance);
    // Back to the default from setupTests.js
    mockMiningInfo({ success: true, blocks: 0 });
  });

  it('stores the fullnode height before the websocket starts', async () => {
    mockVersion();
    mockMiningInfo({ success: true, blocks: 1234 });
    const { hWallet, store, conn, logger } = buildWallet();
    let heightAtConnect: number | undefined;
    conn.start.mockImplementation(() => {
      heightAtConnect = store.walletData.bestBlockHeight;
    });

    await hWallet.start();

    expect(miningInfoRequests()).toBe(1);
    expect(conn.start).toHaveBeenCalledTimes(1);
    expect(heightAtConnect).toBe(1234);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('waits for a height that comes after the version', async () => {
    mockVersion();
    const release = deferMiningInfo({ success: true, blocks: 1234 });
    const { hWallet, store, conn } = buildWallet();
    let heightAtConnect: number | undefined;
    conn.start.mockImplementation(() => {
      heightAtConnect = store.walletData.bestBlockHeight;
    });

    const starting = hWallet.start();
    await settle();
    expect(conn.start).not.toHaveBeenCalled();

    release();
    await starting;

    expect(conn.start).toHaveBeenCalledTimes(1);
    expect(heightAtConnect).toBe(1234);
  });

  it('replaces a height kept from an earlier session', async () => {
    mockVersion();
    mockMiningInfo({ success: true, blocks: 50 });
    const { hWallet, storage } = buildWallet();
    await storage.setCurrentHeight(99999);

    await hWallet.start();

    await expect(storage.getCurrentHeight()).resolves.toBe(50);
  });

  it('does not send the request through the instance an app registered', async () => {
    mockVersion();
    mockMiningInfo({ success: true, blocks: 1234 });
    const appInstance = jest.fn(defaultCreateRequestInstance);
    registerNewCreateRequestInstance(appInstance);
    const { hWallet, storage } = buildWallet();

    await hWallet.start();

    expect(appInstance).not.toHaveBeenCalled();
    await expect(storage.getCurrentHeight()).resolves.toBe(1234);
  });

  it.each([
    { failure: 'an HTTP error', fail: () => axiosMock.onGet('getmininginfo').reply(500) },
    { failure: 'a network error', fail: () => axiosMock.onGet('getmininginfo').networkError() },
  ])('still connects after $failure', async ({ fail }) => {
    mockVersion();
    fail();
    const { hWallet, storage, conn, logger } = buildWallet();
    await storage.setCurrentHeight(7);

    await expect(hWallet.start()).resolves.toBeDefined();

    expect(conn.start).toHaveBeenCalledTimes(1);
    await expect(storage.getCurrentHeight()).resolves.toBe(7);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/^Could not get the best block height/);
  });

  it.each([
    { answer: 'success false', data: { success: false, message: 'Node still syncing' } },
    { answer: 'no blocks field', data: { success: true } },
    { answer: 'a negative height', data: { success: true, blocks: -1 } },
    { answer: 'a non-integer height', data: { success: true, blocks: '1234' } },
  ])('keeps the stored height and connects when the fullnode answers $answer', async ({ data }) => {
    mockVersion();
    mockMiningInfo(data);
    const { hWallet, storage, conn, logger } = buildWallet();
    await storage.setCurrentHeight(7);

    await hWallet.start();

    expect(conn.start).toHaveBeenCalledTimes(1);
    await expect(storage.getCurrentHeight()).resolves.toBe(7);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(
      /^The fullnode did not give its best block height/
    );
  });

  it('stores no height on the wrong network', async () => {
    mockVersion('mainnet');
    mockMiningInfo({ success: true, blocks: 1234 });
    const { hWallet, storage, conn } = buildWallet();

    await expect(hWallet.start()).rejects.toThrow('Wrong network');

    expect(conn.start).not.toHaveBeenCalled();
    await expect(storage.getCurrentHeight()).resolves.toBe(0);
  });

  it('logs nothing when the version request fails while the height is pending', async () => {
    jest
      .spyOn(versionApi, 'getVersion')
      .mockImplementation(() => Promise.reject(new Error('Network Error')) as never);
    const release = deferMiningInfo({ success: false, message: 'Node still syncing' });
    const { hWallet, storage, conn, logger } = buildWallet();

    await expect(hWallet.start()).rejects.toThrow('Network Error');
    release();
    await settle();

    expect(conn.start).not.toHaveBeenCalled();
    await expect(storage.getCurrentHeight()).resolves.toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not store the height of a start() that stop() interrupted', async () => {
    mockVersion();
    const release = deferMiningInfo({ success: true, blocks: 5000 });
    const { hWallet, storage } = buildWallet();

    const starting = hWallet.start();
    await settle();
    await hWallet.stop();
    release();
    await starting;

    await expect(storage.getCurrentHeight()).resolves.toBe(0);
  });

  describe('block rewards in the first walk', () => {
    const HEIGHT = 1000;
    const REWARD = 6400n;

    function block(txId: string, height: number, address: string): IHistoryTx {
      return {
        tx_id: txId,
        version: 0,
        weight: 21,
        timestamp: 1700000000 + height,
        is_voided: false,
        nonce: 0,
        inputs: [],
        outputs: [
          {
            value: REWARD,
            token_data: 0,
            script: 'dqkUxNYUKbsnbCQ1Hhj7r65sGRJU7aaIrA==',
            decoded: { type: 'P2PKH', address, timelock: null },
            token: NATIVE_TOKEN_UID,
            spent_by: null,
          },
        ],
        parents: [],
        tokens: [],
        height,
      } as IHistoryTx;
    }

    const recentId = 'aa'.repeat(32);
    const oldId = 'bb'.repeat(32);

    async function syncWithRewards() {
      mockVersion('testnet', 300);
      mockMiningInfo({ success: true, blocks: HEIGHT });
      const ctx = buildWallet();
      await ctx.hWallet.start();
      const address0 = await ctx.hWallet.getAddressAtIndex(0);
      // A reward 10 blocks old, still inside the 300-block lock, and one 400
      // blocks old, already unlocked.
      const history = [
        block(oldId, HEIGHT - 400, address0),
        block(recentId, HEIGHT - 10, address0),
      ];
      jest.spyOn(walletApi, 'getAddressHistoryForAwait').mockImplementation((async (
        addresses: string[]
      ) => ({
        data: {
          success: true,
          has_more: false,
          history: addresses.includes(address0) ? history : [],
        },
      })) as never);

      // No dashboard message comes: the walk only has the height start() stored.
      await ctx.hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
      await until(() => ctx.hWallet.isReady(), 'the first walk');
      return { ...ctx, address0 };
    }

    async function htrBalance(hWallet: HathorWallet) {
      const [balance] = await hWallet.getBalance(NATIVE_TOKEN_UID);
      return balance.balance;
    }

    it('counts a reward inside the reward lock as locked at READY', async () => {
      const { hWallet, store, address0 } = await syncWithRewards();

      await expect(htrBalance(hWallet)).resolves.toEqual({ unlocked: REWARD, locked: REWARD });
      expect([...store.lockedUtxos.keys()]).toEqual([`${recentId}:0`]);
      const info = await hWallet.getAddressInfo(address0);
      expect(info.total_amount_locked).toBe(REWARD);
      expect(info.total_amount_available).toBe(REWARD);

      await hWallet.stop();
    }, 30000);

    it('unlocks the reward when the height passes the lock', async () => {
      const { hWallet, store, storage } = await syncWithRewards();
      await expect(htrBalance(hWallet)).resolves.toEqual({ unlocked: REWARD, locked: REWARD });

      handleWsDashboard(storage)({ best_block_height: HEIGHT + 300 });
      await until(() => store.lockedUtxos.size === 0, 'the unlock pass');
      await storage.utxoUnlockWait;

      await expect(htrBalance(hWallet)).resolves.toEqual({ unlocked: 2n * REWARD, locked: 0n });

      await hWallet.stop();
    }, 30000);

    it('counts a block reward that arrives after READY as locked', async () => {
      const { hWallet, address0 } = await syncWithRewards();
      const newId = 'cc'.repeat(32);

      await hWallet.onNewTx({
        type: 'wallet:address_history',
        history: block(newId, HEIGHT + 1, address0),
      });

      await expect(htrBalance(hWallet)).resolves.toEqual({
        unlocked: REWARD,
        locked: 2n * REWARD,
      });

      await hWallet.stop();
    }, 30000);
  });
});
