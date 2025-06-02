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

test('TokenUid', () => {
  const serializer = new Serializer(new Network('testnet'));
  const token = Buffer.from(
    'cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe',
    'hex'
  );
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromTokenUid(token)).toMatchBuffer(Buffer.concat([Buffer.from([1]), token]));

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromTokenUid(Buffer.from([0]))).toMatchBuffer(Buffer.from([0]));
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

test('SizedBytes', () => {
  const serializer = new Serializer(new Network('testnet'));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSizedBytes(Buffer.from([0x74, 0x65, 0x73, 0x74]))).toMatchBuffer(
    Buffer.from([0x74, 0x65, 0x73, 0x74])
  );

  // Encoding a big string
  const bigBuffer = Buffer.from(Array(2048).fill('A').join(''), 'utf-8');
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSizedBytes(bigBuffer)).toMatchBuffer(bigBuffer);

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromSizedBytes(Buffer.from([0]))).toMatchBuffer(Buffer.from([0]));
});

test('Optional', () => {
  const serializer = new Serializer(new Network('testnet'));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(null, 'int')).toMatchBuffer(Buffer.from([0x00]));
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(serializer.fromOptional(300, 'int')).toMatchBuffer(
    Buffer.from('01ac02', 'hex')
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
        value: 300n,
      },
      'int'
    )
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  ).toMatchBuffer(Buffer.from([0xac, 0x02, 0x04, 0x74, 0x65, 0x73, 0x74]));

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'str',
        value: 'test',
      },
      'str'
    )
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  ).toMatchBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74, 0x04, 0x74, 0x65, 0x73, 0x74]));

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'bytes',
        value: Buffer.from('74657374', 'hex'),
      },
      'bytes'
    )
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  ).toMatchBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74, 0x04, 0x74, 0x65, 0x73, 0x74]));

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'bool',
        value: false,
      },
      'bool'
    )
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  ).toMatchBuffer(Buffer.from([0x00, 0x04, 0x74, 0x65, 0x73, 0x74]));

  expect(
    serializer.fromSignedData(
      {
        signature: Buffer.from('74657374', 'hex'),
        type: 'bool',
        value: true,
      },
      'bool'
    )
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  ).toMatchBuffer(Buffer.from([0x01, 0x04, 0x74, 0x65, 0x73, 0x74]));
});

test('int', () => {
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
    expect(serializer.fromInt(testCase[0] as bigint)).toEqual(testCase[1] as Buffer);
  }
});


test('Amount', () => {
  const DWARF5UnsignedTestCases: [bigint, Buffer][] = [
    [2n, Buffer.from([2])],
    [127n, Buffer.from([127])],
    [128n, Buffer.from([0x80, 1])],
    [129n, Buffer.from([1 + 0x80, 1])],
    [12857n, Buffer.from([57 + 0x80, 100])],
  ];
  const serializer = new Serializer(new Network('testnet'));
  for (const testCase of DWARF5UnsignedTestCases) {
    expect(serializer.fromAmount(testCase[0] as bigint)).toEqual(testCase[1] as Buffer);
  }
});
