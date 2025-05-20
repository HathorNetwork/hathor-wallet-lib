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
import { bigIntCoercibleSchema, ZodSchema } from './utils/bigint';

/**
 * TxId schema
 */
export const txIdSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);

export const ITokenBalanceSchema: ZodSchema<ITokenBalance> = z
  .object({
    locked: bigIntCoercibleSchema,
    unlocked: bigIntCoercibleSchema,
  })
  .passthrough();

export const IAuthoritiesBalanceSchema: ZodSchema<IAuthoritiesBalance> = z
  .object({
    mint: ITokenBalanceSchema,
    melt: ITokenBalanceSchema,
  })
  .passthrough();

export const IBalanceSchema: ZodSchema<IBalance> = z
  .object({
    tokens: ITokenBalanceSchema,
    authorities: IAuthoritiesBalanceSchema,
  })
  .passthrough();

export const IAddressMetadataAsRecordSchema: ZodSchema<IAddressMetadataAsRecord> = z
  .object({
    numTransactions: z.number(),
    balance: z.record(IBalanceSchema),
  })
  .passthrough();

export const ITokenMetadataSchema: ZodSchema<ITokenMetadata> = z
  .object({
    numTransactions: z.number(),
    balance: IBalanceSchema,
  })
  .passthrough();

export const IHistoryOutputDecodedSchema: ZodSchema<IHistoryOutputDecoded> = z
  .object({
    type: z.string().optional(),
    address: z.string().optional(),
    timelock: z.number().nullish(),
    data: z.string().optional(),
  })
  .passthrough();

export const IHistoryInputSchema: ZodSchema<IHistoryInput> = z
  .object({
    value: bigIntCoercibleSchema,
    token_data: z.number(),
    script: z.string(),
    decoded: IHistoryOutputDecodedSchema,
    token: z.string(),
    tx_id: txIdSchema,
    index: z.number(),
  })
  .passthrough();

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
  .passthrough();

export const IHistoryNanoContractActionWithdrawalSchema = z
  .object({
    type: z.literal('WITHDRAWAL'),
    token_uid: z.string(),
    amount: bigIntCoercibleSchema,
  })
  .passthrough();

export const IHistoryNanoContractActionDepositSchema = z
  .object({
    type: z.literal('DEPOSIT'),
    token_uid: z.string(),
    amount: bigIntCoercibleSchema,
  })
  .passthrough();

export const IHistoryNanoContractActionGrantAuthoritySchema = z
  .object({
    type: z.literal('GRANT_AUTHORITY'),
    token_uid: z.string(),
    mint: z.boolean(),
    melt: z.boolean(),
  })
  .passthrough();

export const IHistoryNanoContractActionInvokeAuthoritySchema = z
  .object({
    type: z.literal('INVOKE_AUTHORITY'),
    token_uid: z.string(),
    mint: z.boolean(),
    melt: z.boolean(),
  })
  .passthrough();

export const IHistoryNanoContractActionSchema = z.discriminatedUnion('type', [
  IHistoryNanoContractActionDepositSchema,
  IHistoryNanoContractActionWithdrawalSchema,
  IHistoryNanoContractActionGrantAuthoritySchema,
  IHistoryNanoContractActionInvokeAuthoritySchema,
]);

export const IHistoryNanoContractContextSchema = z
  .object({
    actions: IHistoryNanoContractActionSchema.array(),
    address: z.string(),
    timestamp: z.number(),
  })
  .passthrough();

export const IHistoryTxSchema: ZodSchema<IHistoryTx> = z
  .object({
    tx_id: txIdSchema,
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
    nc_pubkey: z
      .string()
      .regex(/^[a-fA-F0-9]*$/)
      .optional(), // for on-chain-blueprints
    nc_address: z.string().optional(),
    nc_context: IHistoryNanoContractContextSchema.optional(),
    first_block: z.string().nullish(),
  })
  .passthrough();

export const IUtxoSchema: ZodSchema<IUtxo> = z
  .object({
    txId: txIdSchema,
    index: z.number(),
    token: z.string(),
    address: z.string(),
    value: bigIntCoercibleSchema,
    authorities: bigIntCoercibleSchema,
    timelock: z.number().nullable(),
    type: z.number(),
    height: z.number().nullable(),
  })
  .passthrough();

export const ILockedUtxoSchema: ZodSchema<ILockedUtxo> = z
  .object({
    tx: IHistoryTxSchema,
    index: z.number(),
  })
  .passthrough();
