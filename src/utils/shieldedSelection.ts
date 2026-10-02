/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NATIVE_TOKEN_UID } from '../constants';
import { IStorage, IUtxo, OutputValueType, UtxoSelectionAlgorithm } from '../types';
import { ChangeOutputMode, ShieldedOutputMode } from '../shielded/types';
import { bestUtxoSelection } from './utxo';

/**
 * Automatic selection rules for confidential transactions.
 *
 * The wallet analyzes each token's outputs and decides, per token:
 *   - which UTXO pool the inputs come from (shielded-preferred vs
 *     public-preferred, with the other pool as a fallback);
 *   - whether a shielded input must be force-included;
 *   - whether the change output is shielded, and in which mode.
 *
 * The rules, per token T:
 *   - All T outputs shielded: prefer shielded inputs; change shielded, mode =
 *     most private among T's shielded outputs.
 *   - All T outputs public: prefer public inputs; shielded only when public is
 *     insufficient. Any shielded input used makes the change shielded, mode
 *     mirroring the inputs. An exact match spent from exactly ONE shielded
 *     input forces a change (an extra input is added) so the input's value is
 *     not revealed by subtraction.
 *   - Mixed: one shielded output forces at least one shielded input (splitting
 *     the output in two when the wallet has none); two or more shielded
 *     outputs force one only when some of them leave the wallet. Change is
 *     shielded iff a shielded input was used or all T outputs are shielded.
 *   - HTR entering only to pay fees behaves like the all-public case.
 *
 * An explicit `changeShieldedMode` always wins over the change-mode rules:
 * 'transparent' keeps every change public, AS/FS forces that mode.
 */

/** Which UTXO pool a token's selection draws from first. */
export type InputPreference = 'shielded' | 'public';

/** Per-token digest of the caller's outputs. */
export interface ITokenOutputProfile {
  token: string;
  /** Outputs carrying a shielded mode. */
  shieldedOutputCount: number;
  /** Transparent outputs, including data outputs (public HTR). */
  publicOutputCount: number;
  /** Any FULLY_SHIELDED among the token's shielded outputs. */
  hasFullyShieldedOutput: boolean;
  /** All of the token's shielded outputs pay addresses this wallet owns. */
  allShieldedOutputsMine: boolean;
}

/** What the selection must do for one token. */
export interface ITokenSelectionPolicy {
  preference: InputPreference;
  /** Pre-include the smallest shielded UTXO even when public funds suffice. */
  forceShieldedInput: boolean;
  /**
   * On an exact match spent from exactly one shielded input, add the smallest
   * extra UTXO (either pool) to force a change output.
   */
  forceChangeOnExactSingleShielded: boolean;
}

/** How a lone-shielded-output situation is resolved when no shielded input exists. */
export type SplitFallback = 'none' | 'splitOne' | 'splitLargest';

/** What the selection actually did — feeds the change-mode decision. */
export interface ISelectionReport {
  shieldedInputCount: number;
  /** Any spent shielded UTXO was fully shielded (has an asset blinding factor). */
  anyFullyShieldedInput: boolean;
  /** Selected sum equals the target exactly (no change). */
  exactMatch: boolean;
}

/** The minimal output shape the profile builder needs. */
export interface IProfileOutput {
  /** Absent means HTR (data outputs and default-token outputs). */
  token?: string;
  /** The destination address; absent for data outputs. */
  address?: string;
  /** Present only on shielded outputs. */
  shieldedMode?: ShieldedOutputMode;
}

/**
 * Build the per-token output profiles for a send.
 *
 * Ownership of shielded destinations is checked against storage so the
 * mixed-outputs rule can distinguish "shielding my own funds" from paying an
 * external shielded recipient.
 */
export async function buildTokenOutputProfiles(
  outputs: IProfileOutput[],
  storage: Pick<IStorage, 'isAddressMine'>
): Promise<Map<string, ITokenOutputProfile>> {
  const profiles = new Map<string, ITokenOutputProfile>();
  for (const output of outputs) {
    const token = output.token || NATIVE_TOKEN_UID;
    let profile = profiles.get(token);
    if (!profile) {
      profile = {
        token,
        shieldedOutputCount: 0,
        publicOutputCount: 0,
        hasFullyShieldedOutput: false,
        allShieldedOutputsMine: true,
      };
      profiles.set(token, profile);
    }
    if (output.shieldedMode !== undefined) {
      profile.shieldedOutputCount += 1;
      if (output.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED) {
        profile.hasFullyShieldedOutput = true;
      }
      if (
        profile.allShieldedOutputsMine &&
        // eslint-disable-next-line no-await-in-loop -- sequential ownership checks
        !(output.address !== undefined && (await storage.isAddressMine(output.address)))
      ) {
        profile.allShieldedOutputsMine = false;
      }
    } else {
      profile.publicOutputCount += 1;
    }
  }
  return profiles;
}

/** Whether a token's policy needs the shielded-pool availability probe. */
export function needsAvailabilityProbe(profile: ITokenOutputProfile | undefined): boolean {
  if (!profile || profile.shieldedOutputCount === 0 || profile.publicOutputCount === 0) {
    // Not the mixed case: no forcing, so availability is irrelevant.
    return false;
  }
  if (profile.shieldedOutputCount === 1) {
    return true;
  }
  return !profile.allShieldedOutputsMine;
}

/**
 * Probe whether the wallet holds at least one spendable shielded UTXO of a
 * token.
 */
export async function hasShieldedUtxo(
  storage: Pick<IStorage, 'selectUtxos'>,
  token: string
): Promise<boolean> {
  // eslint-disable-next-line no-unreachable-loop -- one yielded UTXO is the answer
  for await (const _utxo of storage.selectUtxos({
    token,
    authorities: 0n,
    only_available_utxos: true,
    shielded: true,
    max_utxos: 1,
  })) {
    return true;
  }
  return false;
}

/**
 * Compute the selection policy for one token, and whether a lone shielded
 * output must be resolved by splitting because the wallet cannot supply the
 * shielded input the rules require.
 *
 * `profile === undefined` means the token appears in no output — HTR entering
 * only to pay fees — which follows the all-public-outputs rule.
 */
export function computeTokenPolicy(
  profile: ITokenOutputProfile | undefined,
  hasShieldedUtxoForToken: boolean,
  override: ChangeOutputMode | null
): { policy: ITokenSelectionPolicy; needsSplitFallback: SplitFallback } {
  // The exact-match forcing exists solely to create a change output for the
  // shielded value to hide in; when the caller pinned the change transparent
  // the forced input would buy nothing.
  const allowExactForcing = override !== 'transparent';

  if (!profile || profile.shieldedOutputCount === 0) {
    // Fee-only HTR, or all outputs public.
    return {
      policy: {
        preference: 'public',
        forceShieldedInput: false,
        forceChangeOnExactSingleShielded: allowExactForcing,
      },
      needsSplitFallback: 'none',
    };
  }

  if (profile.publicOutputCount === 0) {
    // All outputs shielded: draw from the shielded pool first. A lone output
    // with an exact match is resolved by the structural split, not by forcing.
    return {
      policy: {
        preference: 'shielded',
        forceShieldedInput: false,
        forceChangeOnExactSingleShielded: false,
      },
      needsSplitFallback: 'none',
    };
  }

  // Mixed outputs.
  const wantsShieldedInput = profile.shieldedOutputCount === 1 || !profile.allShieldedOutputsMine;
  if (!wantsShieldedInput) {
    return {
      policy: {
        preference: 'public',
        forceShieldedInput: false,
        forceChangeOnExactSingleShielded: false,
      },
      needsSplitFallback: 'none',
    };
  }
  if (hasShieldedUtxoForToken) {
    return {
      policy: {
        preference: 'public',
        forceShieldedInput: true,
        forceChangeOnExactSingleShielded: false,
      },
      needsSplitFallback: 'none',
    };
  }
  // The rules require a shielded input the wallet does not have: fall back to
  // splitting a shielded output so no single input↔output mapping is revealed.
  return {
    policy: {
      preference: 'public',
      forceShieldedInput: false,
      forceChangeOnExactSingleShielded: false,
    },
    needsSplitFallback: profile.shieldedOutputCount === 1 ? 'splitOne' : 'splitLargest',
  };
}

/**
 * Decide the change-output mode for one token.
 *
 * `report` is what selection did (or, for user-supplied inputs, a summary of
 * them); `null` means no inputs of the token were spent at all.
 */
export function decideChangeMode(args: {
  profile: ITokenOutputProfile | undefined;
  report: ISelectionReport | null;
  override: ChangeOutputMode | null;
}): ChangeOutputMode {
  const { profile, report, override } = args;
  if (override !== null && override !== undefined) {
    return override;
  }

  const allOutputsShielded =
    profile !== undefined && profile.publicOutputCount === 0 && profile.shieldedOutputCount > 0;
  const shieldedInputUsed = (report?.shieldedInputCount ?? 0) > 0;

  if (!allOutputsShielded && !shieldedInputUsed) {
    return 'transparent';
  }

  // Mode mirrors the outputs first, then the inputs: the most private mode
  // present wins in each case.
  if (profile !== undefined && profile.shieldedOutputCount > 0) {
    return profile.hasFullyShieldedOutput
      ? ShieldedOutputMode.FULLY_SHIELDED
      : ShieldedOutputMode.AMOUNT_SHIELDED;
  }
  return report?.anyFullyShieldedInput
    ? ShieldedOutputMode.FULLY_SHIELDED
    : ShieldedOutputMode.AMOUNT_SHIELDED;
}

/**
 * Pool-aware UTXO selection implementing a token's policy.
 *
 * Composition of `bestUtxoSelection` per pool:
 *   1. force-include the smallest shielded UTXO when the policy demands one;
 *   2. select from the preferred pool;
 *   3. top up from the other pool when the preferred one is insufficient
 *      (taking the whole preferred pool first, largest-first);
 *   4. on an exact match spent from exactly one shielded input, add the
 *      smallest extra UTXO from either pool so a change output exists — when
 *      the wallet holds nothing else, proceed unforced (spending the whole
 *      balance would otherwise be impossible).
 */
export async function shieldedAwareSelection(
  storage: IStorage,
  token: string,
  amount: OutputValueType,
  policy: ITokenSelectionPolicy,
  onReport?: (report: ISelectionReport) => void
): Promise<{ utxos: IUtxo[]; amount: OutputValueType; available?: OutputValueType }> {
  const picked: IUtxo[] = [];
  const pickedIds = new Set<string>();
  let sum = 0n;
  const add = (utxo: IUtxo): void => {
    picked.push(utxo);
    pickedIds.add(`${utxo.txId}:${utxo.index}`);
    sum += utxo.value;
  };
  const notPicked = (utxo: IUtxo): boolean => !pickedIds.has(`${utxo.txId}:${utxo.index}`);

  if (policy.forceShieldedInput) {
    for await (const utxo of storage.selectUtxos({
      token,
      authorities: 0n,
      only_available_utxos: true,
      order_by_value: 'asc',
      shielded: true,
      max_utxos: 1,
    })) {
      add(utxo);
    }
  }

  if (sum < amount) {
    const preferShielded = policy.preference === 'shielded';
    const primary = await bestUtxoSelection(storage, token, amount - sum, {
      shielded: preferShielded,
      filter_method: notPicked,
    });
    if (primary.utxos.length > 0) {
      primary.utxos.forEach(add);
    } else {
      // Preferred pool is insufficient on its own: consume it entirely
      // (largest-first) and top up from the other pool.
      for await (const utxo of storage.selectUtxos({
        token,
        authorities: 0n,
        only_available_utxos: true,
        order_by_value: 'desc',
        shielded: preferShielded,
        filter_method: notPicked,
      })) {
        add(utxo);
      }
      if (sum < amount) {
        const secondary = await bestUtxoSelection(storage, token, amount - sum, {
          shielded: !preferShielded,
          filter_method: notPicked,
        });
        if (secondary.utxos.length === 0) {
          return {
            utxos: [],
            amount: 0n,
            available: sum + (secondary.available ?? 0n),
          };
        }
        secondary.utxos.forEach(add);
      }
    }
  }

  if (policy.forceChangeOnExactSingleShielded && sum === amount) {
    const shieldedCount = picked.filter(utxo => utxo.shielded).length;
    if (shieldedCount === 1) {
      for await (const utxo of storage.selectUtxos({
        token,
        authorities: 0n,
        only_available_utxos: true,
        order_by_value: 'asc',
        filter_method: notPicked,
        max_utxos: 1,
      })) {
        add(utxo);
      }
      // No extra UTXO anywhere: proceed unforced — the whole balance is being
      // spent and there is nothing to hide it behind.
    }
  }

  if (onReport) {
    onReport({
      shieldedInputCount: picked.filter(utxo => utxo.shielded).length,
      anyFullyShieldedInput: picked.some(
        utxo => utxo.shielded && utxo.assetBlindingFactor !== undefined
      ),
      exactMatch: sum === amount,
    });
  }

  return { utxos: picked, amount: sum };
}

/**
 * Close a policy over the standard `UtxoSelectionAlgorithm` signature so the
 * existing selection plumbing can run it unchanged.
 */
export function makeShieldedAwareSelection(
  policy: ITokenSelectionPolicy,
  onReport?: (report: ISelectionReport) => void
): UtxoSelectionAlgorithm {
  return (storage, token, amount) =>
    shieldedAwareSelection(storage, token, amount, policy, onReport);
}
