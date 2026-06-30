/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Direct coverage for the SEPARATED-model shielded transaction utils:
 * resolveSpentOutput (the arithmetic parent-output resolver: idx < T →
 * transparent, T ≤ idx < T+S → shielded slot idx-T, else undefined),
 * normalizeShieldedOutputs, and getTxBalance crediting/debiting owned
 * shielded outputs.
 */

import transactionUtils from '../../src/utils/transaction';
import {
  IHistoryTx,
  IHistoryOutput,
  IHistoryShieldedOutput,
  IStorage,
  IUtxo,
  IDataTx,
  IDataInput,
  IDataOutput,
} from '../../src/types';
import { ShieldedOutputMode, IDataShieldedOutput } from '../../src/shielded/types';
import Transaction from '../../src/models/transaction';
import {
  DEFAULT_TX_VERSION,
  CREATE_TOKEN_TX_VERSION,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
} from '../../src/constants';
import ShieldedOutputsHeader from '../../src/headers/shielded_outputs';
import UnshieldBalanceHeader from '../../src/headers/unshield_balance';
import { MintHeader } from '../../src/headers/mint_header';
import { MeltHeader } from '../../src/headers/melt_header';

function makeTransparentOutput(value: bigint, address: string): IHistoryOutput {
  return {
    value,
    token_data: 0,
    script: 'aa',
    decoded: { type: 'P2PKH', address, timelock: null },
    token: '00',
    spent_by: null,
  };
}

/**
 * Build a shielded_outputs[] entry. An OWNED entry carries the decoded
 * value/token/decoded.address fields; getTxBalance gates an owned slot on
 * `value !== undefined` (authoritative) plus isAddressMine(decoded.address). A
 * non-owned entry leaves `value` undefined.
 */
function makeShieldedEntry(
  commitment: string,
  owned: { value: bigint; address: string; token?: string } | null
): IHistoryShieldedOutput {
  const base: IHistoryShieldedOutput = {
    mode: ShieldedOutputMode.AMOUNT_SHIELDED,
    commitment,
    range_proof: 'cc',
    script: 'bb',
    token_data: 0,
    ephemeral_pubkey: 'dd',
    decoded: owned ? { type: 'P2PKH', address: owned.address, timelock: null } : {},
    spent_by: null,
  };
  if (owned) {
    base.value = owned.value;
    base.token = owned.token ?? '00';
  }
  return base;
}

function makeTx(
  outputs: IHistoryOutput[],
  shieldedOutputs?: IHistoryShieldedOutput[],
  extra: Partial<IHistoryTx> = {}
): IHistoryTx {
  return {
    tx_id: 'test-tx',
    version: 1,
    weight: 1,
    timestamp: 1,
    is_voided: false,
    inputs: [],
    outputs,
    parents: [],
    ...(shieldedOutputs ? { shielded_outputs: shieldedOutputs } : {}),
    ...extra,
  };
}

describe('resolveSpentOutput', () => {
  // Parent layout: T=2 transparent outputs, S=2 shielded outputs.
  // On-chain index space: 0,1 transparent; 2 = shielded slot 0; 3 = slot 1.
  const buildParent = () =>
    makeTx(
      [makeTransparentOutput(1n, 'A'), makeTransparentOutput(2n, 'B')],
      [
        makeShieldedEntry('s0', null), // non-owned middle slot (value undefined)
        makeShieldedEntry('s1', { value: 10n, address: 'W-spend' }), // owned
      ]
    );

  it('resolves transparent slots for idx in [0, T)', () => {
    const tx = buildParent();
    const r0 = transactionUtils.resolveSpentOutput(tx, 0);
    expect(r0).toMatchObject({ kind: 'transparent' });
    expect(r0!.output).toMatchObject({ value: 1n });
    const r1 = transactionUtils.resolveSpentOutput(tx, 1);
    expect(r1).toMatchObject({ kind: 'transparent' });
    expect(r1!.output).toMatchObject({ value: 2n });
  });

  it('resolves idx === T to the first shielded slot', () => {
    const tx = buildParent();
    const r = transactionUtils.resolveSpentOutput(tx, 2); // T = 2
    expect(r).toMatchObject({ kind: 'shielded', sIndex: 0 });
    // Non-owned slot: still a valid shielded resolve, value undefined.
    expect((r!.output as IHistoryShieldedOutput).value).toBeUndefined();
    expect((r!.output as IHistoryShieldedOutput).commitment).toBe('s0');
  });

  it('resolves idx === T+S-1 to the last shielded slot (owned, value defined)', () => {
    const tx = buildParent();
    const r = transactionUtils.resolveSpentOutput(tx, 3); // T+S-1 = 3
    expect(r).toMatchObject({ kind: 'shielded', sIndex: 1 });
    expect((r!.output as IHistoryShieldedOutput).value).toBe(10n);
    expect((r!.output as IHistoryShieldedOutput).commitment).toBe('s1');
  });

  it('returns undefined for idx === T+S (past the last shielded slot)', () => {
    const tx = buildParent();
    expect(transactionUtils.resolveSpentOutput(tx, 4)).toBeUndefined(); // T+S = 4
  });

  it('returns undefined for a negative index', () => {
    const tx = buildParent();
    expect(transactionUtils.resolveSpentOutput(tx, -1)).toBeUndefined();
  });

  it('resolves a non-owned middle slot and the owned next slot independently', () => {
    // T=1 transparent; shielded_outputs = [nonOwned#0, owned#1].
    // idx = T+0 → slot 0 (value undefined); idx = T+1 → slot 1 (value defined).
    const tx = makeTx(
      [makeTransparentOutput(5n, 'A')],
      [
        makeShieldedEntry('non-owned', null),
        makeShieldedEntry('owned', { value: 42n, address: 'W-spend' }),
      ]
    );
    const slot0 = transactionUtils.resolveSpentOutput(tx, 1); // T+0
    expect(slot0).toMatchObject({ kind: 'shielded', sIndex: 0 });
    expect((slot0!.output as IHistoryShieldedOutput).value).toBeUndefined();

    const slot1 = transactionUtils.resolveSpentOutput(tx, 2); // T+1
    expect(slot1).toMatchObject({ kind: 'shielded', sIndex: 1 });
    expect((slot1!.output as IHistoryShieldedOutput).value).toBe(42n);
  });

  it('returns undefined for a shielded idx when the parent has no shielded list (S=0)', () => {
    const tx = makeTx([makeTransparentOutput(1n, 'A')]);
    expect(transactionUtils.resolveSpentOutput(tx, 1)).toBeUndefined();
  });
});

describe('normalizeShieldedOutputs', () => {
  it('converts base64 confidential fields in shielded_outputs[] to hex in place', () => {
    const base64Proof = Buffer.from([0x01, 0x02, 0xff]).toString('base64');
    const tx = makeTx(
      [makeTransparentOutput(1n, 'A')],
      [
        {
          mode: ShieldedOutputMode.AMOUNT_SHIELDED,
          commitment: 'ab'.repeat(33), // already hex — must pass through unchanged
          range_proof: base64Proof, // base64 — must become hex
          script: 'aa',
          token_data: 0,
          ephemeral_pubkey: 'cd'.repeat(33),
          decoded: {},
          spent_by: null,
        },
      ]
    );

    transactionUtils.normalizeShieldedOutputs(tx);

    // outputs[] is untouched (transparent-only); the shielded entry is converted in place
    expect(tx.outputs).toHaveLength(1);
    expect(tx.shielded_outputs).toHaveLength(1);
    const so = tx.shielded_outputs![0];
    expect(so.commitment).toBe('ab'.repeat(33));
    expect(so.range_proof).toBe('0102ff'); // base64 -> hex
  });

  it('is a no-op for a transparent-only tx (no shielded_outputs)', () => {
    const tx = makeTx([makeTransparentOutput(1n, 'A')]);
    transactionUtils.normalizeShieldedOutputs(tx);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.shielded_outputs).toBeUndefined();
  });

  it('is idempotent when shielded_outputs is already populated', () => {
    const tx = makeTx(
      [makeTransparentOutput(1n, 'A')],
      [
        {
          commitment: 'ab'.repeat(33),
          range_proof: '0102ff',
          script: 'aa',
          ephemeral_pubkey: 'cd'.repeat(33),
          decoded: {},
        },
      ]
    );
    transactionUtils.normalizeShieldedOutputs(tx);
    expect(tx.outputs).toHaveLength(1);
    // `mode` is derived for the alpha-v3 wire shape (no asset_commitment → AmountShielded).
    expect(tx.shielded_outputs![0].mode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
    // A second pass is a no-op (true idempotency: f(f(x)) === f(x)).
    const afterFirst = JSON.stringify(tx.shielded_outputs);
    transactionUtils.normalizeShieldedOutputs(tx);
    expect(JSON.stringify(tx.shielded_outputs)).toBe(afterFirst);
  });

  it('preserves owned-marker fields while converting an owned shielded entry', () => {
    const tx = makeTx(
      [makeTransparentOutput(1n, 'A')],
      [
        {
          mode: ShieldedOutputMode.AMOUNT_SHIELDED,
          commitment: 'ab'.repeat(33),
          range_proof: Buffer.from([0xcc]).toString('base64'), // base64 — converted to hex
          script: 'bb',
          token_data: 0,
          ephemeral_pubkey: 'dd',
          decoded: { type: 'P2PKH', address: 'W-spend', timelock: null },
          spent_by: null,
          // owned-marker fields, populated post-decryption — must survive normalize
          value: 77n,
          token: '00',
          blindingFactor: 'ff'.repeat(32),
        },
      ]
    );

    transactionUtils.normalizeShieldedOutputs(tx);

    const so = tx.shielded_outputs![0];
    expect(so.range_proof).toBe('cc'); // base64 -> hex
    expect(so.value).toBe(77n);
    expect(so.token).toBe('00');
    expect(so.blindingFactor).toBe('ff'.repeat(32));
    expect(so.decoded.address).toBe('W-spend');
  });

  it('converts the FullShielded-only fields (asset_commitment, surjection_proof) base64→hex, idempotently', () => {
    const b64 = (byte: number) => Buffer.from([byte]).toString('base64');
    const tx = makeTx(
      [makeTransparentOutput(1n, 'A')],
      [
        {
          mode: ShieldedOutputMode.FULLY_SHIELDED,
          commitment: 'ab'.repeat(33), // already hex — unchanged
          range_proof: b64(0x01),
          script: b64(0x02),
          ephemeral_pubkey: b64(0x03),
          asset_commitment: b64(0xaa), // FullShielded-only — must convert
          surjection_proof: b64(0xbb), // FullShielded-only — must convert
          decoded: {},
          spent_by: null,
        },
      ]
    );

    transactionUtils.normalizeShieldedOutputs(tx);
    const so = tx.shielded_outputs![0];
    expect(so.commitment).toBe('ab'.repeat(33));
    expect(so.range_proof).toBe('01');
    expect(so.script).toBe('02');
    expect(so.ephemeral_pubkey).toBe('03');
    expect(so.asset_commitment).toBe('aa');
    expect(so.surjection_proof).toBe('bb');

    // Idempotent: a second pass leaves the now-hex FullShielded fields unchanged.
    transactionUtils.normalizeShieldedOutputs(tx);
    expect(tx.shielded_outputs![0].asset_commitment).toBe('aa');
    expect(tx.shielded_outputs![0].surjection_proof).toBe('bb');
  });

  it('derives `mode` from asset_commitment when the fullnode omits it (alpha-v3 wire)', () => {
    // alpha-v3 fullnodes don't emit `mode` (added to hathor-core's
    // _shielded_output_to_json only in alpha-v4). Without derivation a WS
    // re-delivery leaves `mode` undefined and clobbers the value the sender-local
    // insert set — the sender_local_insert L.3 regression. Only FullShielded
    // outputs carry an asset_commitment, so the shape disambiguates the mode.
    const b64 = (byte: number) => Buffer.from([byte]).toString('base64');
    const tx = makeTx([makeTransparentOutput(1n, 'A')], [
      {
        // FullShielded shape (asset_commitment present), no `mode` on the wire.
        commitment: 'ab'.repeat(33),
        range_proof: b64(0x01),
        script: b64(0x02),
        ephemeral_pubkey: b64(0x03),
        asset_commitment: b64(0xaa),
        surjection_proof: b64(0xbb),
        decoded: {},
        spent_by: null,
      },
      {
        // AmountShielded shape (no asset_commitment), no `mode` on the wire.
        commitment: 'cd'.repeat(33),
        range_proof: b64(0x04),
        script: b64(0x05),
        ephemeral_pubkey: b64(0x06),
        token_data: 0,
        decoded: {},
        spent_by: null,
      },
    ] as unknown as IHistoryShieldedOutput[]);

    transactionUtils.normalizeShieldedOutputs(tx);
    expect(tx.shielded_outputs![0].mode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
    expect(tx.shielded_outputs![1].mode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
  });

  it('keeps an explicit `mode` over the shape heuristic (alpha-v4 wire / local insert)', () => {
    // A `mode` already on the entry must NOT be overwritten by the
    // asset_commitment heuristic, so alpha-v4 (which sends `mode`) and the
    // sender-local insert win — even in a contrived shape/mode mismatch.
    const b64 = (byte: number) => Buffer.from([byte]).toString('base64');
    const tx = makeTx(
      [makeTransparentOutput(1n, 'A')],
      [
        {
          mode: ShieldedOutputMode.AMOUNT_SHIELDED, // explicit, despite the asset_commitment below
          commitment: 'ab'.repeat(33),
          range_proof: b64(0x01),
          script: b64(0x02),
          ephemeral_pubkey: b64(0x03),
          asset_commitment: b64(0xaa),
          decoded: {},
          spent_by: null,
        },
      ]
    );
    transactionUtils.normalizeShieldedOutputs(tx);
    expect(tx.shielded_outputs![0].mode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
  });
});

describe('getTxBalance (shielded)', () => {
  const OWNED = 'W-owned-shielded';

  function makeStorage(opts: { utxo?: IUtxo | null } = {}): IStorage {
    return {
      getCurrentHeight: jest.fn().mockResolvedValue(0),
      version: { reward_spend_min_blocks: 0 },
      isAddressMine: jest.fn(async (addr: string) => addr === OWNED),
      getUtxo: jest.fn().mockResolvedValue(opts.utxo ?? null),
      getTx: jest.fn().mockResolvedValue(null),
    } as unknown as IStorage;
  }

  it('credits an owned shielded receive (value defined) and ignores non-owned slots', async () => {
    const tx = makeTx(
      [], // no transparent outputs
      [
        makeShieldedEntry('non-owned', null), // value undefined → ignored
        makeShieldedEntry('owned', { value: 500n, address: OWNED, token: '00' }),
      ],
      { tx_id: 'recv-tx' }
    );

    const balance = await transactionUtils.getTxBalance(tx, makeStorage());
    expect(balance['00'].tokens.unlocked).toBe(500n);
  });

  it('debits a shielded input whose UTXO is already deleted via the parent resolver', async () => {
    // Parent tx: T=0 transparent, one owned shielded output at on-chain idx 0.
    const parentTx = makeTx(
      [],
      [makeShieldedEntry('spent-commit', { value: 300n, address: OWNED, token: '00' })],
      { tx_id: 'parent-tx' }
    );

    // Spending tx: a shielded input referencing parent idx 0. No decoded
    // value/token on the input and the UTXO has been deleted (getUtxo → null),
    // so getTxBalance must recover the debit from the parent's shielded entry.
    const spendingTx = makeTx([], undefined, {
      tx_id: 'spend-tx',
      inputs: [{ tx_id: 'parent-tx', index: 0, type: 'shielded' }],
    });

    const storage = makeStorage({ utxo: null });
    (storage.getTx as jest.Mock).mockResolvedValue(parentTx);

    const balance = await transactionUtils.getTxBalance(spendingTx, storage);
    expect(balance['00'].tokens.unlocked).toBe(-300n);
  });
});

describe('_attachShieldedHeaders + per-header helpers', () => {
  const buf = (n: number, byte = 0xab): Buffer => Buffer.alloc(n, byte);

  // Minimal AmountShielded build entry. Buffers are dummies — ShieldedOutput
  // validates at serialize time, which header attachment never triggers.
  const amountShieldedData = (token = '00', value = 5n): IDataShieldedOutput => ({
    shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
    address: 'W-addr',
    value,
    token,
    scanPubkey: 'ab'.repeat(33),
    ephemeralPubkey: buf(33),
    commitment: buf(33),
    rangeProof: buf(8),
    blindingFactor: buf(32),
    script: 'aa',
  });

  const fullShieldedData = (): IDataShieldedOutput => ({
    ...(amountShieldedData() as object),
    shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
    assetCommitment: buf(33),
    assetBlindingFactor: buf(32),
    surjectionProof: buf(8),
  });

  const dataInput = (token: string, value: bigint, authorities = 0n): IDataInput => ({
    txId: 'parent',
    index: 0,
    value,
    authorities,
    token,
    address: 'W-addr',
  });

  // A fund output (authorities = 0). Omit `token` to model a create-token
  // output (the new token has no uid yet).
  const fundOutput = (token: string | undefined, value: bigint): IDataOutput => {
    const base = { type: 'p2pkh', value, authorities: 0n, address: 'W-addr', timelock: null };
    return (token === undefined ? base : { ...base, token }) as unknown as IDataOutput;
  };

  const makeDataTx = (over: Partial<IDataTx> = {}): IDataTx => ({
    version: DEFAULT_TX_VERSION,
    inputs: [],
    outputs: [],
    tokens: [],
    ...over,
  });

  const newTx = () => new Transaction([], []);

  describe('_attachShieldedOutputsHeader', () => {
    it('builds models, sets tx.shieldedOutputs, and pushes a ShieldedOutputsHeader', () => {
      const tx = newTx();
      transactionUtils._attachShieldedOutputsHeader(
        tx,
        makeDataTx({ shieldedOutputs: [amountShieldedData()] })
      );
      expect(tx.shieldedOutputs).toHaveLength(1);
      expect(tx.headers.some(h => h instanceof ShieldedOutputsHeader)).toBe(true);
    });

    it('carries assetCommitment/surjectionProof for FullShielded outputs', () => {
      const tx = newTx();
      transactionUtils._attachShieldedOutputsHeader(
        tx,
        makeDataTx({ shieldedOutputs: [fullShieldedData()] })
      );
      expect(tx.shieldedOutputs[0].assetCommitment).toBeDefined();
      expect(tx.shieldedOutputs[0].surjectionProof).toBeDefined();
    });

    it('is a no-op when there are no shielded outputs', () => {
      const tx = newTx();
      transactionUtils._attachShieldedOutputsHeader(tx, makeDataTx());
      expect(tx.headers).toHaveLength(0);
    });

    it('throws when a shielded output is missing a required crypto field', () => {
      const tx = newTx();
      const bad = {
        ...amountShieldedData(),
        commitment: undefined,
      } as unknown as IDataShieldedOutput;
      expect(() =>
        transactionUtils._attachShieldedOutputsHeader(tx, makeDataTx({ shieldedOutputs: [bad] }))
      ).toThrow(/missing required crypto fields/);
    });
  });

  describe('_attachUnshieldBalanceHeader', () => {
    it('pushes an UnshieldBalanceHeader when an excess blinding factor is present', () => {
      const tx = newTx();
      transactionUtils._attachUnshieldBalanceHeader(
        tx,
        makeDataTx({ excessBlindingFactor: buf(32) })
      );
      expect(tx.headers.some(h => h instanceof UnshieldBalanceHeader)).toBe(true);
    });

    it('throws when both an excess and shielded outputs are present (mutually exclusive)', () => {
      const tx = newTx();
      expect(() =>
        transactionUtils._attachUnshieldBalanceHeader(
          tx,
          makeDataTx({ excessBlindingFactor: buf(32), shieldedOutputs: [amountShieldedData()] })
        )
      ).toThrow(/cannot carry both|mutually exclusive/i);
    });

    it('is a no-op without an excess blinding factor', () => {
      const tx = newTx();
      transactionUtils._attachUnshieldBalanceHeader(tx, makeDataTx());
      expect(tx.headers).toHaveLength(0);
    });
  });

  describe('_attachMintMeltHeaders', () => {
    // isShieldedTx is satisfied via excessBlindingFactor so the block runs.
    it('declares a MintHeader for a createToken positive delta', () => {
      const tx = newTx();
      transactionUtils._attachMintMeltHeaders(
        tx,
        makeDataTx({
          version: CREATE_TOKEN_TX_VERSION,
          excessBlindingFactor: buf(32),
          outputs: [fundOutput(undefined, 100n)], // new token, no uid yet
        })
      );
      expect(tx.headers.some(h => h instanceof MintHeader)).toBe(true);
    });

    it('declares a MintHeader for a regular tx when a mint authority is held and delta > 0', () => {
      const tx = newTx();
      transactionUtils._attachMintMeltHeaders(
        tx,
        makeDataTx({
          excessBlindingFactor: buf(32),
          tokens: ['tokenA'],
          inputs: [dataInput('tokenA', 0n, TOKEN_MINT_MASK)],
          outputs: [fundOutput('tokenA', 100n)],
        })
      );
      expect(tx.headers.some(h => h instanceof MintHeader)).toBe(true);
    });

    it('declares a MeltHeader when a melt authority is held and delta < 0', () => {
      const tx = newTx();
      transactionUtils._attachMintMeltHeaders(
        tx,
        makeDataTx({
          excessBlindingFactor: buf(32),
          tokens: ['tokenA'],
          inputs: [dataInput('tokenA', 100n), dataInput('tokenA', 0n, TOKEN_MELT_MASK)],
          outputs: [], // in > out → melt
        })
      );
      expect(tx.headers.some(h => h instanceof MeltHeader)).toBe(true);
    });

    it('declares nothing for a pure shielding move (no authority held)', () => {
      const tx = newTx();
      transactionUtils._attachMintMeltHeaders(
        tx,
        makeDataTx({
          excessBlindingFactor: buf(32),
          tokens: ['tokenA'],
          inputs: [dataInput('tokenA', 50n)],
          outputs: [fundOutput('tokenA', 100n)], // delta>0 but no mint authority held
        })
      );
      expect(tx.headers.some(h => h instanceof MintHeader || h instanceof MeltHeader)).toBe(false);
    });

    it('is a no-op for a non-shielded tx', () => {
      const tx = newTx();
      transactionUtils._attachMintMeltHeaders(
        tx,
        makeDataTx({ tokens: ['tokenA'], outputs: [fundOutput('tokenA', 100n)] })
      );
      expect(tx.headers).toHaveLength(0);
    });
  });

  describe('_attachShieldedHeaders (orchestrator)', () => {
    it('delegates: a shielded-output tx ends up with a ShieldedOutputsHeader', () => {
      const tx = newTx();
      transactionUtils._attachShieldedHeaders(
        tx,
        makeDataTx({ shieldedOutputs: [amountShieldedData()] })
      );
      expect(tx.headers.some(h => h instanceof ShieldedOutputsHeader)).toBe(true);
    });
  });
});
