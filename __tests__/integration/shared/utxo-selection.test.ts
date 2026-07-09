/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared UTXO selection tests for `getUtxosForAmount`.
 *
 * Validates the UTXO selection behavior common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades. Both implement `getUtxosForAmount()` with the same
 * `{ utxos, changeAmount }` contract and raise the same `UtxoError` (with
 * identical messages) from the shared `selectUtxos`, so the cases live here.
 *
 * Facade-specific selection tests live in:
 * - `fullnode-specific/utxo-selection.test.ts` — `consolidateUtxos` (the
 *   wallet-service throws `WalletError('Not implemented.')`) and the
 *   `markUtxoSelected` interaction (a no-op on the wallet-service facade).
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { UtxoError } from '../../../src/errors';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] getUtxosForAmount — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should reject invalid amounts and amounts above the balance', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      // Non-positive amounts are rejected by selectUtxos on both facades.
      await expect(adapter.getUtxosForAmount(wallet, 0n)).rejects.toThrow(UtxoError);
      await expect(adapter.getUtxosForAmount(wallet, 0n)).rejects.toThrow(/positive integer/i);
      await expect(adapter.getUtxosForAmount(wallet, -1n)).rejects.toThrow(/positive integer/i);

      // An amount higher than the (empty) balance cannot be filled.
      await expect(adapter.getUtxosForAmount(wallet, 1n)).rejects.toThrow(
        /utxos to fill total amount/i
      );
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should select utxos for a wallet with a single tx', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr0 = (await wallet.getAddressAtIndex(0))!;
      const addr1 = (await wallet.getAddressAtIndex(1))!;
      const fundTx = await adapter.injectFunds(wallet, addr0, 10n);

      // Exact amount: no change, the single 10n UTXO is selected.
      const exact = await adapter.getUtxosForAmount(wallet, 10n);
      expect(exact.changeAmount).toBe(0n);
      expect(exact.utxos).toHaveLength(1);
      expect(exact.utxos[0]).toMatchObject({
        txId: fundTx.hash,
        address: addr0,
        value: 10n,
        tokenId: NATIVE_TOKEN_UID,
        index: expect.any(Number),
      });

      // Partial amount: the same UTXO is selected, with change.
      const withChange = await adapter.getUtxosForAmount(wallet, 6n);
      expect(withChange.changeAmount).toBe(4n);
      expect(withChange.utxos).toHaveLength(1);
      expect(withChange.utxos[0]).toMatchObject({ address: addr0, value: 10n });

      // Filtering by the funded address succeeds; filtering by an empty one fails.
      const filtered = await adapter.getUtxosForAmount(wallet, 10n, { address: addr0 });
      expect(filtered.utxos).toHaveLength(1);
      await expect(adapter.getUtxosForAmount(wallet, 10n, { address: addr1 })).rejects.toThrow(
        /utxos to fill total amount/i
      );

      // More than the available funds cannot be filled.
      await expect(adapter.getUtxosForAmount(wallet, 31n)).rejects.toThrow(
        /utxos to fill total amount/i
      );
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should select the least utxos across multiple txs', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr0 = (await wallet.getAddressAtIndex(0))!;
      const addr1 = (await wallet.getAddressAtIndex(1))!;
      const tx0 = await adapter.injectFunds(wallet, addr0, 10n);
      const tx1 = await adapter.injectFunds(wallet, addr1, 20n);

      /*
       * The history ordering of the two UTXOs is not deterministic, so we avoid
       * assertions that depend on which one is picked when either would do.
       */

      // A single UTXO is enough whenever one alone can cover the amount.
      expect((await adapter.getUtxosForAmount(wallet, 7n)).utxos).toHaveLength(1);
      expect((await adapter.getUtxosForAmount(wallet, 10n)).utxos).toHaveLength(1);

      // The 20n UTXO alone satisfies 20n with no change.
      const exact20 = await adapter.getUtxosForAmount(wallet, 20n);
      expect(exact20.changeAmount).toBe(0n);
      expect(exact20.utxos).toHaveLength(1);
      expect(exact20.utxos[0]).toMatchObject({ txId: tx1.hash, address: addr1, value: 20n });

      // 29n requires both UTXOs, leaving 1n change.
      const both = await adapter.getUtxosForAmount(wallet, 29n);
      expect(both.changeAmount).toBe(1n);
      expect(both.utxos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ txId: tx0.hash, value: 10n }),
          expect.objectContaining({ txId: tx1.hash, value: 20n }),
        ])
      );

      // The address filter constrains selection to a single address' UTXO.
      const at0 = await adapter.getUtxosForAmount(wallet, 10n, { address: addr0 });
      expect(at0.changeAmount).toBe(0n);
      expect(at0.utxos[0]).toMatchObject({ txId: tx0.hash, address: addr0, value: 10n });

      const at1 = await adapter.getUtxosForAmount(wallet, 10n, { address: addr1 });
      expect(at1.changeAmount).toBe(10n);
      expect(at1.utxos[0]).toMatchObject({ txId: tx1.hash, address: addr1, value: 20n });

      // More than the combined balance cannot be filled.
      await expect(adapter.getUtxosForAmount(wallet, 31n)).rejects.toThrow(
        /utxos to fill total amount/i
      );
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should filter by custom token', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr0 = (await wallet.getAddressAtIndex(0))!;
      const addr2 = (await wallet.getAddressAtIndex(2))!;
      const addr3 = (await wallet.getAddressAtIndex(3))!;

      // HTR is needed to pay the token deposit; leftover HTR exercises the
      // implicit/explicit native-token paths below.
      await adapter.injectFunds(wallet, addr0, 10n);
      const { hash: tokenUid } = await adapter.createToken(
        wallet,
        'getUtxosForAmount Test Token',
        'GUFAT',
        200n,
        { address: addr2 }
      );

      // Selecting against the custom token returns the 200n mint UTXO.
      const tokenResult = await adapter.getUtxosForAmount(wallet, 6n, { token: tokenUid });
      expect(tokenResult.changeAmount).toBe(194n);
      expect(tokenResult.utxos).toHaveLength(1);
      expect(tokenResult.utxos[0]).toMatchObject({
        address: addr2,
        value: 200n,
        tokenId: tokenUid,
      });

      // Explicitly and implicitly selecting HTR both return a native UTXO.
      const explicitHtr = await adapter.getUtxosForAmount(wallet, 6n, { token: NATIVE_TOKEN_UID });
      expect(explicitHtr.utxos[0]).toMatchObject({ tokenId: NATIVE_TOKEN_UID });

      const implicitHtr = await adapter.getUtxosForAmount(wallet, 6n);
      expect(implicitHtr.utxos[0]).toMatchObject({ tokenId: NATIVE_TOKEN_UID });

      // The token filter combines with the address filter.
      const tokenAtAddr2 = await adapter.getUtxosForAmount(wallet, 6n, {
        token: tokenUid,
        address: addr2,
      });
      expect(tokenAtAddr2.changeAmount).toBe(194n);
      expect(tokenAtAddr2.utxos[0]).toMatchObject({ address: addr2, value: 200n });

      await expect(
        adapter.getUtxosForAmount(wallet, 6n, { token: tokenUid, address: addr3 })
      ).rejects.toThrow(/utxos to fill/i);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
