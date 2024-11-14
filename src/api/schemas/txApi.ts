/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';

export const transactionSchema = z.discriminatedUnion('success', [
  z
    .object({
      success: z.literal(true),
      tx: z
        .object({
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
          inputs: z
            .object({
              value: z.number(),
              token_data: z.number(),
              script: z.string(),
              decoded: z
                .object({
                  type: z.string(),
                  address: z.string(),
                  timelock: z.number().nullish(),
                  value: z.number(),
                  token_data: z.number(),
                })
                .passthrough(),
              tx_id: z.string(),
              index: z.number(),
              token: z.string().nullish(),
              spent_by: z.string().nullish(),
            })
            .passthrough()
            .array(),
          outputs: z
            .object({
              value: z.number(),
              token_data: z.number(),
              script: z.string(),
              decoded: z
                .object({
                  type: z.string(),
                  address: z.string().optional(),
                  timelock: z.number().nullish(),
                  value: z.number(),
                  token_data: z.number().optional(),
                })
                .passthrough(),
              token: z.string().nullish(),
              spent_by: z.string().nullish(),
            })
            .passthrough()
            .array(),
          tokens: z
            .object({
              uid: z.string(),
              name: z.string().nullable(),
              symbol: z.string().nullable(),
            })
            .passthrough()
            .array(),
          token_name: z.string().nullish(),
          token_symbol: z.string().nullish(),
          raw: z.string(),
        })
        .passthrough(),
      meta: z
        .object({
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
        })
        .passthrough(),
      spent_outputs: z.record(z.coerce.number(), z.string()),
    })
    .passthrough(),
  z.object({ success: z.literal(false), message: z.string().nullish() }).passthrough(),
]);

export type TransactionSchema = z.infer<typeof transactionSchema>;
