/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade getTokenDetails() transaction-count test.
 *
 * This deliberately re-runs the same create -> melt -> destroy-authority
 * lifecycle as `shared/get-tokens.test.ts`. It is NOT redundant: it exists to
 * assert the one thing that cannot live in the shared suite —
 * `getTokenDetails().totalTransactions` after destroying an authority.
 *
 * The fullnode token-details `total` counts only value transactions (token
 * create/mint/melt); destroying a mint or melt authority does NOT increment it,
 * so the count stays at 2 across both destroy steps. The wallet-service indexer
 * counts those authority-destroy transactions instead, so its mirror-image
 * expectation (3, then 4) lives in
 * `service-specific/token-details-tx-count.test.ts`. Keep the two files in sync
 * operation-for-operation; only the expected counts differ.
 */

import { AuthorityType } from '../../../src/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';

const adapter = new FullnodeWalletTestAdapter();

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Fullnode] getTokenDetails totalTransactions', () => {
  it('does not count authority-destroy transactions', async () => {
    const { wallet } = await adapter.createWallet();
    try {
      const addr0 = (await wallet.getAddressAtIndex(0))!;
      await adapter.injectFunds(wallet, addr0, 10n);

      const token = await adapter.createToken(wallet, 'Count Token', 'CNT', 100n);
      expect(await adapter.getTokenDetails(wallet, token.hash)).toMatchObject({
        totalTransactions: 1,
      });

      // Melting the full supply is a value transaction: it increments the count.
      await adapter.meltTokens(wallet, token.hash, 100n);
      expect(await adapter.getTokenDetails(wallet, token.hash)).toMatchObject({
        totalTransactions: 2,
      });

      // Destroying the mint authority is an authority-only transaction: the
      // fullnode does not count it, so the total stays at 2.
      await adapter.destroyAuthority(wallet, token.hash, AuthorityType.MINT, 1);
      expect(await adapter.getTokenDetails(wallet, token.hash)).toMatchObject({
        totalTransactions: 2,
      });

      // Same for destroying the melt authority — still 2.
      await adapter.destroyAuthority(wallet, token.hash, AuthorityType.MELT, 1);
      expect(await adapter.getTokenDetails(wallet, token.hash)).toMatchObject({
        totalTransactions: 2,
      });
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
