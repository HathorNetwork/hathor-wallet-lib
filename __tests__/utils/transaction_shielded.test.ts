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
} from '../../src/types';
import { ShieldedOutputMode } from '../../src/shielded/types';

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
 * value/token/decoded.address fields (the single ownership gate is
 * `value !== undefined`). A non-owned entry leaves `value` undefined.
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
    const before = JSON.stringify(tx.shielded_outputs);
    transactionUtils.normalizeShieldedOutputs(tx);
    expect(tx.outputs).toHaveLength(1);
    expect(JSON.stringify(tx.shielded_outputs)).toBe(before);
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
