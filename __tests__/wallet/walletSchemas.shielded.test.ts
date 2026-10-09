/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  ShieldedAddressSchema,
  addressInfoObjectSchema,
  shieldedAddressesResponseSchema,
  shieldedNewAddressesResponseSchema,
  walletStatusResponseSchema,
  balanceResponseSchema,
  splitBalanceResponseSchema,
  historyResponseSchema,
  txOutputResponseSchema,
  fullNodeTxResponseSchema,
  wsTransactionSchema,
} from '../../src/wallet/api/schemas/walletApi';
import {
  shieldedFixtureAddresses,
  legacyFixtureAddress,
  buildShieldedAddressRow,
  buildShieldedNewAddressesResponse,
  buildShieldedTxOutputEntry,
  buildTransparentTxOutputEntry,
  buildSplitBalanceResponse,
} from '../__mock_helpers__/shielded-ws.fixtures';

const ctAddress = shieldedFixtureAddresses[0].shieldedBase58;

describe('ShieldedAddressSchema', () => {
  it('accepts a real 71-byte shielded address', () => {
    expect(ShieldedAddressSchema.safeParse(ctAddress).success).toBe(true);
  });

  it('rejects a legacy address and garbage', () => {
    expect(ShieldedAddressSchema.safeParse(legacyFixtureAddress).success).toBe(false);
    expect(ShieldedAddressSchema.safeParse(`${ctAddress}0`).success).toBe(false);
    expect(ShieldedAddressSchema.safeParse(ctAddress.slice(1)).success).toBe(false);
  });

  it('keeps the legacy address-info schema rejecting shielded addresses', () => {
    const result = addressInfoObjectSchema.safeParse({
      address: ctAddress,
      index: 0,
      addressPath: "m/44'/280'/2'/0/0",
    });
    expect(result.success).toBe(false);
  });
});

describe('shielded address responses', () => {
  it('parses GET wallet/addresses?legacy=false', () => {
    const parsed = shieldedAddressesResponseSchema.parse({
      success: true,
      addresses: [buildShieldedAddressRow(0, 3), buildShieldedAddressRow(1)],
    });
    expect(parsed.addresses[0]).toEqual({
      address: ctAddress,
      spendAddress: shieldedFixtureAddresses[0].spendBase58,
      index: 0,
      transactions: 3,
      seqnum: 0,
    });
  });

  it('rejects a legacy address in the shielded address column', () => {
    const row = { ...buildShieldedAddressRow(0), address: legacyFixtureAddress };
    expect(
      shieldedAddressesResponseSchema.safeParse({ success: true, addresses: [row] }).success
    ).toBe(false);
  });

  it('parses GET wallet/addresses/new?legacy=false', () => {
    const parsed = shieldedNewAddressesResponseSchema.parse(buildShieldedNewAddressesResponse());
    expect(parsed.addresses).toHaveLength(3);
    expect(parsed.spendAddresses[2].address).toBe(shieldedFixtureAddresses[2].spendBase58);
    expect(parsed.legacyAddresses[0].address).toBe(legacyFixtureAddress);
  });
});

describe('walletStatusResponseSchema shielded fields', () => {
  const status = {
    walletId: 'wallet1',
    xpubkey: 'xpub1',
    status: 'creating',
    maxGap: 20,
    createdAt: 1,
    readyAt: null,
  };

  it('keeps shieldedMaxGap and lastUsedShieldedIndex', () => {
    const parsed = walletStatusResponseSchema.parse({
      success: true,
      status: { ...status, shieldedMaxGap: 20, lastUsedShieldedIndex: 7 },
    });
    expect(parsed.status.shieldedMaxGap).toBe(20);
    expect(parsed.status.lastUsedShieldedIndex).toBe(7);
  });

  it('accepts null and absent shielded fields', () => {
    expect(
      walletStatusResponseSchema.parse({
        success: true,
        status: { ...status, shieldedMaxGap: null, lastUsedShieldedIndex: null },
      }).status.shieldedMaxGap
    ).toBeNull();
    expect(walletStatusResponseSchema.safeParse({ success: true, status }).success).toBe(true);
  });
});

describe('balance schemas', () => {
  it('keeps the top-level status of the default response', () => {
    const body = buildSplitBalanceResponse();
    const merged = {
      ...body,
      balances: body.balances.map(b => ({ ...b, balance: { unlocked: 3500, locked: 0 } })),
    };
    const parsed = balanceResponseSchema.parse(merged);
    expect(parsed.status).toBe('ready');
    expect(parsed.balances[0].balance.unlocked).toBe(3500n);
  });

  it('parses the split response', () => {
    const parsed = splitBalanceResponseSchema.parse(buildSplitBalanceResponse());
    expect(parsed.balances[0].balance.unlocked).toEqual({
      transparent: 1000n,
      shielded: 2500n,
      total: 3500n,
    });
    expect(parsed.balances[0].balance.locked.total).toBe(0n);
  });
});

describe('historyResponseSchema shielded fields', () => {
  const row = { txId: 'tx1', balance: 150, timestamp: 1000, voided: 0, version: 1 };

  it('keeps tx_kind and balanceBreakdown', () => {
    const parsed = historyResponseSchema.parse({
      success: true,
      history: [{ ...row, tx_kind: 'mixed', balanceBreakdown: { transparent: 50, shielded: 100 } }],
    });
    expect(parsed.history[0].tx_kind).toBe('mixed');
    expect(parsed.history[0].balanceBreakdown).toEqual({ transparent: 50n, shielded: 100n });
  });

  it('still parses rows without the new fields', () => {
    expect(historyResponseSchema.safeParse({ success: true, history: [row] }).success).toBe(true);
  });

  it('rejects an unknown tx_kind', () => {
    expect(
      historyResponseSchema.safeParse({ success: true, history: [{ ...row, tx_kind: 'other' }] })
        .success
    ).toBe(false);
  });
});

describe('txOutputResponseSchema shielded entries', () => {
  it('parses an amount-shielded entry', () => {
    const parsed = txOutputResponseSchema.parse({
      success: true,
      txOutputs: [buildShieldedTxOutputEntry({ mode: 1 })],
    });
    const [entry] = parsed.txOutputs;
    expect(entry.kind).toBe('shielded');
    if (entry.kind !== 'shielded') throw new Error('unreachable');
    expect(entry.mode).toBe(1);
    expect(entry.tokenData).toBe(0);
    expect(entry.ctAddress).toBe(shieldedFixtureAddresses[1].shieldedBase58);
    expect(entry.addressPath).toBe("m/44'/280'/2'/0/1");
    expect(entry.value).toBe(150n);
  });

  it('parses a fully-shielded entry', () => {
    const parsed = txOutputResponseSchema.parse({
      success: true,
      txOutputs: [buildShieldedTxOutputEntry({ mode: 2 })],
    });
    const [entry] = parsed.txOutputs;
    if (entry.kind !== 'shielded') throw new Error('unreachable');
    expect(entry.assetCommitment).toBeDefined();
    expect(entry.surjectionProof).toBeDefined();
  });

  it('rejects a fully-shielded entry without its asset commitment', () => {
    const { assetCommitment, ...entry } = buildShieldedTxOutputEntry({ mode: 2 }) as Record<
      string,
      unknown
    >;
    expect(assetCommitment).toBeDefined();
    expect(txOutputResponseSchema.safeParse({ success: true, txOutputs: [entry] }).success).toBe(
      false
    );
  });

  it('treats an entry without kind (older server) as transparent', () => {
    const parsed = txOutputResponseSchema.parse({
      success: true,
      txOutputs: [buildTransparentTxOutputEntry(false), buildTransparentTxOutputEntry(true)],
    });
    expect(parsed.txOutputs.map(o => o.kind)).toEqual(['transparent', 'transparent']);
  });
});

describe('fullNodeTxResponseSchema keeps shielded data', () => {
  it('keeps shielded_outputs and output type', () => {
    const tx = {
      hash: 'tx1',
      nonce: '0',
      timestamp: 1,
      version: 1,
      weight: 1,
      parents: [],
      inputs: [],
      outputs: [
        {
          value: 1,
          token_data: 0,
          script: 'abc',
          decoded: {},
          type: 'transparent',
        },
      ],
      shielded_outputs: [
        {
          mode: 1,
          commitment: 'aa',
          range_proof: 'bb',
          script: 'cc',
          token_data: 0,
          ephemeral_pubkey: 'dd',
          decoded: { type: 'P2PKH', address: shieldedFixtureAddresses[0].spendBase58 },
        },
      ],
      tokens: [],
      raw: '',
    };
    const meta = {
      hash: 'tx1',
      spent_outputs: [],
      received_by: [],
      children: [],
      conflict_with: [],
      voided_by: [],
      twins: [],
      accumulated_weight: 1,
      score: 1,
      height: 1,
      first_block: null,
    };
    const parsed = fullNodeTxResponseSchema.parse({ success: true, tx, meta });
    expect(parsed.tx.outputs[0].type).toBe('transparent');
    expect(parsed.tx.shielded_outputs).toHaveLength(1);
    expect(parsed.tx.shielded_outputs![0].ephemeral_pubkey).toBe('dd');
  });
});

describe('wsTransactionSchema shielded fields', () => {
  it('keeps shielded_outputs and addresses', () => {
    const payload = {
      tx_id: '00000000c3c4a3a1d7a7d2e5b3b6e1f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0',
      nonce: 1,
      timestamp: 1,
      version: 1,
      voided: false,
      weight: 1,
      parents: [],
      inputs: [],
      outputs: [],
      token_name: null,
      token_symbol: null,
      signal_bits: 0,
      shielded_outputs: [
        { mode: 1, token_data: 0, decoded: { address: shieldedFixtureAddresses[0].spendBase58 } },
        { mode: 2, decoded: { address: shieldedFixtureAddresses[1].spendBase58 } },
      ],
      addresses: [shieldedFixtureAddresses[0].spendBase58],
    };
    const parsed = wsTransactionSchema.parse(payload);
    expect(parsed.shielded_outputs).toHaveLength(2);
    expect(parsed.addresses).toEqual([shieldedFixtureAddresses[0].spendBase58]);
  });

  it('accepts a shielded output whose script does not decode', () => {
    // The daemon sends `decoded: null` when the output script is not standard
    const parsed = wsTransactionSchema.parse({
      tx_id: '00000000c3c4a3a1d7a7d2e5b3b6e1f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0',
      nonce: 1,
      timestamp: 1,
      version: 1,
      voided: false,
      weight: 1,
      parents: [],
      inputs: [],
      outputs: [],
      token_name: null,
      token_symbol: null,
      signal_bits: 0,
      shielded_outputs: [{ mode: 1, token_data: 0, decoded: null }],
      addresses: [],
    });
    expect(parsed.shielded_outputs![0].decoded).toBeNull();
  });
});
