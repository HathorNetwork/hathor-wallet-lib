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
      '74657374,300,int'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[int]',
      value: {
        type: 'int',
        signature: expect.anything(),
        value: 300n,
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
  });

  it('should read SignedData[str]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[str]',
      '74657374,test,str'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[str]',
      value: {
        type: 'str',
        signature: expect.anything(),
        value: 'test',
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
  });

  it('should read SignedData[bytes]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[bytes]',
      '74657374,74657374,bytes'
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
    expect((arg.value as NanoContractSignedData).value).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
  });

  it('should read true SignedData[bool]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[bool]',
      '74657374,true,bool'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[bool]',
      value: {
        type: 'bool',
        signature: expect.anything(),
        value: true,
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
  });

  it('should read false SignedData[bool]', () => {
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'SignedData[bool]',
      '74657374,false,bool'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'SignedData[bool]',
      value: {
        type: 'bool',
        signature: expect.anything(),
        value: false,
      },
    });
    // @ts-expect-error: toMatchBuffer is defined in our setupTests.js so the type check fails.
    expect((arg.value as NanoContractSignedData).signature).toMatchBuffer(
      Buffer.from([0x74, 0x65, 0x73, 0x74])
    );
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
    expect(arg).toMatchObject({ name: 'a-test', type: 'int', value: 300n });
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
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'Address',
      'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'Address',
      value: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
    });
  });

  // Optional

  it('should read int? values', () => {
    const arg = NanoContractMethodArgument.fromApiInput('a-test', 'int?', 300);
    expect(arg).toMatchObject({ name: 'a-test', type: 'int?', value: 300n });
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
    const arg = NanoContractMethodArgument.fromApiInput(
      'a-test',
      'Address?',
      'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'
    );
    expect(arg).toMatchObject({
      name: 'a-test',
      type: 'Address?',
      value: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
    });

    expect(NanoContractMethodArgument.fromApiInput('a-test', 'Address?', null)).toMatchObject({
      name: 'a-test',
      type: 'Address?',
      value: null,
    });
  });
});

describe('toApiInput', () => {
  it('should read SignedData[int]', () => {
    const arg = new NanoContractMethodArgument('a-test', 'SignedData[int]', {
      type: 'int',
      signature: Buffer.from('74657374', 'hex'),
      value: 300n,
    });
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'SignedData[int]',
      parsed: '74657374,300,int',
    });
  });

  it('should read SignedData[str]', () => {
    const arg = new NanoContractMethodArgument('a-test', 'SignedData[str]', {
      type: 'str',
      signature: Buffer.from('74657374', 'hex'),
      value: 'test',
    });
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'SignedData[str]',
      parsed: '74657374,test,str',
    });
  });

  it('should read SignedData[bytes]', () => {
    const arg = new NanoContractMethodArgument('a-test', 'SignedData[bytes]', {
      type: 'bytes',
      signature: Buffer.from('74657374', 'hex'),
      value: Buffer.from('74657374', 'hex'),
    });
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'SignedData[bytes]',
      parsed: '74657374,74657374,bytes',
    });
  });

  it('should read true SignedData[bool]', () => {
    const arg = new NanoContractMethodArgument('a-test', 'SignedData[bool]', {
      type: 'bool',
      signature: Buffer.from('74657374', 'hex'),
      value: true,
    });
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'SignedData[bool]',
      parsed: '74657374,true,bool',
    });
  });

  it('should read false SignedData[bool]', () => {
    const arg = new NanoContractMethodArgument('a-test', 'SignedData[bool]', {
      type: 'bool',
      signature: Buffer.from('74657374', 'hex'),
      value: false,
    });
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'SignedData[bool]',
      parsed: '74657374,false,bool',
    });
  });

  it('should read str values', () => {
    const arg = new NanoContractMethodArgument('a-test', 'str', 'test');
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'str',
      parsed: 'test',
    });
  });

  it('should read bytes values', () => {
    const arg = new NanoContractMethodArgument('a-test', 'bytes', Buffer.from('74657374', 'hex'));
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'bytes',
      parsed: '74657374',
    });
  });

  it('should read int values', () => {
    const arg = new NanoContractMethodArgument('a-test', 'int', 300n);
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'int',
      parsed: '300',
    });
  });

  it('should read bool values', () => {
    const arg1 = new NanoContractMethodArgument('a-test', 'bool', false);
    expect(arg1.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'bool',
      parsed: 'false',
    });
    const arg2 = new NanoContractMethodArgument('a-test', 'bool', true);
    expect(arg2.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'bool',
      parsed: 'true',
    });
  });

  it('should read ContractId values', () => {
    const arg = new NanoContractMethodArgument(
      'a-test',
      'ContractId',
      Buffer.from('74657374', 'hex')
    );
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'ContractId',
      parsed: '74657374',
    });
  });

  it('should read TokenUid values', () => {
    const arg = new NanoContractMethodArgument(
      'a-test',
      'TokenUid',
      Buffer.from('74657374', 'hex')
    );
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'TokenUid',
      parsed: '74657374',
    });
  });

  it('should read Address values', () => {
    const arg = new NanoContractMethodArgument(
      'a-test',
      'Address',
      'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'
    );
    expect(arg.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'Address',
      parsed: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
    });
  });

  // Optional

  it('should read int? values', () => {
    const arg1 = new NanoContractMethodArgument('a-test', 'int?', 300n);
    expect(arg1.toApiInput()).toMatchObject({ name: 'a-test', type: 'int?', parsed: '300' });

    const arg2 = NanoContractMethodArgument.fromApiInput('a-test', 'int?', null);
    expect(arg2.toApiInput()).toMatchObject({ name: 'a-test', type: 'int?', parsed: null });
  });

  it('should read bool? values', () => {
    const arg1 = new NanoContractMethodArgument('a-test', 'bool?', true);
    const arg2 = new NanoContractMethodArgument('a-test', 'bool?', false);
    const arg3 = new NanoContractMethodArgument('a-test', 'bool?', null);
    expect(arg1.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'bool?',
      parsed: 'true',
    });
    expect(arg2.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'bool?',
      parsed: 'false',
    });
    expect(arg3.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'bool?',
      parsed: null,
    });
  });

  it('should read ContractId? values', () => {
    const arg1 = new NanoContractMethodArgument(
      'a-test',
      'ContractId?',
      Buffer.from('74657374', 'hex')
    );
    expect(arg1.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'ContractId?',
      parsed: '74657374',
    });

    const arg2 = new NanoContractMethodArgument('a-test', 'ContractId?', null);
    expect(arg2.toApiInput()).toMatchObject({ name: 'a-test', type: 'ContractId?', parsed: null });
  });

  it('should read TokenUid? values', () => {
    const arg1 = new NanoContractMethodArgument(
      'a-test',
      'TokenUid?',
      Buffer.from('74657374', 'hex')
    );
    expect(arg1.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'TokenUid?',
      parsed: '74657374',
    });

    const arg2 = new NanoContractMethodArgument('a-test', 'TokenUid?', null);
    expect(arg2.toApiInput()).toMatchObject({ name: 'a-test', type: 'TokenUid?', parsed: null });
  });

  it('should read Address? values', () => {
    const arg1 = new NanoContractMethodArgument(
      'a-test',
      'Address?',
      'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'
    );
    expect(arg1.toApiInput()).toMatchObject({
      name: 'a-test',
      type: 'Address?',
      parsed: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
    });

    const arg2 = new NanoContractMethodArgument('a-test', 'Address?', null);
    expect(arg2.toApiInput()).toMatchObject({ name: 'a-test', type: 'Address?', parsed: null });
  });
});
