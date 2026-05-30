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
    // Doubles should be parsed normally as JS Numbers.
    expect(JSONBigInt.parse('123')).toStrictEqual(123);
    expect(JSONBigInt.parse('123.456')).toStrictEqual(123.456);
    expect(JSONBigInt.parse('1.0')).toStrictEqual(1);
    expect(JSONBigInt.parse('1.000000000000')).toStrictEqual(1);
    expect(JSONBigInt.parse('1e2')).toStrictEqual(100);
    expect(JSONBigInt.parse('1E2')).toStrictEqual(100);

    // This is 2**53-1 which is the MAX_SAFE_INTEGER, so it remains a Number, not a BigInt.
    // And the analogous for MIN_SAFE_INTEGER.
    expect(JSONBigInt.parse('9007199254740991')).toStrictEqual(9007199254740991);
    expect(JSONBigInt.parse('-9007199254740991')).toStrictEqual(-9007199254740991);

    // One more than the MAX_SAFE_INTEGER, so it becomes a BigInt. And the analogous for MIN_SAFE_INTEGER.
    expect(JSONBigInt.parse('9007199254740992')).toStrictEqual(9007199254740992n);
    expect(JSONBigInt.parse('-9007199254740992')).toStrictEqual(-9007199254740992n);

    // This is just a random large value that would lose precision as a Number.
    expect(JSONBigInt.parse('12345678901234567890')).toStrictEqual(12345678901234567890n);

    // This is 2n**63n, which is the max output value.
    expect(JSONBigInt.parse('9223372036854775808')).toStrictEqual(9223372036854775808n);

    // This is the value 2n**63n would have when converted to a Number with loss of precision,
    // and then some variation around it. Notice it's actually greater than 2n**63n.
    expect(JSONBigInt.parse('9223372036854776000')).toStrictEqual(9223372036854776000n);
    expect(JSONBigInt.parse('9223372036854775998')).toStrictEqual(9223372036854775998n);
    expect(JSONBigInt.parse('9223372036854775999')).toStrictEqual(9223372036854775999n);
    expect(JSONBigInt.parse('9223372036854776001')).toStrictEqual(9223372036854776001n);
    expect(JSONBigInt.parse('9223372036854776002')).toStrictEqual(9223372036854776002n);

    // This is 2n**63n - 800n and the value it would have when converted to a Number with loss of precision.
    // Notice it becomes less than the original value.
    expect(JSONBigInt.parse('9223372036854775008')).toStrictEqual(9223372036854775008n);
    expect(JSONBigInt.parse('9223372036854775000')).toStrictEqual(9223372036854775000n);
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

  test('does not corrupt string values that resemble the bigint marker', () => {
    // Only a NUL-prefixed sentinel is unquoted, so ordinary strings that merely
    // contain "bigint:<digits>" must round-trip untouched.
    const tricky = { note: 'bigint:123', mixed: 'x bigint:456 y' };
    expect(JSONBigInt.stringify(tricky)).toStrictEqual(JSON.stringify(tricky));
    expect(JSONBigInt.parse(JSONBigInt.stringify(tricky))).toStrictEqual(tricky);
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

describe('JSONBigInt without native JSON source text access (e.g. Hermes/JSC)', () => {
  // Simulates react-native engines that do not implement the "JSON source text
  // access" proposal: `JSON.parse` falls back to the core-js-pure ponyfill, and
  // BigInt stringify uses the native-JSON sentinel path (no `JSON.rawJSON`).
  let rawJSONDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    rawJSONDescriptor = Object.getOwnPropertyDescriptor(JSON, 'rawJSON');
    delete (JSON as { rawJSON?: unknown }).rawJSON;
    jest.resetModules();
  });

  afterEach(() => {
    if (rawJSONDescriptor) {
      Object.defineProperty(JSON, 'rawJSON', rawJSONDescriptor);
    }
    jest.resetModules();
  });

  test('falls back to the core-js ponyfill and still round-trips bigints', () => {
    // Sanity check: the native API must really be absent for this test to be meaningful.
    expect(typeof (JSON as { rawJSON?: unknown }).rawJSON).not.toBe('function');

    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { JSONBigInt: FallbackJSONBigInt } = require('../../src/utils/bigint');

    // The whole point of the fix: stringifying a bigint must not throw.
    expect(FallbackJSONBigInt.stringify(bigIntObj)).toStrictEqual(bigIntJson);
    expect(FallbackJSONBigInt.parse(bigIntJson)).toStrictEqual(bigIntObj);

    // Behaviour must match the native path for plain JSON and precision edges.
    expect(FallbackJSONBigInt.stringify(obj)).toStrictEqual(nativeJson);
    expect(FallbackJSONBigInt.parse('9007199254740991')).toStrictEqual(9007199254740991);
    expect(FallbackJSONBigInt.parse('9007199254740992')).toStrictEqual(9007199254740992n);
    expect(FallbackJSONBigInt.parse('123.456')).toStrictEqual(123.456);
  });
});
