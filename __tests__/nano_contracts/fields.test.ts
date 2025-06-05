/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { getFieldParser } from '../../src/nano_contracts/ncTypes/parser';
import Network from '../../src/models/network';
import ncFields from '../../src/nano_contracts/fields';
import { NATIVE_TOKEN_UID } from '../../src/constants';

const network = new Network('testnet');

describe('str', () => {
  it('should serialize from user input', () => {
    const field = getFieldParser('str', network);
    expect(field).toBeInstanceOf(ncFields.StrField);
    field.fromUser('test');
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]));
  });

  it('should deserialize buffer value', () => {
    const field = getFieldParser('str', network);
    expect(field).toBeInstanceOf(ncFields.StrField);
    field.fromBuffer(Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]));
    expect(field.toUser()).toStrictEqual('test');
  });

  it('should work with big strings', () => {
    // Encoding a big string
    const bigStr = Array(2048).fill('A').join('');
    const bigUtf8 = Buffer.from(bigStr, 'utf-8');

    const field = getFieldParser('str', network);
    expect(field).toBeInstanceOf(ncFields.StrField);
    field.fromUser(bigStr);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(
      Buffer.concat([
        Buffer.from([0x80, 0x10]), // 2048 in unsigned leb128
        bigUtf8,
      ])
    );
  });
});

describe('bool', () => {
  it('should serialize from boolean user input', () => {
    const field = getFieldParser('bool', network);
    expect(field).toBeInstanceOf(ncFields.BoolField);
    field.fromUser(true);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(Buffer.from([0x01]));

    field.fromUser(false);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(Buffer.from([0x00]));
  });

  it('should serialize from string user input', () => {
    const field = getFieldParser('bool', network);
    expect(field).toBeInstanceOf(ncFields.BoolField);
    field.fromUser('true');
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(Buffer.from([0x01]));

    field.fromUser('false');
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(Buffer.from([0x00]));
  });

  it('should deserialize buffer value', () => {
    const field = getFieldParser('bool', network);
    expect(field).toBeInstanceOf(ncFields.BoolField);
    field.fromBuffer(Buffer.from([0x01]));
    expect(field.toUser()).toStrictEqual('true');

    field.fromBuffer(Buffer.from([0x00]));
    expect(field.toUser()).toStrictEqual('false');
  });
});

describe('int', () => {
  function checkTestCase(value: bigint, buf: Buffer) {
    // Serialize value to buffer
    const field1 = getFieldParser('int', network);
    expect(field1).toBeInstanceOf(ncFields.IntField);
    field1.fromUser(value);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field1.toBuffer()).toMatchBuffer(buf);

    // Parse buffer to value
    const field2 = getFieldParser('int', network);
    expect(field2).toBeInstanceOf(ncFields.IntField);

    const parse = field2.fromBuffer(buf);
    expect(parse).toMatchObject({
      value,
      bytesRead: buf.length,
    });
    expect(field1.toUser()).toStrictEqual(String(value));
  }

  const DWARF5SignedTestCases: [bigint, Buffer][] = [
    [2n, Buffer.from([2])],
    [-2n, Buffer.from([0x7e])],
    [127n, Buffer.from([127 + 0x80, 0])],
    [-127n, Buffer.from([1 + 0x80, 0x7f])],
    [128n, Buffer.from([0 + 0x80, 1])],
    [-128n, Buffer.from([0 + 0x80, 0x7f])],
    [129n, Buffer.from([1 + 0x80, 1])],
    [-129n, Buffer.from([0x7f + 0x80, 0x7e])],
  ];

  // eslint-disable-next-line jest/expect-expect
  it('should work with the common test cases', () => {
    for (const testCase of DWARF5SignedTestCases) {
      checkTestCase(testCase[0], testCase[1]);
    }
  });
});

describe('bytes', () => {
  it('should serialize from user input', () => {
    const field = getFieldParser('bytes', network);
    expect(field).toBeInstanceOf(ncFields.BytesField);
    field.fromUser('cafe');
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(Buffer.from([0x02, 0xca, 0xfe]));
  });

  it('should deserialize buffer value', () => {
    const field = getFieldParser('bytes', network);
    expect(field).toBeInstanceOf(ncFields.BytesField);
    field.fromBuffer(Buffer.from([0x02, 0xca, 0xfe]));
    expect(field.toUser()).toStrictEqual('cafe');
  });
});

describe('bytes32', () => {
  const customToken = 'cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe';
  const customTokenBuf = Buffer.from(customToken, 'hex');

  it('should serialize from user input', () => {
    const field = getFieldParser('VertexId', network);
    expect(field).toBeInstanceOf(ncFields.VertexIdField);
    field.fromUser(customToken);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(customTokenBuf);
  });

  it('should deserialize buffer value', () => {
    const field = getFieldParser('VertexId', network);
    expect(field).toBeInstanceOf(ncFields.VertexIdField);
    field.fromBuffer(customTokenBuf);
    expect(field.toUser()).toStrictEqual(customToken);
  });
});

describe('Amount', () => {
  function checkTestCase(value: bigint, buf: Buffer) {
    // Serialize value to buffer
    const field1 = getFieldParser('Amount', network);
    expect(field1).toBeInstanceOf(ncFields.AmountField);
    field1.fromUser(value);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field1.toBuffer()).toMatchBuffer(buf);

    // Parse buffer to value
    const field2 = getFieldParser('Amount', network);
    expect(field2).toBeInstanceOf(ncFields.AmountField);

    const parse = field2.fromBuffer(buf);
    expect(parse).toMatchObject({
      value,
      bytesRead: buf.length,
    });
    expect(field1.toUser()).toStrictEqual(String(value));
  }

  const DWARF5UnsignedTestCases: [bigint, Buffer][] = [
    [2n, Buffer.from([2])],
    [127n, Buffer.from([127])],
    [128n, Buffer.from([0x80, 1])],
    [129n, Buffer.from([1 + 0x80, 1])],
    [12857n, Buffer.from([57 + 0x80, 100])],
  ];

  // eslint-disable-next-line jest/expect-expect
  it('should work with the common test cases', () => {
    for (const testCase of DWARF5UnsignedTestCases) {
      checkTestCase(testCase[0], testCase[1]);
    }
  });
});

describe('TokenUid', () => {
  const customToken = 'cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe';
  const customTokenBuf = Buffer.from(customToken, 'hex');

  it('should serialize custom tokens from user input', () => {
    const field = getFieldParser('TokenUid', network);
    expect(field).toBeInstanceOf(ncFields.TokenUidField);
    field.fromUser(customToken);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(Buffer.concat([Buffer.from([1]), customTokenBuf]));
  });

  it('should serialize HTR from user input', () => {
    const field = getFieldParser('TokenUid', network);
    expect(field).toBeInstanceOf(ncFields.TokenUidField);
    field.fromUser(NATIVE_TOKEN_UID);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(Buffer.from([0]));
  });

  it('should deserialize custom token from buffer', () => {
    const field = getFieldParser('TokenUid', network);
    expect(field).toBeInstanceOf(ncFields.TokenUidField);
    field.fromBuffer(Buffer.concat([Buffer.from([1]), customTokenBuf]));
    expect(field.toUser()).toStrictEqual(customToken);
  });

  it('should deserialize HTR from buffer', () => {
    const field = getFieldParser('TokenUid', network);
    expect(field).toBeInstanceOf(ncFields.TokenUidField);
    field.fromBuffer(Buffer.from([0]));
    expect(field.toUser()).toStrictEqual(NATIVE_TOKEN_UID);
  });
});

describe('optional', () => {
  it('should work for None/null values', () => {
    const fieldStr = getFieldParser('str?', network);
    expect(fieldStr).toBeInstanceOf(ncFields.OptionalField);
    fieldStr.fromUser(null);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldStr.toBuffer()).toMatchBuffer(Buffer.from([0]));

    const fieldInt = getFieldParser('int?', network);
    expect(fieldInt).toBeInstanceOf(ncFields.OptionalField);
    fieldInt.fromUser(null);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldInt.toBuffer()).toMatchBuffer(Buffer.from([0]));

    const fieldBool = getFieldParser('bool?', network);
    expect(fieldBool).toBeInstanceOf(ncFields.OptionalField);
    fieldBool.fromUser(null);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldBool.toBuffer()).toMatchBuffer(Buffer.from([0]));

    const fieldBytes = getFieldParser('bytes?', network);
    expect(fieldBytes).toBeInstanceOf(ncFields.OptionalField);
    fieldBytes.fromUser(null);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldBytes.toBuffer()).toMatchBuffer(Buffer.from([0]));
  });

  it('should work with simple values', () => {
    const fieldStr = getFieldParser('str?', network);
    expect(fieldStr).toBeInstanceOf(ncFields.OptionalField);
    fieldStr.fromUser('test');
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldStr.toBuffer()).toMatchBuffer(Buffer.from([0x01, 0x04, 0x74, 0x65, 0x73, 0x74]));

    const fieldInt = getFieldParser('int?', network);
    expect(fieldInt).toBeInstanceOf(ncFields.OptionalField);
    fieldInt.fromUser(127);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldInt.toBuffer()).toMatchBuffer(Buffer.from([0x01, 127 + 0x80, 0]));

    const fieldBoolT = getFieldParser('bool?', network);
    expect(fieldBoolT).toBeInstanceOf(ncFields.OptionalField);
    fieldBoolT.fromUser(true);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldBoolT.toBuffer()).toMatchBuffer(Buffer.from([1, 1]));

    const fieldBoolF = getFieldParser('bool?', network);
    expect(fieldBoolF).toBeInstanceOf(ncFields.OptionalField);
    fieldBoolF.fromUser(false);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldBoolF.toBuffer()).toMatchBuffer(Buffer.from([1, 0]));

    const fieldBytes = getFieldParser('bytes?', network);
    expect(fieldBytes).toBeInstanceOf(ncFields.OptionalField);
    fieldBytes.fromUser('cafe');
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldBytes.toBuffer()).toMatchBuffer(Buffer.from([0x01, 0x02, 0xca, 0xfe]));
  });
});

describe('SignedData', () => {
  const signature = getFieldParser('bytes', network).fromUser('cafe').toBuffer();

  it('should serialize from user input', () => {
    const fieldStr = getFieldParser('SignedData[str]', network);
    expect(fieldStr).toBeInstanceOf(ncFields.SignedDataField);
    fieldStr.fromUser({
      type: 'str',
      signature: 'cafe',
      value: 'test',
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldStr.toBuffer()).toMatchBuffer(
      Buffer.concat([Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), signature])
    );

    const fieldInt = getFieldParser('SignedData[int]', network);
    expect(fieldInt).toBeInstanceOf(ncFields.SignedDataField);
    fieldInt.fromUser({
      type: 'int',
      signature: 'cafe',
      value: '129',
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldInt.toBuffer()).toMatchBuffer(
      Buffer.concat([Buffer.from([1 + 0x80, 1]), signature])
    );
  });
});

describe('Tuple', () => {
  it('should serialize from user input using simple types', () => {
    const field = getFieldParser('tuple[str, int]', network);
    expect(field).toBeInstanceOf(ncFields.TupleField);
    field.fromUser(['test', '129']);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(
      Buffer.concat([Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), Buffer.from([1 + 0x80, 1])])
    );
  });

  it('should serialize from user input using container types', () => {
    const field = getFieldParser('tuple[tuple[str, int?], int]', network);
    expect(field).toBeInstanceOf(ncFields.TupleField);
    field.fromUser([['test', null], '129']);
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(
      Buffer.concat([
        Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), // test
        Buffer.from([0x00]), // null
        Buffer.from([1 + 0x80, 1]), // 129
      ])
    );
  });
});
