/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import {
  HistorySyncMode,
  WalletType,
  TokenVersion,
  SCANNING_POLICY,
  IHistoryTx,
  IUtxo,
} from '../../src/types';
import { MemoryStore, Storage } from '../../src/storage';
import {
  scanPolicyStartAddresses,
  checkScanningPolicy,
  checkGapLimit,
  _updateTokensData,
  getSupportedSyncMode,
  getHistorySyncMethod,
  apiSyncHistory,
  addCreatedTokenFromTx,
  processMetadataChanged,
  processNewTx,
  processSingleTx,
  processHistory,
} from '../../src/utils/storage';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import { ShieldedOutputMode } from '../../src/shielded/types';
import { manualStreamSyncHistory, xpubStreamSyncHistory } from '../../src/sync/stream';
import CreateTokenTransaction from '../../src/models/create_token_transaction';
import Transaction from '../../src/models/transaction';

describe('processNewTx — confidential (shielded) inputs', () => {
  // SEPARATED model: a shielded input carries NO transparent fields
  // (value/token/token_data/decoded are hidden in commitments). processNewTx
  // must skip it via the type-level guard — its balance handling is the
  // receive pipeline's job (next PR). Without the guard the loop dereferences
  // `input.decoded.address` and throws.
  function spendTx(inputs): IHistoryTx {
    return {
      tx_id: 'spend-tx',
      version: 1,
      weight: 1,
      timestamp: 1,
      is_voided: false,
      inputs,
      outputs: [],
      parents: [],
    } as unknown as IHistoryTx;
  }

  it('skips a fully-confidential shielded input (all transparent fields absent)', async () => {
    const storage = new Storage(new MemoryStore());
    const tx = spendTx([{ tx_id: 'parent', index: 0, type: 'shielded' }]);

    const result = await processNewTx(storage, tx, {
      rewardLock: 0,
      nowTs: 1,
      currentHeight: 0,
    });

    // No throw, and the confidential input contributed no token to the metadata.
    expect(result.tokens.size).toBe(0);
  });

  it('skips a partial input missing `decoded` even when token fields are present', async () => {
    const storage = new Storage(new MemoryStore());
    // value/token/token_data present but `decoded` undefined → still skipped by
    // the OR-guard, so the token is never counted and `decoded.address` is
    // never dereferenced.
    const tx = spendTx([{ tx_id: 'parent', index: 0, value: 5n, token: '01', token_data: 1 }]);

    const result = await processNewTx(storage, tx, {
      rewardLock: 0,
      nowTs: 1,
      currentHeight: 0,
    });

    expect(result.tokens.has('01')).toBe(false);
    expect(result.tokens.size).toBe(0);
  });
});

describe('processSingleTx — SEPARATED-model spent-output resolution', () => {
  // The spent-output loop resolves `input.index` (an absolute on-chain index
  // spanning transparent then shielded outputs) via resolveSpentOutput, instead
  // of a positional `outputs[index]` read. These cover the two index-driven
  // branches (the transparent-delete branch needs an owned UTXO and is exercised
  // by the integration suite).
  const baseTx = (fields: Partial<IHistoryTx>): IHistoryTx =>
    ({
      tx_id: 'tx',
      version: 1,
      weight: 1,
      timestamp: 1,
      is_voided: false,
      inputs: [],
      outputs: [],
      parents: [],
      ...fields,
    }) as unknown as IHistoryTx;

  it('throws "Spending an unexistent output" when the input index is past all outputs', async () => {
    const storage = new Storage(new MemoryStore());
    // Parent: 1 transparent output, no shielded → T + S = 1.
    const parent = baseTx({
      tx_id: 'parent',
      outputs: [{ value: 1n, token_data: 0, decoded: {} }],
    } as unknown as Partial<IHistoryTx>);
    await storage.store.saveTx(parent);
    // Spend absolute index 5 (>= T + S) → resolveSpentOutput returns undefined.
    const spend = baseTx({
      tx_id: 'spend',
      inputs: [{ tx_id: 'parent', index: 5 }],
    } as unknown as Partial<IHistoryTx>);
    await expect(processSingleTx(storage, spend)).rejects.toThrow('Spending an unexistent output');
  });

  it('skips a shielded input (index resolves into the shielded range) without throwing', async () => {
    const storage = new Storage(new MemoryStore());
    // Parent: 0 transparent outputs, 1 shielded → absolute index 0 is shielded.
    const parent = baseTx({
      tx_id: 'parent',
      outputs: [],
      shielded_outputs: [{ commitment: 'aa', decoded: {} }],
    } as unknown as Partial<IHistoryTx>);
    await storage.store.saveTx(parent);
    const spend = baseTx({
      tx_id: 'spend',
      inputs: [{ tx_id: 'parent', index: 0, type: 'shielded' }],
    } as unknown as Partial<IHistoryTx>);
    // Resolves to a shielded slot → the transparent-spend loop skips it (the
    // shielded UTXO lifecycle is the receive pipeline's), so no throw.
    await expect(processSingleTx(storage, spend)).resolves.toBeUndefined();
  });

  const savedUtxo = (): IUtxo =>
    ({
      txId: 'parent',
      index: 0,
      token: NATIVE_TOKEN_UID,
      address: 'addr1',
      authorities: 0n,
      value: 5n,
      timelock: null,
      type: 1,
      height: null,
    }) as unknown as IUtxo;

  it('deletes the spent transparent UTXO from the store', async () => {
    const storage = new Storage(new MemoryStore());
    // Parent: 1 transparent output at absolute index 0, with a stored UTXO on it.
    const parent = baseTx({
      tx_id: 'parent',
      outputs: [{ value: 5n, token_data: 0, decoded: { address: 'addr1' } }],
    } as unknown as Partial<IHistoryTx>);
    await storage.store.saveTx(parent);
    await storage.store.saveUtxo(savedUtxo());
    expect(await storage.store.getUtxo({ txId: 'parent', index: 0 })).not.toBeNull();

    const spend = baseTx({
      tx_id: 'spend',
      inputs: [{ tx_id: 'parent', index: 0 }],
    } as unknown as Partial<IHistoryTx>);
    await processSingleTx(storage, spend);

    // fetch-and-delete removed it, so the selector can't re-offer a spent UTXO.
    expect(await storage.store.getUtxo({ txId: 'parent', index: 0 })).toBeNull();
  });

  it('deletes the spent shielded UTXO from the store (absolute index)', async () => {
    const storage = new Storage(new MemoryStore());
    // Parent: 0 transparent + 1 shielded → the shielded UTXO is at absolute index 0.
    const parent = baseTx({
      tx_id: 'parent',
      outputs: [],
      shielded_outputs: [{ commitment: 'aa', decoded: { address: 'addr1' } }],
    } as unknown as Partial<IHistoryTx>);
    await storage.store.saveTx(parent);
    await storage.store.saveUtxo(savedUtxo());
    expect(await storage.store.getUtxo({ txId: 'parent', index: 0 })).not.toBeNull();

    const spend = baseTx({
      tx_id: 'spend',
      inputs: [{ tx_id: 'parent', index: 0, type: 'shielded' }],
    } as unknown as Partial<IHistoryTx>);
    await processSingleTx(storage, spend);

    expect(await storage.store.getUtxo({ txId: 'parent', index: 0 })).toBeNull();
  });
});

describe('processHistory — orchestration', () => {
  afterEach(() => jest.restoreAllMocks());

  it('walks the history oldest-first (order: asc)', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const iterSpy = jest.spyOn(store, 'historyIter');
    await processHistory(storage);
    // asc is load-bearing: a spend's bare-shielded-input enrichment needs the
    // parent decoded + persisted first (see processHistory comment).
    expect(iterSpy).toHaveBeenCalledWith(undefined, { order: 'asc' });
  });

  it('cleans stale metadata before reprocessing (metadata updates are additive)', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const cleanSpy = jest.spyOn(store, 'cleanMetadata');
    await processHistory(storage);
    expect(cleanSpy).toHaveBeenCalled();
  });

  it('skips (does not abort on) a tx whose shielded decode fails systemically, and keeps walking', async () => {
    // A systemic shielded-decode failure — here getScanXPrivKey rejecting, as a
    // wrong-PIN / corrupt-scan-key would — makes processNewTx rethrow. During a
    // full reload that rethrow must NOT abort the whole walk: cleanMetadata() has
    // already wiped balances, so aborting would strand the wallet empty.
    // processHistory catches per-tx, logs, and continues.
    const SHIELDED_ADDR = 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX';
    const TX_A = 'aa'.repeat(32);
    const TX_B = 'bb'.repeat(32);
    const store = new MemoryStore();
    const storage = new Storage(store);
    await store.saveAddress({
      base58: SHIELDED_ADDR,
      bip32AddressIndex: 3,
      publicKey: '02'.repeat(33),
      addressType: 'shielded-spend',
    });

    const buildOwnedShieldedTx = (txId: string, timestamp: number): IHistoryTx =>
      ({
        tx_id: txId,
        version: 1,
        timestamp,
        is_voided: false,
        nonce: 0,
        weight: 1,
        parents: [],
        inputs: [],
        height: 100,
        tokens: [],
        outputs: [],
        shielded_outputs: [
          {
            mode: ShieldedOutputMode.FULLY_SHIELDED,
            commitment: 'aa'.repeat(33),
            range_proof: 'bb'.repeat(10),
            script: '',
            token_data: 0,
            ephemeral_pubkey: 'cc'.repeat(33),
            asset_commitment: 'dd'.repeat(33),
            decoded: { address: SHIELDED_ADDR, timelock: null },
            spent_by: null,
          },
        ],
      }) as unknown as IHistoryTx;

    await store.saveTx(buildOwnedShieldedTx(TX_A, 1));
    await store.saveTx(buildOwnedShieldedTx(TX_B, 2));

    // Minimal provider only to pass processNewTx's decode gate; the throw comes
    // from getScanXPrivKey, unlocked once per tx before any provider rewind runs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage.shieldedCryptoProvider = {} as any;
    jest.spyOn(storage, 'getScanXPrivKey').mockRejectedValue(new Error('wrong pin'));
    jest.spyOn(storage.logger, 'error').mockImplementation(() => undefined);

    // Must resolve, not reject: the systemic failure does not abort the reload.
    await expect(processHistory(storage, { pinCode: 'pin' })).resolves.toBeUndefined();

    // Both txs were walked and skipped — proves the loop continued past the first
    // failure (chronological asc order) rather than aborting on it.
    const skipCalls = (storage.logger.error as jest.Mock).mock.calls.filter(
      c => c[0] === 'Error processing tx during history reload, skipping'
    );
    expect(skipCalls.map(c => c[1])).toEqual([TX_A, TX_B]);
  });
});

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
  await expect(getSupportedSyncMode(storage)).resolves.toEqual([
    HistorySyncMode.MANUAL_STREAM_WS,
    HistorySyncMode.POLLING_HTTP_API,
  ]);

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

describe('processNewTx — owned shielded output credit (SEPARATED model)', () => {
  const SHIELDED_ADDR = 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX';
  const TX_ID = 'aa00bb11cc22dd33ee44ff5566778899aabbccddeeff00112233445566778899';
  const BLINDING_FACTOR = 'aabbccdd'.repeat(8);
  // High shielded-spend BIP32 index — well beyond a default gap limit — to
  // prove the shielded-chain max-index tracking advances. Omitting it would
  // silently cap owned shielded-address discovery and strand funds.
  const HIGH_SHIELDED_INDEX = 42;

  // Owned shielded output with the decoded marker fields (value/token/decoded/
  // blindingFactor) already set IN PLACE — i.e. what processShieldedOutputs
  // writes. No crypto provider needed; the credit loop gates on value!==undefined.
  const buildTxWithOwnedShielded = (overrides = {}): IHistoryTx =>
    ({
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
      // One transparent output ahead of the shielded slot, so the shielded
      // output's absolute on-chain index is T(1) + s(0) = 1.
      outputs: [
        {
          value: 7n,
          token: NATIVE_TOKEN_UID,
          token_data: 0,
          script: '',
          decoded: {},
          spent_by: null,
        },
      ],
      shielded_outputs: [
        {
          mode: ShieldedOutputMode.AMOUNT_SHIELDED,
          commitment: 'deadbeef'.repeat(8),
          range_proof: '',
          script: '',
          token_data: 0,
          ephemeral_pubkey: '',
          decoded: { address: SHIELDED_ADDR, timelock: null },
          spent_by: null,
          // owned-marker fields written in place by processShieldedOutputs
          value: 50n,
          token: NATIVE_TOKEN_UID,
          blindingFactor: BLINDING_FACTOR,
        },
      ],
      ...overrides,
    }) as unknown as IHistoryTx;

  const seedStorage = async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    // Register the on-chain spend-derived P2PKH as ours at a high shielded
    // index (addressType 'shielded-spend' drives the shielded chain tracking).
    await store.saveAddress({
      base58: SHIELDED_ADDR,
      bip32AddressIndex: HIGH_SHIELDED_INDEX,
      publicKey: '02'.repeat(33),
      addressType: 'shielded-spend',
    });
    // Also register a 'shielded' entry at the same index so the shielded
    // lastLoaded cursor is high enough for the used-index advance to apply.
    await store.saveAddress({
      base58: `${SHIELDED_ADDR}-recv`,
      bip32AddressIndex: HIGH_SHIELDED_INDEX,
      publicKey: '03'.repeat(33),
      addressType: 'shielded',
    });
    return { store, storage };
  };

  it('credits balance, saves the UTXO at index T+s and advances the shielded max index', async () => {
    const { store, storage } = await seedStorage();
    const tx = buildTxWithOwnedShielded();

    const result = await processNewTx(storage, tx, { currentHeight: 105 });

    // Per-chain max index: the owned shielded output lives at a high
    // shielded-spend index; the SHIELDED chain tracking must advance, not legacy.
    expect(result.shieldedMaxAddressIndex).toBe(HIGH_SHIELDED_INDEX);
    expect(result.legacyMaxAddressIndex).toBe(-1);
    expect(result.tokens.has(NATIVE_TOKEN_UID)).toBe(true);

    // The UTXO is saved at the ABSOLUTE on-chain index T + s = 1 + 0 = 1,
    // flagged shielded with the blinding factor preserved.
    const utxo = await store.getUtxo({ txId: TX_ID, index: 1 });
    expect(utxo).not.toBeNull();
    expect(utxo?.value).toBe(50n);
    expect(utxo?.shielded).toBe(true);
    expect(utxo?.blindingFactor).toBe(BLINDING_FACTOR);

    // There is no transparent UTXO for this wallet (the transparent output has
    // no decoded.address), so the only owned UTXO is at index 1.
    expect(await store.getUtxo({ txId: TX_ID, index: 0 })).toBeNull();

    // Balance credit landed on the address + token metadata.
    const addrMeta = await store.getAddressMeta(SHIELDED_ADDR);
    expect(addrMeta?.balance.get(NATIVE_TOKEN_UID)?.tokens.unlocked).toBe(50n);
    // numTransactions advanced once for the address and token.
    expect(addrMeta?.numTransactions).toBe(1);
    const tokenMeta = await store.getTokenMeta(NATIVE_TOKEN_UID);
    expect(tokenMeta?.numTransactions).toBe(1);
    expect(tokenMeta?.balance.tokens.unlocked).toBe(50n);
  });

  it('advances the wallet shieldedLastUsedAddressIndex via processSingleTx', async () => {
    const { store, storage } = await seedStorage();
    const tx = buildTxWithOwnedShielded();
    await storage.addTx(tx);

    await processSingleTx(storage, tx, { currentHeight: 105 });

    const walletData = await store.getWalletData();
    expect(walletData.shieldedLastUsedAddressIndex).toBe(HIGH_SHIELDED_INDEX);
  });

  it('does not credit a non-owned shielded slot (value === undefined)', async () => {
    const { store, storage } = await seedStorage();
    const tx = buildTxWithOwnedShielded();
    // Strip the owned-marker fields → the slot is non-owned.
    delete tx.shielded_outputs![0].value;
    delete tx.shielded_outputs![0].token;
    delete tx.shielded_outputs![0].blindingFactor;

    const result = await processNewTx(storage, tx, { currentHeight: 105 });

    expect(result.shieldedMaxAddressIndex).toBe(-1);
    expect(await store.getUtxo({ txId: TX_ID, index: 1 })).toBeNull();
    const addrMeta = await store.getAddressMeta(SHIELDED_ADDR);
    // No balance credited for a non-owned slot.
    expect(addrMeta?.balance.get(NATIVE_TOKEN_UID)?.tokens.unlocked ?? 0n).toBe(0n);
  });
});

describe('processNewTx — FullShielded token cross-check rejection', () => {
  const SHIELDED_ADDR = 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX';
  const TX_ID = 'bb00cc11dd22ee33ff44005566778899aabbccddeeff00112233445566778899';

  // Build a tx whose single FullShielded output is wallet-addressed but whose
  // recovered token UID does NOT match the on-chain asset_commitment. The
  // crypto provider's cross-check must reject it: no in-place decode, no UTXO.
  const buildTx = (): IHistoryTx =>
    ({
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
      outputs: [],
      shielded_outputs: [
        {
          mode: ShieldedOutputMode.FULLY_SHIELDED,
          commitment: 'aa'.repeat(33),
          range_proof: 'bb'.repeat(10),
          script: '',
          token_data: 0,
          ephemeral_pubkey: 'cc'.repeat(33),
          asset_commitment: 'dd'.repeat(33),
          decoded: { address: SHIELDED_ADDR, timelock: null },
          spent_by: null,
        },
      ],
    }) as unknown as IHistoryTx;

  it('rejects the output and saves no UTXO when the cross-check fails', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    await store.saveAddress({
      base58: SHIELDED_ADDR,
      bip32AddressIndex: 3,
      publicKey: '02'.repeat(33),
      addressType: 'shielded-spend',
    });

    // A real chain-level xpriv so scan-key derivation succeeds and rewind runs.
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { HDPrivateKey } = require('bitcore-lib');
    const mockXpriv = new HDPrivateKey().deriveNonCompliantChild(0).xprivkey;
    jest.spyOn(storage, 'getScanXPrivKey').mockResolvedValue(mockXpriv);

    // Wire a crypto provider whose createAssetCommitment returns a value that
    // does NOT match the on-chain asset_commitment → cross-check fails.
    storage.shieldedCryptoProvider = {
      generateRandomBlindingFactor: jest.fn(),
      createAmountShieldedOutput: jest.fn(),
      createShieldedOutputWithBothBlindings: jest.fn(),
      rewindAmountShieldedOutput: jest.fn(),
      rewindFullShieldedOutput: jest.fn().mockResolvedValue({
        value: 100n,
        blindingFactor: Buffer.alloc(32, 0x02),
        tokenUid: '03'.repeat(32),
        assetBlindingFactor: Buffer.alloc(32, 0x04),
      }),
      computeBalancingBlindingFactor: jest.fn(),
      deriveTag: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x05)),
      createAssetCommitment: jest.fn().mockResolvedValue(Buffer.alloc(33, 0xff)),
      createSurjectionProof: jest.fn(),
      deriveEcdhSharedSecret: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    jest.spyOn(storage.logger, 'error').mockImplementation(() => undefined);

    const tx = buildTx();
    const result = await processNewTx(storage, tx, { currentHeight: 105, pinCode: 'pin' });

    // No owned shielded output was credited; the slot stays non-owned.
    expect(result.shieldedMaxAddressIndex).toBe(-1);
    expect(tx.shielded_outputs![0].value).toBeUndefined();
    expect(await store.getUtxo({ txId: TX_ID, index: 0 })).toBeNull();
    expect(storage.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('cross-check failed')
    );
  });
});

describe('processMetadataChanged — shielded UTXO preservation (SEPARATED model)', () => {
  // Regression for the bug that caused unshield sends to fail with
  // "full-unshield tx (shielded inputs, no shielded outputs) must carry an
  // unshield balance header". Sequence: receive a shielded HTR tx →
  // processNewTx saves the UTXO with shielded:true + blindingFactor at the
  // absolute on-chain index → fullnode confirms the tx and pushes a metadata
  // update → onNewTx routes it to processMetadataChanged. If that function
  // dropped the shielded handling, it would re-save the UTXO with the bare
  // schema (no shielded flag, no blinding factors), corrupting the record so
  // the next send's excess-blinding-factor computation is skipped and the
  // fullnode rejects the tx.
  //
  // SEPARATED model: the decoded data lives IN PLACE on tx.shielded_outputs[],
  // and the re-save must use the absolute index T + s.
  const SHIELDED_ADDR = 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX';
  const TX_ID = 'aa00bb11cc22dd33ee44ff5566778899aabbccddeeff00112233445566778899';
  const COMMITMENT = 'deadbeef'.repeat(8);
  const BLINDING_FACTOR = 'aabbccdd'.repeat(8);
  const ASSET_BLINDING_FACTOR = '11223344'.repeat(8);

  // A tx with the decoded shielded output in place (value/blindingFactor set),
  // no transparent outputs, so the shielded slot's on-chain index is 0.
  const buildTxWithDecodedShielded = (): IHistoryTx =>
    ({
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
      outputs: [],
      shielded_outputs: [
        {
          mode: ShieldedOutputMode.AMOUNT_SHIELDED,
          commitment: COMMITMENT,
          range_proof: '',
          script: '',
          token_data: 0,
          ephemeral_pubkey: '',
          decoded: { address: SHIELDED_ADDR, timelock: null },
          spent_by: null,
          value: 50n,
          token: NATIVE_TOKEN_UID,
          blindingFactor: BLINDING_FACTOR,
          assetBlindingFactor: ASSET_BLINDING_FACTOR,
        },
      ],
    }) as unknown as IHistoryTx;

  const seedStorage = async (index: number) => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
    await store.saveUtxo({
      txId: TX_ID,
      index,
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

  it('preserves shielded:true and the blinding factors when re-saving via metadata update', async () => {
    const { store, storage } = await seedStorage(0);

    const before = await store.getUtxo({ txId: TX_ID, index: 0 });
    expect(before?.shielded).toBe(true);
    expect(before?.blindingFactor).toBe(BLINDING_FACTOR);

    await processMetadataChanged(storage, buildTxWithDecodedShielded());

    const after = await store.getUtxo({ txId: TX_ID, index: 0 });
    expect(after?.shielded).toBe(true);
    expect(after?.blindingFactor).toBe(BLINDING_FACTOR);
    expect(after?.assetBlindingFactor).toBe(ASSET_BLINDING_FACTOR);
    expect(after?.value).toBe(50n);
    expect(after?.token).toBe(NATIVE_TOKEN_UID);
  });

  it('uses the absolute on-chain index T + s, not the shielded array position', async () => {
    // A transparent output ahead of the shielded slot → the shielded output's
    // absolute on-chain index is T(1) + s(0) = 1, even though it is at
    // shielded_outputs position 0.
    const { store, storage } = await seedStorage(1);

    const tx = buildTxWithDecodedShielded();
    tx.outputs.push({
      value: 1n,
      token: NATIVE_TOKEN_UID,
      token_data: 0,
      script: '',
      decoded: { address: SHIELDED_ADDR, timelock: null },
      spent_by: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await processMetadataChanged(storage, tx);

    const shieldedAfter = await store.getUtxo({ txId: TX_ID, index: 1 });
    expect(shieldedAfter?.shielded).toBe(true);
    expect(shieldedAfter?.blindingFactor).toBe(BLINDING_FACTOR);
  });
});

describe('checkGapLimit — dual-chain (legacy + shielded) gap-limit logic', () => {
  // Helper: build a Storage whose getScanningPolicy/getScanningPolicyData report
  // gap-limit, and whose getWalletData / getAccessData return the exact field
  // values the function reads. We mock at the Storage method level (matching
  // the existing "scanning policy methods" describe block above) so the test
  // pins behavior without touching the underlying store internals.
  function buildStorage({
    gapLimit,
    walletData,
    spendXpubkey,
  }: {
    gapLimit: number;
    walletData: {
      lastLoadedAddressIndex: number;
      lastUsedAddressIndex: number;
      shieldedLastLoadedAddressIndex: number;
      shieldedLastUsedAddressIndex: number;
    };
    // undefined => hasShieldedKeys === false (no spendXpubkey on access data)
    spendXpubkey?: string;
  }): Storage {
    const storage = new Storage(new MemoryStore());
    jest.spyOn(storage, 'getScanningPolicy').mockResolvedValue(SCANNING_POLICY.GAP_LIMIT);
    jest
      .spyOn(storage, 'getScanningPolicyData')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ policy: 'gap-limit', gapLimit } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(storage, 'getWalletData').mockResolvedValue(walletData as any);
    jest
      .spyOn(storage, 'getAccessData')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue((spendXpubkey ? { spendXpubkey } : {}) as any);
    return storage;
  }

  it('returns null when the wallet is not configured for gap-limit (no-op)', async () => {
    const storage = new Storage(new MemoryStore());
    jest.spyOn(storage, 'getScanningPolicy').mockResolvedValue(SCANNING_POLICY.INDEX_LIMIT);
    await expect(checkGapLimit(storage)).resolves.toBeNull();
  });

  it('legacy-only wallet (hasShieldedKeys=false): reproduces single-chain behavior; shieldedTarget collapses to legacyTarget', async () => {
    // No spendXpubkey => hasShieldedKeys === false. The shielded fields below
    // are deliberately "behind" their target, but must be IGNORED because the
    // shielded branch is gated on hasShieldedKeys. Result must depend only on
    // the legacy chain (lastUsed=0, lastLoaded=5, gapLimit=20):
    //   legacyTarget = lastUsed + gapLimit = 20
    //   minLastLoaded = lastLoaded = 5 (shielded NOT considered)
    //   nextIndex = 6, count = max(20 - 5, 1) = 15
    const storage = buildStorage({
      gapLimit: 20,
      walletData: {
        lastLoadedAddressIndex: 5,
        lastUsedAddressIndex: 0,
        // Far behind, but must NOT influence the result (no shielded keys).
        shieldedLastLoadedAddressIndex: 0,
        shieldedLastUsedAddressIndex: 0,
      },
      spendXpubkey: undefined,
    });
    await expect(checkGapLimit(storage)).resolves.toEqual({ nextIndex: 6, count: 15 });
  });

  it('shielded chain lagging behind legacy: extension is computed from the shielded lastLoaded index', async () => {
    // Legacy chain is already satisfied (lastUsed=0, lastLoaded=30, gap=20 =>
    // 0+20 <= 30, legacyNeedMore=false). Shielded chain lags: shieldedLastUsed=5,
    // shieldedLastLoaded=10 => 5+20 > 10 => shieldedNeedMore=true.
    //   legacyTarget   = lastLoaded(legacy) = 30   (legacy satisfied)
    //   shieldedTarget = shieldedLastUsed + gap = 25
    //   maxTarget      = max(30, 25) = 30
    //   minLastLoaded  = min(30, 10) = 10          (shielded is the lagging chain)
    //   nextIndex = 11, count = max(30 - 10, 1) = 20
    const storage = buildStorage({
      gapLimit: 20,
      walletData: {
        lastLoadedAddressIndex: 30,
        lastUsedAddressIndex: 0,
        shieldedLastLoadedAddressIndex: 10,
        shieldedLastUsedAddressIndex: 5,
      },
      spendXpubkey: 'xpub-spend',
    });
    await expect(checkGapLimit(storage)).resolves.toEqual({ nextIndex: 11, count: 20 });
  });

  it('both chains already ahead of their targets: returns null (nothing to load)', async () => {
    // legacy: 0 + 20 <= 50 => no need. shielded: 0 + 20 <= 40 => no need.
    const storage = buildStorage({
      gapLimit: 20,
      walletData: {
        lastLoadedAddressIndex: 50,
        lastUsedAddressIndex: 0,
        shieldedLastLoadedAddressIndex: 40,
        shieldedLastUsedAddressIndex: 0,
      },
      spendXpubkey: 'xpub-spend',
    });
    await expect(checkGapLimit(storage)).resolves.toBeNull();
  });

  it('honors the Math.max(..., 1) floor when maxTarget equals minLastLoaded', async () => {
    // Construct a case where the gap is detected (needMore=true) but
    // maxTarget - minLastLoaded would be 0, so the count floors to 1.
    // gapLimit=1: legacy lastUsed=4, lastLoaded=4 => 4+1 > 4 => legacyNeedMore.
    //   legacyTarget   = 4 + 1 = 5
    //   shielded satisfied: shieldedLastUsed=0, shieldedLastLoaded=5 => 0+1<=5
    //   shieldedTarget = shieldedLastLoaded = 5
    //   maxTarget      = max(5, 5) = 5
    //   minLastLoaded  = min(4, 5) = 4
    //   nextIndex = 5, count = max(5 - 4, 1) = 1
    const storage = buildStorage({
      gapLimit: 1,
      walletData: {
        lastLoadedAddressIndex: 4,
        lastUsedAddressIndex: 4,
        shieldedLastLoadedAddressIndex: 5,
        shieldedLastUsedAddressIndex: 0,
      },
      spendXpubkey: 'xpub-spend',
    });
    const result = await checkGapLimit(storage);
    expect(result).toEqual({ nextIndex: 5, count: 1 });
    // Explicitly pin the floor: count is never below 1.
    expect(result?.count).toBeGreaterThanOrEqual(1);
  });

  it('hasShieldedKeys === false branch: a lagging shielded chain does NOT trigger a load', async () => {
    // Legacy fully satisfied; shielded badly behind. With no spendXpubkey the
    // shielded gap is invisible, so the overall result is null.
    const storage = buildStorage({
      gapLimit: 20,
      walletData: {
        lastLoadedAddressIndex: 50,
        lastUsedAddressIndex: 0,
        shieldedLastLoadedAddressIndex: 0,
        shieldedLastUsedAddressIndex: 30,
      },
      spendXpubkey: undefined,
    });
    await expect(checkGapLimit(storage)).resolves.toBeNull();
  });
});
