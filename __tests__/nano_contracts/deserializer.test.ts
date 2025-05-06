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

test('Bool', () => {
  const serializer = new Serializer();
  const deserializer = new Deserializer();

  const valueFalse = false;
  const serializedFalse = serializer.serializeFromType(valueFalse, 'bool');
  const deserializedFalse = deserializer.deserializeFromType(serializedFalse, 'bool');
  expect(deserializedFalse).toBe(valueFalse);

  const valueTrue = true;
  const serializedTrue = serializer.serializeFromType(valueTrue, 'bool');
  const deserializedTrue = deserializer.deserializeFromType(serializedTrue, 'bool');
  expect(deserializedTrue).toBe(valueTrue);
});

test('String', () => {
  const serializer = new Serializer();
  const deserializer = new Deserializer();

  const value = 'test';
  const serialized = serializer.serializeFromType(value, 'str');
  const deserialized = deserializer.deserializeFromType(serialized, 'str');

  expect(value).toBe(deserialized);
});

test('Int', () => {
  const serializer = new Serializer();
  const deserializer = new Deserializer();

  const value = 300;
  const serialized = serializer.serializeFromType(value, 'int');
  const deserialized = deserializer.deserializeFromType(serialized, 'int');

  expect(value).toBe(deserialized);
});

test('Amount', () => {
  const serializer = new Serializer();
  const deserializer = new Deserializer();

  const value = 300n;
  const serialized = serializer.serializeFromType(value, 'Amount');
  const deserialized = deserializer.deserializeFromType(serialized, 'Amount');

  expect(value).toBe(deserialized);
});

test('Bytes', () => {
  const serializer = new Serializer();
  const deserializer = new Deserializer();

  const value = Buffer.from([0x74, 0x65, 0x73, 0x74]);
  const serialized = serializer.serializeFromType(value, 'bytes');
  const deserialized = deserializer.deserializeFromType(serialized, 'bytes');

  expect(value.equals(deserialized)).toBe(true);

  const serializedVertex = serializer.serializeFromType(value, 'VertexId');
  const deserializedVertex = deserializer.deserializeFromType(serializedVertex, 'VertexId');

  expect(value.equals(deserializedVertex)).toBe(true);

  const serializedToken = serializer.serializeFromType(value, 'TokenUid');
  const deserializedToken = deserializer.deserializeFromType(serializedToken, 'TokenUid');

  expect(value.equals(deserializedToken)).toBe(true);

  const serializedScript = serializer.serializeFromType(value, 'TxOutputScript');
  const deserializedScript = deserializer.deserializeFromType(serializedScript, 'TxOutputScript');

  expect(value.equals(deserializedScript)).toBe(true);

  const serializedContract = serializer.serializeFromType(value, 'ContractId');
  const deserializedContract = deserializer.deserializeFromType(serializedContract, 'ContractId');

  expect(value.equals(deserializedContract)).toBe(true);
});

test('Float', () => {
  const serializer = new Serializer();
  const deserializer = new Deserializer();

  const value = 10.32134;
  const serialized = serializer.serializeFromType(value, 'float');
  const deserialized = deserializer.deserializeFromType(serialized, 'float');

  expect(value).toBe(deserialized);
});

test('Optional', () => {
  const serializer = new Serializer();
  const deserializer = new Deserializer();

  const valueEmptyInt = null;
  const serializedEmptyInt = serializer.serializeFromType(valueEmptyInt, 'int?');
  const deserializedEmptyInt = deserializer.deserializeFromType(serializedEmptyInt, 'int?');

  expect(deserializedEmptyInt).toBe(valueEmptyInt);

  const valueInt = 300;
  const serializedInt = serializer.serializeFromType(valueInt, 'int?');
  const deserializedInt = deserializer.deserializeFromType(serializedInt, 'int?');

  expect(deserializedInt).toBe(valueInt);

  const valueEmptyBool = null;
  const serializedEmptyBool = serializer.serializeFromType(valueEmptyBool, 'bool?');
  const deserializedEmptyBool = deserializer.deserializeFromType(serializedEmptyBool, 'bool?');

  expect(deserializedEmptyBool).toBe(valueEmptyBool);

  const valueBool = true;
  const serializedBool = serializer.serializeFromType(valueBool, 'bool?');
  const deserializedBool = deserializer.deserializeFromType(serializedBool, 'bool?');

  expect(deserializedBool).toBe(valueBool);

  const valueEmptyStr = null;
  const serializedEmptyStr = serializer.serializeFromType(valueEmptyStr, 'str?');
  const deserializedEmptyStr = deserializer.deserializeFromType(serializedEmptyStr, 'str?');

  expect(deserializedEmptyStr).toBe(valueEmptyStr);

  const valueStr = 'test';
  const serializedStr = serializer.serializeFromType(valueStr, 'str?');
  const deserializedStr = deserializer.deserializeFromType(serializedStr, 'str?');

  expect(deserializedStr).toBe(valueStr);

  const valueEmptyBytes = null;
  const serializedEmptyBytes = serializer.serializeFromType(valueEmptyBytes, 'bytes?');
  const deserializedEmptyBytes = deserializer.deserializeFromType(serializedEmptyBytes, 'bytes?');

  expect(deserializedEmptyBytes).toBe(valueEmptyBytes);

  const valueBytes = Buffer.from([0x74, 0x65, 0x73, 0x74]);
  const serializedBytes = serializer.serializeFromType(valueBytes, 'bytes?');
  const deserializedBytes = deserializer.deserializeFromType(serializedBytes, 'bytes?');

  expect(deserializedBytes.equals(valueBytes)).toBe(true);

  const valueEmptyFloat = null;
  const serializedEmptyFloat = serializer.serializeFromType(valueEmptyFloat, 'float?');
  const deserializedEmptyFloat = deserializer.deserializeFromType(serializedEmptyFloat, 'float?');

  expect(deserializedEmptyFloat).toBe(valueEmptyFloat);

  const valueFloat = 10.32134;
  const serializedFloat = serializer.serializeFromType(valueFloat, 'float?');
  const deserializedFloat = deserializer.deserializeFromType(serializedFloat, 'float?');

  expect(deserializedFloat).toBe(valueFloat);
});

test('Signed', () => {
  const serializer = new Serializer();
  const deserializer = new Deserializer();

  const valueInt = '74657374,300,int';
  const serializedInt = serializer.serializeFromType(valueInt, 'SignedData[int]');
  const deserializedInt = deserializer.deserializeFromType(serializedInt, 'SignedData[int]');

  expect(valueInt).toBe(deserializedInt);

  const valueStr = '74657374,test,str';
  const serializedStr = serializer.serializeFromType(valueStr, 'SignedData[str]');
  const deserializedStr = deserializer.deserializeFromType(serializedStr, 'SignedData[str]');

  expect(valueStr).toBe(deserializedStr);

  const valueBytes = '74657374,74657374,bytes';
  const serializedBytes = serializer.serializeFromType(valueBytes, 'SignedData[bytes]');
  const deserializedBytes = deserializer.deserializeFromType(serializedBytes, 'SignedData[bytes]');

  expect(valueBytes).toBe(deserializedBytes);

  const valueFloat = '74657374,10.32134,float';
  const serializedFloat = serializer.serializeFromType(valueFloat, 'SignedData[float]');
  const deserializedFloat = deserializer.deserializeFromType(serializedFloat, 'SignedData[float]');

  expect(valueFloat).toBe(deserializedFloat);

  const valueBoolFalse = '74657374,false,bool';
  const serializedBoolFalse = serializer.serializeFromType(valueBoolFalse, 'SignedData[bool]');
  const deserializedBoolFalse = deserializer.deserializeFromType(
    serializedBoolFalse,
    'SignedData[bool]'
  );

  expect(valueBoolFalse).toBe(deserializedBoolFalse);

  const valueBoolTrue = '74657374,true,bool';
  const serializedBoolTrue = serializer.serializeFromType(valueBoolTrue, 'SignedData[bool]');
  const deserializedBoolTrue = deserializer.deserializeFromType(
    serializedBoolTrue,
    'SignedData[bool]'
  );

  expect(valueBoolTrue).toBe(deserializedBoolTrue);
});

test('Address', () => {
  const network = new Network('testnet');
  const deserializer = new Deserializer(network);

  const address = 'WfthPUEecMNRs6eZ2m2EQBpVH6tbqQxYuU';
  const addressBuffer = new Address(address).decode();

  const deserialized = deserializer.deserializeFromType(addressBuffer, 'Address');
  expect(deserialized).toBe(address);

  const wrongNetworkAddress = 'HDeadDeadDeadDeadDeadDeadDeagTPgmn';
  const wrongNetworkAddressBuffer = new Address(wrongNetworkAddress).decode();

  expect(() => deserializer.deserializeFromType(wrongNetworkAddressBuffer, 'Address')).toThrow();
});

test('VarInt', () => {
  const network = new Network('testnet');
  const deserializer = new Deserializer(network);
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
  for (const testCase of DWARF5TestCases) {
    expect(deserializer.toVarInt(testCase[1] as Buffer)).toEqual(testCase[0] as bigint);
  }
});
