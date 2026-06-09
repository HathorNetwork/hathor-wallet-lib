/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group P — encodeShieldedUnblindingPayload (the canonical explorer-
 * fragment encoder) exercised end-to-end against real wallets, real
 * shielded txs, and the real `getShieldedUnblindingForTx` API that
 * feeds it on every consumer (mobile, headless, audit).
 *
 * Unit coverage for the encoder lives in `__tests__/shielded/
 * unblinding.test.ts` and pins the wire format with hand-crafted
 * fixtures. This file fills the gap below that — assert that the
 * envelope the encoder emits when wired to a real wallet's openings
 * actually carries the openings the explorer parser expects.
 */
import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { encodeShieldedUnblindingPayload } from '../../../src/shielded/unblinding';
import * as constants from '../../../src/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(constants as any).TIMEOUT = 30000;

/**
 * Reverse the encoder's URL-safe substitutions and re-pad to a
 * multiple of 4 so the assertions can inspect the JSON envelope the
 * explorer parser would see. Kept in the test (not in production
 * code) so the encoder stays one-directional — decoding is strictly
 * the explorer's job in production paths.
 */
function decodePayload(payload: string): Record<string, unknown> {
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return JSON.parse(Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8'));
}

describe('shielded outputs — Group P: encodeShieldedUnblindingPayload end-to-end', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('P.1 — recipient of an AmountShielded tx encodes outputs with vbf and no abf', async () => {
    const sender: HathorWallet = await generateWalletHelper();
    const recipient: HathorWallet = await generateWalletHelper();

    await GenesisWalletHelper.injectFunds(sender, await sender.getAddressAtIndex(0), 200n);

    const shieldedAddr0 = await recipient.getAddressAtIndex(0, { legacy: false });
    const shieldedAddr1 = await recipient.getAddressAtIndex(1, { legacy: false });
    const tx = await sender.sendManyOutputsTransaction([
      {
        address: shieldedAddr0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddr1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(recipient, tx!.hash!);

    const opening = await recipient.getShieldedUnblindingForTx(tx!.hash!);
    expect(opening.outputs.length).toBe(2);
    expect(opening.inputs.length).toBe(0);

    const payload = encodeShieldedUnblindingPayload(tx!.hash!, opening.outputs, opening.inputs);
    expect(payload.length).toBeGreaterThan(0);

    const decoded = decodePayload(payload);
    expect(decoded.v).toBe(1);
    expect(decoded.txId).toBe(tx!.hash);
    // Empty inputs → the key MUST be absent (not `[]`) so output-only
    // payloads stay byte-identical to the original v=1 wire form.
    expect('inputs' in decoded).toBe(false);

    const outputs = decoded.outputs as Array<{
      index: number;
      value: string;
      token: string;
      vbf: string;
      abf?: string;
    }>;
    expect(outputs).toHaveLength(2);
    const values = outputs.map(o => o.value).sort();
    expect(values).toEqual(['20', '30']);
    for (const o of outputs) {
      // bigint stringified at the encoder boundary (JSON can't
      // serialize bigint natively).
      expect(typeof o.value).toBe('string');
      expect(o.vbf).toMatch(/^[0-9a-f]{64}$/);
      // AmountShielded outputs never carry an asset blinding factor.
      expect('abf' in o).toBe(false);
    }
  });

  it('P.2 — recipient of a FullShielded tx encodes outputs with both vbf and abf', async () => {
    const sender: HathorWallet = await generateWalletHelper();
    const recipient: HathorWallet = await generateWalletHelper();

    // FS fees are 2 HTR per output (vs 1 for AS), so 200 covers
    // 2 outputs comfortably (50 + 50 + 4 fee = 104).
    await GenesisWalletHelper.injectFunds(sender, await sender.getAddressAtIndex(0), 200n);

    const shieldedAddr0 = await recipient.getAddressAtIndex(0, { legacy: false });
    const shieldedAddr1 = await recipient.getAddressAtIndex(1, { legacy: false });
    const tx = await sender.sendManyOutputsTransaction([
      {
        address: shieldedAddr0,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddr1,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(recipient, tx!.hash!);

    const opening = await recipient.getShieldedUnblindingForTx(tx!.hash!);
    expect(opening.outputs.length).toBe(2);

    const payload = encodeShieldedUnblindingPayload(tx!.hash!, opening.outputs, opening.inputs);
    const decoded = decodePayload(payload);
    const outputs = decoded.outputs as Array<{
      vbf: string;
      abf?: string;
    }>;

    for (const o of outputs) {
      // FullShielded encodes the token UID into asset_commitment +
      // surjection_proof, so each output carries its own asset
      // blinding factor (abf). The encoder MUST emit `abf` for these
      // entries — without it the explorer parser can't reconstruct
      // the asset commitment and verification fails silently.
      expect(o.vbf).toMatch(/^[0-9a-f]{64}$/);
      expect(o.abf).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('P.3 — sender of a shielded-spending tx encodes inputs alongside outputs', async () => {
    // To reach the input-openings path the spender must own the
    // parent shielded UTXO. The cleanest deterministic setup is a
    // self-send: walletA funds a shielded UTXO for itself, then
    // walletA spends that UTXO. Self-send keeps the parent-opening
    // ownership trivially on the wallet doing the spend.
    //
    // After step 1 walletA also has a transparent change UTXO; that
    // would let the UTXO selector pick transparent inputs for step 2
    // and shortcut the test. Sizing step 1 to drain all of walletA's
    // transparent funds (49 + 49 + 2 fee = 100, full injection)
    // forces the selector into the shielded pool for step 2.
    const wallet: HathorWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await wallet.getAddressAtIndex(0), 100n);

    const sa0 = await wallet.getAddressAtIndex(0, { legacy: false });
    const sa1 = await wallet.getAddressAtIndex(1, { legacy: false });
    const fundTx = await wallet.sendManyOutputsTransaction([
      {
        address: sa0,
        value: 49n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa1,
        value: 49n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(fundTx).not.toBeNull();
    await waitForTxReceived(wallet, fundTx!.hash!);

    // Spend BOTH shielded UTXOs into a follow-up tx. 49 + 49 = 98,
    // minus 2 fee = 96 budget for outputs; split into 50 + 46.
    const sa2 = await wallet.getAddressAtIndex(2, { legacy: false });
    const sa3 = await wallet.getAddressAtIndex(3, { legacy: false });
    const spendTx = await wallet.sendManyOutputsTransaction([
      {
        address: sa2,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sa3,
        value: 46n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(spendTx).not.toBeNull();
    await waitForTxReceived(wallet, spendTx!.hash!);

    const opening = await wallet.getShieldedUnblindingForTx(spendTx!.hash!);
    // Self-send: the wallet owns the inputs' parent (fundTx) AND the
    // new outputs — both arrays must be populated.
    expect(opening.inputs.length).toBeGreaterThanOrEqual(1);
    expect(opening.outputs.length).toBeGreaterThanOrEqual(1);

    const payload = encodeShieldedUnblindingPayload(
      spendTx!.hash!,
      opening.outputs,
      opening.inputs
    );
    const decoded = decodePayload(payload);
    expect(decoded.inputs).toBeDefined();
    const inputs = decoded.inputs as Array<{ value: string; vbf: string; abf?: string }>;
    // Stringified-bigint invariant on inputs too — same encoder path.
    for (const inp of inputs) {
      expect(typeof inp.value).toBe('string');
      expect(inp.vbf).toMatch(/^[0-9a-f]{64}$/);
      // Parents were AmountShielded → no abf on input openings.
      expect('abf' in inp).toBe(false);
    }
  });

  it('P.4 — sender of an outgoing-only shielded tx has no openings to share (empty payload)', async () => {
    // Symmetry check: when the wallet has no openings at all for a
    // tx — the encoder returns an empty string and the explorer
    // never gets a "View unblinded" link. Sender of a cross-wallet
    // shielded send falls into this: the inputs spent are
    // transparent (just the funding), so no shielded-input openings
    // exist; the shielded outputs target the recipient, so the
    // sender has no decoded shielded outputs of its own either.
    const sender: HathorWallet = await generateWalletHelper();
    const recipient: HathorWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(sender, await sender.getAddressAtIndex(0), 200n);

    const ra0 = await recipient.getAddressAtIndex(0, { legacy: false });
    const ra1 = await recipient.getAddressAtIndex(1, { legacy: false });
    const tx = await sender.sendManyOutputsTransaction([
      {
        address: ra0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: ra1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(sender, tx!.hash!);

    const opening = await sender.getShieldedUnblindingForTx(tx!.hash!);
    expect(opening.outputs).toEqual([]);
    expect(opening.inputs).toEqual([]);

    // The encoder's contract: both arrays empty → empty-string
    // sentinel so callers can gate on `payload.length === 0` rather
    // than parsing an envelope that wouldn't unblind anything.
    const payload = encodeShieldedUnblindingPayload(tx!.hash!, opening.outputs, opening.inputs);
    expect(payload).toBe('');
  });
});
