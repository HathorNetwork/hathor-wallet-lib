"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.transactionSchema = void 0;
var _zod = require("zod");
var _bigint = require("../../utils/bigint");
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const transactionSchema = exports.transactionSchema = _zod.z.discriminatedUnion('success', [_zod.z.object({
  success: _zod.z.literal(true),
  tx: _zod.z.object({
    hash: _zod.z.string(),
    nonce: _zod.z.string(),
    timestamp: _zod.z.number(),
    version: _zod.z.number(),
    weight: _zod.z.number(),
    signal_bits: _zod.z.number(),
    parents: _zod.z.string().array(),
    nc_id: _zod.z.string().nullish(),
    nc_method: _zod.z.string().nullish(),
    nc_pubkey: _zod.z.string().nullish(),
    nc_args: _zod.z.string().nullish(),
    nc_blueprint_id: _zod.z.string().nullish(),
    inputs: _zod.z.object({
      value: _bigint.bigIntCoercibleSchema,
      token_data: _zod.z.number(),
      script: _zod.z.string(),
      decoded: _zod.z.object({
        type: _zod.z.string(),
        address: _zod.z.string(),
        timelock: _zod.z.number().nullish(),
        value: _bigint.bigIntCoercibleSchema,
        token_data: _zod.z.number()
      }).passthrough(),
      tx_id: _zod.z.string(),
      index: _zod.z.number(),
      token: _zod.z.string().nullish(),
      spent_by: _zod.z.string().nullish()
    }).passthrough().array(),
    outputs: _zod.z.object({
      value: _bigint.bigIntCoercibleSchema,
      token_data: _zod.z.number(),
      script: _zod.z.string(),
      decoded: _zod.z.object({
        type: _zod.z.string(),
        address: _zod.z.string().optional(),
        timelock: _zod.z.number().nullish(),
        value: _bigint.bigIntCoercibleSchema,
        token_data: _zod.z.number().optional()
      }).passthrough(),
      token: _zod.z.string().nullish(),
      spent_by: _zod.z.string().nullish()
    }).passthrough().array(),
    tokens: _zod.z.object({
      uid: _zod.z.string(),
      name: _zod.z.string().nullable(),
      symbol: _zod.z.string().nullable()
    }).passthrough().array(),
    token_name: _zod.z.string().nullish(),
    token_symbol: _zod.z.string().nullish(),
    raw: _zod.z.string()
  }).passthrough(),
  meta: _zod.z.object({
    hash: _zod.z.string(),
    spent_outputs: _zod.z.tuple([_zod.z.number(), _zod.z.string().array()]).array(),
    received_by: _zod.z.string().array(),
    children: _zod.z.string().array(),
    conflict_with: _zod.z.string().array(),
    voided_by: _zod.z.string().array(),
    twins: _zod.z.string().array(),
    accumulated_weight: _zod.z.number(),
    score: _zod.z.number(),
    height: _zod.z.number(),
    min_height: _zod.z.number(),
    feature_activation_bit_counts: _zod.z.number().array().nullable(),
    first_block: _zod.z.string().nullish(),
    validation: _zod.z.string().nullish(),
    first_block_height: _zod.z.number().nullish()
  }).passthrough(),
  spent_outputs: _zod.z.record(_zod.z.coerce.number(), _zod.z.string())
}).passthrough(), _zod.z.object({
  success: _zod.z.literal(false),
  message: _zod.z.string().nullish()
}).passthrough()]);