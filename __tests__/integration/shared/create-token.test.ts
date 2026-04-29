/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared createNewToken() / getTokenDetails() tests.
 *
 * Validates token creation behavior that is common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades.
 *
 * Facade-specific tests live in:
 * - `fullnode-specific/create-token.test.ts`
 * - `service-specific/create-token.test.ts`
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

const TOKEN_NAME = 'SharedCreateToken';
const TOKEN_SYMBOL = 'SCT';

describe.each(adapters)('[Shared] createNewToken — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should fail when creating a token without funds', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      await expect(
        wallet.createNewToken(TOKEN_NAME, TOKEN_SYMBOL, 100n, {
          pinCode: adapter.defaultPinCode,
        })
      ).rejects.toThrow();
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should create a token with default options', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr = (await wallet.getAddressAtIndex(0))!;
      await adapter.injectFunds(wallet, addr, 10n);

      const tokenAmount = 100n;
      const created = await adapter.createToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, tokenAmount);

      // Hash is a 64-char hex string
      expect(created.hash).toEqual(expect.any(String));
      expect(created.hash).toHaveLength(64);

      // Returned transaction carries the requested name and symbol
      expect(created.transaction).toEqual(
        expect.objectContaining({
          hash: created.hash,
          name: TOKEN_NAME,
          symbol: TOKEN_SYMBOL,
          inputs: expect.any(Array),
          outputs: expect.any(Array),
          tokens: expect.any(Array),
          parents: expect.arrayContaining([expect.any(String)]),
        })
      );
      // Token creation transactions encode the token in the tx itself, not in the tokens list
      expect(created.transaction.tokens).toHaveLength(0);
      // Default options produce a token output plus mint and melt authority outputs
      expect(created.transaction.outputs.length).toBeGreaterThanOrEqual(3);

      // Token balance is exactly the requested amount
      const tokenBalance = await wallet.getBalance(created.hash);
      expect(tokenBalance[0]).toMatchObject({
        balance: { unlocked: tokenAmount, locked: 0n },
      });
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should create a token without mint or melt authorities', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr = (await wallet.getAddressAtIndex(0))!;
      await adapter.injectFunds(wallet, addr, 10n);

      const tokenAmount = 100n;
      const created = await adapter.createToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, tokenAmount, {
        createMint: false,
        createMelt: false,
      });
      expect(created.hash).toHaveLength(64);

      // Without authorities the tx should have a single token output and no authority outputs.
      // Other outputs may exist (e.g. HTR change), so we filter by tokenData.
      const tokenOutputs = created.transaction.outputs.filter(o => o.tokenData === 1);
      expect(tokenOutputs).toHaveLength(1);
      expect(tokenOutputs[0]).toMatchObject({ value: tokenAmount, tokenData: 1 });

      const authorityOutputs = created.transaction.outputs.filter(o => o.tokenData === 129);
      expect(authorityOutputs).toHaveLength(0);

      const details = await adapter.getTokenDetails(wallet, created.hash);
      expect(details.authorities).toEqual({ mint: false, melt: false });
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should return the correct token details metadata', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr = (await wallet.getAddressAtIndex(0))!;
      await adapter.injectFunds(wallet, addr, 10n);

      const tokenAmount = 100n;
      const created = await adapter.createToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, tokenAmount);

      const details = await adapter.getTokenDetails(wallet, created.hash);
      expect(details.totalSupply).toBe(tokenAmount);
      expect(details.totalTransactions).toBe(1);
      expect(details.tokenInfo).toEqual(
        expect.objectContaining({
          id: created.hash,
          name: TOKEN_NAME,
          symbol: TOKEN_SYMBOL,
        })
      );
      expect(details.authorities).toEqual({ mint: true, melt: true });

      // Native token balance was reduced by the deposit (1% of token amount = 1 HTR for 100n)
      const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
      expect(htrBalance[0].balance.unlocked).toBe(9n);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
