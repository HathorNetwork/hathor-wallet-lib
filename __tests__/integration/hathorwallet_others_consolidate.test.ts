import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../src/constants';

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
    await GenesisWalletHelper.injectFunds(hWallet2, await hWallet2.getAddressAtIndex(0), 110n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet2,
      'Consolidate Token',
      'CTK',
      1000n,
      {
        address: await hWallet2.getAddressAtIndex(0),
      }
    );
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
    const tokenBalance = balanceObj?.balance?.unlocked || 0n;
    if (tokenBalance === 0n) {
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
      { address: await hWallet1.getAddressAtIndex(0), value: 4n, token: NATIVE_TOKEN_UID },
      { address: await hWallet1.getAddressAtIndex(1), value: 5n, token: NATIVE_TOKEN_UID },
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
      { address: await hWallet1.getAddressAtIndex(0), value: 4n, token: NATIVE_TOKEN_UID },
      { address: await hWallet1.getAddressAtIndex(1), value: 5n, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(2), {
      token: NATIVE_TOKEN_UID,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 9n,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        {
          address: await hWallet1.getAddressAtIndex(0),
          amount: 4n,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
        {
          address: await hWallet1.getAddressAtIndex(1),
          amount: 5n,
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
      total_amount_available: 9n,
      total_utxos_available: 1n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [
        {
          address: await hWallet1.getAddressAtIndex(2),
          amount: 9n,
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
      { address: await hWallet1.getAddressAtIndex(3), value: 40n, token: tokenHash },
      { address: await hWallet1.getAddressAtIndex(4), value: 50n, token: tokenHash },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(await hWallet1.getAddressAtIndex(5), {
      token: tokenHash,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 90n,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        {
          address: await hWallet1.getAddressAtIndex(3),
          amount: 40n,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
        {
          address: await hWallet1.getAddressAtIndex(4),
          amount: 50n,
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
      total_amount_available: 90n,
      total_utxos_available: 1n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [
        {
          address: await hWallet1.getAddressAtIndex(5),
          amount: 90n,
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
      { address: addr1, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 2n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 3n, token: NATIVE_TOKEN_UID },
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
      total_amount: 5n,
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
      total_amount_available: 3n,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 0n,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(3))).toMatchObject({
      total_amount_available: 5n,
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate with amount_smaller_than filter', async () => {
    const addr1 = await hWallet1.getAddressAtIndex(1);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: addr1, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 2n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 3n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 4n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 5n, token: NATIVE_TOKEN_UID },
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
      total_amount: 3n,
      txId: expect.any(String),
      utxos: expect.objectContaining({ length: 2 }),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(1))).toMatchObject({
      total_amount_available: 12n,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 3n,
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate with amount_bigger_than filter', async () => {
    const addr2 = await hWallet1.getAddressAtIndex(2);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: addr2, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 2n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 3n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 4n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 5n, token: NATIVE_TOKEN_UID },
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
      total_amount: 9n,
      txId: expect.any(String),
      utxos: expect.objectContaining({ length: 2 }),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 6n,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(4))).toMatchObject({
      total_amount_available: 9n,
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate with amount_bigger_than and max_amount filter', async () => {
    const addr2 = await hWallet1.getAddressAtIndex(2);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: addr2, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 4n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 5n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 20n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 40n, token: NATIVE_TOKEN_UID },
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
      total_amount: 9n,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        expect.objectContaining({ amount: 4n }),
        expect.objectContaining({ amount: 5n }),
      ]),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 61n,
    });
    expect(await hWallet1.getAddressInfo(await hWallet1.getAddressAtIndex(4))).toMatchObject({
      total_amount_available: 9n,
    });

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(NATIVE_TOKEN_UID);
  });

  it('should consolidate at most the maximum output constant', async () => {
    // Funding the wallet1
    const fundTx = await hWallet2.sendManyOutputsTransaction([
      { address: await hWallet1.getAddressAtIndex(0), value: 1n, token: tokenHash },
      { address: await hWallet1.getAddressAtIndex(0), value: 1n, token: tokenHash },
      { address: await hWallet1.getAddressAtIndex(0), value: 1n, token: tokenHash },
      { address: await hWallet1.getAddressAtIndex(0), value: 1n, token: tokenHash },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);
    await waitForTxReceived(hWallet2, fundTx.hash);

    // We should now have 4 utxos on wallet1 for this custom token
    expect(await hWallet1.getUtxos({ token: tokenHash })).toHaveProperty(
      'total_utxos_available',
      4n
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
      3n
    );
  });
});
