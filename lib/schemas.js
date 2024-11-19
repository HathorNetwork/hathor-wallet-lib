"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.IUtxoSchema = exports.ITokenMetadataSchema = exports.ITokenBalanceSchema = exports.ILockedUtxoSchema = exports.IHistoryTxSchema = exports.IHistoryOutputSchema = exports.IHistoryOutputDecodedSchema = exports.IHistoryInputSchema = exports.IBalanceSchema = exports.IAuthoritiesBalanceSchema = exports.IAddressMetadataAsRecordSchema = void 0;
var _zod = require("zod");
var _types = require("./types");
var _bigint = require("./utils/bigint");
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const ITokenBalanceSchema = exports.ITokenBalanceSchema = _zod.z.object({
  locked: _bigint.bigIntCoercibleSchema,
  unlocked: _bigint.bigIntCoercibleSchema
}).passthrough();
const IAuthoritiesBalanceSchema = exports.IAuthoritiesBalanceSchema = _zod.z.object({
  mint: ITokenBalanceSchema,
  melt: ITokenBalanceSchema
}).passthrough();
const IBalanceSchema = exports.IBalanceSchema = _zod.z.object({
  tokens: ITokenBalanceSchema,
  authorities: IAuthoritiesBalanceSchema
}).passthrough();
const IAddressMetadataAsRecordSchema = exports.IAddressMetadataAsRecordSchema = _zod.z.object({
  numTransactions: _zod.z.number(),
  balance: _zod.z.record(IBalanceSchema)
}).passthrough();
const ITokenMetadataSchema = exports.ITokenMetadataSchema = _zod.z.object({
  numTransactions: _zod.z.number(),
  balance: IBalanceSchema
}).passthrough();
const IHistoryOutputDecodedSchema = exports.IHistoryOutputDecodedSchema = _zod.z.object({
  type: _zod.z.string().optional(),
  address: _zod.z.string().optional(),
  timelock: _zod.z.number().nullish().optional(),
  data: _zod.z.string().optional()
}).passthrough();
const IHistoryInputSchema = exports.IHistoryInputSchema = _zod.z.object({
  value: _bigint.bigIntCoercibleSchema,
  token_data: _zod.z.number(),
  script: _zod.z.string(),
  decoded: IHistoryOutputDecodedSchema,
  token: _zod.z.string(),
  tx_id: _zod.z.string(),
  index: _zod.z.number()
}).passthrough();
const IHistoryOutputSchema = exports.IHistoryOutputSchema = _zod.z.object({
  value: _bigint.bigIntCoercibleSchema,
  token_data: _zod.z.number(),
  script: _zod.z.string(),
  decoded: IHistoryOutputDecodedSchema,
  token: _zod.z.string(),
  spent_by: _zod.z.string().nullable(),
  selected_as_input: _zod.z.boolean().optional()
}).passthrough();
const IHistoryTxSchema = exports.IHistoryTxSchema = _zod.z.object({
  tx_id: _zod.z.string(),
  signalBits: _zod.z.number().optional(),
  version: _zod.z.number(),
  weight: _zod.z.number(),
  timestamp: _zod.z.number(),
  is_voided: _zod.z.boolean(),
  nonce: _zod.z.number().optional(),
  inputs: IHistoryInputSchema.array(),
  outputs: IHistoryOutputSchema.array(),
  parents: _zod.z.string().array(),
  token_name: _zod.z.string().optional(),
  token_symbol: _zod.z.string().optional(),
  tokens: _zod.z.string().array().optional(),
  height: _zod.z.number().optional(),
  processingStatus: _zod.z.nativeEnum(_types.TxHistoryProcessingStatus).optional(),
  nc_id: _zod.z.string().optional(),
  nc_blueprint_id: _zod.z.string().optional(),
  nc_method: _zod.z.string().optional(),
  nc_args: _zod.z.string().optional(),
  nc_pubkey: _zod.z.string().optional(),
  first_block: _zod.z.string().nullish()
}).passthrough();
const IUtxoSchema = exports.IUtxoSchema = _zod.z.object({
  txId: _zod.z.string(),
  index: _zod.z.number(),
  token: _zod.z.string(),
  address: _zod.z.string(),
  value: _bigint.bigIntCoercibleSchema,
  authorities: _bigint.bigIntCoercibleSchema,
  timelock: _zod.z.number().nullable(),
  type: _zod.z.number(),
  height: _zod.z.number().nullable()
}).passthrough();
const ILockedUtxoSchema = exports.ILockedUtxoSchema = _zod.z.object({
  tx: IHistoryTxSchema,
  index: _zod.z.number()
}).passthrough();