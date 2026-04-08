/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade authority UTXO tests.
 *
 * Tests for service-only behavior: error messages specific to the wallet-service
 * facade, and skipped tests that need additional infrastructure.
 *
 * Shared authority UTXO tests live in `shared/authority-utxos.test.ts`.
 */

import type { HathorWalletServiceWallet } from '../../../src';
import { buildWalletInstance, pollForTx } from '../helpers/service-facade.helper';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { AuthorityType } from '../../../src/types';

const adapter = new ServiceWalletTestAdapter();

const pinCode = '123456';
const password = 'testpass';

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] getAuthorityUtxo', () => {
  let utxosTestWallet: HathorWalletServiceWallet;
  let createdTokenUid: string;

  beforeAll(async () => {
    const { wallet, addresses } = buildWalletInstance();
    utxosTestWallet = wallet;
    await utxosTestWallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(addresses[0], 100n, utxosTestWallet);

    const createTokenTx = await utxosTestWallet.createNewToken('UtxoTestToken', 'UTT', 200n, {
      pinCode,
      address: addresses[1],
      mintAuthorityAddress: addresses[2],
      meltAuthorityAddress: addresses[3],
      changeAddress: addresses[1],
    });

    createdTokenUid = createTokenTx.hash!;
    await pollForTx(utxosTestWallet, createdTokenUid);
  });

  afterAll(async () => {
    if (utxosTestWallet) {
      await utxosTestWallet.stop({ cleanStorage: true });
    }
  });

  it('should return mint authority at the configured address with default options', async () => {
    const { wallet, addresses } = buildWalletInstance();
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(addresses[0], 100n, wallet);
    const createTx = await wallet.createNewToken('MintAddrToken', 'MAT', 100n, {
      pinCode,
      mintAuthorityAddress: addresses[2],
      meltAuthorityAddress: addresses[3],
    });
    await pollForTx(wallet, createTx.hash!);

    // Call without options — exercises the wallet-service default behavior
    const mintUtxos = await wallet.getAuthorityUtxo(createTx.hash!, AuthorityType.MINT);
    expect(mintUtxos).toHaveLength(1);
    expect(mintUtxos[0].address).toBe(addresses[2]);

    const meltUtxos = await wallet.getAuthorityUtxo(createTx.hash!, AuthorityType.MELT);
    expect(meltUtxos).toHaveLength(1);
    expect(meltUtxos[0].address).toBe(addresses[3]);

    await wallet.stop({ cleanStorage: true });
  });

  it('should throw error for invalid authority type', async () => {
    await expect(utxosTestWallet.getAuthorityUtxo(createdTokenUid, 'invalid')).rejects.toThrow(
      'Invalid authority value.'
    );
  });

  // Skipped: requires a delegateAuthority-like setup to produce multiple authority UTXOs,
  // which is not yet available on the wallet-service facade. (originally skipped in PR #949)
  it.skip('should return multiple authority UTXOs when many option is true', async () => {
    const multipleAuthorities = await utxosTestWallet.getAuthorityUtxo(
      createdTokenUid,
      AuthorityType.MINT,
      {
        many: true,
      }
    );

    expect(Array.isArray(multipleAuthorities)).toBe(true);
    expect(multipleAuthorities.length).toBeGreaterThanOrEqual(1);
  });

  // Skipped: same as above — needs multiple authority UTXOs to meaningfully test `many: false`.
  // (originally skipped in PR #949)
  it.skip('should return single authority UTXO when many option is false', async () => {
    const singleAuthority = await utxosTestWallet.getAuthorityUtxo(
      createdTokenUid,
      AuthorityType.MINT,
      {
        many: false,
      }
    );

    expect(Array.isArray(singleAuthority)).toBe(true);
    expect(singleAuthority.length).toBeLessThanOrEqual(1);
  });

  // Skipped: requires a timelocked authority UTXO to test filtering by availability,
  // which needs additional test infrastructure. (originally skipped in PR #949)
  it.skip('should include only available UTXOs when only_available_utxos is true', async () => {
    const availableAuthorities = await utxosTestWallet.getAuthorityUtxo(
      createdTokenUid,
      AuthorityType.MINT,
      {
        only_available_utxos: true,
      }
    );

    expect(Array.isArray(availableAuthorities)).toBe(true);
    availableAuthorities.forEach(auth => {
      expect(auth).toEqual(
        expect.objectContaining({
          txId: expect.any(String),
          index: expect.any(Number),
          address: expect.any(String),
          authorities: expect.any(BigInt),
        })
      );
    });
  });
});
