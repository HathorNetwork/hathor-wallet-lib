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
 * A change standing in for a missing shielded input is always shielded, or the
 * send fails, in this order: the wallet has no shielded address to receive it
 * (a multisig wallet never does), the tx has no room for another shielded
 * output, (HTR) it cannot pay its own fee and no more HTR can be added to it,
 * or a legacy change address cannot receive it, as wherever these rules shield
 * the change. The error says why the change must be shielded, and how to keep
 * it transparent, except where that is known to fail too: the tx's only
 * shielded output holds 1 unit, which cannot be split, or, for an HTR change
 * that cannot pay its own fee, the HTR left would not pay the fee of splitting
 * that output either. An HTR change takes more HTR, smallest-first, until it
 * pays its own fee, and when the HTR selection leaves no change, HTR is pulled
 * for one, whatever other shielded outputs the tx has; a send that then needs
 * more inputs than a tx holds fails on its input count. When the tx's only
 * shielded output is the HTR output whose change stands in, that output is
 * never split, which would publish its amount: the change is its second
 * shielded output.
 *
 * Shielded UTXOs are taken in the mode that keeps their token private. A token
 * is public in the transaction when any of its outputs is transparent or
 * amount-shielded, and HTR, which pays the fee, always is: its amount-shielded
 * UTXOs are taken before its fully shielded ones, as spending a fully shielded
 * UTXO there reveals the token it held. A token whose outputs are all fully
 * shielded is hidden, and its fully shielded UTXOs are taken first, as
 * spending an amount-shielded one reveals the token. Within a mode, UTXOs are
 * taken by value as `bestUtxoSelection` takes them; a mode that cannot pay the
 * amount alone is taken whole, and the other mode pays the rest. The forced
 * input and the change-forcing UTXO are the smallest of the mode taken first,
 * else of the other mode; the largest-first fallback forces the largest. Where
 * taking a mode first needs more inputs than a selection may take, shielded
 * UTXOs are taken by value alone, as they are by a sweep for the input limit,
 * and a send that needs more inputs than a transaction holds is built again
 * with every token's shielded UTXOs taken by value alone. The wallet selects
 * no UTXO of a token the caller supplies inputs of, and an explicit
 * `changeShieldedMode` does not change the order.
 *
 * When no selection under these rules fits the transaction's input limit, the
 * UTXOs that cover the amount are taken from both pools, largest-first, along
 * with the inputs the rules force; a shielded input among them still makes the
 * change shielded.
 *
 * Whatever the rules decide, a transaction never ends with exactly one shielded
 * output: the structural pass in SendTransaction adds a second one, splitting
 * the output in two or shielding an HTR change as the second one.
 *
 * An explicit `changeShieldedMode` always wins over the change-mode rules:
 * `OutputKind.TRANSPARENT` keeps every change transparent, AS/FS forces that
 * mode.
 *
 * What a send can still compute: a shielded output's amount is hidden, but the
 * total of a token's shielded outputs can be computed by subtraction when no
 * shielded input or shielded change of the token hides it. So a transaction
 * may publish the total a recipient's address receives, never each output's
 * amount. A custom token whose selection matches exactly has no change to
 * stand in, so its lone shielded output, split in two or whole beside other
 * shielded outputs, publishes its recipient's total. So does a lone shielded
 * output split because its change would only pay its own fee, with no HTR to
 * add, or because the pull for the split's fee lands exactly, and an explicit
 * shielded change mode can end the same way. Sums can also be computed: the
 * total of two or more shielded outputs of a token that nothing hides, of
 * several shielded inputs spent exactly, and of what a wallet moves into its
 * own shielded outputs. Unless the change is pinned transparent, a single
 * shielded UTXO's value is published only where the alternative is failing the
 * send: the last shielded UTXO of a token spent exactly, a fee-sized shielded
 * HTR UTXO spent exactly on the fee, and caller-supplied inputs, which are
 * never added to. A shielded HTR change made from transparent HTR alone,
 * beside no other shielded HTR output, has a public value and hides nothing
 * when spent later. The largest-first fallback over the input limit may pay a
 * token whose outputs are all shielded from transparent UTXOs alone.
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
  /** Any AMOUNT_SHIELDED among the token's shielded outputs. */
  hasAmountShieldedOutput: boolean;
  /** All of the token's shielded outputs pay addresses this wallet owns. */
  allShieldedOutputsMine: boolean;
}

/** What the selection must do for one token. */
export interface ITokenSelectionPolicy {
  preference: InputPreference;
  /**
   * Pre-include the smallest shielded UTXO of the mode taken first, else of
   * the other mode, even when transparent funds suffice.
   */
  forceShieldedInput: boolean;
  /**
   * On an exact match spent from exactly one shielded input, add the smallest
   * other shielded UTXO of the mode taken first, else of the other mode, to
   * force a change output.
   */
  forceChangeOnExactSingleShielded: boolean;
  /**
   * The mode whose shielded UTXOs are taken first, the other mode's only after
   * them: FULLY_SHIELDED for a token whose outputs are all fully shielded,
   * AMOUNT_SHIELDED for any other. Absent, shielded UTXOs are taken by value
   * alone, whatever their mode.
   */
  shieldedModeFirst?: ShieldedOutputMode;
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
        hasAmountShieldedOutput: false,
        allShieldedOutputsMine: true,
      };
      profiles.set(token, profile);
    }
    if (output.shieldedMode !== undefined) {
      profile.shieldedOutputCount += 1;
      if (output.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED) {
        profile.hasFullyShieldedOutput = true;
      } else if (output.shieldedMode === ShieldedOutputMode.AMOUNT_SHIELDED) {
        profile.hasAmountShieldedOutput = true;
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
 * shielded (see the header) because the wallet cannot supply the shielded
 * input the rules want for its lone shielded output. A custom token's
 * selection that leaves no change has none to shield; for an HTR output, HTR
 * is pulled to make the change.
 *
 * `profile === undefined` means the token appears in no output — HTR entering
 * only to pay fees — which follows the all-transparent-outputs rule.
 *
 * The policy also says which shielded mode is taken first: fully shielded for
 * a custom token whose outputs are all fully shielded, amount-shielded for any
 * other token (see the header).
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
  // A custom token whose outputs are all fully shielded is hidden in the
  // transaction; any other token is public, and HTR always is, as it pays the
  // fee.
  const tokenHidden =
    profile !== undefined &&
    profile.token !== NATIVE_TOKEN_UID &&
    profile.shieldedOutputCount > 0 &&
    profile.transparentOutputCount === 0 &&
    !profile.hasAmountShieldedOutput;
  const shieldedModeFirst = tokenHidden
    ? ShieldedOutputMode.FULLY_SHIELDED
    : ShieldedOutputMode.AMOUNT_SHIELDED;

  if (!profile || profile.shieldedOutputCount === 0) {
    // Fee-only HTR, or all outputs transparent.
    return {
      policy: {
        preference: OutputKind.TRANSPARENT,
        forceShieldedInput: false,
        forceChangeOnExactSingleShielded: allowExactForcing,
        shieldedModeFirst,
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
        shieldedModeFirst,
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
        shieldedModeFirst,
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
        shieldedModeFirst,
      },
      shieldChange: false,
    };
  }
  // The rules want a shielded input the wallet does not have. For a lone
  // shielded output the change is shielded instead: with only transparent
  // inputs, a transparent change would publish the output's amount by
  // subtraction. Two or more shielded outputs are left as they are, and only
  // their total is published.
  return {
    policy: {
      preference: OutputKind.TRANSPARENT,
      forceShieldedInput: false,
      forceChangeOnExactSingleShielded: false,
      shieldedModeFirst,
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

/** What a selection spending `utxos` reports to the change-mode decision. */
function selectionReport(utxos: IUtxo[]): ISelectionReport {
  return {
    shieldedInputCount: utxos.filter(utxo => utxo.shielded).length,
    anyFullyShieldedInput: utxos.some(
      utxo => utxo.shielded && utxo.assetBlindingFactor !== undefined
    ),
  };
}

/**
 * Whether `utxos`, summing `sum`, pay `amount` exactly from a single shielded
 * input, whose value the transaction would then reveal by subtraction.
 */
function isExactSingleShieldedMatch(
  utxos: IUtxo[],
  sum: OutputValueType,
  amount: OutputValueType
): boolean {
  return sum === amount && utxos.filter(utxo => utxo.shielded).length === 1;
}

/** Whether a shielded UTXO is of `mode`: a fully shielded one has an asset blinding factor. */
function isOfMode(utxo: IUtxo, mode: ShieldedOutputMode): boolean {
  return (utxo.assetBlindingFactor !== undefined) === (mode === ShieldedOutputMode.FULLY_SHIELDED);
}

/**
 * The first available shielded UTXO of `token` that `filter` accepts, in
 * `order` of value: of `modeFirst` when there is one, else of the other mode.
 * With `modeFirst` absent, of either mode. Null when there is none.
 */
async function firstShieldedUtxo(
  storage: IStorage,
  token: string,
  order: 'asc' | 'desc',
  filter: (utxo: IUtxo) => boolean,
  modeFirst: ShieldedOutputMode | undefined
): Promise<IUtxo | null> {
  const filters =
    modeFirst === undefined
      ? [filter]
      : [(utxo: IUtxo) => filter(utxo) && isOfMode(utxo, modeFirst), filter];
  for (const filterMethod of filters) {
    // eslint-disable-next-line no-await-in-loop, no-unreachable-loop -- one yielded UTXO is the answer
    for await (const utxo of storage.selectUtxos({
      token,
      authorities: 0n,
      only_available_utxos: true,
      order_by_value: order,
      shielded: true,
      filter_method: filterMethod,
      max_utxos: 1,
    })) {
      return utxo;
    }
  }
  return null;
}

/**
 * `bestUtxoSelection` over the shielded UTXOs `filter` accepts, taking those
 * of `modeFirst` first: when they cannot pay `amount` alone, all of them are
 * taken and the other mode's selection pays the rest. With `modeFirst`
 * absent, UTXOs of either mode are taken by value alone. Like
 * `bestUtxoSelection`, the result covers `amount` or is empty, then with the
 * total of both modes as `available`.
 */
async function shieldedPoolSelection(
  storage: IStorage,
  token: string,
  amount: OutputValueType,
  filter: (utxo: IUtxo) => boolean,
  modeFirst: ShieldedOutputMode | undefined
): Promise<{ utxos: IUtxo[]; amount: OutputValueType; available?: OutputValueType }> {
  if (modeFirst === undefined) {
    return bestUtxoSelection(storage, token, amount, { shielded: true, filter_method: filter });
  }
  const inMode = (utxo: IUtxo): boolean => filter(utxo) && isOfMode(utxo, modeFirst);
  const first = await bestUtxoSelection(storage, token, amount, {
    shielded: true,
    filter_method: inMode,
  });
  if (first.utxos.length > 0) {
    return first;
  }
  const firstTotal = first.available ?? 0n;
  const rest = await bestUtxoSelection(storage, token, amount - firstTotal, {
    shielded: true,
    filter_method: utxo => filter(utxo) && !isOfMode(utxo, modeFirst),
  });
  if (rest.utxos.length === 0) {
    return { utxos: [], amount: 0n, available: firstTotal + (rest.available ?? 0n) };
  }
  const utxos: IUtxo[] = [];
  let sum = 0n;
  for await (const utxo of storage.selectUtxos({
    token,
    authorities: 0n,
    only_available_utxos: true,
    order_by_value: 'desc',
    shielded: true,
    filter_method: inMode,
  })) {
    utxos.push(utxo);
    sum += utxo.value;
  }
  return { utxos: [...utxos, ...rest.utxos], amount: sum + rest.amount };
}

/**
 * The UTXO added to an exact match spent from a single shielded input so a
 * change output hides that input's value: the smallest shielded UTXO not yet
 * picked, of `modeFirst` when there is one, else of the other mode, since the
 * change will equal its value and only a shielded one keeps it hidden. Null
 * when no other shielded UTXO is left: the selection then proceeds unforced,
 * as there is nothing to hide the value behind (spending the last shielded
 * UTXO would otherwise be impossible).
 */
async function changeForcingUtxo(
  storage: IStorage,
  token: string,
  notPicked: (utxo: IUtxo) => boolean,
  modeFirst: ShieldedOutputMode | undefined
): Promise<IUtxo | null> {
  return firstShieldedUtxo(storage, token, 'asc', notPicked, modeFirst);
}

/**
 * Pool-aware UTXO selection implementing a token's policy.
 *
 * Composition of `bestUtxoSelection` per pool:
 *   1. force-include the smallest shielded UTXO of the policy's first mode,
 *      else of the other mode, when the policy demands one;
 *   2. select from the preferred pool;
 *   3. top up from the other pool when the preferred one is insufficient, or
 *      covers the amount only with more inputs than fit (sweeping the
 *      preferred pool first, largest-first, as far as the input limit
 *      allows, and dropping its smallest UTXOs again when the top-up needs
 *      the room);
 *   4. on an exact match spent from exactly one shielded input, add the
 *      smallest other shielded UTXO of the first mode, else of the other
 *      mode, so a change output exists (see `changeForcingUtxo`).
 *
 * The shielded pool's selection and top-up take the policy's first mode
 * before the other (`shieldedPoolSelection`); when that selection from the
 * preferred pool needs more inputs than fit, the pool's selection by value
 * alone is tried before sweeping.
 *
 * The result either covers `amount` or, when even the top-up falls short
 * within the limit, is empty (the same contract as `bestUtxoSelection`).
 * `maxInputs` is how many inputs this selection may take of the
 * transaction's limit, and `room` how many of those a sweep and its top-up
 * keep free for inputs that may follow. The preferred pool's own selection is
 * taken whenever it fits `maxInputs`.
 */
export async function shieldedAwareSelection(
  storage: IStorage,
  token: string,
  amount: OutputValueType,
  policy: ITokenSelectionPolicy,
  onReport?: (report: ISelectionReport) => void,
  maxInputs: number = MAX_INPUTS,
  room: number = 0
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
    const forced = await firstShieldedUtxo(
      storage,
      token,
      'asc',
      notPicked,
      policy.shieldedModeFirst
    );
    if (forced) {
      add(forced);
    }
  }

  // Unless the forced input already covers it, take the rest from the preferred
  // pool alone when it can within the input limit.
  if (sum < amount) {
    const preferShielded = policy.preference === OutputKind.SHIELDED;
    const poolSelection = (
      shielded: boolean,
      modeFirst: ShieldedOutputMode | undefined
    ): ReturnType<typeof bestUtxoSelection> =>
      shielded
        ? shieldedPoolSelection(storage, token, amount - sum, notPicked, modeFirst)
        : bestUtxoSelection(storage, token, amount - sum, {
            shielded: false,
            filter_method: notPicked,
          });
    // Counted with the forced input, the pool's selection takes one input
    // more when it is an exact match spent from a single shielded input: the
    // change-forcing UTXO. The policies computeTokenPolicy makes never get
    // here with a shielded input in the cover (they force a change only with
    // the transparent pool preferred and no forced input); the count keeps the
    // selection right for any other policy a caller passes.
    const fits = (selection: { utxos: IUtxo[]; amount: OutputValueType }): boolean => {
      const cover = [...picked, ...selection.utxos];
      const coverForcesChange =
        policy.forceChangeOnExactSingleShielded &&
        isExactSingleShieldedMatch(cover, sum + selection.amount, amount);
      return selection.utxos.length > 0 && cover.length + (coverForcesChange ? 1 : 0) <= maxInputs;
    };
    let primary = await poolSelection(preferShielded, policy.shieldedModeFirst);
    if (
      preferShielded &&
      policy.shieldedModeFirst !== undefined &&
      primary.utxos.length > 0 &&
      !fits(primary)
    ) {
      // Taking one mode first can need more inputs than fit where taking the
      // shielded pool by value alone does not: fall back on that order.
      primary = await poolSelection(true, undefined);
    }
    if (fits(primary)) {
      primary.utxos.forEach(add);
    } else {
      // Preferred pool is insufficient on its own, or needs more inputs than
      // fit: sweep it (largest-first, whatever the shielded mode, as that fits
      // the most value within the limit) and top up from the other pool. The
      // sweep keeps `room` free within the input limit, plus an input for the
      // top-up and, when the policy may force one, one for a change-forcing
      // UTXO.
      const sweepLimit = maxInputs - room - (policy.forceChangeOnExactSingleShielded ? 2 : 1);
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
        const secondary = await poolSelection(!preferShielded, policy.shieldedModeFirst);
        // The other pool cannot make up the rest: return an empty selection,
        // as bestUtxoSelection does, with the total that was within reach.
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
        const inputLimit = maxInputs - room - (policy.forceChangeOnExactSingleShielded ? 1 : 0);
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
  if (policy.forceChangeOnExactSingleShielded && isExactSingleShieldedMatch(picked, sum, amount)) {
    const extra = await changeForcingUtxo(storage, token, notPicked, policy.shieldedModeFirst);
    if (extra) {
      add(extra);
    }
  }

  if (onReport) {
    onReport(selectionReport(picked));
  }

  return { utxos: picked, amount: sum };
}

/**
 * The UTXOs that cover `amount` from both pools, with the inputs the policy
 * forces: `bestUtxoSelection` with no pool filter, which takes the largest
 * first.
 *   - A forced shielded input is the largest shielded UTXO of the policy's
 *     first mode, else of the other mode: the largest leaves the least for
 *     the other inputs to cover.
 *   - An exact match spent from a single shielded input also takes the
 *     smallest other shielded UTXO of the first mode, else of the other mode,
 *     as in `shieldedAwareSelection`.
 *
 * With no first mode in the policy, these are the fewest UTXOs that cover
 * `amount` but for an exact match spent from a single shielded input, whose
 * change-forcing UTXO makes one more where another cover would need none:
 * like `bestUtxoSelection`, it takes a UTXO matching the amount exactly over a
 * larger one that alone would do, and among UTXOs of equal value it takes a
 * shielded one as readily as a transparent one. A forced input of the first
 * mode can be smaller than the largest shielded UTXO, and the cover then
 * takes more inputs.
 *
 * It is the selection to fall back on when none under the rules fits the
 * input limit. Like `shieldedAwareSelection`, the result covers `amount` or is
 * empty, then with everything the wallet holds of the token as `available`.
 */
export async function largestFirstSelection(
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
    const forced = await firstShieldedUtxo(
      storage,
      token,
      'desc',
      notPicked,
      policy.shieldedModeFirst
    );
    if (forced) {
      add(forced);
    }
  }

  if (sum < amount) {
    const rest = await bestUtxoSelection(storage, token, amount - sum, {
      filter_method: notPicked,
    });
    if (rest.utxos.length === 0) {
      return { utxos: [], amount: 0n, available: sum + (rest.available ?? 0n) };
    }
    rest.utxos.forEach(add);
  }

  if (policy.forceChangeOnExactSingleShielded && isExactSingleShieldedMatch(picked, sum, amount)) {
    const extra = await changeForcingUtxo(storage, token, notPicked, policy.shieldedModeFirst);
    if (extra) {
      add(extra);
    }
  }

  if (onReport) {
    onReport(selectionReport(picked));
  }

  return { utxos: picked, amount: sum };
}

/**
 * Close a policy over the standard `UtxoSelectionAlgorithm` signature so the
 * existing selection plumbing can run it unchanged.
 *
 * The selection first leaves `room` of its `maxInputs` free for inputs that
 * may follow it, though only a sweep of the preferred pool does: a cover that
 * pool pays on its own within `maxInputs` is taken even when it uses the room,
 * rather than draw on the other pool. When the amount cannot be covered while
 * leaving the room, the selection uses all of `maxInputs`, and the
 * transaction's own input check decides whether what follows still fits.
 *
 * Taking a shielded mode first can need more inputs than taking shielded UTXOs
 * by value alone. When the policy's selection in that order does not fit
 * `maxInputs`, the same selection by value alone is tried before the room is
 * given up, so a selection that fits by value alone still does.
 *
 * When no selection under the rules covers the amount within `maxInputs`, the
 * selection falls back on the UTXOs that cover it largest-first, from both
 * pools (`largestFirstSelection`), with a forced input of the policy's first
 * mode when that fits, else by value alone. Those are returned even when they
 * do not fit either, so the send fails on its input count rather than on a
 * shortage of funds; a wallet holding too little gets an empty selection, as
 * from `bestUtxoSelection`.
 */
export function makeShieldedAwareSelection(
  policy: ITokenSelectionPolicy,
  onReport?: (report: ISelectionReport) => void,
  maxInputs: number = MAX_INPUTS,
  room: number = 0
): UtxoSelectionAlgorithm {
  // The policy taking shielded UTXOs by value alone, when it takes a mode first.
  const byValue =
    policy.shieldedModeFirst === undefined ? null : { ...policy, shieldedModeFirst: undefined };
  const orders = byValue === null ? [policy] : [policy, byValue];
  return async (storage, token, amount) => {
    const fits = (selection: { utxos: IUtxo[]; amount: OutputValueType }) =>
      selection.amount >= amount && selection.utxos.length <= maxInputs;
    for (const roomLeft of room > 0 ? [room, 0] : [0]) {
      for (const ordered of orders) {
        // eslint-disable-next-line no-await-in-loop -- each selection is tried in turn
        const selection = await shieldedAwareSelection(
          storage,
          token,
          amount,
          ordered,
          onReport,
          maxInputs,
          roomLeft
        );
        if (fits(selection)) {
          return selection;
        }
      }
    }
    const largestFirst = await largestFirstSelection(storage, token, amount, policy, onReport);
    if (byValue === null || largestFirst.utxos.length === 0 || fits(largestFirst)) {
      return largestFirst;
    }
    return largestFirstSelection(storage, token, amount, byValue, onReport);
  };
}
