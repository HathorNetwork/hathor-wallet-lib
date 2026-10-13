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
import { shielded } from '../../src/lib';
import HathorWallet from '../../src/new/wallet';
import Connection from '../../src/new/connection';
import { MemoryStore, Storage } from '../../src/storage';
import { ShieldedOutputMode } from '../../src/shielded/types';
import {
  getDefaultLogger,
  IHistoryOutput,
  IHistoryShieldedOutput,
  IHistoryTx,
} from '../../src/types';

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
    // `inputs` key MUST be absent (not `[]`), so output-only payloads
    // keep the original v=1 shape.
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
    // Real openings are hex and digits, whose JSON never base64-encodes
    // to `+` or `/`. The `>` and `?` in this token make standard base64
    // emit both, and this envelope's length also gives it `=` padding,
    // so the substitution step in the encoder must rewrite them to `-`,
    // `_`, and strip `=`.
    const payload = encodeShieldedUnblindingPayload(
      TX_ID,
      [out({ value: 12345n, token: '>>>???', vbf: 'b'.repeat(64) })],
      []
    );
    const env = decode(payload);
    const standardBase64 = Buffer.from(JSON.stringify(env), 'utf8').toString('base64');
    expect(standardBase64).toMatch(/\+/);
    expect(standardBase64).toMatch(/\//);
    expect(standardBase64).toMatch(/=+$/);

    expect(payload).not.toMatch(/\+/);
    expect(payload).not.toMatch(/\//);
    expect(payload).not.toMatch(/=+$/);
    // The substitutions are losslessly invertible: the decode helper
    // (which reverses them and re-pads) gets the entry back.
    expect((env as { outputs: Array<{ token: string }> }).outputs[0].token).toBe('>>>???');
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

  it('pins the envelope key order and encoding', () => {
    // Pins the payload of one specific input. If this test ever
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

describe('shielded namespace of the public API', () => {
  it('exposes the encoder and its entry type', () => {
    // How the wallets import it: `import { shielded } from '@hathor/wallet-lib'`.
    expect(shielded.encodeShieldedUnblindingPayload).toBe(encodeShieldedUnblindingPayload);
    const entry: shielded.IShieldedUnblindingEntry = out({ index: 2, value: 7n });
    const env = decode(shielded.encodeShieldedUnblindingPayload(TX_ID, [entry], []));
    expect(env.outputs).toEqual([
      { index: 2, value: '7', token: '00'.repeat(32), vbf: '11'.repeat(32) },
    ]);
  });
});

describe('encoding the openings of HathorWallet.getShieldedUnblindingForTx', () => {
  // The change-level xpub of the 'upon tennis …' test seed. The wallet is
  // never started: getShieldedUnblindingForTx reads only its storage's history.
  const XPUB =
    'xpub6EvdxHF4vBs38uFrs6UuN8Zu78LDoqLrskMffXk531wy7xMFb7X9Ntxb9dGL2kbYdKJ1d83dqAifQS2Wzcq2DxJf7HPDPvMZMtNQxyBzAWn';
  const SPEND_TX_ID = 'a1'.repeat(32);
  const PARENT_TX_ID = 'b2'.repeat(32);
  // A tx the wallet doesn't have: the transparent input below spends it.
  const FUNDING_TX_ID = 'c3'.repeat(32);
  const CUSTOM_TOKEN = 'd4'.repeat(32);

  async function walletWithHistory(txs: IHistoryTx[]): Promise<HathorWallet> {
    const store = new MemoryStore();
    for (const tx of txs) {
      await store.saveTx(tx);
    }
    const connection = new Connection({
      network: 'testnet',
      servers: ['http://localhost:8080/v1a/'],
      logger: getDefaultLogger(),
    });
    return new HathorWallet({ xpub: XPUB, connection, storage: new Storage(store) });
  }

  function transparentOutput(value: bigint): IHistoryOutput {
    return { value, token_data: 0, token: '00', script: '', decoded: {}, spent_by: null };
  }

  function shieldedOutput(fields: Partial<IHistoryShieldedOutput>): IHistoryShieldedOutput {
    return {
      mode: ShieldedOutputMode.AMOUNT_SHIELDED,
      commitment: '',
      range_proof: '',
      script: '',
      token_data: 0,
      decoded: {},
      spent_by: null,
      ...fields,
    };
  }

  function historyTx(fields: Partial<IHistoryTx> & Pick<IHistoryTx, 'tx_id'>): IHistoryTx {
    return {
      version: 1,
      weight: 1,
      timestamp: 1,
      is_voided: false,
      parents: [],
      inputs: [],
      outputs: [],
      ...fields,
    };
  }

  // One transparent output, then a shielded output the wallet received: on-chain
  // index 1. The second input of the spending tx spends it.
  const parentTx = historyTx({
    tx_id: PARENT_TX_ID,
    outputs: [transparentOutput(10n)],
    shielded_outputs: [
      shieldedOutput({
        spent_by: SPEND_TX_ID,
        value: 777n,
        token: '00',
        blindingFactor: '11'.repeat(32),
      }),
    ],
  });

  // Two transparent outputs, then three shielded ones: one for another wallet,
  // which the wallet didn't decode (on-chain index 2), and two the wallet owns,
  // an AmountShielded HTR output (3) and a FullShielded custom-token output (4).
  const spendTx = historyTx({
    tx_id: SPEND_TX_ID,
    timestamp: 2,
    tokens: [CUSTOM_TOKEN],
    inputs: [
      { tx_id: FUNDING_TX_ID, index: 0 },
      { tx_id: PARENT_TX_ID, index: 1, type: 'shielded' },
    ],
    outputs: [transparentOutput(5n), transparentOutput(6n)],
    shielded_outputs: [
      shieldedOutput({}),
      shieldedOutput({ value: 250n, token: '00', blindingFactor: '22'.repeat(32) }),
      shieldedOutput({
        mode: ShieldedOutputMode.FULLY_SHIELDED,
        token_data: undefined,
        asset_commitment: '',
        surjection_proof: '',
        value: 999n,
        token: CUSTOM_TOKEN,
        blindingFactor: '33'.repeat(32),
        assetBlindingFactor: '44'.repeat(32),
      }),
    ],
  });

  it('encodes the openings as the wallet returns them, with no mapping', async () => {
    const wallet = await walletWithHistory([parentTx, spendTx]);
    const openings = await wallet.getShieldedUnblindingForTx(SPEND_TX_ID);
    expect(openings).toEqual({
      outputs: [
        { index: 3, value: 250n, token: '00', vbf: '22'.repeat(32) },
        { index: 4, value: 999n, token: CUSTOM_TOKEN, vbf: '33'.repeat(32), abf: '44'.repeat(32) },
      ],
      inputs: [{ index: 1, value: 777n, token: '00', vbf: '11'.repeat(32) }],
    });

    // The call a wallet makes with the openings.
    const payload = encodeShieldedUnblindingPayload(SPEND_TX_ID, openings.outputs, openings.inputs);
    // Outputs keep their on-chain index and inputs their position in the tx,
    // which is how the explorer matches them. HTR stays `'00'`, as the wallet
    // stores it: the explorer left-pads the token to 32 bytes.
    expect(decode(payload)).toEqual({
      v: 1,
      txId: SPEND_TX_ID,
      outputs: [
        { index: 3, value: '250', token: '00', vbf: '22'.repeat(32) },
        {
          index: 4,
          value: '999',
          token: CUSTOM_TOKEN,
          vbf: '33'.repeat(32),
          abf: '44'.repeat(32),
        },
      ],
      inputs: [{ index: 1, value: '777', token: '00', vbf: '11'.repeat(32) }],
    });
  });

  it('gives an empty payload for a tx the wallet has no openings of', async () => {
    const wallet = await walletWithHistory([]);
    const openings = await wallet.getShieldedUnblindingForTx(SPEND_TX_ID);
    expect(openings).toEqual({ outputs: [], inputs: [] });
    expect(encodeShieldedUnblindingPayload(SPEND_TX_ID, openings.outputs, openings.inputs)).toBe(
      ''
    );
  });
});
