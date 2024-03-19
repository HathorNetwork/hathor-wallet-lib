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
  expect(serializer.fromBool(false).equals(Buffer.from([0]))).toBe(true);
  expect(serializer.fromBool(true).equals(Buffer.from([1]))).toBe(true);
})

test('String', () => {
  const serializer = new Serializer();
  expect(serializer.fromString('test').equals(Buffer.from([0x74, 0x65, 0x73, 0x74]))).toBe(true);
})

test('Int', () => {
  const serializer = new Serializer();
  expect(serializer.fromInt(300).equals(Buffer.from([0x00, 0x00, 0x01, 0x2c]))).toBe(true);
})

test('Bytes', () => {
  const serializer = new Serializer();
  expect(serializer.fromBytes([0x74, 0x65, 0x73, 0x74]).equals(Buffer.from([0x74, 0x65, 0x73, 0x74]))).toBe(true);
})

test('Float', () => {
  const serializer = new Serializer();
  expect(serializer.fromFloat(10.32134).equals(Buffer.from([0x40, 0x24, 0xa4, 0x86, 0xad, 0x2d, 0xcb, 0x14]))).toBe(true);
})

test('List', () => {
  const serializer = new Serializer();
  expect(serializer.fromList([1, 2, 3], 'int').equals(Buffer.from([0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03]))).toBe(true);

  expect(serializer.fromList(['test1', 'test2'], 'str').equals(Buffer.from([0x00, 0x02, 0x74, 0x65, 0x73, 0x74, 0x31, 0x74, 0x65, 0x73, 0x74, 0x32]))).toBe(true);

  expect(serializer.fromList([true, false, false, false, true], 'bool').equals(Buffer.from([0x00, 0x05, 0x01, 0x00, 0x00, 0x00, 0x01]))).toBe(true);

  expect(serializer.fromList([[0x74, 0x65, 0x73, 0x74], [0x74, 0x65, 0x73, 0x74]], 'bytes').equals(Buffer.from([0x00, 0x02, 0x74, 0x65, 0x73, 0x74, 0x74, 0x65, 0x73, 0x74]))).toBe(true);

  expect(serializer.fromList([10.32134, 10.32134], 'float').equals(Buffer.from([0x00, 0x02, 0x40, 0x24, 0xa4, 0x86, 0xad, 0x2d, 0xcb, 0x14, 0x40, 0x24, 0xa4, 0x86, 0xad, 0x2d, 0xcb, 0x14]))).toBe(true);
})

test('Optional', () => {
  const serializer = new Serializer();
  expect(serializer.fromOptional(true, undefined, 'int').equals(Buffer.from([0x00]))).toBe(true);
  expect(serializer.fromOptional(false, 300, 'int').equals(Buffer.from([0x01, 0x00, 0x00, 0x01, 0x2c]))).toBe(true);

  expect(serializer.fromOptional(true, undefined, 'bool').equals(Buffer.from([0x00]))).toBe(true);
  expect(serializer.fromOptional(false, true, 'bool').equals(Buffer.from([0x01, 0x01]))).toBe(true);

  expect(serializer.fromOptional(true, undefined, 'str').equals(Buffer.from([0x00]))).toBe(true);
  expect(serializer.fromOptional(false, 'test', 'str').equals(Buffer.from([0x01, 0x74, 0x65, 0x73, 0x74]))).toBe(true);

  expect(serializer.fromOptional(true, undefined, 'bytes').equals(Buffer.from([0x00]))).toBe(true);
  expect(serializer.fromOptional(false, [0x74, 0x65, 0x73, 0x74], 'bytes').equals(Buffer.from([0x01, 0x74, 0x65, 0x73, 0x74]))).toBe(true);

  expect(serializer.fromOptional(true, undefined, 'float').equals(Buffer.from([0x00]))).toBe(true);
  expect(serializer.fromOptional(false, 10.32134, 'float').equals(Buffer.from([0x01, 0x40, 0x24, 0xa4, 0x86, 0xad, 0x2d, 0xcb, 0x14]))).toBe(true);
})

test('Signed', () => {
  const serializer = new Serializer();
  expect(serializer.fromSigned('74657374,300,int').equals(Buffer.from([0x00, 0x04, 0x00, 0x00, 0x01, 0x2c, 0x74, 0x65, 0x73, 0x74]))).toBe(true);

  expect(serializer.fromSigned('74657374,test,str').equals(Buffer.from([0x00, 0x04, 0x74, 0x65, 0x73, 0x74, 0x74, 0x65, 0x73, 0x74]))).toBe(true);

  expect(serializer.fromSigned('74657374,74657374,bytes').equals(Buffer.from([0x00, 0x04, 0x74, 0x65, 0x73, 0x74, 0x74, 0x65, 0x73, 0x74]))).toBe(true);

  expect(serializer.fromSigned('74657374,10.32134,float').equals(Buffer.from([0x00, 0x08, 0x40, 0x24, 0xa4, 0x86, 0xad, 0x2d, 0xcb, 0x14, 0x74, 0x65, 0x73, 0x74]))).toBe(true);

  expect(serializer.fromSigned('74657374,false,bool').equals(Buffer.from([0x00, 0x01, 0x00, 0x74, 0x65, 0x73, 0x74]))).toBe(true);
  expect(serializer.fromSigned('74657374,true,bool').equals(Buffer.from([0x00, 0x01, 0x01, 0x74, 0x65, 0x73, 0x74]))).toBe(true);
})
