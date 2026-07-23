/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade API query tests: getFullTxById, getTxConfirmationData and
 * graphvizNeighborsQuery.
 *
 * The wallet-service facade implements all three methods too, proxied through
 * its own backend (`wallet/proxy/*` endpoints in src/wallet/api/walletApi.ts).
 * What keeps this file fullnode-specific are the tests bound to fullnode-only
 * contracts:
 * - The `success: false` failure paths assert the fullnode facade's plain
 *   `Invalid transaction <txId>` error (src/new/wallet.ts); the wallet-service
 *   proxy raises `WalletRequestError` with its own message instead.
 * - The graphviz "capture errors" case calls `graphvizNeighborsQuery()` without
 *   `graphType`/`maxLevel`; the wallet-service signature requires those
 *   parameters (src/wallet/wallet.ts), so this call shape only exists on the
 *   fullnode facade.
 *
 * The happy-path and `TxNotFoundError` cases DO behave the same on both
 * facades (the proxy schemas preserve the asserted keys, and both facades
 * throw TxNotFoundError for not-found hashes). They are kept here with their
 * fullnode-only siblings for now and are candidates for a future `shared/`
 * migration once `IWalletTestAdapter` grows query-method support.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import { TxNotFoundError } from '../../../src/errors';

describe('[Fullnode] getFullTxById', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  it('should download an existing transaction from the fullnode', async () => {
    const hWallet = await generateWalletHelper();

    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    const fullTx = await hWallet.getFullTxById(tx1.hash);
    expect(fullTx.success).toStrictEqual(true);

    const fullTxKeys = Object.keys(fullTx);
    expect(fullTxKeys).toContain('meta');
    expect(fullTxKeys).toContain('tx');
    expect(fullTxKeys).toContain('success');
    expect(fullTxKeys).toContain('spent_outputs');
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.getFullTxById('invalid-tx-hash')).rejects.toThrow(
      'Invalid transaction invalid-tx-hash'
    );
  });

  it('should throw an error on valid but not found transaction', async () => {
    await expect(
      gWallet.getFullTxById('0011371a7c07f7e8017c52c0a4f5293ccf30c865d96255d1b515f96f7a6a6299')
    ).rejects.toThrow(TxNotFoundError);
  });
});

describe('[Fullnode] getTxConfirmationData', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  it('should download confirmation data for an existing transaction from the fullnode', async () => {
    const hWallet = await generateWalletHelper();

    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    const confirmationData = await hWallet.getTxConfirmationData(tx1.hash);

    expect(confirmationData.success).toStrictEqual(true);

    const confirmationDataKeys = Object.keys(confirmationData);
    expect(confirmationDataKeys).toContain('accumulated_bigger');
    expect(confirmationDataKeys).toContain('accumulated_weight');
    expect(confirmationDataKeys).toContain('confirmation_level');
    expect(confirmationDataKeys).toContain('success');
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.getTxConfirmationData('invalid-tx-hash')).rejects.toThrow(
      'Invalid transaction invalid-tx-hash'
    );
  });

  it('should throw TxNotFoundError on valid hash but not found transaction', async () => {
    await expect(
      gWallet.getTxConfirmationData(
        '000000000bc8c6fab1b3a5af184cc0e7ff7934c6ad982c8bea9ab5006ae1bafc'
      )
    ).rejects.toThrow(TxNotFoundError);
  });
});

describe('[Fullnode] graphvizNeighborsQuery', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  it('should download graphviz neighbors data for an existing transaction from the fullnode', async () => {
    const hWallet = await generateWalletHelper();
    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );
    const neighborsData = await hWallet.graphvizNeighborsQuery(tx1.hash, 'funds', 1);

    expect(neighborsData).toMatch(/digraph {/);
  });

  it('should capture errors when graphviz returns error', async () => {
    const hWallet = await generateWalletHelper();
    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    await expect(hWallet.graphvizNeighborsQuery(tx1.hash)).rejects.toThrow(
      'Request failed with status code 500'
    );
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.graphvizNeighborsQuery('invalid-tx-hash')).rejects.toThrow(
      'Invalid transaction invalid-tx-hash'
    );
  });

  it('should throw TxNotFoundError on valid but not found transaction', async () => {
    await expect(
      gWallet.graphvizNeighborsQuery(
        '000000000bc8c6fab1b3a5af184cc0e7ff7934c6ad982c8bea9ab5006ae1bafc'
      )
    ).rejects.toThrow(TxNotFoundError);
  });
});
