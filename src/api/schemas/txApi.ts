/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { bigIntCoercibleSchema } from '../../utils/bigint';
import { IHistoryNanoContractContextSchema, shieldedOutputWireShape } from '../../schemas';

const p2pkhDecodedScriptSchema = z.object({
  type: z.literal('P2PKH'),
  address: z.string(),
  timelock: z.number().nullish(),
  value: bigIntCoercibleSchema,
  token_data: z.number(),
});

const p2shDecodedScriptSchema = z.object({
  type: z.literal('MultiSig'),
  address: z.string(),
  timelock: z.number().nullish(),
  value: bigIntCoercibleSchema,
  token_data: z.number(),
});

const unknownDecodedScriptSchema = z
  .object({
    type: z.undefined(),
  })
  .passthrough();

// TODO: This should be unified with IHistoryOutputDecodedSchema
export const decodedSchema = z.discriminatedUnion('type', [
  p2pkhDecodedScriptSchema,
  p2shDecodedScriptSchema,
  unknownDecodedScriptSchema,
]);

const fullnodeTxApiTransparentInputSchema = z.object({
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: decodedSchema,
  tx_id: z.string(),
  index: z.number(),
  token: z.string().nullish(),
});

// An input that spends a shielded output is delivered INLINE in `inputs[]` as
// the spent output's JSON plus `tx_id`/`index` (hathor-core `/transaction`
// resource → `_shielded_output_to_json`): type/commitment/range_proof always,
// plus mode/script and the per-mode fields, which `.passthrough()` absorbs.
// The spent amount, token and spender remain hidden.
const fullnodeTxApiShieldedInputSchema = z
  .object({
    type: z.literal('shielded'),
    commitment: z.string(),
    range_proof: z.string(),
  })
  .passthrough();

export const fullnodeTxApiInputSchema = z.union([
  fullnodeTxApiShieldedInputSchema,
  fullnodeTxApiTransparentInputSchema,
]);

export const fullnodeTxApiOutputSchema = z.object({
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: decodedSchema,
  token: z.string().nullish(),
  spent_by: z.string().nullable().default(null),
});

// Shielded outputs hide their value behind a Pedersen commitment, so the
// `decoded` block carries only address-side fields (no `value` /
// `token_data` like transparent outputs). Matches `IShieldedOutputDecoded`
// in src/shielded/types.ts and what `_shielded_output_to_json` in
// hathor-core's base_transaction.py emits.
const shieldedDecodedSchema = z
  .object({
    type: z.string().optional(),
    address: z.string().optional(),
    timelock: z.number().nullish(),
  })
  .passthrough();

// Shielded outputs as emitted by the fullnode's tx API. Mirrors
// `IShieldedOutput` (src/shielded/types.ts) plus the optional FullShielded
// extensions and the `spent_by` flag that the fullnode populates the same
// way it does for transparent outputs (see hathor-core
// `_shielded_output_to_json` in base_transaction.py and
// `meta.get_output_spent_by`). `.passthrough()` keeps any new
// forward-compat fields the fullnode might add without rejecting the tx.
export const fullnodeTxApiShieldedOutputSchema = z
  .object({
    ...shieldedOutputWireShape,
    // The fullnode only emits `decoded` when the shielded script parses as a
    // standard type; consensus does not restrict shielded scripts, so a
    // non-standard script omits it. Default to {} (matching the history schema
    // in src/schemas.ts) so one such output doesn't reject the whole tx.
    decoded: shieldedDecodedSchema.default({}),
  })
  .passthrough();

export const fullnodeTxApiTokenSchema = z.object({
  uid: z.string(),
  name: z.string().nullable(),
  symbol: z.string().nullable(),
});

export const fullnodeTxApiTxSchema = z.object({
  hash: z.string(),
  nonce: z.string(),
  timestamp: z.number(),
  version: z.number(),
  weight: z.number(),
  signal_bits: z.number(),
  parents: z.string().array(),
  nc_id: z.string().nullish(),
  nc_method: z.string().nullish(),
  nc_pubkey: z.string().nullish(),
  nc_address: z.string().nullish(),
  nc_context: IHistoryNanoContractContextSchema.nullish(),
  nc_args: z.string().nullish(),
  nc_blueprint_id: z.string().nullish(),
  inputs: fullnodeTxApiInputSchema.array(),
  outputs: fullnodeTxApiOutputSchema.array(),
  shielded_outputs: fullnodeTxApiShieldedOutputSchema.array().nullish(),
  tokens: fullnodeTxApiTokenSchema.array(),
  token_name: z.string().nullish(),
  token_symbol: z.string().nullish(),
  raw: z.string(),
});

export const fullnodeTxApiMetaSchema = z.object({
  hash: z.string(),
  spent_outputs: z.tuple([z.number(), z.string().array()]).array(),
  received_by: z.string().array(),
  children: z.string().array(),
  conflict_with: z.string().array(),
  voided_by: z.string().array(),
  twins: z.string().array(),
  accumulated_weight: z.number(),
  score: z.number(),
  height: z.number(),
  min_height: z.number(),
  feature_activation_bit_counts: z.number().array().nullable(),
  first_block: z.string().nullish(),
  validation: z.string().nullish(),
  first_block_height: z.number().nullish(),
});

export const transactionApiSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    tx: fullnodeTxApiTxSchema.passthrough(),
    meta: fullnodeTxApiMetaSchema.passthrough(),
    spent_outputs: z.record(z.coerce.number(), z.string()),
  }),
  z.object({ success: z.literal(false), message: z.string().nullish() }),
]);

export type FullNodeTxApiResponse = z.infer<typeof transactionApiSchema>;

/**
 * Success response for GET /transaction_acc_weight
 * - `stop_value` is present only when the transaction has a "first_block"
 *   (i.e., when a stop_value was computed).
 * - `accumulated_weight_raw` is provided as a string (raw/internal big value).
 */
export interface TransactionAccWeightSuccess {
  success: true;
  accumulated_weight: number; // human-friendly float weight (e.g. 15.4)
  accumulated_weight_raw: string; // raw internal work/weight value as string (big int-like)
  confirmation_level: number; // 0..1 (clamped), proportion of stop_value reached
  accumulated_bigger: boolean; // whether accumulated_weight > stop_value (if stop_value present)
  stop_value?: number; // optional: present only when applicable
}

/**
 * Error response for GET /transaction_acc_weight
 */
export interface TransactionAccWeightError {
  success: false;
  message: string;
}

/**
 * Union type for the endpoint response.
 * Use `if (res.success)` to narrow to TransactionAccWeightSuccess.
 */
export type TransactionAccWeightResponse = TransactionAccWeightSuccess | TransactionAccWeightError;

/**
 * Error response when validation fails
 */
export interface GraphvizNeighboursErrorResponse {
  success: false;
  message: string;
}

/**
 * Success response when format is 'dot'
 * Returns the DOT graph as a string
 */
export type GraphvizNeighboursDotResponse = string;

/**
 * Union type for all possible responses from the graphviz neighbours endpoint
 */
export type GraphvizNeighboursResponse =
  | GraphvizNeighboursErrorResponse
  | GraphvizNeighboursDotResponse;
