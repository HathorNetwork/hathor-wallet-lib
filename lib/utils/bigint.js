"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.bigIntCoercibleSchema = exports.JSONBigInt = void 0;
exports.jsonBigIntEncoding = jsonBigIntEncoding;
exports.parseJsonBigInt = parseJsonBigInt;
exports.parseSchema = parseSchema;
exports.transformJsonBigIntResponse = transformJsonBigIntResponse;
var _zod = require("zod");
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An object equivalent to the native global JSON, providing `parse()` and `stringify()` functions with compatible signatures, except
 * for the `reviver` and `replacer` parameters that are not supported to prevent accidental override of the custom BigInt behavior.
 *
 * If the JSON string to be parsed contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s,
 * and analogously for `stringify`. The `any` type is allowed as it conforms to the original signatures.
 */
const JSONBigInt = exports.JSONBigInt = {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  parse(text) {
    function bigIntReviver(_key, value, context) {
      if (!Number.isInteger(value)) {
        // No special handling needed for non-integer values.
        return value;
      }
      let {
        source
      } = context;
      if (source.includes('e') || source.includes('E')) {
        // We explicitly prohibit JSONs with exponential notation (such as 10e2) as they cannot be parsed to BigInt.
        throw Error(`exponential notation is not supported in "${text}"`);
      }
      if (source.includes('.')) {
        // If value is an integer and contains a '.', it must be like '123.0', so we extract the integer part only.
        let zeroes;
        [source, zeroes] = source.split('.');
        if (zeroes.split('').some(char => char !== '0')) {
          // This case shouldn't happen but we'll prohibit it to be safe. For example, if the source is
          // '12345678901234567890.1', JS will parse it as an integer with loss of precision, `12345678901234567000`.
          throw Error(`large float will lose precision! in "${text}"`);
        }
      }
      const bigIntValue = BigInt(source);
      if (bigIntValue !== BigInt(value)) {
        // If the parsed value is an integer and its BigInt representation is a different value,
        // it means we lost precision, so we return the BigInt.
        return bigIntValue;
      }

      // No special handling needed.
      return value;
    }

    // @ts-expect-error TypeScript hasn't been updated with the `context` argument from Node v22.
    return JSON.parse(text, bigIntReviver);
  },
  stringify(value, space) {
    return JSON.stringify(value, this.bigIntReplacer, space);
  },
  bigIntReplacer(_key, value_) {
    // If the value is a BigInt, we simply return its string representation.
    // @ts-expect-error TypeScript hasn't been updated with the `rawJSON` function from Node v22.
    return typeof value_ === 'bigint' ? JSON.rawJSON(value_.toString()) : value_;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
};

/**
 * A utility Zod schema for `bigint` properties that can be instantiated from a coercible type, that is, a `number`, `string`, or `bigint` itself.
 */
const bigIntCoercibleSchema = exports.bigIntCoercibleSchema = _zod.z.bigint().or(_zod.z.number()).or(_zod.z.string()).pipe(_zod.z.coerce.bigint());

/**
 * A type alias for a Zod schema with `unknown` input and generic output.
 */

/**
 * Parse some `unknown` data with a Zod schema. If parsing fails, it logs the error and throws.
 */
function parseSchema(data, schema) {
  const result = schema.safeParse(data);
  if (!result.success) {
    // TODO: How to log correctly?
    // eslint-disable-next-line no-console
    console.error(`error: ${result.error.message}\ncaused by input: ${JSONBigInt.stringify(data)}`);
    throw result.error;
  }
  return result.data;
}

/**
 * Parse some JSON string with a Zod schema.
 *
 * If the JSON string contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 *
 * If parsing fails, it logs the error and throws.
 */
function parseJsonBigInt(text, schema) {
  const jsonSchema = _zod.z.string().transform((str, ctx) => {
    try {
      return JSONBigInt.parse(str);
    } catch (e) {
      ctx.addIssue({
        code: _zod.z.ZodIssueCode.custom,
        message: `Could not parse with JSONBigInt. Error: ${e}`
      });
      return _zod.z.NEVER;
    }
  }).pipe(schema);
  return parseSchema(text, jsonSchema);
}

/**
 * A custom JSON encoding for LevelDB with support for `bigint` properties, powered by Zod schemas.
 *
 * If the resulting JSON contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 */
function jsonBigIntEncoding(schema) {
  return {
    name: 'json_bigint',
    format: 'utf8',
    encode(data) {
      return JSONBigInt.stringify(data);
    },
    decode(text) {
      return parseJsonBigInt(text, schema);
    }
  };
}

/**
 * A utility function to be used with `transformResponse` in Axios requests with support for `bigint` properties, powered by Zod schemas.
 *
 * If the JSON string contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 */
function transformJsonBigIntResponse(data, schema) {
  return typeof data === 'string' ? parseJsonBigInt(data, schema) : parseSchema(data, schema);
}