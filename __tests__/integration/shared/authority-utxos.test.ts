/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared authority UTXO tests.
 *
 * Validates authority UTXO query behavior that is common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades.
 *
 * Facade-specific tests live in:
 * - `fullnode-specific/authority-utxos.test.ts`
 * - `service-specific/authority-utxos.test.ts`
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { TOKEN_MINT_MASK, TOKEN_MELT_MASK } from '../../../src/constants';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] authority UTXOs — $name', adapter => {
  let wallet: FuzzyWalletType;
  let tokenUid: string;

  beforeAll(async () => {
    await adapter.suiteSetup();

    // Create a funded wallet and a token with default authorities
    wallet = (await adapter.createWallet()).wallet;
    const addr = await wallet.getAddressAtIndex(0);
    await adapter.injectFunds(wallet, addr!, 10n);
    const token = await adapter.createToken(wallet, 'AuthTestToken', 'ATT', 100n);
    tokenUid = token.hash;
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should return mint authority UTXOs', async () => {
    const mintAuthorities = await adapter.getAuthorityUtxos(wallet, tokenUid, 'mint');

    expect(Array.isArray(mintAuthorities)).toBe(true);
    expect(mintAuthorities.length).toBeGreaterThan(0);

    mintAuthorities.forEach(authUtxo => {
      expect(authUtxo).toEqual(
        expect.objectContaining({
          txId: expect.any(String),
          index: expect.any(Number),
          address: expect.any(String),
          authorities: expect.any(BigInt),
        })
      );
      expect(authUtxo.authorities & TOKEN_MINT_MASK).toBe(TOKEN_MINT_MASK);
    });
  });

  it('should return melt authority UTXOs', async () => {
    const meltAuthorities = await adapter.getAuthorityUtxos(wallet, tokenUid, 'melt');

    expect(Array.isArray(meltAuthorities)).toBe(true);
    expect(meltAuthorities.length).toBeGreaterThan(0);

    meltAuthorities.forEach(authUtxo => {
      expect(authUtxo).toEqual(
        expect.objectContaining({
          txId: expect.any(String),
          index: expect.any(Number),
          address: expect.any(String),
          authorities: expect.any(BigInt),
        })
      );
      expect(authUtxo.authorities & TOKEN_MELT_MASK).toBe(TOKEN_MELT_MASK);
    });
  });

  it('should return empty array for non-existent token', async () => {
    const nonExistentTokenUid = 'cafe'.repeat(16); // 64 character hex string
    const authorities = await adapter.getAuthorityUtxos(wallet, nonExistentTokenUid, 'mint');

    expect(Array.isArray(authorities)).toBe(true);
    expect(authorities).toHaveLength(0);
  });

  it('should return empty for a token created without authorities', async () => {
    const noAuthToken = await adapter.createToken(wallet, 'NoAuthToken', 'NAT', 50n, {
      createMint: false,
      createMelt: false,
    });

    const mintAuthorities = await adapter.getAuthorityUtxos(wallet, noAuthToken.hash, 'mint');
    const meltAuthorities = await adapter.getAuthorityUtxos(wallet, noAuthToken.hash, 'melt');

    expect(mintAuthorities).toHaveLength(0);
    expect(meltAuthorities).toHaveLength(0);
  });

  it('should find delegated mint authority utxo', async () => {
    const addr1 = (await wallet.getAddressAtIndex(1))!;
    await adapter.delegateAuthority(wallet, tokenUid, 'mint', addr1, { createAnother: false });

    const mintUtxos = await adapter.getAuthorityUtxos(wallet, tokenUid, 'mint');
    expect(mintUtxos).toHaveLength(1);
    expect(mintUtxos[0]).toMatchObject({
      txId: expect.any(String),
      index: expect.any(Number),
      address: expect.any(String),
      authorities: TOKEN_MINT_MASK,
    });
  });

  it('should find many "melt" authority utxos after delegation with createAnother', async () => {
    const addr2 = (await wallet.getAddressAtIndex(2))!;
    await adapter.delegateAuthority(wallet, tokenUid, 'melt', addr2, { createAnother: true });

    const meltUtxos = await adapter.getAuthorityUtxos(wallet, tokenUid, 'melt');
    expect(meltUtxos).toHaveLength(2);
    meltUtxos.forEach(utxo => {
      expect(utxo).toMatchObject({
        txId: expect.any(String),
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      });
    });
  });

  it('should filter authority UTXOs by address', async () => {
    // Create a token with authority at a specific address
    const addr4 = (await wallet.getAddressAtIndex(4))!;
    const addr5 = (await wallet.getAddressAtIndex(5))!;
    const filterToken = await adapter.createToken(wallet, 'FilterAuthToken', 'FAT', 50n, {
      mintAuthorityAddress: addr4,
      meltAuthorityAddress: addr5,
    });

    const mintAtAddr4 = await adapter.getAuthorityUtxos(wallet, filterToken.hash, 'mint', {
      filter_address: addr4,
    });
    expect(mintAtAddr4).toHaveLength(1);
    expect(mintAtAddr4[0].address).toBe(addr4);

    // Should return empty when filtering by a different address
    const mintAtAddr5 = await adapter.getAuthorityUtxos(wallet, filterToken.hash, 'mint', {
      filter_address: addr5,
    });
    expect(mintAtAddr5).toHaveLength(0);
  });
});
