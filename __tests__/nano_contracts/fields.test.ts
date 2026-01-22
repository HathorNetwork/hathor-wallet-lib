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
import leb128 from '../../src/utils/leb128';
import { DWARF5SignedTestCases, DWARF5UnsignedTestCases } from '../__fixtures__/leb128';

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
  it('should serialize for null values', () => {
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

  it('should serialize with simple values', () => {
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

  it('should deserialize for null values', () => {
    const nullBuffer = Buffer.from([0]);

    const fieldStr = getFieldParser('str?', network);
    expect(fieldStr).toBeInstanceOf(ncFields.OptionalField);
    fieldStr.fromBuffer(nullBuffer);
    expect(fieldStr.toUser()).toBeNull();

    const fieldInt = getFieldParser('int?', network);
    expect(fieldInt).toBeInstanceOf(ncFields.OptionalField);
    fieldInt.fromBuffer(nullBuffer);
    expect(fieldInt.toUser()).toBeNull();

    const fieldBool = getFieldParser('bool?', network);
    expect(fieldBool).toBeInstanceOf(ncFields.OptionalField);
    fieldBool.fromBuffer(nullBuffer);
    expect(fieldBool.toUser()).toBeNull();

    const fieldBytes = getFieldParser('bytes?', network);
    expect(fieldBytes).toBeInstanceOf(ncFields.OptionalField);
    fieldBytes.fromBuffer(nullBuffer);
    expect(fieldBytes.toUser()).toBeNull();
  });

  it('should deserialize with simple values', () => {
    const fieldStr = getFieldParser('str?', network);
    expect(fieldStr).toBeInstanceOf(ncFields.OptionalField);
    fieldStr.fromBuffer(Buffer.from([0x01, 0x04, 0x74, 0x65, 0x73, 0x74]));
    expect(fieldStr.toUser()).toEqual('test');

    const fieldInt = getFieldParser('int?', network);
    expect(fieldInt).toBeInstanceOf(ncFields.OptionalField);
    fieldInt.fromBuffer(Buffer.from([0x01, 127 + 0x80, 0]));
    expect(fieldInt.toUser()).toEqual('127');

    const fieldBoolT = getFieldParser('bool?', network);
    expect(fieldBoolT).toBeInstanceOf(ncFields.OptionalField);
    fieldBoolT.fromBuffer(Buffer.from([1, 1]));
    expect(fieldBoolT.toUser()).toEqual('true');

    const fieldBoolF = getFieldParser('bool?', network);
    expect(fieldBoolF).toBeInstanceOf(ncFields.OptionalField);
    fieldBoolF.fromBuffer(Buffer.from([1, 0]));
    expect(fieldBoolF.toUser()).toEqual('false');

    const fieldBytes = getFieldParser('bytes?', network);
    expect(fieldBytes).toBeInstanceOf(ncFields.OptionalField);
    fieldBytes.fromBuffer(Buffer.from([0x01, 0x02, 0xca, 0xfe]));
    expect(fieldBytes.toUser()).toEqual('cafe');
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

  it('should deserialize from buffer', () => {
    const fieldStr = getFieldParser('SignedData[str]', network);
    expect(fieldStr).toBeInstanceOf(ncFields.SignedDataField);
    fieldStr.fromBuffer(Buffer.concat([Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), signature]));
    expect(fieldStr.toUser()).toStrictEqual({
      type: 'str',
      signature: 'cafe',
      value: 'test',
    });

    const fieldInt = getFieldParser('SignedData[int]', network);
    expect(fieldInt).toBeInstanceOf(ncFields.SignedDataField);
    fieldInt.fromBuffer(Buffer.concat([Buffer.from([1 + 0x80, 1]), signature]));
    expect(fieldInt.toUser()).toStrictEqual({
      type: 'int',
      signature: 'cafe',
      value: '129',
    });
  });
});

describe('RawSignedData', () => {
  const signature = getFieldParser('bytes', network).fromUser('cafe').toBuffer();

  it('should serialize from user input', () => {
    const fieldStr = getFieldParser('RawSignedData[str]', network);
    expect(fieldStr).toBeInstanceOf(ncFields.RawSignedDataField);

    fieldStr.fromUser({
      type: 'str',
      signature: 'cafe',
      value: 'test',
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(fieldStr.toBuffer()).toMatchBuffer(
      Buffer.concat([Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), signature])
    );

    const fieldInt = getFieldParser('RawSignedData[int]', network);
    expect(fieldInt).toBeInstanceOf(ncFields.RawSignedDataField);
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

  it('should deserialize from buffer', () => {
    const fieldStr = getFieldParser('RawSignedData[str]', network);
    expect(fieldStr).toBeInstanceOf(ncFields.RawSignedDataField);
    fieldStr.fromBuffer(Buffer.concat([Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), signature]));
    expect(fieldStr.toUser()).toStrictEqual({
      type: 'str',
      signature: 'cafe',
      value: 'test',
    });

    const fieldInt = getFieldParser('RawSignedData[int]', network);
    expect(fieldInt).toBeInstanceOf(ncFields.RawSignedDataField);
    fieldInt.fromBuffer(Buffer.concat([Buffer.from([1 + 0x80, 1]), signature]));
    expect(fieldInt.toUser()).toStrictEqual({
      type: 'int',
      signature: 'cafe',
      value: '129',
    });
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

  it('should parse from buffer using simple types', () => {
    const field = getFieldParser('tuple[str, int]', network);
    expect(field).toBeInstanceOf(ncFields.TupleField);
    field.fromBuffer(
      Buffer.concat([Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), Buffer.from([1 + 0x80, 1])])
    );
    expect(field.toUser()).toStrictEqual(['test', '129']);
  });

  it('should parser from buffer using container types', () => {
    const field = getFieldParser('tuple[tuple[str, int?], int]', network);
    expect(field).toBeInstanceOf(ncFields.TupleField);
    field.fromBuffer(
      Buffer.concat([
        Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), // test
        Buffer.from([0x00]), // null
        Buffer.from([1 + 0x80, 1]), // 129
      ])
    );
    expect(field.toUser()).toEqual([['test', null], '129']);
  });
});

describe('List', () => {
  it('should serialize from user input using simple types', () => {
    const field = getFieldParser('list[int]', network);
    expect(field).toBeInstanceOf(ncFields.ListField);
    field.fromUser(DWARF5SignedTestCases.map(el => el[0])); // All cases
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(
      Buffer.concat([
        leb128.encodeSigned(DWARF5SignedTestCases.length),
        ...DWARF5SignedTestCases.map(el => el[1]),
      ])
    );
  });

  it('should serialize from user input using container types', () => {
    const field = getFieldParser('list[tuple[str, int]]', network);
    expect(field).toBeInstanceOf(ncFields.ListField);
    field.fromUser(DWARF5SignedTestCases.map(el => ['test', el[0]]));
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(
      Buffer.concat([
        leb128.encodeSigned(DWARF5SignedTestCases.length),
        ...DWARF5SignedTestCases.map(el =>
          Buffer.concat([Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), el[1]])
        ),
      ])
    );
  });

  it('should parse from buffer using simple types', () => {
    const field = getFieldParser('list[int]', network);
    expect(field).toBeInstanceOf(ncFields.ListField);
    field.fromBuffer(
      Buffer.concat([
        leb128.encodeSigned(DWARF5SignedTestCases.length),
        ...DWARF5SignedTestCases.map(el => el[1]),
      ])
    );
    expect(field.toUser()).toStrictEqual(DWARF5SignedTestCases.map(el => String(el[0])));
  });

  it('should parser from buffer using container types', () => {
    const field = getFieldParser('list[tuple[str, int]]', network);
    expect(field).toBeInstanceOf(ncFields.ListField);
    field.fromBuffer(
      Buffer.concat([
        leb128.encodeSigned(DWARF5SignedTestCases.length),
        ...DWARF5SignedTestCases.map(el =>
          Buffer.concat([
            Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), // test
            el[1],
          ])
        ),
      ])
    );
    expect(field.toUser()).toEqual(DWARF5SignedTestCases.map(el => ['test', String(el[0])]));
  });
});

describe('CallerId', () => {
  // Valid testnet address and its buffer representation (from AddressField example)
  const testAddress = 'WYLW8ujPemSuLJwbeNvvH6y7nakaJ6cEwT';
  const addressBuf = Buffer.from('4969ffb1549f2e00f30bfc0cf0b9207ed96f7f33ba578d4852', 'hex');

  // Valid contract ID (64-char hex string)
  const testContractId = 'cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe';
  const contractIdBuf = Buffer.from(testContractId, 'hex');

  // Tags
  const ADDRESS_TAG = 0x00;
  const CONTRACT_TAG = 0x01;

  describe('basic methods', () => {
    it('should return correct type from getType()', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      expect(field.getType()).toBe('CallerId');
    });

    it('should create new instance with createNew()', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      const newField = field.createNew();
      expect(newField).toBeInstanceOf(ncFields.CallerIdField);
      expect(newField).not.toBe(field);
    });
  });

  describe('fromUser', () => {
    it('should serialize address from user input', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      field.fromUser(testAddress);
      // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
      expect(field.toBuffer()).toMatchBuffer(
        Buffer.concat([Buffer.from([ADDRESS_TAG]), addressBuf])
      );
    });

    it('should serialize contract ID from user input', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      field.fromUser(testContractId);
      // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
      expect(field.toBuffer()).toMatchBuffer(
        Buffer.concat([Buffer.from([CONTRACT_TAG]), contractIdBuf])
      );
    });
  });

  describe('fromBuffer', () => {
    it('should deserialize address from buffer', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      const buf = Buffer.concat([Buffer.from([ADDRESS_TAG]), addressBuf]);
      const result = field.fromBuffer(buf);
      expect(result.bytesRead).toBe(26); // 1 tag + 25 address bytes
      expect(field.toUser()).toBe(testAddress);
    });

    it('should deserialize contract ID from buffer', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      const buf = Buffer.concat([Buffer.from([CONTRACT_TAG]), contractIdBuf]);
      const result = field.fromBuffer(buf);
      expect(result.bytesRead).toBe(33); // 1 tag + 32 contract ID bytes
      expect(field.toUser()).toBe(testContractId);
    });

    it('should throw error for empty buffer', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      expect(() => field.fromBuffer(Buffer.alloc(0))).toThrow(
        'Not enough bytes to read CallerId tag'
      );
    });

    it('should throw error for invalid tag', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      const invalidTagBuf = Buffer.concat([Buffer.from([0x99]), contractIdBuf]);
      expect(() => field.fromBuffer(invalidTagBuf)).toThrow('Invalid CallerId tag: 153');
    });
  });

  describe('toBuffer and toUser errors', () => {
    it('should throw error when calling toBuffer with null value', () => {
      const field = ncFields.CallerIdField.new(network);
      expect(() => field.toBuffer()).toThrow('No value to encode');
    });

    it('should throw error when calling toUser with null value', () => {
      const field = ncFields.CallerIdField.new(network);
      expect(() => field.toUser()).toThrow('No value to encode');
    });
  });

  describe('helper methods', () => {
    it('should correctly identify address with isAddress()', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      field.fromUser(testAddress);
      // @ts-expect-error: isAddress is defined on CallerIdField
      expect(field.isAddress()).toBe(true);
      // @ts-expect-error: isContractId is defined on CallerIdField
      expect(field.isContractId()).toBe(false);
    });

    it('should correctly identify contract ID with isContractId()', () => {
      const field = getFieldParser('CallerId', network);
      expect(field).toBeInstanceOf(ncFields.CallerIdField);
      field.fromUser(testContractId);
      // @ts-expect-error: isAddress is defined on CallerIdField
      expect(field.isAddress()).toBe(false);
      // @ts-expect-error: isContractId is defined on CallerIdField
      expect(field.isContractId()).toBe(true);
    });

    it('should return false for isAddress() and isContractId() when value is null', () => {
      const field = ncFields.CallerIdField.new(network);
      expect(field.isAddress()).toBe(false);
      expect(field.isContractId()).toBe(false);
    });
  });

  describe('round-trip', () => {
    it('should round-trip address through buffer', () => {
      const field1 = getFieldParser('CallerId', network);
      field1.fromUser(testAddress);
      const buf = field1.toBuffer();

      const field2 = getFieldParser('CallerId', network);
      field2.fromBuffer(buf);
      expect(field2.toUser()).toBe(testAddress);
    });

    it('should round-trip contract ID through buffer', () => {
      const field1 = getFieldParser('CallerId', network);
      field1.fromUser(testContractId);
      const buf = field1.toBuffer();

      const field2 = getFieldParser('CallerId', network);
      field2.fromBuffer(buf);
      expect(field2.toUser()).toBe(testContractId);
    });
  });
});

describe('Dict', () => {
  it('should serialize from user input using simple types', () => {
    const field = getFieldParser('Dict[str, int]', network);
    expect(field).toBeInstanceOf(ncFields.DictField);

    field.fromUser({
      test: -2,
      foo: 129,
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(
      Buffer.concat([
        leb128.encodeSigned(2),
        Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), // test
        Buffer.from([0x7e]), // -2
        Buffer.from([0x03, 0x66, 0x6f, 0x6f]), // foo
        Buffer.from([1 + 0x80, 1]), // 129
      ])
    );
  });

  it('should serialize from user input using container types', () => {
    const field = getFieldParser('Dict[str, Tuple[int, Address?]]', network);
    expect(field).toBeInstanceOf(ncFields.DictField);
    field.fromUser({
      test: [-2, null],
      foo: [129, null],
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(field.toBuffer()).toMatchBuffer(
      Buffer.concat([
        leb128.encodeSigned(2),
        Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), // test
        Buffer.from([0x7e, 0x00]), // -2, null
        Buffer.from([0x03, 0x66, 0x6f, 0x6f]), // foo
        Buffer.from([1 + 0x80, 1, 0x00]), // 129, null
      ])
    );
  });

  it('should parse from buffer using simple types', () => {
    const field = getFieldParser('Dict[str, int]', network);
    expect(field).toBeInstanceOf(ncFields.DictField);

    field.fromBuffer(
      Buffer.concat([
        leb128.encodeSigned(2),
        Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), // test
        Buffer.from([0x7e]), // -2
        Buffer.from([0x03, 0x66, 0x6f, 0x6f]), // foo
        Buffer.from([1 + 0x80, 1]), // 129
      ])
    );
    expect(field.toUser()).toStrictEqual({
      test: '-2',
      foo: '129',
    });
  });

  it('should parser from buffer using container types', () => {
    const field = getFieldParser('Dict[str, Tuple[int, Address?]]', network);
    expect(field).toBeInstanceOf(ncFields.DictField);
    field.fromBuffer(
      Buffer.concat([
        leb128.encodeSigned(2),
        Buffer.from([0x04, 0x74, 0x65, 0x73, 0x74]), // test
        Buffer.from([0x7e, 0x00]), // -2, null
        Buffer.from([0x03, 0x66, 0x6f, 0x6f]), // foo
        Buffer.from([1 + 0x80, 1, 0x00]), // 129, null
      ])
    );
    expect(field.toUser()).toEqual({
      test: ['-2', null],
      foo: ['129', null],
    });
  });
});
