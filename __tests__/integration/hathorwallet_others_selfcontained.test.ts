import { cloneDeep, reverse } from 'lodash';
import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay } from './utils/core.util';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from './helpers/wallet.helper';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import {
  WALLET_CONSTANTS,
} from './configuration/test-constants';
import dateFormatter from '../../src/utils/date';
import { precalculationHelpers } from './helpers/wallet-precalculation.helper';
import HathorWallet from '../../src/new/wallet';
import { MemoryStore } from '../../src/storage';
import { IHistoryTx } from '../../src/types';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('processing transaction metadata changes', () => {
  let hWallet: HathorWallet;

  beforeEach(async () => {
    hWallet = await generateWalletHelper(null);
  });

  afterEach(async () => {
    await hWallet.stop();
  });

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

describe('getTxAddresses', () => {
  it('should identify transaction addresses correctly', async () => {
    const hWallet = await generateWalletHelper();
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();

    // Generating a transaction with outputs to multiple addresses
    const tx = await gWallet.sendManyOutputsTransaction(
      [
        { address: await hWallet.getAddressAtIndex(1), value: 1n, token: NATIVE_TOKEN_UID },
        { address: await hWallet.getAddressAtIndex(3), value: 3n, token: NATIVE_TOKEN_UID },
        { address: await hWallet.getAddressAtIndex(5), value: 5n, token: NATIVE_TOKEN_UID },
      ],
      {
        changeAddress: WALLET_CONSTANTS.genesis.addresses[0],
      }
    );
    await waitForTxReceived(hWallet, tx.hash);
    await waitForTxReceived(gWallet, tx.hash);

    // Validating the method results
    const decodedTx = await hWallet.getTx(tx.hash);
    await expect(hWallet.getTxAddresses(decodedTx)).resolves.toStrictEqual(
      new Set([
        await hWallet.getAddressAtIndex(1),
        await hWallet.getAddressAtIndex(3),
        await hWallet.getAddressAtIndex(5),
      ])
    );

    // By convention, only the address 0 of the genesis wallet is used on the integration tests
    await expect(gWallet.getTxAddresses(decodedTx)).resolves.toStrictEqual(
      new Set([WALLET_CONSTANTS.genesis.addresses[0]])
    );
  });
});

describe('checkAddressesMine', () => {
  it('should', async () => {
    const hWallet = await generateWalletHelper();

    const address1 = await hWallet.getAddressAtIndex(1);
    const address2 = await hWallet.getAddressAtIndex(2);
    const address3 = await hWallet.getAddressAtIndex(3);

    expect(
      await hWallet.checkAddressesMine([address1, address2, address3, 'invalid-address'])
    ).toStrictEqual({
      [address1]: true,
      [address2]: true,
      [address3]: true,
      'invalid-address': false,
    });
  });
});

describe('getAvailableUtxos', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should correctly identify all utxos on an empty wallet', async () => {
    /**
     * @type HathorWallet
     */
    const hWallet = await generateWalletHelper();

    // Get correct results for an empty wallet
    let utxoGenerator = await hWallet.getAvailableUtxos();
    let utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult).toStrictEqual({ done: true, value: undefined });

    // Inject a transaction and validate the results
    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    // Get correct results for a single transaction
    utxoGenerator = await hWallet.getAvailableUtxos();
    utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult).toMatchObject({
      done: false,
      value: {
        txId: tx1.hash,
        index: expect.any(Number),
        tokenId: NATIVE_TOKEN_UID,
        address: await hWallet.getAddressAtIndex(0),
        value: 10n,
        authorities: 0n,
        timelock: null,
        heightlock: null,
        locked: false,
        addressPath: expect.stringMatching(/\/0$/), // Matches "m/44'/280'/0'/0/0", for example
      },
    });

    // Expect the generator to have finished
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });
  });

  it('should filter by address', async () => {
    /**
     * @type HathorWallet
     */
    const hWallet = await generateWalletHelper();
    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );
    const tx2 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(1),
      5n
    );

    // Validate that on the address that received tx1, the UTXO is listed
    let utxoGenerator = await hWallet.getAvailableUtxos({
      filter_address: await hWallet.getAddressAtIndex(0),
    });
    let utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tx1.hash,
      value: 10n,
    });
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });

    // Validate that on the address that received tx2, the UTXO is listed
    utxoGenerator = await hWallet.getAvailableUtxos({
      filter_address: await hWallet.getAddressAtIndex(1),
    });
    utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tx2.hash,
      value: 5n,
    });
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });

    // Validate that on an address that did not receive any transaction, the results are empty
    utxoGenerator = await hWallet.getAvailableUtxos({
      filter_address: await hWallet.getAddressAtIndex(2),
    });
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });
  });

  it('should filter by custom token', async () => {
    /**
     * @type HathorWallet
     */
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getAvailableUtxos Token',
      'GAUT',
      100n
    );

    /*
     * Validate that:
     * - The method's default token is HTR when calling without parameters
     * - The HTR change is listed
     */
    let utxoGenerator = await hWallet.getAvailableUtxos();
    const utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tokenUid,
      tokenId: NATIVE_TOKEN_UID,
      value: 9n,
    });
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });

    // Validate that the custom token utxo is listed with its authority tokens
    // By default list only funds
    utxoGenerator = hWallet.getAvailableUtxos({ token: tokenUid });
    let allResults = [];
    for await (const u of utxoGenerator) {
      allResults.push(u);
    }

    expect(allResults).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          txId: tokenUid,
          tokenId: tokenUid,
          value: 100n,
          authorities: 0n, // The custom token balance itself
        }),
      ])
    );

    // List all authorities
    utxoGenerator = hWallet.getAvailableUtxos({ token: tokenUid, authorities: 3n });
    allResults = [];
    for await (const u of utxoGenerator) {
      allResults.push(u);
    }

    expect(allResults).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          txId: tokenUid,
          tokenId: tokenUid,
          value: TOKEN_MINT_MASK,
          authorities: TOKEN_MINT_MASK,
        }),
        expect.objectContaining({
          txId: tokenUid,
          tokenId: tokenUid,
          value: TOKEN_MELT_MASK,
          authorities: TOKEN_MELT_MASK,
        }),
      ])
    );
  });
});

describe('index-limit address scanning policy', () => {
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    hWallet = await generateWalletHelper({
      seed: walletData.words,
      addresses: walletData.addresses,
      scanPolicy: {
        policy: 'index-limit',
        startIndex: 0,
        endIndex: 9,
      },
    });
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should start a wallet configured to index-limit', async () => {
    // 0-9 addresses = 10
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(10);

    // 0-14 addresses = 15
    await hWallet.indexLimitLoadMore(5);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(15);

    // 0-24 addresses = 25
    await hWallet.indexLimitSetEndIndex(24);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(25);

    // Setting below current loaded index will be a no-op
    await hWallet.indexLimitSetEndIndex(5);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(25);
  });
});
