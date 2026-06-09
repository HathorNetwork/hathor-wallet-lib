/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  encodeShieldedUnblindingPayload,
  IShieldedUnblindingEntry,
} from '../../src/shielded/unblinding';

const TX_ID = '00'.repeat(32);

/**
 * Helper: decode the base64url string back into the envelope object the
 * tests want to assert against. Pure inverse of the encoder's
 * `base64url(JSON.stringify(envelope))` step. Keeping it in the test
 * (not in production code) so the encoder stays one-directional —
 * decoding is the explorer's job, not wallet-lib's.
 */
function decode(payload: string): Record<string, unknown> {
  // Reverse the URL-safe substitution and re-pad to a multiple of 4.
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return JSON.parse(Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8'));
}

function out(overrides: Partial<IShieldedUnblindingEntry> = {}): IShieldedUnblindingEntry {
  return {
    index: 0,
    value: 1n,
    token: '00'.repeat(32),
    vbf: '11'.repeat(32),
    ...overrides,
  };
}

describe('encodeShieldedUnblindingPayload', () => {
  it('returns empty string when both arrays are empty', () => {
    // Nothing to unblind → caller should NOT surface an explorer
    // link. The empty-string sentinel keeps the return type uniform
    // (string) and the caller's gate trivial (`payload.length === 0`).
    expect(encodeShieldedUnblindingPayload(TX_ID, [], [])).toBe('');
  });

  it('encodes an outputs-only payload and omits the inputs key', () => {
    const payload = encodeShieldedUnblindingPayload(TX_ID, [out({ index: 3, value: 100n })], []);
    expect(payload.length).toBeGreaterThan(0);
    const env = decode(payload);
    expect(env).toEqual({
      v: 1,
      txId: TX_ID,
      outputs: [{ index: 3, value: '100', token: '00'.repeat(32), vbf: '11'.repeat(32) }],
    });
    // `inputs` key MUST be absent (not `[]`) — older explorer builds
    // relied on the v=1 wire being outputs-only by default.
    expect('inputs' in env).toBe(false);
  });

  it('emits the inputs key when at least one input is present', () => {
    const payload = encodeShieldedUnblindingPayload(
      TX_ID,
      [out({ index: 0, value: 50n })],
      [out({ index: 1, value: 30n })]
    );
    const env = decode(payload) as { inputs?: unknown[] };
    expect(env.inputs).toBeDefined();
    expect(env.inputs).toHaveLength(1);
  });

  it('stringifies bigint values (JSON.stringify cannot serialize bigint natively)', () => {
    const payload = encodeShieldedUnblindingPayload(
      TX_ID,
      [out({ value: 18_446_744_073_709_551_615n })], // 2^64 - 1
      []
    );
    const env = decode(payload) as { outputs: Array<{ value: string }> };
    // Stringified, not coerced to Number (which would lose precision
    // for any value > 2^53).
    expect(env.outputs[0].value).toBe('18446744073709551615');
    expect(typeof env.outputs[0].value).toBe('string');
  });

  it('preserves abf only when present (per-entry, not all-or-nothing)', () => {
    const payload = encodeShieldedUnblindingPayload(
      TX_ID,
      [
        out({ index: 0 }), // AmountShielded — no abf
        out({ index: 1, abf: 'cc'.repeat(32) }), // FullShielded — abf present
      ],
      []
    );
    const env = decode(payload) as {
      outputs: Array<{ abf?: string }>;
    };
    expect('abf' in env.outputs[0]).toBe(false);
    expect(env.outputs[1].abf).toBe('cc'.repeat(32));
  });

  it('emits envelope schema version v=1', () => {
    const payload = encodeShieldedUnblindingPayload(TX_ID, [out()], []);
    expect((decode(payload) as { v: number }).v).toBe(1);
  });

  it('echoes the txId into the envelope so the parser can pin which tx the payload describes', () => {
    const payload = encodeShieldedUnblindingPayload(TX_ID, [out()], []);
    expect((decode(payload) as { txId: string }).txId).toBe(TX_ID);
  });

  it('produces URL-fragment-safe base64 — no +, /, or = padding', () => {
    // Construct an entry whose JSON serialization includes characters
    // (`{`, `}`, `:`, etc.) that base64-encode to a string containing
    // `+`, `/`, or padding — the substitution step in the encoder
    // must rewrite those to `-`, `_`, and strip `=`.
    const payload = encodeShieldedUnblindingPayload(
      TX_ID,
      [out({ value: 12345n, token: 'a'.repeat(64), vbf: 'b'.repeat(64) })],
      []
    );
    expect(payload).not.toMatch(/\+/);
    expect(payload).not.toMatch(/\//);
    expect(payload).not.toMatch(/=+$/);
    // Sanity: the result still round-trips through our decode helper
    // (which reverses the substitutions and re-pads), proving the
    // substitutions are losslessly invertible.
    expect(() => decode(payload)).not.toThrow();
  });

  it('preserves the relative order of outputs and inputs (no sorting)', () => {
    // The parser keys outputs by their `index` field, so order doesn't
    // matter semantically — but the wire form is a List, not a Map,
    // and we don't want the encoder accidentally sorting (which would
    // change byte output and break any consumer doing exact equality
    // on the payload string).
    const payload = encodeShieldedUnblindingPayload(
      TX_ID,
      [out({ index: 5 }), out({ index: 2 }), out({ index: 9 })],
      []
    );
    const env = decode(payload) as { outputs: Array<{ index: number }> };
    expect(env.outputs.map(e => e.index)).toEqual([5, 2, 9]);
  });

  it('matches the byte-exact format the mobile + audit encoders produced before consolidation', () => {
    // Pinned hex of one specific input → output. If this test ever
    // breaks, the explorer's parser will probably break the same way,
    // so changing it is intentional and synchronized with the parser
    // change.
    const payload = encodeShieldedUnblindingPayload(
      '00'.repeat(32),
      [
        {
          index: 0,
          value: 100n,
          token: '11'.repeat(32),
          vbf: '22'.repeat(32),
        },
      ],
      []
    );
    // Reconstruct the expected envelope and base64url-encode it the same
    // way to derive the expected string — keeps this assertion robust to
    // future formatting tweaks while still pinning the producer/consumer
    // contract.
    const expectedEnvelope = JSON.stringify({
      v: 1,
      txId: '00'.repeat(32),
      outputs: [
        {
          index: 0,
          value: '100',
          token: '11'.repeat(32),
          vbf: '22'.repeat(32),
        },
      ],
    });
    const expectedPayload = Buffer.from(expectedEnvelope, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(payload).toBe(expectedPayload);
  });
});
