/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
    // @ts-expect-error TypeScript hasn't been updated with the `context` argument from Node v22.
    return JSON.parse(text, this.bigIntReviver);
  },

  stringify(value: any, space?: string | number): string {
    return JSON.stringify(value, this.bigIntReplacer, space);
  },

  bigIntReviver(_key: string, value: any, context: { source: string }): any {
    if (typeof value !== 'number') {
      // No special handling needed for non-number values.
      return value;
    }

    try {
      const bigIntValue = BigInt(context.source);
      if (bigIntValue < Number.MIN_SAFE_INTEGER || bigIntValue > Number.MAX_SAFE_INTEGER) {
        // We only return the value as a BigInt if it's in the unsafe range.
        return bigIntValue;
      }

      // Otherwise, we can keep it as a Number.
      return value;
    } catch (e) {
      if (
        e instanceof SyntaxError &&
        (e.message === `Cannot convert ${context.source} to a BigInt` || e.message === `invalid BigInt syntax`)
      ) {
        // When this error happens, it means the number cannot be converted to a BigInt,
        // so it's a double, for example '123.456' or '1e2'.
        return value;
      }
      // This should never happen, any other error thrown by BigInt() is unexpected.
      const logger = getDefaultLogger();
      logger.error(`unexpected error in bigIntReviver: ${e}`);
      throw e;
    }
  },

  bigIntReplacer(_key: string, value_: any): any {
    // If the value is a BigInt, we simply return its string representation.
    // @ts-expect-error TypeScript hasn't been updated with the `rawJSON` function from Node v22.
    return typeof value_ === 'bigint' ? JSON.rawJSON(value_.toString()) : value_;
  },
  /* eslint-enable @typescript-eslint/no-explicit-any */
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
    logger.error(`error: ${result.error.message}\ncaused by input: ${JSONBigInt.stringify(data)}`);
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
 * A utility function to be used with `transformResponse` in Axios requests with support for `bigint` properties, powered by Zod schemas.
 *
 * If the JSON string contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 */
export function transformJsonBigIntResponse<T>(data: unknown, schema: ZodSchema<T>): T {
  return typeof data === 'string' ? parseJsonBigInt(data, schema) : parseSchema(data, schema);
}
