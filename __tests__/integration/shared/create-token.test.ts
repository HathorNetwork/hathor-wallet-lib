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
 *
 * Why those tests are not shared here:
 * Both facades create tokens identically; what differs is how the resulting
 * state is *observed*. Sharing them would require new adapter methods that
 * paper over real API asymmetry (script parsing vs. service lookup), which
 * is more abstraction than is justified for the current test count.
 *   - Fullnode reads authority addresses by calling `parseScript` on raw
 *     `Output` buffers using `wallet.getNetworkObject()`.
 *   - Wallet-service reads them by calling `getUtxoFromId(txId, index)`,
 *     a method that has no fullnode equivalent.
 *   - Wallet-service `getBalance()` returns a `tokenAuthorities` field that
 *     fullnode `getBalance()` does not expose at all.
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { TokenVersion } from '../../../src/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import FeeHeader from '../../../src/headers/fee';

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

  // FEE-token creation tests are co-located here (rather than in the dedicated
  // fee-token suites) because createNewToken cannot be exhaustively validated
  // without exercising the FEE token version alongside the deposit-based one.

  it('should create a FEE token with default options', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr = (await wallet.getAddressAtIndex(0))!;
      await adapter.injectFunds(wallet, addr, 10n);

      const tokenAmount = 8582n;
      const created = await adapter.createToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, tokenAmount, {
        tokenVersion: TokenVersion.FEE,
      });

      expect(created.transaction).toMatchObject({
        hash: created.hash,
        name: TOKEN_NAME,
        symbol: TOKEN_SYMBOL,
        version: 2,
        tokenVersion: TokenVersion.FEE,
        headers: [new FeeHeader([{ tokenIndex: 0, amount: 1n }])],
      });

      const tokenBalance = await wallet.getBalance(created.hash);
      expect(tokenBalance[0].token.version).toBe(TokenVersion.FEE);
      expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should create a FEE token with data outputs', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr = (await wallet.getAddressAtIndex(0))!;
      await adapter.injectFunds(wallet, addr, 10n);

      const htrBefore = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

      const tokenAmount = 9999n;
      // 1n HTR for the data output + 1n HTR fee for the token creation
      const expectedHtrAfter = htrBefore - 2n;

      const created = await adapter.createToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, tokenAmount, {
        changeAddress: addr,
        createMint: false,
        createMelt: false,
        data: ['Test Fee Data 01'],
        tokenVersion: TokenVersion.FEE,
      });

      expect(created.transaction).toMatchObject({
        hash: created.hash,
        name: TOKEN_NAME,
        symbol: TOKEN_SYMBOL,
        version: 2,
        tokenVersion: TokenVersion.FEE,
        headers: [new FeeHeader([{ tokenIndex: 0, amount: 1n }])],
        outputs: expect.arrayContaining([
          expect.objectContaining({ value: 1n, tokenData: 0 }),
          expect.objectContaining({ value: expectedHtrAfter, tokenData: 0 }),
          expect.objectContaining({ value: tokenAmount, tokenData: 1 }),
        ]),
      });

      const tknBalance = await wallet.getBalance(created.hash);
      expect(tknBalance[0].token.version).toBe(TokenVersion.FEE);
      expect(tknBalance[0].balance.unlocked).toBe(tokenAmount);

      const htrAfter = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
      expect(htrAfter).toBe(expectedHtrAfter);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should create a FEE token without authorities and charge the fee', async () => {
    const { wallet } = await adapter.createWallet();

    try {
      const addr = (await wallet.getAddressAtIndex(0))!;
      // Just enough to cover the fee — no excess HTR change
      await adapter.injectFunds(wallet, addr, 1n);

      const created = await adapter.createToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, 8582n, {
        createMint: false,
        createMelt: false,
        tokenVersion: TokenVersion.FEE,
      });

      expect(created.transaction.headers).toEqual([new FeeHeader([{ tokenIndex: 0, amount: 1n }])]);

      // No authority outputs were created
      const authorityOutputs = created.transaction.outputs.filter(o => o.tokenData === 129);
      expect(authorityOutputs).toHaveLength(0);

      // The 1n HTR fee consumed all available HTR
      const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
      expect(htrBalance[0].balance.unlocked).toBe(0n);
    } finally {
      await adapter.stopWallet(wallet);
    }
  });
});
