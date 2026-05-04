/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared fee-token tests.
 *
 * Validates fee-based ({@link TokenVersion.FEE}) token behavior that is common
 * to both the fullnode ({@link HathorWallet}) and wallet-service
 * ({@link HathorWalletServiceWallet}) facades. Fee-based tokens charge a flat
 * fee per token output instead of the percentage-deposit model used by
 * deposit-based tokens.
 *
 * Facade-specific tests live in:
 * - `fullnode-specific/fee-tokens.test.ts`
 * - `service-specific/fee-tokens.test.ts`
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { TokenVersion } from '../../../src/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import FeeHeader from '../../../src/headers/fee';
import Header from '../../../src/headers/base';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

/**
 * Asserts that the headers list has exactly one fee header charging the given
 * amount on the native token (tokenIndex 0 — fee-based tokens always pay fees in HTR).
 */
function expectFeeAmount(headers: Header[], expectedFee: bigint) {
  const feeHeaders = headers.filter(h => h instanceof FeeHeader);
  expect(feeHeaders).toHaveLength(1);
  const { entries } = feeHeaders[0] as FeeHeader;
  expect(entries).toHaveLength(1);
  expect(entries[0].tokenIndex).toBe(0);
  expect(entries[0].amount).toBe(expectedFee);
}

describe.each(adapters)('[Shared] fee tokens — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should create a fee token charging a flat fee instead of a deposit', async () => {
    const { wallet } = await adapter.createWallet();
    const addr0 = (await wallet.getAddressAtIndex(0))!;
    await adapter.injectFunds(wallet, addr0, 10n);

    const htrBefore = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    // Create a fee-based token (FBT). 8582n was chosen to be obviously above any
    // deposit-percentage threshold so the test would fail loudly if the wallet
    // were treating the token as deposit-based by mistake.
    const tokenAmount = 8582n;
    const { hash: fbtUid, transaction: createTx } = await adapter.createToken(
      wallet,
      'FeeBasedToken',
      'FBT',
      tokenAmount,
      { tokenVersion: TokenVersion.FEE }
    );

    expectFeeAmount(createTx.headers, 1n);

    const htrAfter = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(htrBefore - htrAfter).toBe(1n);

    const tokenBalance = await wallet.getBalance(fbtUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);
  });

  it('should create a fee token without authorities and charge the same fee', async () => {
    const { wallet } = await adapter.createWallet();
    const addr0 = (await wallet.getAddressAtIndex(0))!;
    await adapter.injectFunds(wallet, addr0, 10n);

    const htrBefore = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    const tokenAmount = 500n;
    const { hash: fbtUid, transaction: createTx } = await adapter.createToken(
      wallet,
      'NoAuthFeeToken',
      'NAFT',
      tokenAmount,
      {
        tokenVersion: TokenVersion.FEE,
        createMint: false,
        createMelt: false,
      }
    );

    // Authorities don't affect the fee — still 1n for the single token output.
    expectFeeAmount(createTx.headers, 1n);

    const htrAfter = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(htrBefore - htrAfter).toBe(1n);

    const tokenBalance = await wallet.getBalance(fbtUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);
  });

  it('should mint fee tokens charging a flat fee instead of a deposit', async () => {
    const { wallet } = await adapter.createWallet();
    const addr0 = (await wallet.getAddressAtIndex(0))!;
    await adapter.injectFunds(wallet, addr0, 20n);

    // 1n HTR fee for token creation.
    const { hash: fbtUid } = await adapter.createToken(wallet, 'MintFeeToken', 'MFT', 100n, {
      tokenVersion: TokenVersion.FEE,
    });

    const htrAfterCreate = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    // Mint 500 more units. Deposit-based would cost ~5 HTR; fee-based costs 1 HTR.
    const mintAmount = 500n;
    const { transaction: mintTx } = await adapter.mintTokens(wallet, fbtUid, mintAmount);

    expectFeeAmount(mintTx.headers, 1n);

    const htrAfterMint = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(htrAfterCreate - htrAfterMint).toBe(1n);

    const tokenBalance = await wallet.getBalance(fbtUid);
    expect(tokenBalance[0].balance.unlocked).toBe(100n + mintAmount);
  });

  it('should melt fee tokens charging a flat fee without HTR withdraw', async () => {
    const { wallet } = await adapter.createWallet();
    const addr0 = (await wallet.getAddressAtIndex(0))!;
    await adapter.injectFunds(wallet, addr0, 20n);

    // 1n HTR fee for token creation.
    const { hash: fbtUid } = await adapter.createToken(wallet, 'MeltFeeToken', 'MLFT', 1000n, {
      tokenVersion: TokenVersion.FEE,
    });

    const htrAfterCreate = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    // Melt some tokens. Deposit-based would refund HTR; fee-based charges fee.
    const meltAmount = 300n;
    const { transaction: meltTx } = await adapter.meltTokens(wallet, fbtUid, meltAmount);

    expectFeeAmount(meltTx.headers, 1n);

    const htrAfterMelt = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    // No HTR refund — fee is charged instead.
    expect(htrAfterCreate - htrAfterMelt).toBe(1n);

    const tokenBalance = await wallet.getBalance(fbtUid);
    expect(tokenBalance[0].balance.unlocked).toBe(1000n - meltAmount);
  });

  it('should fail to create a fee token when wallet has no HTR for the fee', async () => {
    const { wallet } = await adapter.createWallet();

    const balance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(balance[0]?.balance.unlocked ?? 0n).toBe(0n);

    await expect(
      adapter.createToken(wallet, 'NoFundsFeeToken', 'NFFT', 1000n, {
        tokenVersion: TokenVersion.FEE,
      })
    ).rejects.toThrow();
  });
});
