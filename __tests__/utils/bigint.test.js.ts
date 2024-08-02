/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { bigIntCoercibleSchema, JSONBigInt, parseJsonBigInt } from '../../src/utils/bigint';
import { z } from 'zod';

const obj = {
  a: 123,
  b: 123.456,
  c: 'testing',
  d: null,
  e: true,
  f: [123, 123.456, 'testing', null],
  g: {
    a: 123,
    b: 123.456,
    c: 'testing',
    d: null,
    e: true,
    f: [123, 123.456, 'testing', null],
  },
};
const nativeJson = JSON.stringify(obj);

const bigIntJson = '{"large":12345678901234567890,"small":123}';
const bigIntObj = { large: 12345678901234567890n, small: 123 };
const bigIntCoercedObj = { large: 12345678901234567890n, small: 123n };

const objSchema = z.object({
  a: z.number(),
  b: z.number(),
  c: z.string(),
  d: z.null(),
  e: z.boolean(),
  f: z.tuple([z.number(), z.number(), z.string(), z.null()]),
  g: z.object({
    a: z.number(),
    b: z.number(),
    c: z.string(),
    d: z.null(),
    e: z.boolean(),
    f: z.tuple([z.number(), z.number(), z.string(), z.null()]),
  }),
});

const bigIntObjSchema = z.object({
  large: bigIntCoercibleSchema,
  small: bigIntCoercibleSchema,
});

describe('test JSONBigInt', () => {
  test('should parse normal JSON', () => {
    expect(JSONBigInt.parse(nativeJson)).toEqual(obj);
  });

  test('should stringify normal JSON', () => {
    expect(JSONBigInt.stringify(obj)).toStrictEqual(nativeJson);
  });

  test('should parse bigint', () => {
    expect(JSONBigInt.parse(bigIntJson)).toEqual(bigIntObj);
  });

  test('should stringify bigint', () => {
    expect(JSONBigInt.stringify(bigIntObj)).toStrictEqual(bigIntJson);
  });
});

describe('test parseJsonBigInt', () => {
  test('should parse object with small and large bigints', () => {
    expect(parseJsonBigInt(bigIntJson, bigIntObjSchema)).toEqual(bigIntCoercedObj);
  });
});
