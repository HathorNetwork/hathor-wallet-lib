/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { IHistoryTxSchema } from '../../schemas';
import { bigIntCoercibleSchema } from '../../utils/bigint';

export const addressHistorySchema = z.discriminatedUnion('success', [
  z
    .object({
      success: z.literal(true),
      history: IHistoryTxSchema.array(),
      has_more: z.boolean(),
      first_hash: z.string().nullish(),
      first_address: z.string().nullish(),
    })
    .passthrough(),
  z.object({ success: z.literal(false), message: z.string() }).passthrough(),
]);

export type AddressHistorySchema = z.infer<typeof addressHistorySchema>;

export const mintMeltUtxoSchema = z
  .object({
    tx_id: z.string(),
    index: z.number(),
  })
  .passthrough();

export const generalTokenInfoSchema = z.discriminatedUnion('success', [
  z
    .object({
      success: z.literal(true),
      name: z.string(),
      symbol: z.string(),
      version: z.number().nullable(),
      mint: mintMeltUtxoSchema.array(),
      melt: mintMeltUtxoSchema.array(),
      total: bigIntCoercibleSchema,
      transactions_count: z.number(),
    })
    .passthrough(),
  z.object({ success: z.literal(false), message: z.string() }).passthrough(),
]);

export type GeneralTokenInfoSchema = z.infer<typeof generalTokenInfoSchema>;
