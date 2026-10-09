/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import { HDPrivateKey } from 'bitcore-lib';
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
  loadAddresses,
} from '../../src/utils/storage';
import * as addressUtils from '../../src/utils/address';
import { deriveShieldedAddressFromStorage } from '../../src/utils/address';
import walletUtils from '../../src/utils/wallet';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import * as cryptoUtils from '../../src/utils/crypto';
import { encryptData } from '../../src/utils/crypto';
import walletApi from '../../src/api/wallet';
import FullnodeConnection from '../../src/new/connection';
import { IShieldedCryptoProvider, ShieldedOutputMode } from '../../src/shielded/types';
import * as sessionModule from '../../src/shielded/session';
import { SessionClosedError, shieldedSessionOf } from '../../src/shielded/session';
import { unlockScanKeyWithPin } from '../../src/shielded/keys';
import { ShieldedDecodeSystemicError } from '../../src/errors';
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

  const buildOwnedShieldedTx = (
    txId: string,
    timestamp: number,
    shieldedAddr: string
  ): IHistoryTx =>
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
          decoded: { address: shieldedAddr, timelock: null },
          spent_by: null,
        },
      ],
    }) as unknown as IHistoryTx;

  const buildTransparentTx = (txId: string, timestamp: number, legacyAddr: string): IHistoryTx =>
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
      outputs: [
        {
          value: 50n,
          token_data: 0,
          token: NATIVE_TOKEN_UID,
          decoded: { address: legacyAddr, timelock: null },
          script: '',
          spent_by: null,
        },
      ],
      shielded_outputs: [],
    }) as unknown as IHistoryTx;

  it('skips ONLY a systemic shielded-decode failure and keeps walking (partial-history flag set)', async () => {
    // A systemic shielded-decode failure — here getScanXPrivKey rejecting, as a
    // wrong-PIN / corrupt-scan-key would — makes processNewTx throw a typed
    // ShieldedDecodeSystemicError. During a full reload that must NOT abort the
    // whole walk: cleanMetadata() has already wiped balances, so aborting would
    // strand the wallet empty. processHistory skips this tx, records it, continues.
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

    await store.saveTx(buildOwnedShieldedTx(TX_A, 1, SHIELDED_ADDR));
    await store.saveTx(buildOwnedShieldedTx(TX_B, 2, SHIELDED_ADDR));

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
      c => c[0] === 'Shielded decode failed during history reload, skipping tx'
    );
    expect(skipCalls.map(c => c[1])).toEqual([TX_A, TX_B]);
    // The partial-history flag surfaces the skip (not just a per-tx log line).
    expect(storage.shieldedDecodeSkippedTxIds).toEqual([TX_A, TX_B]);
  });

  it('processes a healthy tx that follows a skipped one — the rest of the history still rebuilds', async () => {
    // Oldest tx fails its shielded decode; the newer transparent tx must still be
    // credited (the skip must not drop later txs' metadata).
    const SHIELDED_ADDR = 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX';
    const LEGACY_ADDR = 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi';
    const BAD_TX = 'aa'.repeat(32);
    const GOOD_TX = 'bb'.repeat(32);
    const store = new MemoryStore();
    const storage = new Storage(store);
    await store.saveAddress({
      base58: SHIELDED_ADDR,
      bip32AddressIndex: 3,
      publicKey: '02'.repeat(33),
      addressType: 'shielded-spend',
    });
    await store.saveAddress({
      base58: LEGACY_ADDR,
      bip32AddressIndex: 0,
      publicKey: '03'.repeat(33),
    });

    await store.saveTx(buildOwnedShieldedTx(BAD_TX, 1, SHIELDED_ADDR));
    await store.saveTx(buildTransparentTx(GOOD_TX, 2, LEGACY_ADDR));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage.shieldedCryptoProvider = {} as any;
    jest.spyOn(storage, 'getScanXPrivKey').mockRejectedValue(new Error('wrong pin'));
    jest.spyOn(storage.logger, 'error').mockImplementation(() => undefined);

    await expect(processHistory(storage, { pinCode: 'pin' })).resolves.toBeUndefined();
    // The reload rebuilt LEGACY_ADDR's metadata from the default-metadata template,
    // whose balance Map is a module-level singleton shared across stores. Clear this
    // store's copy of it so the NATIVE_TOKEN credit above cannot bleed into suites
    // that assert absolute NATIVE_TOKEN balances.
    (await store.getAddressMeta(LEGACY_ADDR))?.balance.clear();

    // The healthy tx's transparent UTXO survived — its metadata was rebuilt even
    // though the older shielded tx was skipped.
    expect(await store.getUtxo({ txId: GOOD_TX, index: 0 })).not.toBeNull();
    // Only the shielded tx was skipped.
    expect(storage.shieldedDecodeSkippedTxIds).toEqual([BAD_TX]);
  });

  it('rethrows (aborts) a NON-decode error during reload — store failures are not swallowed', async () => {
    // A generic store failure (here a read error, not a shielded decode) must fail
    // LOUD, not be silently skipped: only ShieldedDecodeSystemicError is skippable,
    // and swallowing anything else is the exact stranded-empty-wallet outcome this
    // walk must avoid. The read throws inside processNewTx's credit path, before any
    // balance is written, so the abort leaves no partial state behind.
    const LEGACY_ADDR = 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi';
    const TX = 'cc'.repeat(32);
    const store = new MemoryStore();
    const storage = new Storage(store);
    await store.saveAddress({
      base58: LEGACY_ADDR,
      bip32AddressIndex: 0,
      publicKey: '03'.repeat(33),
    });
    await store.saveTx(buildTransparentTx(TX, 1, LEGACY_ADDR));

    // A store read throws a generic (non-typed) error while rebuilding the address
    // metadata. cleanMetadata() does not read per-address metadata, so this only
    // fires inside processNewTx — exactly where the skip-or-rethrow decision lives.
    jest.spyOn(store, 'getAddressMeta').mockRejectedValue(new Error('IndexedDB read failed'));
    jest.spyOn(storage.logger, 'error').mockImplementation(() => undefined);

    await expect(processHistory(storage)).rejects.toThrow(/IndexedDB read failed/);
    // It aborted — NOT surfaced as a partial-history skip.
    expect(storage.shieldedDecodeSkippedTxIds ?? null).toBeNull();
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
    // A real record, so the PIN unlocks a scan key that matches its
    // scanXpubkey and the rewind runs.
    await storage.saveAccessData(
      walletUtils.generateAccessDataFromSeed(walletUtils.generateWalletWords(), {
        pin: 'pin',
        password: 'password',
        networkName: 'testnet',
      })
    );
    await store.saveAddress({
      base58: SHIELDED_ADDR,
      bip32AddressIndex: 3,
      publicKey: '02'.repeat(33),
      addressType: 'shielded-spend',
    });

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
    jest.spyOn(storage.logger, 'debug').mockImplementation(() => undefined);
    jest.spyOn(storage.logger, 'warn').mockImplementation(() => undefined);

    const tx = buildTx();
    const result = await processNewTx(storage, tx, { currentHeight: 105, pinCode: 'pin' });

    // No owned shielded output was credited; the slot stays non-owned.
    expect(result.shieldedMaxAddressIndex).toBe(-1);
    expect(tx.shielded_outputs![0].value).toBeUndefined();
    expect(await store.getUtxo({ txId: TX_ID, index: 0 })).toBeNull();
    expect(storage.shieldedCryptoProvider!.rewindFullShieldedOutput).toHaveBeenCalled();
    // The output's detail is logged at debug level, and the tx's undecoded
    // outputs in one line at warn level.
    expect(storage.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('cross-check failed')
    );
    expect(storage.logger.warn).toHaveBeenCalledWith(
      `Shielded outputs of the wallet in tx ${TX_ID} could not be decoded: ` +
        '0 locked, 1 unreadable, 0 in error'
    );
    expect(shieldedSessionOf(storage).undecodedSummary()).toEqual({
      txIds: [TX_ID],
      locked: 0,
      unreadable: 1,
      error: 0,
    });
  }, 30000);
});

describe('processNewTx — shielded outputs of a multisig wallet', () => {
  // The PIN decrypts a real scan key here.
  const DECODE_TEST_TIMEOUT = 30000;
  const PIN = '123';
  const LEGACY_ADDR = 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi';
  const SPEND_ADDR = 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX';
  const TX_ID = 'dd00ee11ff22003344556677889900aabbccddeeff00112233445566778899aa';
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  const p2pkhRecord = walletUtils.generateAccessDataFromSeed(seed, {
    pin: PIN,
    password: '456',
    networkName: 'testnet',
  });
  // A multisig record that an older version gave the shielded keys of its root,
  // which are the keys of the P2PKH record of the same seed.
  const olderMultisigRecord = {
    ...walletUtils.generateAccessDataFromSeed(seed, {
      pin: PIN,
      password: '456',
      networkName: 'testnet',
      multisig: {
        pubkeys: [new HDPrivateKey(), new HDPrivateKey(), new HDPrivateKey()].map(
          key => key.xpubkey
        ),
        numSignatures: 2,
      },
    }),
    scanXpubkey: p2pkhRecord.scanXpubkey,
    scanMainKey: p2pkhRecord.scanMainKey,
    spendXpubkey: p2pkhRecord.spendXpubkey,
    spendMainKey: p2pkhRecord.spendMainKey,
  };

  // A tx that pays the wallet's legacy address with a transparent output, and
  // with a shielded output the spend address of a stored shielded pair.
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
      outputs: [
        {
          value: 50n,
          token_data: 0,
          token: NATIVE_TOKEN_UID,
          decoded: { address: LEGACY_ADDR, timelock: null },
          script: '',
          spent_by: null,
        },
      ],
      shielded_outputs: [
        {
          mode: ShieldedOutputMode.AMOUNT_SHIELDED,
          commitment: 'aa'.repeat(33),
          range_proof: 'bb'.repeat(10),
          script: '',
          token_data: 0,
          ephemeral_pubkey: 'cc'.repeat(33),
          decoded: { address: SPEND_ADDR, timelock: null },
          spent_by: null,
        },
      ],
    }) as unknown as IHistoryTx;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    { walletType: WalletType.P2PKH, record: p2pkhRecord, decodeAttempts: 1 },
    { walletType: WalletType.MULTISIG, record: olderMultisigRecord, decodeAttempts: 0 },
  ])(
    '$walletType wallet with a stored shielded pair: a decode is attempted $decodeAttempts time(s), and the transparent output is credited',
    async ({ walletType, record, decodeAttempts }) => {
      expect(record.walletType).toBe(walletType);
      const store = new MemoryStore();
      const storage = new Storage(store);
      await storage.saveAccessData(record);
      await store.saveAddress({ base58: LEGACY_ADDR, bip32AddressIndex: 0 });
      // The spend address of a shielded pair stored for the wallet, as an older
      // version stored for multisig wallets too.
      await store.saveAddress({
        base58: SPEND_ADDR,
        bip32AddressIndex: 3,
        publicKey: '02'.repeat(33),
        addressType: 'shielded-spend',
      });
      // The output does not open, which the decode logs and moves past.
      const rewind = jest.fn().mockRejectedValue(new Error('the output does not open'));
      storage.setShieldedCryptoProvider({
        rewindAmountShieldedOutput: rewind,
      } as unknown as IShieldedCryptoProvider);
      jest.spyOn(storage.logger, 'debug').mockImplementation(() => undefined);
      const scanKeySpy = jest.spyOn(storage, 'getScanXPrivKey');
      const tx = buildTx();

      await processNewTx(storage, tx, { currentHeight: 105, pinCode: PIN });

      expect(scanKeySpy).toHaveBeenCalledTimes(decodeAttempts);
      expect(rewind).toHaveBeenCalledTimes(decodeAttempts);
      expect(tx.shielded_outputs![0].value).toBeUndefined();
      const utxo = await store.getUtxo({ txId: TX_ID, index: 0 });
      expect(utxo?.value).toBe(50n);
      expect(utxo?.address).toBe(LEGACY_ADDR);
    },
    DECODE_TEST_TIMEOUT
  );
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
    shieldedXpubs,
    withProvider,
    walletType = WalletType.P2PKH,
  }: {
    gapLimit: number;
    walletData: {
      lastLoadedAddressIndex: number;
      lastUsedAddressIndex: number;
      shieldedLastLoadedAddressIndex: number;
      shieldedLastUsedAddressIndex: number;
    };
    // true => the access data carries both the scan and the spend xpub;
    // false => it carries neither.
    shieldedXpubs: boolean;
    // Whether a shielded crypto provider is registered. The wallet has a
    // shielded chain only with both xpubs and a provider.
    withProvider: boolean;
    // Only a P2PKH wallet has a shielded chain.
    walletType?: WalletType;
  }): Storage {
    const storage = new Storage(new MemoryStore());
    if (withProvider) {
      storage.setShieldedCryptoProvider({ id: 'mock' } as unknown as IShieldedCryptoProvider);
    }
    jest.spyOn(storage, 'getScanningPolicy').mockResolvedValue(SCANNING_POLICY.GAP_LIMIT);
    jest
      .spyOn(storage, 'getScanningPolicyData')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ policy: 'gap-limit', gapLimit } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(storage, 'getWalletData').mockResolvedValue(walletData as any);
    jest.spyOn(storage, 'getAccessData').mockResolvedValue({
      walletType,
      ...(shieldedXpubs ? { scanXpubkey: 'xpub-scan', spendXpubkey: 'xpub-spend' } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return storage;
  }

  it('returns null when the wallet is not configured for gap-limit (no-op)', async () => {
    const storage = new Storage(new MemoryStore());
    jest.spyOn(storage, 'getScanningPolicy').mockResolvedValue(SCANNING_POLICY.INDEX_LIMIT);
    await expect(checkGapLimit(storage)).resolves.toBeNull();
  });

  it('legacy-only wallet (no shielded chain): reproduces single-chain behavior; shieldedTarget collapses to legacyTarget', async () => {
    // No shielded xpubs => no shielded chain. The shielded fields below are
    // deliberately "behind" their target, but must be IGNORED because the
    // shielded branch is gated on the wallet having a shielded chain. Result
    // must depend only on the legacy chain (lastUsed=0, lastLoaded=5, gapLimit=20):
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
      shieldedXpubs: false,
      withProvider: true,
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
      shieldedXpubs: true,
      withProvider: true,
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
      shieldedXpubs: true,
      withProvider: true,
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
      shieldedXpubs: true,
      withProvider: true,
    });
    const result = await checkGapLimit(storage);
    expect(result).toEqual({ nextIndex: 5, count: 1 });
    // Explicitly pin the floor: count is never below 1.
    expect(result?.count).toBeGreaterThanOrEqual(1);
  });

  it('both shielded xpubs but no crypto provider: a lagging shielded chain does NOT trigger a load', async () => {
    // Same wallet data as the next case. Without a provider the wallet has no
    // shielded chain, so only the legacy chain counts, and it is satisfied.
    const storage = buildStorage({
      gapLimit: 20,
      walletData: {
        lastLoadedAddressIndex: 50,
        lastUsedAddressIndex: 0,
        shieldedLastLoadedAddressIndex: 0,
        shieldedLastUsedAddressIndex: 30,
      },
      shieldedXpubs: true,
      withProvider: false,
    });
    await expect(checkGapLimit(storage)).resolves.toBeNull();
  });

  it('no shielded chain: a lagging shielded chain does NOT trigger a load', async () => {
    // Legacy fully satisfied; shielded badly behind. With no shielded xpubs the
    // shielded gap is invisible, so the overall result is null.
    const storage = buildStorage({
      gapLimit: 20,
      walletData: {
        lastLoadedAddressIndex: 50,
        lastUsedAddressIndex: 0,
        shieldedLastLoadedAddressIndex: 0,
        shieldedLastUsedAddressIndex: 30,
      },
      shieldedXpubs: false,
      withProvider: true,
    });
    await expect(checkGapLimit(storage)).resolves.toBeNull();
  });

  it.each([
    {
      walletType: WalletType.P2PKH,
      loads: 'indexes 1 to 50',
      expected: { nextIndex: 1, count: 50 },
    },
    { walletType: WalletType.MULTISIG, loads: 'nothing', expected: null },
  ])(
    '$walletType record with both shielded xpubs and a provider: a lagging shielded chain loads $loads',
    async ({ walletType, expected }) => {
      // Legacy fully satisfied; shielded badly behind. A multisig record that an
      // older version gave shielded xpubs still has no shielded chain.
      const storage = buildStorage({
        gapLimit: 20,
        walletData: {
          lastLoadedAddressIndex: 50,
          lastUsedAddressIndex: 0,
          shieldedLastLoadedAddressIndex: 0,
          shieldedLastUsedAddressIndex: 30,
        },
        shieldedXpubs: true,
        withProvider: true,
        walletType,
      });
      await expect(checkGapLimit(storage)).resolves.toEqual(expected);
    }
  );
});

describe('apiSyncHistory partial-update emission', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * loadAddresses(0, 40) spans two MAX_ADDRESSES_GET chunks, so the history
   * loop yields twice per window. On an empty wallet both yields see the same
   * (addressesFound, historyLength) tuple — the event must fire once, not
   * once per chunk (consumers treat a duplicate as a second state change).
   */
  it('suppresses duplicate wallet-load-partial-update emits within a window', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const xpriv = new HDPrivateKey();
    await store.saveAccessData({
      xpubkey: xpriv.xpubkey,
      mainKey: encryptData(xpriv.xprivkey, '123'),
      walletType: WalletType.P2PKH,
      walletFlags: 0,
    } as never);
    // Pre-save all 40 addresses so loadAddresses skips per-index derivation
    // and produces exactly two 20-address chunks.
    for (let i = 0; i < 40; i++) {
      await store.saveAddress({ base58: `W-partial-update-${i}`, bip32AddressIndex: i });
    }
    jest.spyOn(walletApi, 'getAddressHistoryForAwait').mockResolvedValue({
      data: { success: true, history: [], has_more: false },
    } as never);
    const connection = {
      subscribeAddresses: jest.fn(),
      emit: jest.fn(),
    } as unknown as FullnodeConnection;

    await apiSyncHistory(0, 40, storage, connection);

    const partialUpdates = (connection.emit as jest.Mock).mock.calls.filter(
      c => c[0] === 'wallet-load-partial-update'
    );
    expect(partialUpdates).toHaveLength(1);
    expect(partialUpdates[0][1]).toEqual({ addressesFound: 40, historyLength: 0 });
  });
});

describe('shielded chain predicate', () => {
  // Real shielded EC derivation runs here, which jest's vm sandbox slows down.
  const DERIVATION_TEST_TIMEOUT = 30000;
  const full = walletUtils.generateAccessDataFromSeed(
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind',
    { pin: '123', password: '456', networkName: 'testnet' }
  );
  // The chain only needs a provider to be registered; loading never calls it.
  const provider = { id: 'mock' } as unknown as IShieldedCryptoProvider;

  function recordWith({ scan, spend }: { scan: boolean; spend: boolean }) {
    return {
      ...full,
      scanXpubkey: scan ? full.scanXpubkey : undefined,
      spendXpubkey: spend ? full.spendXpubkey : undefined,
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(
    [
      { shape: 'no shielded xpubs', scan: false, spend: false },
      { shape: 'only the scan xpub', scan: true, spend: false },
      { shape: 'only the spend xpub', scan: false, spend: true },
      { shape: 'both shielded xpubs', scan: true, spend: true },
    ].flatMap(record => [
      { ...record, withProvider: false, setup: 'no crypto provider' },
      { ...record, withProvider: true, setup: 'a crypto provider' },
    ])
  )(
    'a record with $shape and $setup: loadAddresses, checkGapLimit and deriveShieldedAddressFromStorage agree',
    async ({ scan, spend, withProvider }) => {
      // The record half is what hasShieldedXpubs reports; the chain also needs
      // a registered provider.
      const record = recordWith({ scan, spend });
      expect(walletUtils.hasShieldedXpubs(record)).toBe(scan && spend);
      const hasChain = scan && spend && withProvider;

      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(record);
      await storage.setScanningPolicyData({ policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 1 });
      if (withProvider) {
        storage.setShieldedCryptoProvider(provider);
      }

      // One legacy address per index, plus the spend P2PKH when there is a chain.
      const loaded = await loadAddresses(0, 1, storage);
      expect(loaded).toHaveLength(hasChain ? 2 : 1);
      expect((await storage.getAddressAtIndex(0, { legacy: false })) !== null).toBe(hasChain);

      expect((await deriveShieldedAddressFromStorage(0, storage)) !== null).toBe(hasChain);

      // The legacy chain is satisfied (nothing used, index 0 loaded), and the
      // shielded chain has used index 0 with a gap limit of 1, so only a wallet
      // with a shielded chain needs index 1.
      await storage.store.setLastUsedAddressIndex(0, { legacy: false });
      const nextWindow = await checkGapLimit(storage);
      expect(nextWindow).toEqual(hasChain ? { nextIndex: 1, count: 1 } : null);
    },
    DERIVATION_TEST_TIMEOUT
  );

  // A multisig record that an older version gave shielded keys: it derived them
  // from the root of every wallet created from a seed, multisig included, so
  // they are the same keys as the P2PKH record of the same seed.
  const olderMultisigRecord = {
    ...walletUtils.generateAccessDataFromSeed(
      'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind',
      {
        pin: '123',
        password: '456',
        networkName: 'testnet',
        multisig: {
          pubkeys: [new HDPrivateKey(), new HDPrivateKey(), new HDPrivateKey()].map(
            key => key.xpubkey
          ),
          numSignatures: 2,
        },
      }
    ),
    scanXpubkey: full.scanXpubkey,
    scanMainKey: full.scanMainKey,
    spendXpubkey: full.spendXpubkey,
    spendMainKey: full.spendMainKey,
  };

  it.each([
    { walletType: WalletType.P2PKH, record: full, hasChain: true },
    { walletType: WalletType.MULTISIG, record: olderMultisigRecord, hasChain: false },
  ])(
    'a $walletType record with both shielded xpubs and a crypto provider: loadAddresses, checkGapLimit and deriveShieldedAddressFromStorage agree',
    async ({ walletType, record, hasChain }) => {
      expect(record.walletType).toBe(walletType);
      expect(walletUtils.hasShieldedXpubs(record)).toBe(hasChain);

      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(record);
      await storage.setScanningPolicyData({ policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 1 });
      storage.setShieldedCryptoProvider(provider);
      const pairSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');

      // One legacy address per index, plus the spend P2PKH when there is a chain.
      const loaded = await loadAddresses(0, 1, storage);
      expect(loaded).toHaveLength(hasChain ? 2 : 1);
      expect(pairSpy).toHaveBeenCalledTimes(hasChain ? 1 : 0);
      expect((await storage.getAddressAtIndex(0, { legacy: false })) !== null).toBe(hasChain);

      expect((await deriveShieldedAddressFromStorage(0, storage)) !== null).toBe(hasChain);

      // The legacy chain is satisfied, and the shielded chain has used index 0
      // with a gap limit of 1, so only a wallet with a shielded chain needs index 1.
      await storage.store.setLastUsedAddressIndex(0, { legacy: false });
      await expect(checkGapLimit(storage)).resolves.toEqual(
        hasChain ? { nextIndex: 1, count: 1 } : null
      );
    },
    DERIVATION_TEST_TIMEOUT
  );

  it('a wallet without access data has no shielded chain', async () => {
    expect(walletUtils.hasShieldedXpubs(null)).toBe(false);

    const storage = new Storage(new MemoryStore());
    // With a provider registered, the missing record is what rules the chain out.
    storage.setShieldedCryptoProvider(provider);
    await storage.setScanningPolicyData({ policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 1 });
    // Index 0 is already stored, so loadAddresses derives nothing on the legacy
    // chain and the shielded check is the only reader of the missing record.
    await storage.saveAddress({ base58: 'W-legacy-0', bip32AddressIndex: 0 });

    await expect(loadAddresses(0, 1, storage)).resolves.toEqual(['W-legacy-0']);
    await expect(deriveShieldedAddressFromStorage(0, storage)).resolves.toBeNull();
    await storage.store.setLastUsedAddressIndex(0, { legacy: false });
    await expect(checkGapLimit(storage)).resolves.toBeNull();
  });

  it(
    'a session that found the record shielded keys inconsistent has no shielded chain',
    async () => {
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(full);
      await storage.setScanningPolicyData({ policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 1 });
      storage.setShieldedCryptoProvider(provider);
      const session = shieldedSessionOf(storage);
      session.open();
      session.setIntegrity('key-mismatch');

      await expect(loadAddresses(0, 1, storage)).resolves.toHaveLength(1);
      expect(await storage.getAddressAtIndex(0, { legacy: false })).toBeNull();
      await expect(deriveShieldedAddressFromStorage(0, storage)).resolves.toBeNull();
      await storage.store.setLastUsedAddressIndex(0, { legacy: false });
      await expect(checkGapLimit(storage)).resolves.toBeNull();

      // The chain is back once the session holds no integrity failure.
      session.setIntegrity(null);
      await expect(deriveShieldedAddressFromStorage(0, storage)).resolves.not.toBeNull();
      await expect(checkGapLimit(storage)).resolves.toEqual({ nextIndex: 1, count: 1 });
    },
    DERIVATION_TEST_TIMEOUT
  );

  it(
    'a provider registered after a load turns the chain on from index 0',
    async () => {
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(full);

      await expect(loadAddresses(0, 2, storage)).resolves.toHaveLength(2);
      expect(await storage.getAddressAtIndex(0, { legacy: false })).toBeNull();

      storage.setShieldedCryptoProvider(provider);
      // The same window again: the legacy addresses are stored, and the
      // shielded pairs are derived from index 0.
      await expect(loadAddresses(0, 2, storage)).resolves.toHaveLength(4);
      expect(await storage.getAddressAtIndex(0, { legacy: false })).not.toBeNull();
      expect(await storage.getAddressAtIndex(1, { legacy: false })).not.toBeNull();
    },
    DERIVATION_TEST_TIMEOUT
  );

  it.each([
    { setup: 'no crypto provider', withProvider: false, expected: 2 },
    { setup: 'a crypto provider', withProvider: true, expected: 4 },
  ])(
    'apiSyncHistory with $setup subscribes and fetches the history of $expected addresses for two indexes',
    async ({ withProvider, expected }) => {
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(full);
      await storage.setScanningPolicyData({ policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 });
      if (withProvider) {
        storage.setShieldedCryptoProvider(provider);
      }
      const historySpy = jest
        .spyOn(walletApi, 'getAddressHistoryForAwait')
        .mockResolvedValue({ data: { success: true, history: [], has_more: false } } as never);
      const connection = {
        subscribeAddresses: jest.fn(),
        emit: jest.fn(),
      } as unknown as FullnodeConnection;

      await apiSyncHistory(0, 2, storage, connection);

      const subscribed = (connection.subscribeAddresses as jest.Mock).mock.calls.flatMap(
        call => call[0]
      );
      expect(subscribed).toHaveLength(expected);
      expect(historySpy.mock.calls.flatMap(call => call[0])).toEqual(subscribed);
    },
    DERIVATION_TEST_TIMEOUT
  );

  it(
    'apiSyncHistory terminates for a record with only the spend xpub',
    async () => {
      const storage = new Storage(new MemoryStore());
      await storage.saveAccessData(recordWith({ scan: false, spend: true }));
      await storage.setScanningPolicyData({ policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 2 });
      // With a provider registered, the missing scan xpub is what rules the chain out.
      storage.setShieldedCryptoProvider(provider);
      // A sync that keeps requesting a window it never loads does not end: fail
      // after a bound instead of hanging the test.
      const historySpy = jest
        .spyOn(walletApi, 'getAddressHistoryForAwait')
        .mockImplementation(async () => {
          if (historySpy.mock.calls.length > 20) {
            throw new Error('address_history was requested more than 20 times');
          }
          return { data: { success: true, history: [], has_more: false } } as never;
        });
      const connection = {
        subscribeAddresses: jest.fn(),
        emit: jest.fn(),
      } as unknown as FullnodeConnection;

      await apiSyncHistory(0, 2, storage, connection);

      // One window of two legacy addresses, one request.
      expect(historySpy).toHaveBeenCalledTimes(1);
    },
    DERIVATION_TEST_TIMEOUT
  );
});

describe('derived address cache', () => {
  // Real legacy and shielded EC derivation runs here, which jest's vm sandbox slows down.
  const DERIVATION_TEST_TIMEOUT = 60000;
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  const accessData = walletUtils.generateAccessDataFromSeed(seed, {
    pin: '123',
    password: '456',
    networkName: 'testnet',
  });
  // A second wallet, to swap single keys of the first record for its keys.
  const otherAccessData = walletUtils.generateAccessDataFromSeed(
    'avocado spot town typical traffic vault danger century property shallow divorce festival spend attack anchor afford rotate green audit adjust fade wagon depart level',
    { pin: '123', password: '456', networkName: 'testnet' }
  );
  // The shielded chain only needs a provider to be registered; loading never calls it.
  const provider = { id: 'mock' } as unknown as IShieldedCryptoProvider;

  async function storedAddresses(storage: Storage, count: number) {
    const records: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const legacy = await storage.getAddressAtIndex(i);
      const shielded = await storage.getAddressAtIndex(i, { legacy: false });
      const spend = shielded?.ctMappingAddress
        ? await storage.store.getAddress(shielded.ctMappingAddress)
        : null;
      records.push({ legacy, shielded, spend });
    }
    return records;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(
    'loading a window again after the store wipe of a reconnect derives nothing',
    async () => {
      const storage = new Storage(new MemoryStore());
      storage.config.setNetwork('testnet');
      await storage.saveAccessData(accessData);
      storage.setShieldedCryptoProvider(provider);
      const first = await loadAddresses(0, 3, storage);
      const firstRecords = await storedAddresses(storage, 3);

      // The store wipe reloadStorage runs on a reconnect.
      await storage.cleanStorage(true, true);
      await storage.saveAccessData(accessData);
      const legacySpy = jest.spyOn(addressUtils, 'deriveAddressP2PKH');
      const pairSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');

      const second = await loadAddresses(0, 3, storage);

      expect(legacySpy).not.toHaveBeenCalled();
      expect(pairSpy).not.toHaveBeenCalled();
      // The same addresses to subscribe, and the same records on both chains.
      expect(second).toEqual(first);
      expect(await storedAddresses(storage, 3)).toEqual(firstRecords);
    },
    DERIVATION_TEST_TIMEOUT
  );

  it.each(['xpubkey', 'scanXpubkey', 'spendXpubkey'] as const)(
    'a record whose %s changed derives every index again, from the new keys',
    async field => {
      const storage = new Storage(new MemoryStore());
      storage.config.setNetwork('testnet');
      await storage.saveAccessData(accessData);
      storage.setShieldedCryptoProvider(provider);
      await loadAddresses(0, 2, storage);

      const changed = { ...accessData, [field]: otherAccessData[field] };
      await storage.cleanStorage(true, true);
      await storage.saveAccessData(changed);
      const legacySpy = jest.spyOn(addressUtils, 'deriveAddressP2PKH');
      const pairSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');

      const reloaded = await loadAddresses(0, 2, storage);

      expect(legacySpy).toHaveBeenCalledTimes(2);
      expect(pairSpy).toHaveBeenCalledTimes(2);
      // The same as a storage that never saw the old record.
      const fresh = new Storage(new MemoryStore());
      await fresh.saveAccessData(changed);
      fresh.setShieldedCryptoProvider(provider);
      expect(reloaded).toEqual(await loadAddresses(0, 2, fresh));
      expect(await storedAddresses(storage, 2)).toEqual(await storedAddresses(fresh, 2));
    },
    DERIVATION_TEST_TIMEOUT
  );

  it(
    'a network change derives every index again',
    async () => {
      const storage = new Storage(new MemoryStore());
      storage.config.setNetwork('testnet');
      try {
        await storage.saveAccessData(accessData);
        const testnetAddresses = await loadAddresses(0, 2, storage);

        // The xpubs are the same on every network, the addresses are not.
        storage.config.setNetwork('mainnet');
        await storage.cleanStorage(true, true);
        await storage.saveAccessData(accessData);
        const legacySpy = jest.spyOn(addressUtils, 'deriveAddressP2PKH');

        const mainnetAddresses = await loadAddresses(0, 2, storage);

        expect(legacySpy).toHaveBeenCalledTimes(2);
        expect(mainnetAddresses).not.toEqual(testnetAddresses);
        for (const address of mainnetAddresses) {
          expect(address.startsWith('H')).toBe(true);
        }
      } finally {
        storage.config.setNetwork('testnet');
      }
    },
    DERIVATION_TEST_TIMEOUT
  );

  it(
    'a change of the multisig configuration derives the P2SH addresses again',
    async () => {
      const pubkeys = [new HDPrivateKey(), new HDPrivateKey(), new HDPrivateKey()].map(
        key => key.xpubkey
      );
      const multisigRecord = walletUtils.generateAccessDataFromSeed(seed, {
        pin: '123',
        password: '456',
        networkName: 'testnet',
        multisig: { pubkeys, numSignatures: 2 },
      });
      const storage = new Storage(new MemoryStore());
      storage.config.setNetwork('testnet');
      await storage.saveAccessData(multisigRecord);
      const twoOfThree = await loadAddresses(0, 1, storage);

      const threeOfThree = {
        ...multisigRecord,
        multisigData: { ...multisigRecord.multisigData!, numSignatures: 3 },
      };
      await storage.cleanStorage(true, true);
      await storage.saveAccessData(threeOfThree);
      const p2shSpy = jest.spyOn(addressUtils, 'deriveAddressP2SH');

      const reloaded = await loadAddresses(0, 1, storage);

      expect(p2shSpy).toHaveBeenCalledTimes(1);
      expect(reloaded).not.toEqual(twoOfThree);
    },
    DERIVATION_TEST_TIMEOUT
  );

  it(
    'handleStop drops the cached addresses',
    async () => {
      const storage = new Storage(new MemoryStore());
      storage.config.setNetwork('testnet');
      await storage.saveAccessData(accessData);
      storage.setShieldedCryptoProvider(provider);
      await loadAddresses(0, 2, storage);

      await storage.handleStop();
      await storage.cleanStorage(true, true);
      await storage.saveAccessData(accessData);
      const legacySpy = jest.spyOn(addressUtils, 'deriveAddressP2PKH');
      const pairSpy = jest.spyOn(addressUtils, 'deriveShieldedAddressPair');

      await loadAddresses(0, 2, storage);

      expect(legacySpy).toHaveBeenCalledTimes(2);
      expect(pairSpy).toHaveBeenCalledTimes(2);
    },
    DERIVATION_TEST_TIMEOUT
  );
});

describe('decoding shielded outputs: the session key first, a PIN only while it holds none', () => {
  const SEED =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  const PIN = '123';
  const RECEIVE_TX = 'c1'.repeat(32);
  const OTHER_TX = 'c2'.repeat(32);
  // An address of another wallet.
  const FOREIGN_ADDRESS = 'WPhehTyNHTPz954CskfuSgLEfuKXbXeK3f';
  // The outputs the provider opens: paid to the wallet's shielded address at
  // `addressIndex`, they open with that address's scan key only.
  const OPENS_AT_0 = '0a'.repeat(33);
  const OPENS_AT_1 = '0b'.repeat(33);
  const OPENINGS: Record<string, { addressIndex: number; value: bigint }> = {
    [OPENS_AT_0]: { addressIndex: 0, value: 50n },
    [OPENS_AT_1]: { addressIndex: 1, value: 30n },
  };
  // Paid to the wallet's address at index 0, but opens with no key.
  const OPENS_NEVER = '0c'.repeat(33);

  let fixture: { accessData: string; childKeys: string[] } | null = null;
  /** The test seed's record, and the scan keys of its first two addresses, as bitcore derives them. */
  function walletFixture() {
    if (!fixture) {
      const accessData = walletUtils.generateAccessDataFromSeed(SEED, {
        pin: PIN,
        password: '456',
        networkName: 'testnet',
      });
      const scanKey = walletUtils
        .getXPrivKeyFromSeed(SEED, { networkName: 'testnet' })
        .deriveChild("m/44'/280'/1'")
        .deriveChild(0);
      fixture = {
        accessData: JSON.stringify(accessData),
        childKeys: [0, 1].map(i => scanKey.deriveChild(i).privateKey.toBuffer().toString('hex')),
      };
    }
    return fixture;
  }

  function makeProvider(): IShieldedCryptoProvider {
    const { childKeys } = walletFixture();
    return {
      generateRandomBlindingFactor: jest.fn(),
      createAmountShieldedOutput: jest.fn(),
      createShieldedOutputWithBothBlindings: jest.fn(),
      rewindAmountShieldedOutput: jest
        .fn()
        .mockImplementation(async (privkey: Buffer, _ephemeral: Buffer, commitment: Buffer) => {
          const opening = OPENINGS[commitment.toString('hex')];
          if (!opening || privkey.toString('hex') !== childKeys[opening.addressIndex]) {
            throw new Error('rewind failed');
          }
          return { value: opening.value, blindingFactor: Buffer.alloc(32, 0x0b) };
        }),
      rewindFullShieldedOutput: jest.fn(),
      computeBalancingBlindingFactor: jest.fn(),
      deriveTag: jest.fn(),
      createAssetCommitment: jest.fn(),
      createSurjectionProof: jest.fn(),
      deriveEcdhSharedSecret: jest.fn(),
    } as unknown as IShieldedCryptoProvider;
  }

  /** A storage with the test seed's record and the first two indexes of both chains. */
  async function setup() {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(JSON.parse(walletFixture().accessData));
    const provider = makeProvider();
    storage.setShieldedCryptoProvider(provider);
    await loadAddresses(0, 2, storage);
    const legacy = (await storage.getAddressAtIndex(0))!.base58;
    const spend: string[] = [];
    for (const index of [0, 1]) {
      spend.push((await storage.getAddressAtIndex(index, { legacy: false }))!.ctMappingAddress!);
    }
    jest.spyOn(storage.logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(storage.logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(storage.logger, 'error').mockImplementation(() => undefined);
    return { storage, provider, legacy, spend };
  }

  async function fillSession(storage: Storage) {
    const session = shieldedSessionOf(storage);
    session.open();
    session.fill(await unlockScanKeyWithPin(storage, PIN), session.epoch);
    return session;
  }

  /** A tx paying 7 HTR to `transparentTo` and each shielded output to its address. */
  function receiveTx(
    txId: string,
    transparentTo: string | null,
    shielded: Array<[string, string]>,
    timestamp = 1
  ): IHistoryTx {
    return {
      tx_id: txId,
      version: 1,
      weight: 1,
      timestamp,
      is_voided: false,
      nonce: 0,
      parents: [],
      inputs: [],
      height: 100,
      tokens: [],
      outputs: transparentTo
        ? [
            {
              value: 7n,
              token: NATIVE_TOKEN_UID,
              token_data: 0,
              script: '',
              decoded: { type: 'P2PKH', address: transparentTo, timelock: null },
              spent_by: null,
            },
          ]
        : [],
      shielded_outputs: shielded.map(([address, commitment]) => ({
        mode: ShieldedOutputMode.AMOUNT_SHIELDED,
        commitment,
        range_proof: 'bb'.repeat(10),
        script: '',
        token_data: 0,
        ephemeral_pubkey: '02'.repeat(33),
        decoded: { type: 'P2PKH', address, timelock: null },
        spent_by: null,
      })),
    } as unknown as IHistoryTx;
  }

  async function htrBalance(storage: Storage): Promise<bigint> {
    return (await storage.store.getTokenMeta(NATIVE_TOKEN_UID))?.balance.tokens.unlocked ?? 0n;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('decodes with the session key, whatever PIN the call gives', async () => {
    const { storage, legacy, spend } = await setup();
    const session = await fillSession(storage);
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');
    const tx = receiveTx(RECEIVE_TX, legacy, [
      [spend[0], OPENS_AT_0],
      [FOREIGN_ADDRESS, OPENS_AT_1],
    ]);
    await storage.addTx(tx);

    // The PIN a dApp request passes, which is not the wallet's.
    await processNewTx(storage, tx, { currentHeight: 105, pinCode: '111111' });

    expect(unlockSpy).not.toHaveBeenCalled();
    expect(tx.shielded_outputs![0].value).toBe(50n);
    expect(tx.shielded_outputs![1].value).toBeUndefined();
    expect((await storage.getTx(RECEIVE_TX))!.shielded_outputs![0].value).toBe(50n);
    expect(await htrBalance(storage)).toBe(57n);
    expect(session.undecodedSummary()).toEqual({ txIds: [], locked: 0, unreadable: 0, error: 0 });
  }, 60000);

  it('decodes with a correct PIN while the session holds no key, then zeroes that key', async () => {
    const { storage, legacy, spend } = await setup();
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');
    const wipeSpy = jest.spyOn(sessionModule, 'wipeScanKeyMaterial');
    const tx = receiveTx(RECEIVE_TX, legacy, [[spend[0], OPENS_AT_0]]);
    await storage.addTx(tx);

    await processNewTx(storage, tx, { currentHeight: 105, pinCode: PIN });

    expect(unlockSpy).toHaveBeenCalledTimes(1);
    expect(tx.shielded_outputs![0].value).toBe(50n);
    expect(await htrBalance(storage)).toBe(57n);
    // The PIN is a one-off: it does not fill the session.
    expect(shieldedSessionOf(storage).hasKey).toBe(false);
    expect(wipeSpy).toHaveBeenCalledTimes(1);
    expect(wipeSpy.mock.calls[0][0].privateKey).toEqual(Buffer.alloc(32));
  }, 60000);

  it('credits the transparent outputs and counts the wallet outputs locked for a wrong PIN', async () => {
    const { storage, legacy, spend } = await setup();
    const tx = receiveTx(RECEIVE_TX, legacy, [[spend[0], OPENS_AT_0]]);
    await storage.addTx(tx);

    await expect(
      processNewTx(storage, tx, { currentHeight: 105, pinCode: '999' })
    ).resolves.toMatchObject({ legacyMaxAddressIndex: 0, shieldedMaxAddressIndex: -1 });

    expect(tx.shielded_outputs![0].value).toBeUndefined();
    expect(await htrBalance(storage)).toBe(7n);
    expect(shieldedSessionOf(storage).undecodedSummary()).toEqual({
      txIds: [RECEIVE_TX],
      locked: 1,
      unreadable: 0,
      error: 0,
    });
    expect(storage.logger.warn).toHaveBeenCalledWith(expect.stringContaining('shielded-wrong-pin'));
    expect(storage.logger.info).toHaveBeenCalledWith(
      `Shielded outputs of the wallet in tx ${RECEIVE_TX} could not be decoded: ` +
        '1 locked, 0 unreadable, 0 in error'
    );
  }, 60000);

  it.each([
    ['an empty PIN', ''],
    ['a null PIN', null],
    ['no PIN', undefined],
  ])(
    'does not try %s',
    async (_name, pinCode) => {
      const { storage, legacy, spend } = await setup();
      const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');
      const tx = receiveTx(RECEIVE_TX, legacy, [[spend[0], OPENS_AT_0]]);
      await storage.addTx(tx);

      await processNewTx(storage, tx, {
        currentHeight: 105,
        pinCode: pinCode as string | undefined,
      });

      expect(unlockSpy).not.toHaveBeenCalled();
      expect(await htrBalance(storage)).toBe(7n);
      expect(shieldedSessionOf(storage).undecodedSummary().locked).toBe(1);
    },
    60000
  );

  it('counts the wallet outputs locked without a crypto provider', async () => {
    const { storage, legacy, spend } = await setup();
    storage.setShieldedCryptoProvider(undefined);
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');
    const tx = receiveTx(RECEIVE_TX, legacy, [[spend[0], OPENS_AT_0]]);
    await storage.addTx(tx);

    await processNewTx(storage, tx, { currentHeight: 105, pinCode: PIN });

    expect(unlockSpy).not.toHaveBeenCalled();
    expect(await htrBalance(storage)).toBe(7n);
    expect(shieldedSessionOf(storage).undecodedSummary()).toMatchObject({ locked: 1 });
  }, 60000);

  it('counts an output of the wallet that does not open as unreadable, and ignores other wallets', async () => {
    const { storage, spend } = await setup();
    await fillSession(storage);
    const tx = receiveTx(RECEIVE_TX, null, [
      [spend[0], OPENS_NEVER],
      [FOREIGN_ADDRESS, OPENS_AT_1],
      [spend[1], OPENS_AT_1],
    ]);
    await storage.addTx(tx);

    await processNewTx(storage, tx, { currentHeight: 105 });

    expect(tx.shielded_outputs!.map(output => output.value)).toEqual([undefined, undefined, 30n]);
    expect(shieldedSessionOf(storage).undecodedSummary()).toEqual({
      txIds: [RECEIVE_TX],
      locked: 0,
      unreadable: 1,
      error: 0,
    });
    expect(storage.logger.warn).toHaveBeenCalledWith(
      `Shielded outputs of the wallet in tx ${RECEIVE_TX} could not be decoded: ` +
        '0 locked, 1 unreadable, 0 in error'
    );
  }, 60000);

  it('decrypts the key once per walk, and records the undecoded outputs again on each walk', async () => {
    const { storage, spend } = await setup();
    await storage.addTx(receiveTx(RECEIVE_TX, null, [[spend[0], OPENS_AT_0]], 1));
    await storage.addTx(receiveTx(OTHER_TX, null, [[spend[1], OPENS_AT_1]], 2));
    const session = shieldedSessionOf(storage);
    session.recordUndecoded('an-earlier-tx', { locked: 3, unreadable: 0, error: 0 });
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');
    const decryptSpy = jest.spyOn(cryptoUtils, 'decryptData');

    await processHistory(storage, { pinCode: '999' });

    // A wrong PIN is tried once, not for each tx.
    expect(unlockSpy).toHaveBeenCalledTimes(1);
    expect(session.undecodedSummary()).toEqual({
      txIds: [RECEIVE_TX, OTHER_TX],
      locked: 2,
      unreadable: 0,
      error: 0,
    });
    expect(storage.logger.info).toHaveBeenCalledWith(
      'Shielded outputs of the wallet in 2 tx(s) of the history could not be decoded: ' +
        '2 locked, 0 unreadable, 0 in error'
    );

    unlockSpy.mockClear();
    decryptSpy.mockClear();
    await processHistory(storage, { pinCode: PIN });

    expect(unlockSpy).toHaveBeenCalledTimes(1);
    expect(decryptSpy).toHaveBeenCalledTimes(1);
    expect(session.undecodedSummary()).toEqual({ txIds: [], locked: 0, unreadable: 0, error: 0 });
    expect((await storage.getTx(RECEIVE_TX))!.shielded_outputs![0].value).toBe(50n);
    expect((await storage.getTx(OTHER_TX))!.shielded_outputs![0].value).toBe(30n);
    expect(await htrBalance(storage)).toBe(80n);
  }, 60000);

  it('keeps an unexpected failure to unlock systemic, and counts the output in error', async () => {
    const { storage, legacy, spend } = await setup();
    jest.spyOn(storage, 'getScanXPrivKey').mockRejectedValue(new Error('IndexedDB read failed'));
    const tx = receiveTx(RECEIVE_TX, legacy, [[spend[0], OPENS_AT_0]]);
    await storage.addTx(tx);

    await expect(
      processNewTx(storage, tx, { currentHeight: 105, pinCode: PIN })
    ).rejects.toBeInstanceOf(ShieldedDecodeSystemicError);

    expect(await htrBalance(storage)).toBe(0n);
    expect(shieldedSessionOf(storage).undecodedSummary()).toEqual({
      txIds: [RECEIVE_TX],
      locked: 0,
      unreadable: 0,
      error: 1,
    });
  }, 60000);

  it('counts the wallet outputs of a tx the walk skips in error', async () => {
    const { storage, spend } = await setup();
    await storage.addTx(receiveTx(RECEIVE_TX, null, [[spend[0], OPENS_AT_0]], 1));
    jest.spyOn(storage, 'getScanXPrivKey').mockRejectedValue(new Error('IndexedDB read failed'));

    await processHistory(storage, { pinCode: PIN });

    expect(storage.shieldedDecodeSkippedTxIds).toEqual([RECEIVE_TX]);
    expect(shieldedSessionOf(storage).undecodedSummary()).toEqual({
      txIds: [RECEIVE_TX],
      locked: 0,
      unreadable: 0,
      error: 1,
    });
    expect(storage.logger.warn).toHaveBeenCalledWith(
      'Shielded outputs of the wallet in 1 tx(s) of the history could not be decoded: ' +
        '0 locked, 0 unreadable, 1 in error'
    );
  }, 60000);

  it('writes and credits nothing when the session is closed while a tx is decoded', async () => {
    const { storage, provider, legacy, spend } = await setup();
    const session = await fillSession(storage);
    (provider.rewindAmountShieldedOutput as jest.Mock).mockImplementationOnce(async () => {
      // stop() runs while the rewind is in flight.
      session.close();
      return { value: 50n, blindingFactor: Buffer.alloc(32, 0x0b) };
    });
    const tx = receiveTx(RECEIVE_TX, legacy, [[spend[0], OPENS_AT_0]]);
    await storage.addTx(tx);
    const saveTxSpy = jest.spyOn(storage.store, 'saveTx');

    await expect(processNewTx(storage, tx, { currentHeight: 105 })).rejects.toBeInstanceOf(
      SessionClosedError
    );

    expect(saveTxSpy).not.toHaveBeenCalled();
    // The stored tx is the object the store keeps: it was not decoded either.
    expect((await storage.getTx(RECEIVE_TX))!.shielded_outputs![0].value).toBeUndefined();
    expect(await storage.store.getUtxo({ txId: RECEIVE_TX, index: 0 })).toBeNull();
    expect(await htrBalance(storage)).toBe(0n);
    expect(session.undecodedSummary().txIds).toEqual([]);
  }, 60000);

  it('stops a walk when the session is closed during it', async () => {
    const { storage, provider, spend } = await setup();
    const session = await fillSession(storage);
    await storage.addTx(receiveTx(RECEIVE_TX, null, [[spend[0], OPENS_AT_0]], 1));
    await storage.addTx(receiveTx(OTHER_TX, null, [[spend[1], OPENS_AT_1]], 2));
    (provider.rewindAmountShieldedOutput as jest.Mock).mockImplementationOnce(async () => {
      session.close();
      return { value: 50n, blindingFactor: Buffer.alloc(32, 0x0b) };
    });

    await expect(processHistory(storage)).rejects.toBeInstanceOf(SessionClosedError);

    expect(provider.rewindAmountShieldedOutput).toHaveBeenCalledTimes(1);
    expect((await storage.getTx(RECEIVE_TX))!.shielded_outputs![0].value).toBeUndefined();
    expect((await storage.getTx(OTHER_TX))!.shielded_outputs![0].value).toBeUndefined();
    expect(await htrBalance(storage)).toBe(0n);
  }, 60000);

  /**
   * A step the test holds: `reached` resolves when the code gets to it, and the
   * code goes on once `finish()` is called. It uses no timer, so it works when
   * another test left fake timers installed.
   */
  function heldStep() {
    let reach: () => void = () => {};
    const reached = new Promise<void>(resolve => {
      reach = resolve;
    });
    let finish: () => void = () => {};
    const finished = new Promise<void>(resolve => {
      finish = resolve;
    });
    return {
      reached,
      finish,
      hold: async () => {
        reach();
        await finished;
      },
    };
  }

  it('zeroes the key a PIN unlocked for a pass when the session closes, and derives nothing after it', async () => {
    const { storage, provider, spend } = await setup();
    const session = shieldedSessionOf(storage);
    // An open session without a key: the pass unlocks one with the PIN.
    session.open();
    const rewind = provider.rewindAmountShieldedOutput as jest.Mock;
    const opens = rewind.getMockImplementation()!;
    const firstRewind = heldStep();
    rewind.mockImplementationOnce(async (...args: unknown[]) => {
      await firstRewind.hold();
      return opens(...args);
    });
    const deriveSpy = jest.spyOn(sessionModule, 'deriveScanChildKey');
    const tx = receiveTx(RECEIVE_TX, null, [
      [spend[0], OPENS_AT_0],
      [spend[1], OPENS_AT_1],
    ]);
    await storage.addTx(tx);

    const processing = processNewTx(storage, tx, { currentHeight: 105, pinCode: PIN });
    await firstRewind.reached;
    // stop() closes the session while the first output is rewound.
    session.close();

    expect(deriveSpy).toHaveBeenCalledTimes(1);
    expect(deriveSpy.mock.calls[0][0].privateKey).toEqual(Buffer.alloc(32));
    firstRewind.finish();
    await expect(processing).rejects.toBeInstanceOf(SessionClosedError);
    expect(deriveSpy).toHaveBeenCalledTimes(1);
    expect(rewind).toHaveBeenCalledTimes(1);
    expect(tx.shielded_outputs!.map(output => output.value)).toEqual([undefined, undefined]);
    expect(await htrBalance(storage)).toBe(0n);
  }, 60000);

  it('zeroes the key of a PIN unlock that a session close overtakes, and derives nothing with it', async () => {
    const { storage, spend } = await setup();
    const session = shieldedSessionOf(storage);
    session.open();
    const readKey = storage.getScanXPrivKey.bind(storage);
    const unlock = heldStep();
    jest.spyOn(storage, 'getScanXPrivKey').mockImplementation(async pin => {
      await unlock.hold();
      return readKey(pin);
    });
    const wipeSpy = jest.spyOn(sessionModule, 'wipeScanKeyMaterial');
    const deriveSpy = jest.spyOn(sessionModule, 'deriveScanChildKey');
    const tx = receiveTx(RECEIVE_TX, null, [[spend[0], OPENS_AT_0]]);
    await storage.addTx(tx);

    const processing = processNewTx(storage, tx, { currentHeight: 105, pinCode: PIN });
    await unlock.reached;
    session.close();
    unlock.finish();

    await expect(processing).rejects.toBeInstanceOf(SessionClosedError);
    expect(deriveSpy).not.toHaveBeenCalled();
    expect(wipeSpy).toHaveBeenCalledTimes(1);
    expect(wipeSpy.mock.calls[0][0].privateKey).toEqual(Buffer.alloc(32));
    expect(tx.shielded_outputs![0].value).toBeUndefined();
  }, 60000);

  it('writes nothing for a tx or a walk that starts after the session was closed', async () => {
    const { storage, legacy, spend } = await setup();
    const session = await fillSession(storage);
    // stop() closed the session; this processing started after it.
    session.close();
    const unlockSpy = jest.spyOn(storage, 'getScanXPrivKey');
    const cleanSpy = jest.spyOn(storage.store, 'cleanMetadata');
    const tx = receiveTx(RECEIVE_TX, legacy, [[spend[0], OPENS_AT_0]]);
    await storage.addTx(tx);

    await expect(
      processNewTx(storage, tx, { currentHeight: 105, pinCode: PIN })
    ).rejects.toBeInstanceOf(SessionClosedError);
    await expect(processHistory(storage, { pinCode: PIN })).rejects.toBeInstanceOf(
      SessionClosedError
    );

    expect(unlockSpy).not.toHaveBeenCalled();
    expect(cleanSpy).not.toHaveBeenCalled();
    expect(tx.shielded_outputs![0].value).toBeUndefined();
    expect(await storage.store.getUtxo({ txId: RECEIVE_TX, index: 0 })).toBeNull();
    expect(await htrBalance(storage)).toBe(0n);
  }, 60000);

  it('decodes the same values with the session key and with the PIN', async () => {
    const decodedWith = async (useSession: boolean) => {
      const { storage, legacy, spend } = await setup();
      if (useSession) {
        await fillSession(storage);
      }
      await storage.addTx(
        receiveTx(RECEIVE_TX, legacy, [
          [spend[0], OPENS_AT_0],
          [spend[1], OPENS_AT_1],
        ])
      );
      await processHistory(storage, { pinCode: useSession ? undefined : PIN });
      const utxos: IUtxo[] = [];
      for await (const utxo of storage.selectUtxos({ token: NATIVE_TOKEN_UID })) {
        utxos.push(utxo);
      }
      return {
        outputs: (await storage.getTx(RECEIVE_TX))!.shielded_outputs,
        balance: await htrBalance(storage),
        utxos,
      };
    };

    const withPin = await decodedWith(false);
    const withSession = await decodedWith(true);

    expect(withSession).toEqual(withPin);
    expect(withPin.balance).toBe(87n);
    expect(withPin.utxos.map(utxo => [utxo.index, utxo.value, utxo.shielded])).toEqual([
      [0, 7n, undefined],
      [1, 50n, true],
      [2, 30n, true],
    ]);
  }, 60000);
});
