// import { string, unknown, z } from 'zod';
// import { bigIntCoercibleSchema, stringToJsonBigIntSchema } from './utils/bigint';
//
// interface I {
//   a: bigint;
//   b: bigint;
//   c: string;
// }
//
// interface I2 {
//   x: bigint;
//   y: bigint;
//   z: number;
// }
//
// type KeysOfType<T, U> = {
//   [K in keyof T as T[K] extends U ? K : never]: U;
// };
//
// function getObjectFromKeys<K extends PropertyKey>(...keys: K[]): { [P in K]: bigint } {
//   return Object.fromEntries(keys.map(k => [k, 0n])) as { [P in K]: bigint };
// }
//
// function getParser<T>(obj: KeysOfType<T, bigint>): (text: string) => z.SafeParseReturnType<string, T> {
//   const keys = Object.keys(obj);
//   const fields = Object.fromEntries(keys.map(k => [k, bigIntCoercibleSchema]));
//   return text => stringToJsonBigIntSchema.pipe(z.object(fields).passthrough()).safeParse(text) as z.SafeParseReturnType<string, T>;
// }
//
// const parser = getParser<I2>(getObjectFromKeys('x', 'y'));
// const result = parser('{"x": 0, "y": 12345678901234567890, "z": 2234}');
//
// console.log(result);
"use strict";