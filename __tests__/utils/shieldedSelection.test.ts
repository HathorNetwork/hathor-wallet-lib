/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MAX_INPUTS } from '../../src/constants';
import { MemoryStore, Storage } from '../../src/storage';
import { IUtxo } from '../../src/types';
import { OutputKind, ShieldedOutputMode } from '../../src/shielded/types';
import {
  ISelectionReport,
  buildTokenOutputProfiles,
  computeTokenPolicy,
  decideChangeMode,
  hasShieldedUtxo,
  needsAvailabilityProbe,
  shieldedAwareSelection,
} from '../../src/utils/shieldedSelection';

const { AMOUNT_SHIELDED, FULLY_SHIELDED } = ShieldedOutputMode;

function utxo(partial: Partial<IUtxo> & { txId: string; value: bigint }): IUtxo {
  return {
    index: 0,
    token: '00',
    address: `addr-${partial.txId}`,
    authorities: 0n,
    timelock: null,
    type: 0,
    height: null,
    ...partial,
  } as IUtxo;
}

/**
 * Pools for token '00':
 *   transparent   [ 10n, 50n, 100n ]
 *   shielded [ 5n (AS), 40n (FS), 80n (AS) ]
 */
async function makeStorage(extra: IUtxo[] = []): Promise<Storage> {
  const store = new MemoryStore();
  const fixtures: IUtxo[] = [
    utxo({ txId: 'pub-10', value: 10n }),
    utxo({ txId: 'pub-50', value: 50n }),
    utxo({ txId: 'pub-100', value: 100n }),
    utxo({ txId: 'sh-5', value: 5n, shielded: true, blindingFactor: 'bf' }),
    utxo({
      txId: 'sh-40',
      value: 40n,
      shielded: true,
      blindingFactor: 'bf',
      assetBlindingFactor: 'abf',
    }),
    utxo({ txId: 'sh-80', value: 80n, shielded: true, blindingFactor: 'bf' }),
    ...extra,
  ];
  for (const u of fixtures) {
    await store.saveUtxo(u);
  }
  return new Storage(store);
}

const ids = (result: { utxos: IUtxo[] }) => result.utxos.map(u => u.txId).sort();

describe('shieldedAwareSelection', () => {
  const transparentPolicy = {
    preference: OutputKind.TRANSPARENT,
    forceShieldedInput: false,
    forceChangeOnExactSingleShielded: false,
  };
  const shieldedPolicy = { ...transparentPolicy, preference: OutputKind.SHIELDED };

  it('prefer-transparent leaves the shielded pool untouched when transparent covers', async () => {
    const storage = await makeStorage();
    const result = await shieldedAwareSelection(storage, '00', 60n, transparentPolicy);
    expect(result.utxos.every(u => !u.shielded)).toBe(true);
    expect(result.amount).toBeGreaterThanOrEqual(60n);
  });

  it('prefer-transparent exact match inside the pool short-circuits to that UTXO', async () => {
    const storage = await makeStorage();
    const result = await shieldedAwareSelection(storage, '00', 50n, transparentPolicy);
    expect(ids(result)).toEqual(['pub-50']);
  });

  it('prefer-shielded exhausts the shielded pool before transparent', async () => {
    const storage = await makeStorage();
    // 5+40+80 = 125 shielded; ask more so transparent must top up.
    const result = await shieldedAwareSelection(storage, '00', 130n, shieldedPolicy);
    const shieldedPicked = result.utxos
      .filter(u => u.shielded)
      .map(u => u.txId)
      .sort();
    expect(shieldedPicked).toEqual(['sh-40', 'sh-5', 'sh-80']);
    expect(result.utxos.some(u => !u.shielded)).toBe(true);
    expect(result.amount).toBeGreaterThanOrEqual(130n);
  });

  it('prefer-shielded stays inside the shielded pool when it covers', async () => {
    const storage = await makeStorage();
    const result = await shieldedAwareSelection(storage, '00', 60n, shieldedPolicy);
    expect(result.utxos.every(u => u.shielded)).toBe(true);
  });

  it('forced inclusion picks the smallest shielded UTXO even when transparent covers', async () => {
    const storage = await makeStorage();
    const result = await shieldedAwareSelection(storage, '00', 60n, {
      ...transparentPolicy,
      forceShieldedInput: true,
    });
    expect(result.utxos.map(u => u.txId)).toContain('sh-5');
    expect(result.amount).toBeGreaterThanOrEqual(60n);
  });

  it('exact match from a single shielded input forces the smallest other shielded UTXO', async () => {
    // Transparent funds (3n) cannot pay 40n, and the shielded top-up matches the
    // remaining 37n exactly with a single shielded input.
    const store = new MemoryStore();
    await store.saveUtxo(utxo({ txId: 'tiny-pub', value: 3n }));
    await store.saveUtxo(utxo({ txId: 'sh-37', value: 37n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(utxo({ txId: 'sh-5', value: 5n, shielded: true, blindingFactor: 'bf' }));
    const storage = new Storage(store);

    let report: ISelectionReport | undefined;
    const result = await shieldedAwareSelection(
      storage,
      '00',
      40n,
      // The policy shape R2 produces.
      { ...transparentPolicy, forceChangeOnExactSingleShielded: true },
      r => {
        report = r;
      }
    );

    // The smallest other shielded UTXO (5n) is added, so a change output will
    // exist.
    expect(ids(result)).toEqual(['sh-37', 'sh-5', 'tiny-pub']);
    expect(result.amount).toBe(45n);
    expect(report!.exactMatch).toBe(false);
    expect(report!.shieldedInputCount).toBe(2);
  });

  it('the change-forcing UTXO is shielded even when transparent UTXOs are left', async () => {
    // 260 transparent 1n UTXOs: the sweep stops at the input limit and leaves some.
    const store = new MemoryStore();
    for (let i = 0; i < 260; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    await store.saveUtxo(
      utxo({ txId: 'sh-100', value: 100n, shielded: true, blindingFactor: 'bf' })
    );
    await store.saveUtxo(utxo({ txId: 'sh-7', value: 7n, shielded: true, blindingFactor: 'bf' }));
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', 353n, {
      ...transparentPolicy,
      forceChangeOnExactSingleShielded: true,
    });

    // 253 transparent UTXOs and the shielded 100n match 353n exactly with a single
    // shielded input. The change will equal the extra UTXO's value, so the
    // extra is the shielded 7n, not one of the transparent 1n left over.
    const picked = result.utxos.map(u => u.txId);
    expect(picked).toContain('sh-100');
    expect(picked).toContain('sh-7');
    expect(result.utxos).toHaveLength(MAX_INPUTS);
    expect(result.amount).toBe(360n);
  });

  it('exact match with two shielded inputs is returned unchanged', async () => {
    const store = new MemoryStore();
    await store.saveUtxo(utxo({ txId: 'sh-a', value: 30n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(utxo({ txId: 'sh-b', value: 10n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(utxo({ txId: 'pub-extra', value: 7n }));
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', 40n, {
      preference: OutputKind.SHIELDED,
      forceShieldedInput: false,
      forceChangeOnExactSingleShielded: true,
    });
    expect(ids(result)).toEqual(['sh-a', 'sh-b']);
    expect(result.amount).toBe(40n);
  });

  it('exact single-shielded with no other UTXO anywhere proceeds unforced', async () => {
    const store = new MemoryStore();
    await store.saveUtxo(
      utxo({ txId: 'only-sh', value: 40n, shielded: true, blindingFactor: 'bf' })
    );
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', 40n, {
      preference: OutputKind.SHIELDED,
      forceShieldedInput: false,
      forceChangeOnExactSingleShielded: true,
    });
    expect(ids(result)).toEqual(['only-sh']);
    expect(result.amount).toBe(40n);
  });

  it('sweeping an insufficient preferred pool stays within the input limit', async () => {
    // 300 transparent 1n UTXOs cannot pay 500n; sweeping all of them before the
    // shielded top-up would build a tx with more inputs than a tx can hold.
    const store = new MemoryStore();
    for (let i = 0; i < 300; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    await store.saveUtxo(
      utxo({ txId: 'sh-1000', value: 1000n, shielded: true, blindingFactor: 'bf' })
    );
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', 500n, {
      ...transparentPolicy,
      forceChangeOnExactSingleShielded: true,
    });

    // The sweep leaves room for the top-up and for a change-forcing UTXO:
    // 253 transparent UTXOs, then the shielded 1000n.
    expect(result.utxos.map(u => u.txId)).toContain('sh-1000');
    expect(result.utxos).toHaveLength(MAX_INPUTS - 1);
    expect(result.amount).toBe(1253n);
  });

  it('insufficient across both pools reports the combined available sum', async () => {
    const storage = await makeStorage();
    // transparent 160 + shielded 125 = 285 total.
    const result = await shieldedAwareSelection(storage, '00', 300n, transparentPolicy);
    expect(result.utxos).toEqual([]);
    expect(result.amount).toBe(0n);
    expect(result.available).toBe(285n);
  });

  it('reports the fully-shielded marker from the spent inputs', async () => {
    const storage = await makeStorage();
    let report: ISelectionReport | undefined;
    // 130n forces the whole shielded pool incl. the FS sh-40.
    await shieldedAwareSelection(storage, '00', 130n, shieldedPolicy, r => {
      report = r;
    });
    expect(report!.shieldedInputCount).toBe(3);
    expect(report!.anyFullyShieldedInput).toBe(true);
  });
});

describe('hasShieldedUtxo / needsAvailabilityProbe', () => {
  it('probes true only when a shielded UTXO of the token exists', async () => {
    const storage = await makeStorage();
    expect(await hasShieldedUtxo(storage, '00')).toBe(true);
    expect(await hasShieldedUtxo(storage, '01')).toBe(false);
  });

  it('requires the probe only for the mixed cases that may force', () => {
    const base = {
      token: '00',
      hasFullyShieldedOutput: false,
      allShieldedOutputsMine: true,
    };
    // fee-only / all-transparent / all-shielded: no probe
    expect(needsAvailabilityProbe(undefined)).toBe(false);
    expect(
      needsAvailabilityProbe({ ...base, shieldedOutputCount: 0, transparentOutputCount: 2 })
    ).toBe(false);
    expect(
      needsAvailabilityProbe({ ...base, shieldedOutputCount: 2, transparentOutputCount: 0 })
    ).toBe(false);
    // 3a always probes; 3b only when an output leaves the wallet
    expect(
      needsAvailabilityProbe({ ...base, shieldedOutputCount: 1, transparentOutputCount: 1 })
    ).toBe(true);
    expect(
      needsAvailabilityProbe({ ...base, shieldedOutputCount: 2, transparentOutputCount: 1 })
    ).toBe(false);
    expect(
      needsAvailabilityProbe({
        ...base,
        shieldedOutputCount: 2,
        transparentOutputCount: 1,
        allShieldedOutputsMine: false,
      })
    ).toBe(true);
  });
});

describe('computeTokenPolicy', () => {
  const profile = (
    shieldedOutputCount: number,
    transparentOutputCount: number,
    allMine = true,
    hasFS = false
  ) => ({
    token: '00',
    shieldedOutputCount,
    transparentOutputCount,
    hasFullyShieldedOutput: hasFS,
    allShieldedOutputsMine: allMine,
  });

  it('R1: all shielded prefers the shielded pool', () => {
    const { policy, needsSplitFallback } = computeTokenPolicy(profile(2, 0), true, null);
    expect(policy.preference).toBe(OutputKind.SHIELDED);
    expect(policy.forceShieldedInput).toBe(false);
    expect(needsSplitFallback).toBe('none');
  });

  it('R2: all transparent prefers the transparent pool with exact-match forcing', () => {
    const { policy } = computeTokenPolicy(profile(0, 2), true, null);
    expect(policy.preference).toBe(OutputKind.TRANSPARENT);
    expect(policy.forceChangeOnExactSingleShielded).toBe(true);
  });

  it('fee-only HTR follows R2', () => {
    const { policy } = computeTokenPolicy(undefined, true, null);
    expect(policy.preference).toBe(OutputKind.TRANSPARENT);
    expect(policy.forceChangeOnExactSingleShielded).toBe(true);
  });

  it('the transparent override disables exact-match forcing', () => {
    const { policy } = computeTokenPolicy(profile(0, 2), true, OutputKind.TRANSPARENT);
    expect(policy.forceChangeOnExactSingleShielded).toBe(false);
  });

  it('R3a: one shielded output forces a shielded input when available', () => {
    const { policy, needsSplitFallback } = computeTokenPolicy(profile(1, 1), true, null);
    expect(policy.forceShieldedInput).toBe(true);
    expect(needsSplitFallback).toBe('none');
  });

  it('R3a: without a shielded UTXO the output is split', () => {
    const { policy, needsSplitFallback } = computeTokenPolicy(profile(1, 1), false, null);
    expect(policy.forceShieldedInput).toBe(false);
    expect(needsSplitFallback).toBe('splitOne');
  });

  it('R3b: all-mine forces nothing', () => {
    const { policy, needsSplitFallback } = computeTokenPolicy(profile(2, 1, true), false, null);
    expect(policy.forceShieldedInput).toBe(false);
    expect(needsSplitFallback).toBe('none');
  });

  it('R3b: an external shielded output forces a shielded input', () => {
    const { policy } = computeTokenPolicy(profile(2, 1, false), true, null);
    expect(policy.forceShieldedInput).toBe(true);
  });

  it('R3b: external with no shielded UTXO splits the largest output', () => {
    const { needsSplitFallback } = computeTokenPolicy(profile(2, 1, false), false, null);
    expect(needsSplitFallback).toBe('splitLargest');
  });
});

describe('decideChangeMode', () => {
  const profile = (shieldedOutputCount: number, transparentOutputCount: number, hasFS = false) => ({
    token: '00',
    shieldedOutputCount,
    transparentOutputCount,
    hasFullyShieldedOutput: hasFS,
    allShieldedOutputsMine: true,
  });
  const report = (shieldedInputCount: number, anyFS = false): ISelectionReport => ({
    shieldedInputCount,
    anyFullyShieldedInput: anyFS,
    exactMatch: false,
  });

  it('explicit override always wins', () => {
    expect(
      decideChangeMode({
        profile: profile(2, 0, true),
        report: report(3, true),
        override: OutputKind.TRANSPARENT,
      })
    ).toBe(OutputKind.TRANSPARENT);
    expect(
      decideChangeMode({ profile: profile(0, 2), report: report(0), override: AMOUNT_SHIELDED })
    ).toBe(AMOUNT_SHIELDED);
  });

  it('R1: all-shielded outputs shield the change mirroring the outputs', () => {
    expect(
      decideChangeMode({ profile: profile(2, 0, true), report: report(0), override: null })
    ).toBe(FULLY_SHIELDED);
    expect(
      decideChangeMode({ profile: profile(2, 0, false), report: report(0), override: null })
    ).toBe(AMOUNT_SHIELDED);
  });

  it('R2: no shielded input, transparent outputs → transparent change', () => {
    expect(decideChangeMode({ profile: profile(0, 2), report: report(0), override: null })).toBe(
      OutputKind.TRANSPARENT
    );
  });

  it('R2: a shielded input shields the change mirroring the inputs', () => {
    expect(
      decideChangeMode({ profile: profile(0, 2), report: report(1, false), override: null })
    ).toBe(AMOUNT_SHIELDED);
    expect(
      decideChangeMode({ profile: profile(0, 2), report: report(1, true), override: null })
    ).toBe(FULLY_SHIELDED);
  });

  it('R3: mixed with a shielded input mirrors the outputs first', () => {
    expect(
      decideChangeMode({ profile: profile(1, 1, true), report: report(1, false), override: null })
    ).toBe(FULLY_SHIELDED);
  });

  it('R3: mixed without a shielded input keeps the change transparent', () => {
    expect(decideChangeMode({ profile: profile(2, 1), report: report(0), override: null })).toBe(
      OutputKind.TRANSPARENT
    );
  });

  it('fee-only HTR: shielded input shields the change mirroring inputs', () => {
    expect(decideChangeMode({ profile: undefined, report: report(0), override: null })).toBe(
      OutputKind.TRANSPARENT
    );
    expect(decideChangeMode({ profile: undefined, report: report(2, true), override: null })).toBe(
      FULLY_SHIELDED
    );
  });
});

describe('buildTokenOutputProfiles', () => {
  it('classifies per token and checks shielded-destination ownership', async () => {
    const storage = {
      isAddressMine: jest.fn(async (addr: string) => addr === 'mine'),
    };
    const profiles = await buildTokenOutputProfiles(
      [
        { token: '01', address: 'mine', shieldedMode: AMOUNT_SHIELDED },
        { token: '01', address: 'theirs', shieldedMode: FULLY_SHIELDED },
        { token: '01', address: 'pub-dest' },
        { address: 'pub-htr' }, // token absent → HTR
        {}, // data output → transparent HTR
      ],
      storage
    );

    const p01 = profiles.get('01')!;
    expect(p01.shieldedOutputCount).toBe(2);
    expect(p01.transparentOutputCount).toBe(1);
    expect(p01.hasFullyShieldedOutput).toBe(true);
    expect(p01.allShieldedOutputsMine).toBe(false);

    const htr = profiles.get('00')!;
    expect(htr.shieldedOutputCount).toBe(0);
    expect(htr.transparentOutputCount).toBe(2);
  });
});
