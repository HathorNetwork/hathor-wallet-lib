/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Wallet-service-facade getTokenDetails() transaction-count test.
 *
 * This deliberately re-runs the same create -> melt -> destroy-authority
 * lifecycle as `shared/get-tokens.test.ts`. It is NOT redundant: it exists to
 * assert the one thing that cannot live in the shared suite —
 * `getTokenDetails().totalTransactions` after destroying an authority.
 *
 * The wallet-service indexer counts authority-destroy transactions in the
 * token's total, so destroying the mint authority takes the count from 2 to 3
 * and destroying the melt authority takes it to 4. The fullnode token-details
 * `total` excludes those transactions (it stays at 2), so its mirror-image
 * expectation lives in `fullnode-specific/token-details-tx-count.test.ts`. Keep
 * the two files in sync operation-for-operation; only the expected counts
 * differ.
 */

import { AuthorityType } from '../../../src/types';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapter = new ServiceWalletTestAdapter();

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] getTokenDetails totalTransactions', () => {
  it('counts authority-destroy transactions', async () => {
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

      // The wallet-service indexer counts the authority-destroy transaction, so
      // destroying the mint authority takes the total from 2 to 3.
      await adapter.destroyAuthority(wallet, token.hash, AuthorityType.MINT, 1);
      expect(await adapter.getTokenDetails(wallet, token.hash)).toMatchObject({
        totalTransactions: 3,
      });

      // And destroying the melt authority takes it to 4.
      await adapter.destroyAuthority(wallet, token.hash, AuthorityType.MELT, 1);
      expect(await adapter.getTokenDetails(wallet, token.hash)).toMatchObject({
        totalTransactions: 4,
      });
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
