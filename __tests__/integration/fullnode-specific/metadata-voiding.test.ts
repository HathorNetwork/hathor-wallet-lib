/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade transaction voiding tests.
 *
 * Voiding is simulated by capturing the websocket `IHistoryTx` payload via a
 * `jest.spyOn(hWallet, 'onNewTx')`, flipping `history.is_voided`, and
 * re-injecting it through `HathorWallet.onNewTx`; the assertions then read
 * `MemoryStore` internals (`storage.store.utxos`/`tokens`,
 * `storage.processHistory`, `storage.getTx`). None of that machinery — the
 * raw-payload `onNewTx` entrypoint, the in-memory store, or the local
 * metadata-change event — is exposed by the wallet-service facade, so these
 * cases cannot run against `IWalletTestAdapter` and stay fullnode-specific.
 */

import { cloneDeep, reverse } from 'lodash';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import HathorWallet from '../../../src/new/wallet';
import { MemoryStore } from '../../../src/storage';
import { IHistoryTx } from '../../../src/types';

/**
 * Returns the most recent `onNewTx` spy call that carried the given txId, or
 * `undefined` when the spy never saw it. Used to recover the websocket payload
 * for a specific transaction so the test can replay it with `is_voided` set.
 */
function findLastCallFor(
  txId: string,
  wsSpy: jest.SpiedFunction<typeof HathorWallet.prototype.onNewTx>
): { history: IHistoryTx } | undefined {
  for (const call of reverse(cloneDeep(wsSpy.mock.calls))) {
    if (call[0].history.tx_id === txId) {
      return call[0];
    }
  }

  return undefined;
}

describe('[Fullnode] processing transaction metadata changes', () => {
  let hWallet: HathorWallet;

  beforeEach(async () => {
    hWallet = await generateWalletHelper(null);
  });

  afterEach(async () => {
    await hWallet.stop();
  });

  it('should process entire history and balance when a tx sent to the wallet is voided', async () => {
    const store = hWallet.storage.store as MemoryStore;
    const addr0 = await hWallet.getAddressAtIndex(0);
    const wsSpy: jest.SpiedFunction<typeof hWallet.onNewTx> = jest.spyOn(hWallet, 'onNewTx');
    const procSpy: jest.SpiedFunction<typeof hWallet.storage.processHistory> = jest.spyOn(
      hWallet.storage,
      'processHistory'
    );

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 0,
        balance: { unlocked: 0n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(0);

    const injectedTx = await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);
    if (!injectedTx.hash) {
      throw new Error('Could not inject funds into wallet');
    }
    await waitForTxReceived(hWallet, injectedTx.hash);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 1,
        balance: { unlocked: 10n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(1);

    expect(wsSpy).toHaveBeenCalled();

    const { lastCall } = wsSpy.mock;
    expect(lastCall).toBeDefined();
    if (!lastCall) {
      throw new Error('Unexpected error');
    }
    // Get a copy of the transaction received via websocket
    const wsTx = cloneDeep(lastCall[0]);
    // Mark tx as voided
    wsTx.history.is_voided = true;

    // Simulate the wallet receiving a void update
    procSpy.mockClear();
    await hWallet.onNewTx(wsTx);
    expect(procSpy).toHaveBeenCalled();

    // Since the only transaction on the wallet has been voided it should
    // register as empty with 0 transactions
    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 0,
        balance: { unlocked: 0n, locked: 0n },
      }),
    ]);

    await expect(hWallet.storage.getTx(injectedTx.hash)).resolves.toBeDefined();

    // No utxos on the wallet since the only tx has been voided
    expect(store.utxos.size).toStrictEqual(0);
  });

  it('should process history when a tx sent by the wallet to the wallet is voided', async () => {
    const store = hWallet.storage.store as MemoryStore;
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr5 = await hWallet.getAddressAtIndex(5);
    const wsSpy: jest.SpiedFunction<typeof hWallet.onNewTx> = jest.spyOn(hWallet, 'onNewTx');
    const procSpy: jest.SpiedFunction<typeof hWallet.storage.processHistory> = jest.spyOn(
      hWallet.storage,
      'processHistory'
    );

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 0,
        balance: { unlocked: 0n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(0);

    const injectedTx = await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);
    if (!injectedTx.hash) {
      throw new Error('Could not inject funds into wallet');
    }
    await waitForTxReceived(hWallet, injectedTx.hash);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 1,
        balance: { unlocked: 10n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(1);
    expect(Array.from(store.utxos.values())).toEqual([
      expect.objectContaining({
        txId: injectedTx.hash,
      }),
    ]);

    // This is the unspent injected tx
    const wsTxInjected = findLastCallFor(injectedTx.hash, wsSpy);
    expect(wsTxInjected).toBeDefined();
    if (!wsTxInjected) {
      throw new Error('undefined hash for injected tx, should not happen.');
    }

    wsSpy.mockClear();
    // Send a tx from the wallet to itself
    const txSent = await hWallet.sendTransaction(addr5, 5n);
    expect(txSent.hash).toBeDefined();
    if (!txSent.hash) {
      throw new Error('undefined hash for tx sent, should not happen.');
    }
    await waitForTxReceived(hWallet, txSent.hash);

    // Expect another tx with 0 balance change
    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 2,
        balance: { unlocked: 10n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(2); // split utxo with 10 into 2 utxo with 5s
    expect(Array.from(store.utxos.values())).toEqual([
      expect.objectContaining({
        txId: txSent.hash,
      }),
      expect.objectContaining({
        txId: txSent.hash,
      }),
    ]);

    expect(wsSpy).toHaveBeenCalled();

    // Get a copy of the transaction received via websocket
    const wsTx = findLastCallFor(txSent.hash, wsSpy);
    expect(wsTx).toBeDefined();
    if (!wsTx) {
      // This is to comply with ts typing, function should have aborted on the
      // line above if it was undefined.
      throw new Error('wsTx should be defined here.');
    }
    expect(wsTx.history.tx_id).toStrictEqual(txSent.hash);
    // Mark tx as voided
    wsTx.history.is_voided = true;

    // Simulate the wallet receiving a void update
    procSpy.mockClear();
    await hWallet.onNewTx(wsTx);
    expect(procSpy).toHaveBeenCalled();

    // Send the unspent injected tx to simulate the metadata change event.
    await hWallet.onNewTx(wsTxInjected);

    // Since the only transaction on the wallet has been voided it should
    // register as empty with 0 transactions
    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 1,
        balance: { unlocked: 10n, locked: 0n },
      }),
    ]);

    // txSent is still on storage but not its utxos
    await expect(hWallet.storage.getTx(txSent.hash)).resolves.toBeDefined();
    expect(store.utxos.size).toStrictEqual(1);
    // utxos go back to being from the injected tx
    expect(Array.from(store.utxos.values())).toEqual([
      expect.objectContaining({
        txId: injectedTx.hash,
      }),
    ]);
  });

  it('should process history when a tx sent by the wallet to another wallet is voided', async () => {
    const store = hWallet.storage.store as MemoryStore;
    const addr0 = await hWallet.getAddressAtIndex(0);
    const genesis = await GenesisWalletHelper.getSingleton();
    const addrExt = await genesis.hWallet.getAddressAtIndex(1);
    const wsSpy: jest.SpiedFunction<typeof hWallet.onNewTx> = jest.spyOn(hWallet, 'onNewTx');
    const procSpy: jest.SpiedFunction<typeof hWallet.storage.processHistory> = jest.spyOn(
      hWallet.storage,
      'processHistory'
    );

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 0,
        balance: { unlocked: 0n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(0);

    const injectedTx = await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);
    if (!injectedTx.hash) {
      throw new Error('Could not inject funds into wallet');
    }
    await waitForTxReceived(hWallet, injectedTx.hash);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 1,
        balance: { unlocked: 10n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(1);
    expect(Array.from(store.utxos.values())).toEqual([
      expect.objectContaining({
        txId: injectedTx.hash,
      }),
    ]);

    // This is the unspent injected tx
    const wsTxInjected = findLastCallFor(injectedTx.hash, wsSpy);
    expect(wsTxInjected).toBeDefined();
    if (!wsTxInjected) {
      throw new Error('undefined hash for injected tx, should not happen.');
    }

    wsSpy.mockClear();

    // Send a tx from the wallet to genesis
    const txSent = await hWallet.sendTransaction(addrExt, 5n);
    expect(txSent.hash).toBeDefined();
    if (!txSent.hash) {
      throw new Error('undefined hash for tx sent, should not happen.');
    }
    await waitForTxReceived(hWallet, txSent.hash);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 2,
        balance: { unlocked: 5n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(1);
    expect(Array.from(store.utxos.values())).toEqual([
      expect.objectContaining({
        txId: txSent.hash,
      }),
    ]);

    expect(wsSpy).toHaveBeenCalled();
    // Get a copy of the transaction received via websocket
    const wsTx = findLastCallFor(txSent.hash, wsSpy);
    expect(wsTx).toBeDefined();
    if (!wsTx) {
      // This is to comply with ts typing, function should have aborted on the
      // line above if it was undefined.
      throw new Error('wsTx should be defined here.');
    }

    expect(wsTx.history.tx_id).toStrictEqual(txSent.hash);
    // Mark tx as voided
    wsTx.history.is_voided = true;

    // Simulate the wallet receiving a void update
    procSpy.mockClear();
    await hWallet.onNewTx(wsTx);
    expect(procSpy).toHaveBeenCalled();

    // Send the unspent injected tx to simulate the metadata change event.
    await hWallet.onNewTx(wsTxInjected);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 1,
        balance: { unlocked: 10n, locked: 0n },
      }),
    ]);

    // txSent is still on storage but not its utxos
    await expect(hWallet.storage.getTx(txSent.hash)).resolves.toBeDefined();
    expect(store.utxos.size).toStrictEqual(1);
    // utxos go back to being from the injected tx
    expect(Array.from(store.utxos.values())).toEqual([
      expect.objectContaining({
        txId: injectedTx.hash,
      }),
    ]);
  });

  it('should process history when create token tx is voided', async () => {
    const store = hWallet.storage.store as MemoryStore;
    const addr0 = await hWallet.getAddressAtIndex(0);
    const wsSpy: jest.SpiedFunction<typeof hWallet.onNewTx> = jest.spyOn(hWallet, 'onNewTx');
    const procSpy: jest.SpiedFunction<typeof hWallet.storage.processHistory> = jest.spyOn(
      hWallet.storage,
      'processHistory'
    );

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 0,
        balance: { unlocked: 0n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(0);

    const injectedTx = await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);
    if (!injectedTx.hash) {
      throw new Error('Could not inject funds into wallet');
    }
    await waitForTxReceived(hWallet, injectedTx.hash);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 1,
        balance: { unlocked: 10n, locked: 0n },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(1);
    expect(Array.from(store.utxos.values())).toEqual([
      expect.objectContaining({
        txId: injectedTx.hash,
      }),
    ]);
    expect(store.tokens.size).toStrictEqual(1); // HTR

    // This is the unspent injected tx
    const wsTxInjected = findLastCallFor(injectedTx.hash, wsSpy);
    expect(wsTxInjected).toBeDefined();
    if (!wsTxInjected) {
      throw new Error('undefined hash for injected tx, should not happen.');
    }

    wsSpy.mockClear();
    // Create a token
    const tokenTx = await hWallet.createNewToken('Create Void test', 'CVT01', 100n);
    expect(tokenTx.hash).toBeDefined();
    if (!tokenTx.hash) {
      throw new Error('undefined hash for tx sent, should not happen.');
    }
    const tokenUid = tokenTx.hash;
    await waitForTxReceived(hWallet, tokenTx.hash);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 2,
        balance: { unlocked: 9n, locked: 0n },
      }),
    ]);
    await expect(hWallet.getBalance(tokenUid)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: tokenUid }),
        transactions: 1,
        balance: { unlocked: 100n, locked: 0n },
        tokenAuthorities: {
          unlocked: { mint: 1n, melt: 1n },
          locked: { mint: 0n, melt: 0n },
        },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(4); // token + change + 2 authorities
    expect(store.tokens.size).toStrictEqual(2); // HTR + token

    expect(wsSpy).toHaveBeenCalled();

    // Get a copy of the transaction received via websocket
    const wsTx = findLastCallFor(tokenTx.hash, wsSpy);
    expect(wsTx).toBeDefined();
    if (!wsTx) {
      // This is to comply with ts typing, function should have aborted on the
      // line above if it was undefined.
      throw new Error('wsTx should be defined here.');
    }

    expect(wsTx.history.tx_id).toStrictEqual(tokenTx.hash);
    // Mark tx as voided
    wsTx.history.is_voided = true;

    // Simulate the wallet receiving a void update
    procSpy.mockClear();
    await hWallet.onNewTx(wsTx);
    expect(procSpy).toHaveBeenCalled();

    // Send the unspent injected tx to simulate the metadata change event.
    await hWallet.onNewTx(wsTxInjected);

    // tokenTx is still on storage but not its utxos
    await expect(hWallet.storage.getTx(tokenTx.hash)).resolves.toBeDefined();

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        transactions: 1,
        balance: { unlocked: 10n, locked: 0n },
      }),
    ]);
    // Wallet still responds with balance object, but empty
    await expect(hWallet.getBalance(tokenUid)).resolves.toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: tokenUid }),
        transactions: 0,
        balance: { unlocked: 0n, locked: 0n },
        tokenAuthorities: {
          unlocked: { mint: 0n, melt: 0n },
          locked: { mint: 0n, melt: 0n },
        },
      }),
    ]);
    expect(store.utxos.size).toStrictEqual(1);
    expect(store.tokens.size).toStrictEqual(2);
    // utxos go back to being from the injected tx
    expect(Array.from(store.utxos.values())).toEqual([
      expect.objectContaining({
        txId: injectedTx.hash,
      }),
    ]);
  });
});
