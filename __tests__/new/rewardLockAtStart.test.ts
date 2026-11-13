/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import HathorWallet from '../../src/new/wallet';
import Connection from '../../src/new/connection';
import { MemoryStore, Storage } from '../../src/storage';
import versionApi from '../../src/api/version';
import walletApi from '../../src/api/wallet';
import {
  defaultCreateRequestInstance,
  registerNewCreateRequestInstance,
} from '../../src/api/axiosInstance';
import { handleWsDashboard } from '../../src/utils/connection';
import { NATIVE_TOKEN_UID, NETWORK_HEIGHT_TIMEOUT } from '../../src/constants';
import { WalletStoppedError } from '../../src/errors';
import { ConnectionState } from '../../src/wallet/types';
import { IHistoryTx, ILogger, IWalletAccessData } from '../../src/types';
import walletUtils from '../../src/utils/wallet';

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
      // Where the dashboard messages come from; nothing emits them unless a test does.
      websocket: new EventEmitter(),
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

  /** The getmininginfo answer waits until release() is called, before or after the request. */
  function deferMiningInfo(data: unknown) {
    let released = false;
    let answer: () => void = () => {};
    axiosMock.onGet('getmininginfo').reply(
      () =>
        new Promise(resolve => {
          answer = () => resolve([200, data]);
          if (released) {
            answer();
          }
        })
    );
    return () => {
      released = true;
      answer();
    };
  }

  function miningInfoRequests() {
    return axiosMock.history.get.filter(request => request.url === 'getmininginfo').length;
  }

  // Deriving the access data from the seed takes seconds, so each wallet starts
  // from a copy of the one this file derives once.
  let accessData: IWalletAccessData;
  beforeAll(() => {
    accessData = walletUtils.generateAccessDataFromSeed(seed, {
      pin: '123',
      password: '456',
      networkName: 'testnet',
    });
  });

  async function buildWallet<C = ReturnType<typeof makeConn>>(conn: C = makeConn() as C) {
    const store = new MemoryStore();
    const storage = new Storage(store);
    await storage.saveAccessData(structuredClone(accessData));
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

  /** A wallet buildWallet made on the mock connection. */
  type MockWallet = Awaited<ReturnType<typeof buildWallet<ReturnType<typeof makeConn>>>>;

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

  /** Let every pending promise chain run, including the axios mock's answers. */
  async function flush(): Promise<void> {
    await new Promise(resolve => {
      setImmediate(resolve);
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
    const { hWallet, store, conn, logger } = await buildWallet();
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
    const { hWallet, store, storage, conn } = await buildWallet();
    let heightAtConnect: number | undefined;
    conn.start.mockImplementation(() => {
      heightAtConnect = store.walletData.bestBlockHeight;
    });
    // The last step before start() waits for the height.
    let versionDone = false;
    const saveNativeToken = storage.saveNativeToken.bind(storage);
    jest.spyOn(storage, 'saveNativeToken').mockImplementation(async () => {
      await saveNativeToken();
      versionDone = true;
    });

    const starting = hWallet.start();
    await until(() => versionDone && miningInfoRequests() === 1, 'the version');
    await flush();
    expect(conn.start).not.toHaveBeenCalled();

    release();
    await starting;

    expect(conn.start).toHaveBeenCalledTimes(1);
    expect(heightAtConnect).toBe(1234);
  });

  it('asks for the height with its own timeout', async () => {
    mockVersion();
    mockMiningInfo({ success: true, blocks: 1234 });
    const { hWallet } = await buildWallet();

    await hWallet.start();

    // The adapter records each request with the timeout axios applied to it.
    const request = axiosMock.history.get.find(r => r.url === 'getmininginfo');
    expect(request?.timeout).toBe(NETWORK_HEIGHT_TIMEOUT);
  });

  it('replaces a height kept from an earlier session', async () => {
    mockVersion();
    mockMiningInfo({ success: true, blocks: 50 });
    const { hWallet, storage } = await buildWallet();
    await storage.setCurrentHeight(99999);

    await hWallet.start();

    await expect(storage.getCurrentHeight()).resolves.toBe(50);
  });

  it('does not send the request through the instance an app registered', async () => {
    mockVersion();
    mockMiningInfo({ success: true, blocks: 1234 });
    const appInstance = jest.fn(defaultCreateRequestInstance);
    registerNewCreateRequestInstance(appInstance);
    const { hWallet, storage } = await buildWallet();

    await hWallet.start();

    expect(appInstance).not.toHaveBeenCalled();
    await expect(storage.getCurrentHeight()).resolves.toBe(1234);
  });

  it.each([
    { failure: 'an HTTP error', fail: () => axiosMock.onGet('getmininginfo').reply(500) },
    { failure: 'a network error', fail: () => axiosMock.onGet('getmininginfo').networkError() },
    { failure: 'a timeout', fail: () => axiosMock.onGet('getmininginfo').timeout() },
  ])('still connects after $failure', async ({ fail }) => {
    mockVersion();
    fail();
    const { hWallet, storage, conn, logger } = await buildWallet();
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
    const { hWallet, storage, conn, logger } = await buildWallet();
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
    const { hWallet, storage, conn } = await buildWallet();

    await expect(hWallet.start()).rejects.toThrow('Wrong network');

    expect(conn.start).not.toHaveBeenCalled();
    await expect(storage.getCurrentHeight()).resolves.toBe(0);
  });

  it('logs nothing when the version request fails while the height is pending', async () => {
    jest
      .spyOn(versionApi, 'getVersion')
      .mockImplementation(() => Promise.reject(new Error('Network Error')) as never);
    const release = deferMiningInfo({ success: false, message: 'Node still syncing' });
    const { hWallet, storage, conn, logger } = await buildWallet();

    await expect(hWallet.start()).rejects.toThrow('Network Error');
    release();
    await flush();

    expect(conn.start).not.toHaveBeenCalled();
    await expect(storage.getCurrentHeight()).resolves.toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('neither stores the height nor connects for a start() that stop() interrupted', async () => {
    mockVersion();
    const release = deferMiningInfo({ success: true, blocks: 5000 });
    const { hWallet, storage, conn } = await buildWallet();

    const starting = hWallet.start();
    await until(() => miningInfoRequests() === 1, 'the height request');
    await hWallet.stop();
    release();
    await expect(starting).rejects.toThrow(WalletStoppedError);

    expect(conn.start).not.toHaveBeenCalled();
    await expect(storage.getCurrentHeight()).resolves.toBe(0);
  });

  it('leaves the height and the connection to the start() that followed the stop()', async () => {
    mockVersion();
    // The first start() gets its height only after the second one connected.
    let releaseFirst: () => void = () => {};
    let requests = 0;
    axiosMock.onGet('getmininginfo').reply(() => {
      requests += 1;
      if (requests === 1) {
        return new Promise(resolve => {
          releaseFirst = () => resolve([200, { success: true, blocks: 5000 }]);
        });
      }
      return [200, { success: true, blocks: 6000 }];
    });
    const { hWallet, storage, conn } = await buildWallet();

    const first = hWallet.start();
    await until(() => requests === 1, 'the first height request');
    await hWallet.stop();
    await hWallet.start();
    expect(conn.start).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).rejects.toThrow(WalletStoppedError);

    expect(requests).toBe(2);
    expect(conn.start).toHaveBeenCalledTimes(1);
    await expect(storage.getCurrentHeight()).resolves.toBe(6000);
  });

  it('leaves the session of the start() that followed the stop() to it when the old one fails', async () => {
    mockVersion();
    // The first version request fails only after the second start() connected.
    let failFirst: () => void = () => {};
    const getVersion = jest.spyOn(versionApi, 'getVersion').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = () => reject(new Error('Network Error'));
        }) as never
    );
    mockMiningInfo({ success: true, blocks: 6000 });
    const { hWallet, storage, conn } = await buildWallet();

    const first = hWallet.start();
    await until(() => getVersion.mock.calls.length === 1, 'the first version request');
    await hWallet.stop();
    await hWallet.start();
    expect(storage.shieldedView.started).toBe(true);

    failFirst();
    await expect(first).rejects.toMatchObject({
      errorCode: 'wallet-stopped',
      cause: new Error('Network Error'),
    });

    expect(storage.shieldedView.started).toBe(true);
    expect(conn.start).toHaveBeenCalledTimes(1);
    await expect(storage.getCurrentHeight()).resolves.toBe(6000);
  });

  it('does not connect a wallet that stop() stopped before start() cleared walletStopped', async () => {
    mockVersion();
    const { hWallet, store, conn } = await buildWallet();
    let validated: () => void = () => {};
    let validating = false;
    jest.spyOn(store, 'validate').mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          validating = true;
          validated = resolve;
        })
    );

    const starting = hWallet.start();
    await until(() => validating, 'the store validation');
    await hWallet.stop();
    validated();

    await expect(starting).rejects.toThrow(WalletStoppedError);
    expect(hWallet.walletStopped).toBe(true);
    expect(miningInfoRequests()).toBe(0);
    expect(conn.start).not.toHaveBeenCalled();
  });

  it('takes the height from the dashboard messages after a stop() and another start()', async () => {
    mockVersion();
    mockMiningInfo({ success: true, blocks: 100 });
    // A real connection, whose websocket never opens: stop() closes it, which
    // drops every listener on it, as with a fullnode.
    const conn = new Connection({
      network: 'testnet',
      servers: ['https://fullnode/v1a/'],
      logger: makeLogger(),
    });
    const ws = conn.websocket!;
    jest.spyOn(ws, 'setup').mockImplementation(() => {});
    const { hWallet, store } = await buildWallet(conn);

    await hWallet.start();
    await hWallet.stop();
    await hWallet.start();
    expect(store.walletData.bestBlockHeight).toBe(100);

    ws.emit('dashboard', { best_block_height: 500 });
    await until(() => store.walletData.bestBlockHeight === 500, 'the dashboard height');

    await hWallet.stop();
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

    async function syncWithRewards({
      miningInfo = () => mockMiningInfo({ success: true, blocks: HEIGHT }),
      whileSyncing = async () => {},
    }: {
      miningInfo?: () => void;
      whileSyncing?: (ctx: MockWallet) => Promise<void>;
    } = {}) {
      mockVersion('testnet', 300);
      miningInfo();
      const ctx = await buildWallet();
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

      // Unless whileSyncing sends one, no dashboard message comes.
      const syncing = ctx.hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
      await whileSyncing(ctx);
      await syncing;
      await until(() => ctx.hWallet.isReady(), 'the first walk');
      return { ...ctx, address0 };
    }

    async function htrBalance(hWallet: HathorWallet) {
      const [balance] = await hWallet.getBalance(NATIVE_TOKEN_UID);
      return balance.balance;
    }

    it('counts a reward inside the reward lock as locked at READY', async () => {
      const wait = jest.spyOn(HathorWallet.prototype, 'waitNetworkHeightFromWebsocket');
      const { hWallet, store, address0 } = await syncWithRewards();

      // With the height from start(), the sync does not wait for the websocket.
      expect(wait).not.toHaveBeenCalled();
      await expect(htrBalance(hWallet)).resolves.toEqual({ unlocked: REWARD, locked: REWARD });
      expect([...store.lockedUtxos.keys()]).toEqual([`${recentId}:0`]);
      const info = await hWallet.getAddressInfo(address0);
      expect(info.total_amount_locked).toBe(REWARD);
      expect(info.total_amount_available).toBe(REWARD);

      await hWallet.stop();
    }, 30000);

    it('takes the height from the websocket when start() got none', async () => {
      const { hWallet, store, logger } = await syncWithRewards({
        miningInfo: () => axiosMock.onGet('getmininginfo').reply(500),
        whileSyncing: async ({ conn }) => {
          await until(() => conn.websocket.listenerCount('dashboard') === 1, 'the wait');
          conn.websocket.emit('dashboard', { best_block_height: HEIGHT });
        },
      });

      await expect(htrBalance(hWallet)).resolves.toEqual({ unlocked: REWARD, locked: REWARD });
      expect([...store.lockedUtxos.keys()]).toEqual([`${recentId}:0`]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toMatch(/waits up to 2 s for the websocket/);

      await hWallet.stop();
    }, 30000);

    it('loads the history without a height when the websocket gives none in time either', async () => {
      const { hWallet, conn, logger } = await syncWithRewards({
        miningInfo: () => axiosMock.onGet('getmininginfo').reply(500),
      });

      // The race this cannot close: the recent reward counts unlocked.
      await expect(htrBalance(hWallet)).resolves.toEqual({ unlocked: 2n * REWARD, locked: 0n });
      expect(conn.websocket.listenerCount('dashboard')).toBe(0);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn.mock.calls[1][0]).toMatch(/^The websocket gave no network height/);

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
