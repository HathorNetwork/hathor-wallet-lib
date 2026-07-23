/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared getTokens() / getTokenDetails() lifecycle tests.
 *
 * Validates token listing and metadata behavior that is common to both the
 * fullnode ({@link HathorWallet}) and wallet-service
 * ({@link HathorWalletServiceWallet}) facades. Each test is self-contained: it
 * builds its own wallet, funds it, and creates its own token.
 *
 * Complements `shared/create-token.test.ts`, which asserts the details of a
 * freshly created token; this file covers how `getTokens()` and
 * `getTokenDetails()` evolve across melt and authority-destroy operations.
 *
 * Cross-facade notes:
 * - Both facades return `string[]` from `getTokens()`, but element ordering is
 *   facade-defined, so the assertions below are order-insensitive.
 * - An unknown token raises a different error class and message per facade
 *   (fullnode: plain `Error` with the node's "Unknown token" message;
 *   wallet-service: `WalletRequestError`), asserted via the per-adapter
 *   `unknownTokenError` matcher.
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { AuthorityType, TokenVersion } from '../../../src/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe.each(adapters)('[Shared] getTokens & getTokenDetails — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should reject token details for a token unknown to the network', async () => {
    const { wallet } = await adapter.createWallet();
    try {
      // Each facade raises its own error class and wording for an unknown
      // token — assert the exact per-facade message (see
      // IWalletTestAdapter.unknownTokenError).
      await expect(adapter.getTokenDetails(wallet, fakeTokenUid)).rejects.toThrow(
        adapter.unknownTokenError
      );
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should track getTokens and getTokenDetails across the token lifecycle', async () => {
    const { wallet } = await adapter.createWallet();
    try {
      const addr0 = (await wallet.getAddressAtIndex(0))!;
      await adapter.injectFunds(wallet, addr0, 10n);

      // Before any custom token, only the native uid is listed.
      let tokens = await adapter.getTokens(wallet);
      expect(tokens).toEqual([NATIVE_TOKEN_UID]);

      const token = await adapter.createToken(wallet, 'Details Token', 'DTOK', 100n);

      // The new custom token joins the list (ordering is facade-defined).
      tokens = await adapter.getTokens(wallet);
      expect(tokens).toHaveLength(2);
      expect(tokens).toEqual(expect.arrayContaining([NATIVE_TOKEN_UID, token.hash]));

      // Strict equality is achievable cross-facade: the fullnode builds this
      // exact literal and the wallet-service response schema strips unknown
      // keys, so both yield the identical 4-field shape.
      let details = await adapter.getTokenDetails(wallet, token.hash);
      expect(details).toStrictEqual({
        totalSupply: 100n,
        totalTransactions: 1,
        tokenInfo: {
          id: token.hash,
          name: 'Details Token',
          symbol: 'DTOK',
          version: TokenVersion.DEPOSIT,
        },
        authorities: { mint: true, melt: true },
      });

      // Melting the full supply zeroes totalSupply but keeps the authorities.
      await adapter.meltTokens(wallet, token.hash, 100n);
      details = await adapter.getTokenDetails(wallet, token.hash);
      expect(details).toMatchObject({
        totalSupply: 0n,
        totalTransactions: 2,
        authorities: { mint: true, melt: true },
      });

      // Destroying the mint authority is reflected in the details...
      await adapter.destroyAuthority(wallet, token.hash, AuthorityType.MINT, 1);
      details = await adapter.getTokenDetails(wallet, token.hash);
      expect(details).toMatchObject({
        totalTransactions: 2,
        authorities: { mint: false, melt: true },
      });

      // ...and so is destroying the melt authority.
      await adapter.destroyAuthority(wallet, token.hash, AuthorityType.MELT, 1);
      details = await adapter.getTokenDetails(wallet, token.hash);
      expect(details).toMatchObject({
        totalTransactions: 2,
        authorities: { mint: false, melt: false },
      });

      // The token list is unchanged by melt/destroy operations.
      tokens = await adapter.getTokens(wallet);
      expect(tokens).toHaveLength(2);
      expect(tokens).toEqual(expect.arrayContaining([NATIVE_TOKEN_UID, token.hash]));
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
