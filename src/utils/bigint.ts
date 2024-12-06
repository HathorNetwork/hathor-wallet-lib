/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IEncoding } from 'level-transcoder';
import { z } from 'zod';
import { getDefaultLogger } from '../types';

/**
 * An object equivalent to the native global JSON, providing `parse()` and `stringify()` functions with compatible signatures, except
 * for the `reviver` and `replacer` parameters that are not supported to prevent accidental override of the custom BigInt behavior.
 *
 * If the JSON string to be parsed contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s,
 * and analogously for `stringify`. The `any` type is allowed as it conforms to the original signatures.
 */
export const JSONBigInt = {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  parse(text: string): any {
    function bigIntReviver(_key: string, value: any, context: { source: string }): any {
      if (!Number.isInteger(value)) {
        // No special handling needed for non-integer values.
        return value;
      }

      let { source } = context;
      if (source.includes('e') || source.includes('E')) {
        // We explicitly prohibit JSONs with exponential notation (such as 10e2) as they cannot be parsed to BigInt.
        throw Error(`exponential notation is not supported in "${text}"`);
      }

      if (source.includes('.')) {
        // If value is an integer and contains a '.', it must be like '123.0', so we extract the integer part only.
        let zeroes: string;
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
    return JSON.parse(text, this.isAvailable() ? bigIntReviver : undefined);
  },

  stringify(value: any, space?: string | number): string {
    function bigIntReplacer(_key: string, value_: any): any {
      // If the value is a BigInt, we simply return its string representation.
      // @ts-expect-error TypeScript hasn't been updated with the `rawJSON` function from Node v22.
      return typeof value_ === 'bigint' ? JSON.rawJSON(value_.toString()) : value_;
    }

    return JSON.stringify(value, this.isAvailable() ? bigIntReplacer : undefined, space);
  },
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /**
   * Utility function for checking if JSONBigInt is available. We shouldn't allow it to be used if it's not available,
   * however we temporarily keep Node v20 in our CI, so we have to allow it for tests.
   * After QA is done to test Node v22 and we remove v20 from CI, we may remove this function.
   */
  isAvailable(): boolean {
    const major = process.versions.node.split('.')[0];
    return Number(major) >= 22;
  },
};

/**
 * A utility Zod schema for `bigint` properties that can be instantiated from a coercible type, that is, a `number`, `string`, or `bigint` itself.
 */
export const bigIntCoercibleSchema = z
  .bigint()
  .or(z.number())
  .or(z.string())
  .pipe(z.coerce.bigint());

/**
 * A type alias for a Zod schema with `unknown` input and generic output.
 */
export type ZodSchema<T> = z.ZodSchema<T, z.ZodTypeDef, unknown>;

/**
 * Parse some `unknown` data with a Zod schema. If parsing fails, it logs the error and throws.
 */
export function parseSchema<T>(data: unknown, schema: ZodSchema<T>): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const logger = getDefaultLogger();
    logger.error(`error: ${result.error.message}\ncaused by input: ${data}`);
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
export function parseJsonBigInt<T>(text: string, schema: ZodSchema<T>): T {
  const jsonSchema = z
    .string()
    .transform((str, ctx) => {
      try {
        return JSONBigInt.parse(str);
      } catch (e) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Could not parse with JSONBigInt. Error: ${e}`,
        });
        return z.NEVER;
      }
    })
    .pipe(schema);

  return parseSchema(text, jsonSchema);
}

/**
 * A custom JSON encoding for LevelDB with support for `bigint` properties, powered by Zod schemas.
 *
 * If the resulting JSON contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 */
export function jsonBigIntEncoding<T>(schema: ZodSchema<T>): IEncoding<T, string, T> {
  return {
    name: 'json_bigint',
    format: 'utf8',
    encode(data: T): string {
      return JSONBigInt.stringify(data);
    },
    decode(text: string): T {
      return parseJsonBigInt(text, schema);
    },
  };
}

/**
 * A utility function to be used with `transformResponse` in Axios requests with support for `bigint` properties, powered by Zod schemas.
 *
 * If the JSON string contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 */
export function transformJsonBigIntResponse<T>(data: unknown, schema: ZodSchema<T>): T {
  return typeof data === 'string' ? parseJsonBigInt(data, schema) : parseSchema(data, schema);
}
