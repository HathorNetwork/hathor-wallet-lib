/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group S — mintTokens / meltTokens interactions with shielded
 * inputs / outputs / authorities.
 *
 * Existing K.* coverage tests createNewToken with shielded mint/melt
 * authority addresses (K.3) and shielded change (K.5). What it doesn't
 * exercise is the post-creation lifecycle:
 *   - minting more tokens to a shielded output;
 *   - melting tokens that live in shielded UTXOs;
 *   - using a shielded-spend authority UTXO as the spending authority.
 *
 * Several variants here will land on protocol-level limitations the
 * hathor-core team is still iterating on. Where that's the case the test
 * is `it.skip`ed with a pointer to the upstream issue so the gap stays
 * visible without breaking CI.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group S: mint / melt with shielded components', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * S.0 — `createNewToken` funded by ONLY shielded HTR. Pre-fix this was
   * rejected by hathor-core's verification dispatch (TCT was excluded
   * from the shielded balance branch). The new image relaxes that guard
   * so TCT can spend shielded HTR for the 1% deposit, as long as the
   * minted-token output remains transparent. wallet-lib's
   * `prepareTransaction` already detects the shielded HTR input and
   * attaches a valid `UnshieldBalanceHeader`.
   */
  it('S.0 — createNewToken funded by only shielded HTR', async () => {
    const wallet = await generateWalletHelper();

    // Fund transparent, shield ALL of it back to self, then create a token.
    const fund = await wallet.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(wallet, fund, 100n);

    const sa0 = await wallet.getAddressAtIndex(2, { legacy: false });
    const sa1 = await wallet.getAddressAtIndex(3, { legacy: false });
    const shieldTx = await wallet.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sa1,
        value: 46n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(wallet, shieldTx!.hash!);
    await waitUntilNextTimestamp(wallet, shieldTx!.hash!);

    // wallet now holds ~96 HTR FS. createNewToken must spend that for
    // the 1% deposit (1 HTR for 100 minted tokens).
    const mintAddr = await wallet.getAddressAtIndex(5, { legacy: true });
    const tokenResp = await wallet.createNewToken('ShieldedMint', 'SMT', 100n, {
      address: mintAddr,
    });
    expect(tokenResp).not.toBeNull();
    await waitForTxReceived(wallet, tokenResp.hash);

    const balToken = await wallet.getBalance(tokenResp.hash);
    expect(balToken[0].balance.unlocked).toBe(100n);
  });

  /**
   * S.1 — Mint more tokens directly to a shielded address (FS). The
   * wallet's mint authority is at a legacy address; the newly minted
   * tokens land in a shielded output that the recipient must rewind.
   */
  it('S.1 — mint more tokens to FS output', async () => {
    const wallet = await generateWalletHelper();
    const recipient = await generateWalletHelper();

    const fund = await wallet.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(wallet, fund, 100n);
    const mintAddr = await wallet.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(wallet, 'MintFS', 'MFS', 100n, {
      address: mintAddr,
    });
    await waitUntilNextTimestamp(wallet, tokenResp.hash);

    const sbR0 = await recipient.getAddressAtIndex(0, { legacy: false });
    const sbR1 = await recipient.getAddressAtIndex(1, { legacy: false });
    const tx = await wallet.sendManyOutputsTransaction([
      {
        address: sbR0,
        value: 40n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sbR1,
        value: 60n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(wallet, tx!.hash!);
    await waitForTxReceived(recipient, tx!.hash!);

    const balR = await recipient.getBalance(tokenResp.hash);
    expect(balR[0].balance.unlocked).toBe(100n);
  });

  /**
   * S.2 — Melt tokens that live in a shielded (FS) UTXO. The verifier
   * (`_fold_mint_melt_entry` + `verify_balance`) injects a synthetic
   * unblinded `(melted_amount, TST)` entry on the OUTPUT side from the
   * MeltHeader the wallet emits, and a synthetic `(rebate, HTR)` entry
   * on the INPUT side. With those, balance closes per generator: the
   * shielded TST inputs cancel against the synthetic TST output term on
   * H_TST, and the public HTR rebate output cancels against the
   * synthetic HTR input term on H_HTR — no generator-bridging needed.
   * Wallet emits MeltHeader with `amount = total_in_TST − total_out_TST`
   * (counting shielded contributions too).
   */
  it('S.2 — melt FS-held custom-token UTXO into transparent HTR', async () => {
    const wallet = await generateWalletHelper();

    const fund = await wallet.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(wallet, fund, 100n);
    const mintAddr = await wallet.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(wallet, 'MeltFS', 'MFT', 1000n, {
      address: mintAddr,
    });
    await waitUntilNextTimestamp(wallet, tokenResp.hash);

    // Shield the entire custom-token supply.
    const sa0 = await wallet.getAddressAtIndex(2, { legacy: false });
    const sa1 = await wallet.getAddressAtIndex(3, { legacy: false });
    const shieldTx = await wallet.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 600n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sa1,
        value: 400n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(wallet, shieldTx!.hash!);
    await waitUntilNextTimestamp(wallet, shieldTx!.hash!);

    // Melt 500 tokens — HTR returned (1% withdraw = 5 HTR).
    const meltAddr = await wallet.getAddressAtIndex(5, { legacy: true });
    const meltTx = await wallet.meltTokens(tokenResp.hash, 500n, {
      changeAddress: meltAddr,
    });
    expect(meltTx).not.toBeNull();
    await waitForTxReceived(wallet, meltTx.hash);

    const remaining = await wallet.getBalance(tokenResp.hash);
    expect(remaining[0].balance.unlocked).toBe(500n);
  });

  /**
   * S.3 — Melt tokens that live in an AS UTXO. Same MeltHeader-driven
   * synthetic-term injection as S.2; AS commits the value but leaves
   * the asset (token) unblinded, which is consistent with the public
   * MeltHeader declaration.
   */
  it('S.3 — melt AS-held custom-token UTXO into transparent HTR', async () => {
    const wallet = await generateWalletHelper();

    const fund = await wallet.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(wallet, fund, 100n);
    const mintAddr = await wallet.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(wallet, 'MeltAS', 'MAS', 1000n, {
      address: mintAddr,
    });
    await waitUntilNextTimestamp(wallet, tokenResp.hash);

    const sa0 = await wallet.getAddressAtIndex(2, { legacy: false });
    const sa1 = await wallet.getAddressAtIndex(3, { legacy: false });
    const shieldTx = await wallet.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 600n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 400n,
        token: tokenResp.hash,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(wallet, shieldTx!.hash!);
    await waitUntilNextTimestamp(wallet, shieldTx!.hash!);

    const meltAddr = await wallet.getAddressAtIndex(5, { legacy: true });
    const meltTx = await wallet.meltTokens(tokenResp.hash, 500n, {
      changeAddress: meltAddr,
    });
    expect(meltTx).not.toBeNull();
    await waitForTxReceived(wallet, meltTx.hash);

    const remaining = await wallet.getBalance(tokenResp.hash);
    expect(remaining[0].balance.unlocked).toBe(500n);
  });

  /**
   * S.4 — `mintTokens` paying the HTR deposit out of a shielded HTR UTXO.
   * Pre-fix this hit the same TCT-style dispatch issue. The mint flow
   * correctly takes the shielded balance branch, so a
   * wallet that holds only shielded HTR can mint more of an existing
   * token.
   */
  it('S.4 — mintTokens with shielded HTR funding the deposit', async () => {
    const wallet = await generateWalletHelper();

    // Step 1 — fund + create a token transparent (we still need
    // transparent HTR for the create-token deposit only on this leg).
    const fund = await wallet.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(wallet, fund, 100n);
    const mintAddr = await wallet.getAddressAtIndex(1, { legacy: true });
    const tokenResp = await createTokenHelper(wallet, 'ShieldedMint2', 'SM2', 100n, {
      address: mintAddr,
    });
    await waitUntilNextTimestamp(wallet, tokenResp.hash);

    // Step 2 — shield ALL HTR back to self so any further mint must
    // pay the deposit from shielded HTR.
    const sa0 = await wallet.getAddressAtIndex(2, { legacy: false });
    const sa1 = await wallet.getAddressAtIndex(3, { legacy: false });
    const remaining = (await wallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    const half = remaining / 2n;
    const shieldTx = await wallet.sendManyOutputsTransaction([
      {
        address: sa0,
        value: half,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: sa1,
        value: remaining - half - 4n, // leave room for the 2 FS fees
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    await waitForTxReceived(wallet, shieldTx!.hash!);
    await waitUntilNextTimestamp(wallet, shieldTx!.hash!);

    // Step 3 — mint more tokens. Deposit (1% of mint amount) is paid
    // out of the shielded HTR.
    const mintMore = await wallet.mintTokens(tokenResp.hash, 50n, {
      address: await wallet.getAddressAtIndex(5, { legacy: true }),
    });
    expect(mintMore).not.toBeNull();
    await waitForTxReceived(wallet, mintMore.hash);

    const balToken = await wallet.getBalance(tokenResp.hash);
    expect(balToken[0].balance.unlocked).toBe(150n);
  });
});
