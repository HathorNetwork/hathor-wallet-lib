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
});

/**
 * Regression coverage for INLINE shielded outputs in `outputs[]`.
 *
 * The alpha-v3 fullnode (and the WS real-time path) deliver shielded outputs
 * nested inside `outputs[]` with `type: 'shielded'` and a commitment instead of
 * a value. The SEPARATED-model schema briefly required `value` on every output,
 * which rejected the inline shielded shape and threw before
 * `normalizeShieldedOutputs` could relocate it into `shielded_outputs[]` —
 * bricking every tx that contains a shielded output. These tests pin both the
 * schema acceptance and the normalize relocation.
 */
describe('addressHistorySchema — inline shielded outputs in outputs[]', () => {
  // A real inline shielded output as emitted by the fullnode: no `value`, a hex
  // commitment, base64 range_proof/script, hex ephemeral_pubkey, address-only
  // decoded. `range_proof` is base64 "abcd" so we can assert hex conversion.
  const inlineShieldedOutput = {
    type: 'shielded',
    commitment: '09fbb71fb77f29184e414aa0ebda936eac97738b749247c6597be233697f1efc6c',
    range_proof: 'YWJjZA==', // base64("abcd") -> hex "61626364"
    script: 'dqkUF7S4s7xJDTbP3RtOd8pqL961GpaIrA==',
    ephemeral_pubkey: '02f924f2c619c63bfebb3657a6d464fd7358bace065d804a8e3c37a9c8c996a05b',
    token_data: 0,
    decoded: { address: 'WQqNv68SWbgULkMXfNtwM7gdRGcgUa5oab' },
    spent_by: null,
    token: '00',
  };

  // Plain number `value` (not bigint) so the JSON clone in the normalize test
  // works; bigIntCoercibleSchema coerces it, and normalize never reads it.
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
    outputs: [transparentOutput, inlineShieldedOutput],
    parents: [],
    tokens: [],
  };

  it('accepts a tx whose outputs[] contains an inline shielded output', () => {
    const result = addressHistorySchema.safeParse({
      success: true,
      history: [historyTx],
      has_more: false,
      first_hash: null,
      first_address: null,
    });
    expect(result.success).toBe(true);
  });

  it('normalizeShieldedOutputs relocates the inline entry into shielded_outputs[] (transparent-only outputs[], hex fields)', () => {
    // Clone so the shared fixture is not mutated in place.
    const tx = JSON.parse(JSON.stringify(historyTx)) as unknown as IHistoryTx;
    transactionUtils.normalizeShieldedOutputs(tx);

    // outputs[] is transparent-only post-normalize; the shielded entry moved out.
    expect(tx.outputs).toHaveLength(1);
    expect((tx.outputs[0] as { value?: unknown }).value).toBeDefined();
    expect(tx.shielded_outputs).toHaveLength(1);

    const so = tx.shielded_outputs![0];
    // commitment was already hex -> unchanged; range_proof base64 -> hex.
    expect(so.commitment).toBe(inlineShieldedOutput.commitment);
    expect(so.range_proof).toBe('61626364');
    expect(so.range_proof).toMatch(/^[0-9a-f]+$/);
    expect(so.spent_by).toBeNull();
  });
});
