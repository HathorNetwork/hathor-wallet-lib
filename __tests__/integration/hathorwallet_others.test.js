import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay } from './utils/core.util';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import {
  FULLNODE_NETWORK_NAME,
  FULLNODE_URL,
  NETWORK_NAME,
  WALLET_CONSTANTS,
} from './configuration/test-constants';
import dateFormatter from '../../src/utils/date';
import { AddressError } from '../../src/errors';
import { precalculationHelpers } from './helpers/wallet-precalculation.helper';
import { ConnectionState } from '../../src/wallet/types';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('getAddressInfo', () => {
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should display correct values for HTR transactions with no change', async () => {
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr1 = await hWallet.getAddressAtIndex(1);

    // Validating empty address information
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 0,
      total_amount_sent: 0,
      total_amount_available: 0,
      total_amount_locked: 0, // Validating this field only once to check it's returned
      token: NATIVE_TOKEN_UID, // Validating this field only once to ensure it's correct
      index: 0,
    });

    // Validating address after 1 transaction
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 0,
      total_amount_available: 10,
    });

    // Validating the results for two transactions
    let tx = await hWallet.sendTransaction(addr1, 10);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 10,
      total_amount_available: 0,
      index: 0, // Ensuring the index is correct
    });
    await expect(hWallet.getAddressInfo(addr1)).resolves.toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 0,
      total_amount_available: 10,
      index: 1, // Ensuring the index is correct
    });

    // Validating the results for the funds returning to previously used address
    await waitUntilNextTimestamp(hWallet, tx.hash);
    tx = await hWallet.sendTransaction(addr0, 10);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 20,
      total_amount_sent: 10,
      total_amount_available: 10,
    });
    await expect(hWallet.getAddressInfo(addr1)).resolves.toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 10,
      total_amount_available: 0,
    });
  });

  it('should throw for an address outside the wallet', async () => {
    await expect(hWallet.getAddressInfo(WALLET_CONSTANTS.genesis.addresses[0])).rejects.toThrow(
      AddressError
    );
  });

  it('should display correct values for transactions with change', async () => {
    const addr2 = await hWallet.getAddressAtIndex(2);
    const addr3 = await hWallet.getAddressAtIndex(3);

    // Ensure both are empty addresses
    expect((await hWallet.getAddressInfo(addr2)).total_amount_received).toStrictEqual(0);
    expect((await hWallet.getAddressInfo(addr3)).total_amount_received).toStrictEqual(0);

    await delay(500);
    // Move all the wallet's funds to addr2
    let tx = await hWallet.sendTransaction(addr2, 10);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr2)).resolves.toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 0,
      total_amount_available: 10,
    });

    // Move only a part of the funds to addr3, the change is returned to addr2
    tx = await hWallet.sendTransaction(addr3, 4, { changeAddress: addr2 });
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr2)).resolves.toMatchObject({
      total_amount_received: 16, // 10 from one transaction, 6 from the transaction change
      total_amount_sent: 10, // All the funds were sent
      total_amount_available: 6, // Only the change remains available
    });
    await expect(hWallet.getAddressInfo(addr3)).resolves.toMatchObject({
      total_amount_received: 4,
      total_amount_sent: 0,
      total_amount_available: 4,
    });
  });

  it('should return correct values for locked utxos', async () => {
    const timelock1 = Date.now().valueOf() + 5000; // 5 seconds of locked resources
    const timelockTimestamp = dateFormatter.dateToTimestamp(new Date(timelock1));
    const rawTimelockTx = await hWallet.sendManyOutputsTransaction([
      {
        address: await hWallet.getAddressAtIndex(0),
        value: 7,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: await hWallet.getAddressAtIndex(0),
        value: 3,
        token: NATIVE_TOKEN_UID,
        timelock: timelockTimestamp,
      },
    ]);
    await waitForTxReceived(hWallet, rawTimelockTx.hash);

    // Validating locked balance
    await expect(hWallet.getAddressInfo(await hWallet.getAddressAtIndex(0))).resolves.toMatchObject(
      {
        total_amount_available: 7,
        total_amount_locked: 3,
      }
    );
  });

  it('should test custom token transactions', async () => {
    // Generating a new wallet to avoid conflict with HTR wallet
    const hWalletCustom = await generateWalletHelper();
    const addr0Custom = await hWalletCustom.getAddressAtIndex(0);
    const addr1Custom = await hWalletCustom.getAddressAtIndex(1);

    // Creating custom token
    await GenesisWalletHelper.injectFunds(hWalletCustom, addr0Custom, 1);
    const { hash: tokenUid } = await createTokenHelper(
      hWalletCustom,
      'getAddressInfo Token',
      'GAIT',
      100,
      { address: addr0Custom }
    );

    // Validating address information both in HTR and in custom token
    await expect(hWalletCustom.getAddressInfo(addr0Custom)).resolves.toMatchObject({
      total_amount_received: 1,
      total_amount_sent: 1, // Custom token mint consumed this balance
      total_amount_available: 0,
      total_amount_locked: 0,
      token: NATIVE_TOKEN_UID,
      index: 0,
    });
    await expect(
      hWalletCustom.getAddressInfo(addr0Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 100,
      total_amount_sent: 0,
      total_amount_available: 100,
      total_amount_locked: 0,
      token: tokenUid,
      index: 0,
    });

    // Validating address after 1 transaction
    const tx = await hWalletCustom.sendTransaction(addr1Custom, 40, { token: tokenUid });
    await waitForTxReceived(hWalletCustom, tx.hash);
    await expect(
      hWalletCustom.getAddressInfo(addr0Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 100,
      total_amount_sent: 100,
      total_amount_available: 0,
      token: tokenUid,
      index: 0,
    });
    await expect(
      hWalletCustom.getAddressInfo(addr1Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 40,
      total_amount_sent: 0,
      total_amount_available: 40,
      token: tokenUid,
      index: 1,
    });
  });
});

describe('getTxAddresses', () => {
  it('should identify transaction addresses correctly', async () => {
    const hWallet = await generateWalletHelper();
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();

    // Generating a transaction with outputs to multiple addresses
    const tx = await gWallet.sendManyOutputsTransaction(
      [
        { address: await hWallet.getAddressAtIndex(1), value: 1, token: NATIVE_TOKEN_UID },
        { address: await hWallet.getAddressAtIndex(3), value: 3, token: NATIVE_TOKEN_UID },
        { address: await hWallet.getAddressAtIndex(5), value: 5, token: NATIVE_TOKEN_UID },
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
      10
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
        value: 10,
        authorities: 0,
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
      10
    );
    const tx2 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(1),
      5
    );

    // Validate that on the address that received tx1, the UTXO is listed
    let utxoGenerator = await hWallet.getAvailableUtxos({
      filter_address: await hWallet.getAddressAtIndex(0),
    });
    let utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tx1.hash,
      value: 10,
    });
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });

    // Validate that on the address that received tx2, the UTXO is listed
    utxoGenerator = await hWallet.getAvailableUtxos({
      filter_address: await hWallet.getAddressAtIndex(1),
    });
    utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tx2.hash,
      value: 5,
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
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getAvailableUtxos Token',
      'GAUT',
      100
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
      value: 9,
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
          value: 100,
          authorities: 0, // The custom token balance itself
        }),
      ])
    );

    // List all authorities
    utxoGenerator = hWallet.getAvailableUtxos({ token: tokenUid, authorities: 3 });
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

describe('getUtxosForAmount', () => {
  /** @type HathorWallet */
  let hWallet;
  let fundTx1hash;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  });

  it('should throw on an empty wallet', async () => {
    // Should throw for invalid requested amount
    await expect(hWallet.getUtxosForAmount(0)).rejects.toThrow('positive integer');
    await expect(hWallet.getUtxosForAmount(-1)).rejects.toThrow('positive integer');

    // Should throw for an amount higher than available funds
    await expect(hWallet.getUtxosForAmount(1)).rejects.toThrow('utxos to fill total amount');
  });

  it('should work on a wallet containing a single tx', async () => {
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr1 = await hWallet.getAddressAtIndex(1);
    const tx1 = await GenesisWalletHelper.injectFunds(hWallet, addr0, 10);
    fundTx1hash = tx1.hash;

    // No change amount
    await expect(hWallet.getUtxosForAmount(10)).resolves.toStrictEqual({
      changeAmount: 0,
      utxos: [
        {
          txId: fundTx1hash,
          index: expect.any(Number),
          tokenId: NATIVE_TOKEN_UID,
          address: addr0,
          value: 10,
          authorities: 0,
          timelock: null,
          heightlock: null,
          locked: false,
          addressPath: expect.any(String),
        },
      ],
    });

    await expect(hWallet.getUtxosForAmount(6)).resolves.toStrictEqual({
      changeAmount: 4,
      utxos: [
        expect.objectContaining({
          address: addr0,
          value: 10,
        }),
      ],
    });

    // Should filter by address
    await expect(hWallet.getUtxosForAmount(10, { filter_address: addr0 })).resolves.toStrictEqual({
      changeAmount: 0,
      utxos: [expect.anything()],
    });
    await expect(hWallet.getUtxosForAmount(10, { filter_address: addr1 })).rejects.toThrow(
      'utxos to fill total amount'
    );

    // Should throw for an amount higher than available funds
    await expect(hWallet.getUtxosForAmount(31)).rejects.toThrow('utxos to fill total amount');
  });

  it('should work on a wallet containing multiple txs', async () => {
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr1 = await hWallet.getAddressAtIndex(1);
    const tx2 = await GenesisWalletHelper.injectFunds(hWallet, addr1, 20);

    /*
     * Since we don't know which order the transactions will be stored on the history,
     * we can't make tests that depend on utxo ordering. These will be done on the unit
     * tests.
     */

    // Should select only one utxo to satisfy the amount when both can do it
    expect((await hWallet.getUtxosForAmount(7)).utxos).toHaveLength(1);
    expect((await hWallet.getUtxosForAmount(10)).utxos).toHaveLength(1);

    // Should select the least amount of utxos that can satisfy the amount
    await expect(hWallet.getUtxosForAmount(20)).resolves.toStrictEqual({
      changeAmount: 0,
      utxos: [
        expect.objectContaining({
          txId: tx2.hash,
          address: addr1,
          value: 20,
        }),
      ],
    });

    // Should select more than one utxo to cover an amount
    await expect(hWallet.getUtxosForAmount(29)).resolves.toStrictEqual({
      changeAmount: 1,
      utxos: expect.arrayContaining([
        expect.objectContaining({
          txId: fundTx1hash,
          value: 10,
        }),
        expect.objectContaining({
          txId: tx2.hash,
          value: 20,
        }),
      ]),
    });

    // Should filter by address
    await expect(hWallet.getUtxosForAmount(10, { filter_address: addr0 })).resolves.toStrictEqual({
      changeAmount: 0,
      utxos: [
        expect.objectContaining({
          txId: fundTx1hash,
          address: addr0,
          value: 10,
        }),
      ],
    });
    await expect(hWallet.getUtxosForAmount(10, { filter_address: addr1 })).resolves.toStrictEqual({
      changeAmount: 10,
      utxos: [
        expect.objectContaining({
          txId: tx2.hash,
          address: addr1,
          value: 20,
        }),
      ],
    });

    // Should throw for an amount higher than available funds
    await expect(hWallet.getUtxosForAmount(31)).rejects.toThrow('utxos to fill total amount');
  });

  it('should filter by custom token', async () => {
    const addr2 = await hWallet.getAddressAtIndex(2);
    const addr3 = await hWallet.getAddressAtIndex(3);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getUtxosForAmount Test Token',
      'GUFAT',
      200,
      { address: addr2 }
    );

    // Should work only with the token filter
    await expect(hWallet.getUtxosForAmount(6, { token: tokenUid })).resolves.toStrictEqual({
      changeAmount: 194,
      utxos: [
        expect.objectContaining({
          address: addr2,
          value: 200,
          tokenId: tokenUid,
        }),
      ],
    });
    // Explicitly filtering for HTR
    await expect(hWallet.getUtxosForAmount(6, { token: NATIVE_TOKEN_UID })).resolves.toStrictEqual({
      changeAmount: expect.any(Number),
      utxos: [expect.objectContaining({ tokenId: NATIVE_TOKEN_UID })],
    });
    // Implicitly filtering for HTR
    await expect(hWallet.getUtxosForAmount(6)).resolves.toStrictEqual({
      changeAmount: expect.any(Number),
      utxos: [expect.objectContaining({ tokenId: NATIVE_TOKEN_UID })],
    });

    // The token filter should work combined with the address filter
    await expect(
      hWallet.getUtxosForAmount(6, { token: tokenUid, filter_address: addr2 })
    ).resolves.toStrictEqual({
      changeAmount: 194,
      utxos: [
        expect.objectContaining({
          address: addr2,
          value: 200,
        }),
      ],
    });
    await expect(
      hWallet.getUtxosForAmount(6, { token: tokenUid, filter_address: addr3 })
    ).rejects.toThrow('utxos to fill');
  });

  it('should not retrieve utxos marked as selected', async () => {
    // Retrieving the utxo's data and marking it as selected
    const addr = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(hWallet, addr, 100);

    const utxosAddr1 = await hWallet.getUtxos({ filter_address: addr });
    const singleUtxoAddr1 = utxosAddr1.utxos[0];
    await hWallet.markUtxoSelected(singleUtxoAddr1.tx_id, singleUtxoAddr1.index, true);

    // Validate that it will not be retrieved on getUtxosForAmount
    await expect(hWallet.getUtxosForAmount(50, { filter_address: addr })).rejects.toThrow(
      'utxos to fill'
    );
  });
});

describe('consolidateUtxos', () => {
  /** @type HathorWallet */
  let hWallet1;
  /** @type HathorWallet */
  let hWallet2;
  /** @type string */
  let tokenHash;

  /*
   * The test initialization creates two wallets,
   * Wallet1: Empty, with no transactions
   * Wallet2: Containing HTR and custom token funds
   */
  beforeAll(async () => {
    hWallet1 = await generateWalletHelper();
    hWallet2 = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet2, await hWallet2.getAddressAtIndex(0), 110);
    const { hash: tokenUid } = await createTokenHelper(hWallet2, 'Consolidate Token', 'CTK', 1000, {
      address: await hWallet2.getAddressAtIndex(0),
    });
    tokenHash = tokenUid;
  });
  afterAll(async () => {
    await hWallet1.stop();
    await hWallet2.stop();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * Helper function to empty wallet1 of a specified token and move it all back to wallet2.
   * @param {string} [token]
   * @returns {Promise<void>}
   */
  async function cleanWallet1(token) {
    const [balanceObj] = await hWallet1.getBalance(token);
    const tokenBalance = balanceObj?.balance?.unlocked || 0;
    if (tokenBalance === 0) {
      return;
    }

    const cleanTx = await hWallet1.sendTransaction(
      await hWallet2.getAddressAtIndex(0),
      tokenBalance,
      { token }
    );
    await waitForTxReceived(hWallet1, cleanTx.hash);
    await waitForTxReceived(hWallet2, cleanTx.hash);
    await waitUntilNextTimestamp(hWallet1, cleanTx.hash);
  }

  it('should throw when consolidating on an empty wallet', async () => {
    await expect(hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(0))).rejects.toThrow(
      'available utxo'
    );
  });

  it('should throw when consolidating on an invalid address', async () => {
    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: await hWallet1.getAddressAtIndex(0), value: 4, token: NATIVE_TOKEN_UID },
      { address: await hWallet1.getAddressAtIndex(1), value: 5, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    await expect(hWallet1.consolidateUtxos(hWallet2.getAddressAtIndex(0))).rejects.toThrow(
      'not owned by this wallet'
    );

    await waitUntilNextTimestamp(hWallet1, fundTx.hash);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate two utxos (htr)', async () => {
    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: await hWallet1.getAddressAtIndex(0), value: 4, token: NATIVE_TOKEN_UID },
      { address: await hWallet1.getAddressAtIndex(1), value: 5, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(2), {
      token: NATIVE_TOKEN_UID,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 9,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        {
          address: await hWallet1.getAddressAtIndex(0),
          amount: 4,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
        {
          address: await hWallet1.getAddressAtIndex(1),
          amount: 5,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
      ]),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    const utxos = await hWallet1.getUtxos();
    expect(utxos).toStrictEqual({
      total_amount_available: 9,
      total_utxos_available: 1,
      total_amount_locked: 0,
      total_utxos_locked: 0,
      utxos: [
        {
          address: await hWallet1.getAddressAtIndex(2),
          amount: 9,
          tx_id: consolidateTx.txId,
          locked: false,
          index: 0, // This has a single resulting utxo, so 1 output only
        },
      ],
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate two utxos (custom token)', async () => {
    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: await hWallet1.getAddressAtIndex(3), value: 40, token: tokenHash },
      { address: await hWallet1.getAddressAtIndex(4), value: 50, token: tokenHash },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(5), {
      token: tokenHash,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 90,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        {
          address: await hWallet1.getAddressAtIndex(3),
          amount: 40,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
        {
          address: await hWallet1.getAddressAtIndex(4),
          amount: 50,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
      ]),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    const utxos = await hWallet1.getUtxos({ token: tokenHash });
    expect(utxos).toStrictEqual({
      total_amount_available: 90,
      total_utxos_available: 1,
      total_amount_locked: 0,
      total_utxos_locked: 0,
      utxos: [
        {
          address: await hWallet1.getAddressAtIndex(5),
          amount: 90,
          tx_id: consolidateTx.txId,
          locked: false,
          index: 0, // This has a single resulting utxo, so 1 output only
        },
      ],
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(tokenHash);
  });

  it('should consolidate with filter_address filter', async () => {
    const addr1 = await hWallet1.getAddressAtIndex(1);
    const addr2 = await hWallet1.getAddressAtIndex(2);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: addr1, value: 1, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 2, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 1, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 1, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 3, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(3), {
      token: NATIVE_TOKEN_UID,
      filter_address: addr2,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 3,
      total_amount: 5,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        expect.objectContaining({ address: addr2 }),
        expect.objectContaining({ address: addr2 }),
        expect.objectContaining({ address: addr2 }),
      ]),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(1))).toMatchObject({
      total_amount_available: 3,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 0,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(3))).toMatchObject({
      total_amount_available: 5,
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate with amount_smaller_than filter', async () => {
    const addr1 = await hWallet1.getAddressAtIndex(1);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: addr1, value: 1, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 2, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 3, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 4, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 5, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(2), {
      token: NATIVE_TOKEN_UID,
      amount_smaller_than: 3,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 3,
      txId: expect.any(String),
      utxos: expect.objectContaining({ length: 2 }),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(1))).toMatchObject({
      total_amount_available: 12,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 3,
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate with amount_bigger_than filter', async () => {
    const addr2 = await hWallet1.getAddressAtIndex(2);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: addr2, value: 1, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 2, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 3, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 4, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 5, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(4), {
      token: NATIVE_TOKEN_UID,
      amount_bigger_than: 3,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 9,
      txId: expect.any(String),
      utxos: expect.objectContaining({ length: 2 }),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 6,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(4))).toMatchObject({
      total_amount_available: 9,
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate with amount_bigger_than and max_amount filter', async () => {
    const addr2 = await hWallet1.getAddressAtIndex(2);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: addr2, value: 1, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 4, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 5, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 20, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 40, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(4), {
      token: NATIVE_TOKEN_UID,
      amount_bigger_than: 2,
      max_amount: 15,
    });
    // FIXME: This result is not consistent, sometimes it fetches only utxo "20".
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 9,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        expect.objectContaining({ amount: 4 }),
        expect.objectContaining({ amount: 5 }),
      ]),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 61,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(4))).toMatchObject({
      total_amount_available: 9,
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate at most the maximum output constant', async () => {
    // Funding the wallet1
    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: await hWallet1.getAddressAtIndex(0), value: 1, token: tokenHash },
      { address: await hWallet1.getAddressAtIndex(0), value: 1, token: tokenHash },
      { address: await hWallet1.getAddressAtIndex(0), value: 1, token: tokenHash },
      { address: await hWallet1.getAddressAtIndex(0), value: 1, token: tokenHash },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // We should now have 4 utxos on wallet1 for this custom token
    expect(await hWallet1.getUtxos({ token: tokenHash })).toHaveProperty(
      'total_utxos_available',
      4
    );

    // Reducing the amount of maximum inputs allowed for the lib (not the fullnode)
    const oldMaxInputs = hWallet1.storage.version.max_number_inputs;
    hWallet1.storage.version.max_number_inputs = 2;

    // Trying to consolidate all of them on a single utxo
    await waitUntilNextTimestamp(hWallet1, fundTx.hash);
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(4), {
      token: tokenHash,
    });

    // Reverting the amount of maximum outputs allowed by the lib
    hWallet1.storage.version.max_number_inputs = oldMaxInputs;

    // The lib should respect its maximum output limit at the time of the transaction
    expect(consolidateTx.utxos).toHaveLength(2);
    await waitForTxReceived(hWallet1, consolidateTx.txId);

    // Ensure the maximum possible amount of utxos was consolidated ( 1 consolidated + 2 remaining )
    expect(await hWallet1.getUtxos({ token: tokenHash })).toHaveProperty(
      'total_utxos_available',
      3
    );
  });
});

describe('getAuthorityUtxos', () => {
  /** @type HathorWallet */
  let hWallet;
  /** @type string */
  let tokenHash;
  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });
  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  });

  it('should work on an empty wallet', async () => {
    // Testing the wrapper method
    expect(await hWallet.getAuthorityUtxos(fakeTokenUid, 'mint')).toStrictEqual([]);
    expect(await hWallet.getAuthorityUtxos(fakeTokenUid, 'melt')).toStrictEqual([]);
    await expect(hWallet.getAuthorityUtxos(fakeTokenUid, 'invalid')).rejects.toThrow(
      'This should never happen.'
    ); // TODO: Improve this error message
  });

  it('should find one authority utxo', async () => {
    // Creating the token
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getAuthorityUtxos Token',
      'GAUT',
      100
    );
    tokenHash = tokenUid;

    // Validating the wrapper method
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'mint')).toStrictEqual([
      {
        txId: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        token: tokenHash,
        authorities: 1,
        value: 1,
        height: null,
        timelock: null,
        type: expect.any(Number),
      },
    ]);
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'melt')).toStrictEqual([
      {
        txId: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        token: tokenHash,
        timelock: null,
        height: null,
        authorities: TOKEN_MELT_MASK,
        value: 2,
        type: expect.any(Number),
      },
    ]);
  });

  it('should find many "mint" authority utxos', async () => {
    // Delegating the mint to another address on the same wallet
    const mintDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'mint',
      await hWallet.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet, mintDelegationTx.hash);

    // Should not find the spent utxo
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'mint')).toMatchObject([
      {
        txId: mintDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      },
    ]);
  });

  it('should find many "melt" authority utxos', async () => {
    // Delegating the mint to another address on the same wallet
    const meltDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'melt',
      await hWallet.getAddressAtIndex(1),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet, meltDelegationTx.hash);

    // When searching for "many", should find both the authority tokens
    const expectedMeltAuthUtxos = [
      {
        txId: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
        height: null,
        timelock: null,
        token: tokenHash,
        type: expect.any(Number),
        value: TOKEN_MELT_MASK,
      },
      {
        txId: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
        height: null,
        timelock: null,
        token: tokenHash,
        type: expect.any(Number),
        value: TOKEN_MELT_MASK,
      },
    ];
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'melt')).toStrictEqual(expectedMeltAuthUtxos);
  });
});

// This section tests methods that have side effects impacting the whole wallet. Executing it last.
describe('internal methods', () => {
  /** @type HathorWallet */
  let gWallet;
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    const { hWallet: ghWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = ghWallet;
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
    await gWallet.stop();
  });

  it('should test the debug methods', async () => {
    expect(gWallet.debug).toStrictEqual(false);

    gWallet.enableDebugMode();
    expect(gWallet.debug).toStrictEqual(true);

    gWallet.disableDebugMode();
    expect(gWallet.debug).toStrictEqual(false);
  });

  it('should test network-related methods', async () => {
    // GetServerUrl fetching from the live fullnode connection
    expect(await gWallet.getServerUrl()).toStrictEqual(FULLNODE_URL);
    expect(await gWallet.getNetwork()).toStrictEqual(NETWORK_NAME);
    expect(await gWallet.getNetworkObject()).toMatchObject({
      name: NETWORK_NAME,
      versionBytes: { p2pkh: 73, p2sh: 135 }, // Calculated for the privnet.py config file
      bitcoreNetwork: {
        name: expect.stringContaining(NETWORK_NAME),
        alias: 'test', // this is the alias for the testnet network
        pubkeyhash: 73,
        scripthash: 135,
      },
    });

    // GetVersionData fetching from the live fullnode server
    expect(await gWallet.getVersionData()).toMatchObject({
      timestamp: expect.any(Number),
      version: expect.stringMatching(/^\d+\.\d+\.\d+.*$/),
      network: FULLNODE_NETWORK_NAME,
      minWeight: expect.any(Number),
      minTxWeight: expect.any(Number),
      minTxWeightCoefficient: expect.any(Number),
      minTxWeightK: expect.any(Number),
      tokenDepositPercentage: 0.01,
      rewardSpendMinBlocks: expect.any(Number),
      maxNumberInputs: 255,
      maxNumberOutputs: 255,
    });
  });

  it('should change servers', async () => {
    // Changing from our integration test privatenet to the testnet
    gWallet.changeServer('https://node1.testnet.hathor.network/v1a/');
    const serverChangeTime = Date.now().valueOf();
    await delay(100);

    // Validating the server change with getVersionData
    let networkData = await gWallet.getVersionData();
    expect(networkData.timestamp).toBeGreaterThan(serverChangeTime);
    expect(networkData.network).toMatch(/^testnet.*/);

    await gWallet.changeServer(FULLNODE_URL);
    await delay(100);

    // Reverting to the privatenet
    networkData = await gWallet.getVersionData();
    expect(networkData.timestamp).toBeGreaterThan(serverChangeTime + 200);
    expect(networkData.network).toStrictEqual(FULLNODE_NETWORK_NAME);
  });

  it('should reload the storage', async () => {
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10);
    const spy = jest.spyOn(hWallet.storage, 'processHistory');
    // Simulate that we received an event of the connection becoming active
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    expect(spy).toHaveBeenCalledTimes(1);
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
