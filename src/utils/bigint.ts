/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IEncoding } from 'level-transcoder';
import configureJsonBigInt from 'json-bigint';
import { z } from 'zod';

import { ZodSchema } from '../zod_schemas';

export const JSONBigInt = configureJsonBigInt({ useNativeBigInt: true });

export const bigIntCoercibleSchema = z
  .bigint()
  .or(z.number())
  .or(z.string())
  .pipe(z.coerce.bigint());

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

export function parseSchema<T>(data: unknown, schema: ZodSchema<T>): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    console.error(`error: ${result.error.message}\ncaused by input: ${data}`);
    throw result.error;
  }

  return result.data;
}

export function jsonWithBigIntEncoding<T>(schema: ZodSchema<T>): IEncoding<T, string, T> {
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

export function transformJsonBigIntResponse<T>(data: unknown, schema: ZodSchema<T>): T {
  return typeof data === 'string' ? parseJsonBigInt(data, schema) : parseSchema(data, schema);
}
