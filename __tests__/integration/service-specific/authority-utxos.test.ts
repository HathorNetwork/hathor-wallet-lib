/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade authority UTXO tests.
 *
 * Tests for service-only behavior: address filtering, many option,
 * only_available_utxos, and error messages specific to the wallet-service facade.
 *
 * Shared authority UTXO tests live in `shared/authority-utxos.test.ts`.
 */

import type { HathorWalletServiceWallet } from '../../../src';
import { buildWalletInstance, pollForTx } from '../helpers/service-facade.helper';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';

const adapter = new ServiceWalletTestAdapter();

const utxosWallet = {
  words:
    'provide bunker age agree renew size popular license best kidney range flag they bulk survey letter concert mobile february clean nuclear inherit voyage capable',
  addresses: [
    'WQvAdYAqZf69nsgzVwSMwfRWcBRHJJU1qH',
    'We4fZtzxod2M3w1u8h4TNpaMYrYWqXxNqd',
    'WioaJZPzytLVniJ9MTinLiWih1VaoRfaUV',
    'WmRLJj5P1rj1bErNADJnweq8mXBNLmNiAL',
    'WXpXoREmV2hFuMX83dup7YMqJqRW5Y94Av',
    'WirQUza1XdqnN7DcAMdXvysTntq9DB3xz6',
    'Wb26hUGD6du7nkecrAeaRbBoZS4Z3dynby',
    'WXgFTQm7uNYTj8gsz3GWNg58jCvaPn96hD',
    'WdcFv1fKjbPPqSXHkdo22QE2bbZnbXADHK',
    'WTm47mTSd7ompdinkZM3LiF4VE7AeQttzo',
  ],
};

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
    ({ wallet: utxosTestWallet } = buildWalletInstance({ words: utxosWallet.words }));
    await utxosTestWallet.start({ pinCode, password });

    // Fund the wallet
    await GenesisWalletServiceHelper.injectFunds(utxosWallet.addresses[0], 100n, utxosTestWallet);

    // Create a custom token with specific authority addresses
    const createTokenTx = await utxosTestWallet.createNewToken('UtxoTestToken', 'UTT', 200n, {
      pinCode,
      address: utxosWallet.addresses[1],
      mintAuthorityAddress: utxosWallet.addresses[2],
      meltAuthorityAddress: utxosWallet.addresses[3],
      changeAddress: utxosWallet.addresses[1],
    });

    createdTokenUid = createTokenTx.hash!;
    await pollForTx(utxosTestWallet, createdTokenUid);
  });

  afterAll(async () => {
    if (utxosTestWallet) {
      await utxosTestWallet.stop({ cleanStorage: true });
    }
  });

  it('should filter authority UTXOs by address', async () => {
    const mintAuthorities = await utxosTestWallet.getAuthorityUtxo(createdTokenUid, 'mint', {
      filter_address: utxosWallet.addresses[2],
    });
    expect(mintAuthorities).toHaveLength(1);

    const noAuthorities = await utxosTestWallet.getAuthorityUtxo(createdTokenUid, 'mint', {
      filter_address: utxosWallet.addresses[3],
    });
    expect(noAuthorities).toHaveLength(0);
  });

  it('should throw error for invalid authority type', async () => {
    await expect(utxosTestWallet.getAuthorityUtxo(createdTokenUid, 'invalid')).rejects.toThrow(
      'Invalid authority value.'
    );
  });

  it.skip('should return multiple authority UTXOs when many option is true', async () => {
    // TODO: Create another authority transaction to test this
    const multipleAuthorities = await utxosTestWallet.getAuthorityUtxo(createdTokenUid, 'mint', {
      many: true,
    });

    expect(Array.isArray(multipleAuthorities)).toBe(true);
    expect(multipleAuthorities.length).toBeGreaterThanOrEqual(1);
  });

  it.skip('should return single authority UTXO when many option is false', async () => {
    // TODO: Create another authority transaction to test this
    const singleAuthority = await utxosTestWallet.getAuthorityUtxo(createdTokenUid, 'mint', {
      many: false,
    });

    expect(Array.isArray(singleAuthority)).toBe(true);
    expect(singleAuthority.length).toBeLessThanOrEqual(1);
  });

  it.skip('should include only available UTXOs when only_available_utxos is true', async () => {
    // TODO: Create a timelocked authority to test this
    const availableAuthorities = await utxosTestWallet.getAuthorityUtxo(createdTokenUid, 'mint', {
      only_available_utxos: true,
    });

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
