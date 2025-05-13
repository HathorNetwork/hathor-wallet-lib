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
});
