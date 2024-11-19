"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.mintMeltUtxoSchema = exports.generalTokenInfoSchema = exports.addressHistorySchema = void 0;
var _zod = require("zod");
var _schemas = require("../../schemas");
var _bigint = require("../../utils/bigint");
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const addressHistorySchema = exports.addressHistorySchema = _zod.z.discriminatedUnion('success', [_zod.z.object({
  success: _zod.z.literal(true),
  history: _schemas.IHistoryTxSchema.array(),
  has_more: _zod.z.boolean(),
  first_hash: _zod.z.string().nullish(),
  first_address: _zod.z.string().nullish()
}).passthrough(), _zod.z.object({
  success: _zod.z.literal(false),
  message: _zod.z.string()
}).passthrough()]);
const mintMeltUtxoSchema = exports.mintMeltUtxoSchema = _zod.z.object({
  tx_id: _zod.z.string(),
  index: _zod.z.number()
}).passthrough();
const generalTokenInfoSchema = exports.generalTokenInfoSchema = _zod.z.discriminatedUnion('success', [_zod.z.object({
  success: _zod.z.literal(true),
  name: _zod.z.string(),
  symbol: _zod.z.string(),
  mint: mintMeltUtxoSchema.array(),
  melt: mintMeltUtxoSchema.array(),
  total: _bigint.bigIntCoercibleSchema,
  transactions_count: _zod.z.number()
}).passthrough(), _zod.z.object({
  success: _zod.z.literal(false),
  message: _zod.z.string()
}).passthrough()]);