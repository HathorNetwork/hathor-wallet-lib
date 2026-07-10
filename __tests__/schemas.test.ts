/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { addressHistorySchema } from '../src/api/schemas/wallet';
import { IHistoryInputSchema } from '../src/schemas';
import transactionUtils from '../src/utils/transaction';
import { IHistoryTx } from '../src/types';

/**
 * Regression coverage for the `thin_wallet/address_history` response schema.
 *
 * The SEPARATED-model rework added a `type` discriminator to history inputs to
 * mark shielded spends. The alpha fullnode also stamps `type: "transparent"` on
 * ordinary transparent inputs — so a schema that only accepts the literal
 * "shielded" (or absent) rejects every transparent input, which throws while
 * loading wallet history and bricks every wallet start. These tests pin the
 * accepted shapes so the schema can never regress to fail-closed on a plain
 * transparent input again.
 */
describe('addressHistorySchema — history input `type` discriminator', () => {
  // A real genesis funding tx as returned by the alpha fullnode: a single
  // transparent input carrying `type: "transparent"`, two transparent outputs.
  const transparentInput = {
    value: 100000000000n,
    token_data: 0,
    script: 'dqkUZmZbJ/fbxMjAidL2hsFwx01m8LWIrA==',
    decoded: { type: 'P2PKH', address: 'WY1URKUnqCTyiixW1Dw29vmeG99hNN4EW6', timelock: null },
    token: '00',
    type: 'transparent',
    tx_id: '00000334a21fbb58b4db8d7ff282d018e03e2977abd3004cf378fb1d677c3967',
    index: 0,
  };

  const transparentOutput = {
    value: 99999999000n,
    token_data: 0,
    script: 'dqkUC0ZxRSSEE4r0LK+clnbZUaB1IyyIrA==',
    decoded: { type: 'P2PKH', address: 'WPhehTyNHTPz954CskfuSgLEfuKXbXeK3f', timelock: null },
    token: '00',
    spent_by: null,
  };

  const makeHistoryResponse = (input: Record<string, unknown>) => ({
    success: true,
    history: [
      {
        tx_id: '7a274493f738aa59572ea1a0fdce0d765dd8a28ca47d5c73b2f68c6ce76134cf',
        version: 1,
        weight: 1.0,
        timestamp: 1781753958,
        is_voided: false,
        inputs: [input],
        outputs: [transparentOutput],
        parents: [
          '54165cef1fd4cf2240d702b8383c307c822c16ca407f78014bdefa189a7571c2',
          '039906854ce6309b3180945f2a23deb9edff369753f7082e19053f5ac11bfbae',
        ],
        tokens: [],
      },
    ],
    has_more: false,
    first_hash: null,
    first_address: null,
  });

  it('accepts an explicit transparent input (`type: "transparent"`)', () => {
    const result = addressHistorySchema.safeParse(makeHistoryResponse(transparentInput));
    expect(result.success).toBe(true);
  });

  it('accepts a transparent input that omits `type` (older fullnodes)', () => {
    const { type: _type, ...noType } = transparentInput;
    const result = addressHistorySchema.safeParse(makeHistoryResponse(noType));
    expect(result.success).toBe(true);
  });

  it('accepts a shielded input (`type: "shielded"`)', () => {
    const shieldedInput = {
      tx_id: '00000334a21fbb58b4db8d7ff282d018e03e2977abd3004cf378fb1d677c3967',
      index: 0,
      type: 'shielded',
      commitment: '02abcdef',
    };
    const result = addressHistorySchema.safeParse(makeHistoryResponse(shieldedInput));
    expect(result.success).toBe(true);
  });

  it('IHistoryInputSchema accepts both transparent and shielded discriminators', () => {
    expect(IHistoryInputSchema.safeParse(transparentInput).success).toBe(true);
    expect(
      IHistoryInputSchema.safeParse({ tx_id: transparentInput.tx_id, index: 0, type: 'shielded' })
        .success
    ).toBe(true);
  });

  it('rejects a transparent input missing its echoed fields (e.g. `value`)', () => {
    // Only shielded inputs may omit the spent output's fields; a transparent
    // input without them is malformed and must fail at the boundary instead of
    // exploding later in balance code.
    const { value: _value, ...noValue } = transparentInput;
    expect(IHistoryInputSchema.safeParse(noValue).success).toBe(false);
  });

  it('accepts a locally-enriched shielded input (decrypted fields, no commitment)', () => {
    // Shape stamped by the sender-local insert (convertTransactionToHistoryTx).
    expect(
      IHistoryInputSchema.safeParse({
        type: 'shielded',
        tx_id: transparentInput.tx_id,
        index: 1,
        script: transparentInput.script,
        decoded: { address: 'WY1URKUnqCTyiixW1Dw29vmeG99hNN4EW6' },
        token_data: 0,
        token: '00',
        value: 500n,
      }).success
    ).toBe(true);
  });
});

/**
 * Coverage for the SEPARATED-model wire.
 *
 * The fullnode delivers shielded outputs in a dedicated top-level
 * `shielded_outputs[]` array on every path (HTTP `/transaction` and
 * `address_history` + WS), so `outputs[]` is transparent-only and
 * `normalizeShieldedOutputs` is a hex-only pass — no inline `type: 'shielded'`
 * entry in `outputs[]` to accept or relocate. These tests pin that invariant:
 * the schema accepts the separated shape, rejects an inline shielded entry in
 * `outputs[]`, and normalize converts the confidential fields in place.
 */
describe('addressHistorySchema — separated shielded_outputs[]', () => {
  // A separated AmountShielded output as emitted by the fullnode: hex
  // commitment, base64 range_proof/script, hex ephemeral_pubkey, address-only
  // decoded, `mode` present — and the public `token` the fullnode stamps on
  // AmountShielded entries regardless of ownership (to_json_extended).
  // `range_proof` is base64 "abcd" to assert hex conversion.
  const shieldedOutput = {
    mode: 1,
    commitment: '09fbb71fb77f29184e414aa0ebda936eac97738b749247c6597be233697f1efc6c',
    range_proof: 'YWJjZA==', // base64("abcd") -> hex "61626364"
    script: 'dqkUF7S4s7xJDTbP3RtOd8pqL961GpaIrA==',
    ephemeral_pubkey: '02f924f2c619c63bfebb3657a6d464fd7358bace065d804a8e3c37a9c8c996a05b',
    token_data: 0,
    token: '00',
    decoded: { address: 'WQqNv68SWbgULkMXfNtwM7gdRGcgUa5oab' },
    spent_by: null,
  };

  // Plain number `value` (not bigint) so the JSON clone in the normalize test
  // works; bigIntCoercibleSchema coerces it.
  const transparentOutput = {
    value: 60,
    token_data: 0,
    script: 'dqkU+m9UioQSJyfKgU/p334z9ecz24KIrA==',
    decoded: { type: 'P2PKH', address: 'WmWDBFDRs4s4j6rXded6HLEvCMo51LkbXA', timelock: null },
    token: '00',
    spent_by: null,
  };

  const historyTx = {
    tx_id: '2949aeadd060f6ffbbcb40c88fe60166a0585d5a8e27e49d220c1b54cf16ad81',
    version: 1,
    weight: 1.0,
    timestamp: 1781756639,
    is_voided: false,
    inputs: [],
    outputs: [transparentOutput],
    shielded_outputs: [shieldedOutput],
    parents: [],
    tokens: [],
  };

  it('accepts a tx with transparent outputs[] and a separated shielded_outputs[]', () => {
    const result = addressHistorySchema.safeParse({
      success: true,
      history: [historyTx],
      has_more: false,
      first_hash: null,
      first_address: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an inline shielded entry (no `value`) in outputs[] — outputs[] is transparent-only', () => {
    const badTx = {
      ...historyTx,
      outputs: [transparentOutput, { type: 'shielded', commitment: 'ab'.repeat(33) }],
      shielded_outputs: [],
    };
    const result = addressHistorySchema.safeParse({
      success: true,
      history: [badTx],
      has_more: false,
      first_hash: null,
      first_address: null,
    });
    expect(result.success).toBe(false);
  });

  it('normalizeShieldedOutputs converts shielded_outputs[] confidential fields in place (no relocation)', () => {
    // Clone so the shared fixture is not mutated in place.
    const tx = JSON.parse(JSON.stringify(historyTx)) as unknown as IHistoryTx;
    transactionUtils.normalizeShieldedOutputs(tx);

    // outputs[] is untouched (transparent-only); the shielded entry stays put.
    expect(tx.outputs).toHaveLength(1);
    expect((tx.outputs[0] as { value?: unknown }).value).toBeDefined();
    expect(tx.shielded_outputs).toHaveLength(1);

    const so = tx.shielded_outputs![0];
    // commitment was already hex -> unchanged; range_proof base64 -> hex.
    expect(so.commitment).toBe(shieldedOutput.commitment);
    expect(so.range_proof).toBe('61626364');
    expect(so.range_proof).toMatch(/^[0-9a-f]+$/);
    expect(so.spent_by).toBeNull();
  });

  // Per-mode wire validation (hathor-core `serialize_shielded_output`):
  // AmountShielded always carries `token_data` and never the FullShielded-only
  // fields; FullShielded always carries `asset_commitment`+`surjection_proof`.
  const parseWith = (so: Record<string, unknown>) =>
    addressHistorySchema.safeParse({
      success: true,
      history: [{ ...historyTx, shielded_outputs: [so] }],
      has_more: false,
      first_hash: null,
      first_address: null,
    }).success;

  const fullShieldedOutput = {
    ...shieldedOutput,
    mode: 2,
    asset_commitment: '0a'.repeat(33),
    surjection_proof: 'ab'.repeat(20),
    token_data: undefined,
    // Hidden asset: FullShielded entries never carry a wire token.
    token: undefined,
  };

  it('accepts a FullShielded entry (asset_commitment + surjection_proof, no token_data)', () => {
    expect(parseWith(fullShieldedOutput)).toBe(true);
  });

  it('rejects an AmountShielded entry missing token_data (always on the wire)', () => {
    expect(parseWith({ ...shieldedOutput, token_data: undefined })).toBe(false);
  });

  it('rejects an AmountShielded entry carrying FullShielded-only fields', () => {
    expect(parseWith({ ...shieldedOutput, asset_commitment: '0a'.repeat(33) })).toBe(false);
  });

  it('rejects a FullShielded entry missing asset_commitment/surjection_proof', () => {
    expect(parseWith({ ...fullShieldedOutput, surjection_proof: undefined })).toBe(false);
  });

  it('accepts an entry without ephemeral_pubkey (all-zeros on-chain -> key omitted)', () => {
    expect(parseWith({ ...shieldedOutput, ephemeral_pubkey: undefined })).toBe(true);
  });

  it('accepts an entry without decoded (non-standard script) and defaults it to {}', () => {
    expect(parseWith({ ...shieldedOutput, decoded: undefined })).toBe(true);
  });

  // Decode-only fields are written all together on decode
  // (shielded/processing.ts) and must be consistent with the `value` gate.
  // `token` on AmountShielded is the exception: the fullnode wire-stamps the
  // public asset on non-owned entries too (to_json_extended).
  it('accepts a wire-stamped token on a non-owned AmountShielded entry', () => {
    expect(parseWith(shieldedOutput)).toBe(true); // fixture carries token, no value
    expect(parseWith({ ...shieldedOutput, token: undefined })).toBe(true); // /transaction path omits it
  });

  it('accepts a fully-marked owned AmountShielded slot and rejects a partial one', () => {
    const owned = { ...shieldedOutput, value: 500, blindingFactor: 'cd'.repeat(32) };
    expect(parseWith(owned)).toBe(true);
    // value without blindingFactor: no writer produces this.
    expect(parseWith({ ...shieldedOutput, value: 500 })).toBe(false);
    // blindingFactor without value: no writer produces this.
    expect(parseWith({ ...shieldedOutput, blindingFactor: 'cd'.repeat(32) })).toBe(false);
    // owned but token missing: decode always recovers the token.
    expect(parseWith({ ...owned, token: undefined })).toBe(false);
  });

  it('requires assetBlindingFactor on an owned FullShielded slot (and forbids it on amount)', () => {
    const ownedFull = {
      ...fullShieldedOutput,
      value: 500,
      token: '00',
      blindingFactor: 'cd'.repeat(32),
    };
    expect(parseWith(ownedFull)).toBe(false); // missing assetBlindingFactor
    expect(parseWith({ ...ownedFull, assetBlindingFactor: 'ef'.repeat(32) })).toBe(true);
    expect(
      parseWith({
        ...shieldedOutput,
        value: 500,
        blindingFactor: 'cd'.repeat(32),
        assetBlindingFactor: 'ef'.repeat(32),
      })
    ).toBe(false); // amount mode never has an asset blinding factor
  });

  it('rejects a non-owned FullShielded entry carrying a token (hidden asset is decode-only)', () => {
    expect(parseWith({ ...fullShieldedOutput, token: '00' })).toBe(false);
  });
});
