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
    seqnum: z.number(),
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
    // These fields may be absent for shielded inputs (spent output value/token hidden)
    value: bigIntCoercibleSchema.optional(),
    token_data: z.number().optional(),
    script: z.string().optional(),
    decoded: IHistoryOutputDecodedSchema.optional(),
    token: z.string().optional(),
    // Always present:
    tx_id: txIdSchema,
    index: z.number(),
    // Set to 'shielded' when this input spends a shielded output.
    type: z.literal('shielded').optional(),
    commitment: z.string().optional(),
  })
  .passthrough() as ZodSchema<IHistoryInput>;

// SEPARATED model: `outputs[]` is transparent-only post-normalize. Shielded
// outputs live in their own `shielded_outputs[]` list (see
// `IHistoryShieldedOutputSchema` below / `IHistoryShieldedOutput` in types.ts).
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

export const IHistoryNanoContractBaseAction = z.object({
  token_uid: z.string(),
});

export const IHistoryNanoContractBaseTokenAction = IHistoryNanoContractBaseAction.extend({
  amount: bigIntCoercibleSchema,
});

export const IHistoryNanoContractBaseAuthorityAction = IHistoryNanoContractBaseAction.extend({
  mint: z.boolean(),
  melt: z.boolean(),
});
export const IHistoryNanoContractActionWithdrawalSchema =
  IHistoryNanoContractBaseTokenAction.extend({
    type: z.literal('withdrawal'),
  }).passthrough();

export const IHistoryNanoContractActionDepositSchema = IHistoryNanoContractBaseTokenAction.extend({
  type: z.literal('deposit'),
}).passthrough();

export const IHistoryNanoContractActionGrantAuthoritySchema =
  IHistoryNanoContractBaseAuthorityAction.extend({
    type: z.literal('grant_authority'),
  }).passthrough();

export const IHistoryNanoContractActionAcquireAuthoritySchema =
  IHistoryNanoContractBaseAuthorityAction.extend({
    type: z.literal('acquire_authority'),
  }).passthrough();

export const IHistoryNanoContractActionSchema = z.discriminatedUnion('type', [
  IHistoryNanoContractActionDepositSchema,
  IHistoryNanoContractActionWithdrawalSchema,
  IHistoryNanoContractActionGrantAuthoritySchema,
  IHistoryNanoContractActionAcquireAuthoritySchema,
]);

export const IHistoryNanoContractContextSchema = z
  .object({
    actions: IHistoryNanoContractActionSchema.array(),
    caller_id: z.string(),
    timestamp: z.number().nullish(),
  })
  .passthrough();

// SEPARATED model: history shape of one entry in `tx.shielded_outputs[]`.
// Mirrors `IHistoryShieldedOutput` (src/types.ts): the wire crypto fields plus
// `spent_by` and the OPTIONAL owned-marker fields written in place when the
// wallet decrypts an output it owns. `value !== undefined` is the single
// ownership/decoded gate.
const IHistoryShieldedOutputSchema = z
  .object({
    // `mode` was added to hathor-core's `_shielded_output_to_json` after
    // 0.0.6-shielded; older fullnodes (still common on testnet) omit it.
    // Downstream readers fall back to detecting FullShielded via the presence
    // of `asset_commitment`, so we accept the missing-`mode` shape rather than
    // fail-closed on every tx returned by an un-upgraded node.
    mode: z.number().optional(),
    commitment: z.string(),
    range_proof: z.string(),
    script: z.string(),
    // FullShielded outputs sometimes ship without `token_data` (the token UID
    // is hidden behind `asset_commitment`, so the field has no meaningful
    // value). Default to 0 (native-token slot) so the existing token-symbol
    // resolution path doesn't NPE on lookups.
    token_data: z.number().optional().default(0),
    ephemeral_pubkey: z.string(),
    decoded: IHistoryOutputDecodedSchema,
    asset_commitment: z.string().optional(),
    surjection_proof: z.string().optional(),
    spent_by: z.string().nullable().optional(),
    // ── owned-marker fields (SEPARATED model) ──
    // Written in place when the wallet decrypts an output it owns. A slot with
    // `value === undefined` is non-owned (or not yet decrypted).
    value: bigIntCoercibleSchema.optional(),
    token: z.string().optional(),
    blindingFactor: z.string().optional(),
    assetBlindingFactor: z.string().optional(),
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
    shielded_outputs: IHistoryShieldedOutputSchema.array().optional(),
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
