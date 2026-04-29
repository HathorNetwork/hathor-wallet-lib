/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared UTXO query tests.
 *
 * Validates UTXO listing behavior that is common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades.
 *
 * Facade-specific tests live in:
 * - `fullnode-specific/utxos.test.ts`
 * - `service-specific/utxos.test.ts`
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] getUtxos — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should return no UTXOs on an empty wallet', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const result = await adapter.getUtxos(wallet);
      expect(result.utxos).toHaveLength(0);
      expect(result.total_amount_available).toBe(0n);
      expect(result.total_utxos_available).toBe(0n);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should list UTXOs after funding', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr = (await wallet.getAddressAtIndex(0))!;
      const fundTx = await adapter.injectFunds(wallet, addr, 10n);

      const result = await adapter.getUtxos(wallet);
      expect(result.utxos).toHaveLength(1);
      expect(result.total_amount_available).toBe(10n);
      expect(result.total_utxos_available).toBe(1n);
      expect(result.utxos[0]).toMatchObject({
        txId: fundTx.hash,
        value: 10n,
        address: addr,
        tokenId: NATIVE_TOKEN_UID,
        locked: false,
        index: expect.any(Number),
      });
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should filter UTXOs by token', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr = (await wallet.getAddressAtIndex(0))!;
      await adapter.injectFunds(wallet, addr, 10n);

      const tokenAmount = 100n;
      const { hash: tokenUid } = await adapter.createToken(
        wallet,
        'UtxoFilterToken',
        'UFT',
        tokenAmount
      );

      // Native token: should not include any custom-token UTXOs
      const native = await adapter.getUtxos(wallet, { token: NATIVE_TOKEN_UID });
      expect(native.utxos.length).toBeGreaterThan(0);
      native.utxos.forEach(utxo => {
        expect(utxo.tokenId).toBe(NATIVE_TOKEN_UID);
      });

      // Custom token: a single UTXO with the full mint amount
      const custom = await adapter.getUtxos(wallet, { token: tokenUid });
      expect(custom.utxos).toHaveLength(1);
      expect(custom.total_amount_available).toBe(tokenAmount);
      expect(custom.utxos[0]).toMatchObject({
        txId: tokenUid,
        value: tokenAmount,
        tokenId: tokenUid,
      });
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should filter UTXOs by address', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr0 = (await wallet.getAddressAtIndex(0))!;
      const addr1 = (await wallet.getAddressAtIndex(1))!;
      const addr2 = (await wallet.getAddressAtIndex(2))!;

      const tx0 = await adapter.injectFunds(wallet, addr0, 10n);
      const tx1 = await adapter.injectFunds(wallet, addr1, 5n);

      // addr0 should have the 10n UTXO
      const at0 = await adapter.getUtxos(wallet, { address: addr0 });
      expect(at0.utxos).toHaveLength(1);
      expect(at0.utxos[0]).toMatchObject({
        txId: tx0.hash,
        address: addr0,
        value: 10n,
      });

      // addr1 should have the 5n UTXO
      const at1 = await adapter.getUtxos(wallet, { address: addr1 });
      expect(at1.utxos).toHaveLength(1);
      expect(at1.utxos[0]).toMatchObject({
        txId: tx1.hash,
        address: addr1,
        value: 5n,
      });

      // addr2 received nothing — no UTXOs
      const at2 = await adapter.getUtxos(wallet, { address: addr2 });
      expect(at2.utxos).toHaveLength(0);
      expect(at2.total_utxos_available).toBe(0n);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
