/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MemoryStore, Storage } from '../../src/storage';
import { IUtxo } from '../../src/types';
import { ShieldedOutputMode } from '../../src/shielded/types';
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
 *   public   [ 10n, 50n, 100n ]
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
  const publicPolicy = {
    preference: 'public' as const,
    forceShieldedInput: false,
    forceChangeOnExactSingleShielded: false,
  };
  const shieldedPolicy = { ...publicPolicy, preference: 'shielded' as const };

  it('prefer-public leaves the shielded pool untouched when public covers', async () => {
    const storage = await makeStorage();
    const result = await shieldedAwareSelection(storage, '00', 60n, publicPolicy);
    expect(result.utxos.every(u => !u.shielded)).toBe(true);
    expect(result.amount).toBeGreaterThanOrEqual(60n);
  });

  it('prefer-public exact match inside the pool short-circuits to that UTXO', async () => {
    const storage = await makeStorage();
    const result = await shieldedAwareSelection(storage, '00', 50n, publicPolicy);
    expect(ids(result)).toEqual(['pub-50']);
  });

  it('prefer-shielded exhausts the shielded pool before public', async () => {
    const storage = await makeStorage();
    // 5+40+80 = 125 shielded; ask more so public must top up.
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

  it('forced inclusion picks the smallest shielded UTXO even when public covers', async () => {
    const storage = await makeStorage();
    const result = await shieldedAwareSelection(storage, '00', 60n, {
      ...publicPolicy,
      forceShieldedInput: true,
    });
    expect(result.utxos.map(u => u.txId)).toContain('sh-5');
    expect(result.amount).toBeGreaterThanOrEqual(60n);
  });

  it('exact match from a single shielded input forces the smallest extra UTXO', async () => {
    // Only one 40n shielded UTXO and the target matches it exactly.
    const store = new MemoryStore();
    await store.saveUtxo(
      utxo({ txId: 'only-sh', value: 40n, shielded: true, blindingFactor: 'bf' })
    );
    await store.saveUtxo(utxo({ txId: 'tiny-pub', value: 3n }));
    await store.saveUtxo(utxo({ txId: 'big-pub', value: 90n }));
    const storage = new Storage(store);

    let report: ISelectionReport | undefined;
    const result = await shieldedAwareSelection(
      storage,
      '00',
      40n,
      // public-preferred but only the shielded UTXO reaches 40n... force the
      // policy shape R2 produces.
      { preference: 'shielded', forceShieldedInput: false, forceChangeOnExactSingleShielded: true },
      r => {
        report = r;
      }
    );

    // The smallest extra (3n public) is added, so a change output will exist.
    expect(ids(result)).toEqual(['only-sh', 'tiny-pub']);
    expect(result.amount).toBe(43n);
    expect(report!.exactMatch).toBe(false);
    expect(report!.shieldedInputCount).toBe(1);
  });

  it('exact match with two shielded inputs is returned unchanged', async () => {
    const store = new MemoryStore();
    await store.saveUtxo(utxo({ txId: 'sh-a', value: 30n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(utxo({ txId: 'sh-b', value: 10n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(utxo({ txId: 'pub-extra', value: 7n }));
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', 40n, {
      preference: 'shielded',
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
      preference: 'shielded',
      forceShieldedInput: false,
      forceChangeOnExactSingleShielded: true,
    });
    expect(ids(result)).toEqual(['only-sh']);
    expect(result.amount).toBe(40n);
  });

  it('insufficient across both pools reports the combined available sum', async () => {
    const storage = await makeStorage();
    // public 160 + shielded 125 = 285 total.
    const result = await shieldedAwareSelection(storage, '00', 300n, publicPolicy);
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
    // fee-only / all-public / all-shielded: no probe
    expect(needsAvailabilityProbe(undefined)).toBe(false);
    expect(needsAvailabilityProbe({ ...base, shieldedOutputCount: 0, publicOutputCount: 2 })).toBe(
      false
    );
    expect(needsAvailabilityProbe({ ...base, shieldedOutputCount: 2, publicOutputCount: 0 })).toBe(
      false
    );
    // 3a always probes; 3b only when an output leaves the wallet
    expect(needsAvailabilityProbe({ ...base, shieldedOutputCount: 1, publicOutputCount: 1 })).toBe(
      true
    );
    expect(needsAvailabilityProbe({ ...base, shieldedOutputCount: 2, publicOutputCount: 1 })).toBe(
      false
    );
    expect(
      needsAvailabilityProbe({
        ...base,
        shieldedOutputCount: 2,
        publicOutputCount: 1,
        allShieldedOutputsMine: false,
      })
    ).toBe(true);
  });
});

describe('computeTokenPolicy', () => {
  const profile = (
    shieldedOutputCount: number,
    publicOutputCount: number,
    allMine = true,
    hasFS = false
  ) => ({
    token: '00',
    shieldedOutputCount,
    publicOutputCount,
    hasFullyShieldedOutput: hasFS,
    allShieldedOutputsMine: allMine,
  });

  it('R1: all shielded prefers the shielded pool', () => {
    const { policy, needsSplitFallback } = computeTokenPolicy(profile(2, 0), true, null);
    expect(policy.preference).toBe('shielded');
    expect(policy.forceShieldedInput).toBe(false);
    expect(needsSplitFallback).toBe('none');
  });

  it('R2: all public prefers the public pool with exact-match forcing', () => {
    const { policy } = computeTokenPolicy(profile(0, 2), true, null);
    expect(policy.preference).toBe('public');
    expect(policy.forceChangeOnExactSingleShielded).toBe(true);
  });

  it('fee-only HTR follows R2', () => {
    const { policy } = computeTokenPolicy(undefined, true, null);
    expect(policy.preference).toBe('public');
    expect(policy.forceChangeOnExactSingleShielded).toBe(true);
  });

  it("the 'transparent' override disables exact-match forcing", () => {
    const { policy } = computeTokenPolicy(profile(0, 2), true, 'transparent');
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
  const profile = (shieldedOutputCount: number, publicOutputCount: number, hasFS = false) => ({
    token: '00',
    shieldedOutputCount,
    publicOutputCount,
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
        override: 'transparent',
      })
    ).toBe('transparent');
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

  it('R2: no shielded input, public outputs → transparent change', () => {
    expect(decideChangeMode({ profile: profile(0, 2), report: report(0), override: null })).toBe(
      'transparent'
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
      'transparent'
    );
  });

  it('fee-only HTR: shielded input shields the change mirroring inputs', () => {
    expect(decideChangeMode({ profile: undefined, report: report(0), override: null })).toBe(
      'transparent'
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
        {}, // data output → public HTR
      ],
      storage
    );

    const p01 = profiles.get('01')!;
    expect(p01.shieldedOutputCount).toBe(2);
    expect(p01.publicOutputCount).toBe(1);
    expect(p01.hasFullyShieldedOutput).toBe(true);
    expect(p01.allShieldedOutputsMine).toBe(false);

    const htr = profiles.get('00')!;
    expect(htr.shieldedOutputCount).toBe(0);
    expect(htr.publicOutputCount).toBe(2);
  });
});
