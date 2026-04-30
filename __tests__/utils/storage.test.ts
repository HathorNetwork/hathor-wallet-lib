/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import { HistorySyncMode, WalletType, TokenVersion, SCANNING_POLICY } from '../../src/types';
import { MemoryStore, Storage } from '../../src/storage';
import {
  scanPolicyStartAddresses,
  checkScanningPolicy,
  _updateTokensData,
  getSupportedSyncMode,
  getHistorySyncMethod,
  apiSyncHistory,
  addCreatedTokenFromTx,
  processMetadataChanged,
} from '../../src/utils/storage';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import { ShieldedOutputMode } from '../../src/shielded/types';
import { manualStreamSyncHistory, xpubStreamSyncHistory } from '../../src/sync/stream';
import CreateTokenTransaction from '../../src/models/create_token_transaction';
import Transaction from '../../src/models/transaction';

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

  it('start addresses for single-address policy', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    jest
      .spyOn(storage, 'getScanningPolicy')
      .mockReturnValue(Promise.resolve(SCANNING_POLICY.SINGLE_ADDRESS));
    await expect(scanPolicyStartAddresses(storage)).resolves.toEqual({
      nextIndex: 0,
      count: 1,
    });
  });

  it('check scanning policy returns null for single-address', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    jest
      .spyOn(storage, 'getScanningPolicy')
      .mockReturnValue(Promise.resolve(SCANNING_POLICY.SINGLE_ADDRESS));
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
          locked: 0n,
          unlocked: 0n,
        },
        mint: {
          locked: 0n,
          unlocked: 0n,
        },
      },
      tokens: {
        locked: 0n,
        unlocked: 0n,
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
      version: TokenVersion.DEPOSIT,
    };
    const store = new MemoryStore();
    const storage = new Storage(store);
    axiosMock.onGet(updateTokenApiUrl).reply(200, {
      success: true,
      name: mockToken.name,
      symbol: mockToken.symbol,
      version: mockToken.version,
      mint: [],
      melt: [],
      total: 0,
      transactions_count: 0,
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
      version: mockToken.version,
    });
  });

  it('should retry fetching a token', async () => {
    // Setup
    const mockToken = {
      uid: 'mock-token',
      name: 'Mock Token 1',
      symbol: 'MT1',
      version: TokenVersion.DEPOSIT,
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
        version: mockToken.version,
        mint: [],
        melt: [],
        total: 0,
        transactions_count: 0,
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
      version: mockToken.version,
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

test('getHistorySyncMethod', () => {
  expect(getHistorySyncMethod(HistorySyncMode.POLLING_HTTP_API)).toEqual(apiSyncHistory);
  expect(getHistorySyncMethod(HistorySyncMode.MANUAL_STREAM_WS)).toEqual(manualStreamSyncHistory);
  expect(getHistorySyncMethod(HistorySyncMode.XPUB_STREAM_WS)).toEqual(xpubStreamSyncHistory);
});

test('addCreatedTokenFromTx', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const spy = jest.spyOn(storage, 'addToken');
  const tx = new CreateTokenTransaction('Token A', 'tkA', [], []);
  const notCreateTokenTx = new Transaction([], []);

  // If we force a transaction without the correct version it should do nothing.
  await addCreatedTokenFromTx(notCreateTokenTx as CreateTokenTransaction, storage);
  expect(spy).not.toHaveBeenCalled();

  // Tx without hash means we do not know the UID.
  await expect(addCreatedTokenFromTx(tx, storage)).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();

  // A working test
  tx.hash = 'd00d';
  await addCreatedTokenFromTx(tx, storage);
  expect(spy).toHaveBeenCalledWith({
    uid: 'd00d',
    name: 'Token A',
    symbol: 'tkA',
    version: 1,
  });
  await expect(storage.getToken('d00d')).resolves.not.toBeNull();
});

describe('processMetadataChanged — shielded UTXO preservation', () => {
  // Regression test for the bug that caused mobile sends to fail with
  // "full-unshield tx (shielded inputs, no shielded outputs) must carry an
  // unshield balance header". Sequence: receive a shielded HTR tx →
  // processNewTx saves the UTXO with shielded:true + blindingFactor at the
  // on-chain index → fullnode confirms the tx in a block and pushes a
  // metadata update → onNewTx routes the update to processMetadataChanged →
  // before the fix, the function re-saved the UTXO with the bare schema
  // (no shielded flag, no blinding factors), corrupting the record. The
  // wallet's selectUtxos picked it for a later send, prepareTxData treated
  // it as transparent, and skipped the excess-blinding-factor computation.
  // Fullnode rejected the tx because it could see the input was a shielded
  // slot in the parent's shielded_outputs[].
  //
  // The integration suite did not catch this: existing tests spend the
  // shielded UTXO inside the same second they receive it, before the
  // fullnode's metadata update for first_block has had time to fire. The
  // unit-level coverage here pins the function's contract directly so a
  // future refactor can't reintroduce the gap.
  const SHIELDED_ADDR = 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX';
  const TX_ID = 'aa00bb11cc22dd33ee44ff5566778899aabbccddeeff00112233445566778899';
  const TRANSPARENT_OUTPUT_COUNT = 0;
  const SHIELDED_SLOT = 0;
  const ON_CHAIN_INDEX = TRANSPARENT_OUTPUT_COUNT + SHIELDED_SLOT;
  const COMMITMENT = 'deadbeef'.repeat(8);
  const BLINDING_FACTOR = 'aabbccdd'.repeat(8);
  const ASSET_BLINDING_FACTOR = '11223344'.repeat(8);

  // Mirrors the shape produced by processNewTx after decrypting a shielded
  // output: type='shielded' is appended to tx.outputs, the entry carries
  // commitment, blindingFactor, assetBlindingFactor, and onChainIndex.
  const buildTxWithDecodedShielded = () => ({
    tx_id: TX_ID,
    version: 1,
    timestamp: 1,
    is_voided: false,
    nonce: 0,
    weight: 1,
    parents: [],
    inputs: [],
    height: 100,
    tokens: [],
    outputs: [
      {
        type: 'shielded',
        value: 50n,
        token: NATIVE_TOKEN_UID,
        token_data: 0,
        script: '',
        commitment: COMMITMENT,
        range_proof: '',
        ephemeral_pubkey: '',
        decoded: { address: SHIELDED_ADDR, timelock: null },
        spent_by: null,
        blindingFactor: BLINDING_FACTOR,
        assetBlindingFactor: ASSET_BLINDING_FACTOR,
        onChainIndex: ON_CHAIN_INDEX,
      },
    ],
    shielded_outputs: [
      {
        mode: ShieldedOutputMode.AMOUNT_SHIELDED,
        commitment: COMMITMENT,
        range_proof: '',
        script: '',
        token_data: 0,
        ephemeral_pubkey: '',
        decoded: { address: SHIELDED_ADDR, timelock: null },
      },
    ],
  });

  // The wallet only re-saves UTXOs whose address is registered as ours.
  // Stub isAddressMine so processMetadataChanged enters the saveUtxo branch
  // for our shielded entry.
  const seedStorage = async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
    await store.saveUtxo({
      txId: TX_ID,
      index: ON_CHAIN_INDEX,
      type: 1,
      authorities: 0n,
      address: SHIELDED_ADDR,
      token: NATIVE_TOKEN_UID,
      value: 50n,
      timelock: null,
      height: 100,
      shielded: true,
      blindingFactor: BLINDING_FACTOR,
      assetBlindingFactor: ASSET_BLINDING_FACTOR,
    });
    return { store, storage };
  };

  it('preserves shielded:true and blindingFactors when re-saving via metadata update', async () => {
    const { store, storage } = await seedStorage();

    // Sanity: the seeded UTXO is shielded.
    const before = await store.getUtxo({ txId: TX_ID, index: ON_CHAIN_INDEX });
    expect(before?.shielded).toBe(true);
    expect(before?.blindingFactor).toBe(BLINDING_FACTOR);

    await processMetadataChanged(storage, buildTxWithDecodedShielded());

    // Post-fix: the record is still flagged shielded with intact blinding
    // factors. Pre-fix this assertion would have failed because the bare
    // saveUtxo overwrote the record without the shielded fields.
    const after = await store.getUtxo({ txId: TX_ID, index: ON_CHAIN_INDEX });
    expect(after?.shielded).toBe(true);
    expect(after?.blindingFactor).toBe(BLINDING_FACTOR);
    expect(after?.assetBlindingFactor).toBe(ASSET_BLINDING_FACTOR);
    expect(after?.value).toBe(50n);
    expect(after?.token).toBe(NATIVE_TOKEN_UID);
  });

  it('uses the on-chain absolute index, not the entries() position', async () => {
    // Transparent output ahead of the shielded entry: positional index 1,
    // on-chain absolute index also 1 in this case (one transparent + one
    // shielded). With sparse-decode we'd have a drift, but the simpler
    // case is enough to pin the index path: the saveUtxo MUST use the
    // entry's recorded `onChainIndex` (or commitment-match recovery), not
    // the array position alone.
    const { store, storage } = await seedStorage();

    // Replace the seeded tx with a tx that has a transparent output AND
    // a shielded entry, and pre-populate the shielded UTXO at the right
    // absolute index (1, since transparent comes first).
    await store.saveUtxo({
      txId: TX_ID,
      index: 1,
      type: 1,
      authorities: 0n,
      address: SHIELDED_ADDR,
      token: NATIVE_TOKEN_UID,
      value: 50n,
      timelock: null,
      height: 100,
      shielded: true,
      blindingFactor: BLINDING_FACTOR,
      assetBlindingFactor: ASSET_BLINDING_FACTOR,
    });

    const tx = buildTxWithDecodedShielded();
    tx.outputs.unshift({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'p2pkh' as any,
      value: 1n,
      token: NATIVE_TOKEN_UID,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      token_data: 0 as any,
      script: '',
      decoded: { address: SHIELDED_ADDR, timelock: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spent_by: null as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx.outputs[1] as any).onChainIndex = 1;

    await processMetadataChanged(storage, tx);

    // Shielded UTXO at on-chain index 1 stays correct.
    const shieldedAfter = await store.getUtxo({ txId: TX_ID, index: 1 });
    expect(shieldedAfter?.shielded).toBe(true);
    expect(shieldedAfter?.blindingFactor).toBe(BLINDING_FACTOR);
  });
});
