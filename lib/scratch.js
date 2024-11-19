// import { string, unknown, z } from 'zod';
// import { bigIntCoercibleSchema, parseJsonBigInt } from './utils/bigint';
//
//
// const tuple = ['b', 'value'] as const;
// type Tuple = typeof tuple;
// type UnionFromTuple = Tuple[number];
//
// type BigIntsOfTest = KeysOfType<Test, bigint>;
// type ObjectFromUnion<K extends PropertyKey> = { [P in K]: bigint };
// type TTT = ObjectFromUnion<UnionFromTuple>;
//
// function getSchema(keys: Tuple): BigIntsOfTest {
//   // ['a', 'b']
//   // 'a' | 'b'
//   // { a: bigint, b: bigint }
//   // extends BigIntsOfTest
//   return Object.fromEntries(keys.map(k => [k, 0n])) as BigIntsOfTest;
// }
//
// // const x = getSchema('a', 'b', 'value');
// const y = getSchema(['b', 'value']);
// // const w = getSchema('b');
//
// // const TestSchema = z.object({ value: z.bigint() }).passthrough();
// const TestSchema: z.ZodType<{ value: bigint }, z.ZodTypeDef, { value: bigint }> = z.object({
//   value: z.bigint(),
// });
//
// const json1: unknown = { a: 'a', value: 13 };
// const json2: string = '{"a": "a", "value":13}';
// const json3: unknown = { a: 'a', value: 12345678901234567890n };
// const json4: string = '{"a": "a", "value":12345678901234567890}';
//
// console.log(TestSchema.safeParse(json1));
// console.log(parseJsonBigInt(json2, TestSchema));
// console.log(TestSchema.safeParse(json3));
// console.log(parseJsonBigInt(json4, TestSchema));
//
// function satisfy<TSatisfied>(): <T extends TSatisfied>(value: T) => T {
//   return value => value;
// }
//
// function generate<K extends PropertyKey>(...keys: K[]): { [P in K]: bigint } {
//   return Object.fromEntries(keys.map(k => [k, 0n])) as { [P in K]: bigint };
// }
//
// const aa = ['a', 'b'] as const;
//
// type BB = typeof aa;
//
// const myFooObject = generate('value', 'b') satisfies BigIntsOfTest; // this satisfies also works if we fail to provide
// const a = myFooObject;
// const foo2 = satisfy<BigIntsOfTest>()(a);
//
// type Foo = typeof myFooObject extends BigIntsOfTest ? true : never;
// const f: Foo = true; // this works, it fails in compile time if the generate is called incorrectly
// /* type Foo = {
//     go: string;
//     start: string;
// } */
//
// console.log(myFooObject);
// /* {
//   "go": "",
//   "start": ""
// } */
//
"use strict";