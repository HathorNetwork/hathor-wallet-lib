/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade UTXO query tests.
 *
 * Tests for service-only behavior: `max_utxos` limit and amount-range
 * (`amount_smaller_than`, `amount_bigger_than`) filter options.
 *
 * Shared UTXO tests live in `shared/utxos.test.ts`.
 */

import type { HathorWalletServiceWallet } from '../../../src';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapter = new ServiceWalletTestAdapter();

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] getUtxos', () => {
  let wallet: HathorWalletServiceWallet;

  beforeAll(async () => {
    const created = await adapter.createWallet();
    wallet = created.wallet;

    const addr0 = (await wallet.getAddressAtIndex(0))!;
    const addr1 = (await wallet.getAddressAtIndex(1))!;
    const addr2 = (await wallet.getAddressAtIndex(2))!;
    const addr3 = (await wallet.getAddressAtIndex(3))!;

    // Build a mix of UTXO sizes so the limit and range filters produce meaningful results.
    // Layout after setup: addr0=50n (change), addr1=18n (token-creation HTR change),
    // addr2=30n. Total available: 98n / 3 UTXOs.
    await adapter.injectFunds(wallet, addr0, 100n);

    const tx2 = await wallet.sendTransaction(addr1, 20n, {
      pinCode: adapter.defaultPinCode,
      changeAddress: addr0,
    });
    await adapter.waitForTx(wallet, tx2.hash!);
    const tx3 = await wallet.sendTransaction(addr2, 30n, {
      pinCode: adapter.defaultPinCode,
      changeAddress: addr0,
    });
    await adapter.waitForTx(wallet, tx3.hash!);

    // Creating a 200n custom token on addr1 burns 2n HTR (1% deposit) from the
    // 20n input, leaving 18n change at addr1 — the small UTXO the range filter
    // checks for.
    await adapter.createToken(wallet, 'UtxoServiceToken', 'UST', 200n, {
      address: addr1,
      mintAuthorityAddress: addr2,
      meltAuthorityAddress: addr3,
      changeAddress: addr1,
    });
  });

  afterAll(async () => {
    if (wallet) {
      await adapter.stopWallet(wallet);
    }
  });

  it('should limit the number of UTXOs returned via max_utxos', async () => {
    const limited = await wallet.getUtxos({ max_utxos: 2 });
    expect(limited.utxos).toHaveLength(2);
  });

  it('should filter UTXOs by amount_smaller_than', async () => {
    const small = await wallet.getUtxos({ amount_smaller_than: 25 });
    expect(small.total_utxos_available).toBe(1n);
    expect(small.utxos[0].amount).toBe(18n);
  });

  it('should filter UTXOs by amount_bigger_than', async () => {
    const big = await wallet.getUtxos({ amount_bigger_than: 40 });
    expect(big.total_utxos_available).toBe(1n);
    expect(big.utxos[0].amount).toBe(50n);
  });

  it('should filter UTXOs by amount_bigger_than and amount_smaller_than combined', async () => {
    // Bounds 25 < value < 40 exclude the 18n and 50n UTXOs, leaving only addr2's 30n.
    const mid = await wallet.getUtxos({ amount_bigger_than: 25, amount_smaller_than: 40 });
    expect(mid.total_utxos_available).toBe(1n);
    expect(mid.utxos[0].amount).toBe(30n);
  });
});
