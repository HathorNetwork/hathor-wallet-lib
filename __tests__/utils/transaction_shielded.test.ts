/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Direct coverage for the shielded-aware transaction utils introduced in
 * this PR: isShieldedOutputEntry, findSpentOutput (the sparse-decode-safe
 * parent lookup), and normalizeShieldedOutputs. The receive pipeline that
 * consumes them lands in the next PR with its own end-to-end tests.
 */

import transactionUtils from '../../src/utils/transaction';
import { IHistoryTx, IHistoryOutput, IShieldedOutputEntry } from '../../src/types';

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

function makeShieldedEntry(onChainIndex: number, commitment: string): IShieldedOutputEntry {
  return {
    type: 'shielded',
    value: 10n,
    token_data: 0,
    script: 'bb',
    decoded: { type: 'P2PKH', address: 'W-spend-address', timelock: null },
    token: '00',
    spent_by: null,
    commitment,
    range_proof: 'cc',
    ephemeral_pubkey: 'dd',
    onChainIndex,
  };
}

function makeTx(outputs: IHistoryOutput[], extra: Partial<IHistoryTx> = {}): IHistoryTx {
  return {
    tx_id: 'test-tx',
    version: 1,
    weight: 1,
    timestamp: 1,
    is_voided: false,
    inputs: [],
    outputs,
    parents: [],
    ...extra,
  };
}

describe('isShieldedOutputEntry', () => {
  it('discriminates on the commitment field', () => {
    expect(transactionUtils.isShieldedOutputEntry(makeShieldedEntry(1, 'ab'))).toBe(true);
    expect(transactionUtils.isShieldedOutputEntry(makeTransparentOutput(5n, 'W-addr'))).toBe(false);
  });
});

describe('findSpentOutput', () => {
  it('returns the positional output for transparent-only parents', () => {
    const tx = makeTx([makeTransparentOutput(1n, 'A'), makeTransparentOutput(2n, 'B')]);
    expect(transactionUtils.findSpentOutput(tx, 1)).toMatchObject({ value: 2n });
  });

  it('resolves a decoded shielded output by onChainIndex, not array position', () => {
    // Parent: 1 transparent output + 1 DECODED shielded entry whose on-chain
    // absolute index is 2 (e.g. another shielded output at index 1 was not
    // decryptable and is absent from outputs[]). A positional lookup
    // tx.outputs[2] would be undefined; index 1 would WRONGLY return the
    // decoded entry sitting at array position 1.
    const tx = makeTx([makeTransparentOutput(1n, 'A'), makeShieldedEntry(2, 'c0ffee')]);

    const atTwo = transactionUtils.findSpentOutput(tx, 2);
    expect(atTwo).toBeDefined();
    expect((atTwo as IShieldedOutputEntry).commitment).toBe('c0ffee');

    // Index 1 is the UNDECODED shielded output: it must resolve to nothing,
    // not to the entry that happens to sit at array position 1.
    expect(transactionUtils.findSpentOutput(tx, 1)).toBeUndefined();
  });

  it('returns undefined for an out-of-range index', () => {
    const tx = makeTx([makeTransparentOutput(1n, 'A')]);
    expect(transactionUtils.findSpentOutput(tx, 5)).toBeUndefined();
  });
});

describe('normalizeShieldedOutputs', () => {
  it('extracts shielded entries from outputs[] and converts base64 fields to hex', () => {
    const base64Proof = Buffer.from([0x01, 0x02, 0xff]).toString('base64');
    const tx = makeTx([
      makeTransparentOutput(1n, 'A'),
      {
        // Wire shape from to_json_extended: shielded entry inside outputs[]
        // with base64-encoded buffers.
        type: 'shielded',
        value: 0n,
        token_data: 0,
        script: Buffer.from([0xaa]).toString('base64'),
        decoded: {},
        token: '00',
        spent_by: null,
        commitment: 'ab'.repeat(33), // already hex — must pass through
        range_proof: base64Proof,
        ephemeral_pubkey: 'cd'.repeat(33),
      } as IHistoryOutput,
    ]);

    transactionUtils.normalizeShieldedOutputs(tx);

    // Transparent output stays; shielded entry moved to shielded_outputs[]
    expect(tx.outputs).toHaveLength(1);
    expect(tx.shielded_outputs).toHaveLength(1);
    const so = tx.shielded_outputs![0];
    expect(so.commitment).toBe('ab'.repeat(33));
    expect(so.range_proof).toBe('0102ff'); // base64 -> hex
  });

  it('is idempotent when shielded_outputs is already populated', () => {
    const tx = makeTx([makeTransparentOutput(1n, 'A')], {
      shielded_outputs: [
        {
          commitment: 'ab'.repeat(33),
          range_proof: '0102ff',
          script: 'aa',
          ephemeral_pubkey: 'cd'.repeat(33),
          decoded: {},
        },
      ],
    });
    const before = JSON.stringify(tx.shielded_outputs);
    transactionUtils.normalizeShieldedOutputs(tx);
    expect(tx.outputs).toHaveLength(1);
    expect(JSON.stringify(tx.shielded_outputs)).toBe(before);
  });
});
