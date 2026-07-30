/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group J — Crypto-level failures: tampered commitments, malformed proofs,
 * key mismatches.
 *
 * These can only be exercised by constructing a malformed payload and feeding
 * it directly to onNewTx with:
 *  - a fresh tx_id (so the wallet doesn't short-circuit on already-known txs);
 *  - NO decoded shielded entries in outputs[] (otherwise the wallet trusts
 *    those verbatim via the alreadyDecoded fast path in addNewTx);
 *  - tampered on-wire fields in shielded_outputs[].
 *
 * The wallet must try to re-decode the tampered output, fail the cryptographic
 * rewind/verification, and refuse to credit the fabricated amount.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

function flipLastByteHex(hex: string): string {
  if (!hex || hex.length < 2) return hex;
  const head = hex.slice(0, -2);
  const last = parseInt(hex.slice(-2), 16);
  const flipped = (last ^ 0x01) & 0xff;
  return head + flipped.toString(16).padStart(2, '0');
}

/**
 * Build a fresh-looking tx payload from a real stored one by giving it a new
 * tx_id and stripping any already-decoded shielded entries from outputs[], so
 * the wallet must re-decode the (tampered) shielded_outputs[] from scratch.
 */
function asFreshDelivery(stored: any, fakeTxId: string, mutate: (shielded: any[]) => any[]) {
  return {
    ...stored,
    tx_id: fakeTxId,
    outputs: (stored.outputs ?? []).filter((o: any) => o?.type !== 'shielded'),
    shielded_outputs: mutate(stored.shielded_outputs ?? []),
  };
}

describe('shielded outputs — Group J: Crypto failures', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('J.40 — Tampered commitment: wallet does not credit a mutated shielded output', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);
    const balBefore = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balBefore).toBe(50n);

    const stored: any = await walletB.getTx(tx!.hash!);
    const mutated = asFreshDelivery(stored, 'ff'.repeat(32), shielded =>
      shielded.map((so: any, i: number) =>
        i === 0 ? { ...so, commitment: flipLastByteHex(so.commitment) } : so
      )
    );

    // Feeding a tampered payload must not crash; the wallet must NOT credit
    // the mutated output (rewind will fail verification).
    await walletB.onNewTx({ history: mutated });
    const balAfter = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    // The intact second output (index 1) would still rewind successfully, so
    // the credit from the fake tx is at most 20n (second output only). Flip
    // of the first commitment must NOT credit its 30n.
    expect(balAfter - balBefore).toBeLessThanOrEqual(20n);
    // And must never include the tampered output's value.
    expect(balAfter).toBeLessThan(balBefore + 30n);
  });

  it('J.41 — Malformed ephemeral_pubkey: does not credit or crash the wallet', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);
    const balBefore = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balBefore).toBe(50n);

    // Replace every ephemeral_pubkey with zero bytes (invalid point) and feed
    // as a fresh tx. The rewind should fail on all outputs; no credit.
    const stored: any = await walletB.getTx(tx!.hash!);
    const mutated = asFreshDelivery(stored, 'ee'.repeat(32), shielded =>
      shielded.map((so: any) => ({ ...so, ephemeral_pubkey: '00'.repeat(33) }))
    );
    await walletB.onNewTx({ history: mutated });
    const balAfter = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    // No output should have been credited — balance must be unchanged.
    expect(balAfter).toBe(balBefore);
  });

  it('J.42 — Fake tx with no shielded_outputs does not credit via the already-decoded path for a fresh wallet', async () => {
    // A would-be attacker can't forge a wallet crediting event by sending a
    // payload with pre-filled decoded shielded entries when the wallet has
    // never seen the underlying commitment: the wallet still has to rewind
    // to claim ownership. Here we validate that feeding a fake tx to a
    // brand-new wallet (no prior knowledge of the underlying tx) does not
    // credit balance just because outputs[] contains type:'shielded' entries.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);

    // Fresh wallet C — never saw this tx.
    const walletC = await generateWalletHelper();
    const addrC = await walletC.getAddressAtIndex(0, { legacy: false });
    const balBeforeC = (await walletC.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    // Build a fake delivery: use B's stored shielded_outputs but replace the
    // decoded.address with one of C's addresses. C should NOT credit because
    // its scan key can't rewind an output encrypted for B's scan pubkey.
    const stored: any = await walletB.getTx(tx!.hash!);
    const forged = asFreshDelivery(stored, 'dd'.repeat(32), shielded =>
      shielded.map((so: any) => ({
        ...so,
        decoded: { ...so.decoded, address: addrC },
      }))
    );
    await walletC.onNewTx({ history: forged });
    const balAfterC = (await walletC.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balAfterC).toBe(balBeforeC);
  });

  it('J.43 — Lying token_data on AmountShielded output does not credit', async () => {
    // TODO_FIX_31: a malicious (or buggy) fullnode could send a shielded
    // output whose on-chain `token_data` points to a different token than
    // the one the sender actually committed to. The attack value: the user
    // sees "you received 50 USDC" when they actually received HTR, opening
    // up UI-level phishing.
    //
    // Defence: the AmountShielded rewind uses `derive_asset_tag(token_uid)`
    // as the range-proof generator. secp256k1_rangeproof_rewind verifies
    // the proof against (commitment, generator) — a wrong generator makes
    // the cryptographic check fail and the rewind throws. The wallet
    // refuses to credit.
    //
    // Simulates the attack: create two tokens, send AS outputs committed to
    // token-A, then re-deliver a forged copy of the tx with `tokens` and
    // `token_data` rewritten to claim token-B. Wallet must NOT credit any
    // balance under the phony token.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Create two custom tokens so we have a well-defined "lied-about" UID.
    const tokA = await createTokenHelper(walletA, 'TrueTok', 'TRU', 1000n, {
      address: await walletA.getAddressAtIndex(1),
    });
    const tokB = await createTokenHelper(walletA, 'FakeTok', 'FAK', 1000n, {
      address: await walletA.getAddressAtIndex(2),
    });

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });

    // Legit AS send of token-A to walletB — the crypto commits to token-A.
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 30n,
        token: tokA.hash,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 20n,
        token: tokA.hash,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);

    const balTrueBefore = (await walletB.getBalance(tokA.hash))[0].balance.unlocked;
    const balFakeBefore = (await walletB.getBalance(tokB.hash))[0].balance.unlocked;
    expect(balTrueBefore).toBe(50n); // legit receive worked
    expect(balFakeBefore).toBe(0n);

    // Forge a copy: same commitments/range-proofs/pubkeys (they commit to
    // token-A), but rewrite `tokens` so that token_data=1 maps to token-B's
    // uid. If the wallet honors `token_data` without cryptographic
    // verification, it credits 50 token-B. If the rewind correctly verifies
    // against `derive_asset_tag(token_uid)`, the proof won't verify for
    // token-B's generator and the credit is refused.
    const stored: any = await walletB.getTx(tx!.hash!);
    const forged = asFreshDelivery(stored, 'cc'.repeat(32), shielded => shielded);
    forged.tokens = [tokB.hash]; // swap: token_data=1 now resolves to tokB

    await walletB.onNewTx({ history: forged });

    // Crypto layer must catch the lie: no token-B credit.
    const balFakeAfter = (await walletB.getBalance(tokB.hash))[0].balance.unlocked;
    expect(balFakeAfter).toBe(0n);

    // And the legitimate token-A balance must be unaffected by the forgery
    // (we didn't touch that tx in storage; the forged copy has a different
    // tx_id so it's treated as a separate tx).
    const balTrueAfter = (await walletB.getBalance(tokA.hash))[0].balance.unlocked;
    expect(balTrueAfter).toBe(50n);
  });
});
