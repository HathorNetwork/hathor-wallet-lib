/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NanoContractMethodArgument } from '../../src/nano_contracts/methodArg';
import { NanoContractSignedData } from '../../src/nano_contracts/types';

describe('fromApiInput', () => {
  it('should read SignedData[int]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[int]',
      '74657374,6e634944,300,int'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[int]',
      value: {
        type: 'int',
        signature: expect.anything(),
        value: expect.anything(),
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).value[0]).toMatchBuffer(
      Buffer.from([0x6e, 0x63, 0x49, 0x44])
    );
    expect((arg.value as NanoContractSignedData).value[1]).toEqual(300);
  });

  it('should read SignedData[VarInt]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[VarInt]',
      '74657374,6e634944,300,VarInt'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[VarInt]',
      value: {
        type: 'VarInt',
        signature: expect.anything(),
        value: expect.anything(),
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).value[0]).toMatchBuffer(
      Buffer.from([0x6e, 0x63, 0x49, 0x44])
    );
    expect((arg.value as NanoContractSignedData).value[1]).toEqual(300n);
  });

  it('should read SignedData[str]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[str]',
      '74657374,6e634944,test,str'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[str]',
      value: {
        type: 'str',
        signature: expect.anything(),
        value: expect.anything(),
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).value[0]).toMatchBuffer(
      Buffer.from([0x6e, 0x63, 0x49, 0x44])
    );
    expect((arg.value as NanoContractSignedData).value[1]).toEqual('test');
  });

  it('should read SignedData[bytes]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[bytes]',
      '74657374,6e634944,74657374,bytes'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[bytes]',
      value: {
        type: 'bytes',
        signature: expect.anything(),
        value: expect.anything(),
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).value[0]).toMatchBuffer(
      Buffer.from([0x6e, 0x63, 0x49, 0x44])
    );
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).value[1]).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
  });

  it('should read true SignedData[bool]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[bool]',
      '74657374,6e634944,true,bool'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[bool]',
      value: {
        type: 'bool',
        signature: expect.anything(),
        value: expect.anything(),
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).value[0]).toMatchBuffer(
      Buffer.from([0x6e, 0x63, 0x49, 0x44])
    );
    expect((arg.value as NanoContractSignedData).value[1]).toEqual(true);
  });

  it('should read false SignedData[bool]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[bool]',
      '74657374,6e634944,false,bool'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[bool]',
      value: {
        type: 'bool',
        signature: expect.anything(),
        value: expect.anything(),
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).value[0]).toMatchBuffer(
      Buffer.from([0x6e, 0x63, 0x49, 0x44])
    );
    expect((arg.value as NanoContractSignedData).value[1]).toEqual(false);
  });

  it('should read str values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'str', 'test');
    expect(arg).toMatchObject({ name: 'a-test', type: 'str', value: 'test' });
  });

  it('should read bytes values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'bytes', '74657374');
    expect(arg).toMatchObject({ name: 'a-test', type: 'bytes', value: expect.anything() });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(arg.value).toMatchBuffer(Buffer.from('74657374', 'hex'));
  });

  it('should read int values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'int', 300);
    expect(arg).toMatchObject({ name: 'a-test', type: 'int', value: 300 });
  });

  it('should read VarInt values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'VarInt', 300);
    expect(arg).toMatchObject({ name: 'a-test', type: 'VarInt', value: 300n });
  });

  it('should read bool values', () => {
    expect(NanoContractMethodArgument.fromApiInput('a-test', 'bool', true)).toMatchObject({
      name: 'a-test',
      type: 'bool',
      value: true,
    });
    expect(NanoContractMethodArgument.fromApiInput('a-test', 'bool', false)).toMatchObject({
      name: 'a-test',
      type: 'bool',
      value: false,
    });
  });

  it('should read ContractId values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'ContractId', '74657374');
    expect(arg).toMatchObject({ name: 'a-test', type: 'ContractId', value: expect.anything() });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(arg.value).toMatchBuffer(Buffer.from('74657374', 'hex'));
  });

  it('should read TokenUid values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'TokenUid', '74657374');
    expect(arg).toMatchObject({ name: 'a-test', type: 'TokenUid', value: expect.anything() });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(arg.value).toMatchBuffer(Buffer.from('74657374', 'hex'));
  });

  it('should read Address values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'Address', 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
    expect(arg).toMatchObject({ name: 'a-test', type: 'Address', value: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo' });
  });

  // Optional

  it('should read Optional[int] values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'Optional[int]', 300);
    expect(arg).toMatchObject({ name: 'a-test', type: 'Optional[int]', value: 300 });

    expect(NanoContractMethodArgument.fromApiInput('a-test', 'Optional[int]', null)).toMatchObject({
      name: 'a-test',
      type: 'Optional[int]',
      value: null,
    });
  });

  it('should read Optional[VarInt] values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'Optional[VarInt]', 300);
    expect(arg).toMatchObject({ name: 'a-test', type: 'Optional[VarInt]', value: 300n });
  });

  it('should read Optional[bool] values', () => {
    expect(NanoContractMethodArgument.fromApiInput('a-test', 'Optional[bool]', true)).toMatchObject(
      { name: 'a-test', type: 'Optional[bool]', value: true }
    );
    expect(
      NanoContractMethodArgument.fromApiInput('a-test', 'Optional[bool]', false)
    ).toMatchObject({ name: 'a-test', type: 'Optional[bool]', value: false });
    expect(NanoContractMethodArgument.fromApiInput('a-test', 'Optional[bool]', null)).toMatchObject(
      { name: 'a-test', type: 'Optional[bool]', value: null }
    );
  });

  it('should read Optional[ContractId] values', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'Optional[ContractId]',
      '74657374'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'Optional[ContractId]',
      value: expect.anything(),
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(arg.value).toMatchBuffer(Buffer.from('74657374', 'hex'));

    expect(
      NanoContractMethodArgument.fromApiInput('a-test', 'Optional[ContractId]', null)
    ).toMatchObject({ name: 'a-test', type: 'Optional[ContractId]', value: null });
  });

  it('should read Optional[TokenUid] values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'Optional[TokenUid]', '74657374');
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'Optional[TokenUid]',
      value: expect.anything(),
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(arg.value).toMatchBuffer(Buffer.from('74657374', 'hex'));

    expect(
      NanoContractMethodArgument.fromApiInput('a-test', 'Optional[TokenUid]', null)
    ).toMatchObject({ name: 'a-test', type: 'Optional[TokenUid]', value: null });
  });

  it('should read Optional[Address] values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'Optional[Address]', 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
    expect(arg).toMatchObject({ name: 'a-test', type: 'Optional[Address]', value: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo' });

    expect(
      NanoContractMethodArgument.fromApiInput('a-test', 'Optional[Address]', null)
    ).toMatchObject({ name: 'a-test', type: 'Optional[Address]', value: null });
  });

  it('should read int? values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'int?', 300);
    expect(arg).toMatchObject({ name: 'a-test', type: 'int?', value: 300 });

    expect(NanoContractMethodArgument.fromApiInput('a-test', 'int?', null)).toMatchObject({
      name: 'a-test',
      type: 'int?',
      value: null,
    });
  });

  it('should read VarInt? values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'VarInt?', 300);
    expect(arg).toMatchObject({ name: 'a-test', type: 'VarInt?', value: 300n });
  });

  it('should read bool? values', () => {
    expect(NanoContractMethodArgument.fromApiInput('a-test', 'bool?', true)).toMatchObject({
      name: 'a-test',
      type: 'bool?',
      value: true,
    });
    expect(NanoContractMethodArgument.fromApiInput('a-test', 'bool?', false)).toMatchObject({
      name: 'a-test',
      type: 'bool?',
      value: false,
    });
    expect(NanoContractMethodArgument.fromApiInput('a-test', 'bool?', null)).toMatchObject({
      name: 'a-test',
      type: 'bool?',
      value: null,
    });
  });

  it('should read ContractId? values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'ContractId?', '74657374');
    expect(arg).toMatchObject({ name: 'a-test', type: 'ContractId?', value: expect.anything() });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(arg.value).toMatchBuffer(Buffer.from('74657374', 'hex'));

    expect(NanoContractMethodArgument.fromApiInput('a-test', 'ContractId?', null)).toMatchObject({
      name: 'a-test',
      type: 'ContractId?',
      value: null,
    });
  });

  it('should read TokenUid? values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'TokenUid?', '74657374');
    expect(arg).toMatchObject({ name: 'a-test', type: 'TokenUid?', value: expect.anything() });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect(arg.value).toMatchBuffer(Buffer.from('74657374', 'hex'));

    expect(NanoContractMethodArgument.fromApiInput('a-test', 'TokenUid?', null)).toMatchObject({
      name: 'a-test',
      type: 'TokenUid?',
      value: null,
    });
  });

  it('should read Address? values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'Address?', 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
    expect(arg).toMatchObject({ name: 'a-test', type: 'Address?', value: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo' });

    expect(NanoContractMethodArgument.fromApiInput('a-test', 'Address?', null)).toMatchObject({
      name: 'a-test',
      type: 'Address?',
      value: null,
    });
  });
});
