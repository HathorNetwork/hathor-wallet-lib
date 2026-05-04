/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade fee-token tests.
 *
 * Tests for fullnode-only behavior: data outputs on createToken, full output
 * shape assertions, delegateAuthority cross-wallet flows, and complex
 * deposit/withdraw bookkeeping.
 *
 * Shared fee-token tests live in `shared/fee-tokens.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import {
  NATIVE_TOKEN_UID,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../../../src/constants';
import transaction from '../../../src/utils/transaction';
import { TokenVersion } from '../../../src/types';
import FeeHeader from '../../../src/headers/fee';
import Header from '../../../src/headers/base';

/**
 * Asserts that the headers list has exactly one fee header charging the given
 * amount on the native token (tokenIndex 0 — fee-based tokens always pay fees in HTR).
 */
function validateFeeAmount(headers: Header[], expectedFee: bigint) {
  const feeHeaders = headers.filter(h => h instanceof FeeHeader);
  expect(feeHeaders).toHaveLength(1);
  const { entries } = feeHeaders[0] as FeeHeader;
  expect(entries).toHaveLength(1);
  expect(entries[0].tokenIndex).toBe(0);
  expect(entries[0].amount).toBe(expectedFee);
}

describe('[Fullnode] fee tokens — createNewToken with data outputs', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should create a fee token with data outputs and discount data HTR correctly', async () => {
    const wallet = await generateWalletHelper();
    const addr0 = await wallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(wallet, addr0, 10n);

    const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    const previousHtrBalance = htrBalance[0].balance.unlocked;

    const tx = await wallet.createNewToken('FeeBasedToken', 'FBT', 9999n, {
      changeAddress: addr0,
      createMint: false,
      createMelt: false,
      data: ['Test Fee Data 01'],
      tokenVersion: TokenVersion.FEE,
    });

    // Data output costs 1 HTR (the FBT token output uses 1 HTR fee, also costing 1 HTR).
    const expectedHtrBalance = previousHtrBalance - 2n;

    expect(tx).toMatchObject({
      hash: expect.any(String),
      name: 'FeeBasedToken',
      symbol: 'FBT',
      version: 2,
      tokenVersion: TokenVersion.FEE,
      headers: [new FeeHeader([{ tokenIndex: 0, amount: 1n }])],
      outputs: expect.arrayContaining([
        expect.objectContaining({ value: 1n, tokenData: 0 }),
        // Confirms the data output is being discounted from change calculation.
        expect.objectContaining({ value: expectedHtrBalance, tokenData: 0 }),
        expect.objectContaining({ value: 9999n, tokenData: 1 }),
      ]),
    });

    const feeHeader = tx?.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].amount).toBe(1n);

    await waitForTxReceived(wallet, tx!.hash!);
    const fbtBalance = await wallet.getBalance(tx!.hash!);
    expect(fbtBalance[0].token.version).toBe(TokenVersion.FEE);
    expect(fbtBalance[0].balance.unlocked).toBe(9999n);

    const htrBalanceAfter = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalanceAfter[0].balance.unlocked).toBe(expectedHtrBalance);
  });
});

describe('[Fullnode] fee tokens — mintTokens detailed bookkeeping', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should charge 1 HTR fee per fee-token mint regardless of amount', async () => {
    async function getHtrBalance() {
      const [htrBalance] = await wallet.getBalance(NATIVE_TOKEN_UID);
      return htrBalance.balance.unlocked;
    }

    const wallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await wallet.getAddressAtIndex(0), 13n);
    const { hash: fbtUid } = await createTokenHelper(wallet, 'FeeBasedToken', 'FBT', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });
    let expectedHtrFunds = 12n; // 13 funded - 1 fee

    // Minting less than 1.00 tokens still consumes only 1 HTR fee.
    let mintResponse = await wallet.mintTokens(fbtUid, 1n);
    expectedHtrFunds -= 1n;
    expect(mintResponse.tokens.length).toBe(1);
    expect(mintResponse.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenData: 0,
          value: expectedHtrFunds,
        }),
        expect.objectContaining({
          tokenData: 1,
          value: 1n,
        }),
        expect.objectContaining({
          tokenData: TOKEN_AUTHORITY_MASK + 1,
          value: TOKEN_MINT_MASK,
        }),
      ])
    );
    validateFeeAmount(mintResponse.headers, 1n);
    await waitForTxReceived(wallet, mintResponse.hash);
    expect(await getHtrBalance()).toBe(expectedHtrFunds);

    // Minting any large amount still consumes only 1 HTR fee.
    await waitUntilNextTimestamp(wallet, mintResponse.hash);
    const largeMintAmount = 1_000_000_000n;
    mintResponse = await wallet.mintTokens(fbtUid, largeMintAmount);
    expect(mintResponse.tokens.length).toBe(1);
    expect(mintResponse.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenData: 1,
          value: largeMintAmount,
        }),
        expect.objectContaining({
          tokenData: TOKEN_AUTHORITY_MASK + 1,
          value: TOKEN_MINT_MASK,
        }),
      ])
    );
    validateFeeAmount(mintResponse.headers, 1n);
    expectedHtrFunds -= 1n;
    await waitForTxReceived(wallet, mintResponse.hash);
    expect(await getHtrBalance()).toBe(expectedHtrFunds);
  });
});

describe('[Fullnode] fee tokens — meltTokens with delegateAuthority and data outputs', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should melt fee based tokens', async () => {
    const wallet = await generateWalletHelper();
    let expectedHtrAmount = 15n;
    await GenesisWalletHelper.injectFunds(
      wallet,
      await wallet.getAddressAtIndex(0),
      expectedHtrAmount
    );

    const { hash: fbtUid } = await createTokenHelper(wallet, 'FeeBasedToken', 'FBT', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });
    expectedHtrAmount -= 1n; // 14

    let htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Should not melt more than there is available
    await expect(wallet.meltTokens(fbtUid, 99999n)).rejects.toThrow(
      'Not enough tokens to melt: 99999 requested, 8582 available'
    );

    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Melt some tokens - charges 1 HTR fee.
    const meltAmount = 50n;
    const { hash, headers } = await wallet.meltTokens(fbtUid, meltAmount);
    await waitForTxReceived(wallet, hash);
    validateFeeAmount(headers, 1n);
    expectedHtrAmount -= 1n; // 13

    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    const fbtBalance = await wallet.getBalance(fbtUid);
    const expectedAmount = 8582n - meltAmount;
    expect(fbtBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);

    // Melt with defined melt authority address - keeps authority on local addr.
    const address0 = await wallet.getAddressAtIndex(0);
    const meltResponse = await wallet.meltTokens(fbtUid, 1000n, {
      meltAuthorityAddress: address0,
    });
    validateFeeAmount(meltResponse.headers, 1n);
    await waitForTxReceived(wallet, meltResponse.hash);
    expectedHtrAmount -= 1n; // 12

    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    const authorityOutputs = meltResponse.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(1);
    expect(authorityOutputs[0].value).toEqual(TOKEN_MELT_MASK);
    const p2pkh = authorityOutputs[0].parseScript(wallet.getNetworkObject());
    expect(p2pkh.address.base58).toEqual(address0);

    const fbtBalance2 = await wallet.getBalance(fbtUid);
    const expectedAmount2 = expectedAmount - 1000n;
    expect(fbtBalance2[0]).toHaveProperty('balance.unlocked', expectedAmount2);

    // Melt with external address should be rejected unless explicitly allowed.
    const externalWallet = await generateWalletHelper();
    const externalAddress = await externalWallet.getAddressAtIndex(0);

    await expect(
      wallet.meltTokens(fbtUid, 100n, { meltAuthorityAddress: externalAddress })
    ).rejects.toThrow('must belong to your wallet');

    // Allowing it explicitly delegates the authority output to the external address.
    const meltResponse3 = await wallet.meltTokens(fbtUid, 100n, {
      meltAuthorityAddress: externalAddress,
      allowExternalMeltAuthorityAddress: true,
    });
    validateFeeAmount(meltResponse3.headers, 1n);
    await waitForTxReceived(wallet, meltResponse3.hash);
    await waitForTxReceived(externalWallet, meltResponse3.hash);
    expectedHtrAmount -= 1n; // 11

    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    const authorityOutputs3 = meltResponse3.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs3).toHaveLength(1);
    expect(authorityOutputs3[0].value).toEqual(TOKEN_MELT_MASK);
    const p3pkh = authorityOutputs3[0].parseScript(wallet.getNetworkObject());
    expect(p3pkh.address.base58).toEqual(externalAddress);

    const fbtBalance3 = await wallet.getBalance(fbtUid);
    const expectedAmount3 = expectedAmount2 - 100n;
    expect(fbtBalance3[0]).toHaveProperty('balance.unlocked', expectedAmount3);

    // Delegate melt authority back to wallet 1.
    const delegateResponse = await externalWallet.delegateAuthority(fbtUid, 'melt', address0);
    expect(delegateResponse.hash).toBeDefined();
    await waitForTxReceived(wallet, delegateResponse.hash);
    await waitForTxReceived(externalWallet, delegateResponse.hash);

    // Melt with appended data output - 1 fee + 1 HTR for data output.
    const meltResponse4 = await wallet.meltTokens(fbtUid, 100n, { data: ['foobar'] });
    validateFeeAmount(meltResponse4.headers, 1n);
    expect(meltResponse4.hash).toBeDefined();
    await waitForTxReceived(wallet, meltResponse4.hash);
    expectedHtrAmount -= 2n; // 9

    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    expect(meltResponse4).toHaveProperty('tokens.length', 1);
    expect(meltResponse4.tokens[0]).toEqual(fbtUid);

    const fbtBalance4 = await wallet.getBalance(fbtUid);
    const expectedAmount4 = expectedAmount3 - 100n;
    expect(fbtBalance4[0]).toHaveProperty('balance.unlocked', expectedAmount4);

    const dataOutput4 = meltResponse4.outputs[meltResponse4.outputs.length - 1];
    expect(dataOutput4).toHaveProperty('value', 1n);
    expect(dataOutput4).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));

    // Melt with unshifted data output — same cost, different position.
    const meltResponse5 = await wallet.meltTokens(fbtUid, 100n, {
      unshiftData: true,
      data: ['foobar'],
    });
    validateFeeAmount(meltResponse5.headers, 1n);
    expect(meltResponse5.hash).toBeDefined();
    await waitForTxReceived(wallet, meltResponse5.hash);
    expectedHtrAmount -= 2n; // 7

    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    expect(meltResponse5).toHaveProperty('tokens.length', 1);
    expect(meltResponse5.tokens[0]).toEqual(fbtUid);

    const fbtBalance5 = await wallet.getBalance(fbtUid);
    const expectedAmount5 = expectedAmount4 - 100n;
    expect(fbtBalance5[0]).toHaveProperty('balance.unlocked', expectedAmount5);

    const dataOutput5 = meltResponse5.outputs[0];
    expect(dataOutput5).toHaveProperty('value', 1n);
    expect(dataOutput5).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));

    // Melting all remaining tokens with no token output still charges 1 fee.
    const meltResponse6 = await wallet.meltTokens(fbtUid, expectedAmount5);
    validateFeeAmount(meltResponse6.headers, 1n);
    expect(meltResponse6.hash).toBeDefined();
    expect(meltResponse6.outputs).toHaveLength(2);
    expect(meltResponse6.outputs.filter(o => o.tokenData === 1).length).toBe(0);
    await waitForTxReceived(wallet, meltResponse6.hash);
    expectedHtrAmount -= 1n; // 6

    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    const fbtBalance6 = await wallet.getBalance(fbtUid);
    expect(fbtBalance6[0]).toHaveProperty('balance.unlocked', 0n);
  });
});
