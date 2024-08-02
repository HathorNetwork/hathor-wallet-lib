/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IEncoding } from 'level-transcoder';
import configureJsonBigInt from 'json-bigint';
import { z } from 'zod';

/**
 * An object equivalent to the native global JSON, providing `parse()` and `stringify()` functions with compatible signatures.
 *
 * If the JSON string to be parsed contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 */
export const JSONBigInt = configureJsonBigInt({ useNativeBigInt: true });

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
    console.error(`error: ${result.error.message}\ncaused by input: ${data}`);
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
