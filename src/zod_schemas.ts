/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import {
  IAddressMetadataAsRecord,
  IAuthoritiesBalance,
  IBalance,
  IHistoryInput,
  IHistoryOutput,
  IHistoryOutputDecoded,
  IHistoryTx,
  ILockedUtxo,
  ITokenBalance,
  ITokenMetadata,
  IUtxo,
  TxHistoryProcessingStatus,
} from './types';
import { bigIntCoercibleSchema } from './utils/bigint';

export type ZodSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

export const ITokenBalanceSchema: ZodSchema<ITokenBalance> = z
  .object({
    locked: bigIntCoercibleSchema,
    unlocked: bigIntCoercibleSchema,
  })
  .strict();

export const IAuthoritiesBalanceSchema: ZodSchema<IAuthoritiesBalance> = z
  .object({
    mint: ITokenBalanceSchema,
    melt: ITokenBalanceSchema,
  })
  .strict();

export const IBalanceSchema: ZodSchema<IBalance> = z
  .object({
    tokens: ITokenBalanceSchema,
    authorities: IAuthoritiesBalanceSchema,
  })
  .strict();

export const IAddressMetadataAsRecordSchema: ZodSchema<IAddressMetadataAsRecord> = z
  .object({
    numTransactions: z.number(),
    balance: z.record(IBalanceSchema),
  })
  .strict();

export const ITokenMetadataSchema: ZodSchema<ITokenMetadata> = z
  .object({
    numTransactions: z.number(),
    balance: IBalanceSchema,
  })
  .strict();

export const IHistoryOutputDecodedSchema: ZodSchema<IHistoryOutputDecoded> = z
  .object({
    type: z.string().optional(),
    address: z.string().optional(),
    timelock: z.number().nullish().optional(),
    data: z.string().optional(),
  })
  .strict();

export const IHistoryInputSchema: ZodSchema<IHistoryInput> = z
  .object({
    value: bigIntCoercibleSchema,
    token_data: z.number(),
    script: z.string(),
    decoded: IHistoryOutputDecodedSchema,
    token: z.string(),
    tx_id: z.string(),
    index: z.number(),
  })
  .strict();

export const IHistoryOutputSchema: ZodSchema<IHistoryOutput> = z
  .object({
    value: bigIntCoercibleSchema,
    token_data: z.number(),
    script: z.string(),
    decoded: IHistoryOutputDecodedSchema,
    token: z.string(),
    spent_by: z.string().nullable(),
    selected_as_input: z.boolean().optional(),
  })
  .strict();

export const IHistoryTxSchema: ZodSchema<IHistoryTx> = z
  .object({
    tx_id: z.string(),
    signalBits: z.number().optional(),
    version: z.number(),
    weight: z.number(),
    timestamp: z.number(),
    is_voided: z.boolean(),
    nonce: z.number().optional(),
    inputs: IHistoryInputSchema.array(),
    outputs: IHistoryOutputSchema.array(),
    parents: z.string().array(),
    token_name: z.string().optional(),
    token_symbol: z.string().optional(),
    tokens: z.string().array().optional(),
    height: z.number().optional(),
    processingStatus: z.nativeEnum(TxHistoryProcessingStatus).optional(),
    nc_id: z.string().optional(),
    nc_blueprint_id: z.string().optional(),
    nc_method: z.string().optional(),
    nc_args: z.string().optional(),
    nc_pubkey: z.string().optional(),
    first_block: z.string().optional(),
  })
  .strict();

export const IUtxoSchema: ZodSchema<IUtxo> = z
  .object({
    txId: z.string(),
    index: z.number(),
    token: z.string(),
    address: z.string(),
    value: bigIntCoercibleSchema,
    authorities: bigIntCoercibleSchema,
    timelock: z.number().nullable(),
    type: z.number(),
    height: z.number().nullable(),
  })
  .strict();

export const ILockedUtxoSchema: ZodSchema<ILockedUtxo> = z
  .object({
    tx: IHistoryTxSchema,
    index: z.number(),
  })
  .strict();
