/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import { HistorySyncMode, WalletType } from '../../src/types';
import { MemoryStore, Storage } from '../../src/storage';
import {
  scanPolicyStartAddresses,
  checkScanningPolicy,
  _updateTokensData,
  getSupportedSyncMode,
  getHistorySyncMethod,
  apiSyncHistory,
} from '../../src/utils/storage';
import { manualStreamSyncHistory, xpubStreamSyncHistory } from '../../src/sync/stream';

describe('scanning policy methods', () => {
  it('start addresses', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const gapLimit = 27;
    jest.spyOn(storage, 'getGapLimit').mockReturnValue(Promise.resolve(gapLimit));
    jest.spyOn(storage, 'getScanningPolicy').mockReturnValue(Promise.resolve('gap-limit'));
    await expect(scanPolicyStartAddresses(storage)).resolves.toEqual({
      nextIndex: 0,
      count: gapLimit,
    });
  });

  it('check address scanning policy', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const gapLimit = 27;
    jest.spyOn(storage, 'getScanningPolicyData').mockReturnValue(
      Promise.resolve({
        policy: 'gap-limit',
        gapLimit,
      })
    );
    const policyMock = jest.spyOn(storage, 'getScanningPolicy');

    policyMock.mockReturnValue(Promise.resolve('gap-limit'));
    await expect(checkScanningPolicy(storage)).resolves.toEqual({
      nextIndex: 1,
      count: 26,
    });

    policyMock.mockReturnValue(Promise.resolve('invalid-policy'));
    await expect(checkScanningPolicy(storage)).resolves.toEqual(null);
  });
});

describe('_updateTokensData', () => {
  let axiosMock;
  const updateTokenApiUrl = 'thin_wallet/token';
  const sampleTokensAPIOutput = {
    balance: {
      authorities: {
        melt: {
          locked: 0,
          unlocked: 0,
        },
        mint: {
          locked: 0,
          unlocked: 0,
        },
      },
      tokens: {
        locked: 0,
        unlocked: 0,
      },
    },
    name: '',
    numTransactions: 0,
    symbol: '',
    uid: '',
  };

  /**
   * Helper function to iterate the `getAllTokens` generator function and output an array of tokens
   * @param storage
   * @returns {Promise<*[]>}
   */
  async function getAllTokensArray(storage) {
    const results = [];
    for await (const value of storage.getAllTokens()) {
      results.push(value);
    }
    return results;
  }

  beforeEach(() => {
    axiosMock = new MockAdapter(axios);
  });

  afterEach(() => {
    axiosMock.restore();
  });

  it('should handle empty tokens parameter', async () => {
    // Setup
    const store = new MemoryStore();
    const storage = new Storage(store);
    axiosMock.onGet(updateTokenApiUrl).reply(200);

    // Execute
    const result = await _updateTokensData(storage, new Set());

    // Verify
    expect(result).toStrictEqual(undefined); // Method has void return
    expect(await getAllTokensArray(storage)).toHaveLength(0); // No tokens added
    expect(axiosMock.history.get).toHaveLength(0); // No API calls made
  });

  it('should handle a single token parameter', async () => {
    // Setup
    const mockToken = {
      uid: 'mock-token',
      name: 'Mock Token 1',
      symbol: 'MT1',
    };
    const store = new MemoryStore();
    const storage = new Storage(store);
    axiosMock.onGet(updateTokenApiUrl).reply(200, {
      success: true,
      name: mockToken.name,
      symbol: mockToken.symbol,
    });

    // Execute
    const tokensSet = new Set();
    tokensSet.add(mockToken.uid);
    await _updateTokensData(storage, tokensSet);

    // Verify
    expect(await getAllTokensArray(storage)).toHaveLength(1);
    expect(axiosMock.history.get).toHaveLength(1);
    expect(await storage.getToken(mockToken.uid)).toStrictEqual({
      ...sampleTokensAPIOutput,
      name: mockToken.name,
      symbol: mockToken.symbol,
      uid: mockToken.uid,
    });
  });

  it('should retry fetching a token', async () => {
    // Setup
    const mockToken = {
      uid: 'mock-token',
      name: 'Mock Token 1',
      symbol: 'MT1',
    };
    const store = new MemoryStore();
    const storage = new Storage(store);
    // The method should try 1 time and retry 5 times before throwing
    axiosMock
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(200, {
        success: true,
        name: mockToken.name,
        symbol: mockToken.symbol,
      });

    // Execute
    const tokensSet = new Set();
    tokensSet.add('mock-token');
    jest.useFakeTimers();
    const promiseObj = _updateTokensData(storage, tokensSet);
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await expect(promiseObj).resolves.toEqual(undefined); // A void resolution, but with no failure

    // Verify
    expect(await getAllTokensArray(storage)).toHaveLength(1);
    expect(axiosMock.history.get).toHaveLength(6);
    expect(await storage.getToken(mockToken.uid)).toStrictEqual({
      ...sampleTokensAPIOutput,
      name: mockToken.name,
      symbol: mockToken.symbol,
      uid: mockToken.uid,
    });
  });

  it('should fail if there were too many retries', async () => {
    // Setup
    const mockToken = {
      uid: 'mock-token',
      name: 'Mock Token 1',
      symbol: 'MT1',
    };
    const store = new MemoryStore();
    const storage = new Storage(store);
    // The method should try 1 time and retry 5 times before throwing
    axiosMock
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(200, {
        success: true,
        name: mockToken.name,
        symbol: mockToken.symbol,
      });

    // Execute
    const tokensSet = new Set();
    tokensSet.add('mock-token');
    jest.useFakeTimers();
    const promiseObj = _updateTokensData(storage, tokensSet).catch(
      err => `Catched error: ${err.message}`
    );
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await expect(promiseObj).resolves.toEqual(
      `Catched error: Too many attempts at fetchTokenData for ${mockToken.uid}`
    );

    // Verify
    expect(await getAllTokensArray(storage)).toHaveLength(0);
    expect(axiosMock.history.get).toHaveLength(6);
    expect(await storage.getToken(mockToken.uid)).toEqual(null);
  });

  it('should delay with exponential backoffs', async () => {
    // Setup
    const mockToken = {
      uid: 'mock-token',
      name: 'Mock Token 1',
      symbol: 'MT1',
    };
    const store = new MemoryStore();
    const storage = new Storage(store);
    // The method should try 1 time and retry 5 times before throwing
    axiosMock
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(500)
      .onGet(updateTokenApiUrl)
      .replyOnce(200, {
        success: true,
        name: mockToken.name,
        symbol: mockToken.symbol,
      });

    // Execute
    const tokensSet = new Set();
    tokensSet.add('mock-token');
    jest.useFakeTimers();
    let beforeTime;
    let afterTime;
    const promiseObj = _updateTokensData(storage, tokensSet).catch(
      err => `Catched error: ${err.message}`
    );
    beforeTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    afterTime = jest.now();
    expect(afterTime - beforeTime).toEqual(500);

    beforeTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    afterTime = jest.now();
    expect(afterTime - beforeTime).toEqual(1000);

    beforeTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    afterTime = jest.now();
    expect(afterTime - beforeTime).toEqual(2000);

    beforeTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    afterTime = jest.now();
    expect(afterTime - beforeTime).toEqual(4000);

    beforeTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    afterTime = jest.now();
    expect(afterTime - beforeTime).toEqual(8000);

    beforeTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    afterTime = jest.now();
    expect(afterTime - beforeTime).toEqual(16000);

    await expect(promiseObj).resolves.toEqual(
      `Catched error: Too many attempts at fetchTokenData for ${mockToken.uid}`
    );

    // Verify
    expect(axiosMock.history.get).toHaveLength(6);
  });
});

test('getSupportedSyncMode', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.getWalletType = jest.fn().mockReturnValue(Promise.resolve(WalletType.P2PKH));
  await expect(getSupportedSyncMode(storage)).resolves.toEqual([
    HistorySyncMode.MANUAL_STREAM_WS,
    HistorySyncMode.POLLING_HTTP_API,
    HistorySyncMode.XPUB_STREAM_WS,
  ]);
  storage.getWalletType = jest.fn().mockReturnValue(Promise.resolve(WalletType.MULTISIG));
  await expect(getSupportedSyncMode(storage)).resolves.toEqual([HistorySyncMode.POLLING_HTTP_API]);

  storage.getWalletType = jest.fn().mockReturnValue(Promise.resolve(''));
  await expect(getSupportedSyncMode(storage)).resolves.toEqual([]);
});

test('getHistorySyyncMethod', () => {
  expect(getHistorySyncMethod(HistorySyncMode.POLLING_HTTP_API)).toEqual(apiSyncHistory);
  expect(getHistorySyncMethod(HistorySyncMode.MANUAL_STREAM_WS)).toEqual(manualStreamSyncHistory);
  expect(getHistorySyncMethod(HistorySyncMode.XPUB_STREAM_WS)).toEqual(xpubStreamSyncHistory);
});
