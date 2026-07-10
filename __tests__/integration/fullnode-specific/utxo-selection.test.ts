/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade UTXO selection tests.
 *
 * These cases are fullnode-specific because of two concrete API divergences:
 * - `consolidateUtxos()` is only implemented on {@link HathorWallet}; the
 *   wallet-service facade throws `WalletError('Not implemented.')`
 *   (`src/wallet/wallet.ts`).
 * - `markUtxoSelected()` actually marks the UTXO on the fullnode facade but is a
 *   no-op on the wallet-service facade, so the "selected UTXOs are skipped"
 *   behavior cannot be asserted against the service.
 *
 * Shared `getUtxosForAmount` selection tests live in `shared/utxo-selection.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import type HathorWallet from '../../../src/new/wallet';

/**
 * Creates a fresh wallet pre-funded with HTR from the genesis wallet.
 * Used as a "funder" that distributes funds (or a custom token) to a
 * recipient wallet via `sendManyOutputsTransaction`.
 */
async function createFundedFunder(htrAmount: bigint): Promise<HathorWallet> {
  const funder = await generateWalletHelper();
  await GenesisWalletHelper.injectFunds(funder, await funder.getAddressAtIndex(0), htrAmount);
  return funder;
}

describe('[Fullnode] consolidateUtxos', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should throw when consolidating on an empty wallet', async () => {
    const hWallet = await generateWalletHelper();

    await expect(hWallet.consolidateUtxos(await hWallet.getAddressAtIndex(0))).rejects.toThrow(
      'available utxo'
    );
  });

  it('should throw when consolidating to an address not owned by the wallet', async () => {
    const funder = await createFundedFunder(9n);
    const hWallet = await generateWalletHelper();

    const fundTx = await funder.sendManyOutputsTransaction([
      { address: await hWallet.getAddressAtIndex(0), value: 4n, token: NATIVE_TOKEN_UID },
      { address: await hWallet.getAddressAtIndex(1), value: 5n, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(funder, fundTx.hash);
    await waitForTxReceived(hWallet, fundTx.hash);

    // The destination belongs to the funder wallet, not to hWallet.
    await expect(hWallet.consolidateUtxos(await funder.getAddressAtIndex(0))).rejects.toThrow(
      'not owned by this wallet'
    );
  });

  it('should consolidate two utxos (htr)', async () => {
    const funder = await createFundedFunder(9n);
    const hWallet = await generateWalletHelper();

    const fundTx = await funder.sendManyOutputsTransaction([
      { address: await hWallet.getAddressAtIndex(0), value: 4n, token: NATIVE_TOKEN_UID },
      { address: await hWallet.getAddressAtIndex(1), value: 5n, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(funder, fundTx.hash);
    await waitForTxReceived(hWallet, fundTx.hash);
    await waitUntilNextTimestamp(hWallet, fundTx.hash);

    const consolidateTx = await hWallet.consolidateUtxos(await hWallet.getAddressAtIndex(2), {
      token: NATIVE_TOKEN_UID,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 9n,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        {
          address: await hWallet.getAddressAtIndex(0),
          amount: 4n,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
        {
          address: await hWallet.getAddressAtIndex(1),
          amount: 5n,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
      ]),
    });

    await waitForTxReceived(hWallet, consolidateTx.txId);
    const utxos = await hWallet.getUtxos();
    expect(utxos).toStrictEqual({
      total_amount_available: 9n,
      total_utxos_available: 1n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [
        {
          address: await hWallet.getAddressAtIndex(2),
          amount: 9n,
          tx_id: consolidateTx.txId,
          locked: false,
          index: 0, // A single resulting utxo, so 1 output only
        },
      ],
    });
  });

  it('should consolidate two utxos (custom token)', async () => {
    const funder = await createFundedFunder(10n);
    const { hash: tokenHash } = await createTokenHelper(funder, 'Consolidate Token', 'CTK', 1000n, {
      address: await funder.getAddressAtIndex(0),
    });
    const hWallet = await generateWalletHelper();

    const fundTx = await funder.sendManyOutputsTransaction([
      { address: await hWallet.getAddressAtIndex(3), value: 40n, token: tokenHash },
      { address: await hWallet.getAddressAtIndex(4), value: 50n, token: tokenHash },
    ]);
    await waitForTxReceived(funder, fundTx.hash);
    await waitForTxReceived(hWallet, fundTx.hash);
    await waitUntilNextTimestamp(hWallet, fundTx.hash);

    const consolidateTx = await hWallet.consolidateUtxos(await hWallet.getAddressAtIndex(5), {
      token: tokenHash,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 90n,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        {
          address: await hWallet.getAddressAtIndex(3),
          amount: 40n,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
        {
          address: await hWallet.getAddressAtIndex(4),
          amount: 50n,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number),
        },
      ]),
    });

    await waitForTxReceived(hWallet, consolidateTx.txId);
    const utxos = await hWallet.getUtxos({ token: tokenHash });
    expect(utxos).toStrictEqual({
      total_amount_available: 90n,
      total_utxos_available: 1n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [
        {
          address: await hWallet.getAddressAtIndex(5),
          amount: 90n,
          tx_id: consolidateTx.txId,
          locked: false,
          index: 0, // A single resulting utxo, so 1 output only
        },
      ],
    });
  });

  it('should consolidate with filter_address filter', async () => {
    const funder = await createFundedFunder(8n);
    const hWallet = await generateWalletHelper();
    const addr1 = await hWallet.getAddressAtIndex(1);
    const addr2 = await hWallet.getAddressAtIndex(2);

    const fundTx = await funder.sendManyOutputsTransaction([
      { address: addr1, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 2n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 3n, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(funder, fundTx.hash);
    await waitForTxReceived(hWallet, fundTx.hash);
    await waitUntilNextTimestamp(hWallet, fundTx.hash);

    const consolidateTx = await hWallet.consolidateUtxos(await hWallet.getAddressAtIndex(3), {
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

    await waitForTxReceived(hWallet, consolidateTx.txId);
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(1))).toMatchObject({
      total_amount_available: 3n,
    });
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 0n,
    });
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(3))).toMatchObject({
      total_amount_available: 5n,
    });
  });

  it('should consolidate with amount_smaller_than filter', async () => {
    const funder = await createFundedFunder(15n);
    const hWallet = await generateWalletHelper();
    const addr1 = await hWallet.getAddressAtIndex(1);

    const fundTx = await funder.sendManyOutputsTransaction([
      { address: addr1, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 2n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 3n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 4n, token: NATIVE_TOKEN_UID },
      { address: addr1, value: 5n, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(funder, fundTx.hash);
    await waitForTxReceived(hWallet, fundTx.hash);
    await waitUntilNextTimestamp(hWallet, fundTx.hash);

    const consolidateTx = await hWallet.consolidateUtxos(await hWallet.getAddressAtIndex(2), {
      token: NATIVE_TOKEN_UID,
      amount_smaller_than: 3,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 3n,
      txId: expect.any(String),
      utxos: expect.objectContaining({ length: 2 }),
    });

    await waitForTxReceived(hWallet, consolidateTx.txId);
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(1))).toMatchObject({
      total_amount_available: 12n,
    });
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 3n,
    });
  });

  it('should consolidate with amount_bigger_than filter', async () => {
    const funder = await createFundedFunder(15n);
    const hWallet = await generateWalletHelper();
    const addr2 = await hWallet.getAddressAtIndex(2);

    const fundTx = await funder.sendManyOutputsTransaction([
      { address: addr2, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 2n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 3n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 4n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 5n, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(funder, fundTx.hash);
    await waitForTxReceived(hWallet, fundTx.hash);
    await waitUntilNextTimestamp(hWallet, fundTx.hash);

    const consolidateTx = await hWallet.consolidateUtxos(await hWallet.getAddressAtIndex(4), {
      token: NATIVE_TOKEN_UID,
      amount_bigger_than: 3,
    });
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 9n,
      txId: expect.any(String),
      utxos: expect.objectContaining({ length: 2 }),
    });

    await waitForTxReceived(hWallet, consolidateTx.txId);
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 6n,
    });
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(4))).toMatchObject({
      total_amount_available: 9n,
    });
  });

  it('should consolidate with amount_bigger_than and max_amount filter', async () => {
    const funder = await createFundedFunder(70n);
    const hWallet = await generateWalletHelper();
    const addr2 = await hWallet.getAddressAtIndex(2);

    const fundTx = await funder.sendManyOutputsTransaction([
      { address: addr2, value: 1n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 4n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 5n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 20n, token: NATIVE_TOKEN_UID },
      { address: addr2, value: 40n, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(funder, fundTx.hash);
    await waitForTxReceived(hWallet, fundTx.hash);
    await waitUntilNextTimestamp(hWallet, fundTx.hash);

    const consolidateTx = await hWallet.consolidateUtxos(await hWallet.getAddressAtIndex(4), {
      token: NATIVE_TOKEN_UID,
      amount_bigger_than: 2,
      max_amount: 15,
    });
    /*
     * The selection is deterministic for this data, independent of UTXO
     * iteration order: `amount_bigger_than: 2` drops the 1n utxo, and
     * `max_amount: 15` is enforced cumulatively before each utxo is yielded
     * (see `MemoryStore.selectUtxos`), so the 20n and 40n utxos — each already
     * over the cap on their own — can never be picked. `{4n, 5n}` (sum 9n) is
     * the only reachable set.
     */
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 9n,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        expect.objectContaining({ amount: 4n }),
        expect.objectContaining({ amount: 5n }),
      ]),
    });

    await waitForTxReceived(hWallet, consolidateTx.txId);
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(2))).toMatchObject({
      total_amount_available: 61n,
    });
    expect(await hWallet.getAddressInfo(await hWallet.getAddressAtIndex(4))).toMatchObject({
      total_amount_available: 9n,
    });
  });

  it('should consolidate at most the maximum output constant', async () => {
    const funder = await createFundedFunder(10n);
    const { hash: tokenHash } = await createTokenHelper(
      funder,
      'Consolidate Max Token',
      'CMT',
      1000n,
      { address: await funder.getAddressAtIndex(0) }
    );
    const hWallet = await generateWalletHelper();

    const fundTx = await funder.sendManyOutputsTransaction([
      { address: await hWallet.getAddressAtIndex(0), value: 1n, token: tokenHash },
      { address: await hWallet.getAddressAtIndex(0), value: 1n, token: tokenHash },
      { address: await hWallet.getAddressAtIndex(0), value: 1n, token: tokenHash },
      { address: await hWallet.getAddressAtIndex(0), value: 1n, token: tokenHash },
    ]);
    await waitForTxReceived(funder, fundTx.hash);
    await waitForTxReceived(hWallet, fundTx.hash);

    // We should now have 4 utxos on hWallet for this custom token
    expect(await hWallet.getUtxos({ token: tokenHash })).toHaveProperty(
      'total_utxos_available',
      4n
    );

    // Reducing the amount of maximum inputs allowed for the lib (not the fullnode)
    const oldMaxInputs = hWallet.storage.version.max_number_inputs;
    hWallet.storage.version.max_number_inputs = 2;

    // Trying to consolidate all of them on a single utxo
    await waitUntilNextTimestamp(hWallet, fundTx.hash);
    const consolidateTx = await hWallet.consolidateUtxos(await hWallet.getAddressAtIndex(4), {
      token: tokenHash,
    });

    // Reverting the amount of maximum outputs allowed by the lib
    hWallet.storage.version.max_number_inputs = oldMaxInputs;

    // The lib should respect its maximum output limit at the time of the transaction
    expect(consolidateTx.utxos).toHaveLength(2);
    await waitForTxReceived(hWallet, consolidateTx.txId);

    // Ensure the maximum possible amount of utxos was consolidated ( 1 consolidated + 2 remaining )
    expect(await hWallet.getUtxos({ token: tokenHash })).toHaveProperty(
      'total_utxos_available',
      3n
    );
  });
});

describe('[Fullnode] getUtxosForAmount with selected utxos', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  // markUtxoSelected() actually locks the UTXO on the fullnode facade; it is a
  // no-op on the wallet-service facade, so this skip behavior is fullnode-only.
  it('should not retrieve utxos marked as selected', async () => {
    const hWallet = await generateWalletHelper();
    const addr = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(hWallet, addr, 100n);

    // Retrieving the utxo's data and marking it as selected
    const utxosAddr = await hWallet.getUtxos({ filter_address: addr });
    const singleUtxo = utxosAddr.utxos[0];
    await hWallet.markUtxoSelected(singleUtxo.tx_id, singleUtxo.index, true);

    // Validate that it will not be retrieved on getUtxosForAmount
    await expect(hWallet.getUtxosForAmount(50n, { filter_address: addr })).rejects.toThrow(
      'utxos to fill'
    );
  });
});
