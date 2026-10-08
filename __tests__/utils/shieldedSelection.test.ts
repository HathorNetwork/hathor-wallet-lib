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
  makeShieldedAwareSelection,
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

// A timelock this far ahead keeps a UTXO unavailable to every selection pass.
const LOCKED_UNTIL = 4102444800; // 2100-01-01

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

  it('a top-up of several UTXOs still stays within the input limit', async () => {
    // 253 transparent 1n UTXOs cannot pay 500n, and no single shielded UTXO
    // covers the other 247n: the top-up takes all three 100n.
    const store = new MemoryStore();
    for (let i = 0; i < 253; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    for (const id of ['sh-a', 'sh-b', 'sh-c']) {
      await store.saveUtxo(utxo({ txId: id, value: 100n, shielded: true, blindingFactor: 'bf' }));
    }
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', 500n, {
      ...transparentPolicy,
      forceChangeOnExactSingleShielded: true,
    });

    // The two smallest swept UTXOs are dropped again, leaving room for a
    // change-forcing UTXO: 251 transparent + 3 shielded = 551n.
    const picked = result.utxos.map(u => u.txId);
    expect(picked).toEqual(expect.arrayContaining(['sh-a', 'sh-b', 'sh-c']));
    expect(result.utxos).toHaveLength(MAX_INPUTS - 1);
    expect(result.amount).toBe(551n);
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

  it('a preferred pool that covers only with more inputs than fit is swept and topped up', async () => {
    // The 300 transparent 1n UTXOs pay 280n on their own, but only with 280
    // inputs.
    const store = new MemoryStore();
    for (let i = 0; i < 300; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    await store.saveUtxo(
      utxo({ txId: 'sh-1000', value: 1000n, shielded: true, blindingFactor: 'bf' })
    );
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', 280n, {
      ...transparentPolicy,
      forceChangeOnExactSingleShielded: true,
    });

    // So the pool is swept as when it cannot pay, leaving room for the top-up
    // and a change-forcing UTXO: 253 transparent UTXOs, then the shielded
    // 1000n.
    expect(result.utxos.map(u => u.txId)).toContain('sh-1000');
    expect(result.utxos).toHaveLength(MAX_INPUTS - 1);
    expect(result.amount).toBe(1253n);
  });

  it('the forced shielded input counts against the input limit', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 300; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    await store.saveUtxo(utxo({ txId: 'sh-5', value: 5n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(
      utxo({ txId: 'sh-1000', value: 1000n, shielded: true, blindingFactor: 'bf' })
    );
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', 280n, {
      ...transparentPolicy,
      forceShieldedInput: true,
    });

    // The forced 5n leaves 275n, which the transparent pool pays only with 275
    // inputs: 276 with the forced one. The sweep instead stops at 253, leaving
    // the last input for the shielded 1000n.
    const picked = result.utxos.map(u => u.txId);
    expect(picked).toEqual(expect.arrayContaining(['sh-5', 'sh-1000']));
    expect(result.utxos).toHaveLength(MAX_INPUTS);
    expect(result.amount).toBe(1258n);
  });

  it('a preferred-pool cover that fills the input limit exactly is taken', async () => {
    // A cover with no shielded input can never need a change-forcing UTXO, so
    // no input is kept free for one.
    const store = new MemoryStore();
    for (let i = 0; i < MAX_INPUTS; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    await store.saveUtxo(
      utxo({ txId: 'sh-1000', value: 1000n, shielded: true, blindingFactor: 'bf' })
    );
    const storage = new Storage(store);

    const result = await shieldedAwareSelection(storage, '00', BigInt(MAX_INPUTS), {
      ...transparentPolicy,
      forceChangeOnExactSingleShielded: true,
    });

    expect(result.utxos).toHaveLength(MAX_INPUTS);
    expect(result.utxos.every(u => !u.shielded)).toBe(true);
  });

  it('a preferred-pool cover keeps an input free for the change-forcing UTXO it needs', async () => {
    const store = new MemoryStore();
    await store.saveUtxo(utxo({ txId: 'sh-10', value: 10n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(utxo({ txId: 'sh-3', value: 3n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(utxo({ txId: 'pub-20', value: 20n }));
    const storage = new Storage(store);

    // The shielded 10n matches exactly and would take the 3n with it: two
    // inputs where one is left, so the transparent 20n pays instead.
    const result = await shieldedAwareSelection(
      storage,
      '00',
      10n,
      { ...shieldedPolicy, forceChangeOnExactSingleShielded: true },
      undefined,
      1
    );
    expect(ids(result)).toEqual(['pub-20']);
  });

  it('leaves room for inputs that may follow, unless covering the amount needs it', async () => {
    // Eight transparent 1n UTXOs cannot pay on their own, so the selection
    // sweeps them and tops up with the shielded 5n, within 8 inputs of which
    // it tries to leave 2 free.
    const store = new MemoryStore();
    for (let i = 0; i < 8; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    await store.saveUtxo(utxo({ txId: 'sh-5', value: 5n, shielded: true, blindingFactor: 'bf' }));
    const storage = new Storage(store);
    const select = makeShieldedAwareSelection(transparentPolicy, undefined, 8, 2);

    // 10n fits in 6 inputs: 5 swept + the shielded 5n, leaving 2 free.
    const leavingRoom = await select(storage, '00', 10n);
    expect(leavingRoom.utxos).toHaveLength(6);
    expect(leavingRoom.amount).toBe(10n);

    // 12n does not fit in 6 (at most 5 + 5n), so all 8 are used: 7 + 5n.
    const usingAll = await select(storage, '00', 12n);
    expect(usingAll.utxos).toHaveLength(8);
    expect(usingAll.amount).toBe(12n);
  });

  it('uses the room it would leave before drawing from the other pool', async () => {
    const store = new MemoryStore();
    await store.saveUtxo(utxo({ txId: 'pub-10', value: 10n }));
    await store.saveUtxo(utxo({ txId: 'sh-20', value: 20n, shielded: true, blindingFactor: 'bf' }));
    const storage = new Storage(store);
    // One input left, which the selection tries to leave free.
    const select = makeShieldedAwareSelection(transparentPolicy, undefined, 1, 1);

    const result = await select(storage, '00', 5n);
    expect(ids(result)).toEqual(['pub-10']);
  });

  it('when no selection under the rules fits, UTXOs from both pools are taken largest-first', async () => {
    // 300 transparent 1n and 30 shielded 2n. Sweeping the 1n and topping up
    // with the 2n pays 280n with 266 inputs; largest-first over both pools pays
    // it with 250: the 30 shielded 2n and 220 transparent 1n.
    const store = new MemoryStore();
    for (let i = 0; i < 300; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    for (let i = 0; i < 30; i += 1) {
      await store.saveUtxo(
        utxo({ txId: `sh-2-${i}`, value: 2n, shielded: true, blindingFactor: 'bf' })
      );
    }
    const storage = new Storage(store);
    let report: ISelectionReport | undefined;
    const select = makeShieldedAwareSelection(
      { ...transparentPolicy, forceChangeOnExactSingleShielded: true },
      r => {
        report = r;
      },
      MAX_INPUTS,
      1
    );

    const result = await select(storage, '00', 280n);
    expect(result.utxos).toHaveLength(250);
    expect(result.utxos.filter(u => u.shielded)).toHaveLength(30);
    expect(result.amount).toBe(280n);
    // Its shielded inputs are reported, so the change mode mirrors them.
    expect(report!.shieldedInputCount).toBe(30);
  });

  it('when no selection fits, the UTXOs that cover the amount are returned past the limit', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 300; i += 1) {
      await store.saveUtxo(utxo({ txId: `dust-${i}`, value: 1n }));
    }
    await store.saveUtxo(utxo({ txId: 'sh-60', value: 60n, shielded: true, blindingFactor: 'bf' }));
    const storage = new Storage(store);
    const select = makeShieldedAwareSelection(
      { ...transparentPolicy, forceChangeOnExactSingleShielded: true },
      undefined,
      MAX_INPUTS,
      1
    );

    // The wallet holds enough, so the selection covers the amount and the
    // transaction's input check reports the inputs it needs instead of a
    // shortage of funds: 350n takes the shielded 60n and 290 of the 1n, the
    // 291 inputs that pay it with the fewest.
    const covered = await select(storage, '00', 350n);
    expect(covered.utxos.map(u => u.txId)).toContain('sh-60');
    expect(covered.utxos).toHaveLength(291);
    expect(covered.amount).toBe(350n);

    // 400n is more than the wallet holds: everything it holds is reported.
    const short = await select(storage, '00', 400n);
    expect(short.utxos).toEqual([]);
    expect(short.available).toBe(360n);
  });

  it('taken largest-first from both pools, an exact single-shielded match still takes the change-forcing UTXO', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 10; i += 1) {
      await store.saveUtxo(utxo({ txId: `pub-2-${i}`, value: 2n }));
    }
    await store.saveUtxo(utxo({ txId: 'sh-9', value: 9n, shielded: true, blindingFactor: 'bf' }));
    for (let i = 0; i < 3; i += 1) {
      await store.saveUtxo(
        utxo({ txId: `sh-1-${i}`, value: 1n, shielded: true, blindingFactor: 'bf' })
      );
    }
    const storage = new Storage(store);
    const select = makeShieldedAwareSelection(
      { ...transparentPolicy, forceChangeOnExactSingleShielded: true },
      undefined,
      2
    );

    // No selection under the rules fits 2 inputs. The shielded 9n and a
    // transparent 2n match 11n exactly with a single shielded input, so a
    // shielded 1n is added for a change: 3 inputs, one past the limit, where
    // the transparent pool alone takes 6.
    const result = await select(storage, '00', 11n);
    const picked = result.utxos.map(u => u.txId);
    expect(picked).toContain('sh-9');
    expect(picked.filter(id => id.startsWith('pub-2-'))).toHaveLength(1);
    expect(picked.filter(id => id.startsWith('sh-1-'))).toHaveLength(1);
    expect(result.amount).toBe(12n);
  });

  it('when no selection under the rules fits, a forced shielded input is the largest one', async () => {
    const storage = await makeStorage();
    const policy = { ...transparentPolicy, forceShieldedInput: true };

    // The rules force the smallest shielded UTXO, 5n, after which 150n takes
    // two transparent inputs more: 3 where 2 fit. The largest, 80n, leaves
    // 70n, which the transparent 100n pays alone.
    const withTwoInputs = makeShieldedAwareSelection(policy, undefined, 2);
    expect(ids(await withTwoInputs(storage, '00', 150n))).toEqual(['pub-100', 'sh-80']);

    // With one input left, the transparent 100n alone would pay 90n, but the
    // forced input keeps its place: the 80n and the 10n, one past the limit.
    const withOneInput = makeShieldedAwareSelection(policy, undefined, 1);
    expect(ids(await withOneInput(storage, '00', 90n))).toEqual(['pub-10', 'sh-80']);
  });

  it('the forced shielded input is never a UTXO that is not available', async () => {
    const storage = await makeStorage([
      utxo({
        txId: 'sh-1-locked',
        value: 1n,
        shielded: true,
        blindingFactor: 'bf',
        timelock: LOCKED_UNTIL,
      }),
    ]);

    // The smallest available shielded UTXO is sh-5; transparent pays the rest.
    const result = await shieldedAwareSelection(storage, '00', 50n, {
      ...transparentPolicy,
      forceShieldedInput: true,
    });
    expect(ids(result)).toEqual(['pub-50', 'sh-5']);
  });

  it('the sweep never takes a UTXO that is not available', async () => {
    const store = new MemoryStore();
    await store.saveUtxo(utxo({ txId: 'dust-a', value: 1n }));
    await store.saveUtxo(utxo({ txId: 'dust-b', value: 1n }));
    await store.saveUtxo(utxo({ txId: 'dust-locked', value: 1n, timelock: LOCKED_UNTIL }));
    await store.saveUtxo(utxo({ txId: 'sh-20', value: 20n, shielded: true, blindingFactor: 'bf' }));
    const storage = new Storage(store);

    // The available 1n cannot pay 10n: they are swept, the shielded 20n tops up.
    const result = await shieldedAwareSelection(storage, '00', 10n, transparentPolicy);
    expect(ids(result)).toEqual(['dust-a', 'dust-b', 'sh-20']);
  });

  it('the change-forcing UTXO is never one that is not available', async () => {
    const store = new MemoryStore();
    await store.saveUtxo(utxo({ txId: 'sh-10', value: 10n, shielded: true, blindingFactor: 'bf' }));
    await store.saveUtxo(
      utxo({
        txId: 'sh-1-locked',
        value: 1n,
        shielded: true,
        blindingFactor: 'bf',
        timelock: LOCKED_UNTIL,
      })
    );
    await store.saveUtxo(utxo({ txId: 'sh-3', value: 3n, shielded: true, blindingFactor: 'bf' }));
    const storage = new Storage(store);

    // The 10n matches exactly, so the smallest available other shielded UTXO
    // is added for a change: sh-3, not the locked sh-1.
    const result = await shieldedAwareSelection(storage, '00', 10n, {
      ...shieldedPolicy,
      forceChangeOnExactSingleShielded: true,
    });
    expect(ids(result)).toEqual(['sh-10', 'sh-3']);
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

  it('does not count a shielded UTXO that is not available', async () => {
    const store = new MemoryStore();
    await store.saveUtxo(
      utxo({
        txId: 'sh-locked',
        value: 5n,
        shielded: true,
        blindingFactor: 'bf',
        timelock: LOCKED_UNTIL,
      })
    );

    expect(await hasShieldedUtxo(new Storage(store), '00')).toBe(false);
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
    const { policy, shieldChange } = computeTokenPolicy(profile(2, 0), true, null);
    expect(policy.preference).toBe(OutputKind.SHIELDED);
    expect(policy.forceShieldedInput).toBe(false);
    expect(shieldChange).toBe(false);
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
    const { policy, shieldChange } = computeTokenPolicy(profile(1, 1), true, null);
    expect(policy.forceShieldedInput).toBe(true);
    expect(shieldChange).toBe(false);
  });

  it('R3a: without a shielded UTXO the change is shielded instead', () => {
    const { policy, shieldChange } = computeTokenPolicy(profile(1, 1), false, null);
    expect(policy.forceShieldedInput).toBe(false);
    expect(shieldChange).toBe(true);
  });

  it('R3b: all-mine forces nothing', () => {
    const { policy, shieldChange } = computeTokenPolicy(profile(2, 1, true), false, null);
    expect(policy.forceShieldedInput).toBe(false);
    expect(shieldChange).toBe(false);
  });

  it('R3b: an external shielded output forces a shielded input', () => {
    const { policy } = computeTokenPolicy(profile(2, 1, false), true, null);
    expect(policy.forceShieldedInput).toBe(true);
  });

  it('R3b: external with no shielded UTXO splits nothing', () => {
    const { policy, shieldChange } = computeTokenPolicy(profile(2, 1, false), false, null);
    expect(policy.forceShieldedInput).toBe(false);
    expect(shieldChange).toBe(false);
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

  it('R3a: the shielded-change hint shields the change mirroring the outputs', () => {
    expect(
      decideChangeMode({
        profile: profile(1, 1),
        report: report(0),
        override: null,
        shieldChange: true,
      })
    ).toBe(AMOUNT_SHIELDED);
    expect(
      decideChangeMode({
        profile: profile(1, 1, true),
        report: report(0),
        override: null,
        shieldChange: true,
      })
    ).toBe(FULLY_SHIELDED);
  });

  it('R3a: an explicit transparent override wins over the shielded-change hint', () => {
    expect(
      decideChangeMode({
        profile: profile(1, 1),
        report: report(0),
        override: OutputKind.TRANSPARENT,
        shieldChange: true,
      })
    ).toBe(OutputKind.TRANSPARENT);
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
