/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MAX_INPUTS, NATIVE_TOKEN_UID } from '../constants';
import { IStorage, IUtxo, OutputValueType, UtxoSelectionAlgorithm } from '../types';
import { ChangeOutputMode, OutputKind, ShieldedOutputMode } from '../shielded/types';
import { bestUtxoSelection } from './utxo';

/**
 * Automatic selection rules for confidential transactions.
 *
 * The wallet analyzes each token's outputs and decides, per token:
 *   - which UTXO pool the inputs come from (shielded-preferred vs
 *     transparent-preferred, with the other pool as a fallback);
 *   - whether a shielded input must be force-included;
 *   - whether the change output is shielded, and in which mode.
 *
 * The rules, per token T:
 *   - All T outputs shielded: prefer shielded inputs; change shielded, mode =
 *     most private among T's shielded outputs.
 *   - All T outputs transparent: prefer transparent inputs; shielded only when
 *     transparent funds are insufficient. Any shielded input used makes the
 *     change shielded, mode mirroring the inputs. An exact match spent from
 *     exactly ONE shielded input forces a change (an extra input is added) so
 *     the input's value is not revealed by subtraction.
 *   - Mixed: one shielded output forces at least one shielded input; when the
 *     wallet has none, the change is shielded instead so the output's amount
 *     cannot be computed by subtraction. Two or more shielded outputs force
 *     one only when some of them leave the wallet, and stay as they are when
 *     the wallet has none. Change is shielded iff a shielded input was used,
 *     all T outputs are shielded, or it stands in for the missing shielded
 *     input.
 *   - HTR entering only to pay fees behaves like the all-transparent case.
 *
 * A change standing in for a missing shielded input is shielded only where it
 * can be: it stays transparent when the tx has no room for another shielded
 * output, the caller gave a legacy change address, the wallet has no shielded
 * address to receive it (a multisig wallet never does), or (HTR) it cannot pay
 * its own fee and no more HTR can be added to it.
 *
 * Whatever the rules decide, a transaction never ends with exactly one shielded
 * output: the structural pass in SendTransaction adds a second one, splitting
 * the output in two or shielding an HTR change as the second one.
 *
 * An explicit `changeShieldedMode` always wins over the change-mode rules:
 * `OutputKind.TRANSPARENT` keeps every change transparent, AS/FS forces that
 * mode.
 */

/** Which UTXO pool a token's selection draws from first. */
export type InputPreference = OutputKind;

/** Per-token digest of the caller's outputs. */
export interface ITokenOutputProfile {
  token: string;
  /** Outputs carrying a shielded mode. */
  shieldedOutputCount: number;
  /** Transparent outputs, including data outputs (transparent HTR). */
  transparentOutputCount: number;
  /** Any FULLY_SHIELDED among the token's shielded outputs. */
  hasFullyShieldedOutput: boolean;
  /** All of the token's shielded outputs pay addresses this wallet owns. */
  allShieldedOutputsMine: boolean;
}

/** What the selection must do for one token. */
export interface ITokenSelectionPolicy {
  preference: InputPreference;
  /** Pre-include the smallest shielded UTXO even when transparent funds suffice. */
  forceShieldedInput: boolean;
  /**
   * On an exact match spent from exactly one shielded input, add the smallest
   * other shielded UTXO to force a change output.
   */
  forceChangeOnExactSingleShielded: boolean;
}

/** What the selection actually did — feeds the change-mode decision. */
export interface ISelectionReport {
  shieldedInputCount: number;
  /** Any spent shielded UTXO was fully shielded (has an asset blinding factor). */
  anyFullyShieldedInput: boolean;
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
        transparentOutputCount: 0,
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
      profile.transparentOutputCount += 1;
    }
  }
  return profiles;
}

/** Whether a token's policy needs the shielded-pool availability probe. */
export function needsAvailabilityProbe(profile: ITokenOutputProfile | undefined): boolean {
  if (!profile || profile.shieldedOutputCount === 0 || profile.transparentOutputCount === 0) {
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
 * Compute the selection policy for one token, and whether its change must be
 * shielded because the wallet cannot supply the shielded input the rules want
 * for its lone shielded output.
 *
 * `profile === undefined` means the token appears in no output — HTR entering
 * only to pay fees — which follows the all-transparent-outputs rule.
 */
export function computeTokenPolicy(
  profile: ITokenOutputProfile | undefined,
  hasShieldedUtxoForToken: boolean,
  override: ChangeOutputMode | null
): { policy: ITokenSelectionPolicy; shieldChange: boolean } {
  // The exact-match forcing exists solely to create a change output for the
  // shielded value to hide in; when the caller pinned the change transparent
  // the forced input would buy nothing.
  const allowExactForcing = override !== OutputKind.TRANSPARENT;

  if (!profile || profile.shieldedOutputCount === 0) {
    // Fee-only HTR, or all outputs transparent.
    return {
      policy: {
        preference: OutputKind.TRANSPARENT,
        forceShieldedInput: false,
        forceChangeOnExactSingleShielded: allowExactForcing,
      },
      shieldChange: false,
    };
  }

  if (profile.transparentOutputCount === 0) {
    // All outputs shielded: draw from the shielded pool first. A lone output
    // with an exact match is resolved by the structural split, not by forcing.
    return {
      policy: {
        preference: OutputKind.SHIELDED,
        forceShieldedInput: false,
        forceChangeOnExactSingleShielded: false,
      },
      shieldChange: false,
    };
  }

  // Mixed outputs.
  const wantsShieldedInput = profile.shieldedOutputCount === 1 || !profile.allShieldedOutputsMine;
  if (!wantsShieldedInput) {
    return {
      policy: {
        preference: OutputKind.TRANSPARENT,
        forceShieldedInput: false,
        forceChangeOnExactSingleShielded: false,
      },
      shieldChange: false,
    };
  }
  if (hasShieldedUtxoForToken) {
    return {
      policy: {
        preference: OutputKind.TRANSPARENT,
        forceShieldedInput: true,
        forceChangeOnExactSingleShielded: false,
      },
      shieldChange: false,
    };
  }
  // The rules want a shielded input the wallet does not have. For a lone
  // shielded output the change is shielded instead: with only transparent
  // inputs, a transparent change would publish the output's amount by
  // subtraction. Two or more shielded outputs are left as they are; their
  // total is public either way.
  return {
    policy: {
      preference: OutputKind.TRANSPARENT,
      forceShieldedInput: false,
      forceChangeOnExactSingleShielded: false,
    },
    shieldChange: profile.shieldedOutputCount === 1,
  };
}

/**
 * Decide the change-output mode for one token.
 *
 * `report` is what selection did (or, for user-supplied inputs, a summary of
 * them); `null` means no inputs of the token were spent at all. `shieldChange`
 * is the policy's request to shield the change in place of a shielded input
 * the wallet does not have.
 */
export function decideChangeMode(args: {
  profile: ITokenOutputProfile | undefined;
  report: ISelectionReport | null;
  override: ChangeOutputMode | null;
  shieldChange?: boolean;
}): ChangeOutputMode {
  const { profile, report, override, shieldChange = false } = args;
  if (override !== null && override !== undefined) {
    return override;
  }

  const allOutputsShielded =
    profile !== undefined &&
    profile.transparentOutputCount === 0 &&
    profile.shieldedOutputCount > 0;
  const shieldedInputUsed = (report?.shieldedInputCount ?? 0) > 0;

  if (!allOutputsShielded && !shieldedInputUsed && !shieldChange) {
    return OutputKind.TRANSPARENT;
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
 *      (sweeping the preferred pool first, largest-first, as far as the
 *      input limit allows, and dropping its smallest UTXOs again when the
 *      top-up needs the room);
 *   4. on an exact match spent from exactly one shielded input, add the
 *      smallest other shielded UTXO so a change output exists — when there is
 *      none, proceed unforced (spending the last shielded UTXO would otherwise
 *      be impossible).
 *
 * The result either covers `amount` or, when even the top-up falls short, is
 * empty, which the caller reports as insufficient funds (the same contract as
 * `bestUtxoSelection`). `maxInputs` is the room this selection has in the
 * transaction's input limit; the sweep and the top-up stay within it.
 */
export async function shieldedAwareSelection(
  storage: IStorage,
  token: string,
  amount: OutputValueType,
  policy: ITokenSelectionPolicy,
  onReport?: (report: ISelectionReport) => void,
  maxInputs: number = MAX_INPUTS
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

  // The policy requires a shielded input: take the smallest one first.
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

  // Unless the forced input already covers it, take the rest from the preferred
  // pool alone when it can.
  if (sum < amount) {
    const preferShielded = policy.preference === OutputKind.SHIELDED;
    const primary = await bestUtxoSelection(storage, token, amount - sum, {
      shielded: preferShielded,
      filter_method: notPicked,
    });
    if (primary.utxos.length > 0) {
      primary.utxos.forEach(add);
    } else {
      // Preferred pool is insufficient on its own: sweep it (largest-first) and
      // top up from the other pool, leaving room within the input limit for
      // the top-up and, when the policy may force one, a change-forcing UTXO.
      const sweepLimit = maxInputs - (policy.forceChangeOnExactSingleShielded ? 2 : 1);
      const sweepStart = picked.length;
      for await (const utxo of storage.selectUtxos({
        token,
        authorities: 0n,
        only_available_utxos: true,
        order_by_value: 'desc',
        shielded: preferShielded,
        filter_method: notPicked,
      })) {
        if (picked.length >= sweepLimit) {
          break;
        }
        add(utxo);
      }
      const sweepEnd = picked.length;
      if (sum < amount) {
        const secondary = await bestUtxoSelection(storage, token, amount - sum, {
          shielded: !preferShielded,
          filter_method: notPicked,
        });
        // Both pools together fall short: return an empty selection, as
        // bestUtxoSelection does, with the total that was available.
        if (secondary.utxos.length === 0) {
          return {
            utxos: [],
            amount: 0n,
            available: sum + (secondary.available ?? 0n),
          };
        }
        secondary.utxos.forEach(add);
        // A top-up of several UTXOs can still exceed the input limit: drop the
        // smallest swept UTXOs while the rest still covers the amount.
        const inputLimit = maxInputs - (policy.forceChangeOnExactSingleShielded ? 1 : 0);
        for (let cut = sweepEnd; picked.length > inputLimit && cut > sweepStart; cut -= 1) {
          const dropped = picked[cut - 1];
          if (sum - dropped.value < amount) {
            break;
          }
          picked.splice(cut - 1, 1);
          pickedIds.delete(`${dropped.txId}:${dropped.index}`);
          sum -= dropped.value;
        }
      }
    }
  }

  // An exact match spent from a single shielded input would reveal its value
  // by subtraction, so one more shielded UTXO is added for a change output to
  // hide it.
  if (policy.forceChangeOnExactSingleShielded && sum === amount) {
    const shieldedCount = picked.filter(utxo => utxo.shielded).length;
    if (shieldedCount === 1) {
      // The change will equal the extra UTXO's value, so only a shielded one
      // keeps it hidden.
      for await (const utxo of storage.selectUtxos({
        token,
        authorities: 0n,
        only_available_utxos: true,
        order_by_value: 'asc',
        shielded: true,
        filter_method: notPicked,
        max_utxos: 1,
      })) {
        add(utxo);
      }
      // No other shielded UTXO: proceed unforced — there is nothing left to
      // hide the value behind.
    }
  }

  if (onReport) {
    onReport({
      shieldedInputCount: picked.filter(utxo => utxo.shielded).length,
      anyFullyShieldedInput: picked.some(
        utxo => utxo.shielded && utxo.assetBlindingFactor !== undefined
      ),
    });
  }

  return { utxos: picked, amount: sum };
}

/**
 * Close a policy over the standard `UtxoSelectionAlgorithm` signature so the
 * existing selection plumbing can run it unchanged.
 *
 * The selection first leaves `room` of its `maxInputs` free for inputs that
 * may follow it; when the amount cannot be covered that way, it uses all of
 * them, and the transaction's own input check decides whether what follows
 * still fits.
 */
export function makeShieldedAwareSelection(
  policy: ITokenSelectionPolicy,
  onReport?: (report: ISelectionReport) => void,
  maxInputs: number = MAX_INPUTS,
  room: number = 0
): UtxoSelectionAlgorithm {
  return async (storage, token, amount) => {
    if (room > 0) {
      const leavingRoom = await shieldedAwareSelection(
        storage,
        token,
        amount,
        policy,
        onReport,
        maxInputs - room
      );
      if (leavingRoom.amount >= amount) {
        return leavingRoom;
      }
    }
    return shieldedAwareSelection(storage, token, amount, policy, onReport, maxInputs);
  };
}
