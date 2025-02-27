/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { bigIntCoercibleSchema } from '../../utils/bigint';

const p2pkhDecodedScriptSchema = z.object({
  type: z.literal('P2PKH'),
  address: z.string(),
  timelock: z.number().nullish(),
  value: bigIntCoercibleSchema,
  token_data: z.number(),
});

const p2shDecodedScriptSchema = z.object({
  type: z.literal('P2SH'),
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

export const fullnodeTxApiInputSchema = z.object({
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: decodedSchema,
  tx_id: z.string(),
  index: z.number(),
  token: z.string().nullish(),
  spent_by: z.string().nullish(),
});

export const fullnodeTxApiOutputSchema = z.object({
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: decodedSchema,
  token: z.string().nullish(),
  spent_by: z.string().nullish(),
});

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
  nc_args: z.string().nullish(),
  nc_blueprint_id: z.string().nullish(),
  inputs: fullnodeTxApiInputSchema.array(),
  outputs: fullnodeTxApiOutputSchema.array(),
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
