/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Serializer from '../../src/nano_contracts/serializer';
import Deserializer from '../../src/nano_contracts/deserializer';
import Address from '../../src/models/address';
import Network from '../../src/models/network';
import { NanoContractSignedData } from '../../src/nano_contracts/types';

test('Bool', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const serializedFalse = serializer.serializeFromType(false, 'bool');
  const { value: deserializedFalse, bytesRead: bytesFalse } = deserializer.deserializeFromType(
    serializedFalse,
    'bool'
  );
  expect(deserializedFalse).toStrictEqual(false);
  expect(bytesFalse).toStrictEqual(1);

  const serializedTrue = serializer.serializeFromType(true, 'bool');
  const { value: deserializedTrue, bytesRead: bytesTrue } = deserializer.deserializeFromType(
    serializedTrue,
    'bool'
  );
  expect(deserializedTrue).toStrictEqual(true);
  expect(bytesTrue).toStrictEqual(1);
});

test('String', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const value = 'test';
  const serialized = serializer.serializeFromType(value, 'str');
  const { value: deserialized } = deserializer.deserializeFromType(serialized, 'str');

  expect(value).toStrictEqual(deserialized);
});

test('Int', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const value = 300;
  const serialized = serializer.serializeFromType(value, 'int');
  const { value: deserialized } = deserializer.deserializeFromType(serialized, 'int');

  expect(value).toStrictEqual(deserialized);
});

test('Amount', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const value = 300n;
  const serialized = serializer.serializeFromType(value, 'Amount');
  const { value: deserialized } = deserializer.deserializeFromType(serialized, 'Amount');

  expect(value).toStrictEqual(deserialized);
});

test('TokenUid', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const value = Buffer.from(
    'cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe',
    'hex'
  );
  const serializedToken = serializer.serializeFromType(value, 'TokenUid');
  const { value: deserializedToken, bytesRead: bytesReadToken } = deserializer.deserializeFromType(
    serializedToken,
    'TokenUid'
  );

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(deserializedToken).toMatchBuffer(value);
  expect(bytesReadToken).toStrictEqual(33); // 1 byte of tag + 32 bytes of value

  const { value: deserializedHTR, bytesRead: bytesReadHTR } = deserializer.deserializeFromType(
    Buffer.from([0]),
    'TokenUid'
  );

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(deserializedHTR).toMatchBuffer(Buffer.from('00', 'hex'));
  expect(bytesReadHTR).toStrictEqual(1); // 1 byte of tag
});

test('Sized Bytes', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const value = Buffer.from(
    'cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe',
    'hex'
  );
  const serializedVertex = serializer.serializeFromType(value, 'VertexId');
  const { value: deserializedVertex, bytesRead: bytesReadVertex } =
    deserializer.deserializeFromType(serializedVertex, 'VertexId');

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(deserializedVertex).toMatchBuffer(value);
  expect(bytesReadVertex).toStrictEqual(32);

  const serializedContract = serializer.serializeFromType(value, 'ContractId');
  const { value: deserializedContract, bytesRead: bytesReadContract } =
    deserializer.deserializeFromType(serializedContract, 'ContractId');

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(deserializedContract).toMatchBuffer(value);
  expect(bytesReadContract).toStrictEqual(32);

  const serializedBlueprint = serializer.serializeFromType(value, 'BlueprintId');
  const { value: deserializedBlueprint, bytesRead: bytesReadBlueprint } =
    deserializer.deserializeFromType(serializedBlueprint, 'BlueprintId');

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(deserializedBlueprint).toMatchBuffer(value);
  expect(bytesReadBlueprint).toStrictEqual(32);
});

test('Bytes', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const value = Buffer.from([0x74, 0x65, 0x73, 0x74]);
  const serialized = serializer.serializeFromType(value, 'bytes');
  const { value: deserialized, bytesRead: bytesReadBytes } = deserializer.deserializeFromType(
    serialized,
    'bytes'
  );

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(deserialized).toMatchBuffer(value);
  expect(bytesReadBytes).toStrictEqual(5); // 1 byte of length + 4 bytes of value

  const serializedScript = serializer.serializeFromType(value, 'TxOutputScript');
  const { value: deserializedScript, bytesRead: bytesReadScript } =
    deserializer.deserializeFromType(serializedScript, 'TxOutputScript');

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(deserializedScript).toMatchBuffer(value);
  expect(bytesReadScript).toStrictEqual(5); // 1 byte of length + 4 bytes of value
});

test('Optional', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const valueEmptyInt = null;
  const serializedEmptyInt = serializer.serializeFromType(valueEmptyInt, 'int?');
  const { value: deserializedEmptyInt } = deserializer.deserializeFromType(
    serializedEmptyInt,
    'int?'
  );

  expect(deserializedEmptyInt).toBe(valueEmptyInt);

  const valueInt = 300;
  const serializedInt = serializer.serializeFromType(valueInt, 'int?');
  const { value: deserializedInt } = deserializer.deserializeFromType(serializedInt, 'int?');

  expect(deserializedInt).toBe(valueInt);

  const valueEmptyBool = null;
  const serializedEmptyBool = serializer.serializeFromType(valueEmptyBool, 'bool?');
  const { value: deserializedEmptyBool } = deserializer.deserializeFromType(
    serializedEmptyBool,
    'bool?'
  );

  expect(deserializedEmptyBool).toBe(valueEmptyBool);

  const valueBool = true;
  const serializedBool = serializer.serializeFromType(valueBool, 'bool?');
  const { value: deserializedBool } = deserializer.deserializeFromType(serializedBool, 'bool?');

  expect(deserializedBool).toBe(valueBool);

  const valueEmptyStr = null;
  const serializedEmptyStr = serializer.serializeFromType(valueEmptyStr, 'str?');
  const { value: deserializedEmptyStr } = deserializer.deserializeFromType(
    serializedEmptyStr,
    'str?'
  );

  expect(deserializedEmptyStr).toBe(valueEmptyStr);

  const valueStr = 'test';
  const serializedStr = serializer.serializeFromType(valueStr, 'str?');
  const { value: deserializedStr } = deserializer.deserializeFromType(serializedStr, 'str?');

  expect(deserializedStr).toBe(valueStr);

  const valueEmptyBytes = null;
  const serializedEmptyBytes = serializer.serializeFromType(valueEmptyBytes, 'bytes?');
  const { value: deserializedEmptyBytes } = deserializer.deserializeFromType(
    serializedEmptyBytes,
    'bytes?'
  );

  expect(deserializedEmptyBytes).toBe(valueEmptyBytes);

  const valueBytes = Buffer.from([0x74, 0x65, 0x73, 0x74]);
  const serializedBytes = serializer.serializeFromType(valueBytes, 'bytes?');
  const { value: deserializedBytes } = deserializer.deserializeFromType(serializedBytes, 'bytes?');

  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect(deserializedBytes).toMatchBuffer(valueBytes);
});

test('SignedData', () => {
  const serializer = new Serializer(new Network('testnet'));
  const deserializer = new Deserializer(new Network('testnet'));

  const valueInt: NanoContractSignedData = {
    type: 'int',
    value: 300,
    signature: Buffer.from('74657374', 'hex'),
  };
  const serializedInt = serializer.serializeFromType(valueInt, 'SignedData[int]');
  const { value: deserializedInt } = deserializer.deserializeFromType(
    serializedInt,
    'SignedData[int]'
  );

  expect((deserializedInt as NanoContractSignedData).type).toEqual(valueInt.type);
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect((deserializedInt as NanoContractSignedData).signature).toMatchBuffer(valueInt.signature);
  expect((deserializedInt as NanoContractSignedData).value).toEqual(valueInt.value);

  const valueStr: NanoContractSignedData = {
    type: 'str',
    value: 'test',
    signature: Buffer.from('74657374', 'hex'),
  };
  const serializedStr = serializer.serializeFromType(valueStr, 'SignedData[str]');
  const { value: deserializedStr } = deserializer.deserializeFromType(
    serializedStr,
    'SignedData[str]'
  );

  expect((deserializedStr as NanoContractSignedData).type).toEqual(valueStr.type);
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect((deserializedStr as NanoContractSignedData).signature).toMatchBuffer(valueStr.signature);
  expect((deserializedStr as NanoContractSignedData).value).toEqual(valueStr.value);

  const valueBytes: NanoContractSignedData = {
    type: 'bytes',
    value: Buffer.from('74657374', 'hex'),
    signature: Buffer.from('74657374', 'hex'),
  };
  const serializedBytes = serializer.serializeFromType(valueBytes, 'SignedData[bytes]');
  const { value: deserializedBytes } = deserializer.deserializeFromType(
    serializedBytes,
    'SignedData[bytes]'
  );

  expect((deserializedBytes as NanoContractSignedData).type).toEqual(valueBytes.type);
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect((deserializedBytes as NanoContractSignedData).signature).toMatchBuffer(
    valueBytes.signature
  );
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect((deserializedBytes as NanoContractSignedData).value).toMatchBuffer(valueBytes.value);

  const valueBoolFalse: NanoContractSignedData = {
    type: 'bool',
    value: false,
    signature: Buffer.from('74657374', 'hex'),
  };
  const serializedBoolFalse = serializer.serializeFromType(valueBoolFalse, 'SignedData[bool]');
  const { value: deserializedBoolFalse } = deserializer.deserializeFromType(
    serializedBoolFalse,
    'SignedData[bool]'
  );

  expect((deserializedBoolFalse as NanoContractSignedData).type).toEqual(valueBoolFalse.type);
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect((deserializedBoolFalse as NanoContractSignedData).signature).toMatchBuffer(
    valueBoolFalse.signature
  );
  expect((deserializedBoolFalse as NanoContractSignedData).value).toEqual(valueBoolFalse.value);

  const valueBoolTrue: NanoContractSignedData = {
    type: 'bool',
    value: true,
    signature: Buffer.from('74657374', 'hex'),
  };
  const serializedBoolTrue = serializer.serializeFromType(valueBoolTrue, 'SignedData[bool]');
  const { value: deserializedBoolTrue } = deserializer.deserializeFromType(
    serializedBoolTrue,
    'SignedData[bool]'
  );

  expect((deserializedBoolTrue as NanoContractSignedData).type).toEqual(valueBoolTrue.type);
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect((deserializedBoolTrue as NanoContractSignedData).signature).toMatchBuffer(
    valueBoolTrue.signature
  );
  expect((deserializedBoolTrue as NanoContractSignedData).value).toEqual(valueBoolTrue.value);

  const valueVarInt: NanoContractSignedData = {
    type: 'VarInt',
    value: 300n,
    signature: Buffer.from('74657374', 'hex'),
  };
  const serializedVarInt = serializer.serializeFromType(valueVarInt, 'SignedData[VarInt]');
  const { value: deserializedVarInt } = deserializer.deserializeFromType(
    serializedVarInt,
    'SignedData[VarInt]'
  );

  expect((deserializedVarInt as NanoContractSignedData).type).toEqual(valueVarInt.type);
  // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
  expect((deserializedVarInt as NanoContractSignedData).signature).toMatchBuffer(
    valueVarInt.signature
  );
  expect((deserializedVarInt as NanoContractSignedData).value).toEqual(valueVarInt.value);
});

test('Address', () => {
  const network = new Network('testnet');
  const deserializer = new Deserializer(network);

  const address = 'WfthPUEecMNRs6eZ2m2EQBpVH6tbqQxYuU';
  const addressBuffer = new Address(address).decode();

  const { value: deserialized } = deserializer.deserializeFromType(addressBuffer, 'Address');
  expect(deserialized).toBe(address);

  const wrongNetworkAddress = 'HDeadDeadDeadDeadDeadDeadDeagTPgmn';
  const wrongNetworkAddressBuffer = new Address(wrongNetworkAddress).decode();

  expect(() => deserializer.deserializeFromType(wrongNetworkAddressBuffer, 'Address')).toThrow();
});

test('VarInt', () => {
  const network = new Network('testnet');
  const deserializer = new Deserializer(network);
  const DWARF5TestCases: [bigint, Buffer][] = [
    [2n, Buffer.from([2])],
    [-2n, Buffer.from([0x7e])],
    [127n, Buffer.from([127 + 0x80, 0])],
    [-127n, Buffer.from([1 + 0x80, 0x7f])],
    [128n, Buffer.from([0 + 0x80, 1])],
    [-128n, Buffer.from([0 + 0x80, 0x7f])],
    [129n, Buffer.from([1 + 0x80, 1])],
    [-129n, Buffer.from([0x7f + 0x80, 0x7e])],
  ];
  for (const testCase of DWARF5TestCases) {
    const resp = deserializer.toVarInt(testCase[1] as Buffer);
    expect(resp.value).toEqual(testCase[0] as bigint);
    expect(resp.bytesRead).toEqual(testCase[1].length);
  }
});
