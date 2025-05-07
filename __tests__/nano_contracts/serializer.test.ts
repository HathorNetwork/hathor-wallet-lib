/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Serializer from '../../src/nano_contracts/serializer';

test('Bool', () => {
  const serializer = new Serializer();
  // https://jestjs.io/docs/expect#toequalvalue recommends to compare buffers like this
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromBool(false)).toMatchBuffer(Buffer.from([0]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromBool(true)).toMatchBuffer(Buffer.from([1]));
});

test('String', () => {
  const serializer = new Serializer();
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromString('test')).toMatchBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]));
});

test('Int', () => {
  const serializer = new Serializer();
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromInt(300)).toMatchBuffer(Buffer.from([0x00, 0x00, 0x01, 0x2c]));
});

test('Bytes', () => {
  const serializer = new Serializer();
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromBytes(Buffer.from([0x74, 0x65, 0x73, 0x74]))).toMatchBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]));
});

test('Optional', () => {
  const serializer = new Serializer();
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'int')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(300, 'int')).toMatchBuffer(Buffer.from([0x01, 0x00, 0x00, 0x01, 0x2c]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'bool')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(true, 'bool')).toMatchBuffer(Buffer.from([0x01, 0x01]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'str')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional('test', 'str')).toMatchBuffer(Buffer.from([0x01, 0x04, 0x74, 0x65, 0x73, 0x74]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'bytes')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(Buffer.from([0x74, 0x65, 0x73, 0x74]), 'bytes')).toMatchBuffer(Buffer.from([0x01, 0x04, 0x74, 0x65, 0x73, 0x74]));
});

test('Signed', () => {
  const serializer = new Serializer();
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSigned('74657374,300,int')).toMatchBuffer(Buffer.from([0x00, 0x00, 0x01, 0x2c, 0x04, 0x74, 0x65, 0x73, 0x74]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSigned('74657374,300,VarInt')).toMatchBuffer(Buffer.from([0xac, 0x02, 0x04, 0x74, 0x65, 0x73, 0x74]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSigned('74657374,test,str')).toMatchBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74, 0x04, 0x74, 0x65, 0x73, 0x74]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSigned('74657374,74657374,bytes')).toMatchBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74, 0x04, 0x74, 0x65, 0x73, 0x74]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSigned('74657374,false,bool')).toMatchBuffer(Buffer.from([0x00, 0x04, 0x74, 0x65, 0x73, 0x74]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSigned('74657374,true,bool')).toMatchBuffer(Buffer.from([0x01, 0x04, 0x74, 0x65, 0x73, 0x74]));
});

test('VarInt', () => {
  const DWARF5TestCases = [
    [2n, Buffer.from([2])],
    [-2n, Buffer.from([0x7e])],
    [127n, Buffer.from([127 + 0x80, 0])],
    [-127n, Buffer.from([1 + 0x80, 0x7f])],
    [128n, Buffer.from([0 + 0x80, 1])],
    [-128n, Buffer.from([0 + 0x80, 0x7f])],
    [129n, Buffer.from([1 + 0x80, 1])],
    [-129n, Buffer.from([0x7f + 0x80, 0x7e])],
  ];
  const serializer = new Serializer();
  for (const testCase of DWARF5TestCases) {
    expect(serializer.fromVarInt(testCase[0] as bigint)).toEqual(testCase[1] as Buffer);
  }
});
