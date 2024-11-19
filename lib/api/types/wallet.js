"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addressHistorySchema = void 0;
var _zod = require("zod");
var _zod_schemas = require("../../zod_schemas");
const addressHistorySchema = exports.addressHistorySchema = _zod.z.discriminatedUnion('success', [_zod.z.object({
  success: _zod.z.literal(true),
  history: _zod_schemas.IHistoryTxSchema.array(),
  has_more: _zod.z.boolean(),
  first_hash: _zod.z.string().nullable(),
  first_address: _zod.z.string().nullable()
}), _zod.z.object({
  success: _zod.z.literal(false),
  message: _zod.z.string()
})]);