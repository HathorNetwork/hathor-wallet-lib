/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Serializer from '../../src/nano_contracts/serializer';
import Network from '../../src/models/network';

test('Bool', () => {
  const serializer = new Serializer(new Network('testnet'));
  // https://jestjs.io/docs/expect#toequalvalue recommends to compare buffers like this
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromBool(false)).toMatchBuffer(Buffer.from([0]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromBool(true)).toMatchBuffer(Buffer.from([1]));
});

test('String', () => {
  const serializer = new Serializer(new Network('testnet'));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromString('test')).toMatchBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]));

  // Encoding a big string
  const bigStr = Array(2048).fill('A').join('');
  const bigUtf8 = Buffer.from(bigStr, 'utf-8');
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromString(bigStr)).toMatchBuffer(
    Buffer.concat([
      Buffer.from([0x80, 0x10]), // 2048 in unsigned leb128
      bigUtf8,
    ])
  );
});

test('Int', () => {
  const serializer = new Serializer(new Network('testnet'));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromInt(300)).toMatchBuffer(Buffer.from([0x00, 0x00, 0x01, 0x2c]));
});

test('Bytes', () => {
  const serializer = new Serializer(new Network('testnet'));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromBytes(Buffer.from([0x74, 0x65, 0x73, 0x74]))).toMatchBuffer(
    Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74])
  );

  // Encoding a big string
  const bigBuffer = Buffer.from(Array(2048).fill('A').join(''), 'utf-8');
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromBytes(bigBuffer)).toMatchBuffer(
    Buffer.concat([
      Buffer.from([0x80, 0x10]), // 2048 in unsigned leb128
      bigBuffer,
    ])
  );
});

test('Optional', () => {
  const serializer = new Serializer(new Network('testnet'));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'int')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(300, 'int')).toMatchBuffer(
    Buffer.from([0x01, 0x00, 0x00, 0x01, 0x2c])
  );

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'bool')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(true, 'bool')).toMatchBuffer(Buffer.from([0x01, 0x01]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'str')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional('test', 'str')).toMatchBuffer(
    Buffer.from([0x01, 0x04, 0x74, 0x65, 0x73, 0x74])
  );

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'bytes')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(Buffer.from([0x74, 0x65, 0x73, 0x74]), 'bytes')).toMatchBuffer(
    Buffer.from([0x01, 0x04, 0x74, 0x65, 0x73, 0x74])
  );
});

test('SignedData', () => {
  const serializer = new Serializer(new Network('testnet'));
  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'int',
        value: [Buffer.from('6e634944', 'hex'), 300],
      },
      'int'
      // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    )
  ).toMatchBuffer(
    // 4 + ncId + value + 4 + test
    Buffer.from([
      0x04, 0x6e, 0x63, 0x49, 0x44, 0x00, 0x00, 0x01, 0x2c, 0x04, 0x74, 0x65, 0x73, 0x74,
    ])
  );

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'VarInt',
        value: [Buffer.from('6e634944', 'hex'), 300n],
      },
      'VarInt'
      // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    )
  ).toMatchBuffer(
    Buffer.from([0x04, 0x6e, 0x63, 0x49, 0x44, 0xac, 0x02, 0x04, 0x74, 0x65, 0x73, 0x74])
  );

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'str',
        value: [Buffer.from('6e634944', 'hex'), 'test'],
      },
      'str'
      // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    )
  ).toMatchBuffer(
    Buffer.from([
      0x04, 0x6e, 0x63, 0x49, 0x44, 0x04, 0x74, 0x65, 0x73, 0x74, 0x04, 0x74, 0x65, 0x73, 0x74,
    ])
  );

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'bytes',
        value: [Buffer.from('6e634944', 'hex'), Buffer.from('74657374', 'hex')],
      },
      'bytes'
      // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    )
  ).toMatchBuffer(
    Buffer.from([
      0x04, 0x6e, 0x63, 0x49, 0x44, 0x04, 0x74, 0x65, 0x73, 0x74, 0x04, 0x74, 0x65, 0x73, 0x74,
    ])
  );

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'bool',
        value: [Buffer.from('6e634944', 'hex'), false],
      },
      'bool'
      // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    )
  ).toMatchBuffer(Buffer.from([0x04, 0x6e, 0x63, 0x49, 0x44, 0x00, 0x04, 0x74, 0x65, 0x73, 0x74]));

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'bool',
        value: [Buffer.from('6e634944', 'hex'), true],
      },
      'bool'
      // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    )
  ).toMatchBuffer(Buffer.from([0x04, 0x6e, 0x63, 0x49, 0x44, 0x01, 0x04, 0x74, 0x65, 0x73, 0x74]));
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
  const serializer = new Serializer(new Network('testnet'));
  for (const testCase of DWARF5TestCases) {
    expect(serializer.fromVarInt(testCase[0] as bigint)).toEqual(testCase[1] as Buffer);
  }
});
