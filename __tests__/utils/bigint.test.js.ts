/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { bigIntCoercibleSchema, JSONBigInt, parseJsonBigInt } from '../../src/utils/bigint';

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
  test('should parse numbers', () => {
    expect(JSONBigInt.parse('123')).toStrictEqual(123);
    expect(JSONBigInt.parse('123.456')).toStrictEqual(123.456);
    expect(JSONBigInt.parse('1.0')).toStrictEqual(1);
    expect(JSONBigInt.parse('1.000000000000')).toStrictEqual(1);
    expect(JSONBigInt.parse('12345678901234567890')).toStrictEqual(12345678901234567890n);
    expect(JSONBigInt.parse('12345678901234567890.000')).toStrictEqual(12345678901234567890n);
    expect(JSONBigInt.parse('1e2')).toStrictEqual(100);
    expect(JSONBigInt.parse('1E2')).toStrictEqual(100);

    expect(() => JSONBigInt.parse('12345678901234567890.1')).toThrow(
      Error('large float will lose precision! in "12345678901234567890.1"')
    );
  });

  test('should parse normal JSON', () => {
    expect(JSONBigInt.parse(nativeJson)).toStrictEqual(obj);
  });

  test('should stringify normal JSON', () => {
    expect(JSONBigInt.stringify(obj)).toStrictEqual(nativeJson);
  });

  test('should parse bigint', () => {
    expect(JSONBigInt.parse(bigIntJson)).toStrictEqual(bigIntObj);
  });

  test('should stringify bigint', () => {
    expect(JSONBigInt.stringify(bigIntObj)).toStrictEqual(bigIntJson);
  });
});

describe('test parseJsonBigInt', () => {
  test('should parse normal JSON', () => {
    expect(parseJsonBigInt(nativeJson, objSchema)).toStrictEqual(obj);
  });

  test('should parse object with small and large bigints', () => {
    expect(parseJsonBigInt(bigIntJson, bigIntObjSchema)).toStrictEqual(bigIntCoercedObj);
  });
});
