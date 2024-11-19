/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { IEncoding } from 'level-transcoder';
import { z } from 'zod';
/**
 * An object equivalent to the native global JSON, providing `parse()` and `stringify()` functions with compatible signatures, except
 * for the `reviver` and `replacer` parameters that are not supported to prevent accidental override of the custom BigInt behavior.
 *
 * If the JSON string to be parsed contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s,
 * and analogously for `stringify`. The `any` type is allowed as it conforms to the original signatures.
 */
export declare const JSONBigInt: {
    parse(text: string): any;
    stringify(value: any, space?: string | number): string;
    bigIntReplacer(_key: string, value_: any): any;
};
/**
 * A utility Zod schema for `bigint` properties that can be instantiated from a coercible type, that is, a `number`, `string`, or `bigint` itself.
 */
export declare const bigIntCoercibleSchema: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
/**
 * A type alias for a Zod schema with `unknown` input and generic output.
 */
export type ZodSchema<T> = z.ZodSchema<T, z.ZodTypeDef, unknown>;
/**
 * Parse some `unknown` data with a Zod schema. If parsing fails, it logs the error and throws.
 */
export declare function parseSchema<T>(data: unknown, schema: ZodSchema<T>): T;
/**
 * Parse some JSON string with a Zod schema.
 *
 * If the JSON string contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 *
 * If parsing fails, it logs the error and throws.
 */
export declare function parseJsonBigInt<T>(text: string, schema: ZodSchema<T>): T;
/**
 * A custom JSON encoding for LevelDB with support for `bigint` properties, powered by Zod schemas.
 *
 * If the resulting JSON contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 */
export declare function jsonBigIntEncoding<T>(schema: ZodSchema<T>): IEncoding<T, string, T>;
/**
 * A utility function to be used with `transformResponse` in Axios requests with support for `bigint` properties, powered by Zod schemas.
 *
 * If the JSON string contains large integers that would lose precision with the `number` type, they're parsed as `bigint`s.
 * This means that `z.bigint()` properties would fail for small integers, as they would be parsed as `number`s.
 * To mitigate this, use the `bigIntCoercibleSchema` utility, which will coerce the property to a `bigint` output.
 */
export declare function transformJsonBigIntResponse<T>(data: unknown, schema: ZodSchema<T>): T;
//# sourceMappingURL=bigint.d.ts.map