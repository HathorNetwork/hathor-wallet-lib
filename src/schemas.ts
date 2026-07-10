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
  IHistoryShieldedOutput,
  IHistoryTx,
  ILockedUtxo,
  ITokenBalance,
  ITokenMetadata,
  IUtxo,
  TxHistoryProcessingStatus,
} from './types';
import { bigIntCoercibleSchema, ZodSchema } from './utils/bigint';
// Type-only: the enum's runtime value lives in the native @hathor/ct-crypto-provider
// package; importing it as a value would pull that native module into every consumer
// of this schema module. We only need it to type the `mode` wire field.
import type { ShieldedOutputMode } from './shielded/types';

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

// Transparent input: the spent output's fields are echoed inline in full,
// with the same strictness they always had before shielded outputs existed.
const transparentHistoryInputSchema = z
  .object({
    value: bigIntCoercibleSchema,
    token_data: z.number(),
    script: z.string(),
    decoded: IHistoryOutputDecodedSchema,
    token: z.string(),
    tx_id: txIdSchema,
    index: z.number(),
    // The alpha fullnode stamps 'transparent'; older nodes omit the field.
    // Accept any string and never fail-closed on this external discriminator:
    // the wallet's only semantic use is `=== 'shielded'` (see
    // utils/transaction.ts:isShieldedInputEntry).
    type: z.string().optional(),
  })
  .passthrough();

// Shielded input (spends a shielded output): the wire echoes the spent
// output's confidential fields (type='shielded', mode, commitment,
// range_proof, script, per-mode extras) plus tx_id/index — never its
// value/token, which stay hidden in the commitments (hathor-core
// `to_json_extended`). The sender-local insert
// (utils/transaction.ts:convertTransactionToHistoryTx) instead stamps the
// decrypted value/token/decoded and no commitment — so every echoed field is
// optional here; only the discriminator and the outpoint are guaranteed.
const shieldedHistoryInputSchema = z
  .object({
    type: z.literal('shielded'),
    tx_id: txIdSchema,
    index: z.number(),
    commitment: z.string().optional(),
    script: z.string().optional(),
    decoded: IHistoryOutputDecodedSchema.optional(),
    value: bigIntCoercibleSchema.optional(),
    token_data: z.number().optional(),
    token: z.string().optional(),
  })
  .passthrough();

// A plain union, NOT z.discriminatedUnion: older nodes omit `type` on
// transparent inputs and a discriminated union requires the key. Shielded
// comes first so a locally-enriched shielded input (which also carries the
// transparent fields) still matches its literal branch.
export const IHistoryInputSchema: ZodSchema<IHistoryInput> = z.union([
  shieldedHistoryInputSchema,
  transparentHistoryInputSchema,
]) as unknown as ZodSchema<IHistoryInput>;

// SEPARATED model: `outputs[]` is transparent-only. The fullnode
// delivers shielded outputs in a dedicated top-level `shielded_outputs[]` array
// on every path — HTTP `/transaction` (to_json) and `address_history` + the WS
// real-time path (to_json_extended) — so a transparent-only output schema
// validates the raw wire directly; there are no inline `type: 'shielded'`
// entries in `outputs[]` to accommodate.
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

// The mode-independent wire fields every shielded output carries.
const shieldedOutputWireShapeCommon = {
  commitment: z.string(),
  range_proof: z.string(),
  script: z.string(),
  // Protocol-optional: on-chain the field is a fixed 33 bytes where all-zeros
  // means "not present", and the fullnode omits the JSON key in that case
  // (hathor-core `serialize_shielded_output`). An output without an ECDH hint
  // can never be rewound by the wallet (see shielded/processing.ts).
  ephemeral_pubkey: z.string().optional(),
  spent_by: z.string().nullable().optional(),
};

// The wire fields shared by a shielded output on BOTH the fullnode tx API
// (`fullnodeTxApiShieldedOutputSchema`, api/schemas/txApi.ts) and the wallet
// history (`IHistoryShieldedOutputSchema` below, which additionally splits
// per mode). `mode` is REQUIRED: the fullnode always sets it on the wire, so
// readers classify directly from it. `token_data` defaults to 0 (native-token
// slot) because FullShielded outputs hide the token UID behind
// `asset_commitment` and may omit the field.
export const shieldedOutputWireShape = {
  // Wire value is a raw number (1=AmountShielded, 2=FullShielded); type it as
  // ShieldedOutputMode without pulling the native provider's runtime enum in.
  mode: z.number() as unknown as z.ZodType<ShieldedOutputMode>,
  ...shieldedOutputWireShapeCommon,
  token_data: z.number().optional().default(0),
  asset_commitment: z.string().optional(),
  surjection_proof: z.string().optional(),
};

// ── owned-marker fields (SEPARATED model) ──
// Written in place — all together — when the wallet decrypts an output it
// owns (shielded/processing.ts): `value` + `token` + `blindingFactor` for
// both modes, plus `assetBlindingFactor` for FullShielded only. The wire
// never carries `value`/`blindingFactor`/`assetBlindingFactor`; `token`,
// however, IS wire-stamped on AmountShielded entries (the asset is public —
// hathor-core `to_json_extended`), so for that mode its presence does not
// imply ownership. `value !== undefined` is the single ownership/decoded
// gate.
const shieldedOwnedMarkerShape = {
  value: bigIntCoercibleSchema.optional(),
  token: z.string().optional(),
  blindingFactor: z.string().optional(),
};

// AmountShielded (wire mode byte 1): the value is hidden, the asset is
// public — the fullnode always emits `token_data` and never emits
// `asset_commitment`/`surjection_proof` (hathor-core
// `serialize_shielded_output`), and decode never recovers an asset blinding
// factor.
const IHistoryAmountShieldedOutputSchema = z
  .object({
    mode: z.literal(1), // ShieldedOutputMode.AMOUNT_SHIELDED
    ...shieldedOutputWireShapeCommon,
    token_data: z.number(),
    // Emitted only when the script parses as a standard type; consensus does
    // not restrict shielded scripts, so absence must not reject the tx.
    decoded: IHistoryOutputDecodedSchema.default({}),
    ...shieldedOwnedMarkerShape,
    // FullShielded-only fields — must not appear on an AmountShielded entry.
    asset_commitment: z.undefined(),
    surjection_proof: z.undefined(),
    assetBlindingFactor: z.undefined(),
  })
  .passthrough();

// FullShielded (wire mode byte 2): the value AND the asset are hidden — the
// fullnode always emits `asset_commitment` + `surjection_proof` and omits
// `token_data`.
const IHistoryFullShieldedOutputSchema = z
  .object({
    mode: z.literal(2), // ShieldedOutputMode.FULLY_SHIELDED
    ...shieldedOutputWireShapeCommon,
    asset_commitment: z.string(),
    surjection_proof: z.string(),
    token_data: z.number().optional().default(0),
    decoded: IHistoryOutputDecodedSchema.default({}),
    ...shieldedOwnedMarkerShape,
    assetBlindingFactor: z.string().optional(),
  })
  .passthrough();

// SEPARATED model: history shape of one entry in `tx.shielded_outputs[]`,
// discriminated by the required wire `mode`. Mirrors `IHistoryShieldedOutput`
// (src/types.ts). Decode-only fields must be consistent with the ownership
// gate: every writer stamps them together (shielded/processing.ts, the
// re-delivery merge in new/wallet.ts). For FullShielded that covers
// token/blindingFactor/assetBlindingFactor; for AmountShielded only
// blindingFactor is decode-only — the fullnode wire-stamps the public `token`
// on entries the wallet does not own, so an owned slot must have it but its
// presence alone proves nothing.
const IHistoryShieldedOutputSchema = z
  .discriminatedUnion('mode', [
    IHistoryAmountShieldedOutputSchema,
    IHistoryFullShieldedOutputSchema,
  ])
  .superRefine((so, ctx) => {
    const owned = so.value !== undefined;
    const inconsistent =
      (so.blindingFactor !== undefined) !== owned ||
      (so.mode === 2
        ? (so.token !== undefined) !== owned || (so.assetBlindingFactor !== undefined) !== owned
        : owned && so.token === undefined);
    if (inconsistent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'decode-only fields must be consistent with the `value` ownership gate',
      });
    }
  }) as unknown as ZodSchema<IHistoryShieldedOutput>;

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
