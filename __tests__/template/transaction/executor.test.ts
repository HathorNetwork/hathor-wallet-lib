/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { cloneDeep } from 'lodash';
import {
  execAuthorityOutputInstruction,
  execAuthoritySelectInstruction,
  execCompleteTxInstruction,
  execConfigInstruction,
  execDataOutputInstruction,
  execRawInputInstruction,
  execRawOutputInstruction,
  execSetVarInstruction,
  execShuffleInstruction,
  execTokenOutputInstruction,
  execUtxoSelectInstruction,
  findInstructionExecution,
  runInstruction,
} from '../../../src/template/transaction/executor';
import { TxTemplateContext } from '../../../src/template/transaction/context';
import { getDefaultLogger } from '../../../src/types';
import {
  AuthorityOutputInstruction,
  AuthoritySelectInstruction,
  DataOutputInstruction,
  RawInputInstruction,
  RawOutputInstruction,
  ShuffleInstruction,
  TokenOutputInstruction,
  UtxoSelectInstruction,
} from '../../../src/template/transaction/instructions';
import Network from '../../../src/models/network';
import Output from '../../../src/models/output';
import Input from '../../../src/models/input';

/**
 * This DEBUG constant will enable or disable "build time" debug logs
 * this can make understanding what is happening during the template execution.
 */
const DEBUG = false;

const address = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
const token = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';
const txId = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';

describe('findInstructionExecution', () => {
  it('should find the correct executor', () => {
    expect(
      findInstructionExecution({
        type: 'input/raw',
        index: 0,
        txId,
      })
    ).toBe(execRawInputInstruction);

    expect(
      findInstructionExecution({
        type: 'input/utxo',
        fill: 40,
      })
    ).toBe(execUtxoSelectInstruction);

    expect(
      findInstructionExecution({
        type: 'input/authority',
        authority: 'mint',
        token,
      })
    ).toBe(execAuthoritySelectInstruction);

    expect(
      findInstructionExecution({
        type: 'output/raw',
        script: 'cafe',
        amount: 10,
      })
    ).toBe(execRawOutputInstruction);

    expect(
      findInstructionExecution({
        type: 'output/token',
        amount: 23,
        address,
      })
    ).toBe(execTokenOutputInstruction);

    expect(
      findInstructionExecution({
        type: 'output/authority',
        authority: 'mint',
        token,
        address,
      })
    ).toBe(execAuthorityOutputInstruction);

    expect(
      findInstructionExecution({
        type: 'output/data',
        data: 'cafe',
      })
    ).toBe(execDataOutputInstruction);

    expect(
      findInstructionExecution({
        type: 'action/shuffle',
        target: 'all',
      })
    ).toBe(execShuffleInstruction);

    expect(
      findInstructionExecution({
        type: 'action/complete',
      })
    ).toBe(execCompleteTxInstruction);

    expect(
      findInstructionExecution({
        type: 'action/config',
        version: 5,
        tokenName: 'foo',
        tokenSymbol: 'bar',
      })
    ).toBe(execConfigInstruction);

    expect(
      findInstructionExecution({
        type: 'action/setvar',
        name: 'foo',
        value: 'bar',
      })
    ).toBe(execSetVarInstruction);
  });

  it('should throw with an invalid instruction', () => {
    expect(() =>
      findInstructionExecution({
        type: 'input/raw',
        index: 300,
        txId,
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'input/utxo',
        fill: '11g',
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'input/authority',
        authority: 'none',
        token,
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'output/raw',
        script: 'caf',
        amount: 10,
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'output/token',
        amount: '23g',
        address,
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'output/authority',
        authority: 'none',
        token,
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'output/data',
        data: { foo: 'bar' },
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'action/shuffle',
        target: 'none',
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'action/complete',
        token: 123,
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'action/config',
        version: 300,
        signalBits: 8001,
        tokenName: '',
        tokenSymbol: 'foobar',
      })
    ).toThrow();
    expect(() =>
      findInstructionExecution({
        type: 'action/setvar',
      })
    ).toThrow();
  });
});

const RawInputExecutorTest = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {
    getTx: jest.fn().mockReturnValue(
      Promise.resolve({
        outputs: [
          {
            value: 123n,
            token,
            token_data: 1,
          },
        ],
      })
    ),
  };
  const ins = RawInputInstruction.parse({ type: 'input/raw', index: 0, txId });
  await executor(interpreter, ctx, ins);

  expect(interpreter.getTx).toHaveBeenCalledTimes(1);
  expect(ctx.inputs).toHaveLength(1);
  expect(ctx.inputs[0].hash).toStrictEqual(txId);
  expect(ctx.inputs[0].index).toStrictEqual(0);
  expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
  expect(ctx.balance.balance[token]).toMatchObject({
    tokens: 123n,
    mint_authorities: 0,
    melt_authorities: 0,
  });
};

const UtxoSelectExecutorTest = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {
    getNetwork: jest.fn().mockReturnValue(new Network('testnet')),
    getChangeAddress: jest.fn().mockResolvedValue(address),
    getTx: jest.fn().mockResolvedValue({
      outputs: [
        {
          value: 20n,
          token,
          token_data: 1,
        },
        {
          value: 20n,
          token,
          token_data: 1,
        },
      ],
    }),
    getUtxos: jest.fn().mockResolvedValue({
      changeAmount: 10n,
      utxos: [
        {
          txId,
          index: 0,
          tokenId: token,
          address,
          value: 20n,
          authorities: 0n,
        },
        {
          txId,
          index: 1,
          tokenId: token,
          address,
          value: 20n,
          authorities: 0n,
        },
      ],
    }),
  };

  const insData = { type: 'input/utxo', fill: 30, token };
  const ins = UtxoSelectInstruction.parse(insData);
  await executor(interpreter, ctx, ins);

  expect(interpreter.getTx).toHaveBeenCalledTimes(2);
  expect(interpreter.getUtxos).toHaveBeenCalledTimes(1);
  expect(interpreter.getNetwork).toHaveBeenCalledTimes(1);
  expect(interpreter.getChangeAddress).toHaveBeenCalledTimes(1);

  // Will add 2 inputs (from getUtxos) with 40n and a change output of 10n

  expect(ctx.inputs).toHaveLength(2);
  expect(ctx.inputs[0].hash).toStrictEqual(txId);
  expect(ctx.inputs[0].index).toStrictEqual(0);
  expect(ctx.inputs[1].hash).toStrictEqual(txId);
  expect(ctx.inputs[1].index).toStrictEqual(1);

  expect(ctx.outputs).toHaveLength(1);
  expect(ctx.outputs[0].value).toStrictEqual(10n);
  expect(ctx.outputs[0].tokenData).toStrictEqual(1);

  expect(ctx.tokens).toHaveLength(1);
  expect(ctx.tokens[0]).toStrictEqual(token);

  expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
  expect(ctx.balance.balance[token]).toMatchObject({
    tokens: 30n,
    mint_authorities: 0,
    melt_authorities: 0,
  });
};

const AuthoritySelectExecutorTest = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {
    getTx: jest.fn().mockResolvedValue({
      outputs: [
        {
          value: 1n,
          token,
          token_data: 129,
        },
      ],
    }),
    getAuthorities: jest.fn().mockResolvedValue([
      {
        txId,
        index: 0,
        tokenId: token,
        address,
        value: 1n,
        authorities: 1n,
      },
    ]),
  };
  const inputIns = { type: 'input/authority', token, authority: 'mint' };
  const ins = AuthoritySelectInstruction.parse(inputIns);
  await executor(interpreter, ctx, ins);

  expect(interpreter.getTx).toHaveBeenCalledTimes(1);
  expect(interpreter.getAuthorities).toHaveBeenCalledTimes(1);

  expect(ctx.inputs).toHaveLength(1);
  expect(ctx.inputs[0].hash).toStrictEqual(txId);
  expect(ctx.inputs[0].index).toStrictEqual(0);

  expect(ctx.outputs).toHaveLength(0);
  expect(ctx.tokens).toHaveLength(0);

  expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
  expect(ctx.balance.balance[token]).toMatchObject({
    tokens: 0n,
    mint_authorities: 1,
    melt_authorities: 0,
  });
};

const RawOutputExecutorTest = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {}; // interpreter is not used on raw output instruction
  const ins = RawOutputInstruction.parse({
    type: 'output/raw',
    script: 'cafe',
    amount: 11,
  });
  await executor(interpreter, ctx, ins);

  expect(ctx.inputs).toHaveLength(0);
  expect(ctx.tokens).toHaveLength(0);

  expect(ctx.outputs).toHaveLength(1);
  expect(ctx.outputs[0].value).toStrictEqual(11n);
  expect(ctx.outputs[0].tokenData).toStrictEqual(0);
  expect(ctx.outputs[0].script.toString('hex')).toStrictEqual('cafe');

  expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
  expect(ctx.balance.balance['00']).toMatchObject({
    tokens: -11n,
    mint_authorities: 0,
    melt_authorities: 0,
  });
};

const RawOutputExecutorTestForAuthority = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {}; // interpreter is not used on raw output instruction
  const ins = RawOutputInstruction.parse({
    type: 'output/raw',
    script: 'cafe',
    authority: 'mint',
    token,
  });
  await executor(interpreter, ctx, ins);

  expect(ctx.inputs).toHaveLength(0);
  expect(ctx.tokens).toHaveLength(1);

  expect(ctx.outputs).toHaveLength(1);
  expect(ctx.outputs[0].value).toStrictEqual(1n);
  expect(ctx.outputs[0].tokenData).toStrictEqual(129);
  expect(ctx.outputs[0].script.toString('hex')).toStrictEqual('cafe');

  expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
  expect(ctx.balance.balance[token]).toMatchObject({
    tokens: 0n,
    mint_authorities: -1,
    melt_authorities: 0,
  });
};

const DataOutputExecutorTest = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {}; // interpreter is not used on data output instruction
  const ins = DataOutputInstruction.parse({
    type: 'output/data',
    data: 'foobar',
    token,
  });
  await executor(interpreter, ctx, ins);

  expect(ctx.inputs).toHaveLength(0);
  expect(ctx.tokens).toHaveLength(1);

  expect(ctx.outputs).toHaveLength(1);
  expect(ctx.outputs[0].value).toStrictEqual(1n);
  expect(ctx.outputs[0].tokenData).toStrictEqual(1);
  const script = ctx.outputs[0].parseScript(new Network('testnet'));
  expect(script?.getType()).toStrictEqual('data');
  if (script && 'data' in script) {
    expect(script.data).toStrictEqual('foobar');
  } else {
    throw new Error('unexpected script');
  }

  expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
  expect(ctx.balance.balance[token]).toMatchObject({
    tokens: -1n,
    mint_authorities: 0,
    melt_authorities: 0,
  });
};

const TokenOutputExecutorTest = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {
    getNetwork: jest.fn().mockReturnValue(new Network('testnet')),
  };
  const ins = TokenOutputInstruction.parse({
    type: 'output/token',
    amount: 23,
    address,
    token,
  });
  await executor(interpreter, ctx, ins);

  expect(interpreter.getNetwork).toHaveBeenCalledTimes(1);

  expect(ctx.inputs).toHaveLength(0);
  expect(ctx.tokens).toHaveLength(1);

  expect(ctx.outputs).toHaveLength(1);
  expect(ctx.outputs[0].value).toStrictEqual(23n);
  expect(ctx.outputs[0].tokenData).toStrictEqual(1);
  const script = ctx.outputs[0].parseScript(new Network('testnet'));
  if (script && 'address' in script) {
    expect(script.address.base58).toStrictEqual(address);
  } else {
    throw new Error('unexpected script');
  }

  expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
  expect(ctx.balance.balance[token]).toMatchObject({
    tokens: -23n,
    mint_authorities: 0,
    melt_authorities: 0,
  });
};

const AuthorityOutputExecutorTest = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {
    getNetwork: jest.fn().mockReturnValue(new Network('testnet')),
  };
  const ins = AuthorityOutputInstruction.parse({
    type: 'output/authority',
    authority: 'melt',
    token,
    address,
  });
  await executor(interpreter, ctx, ins);

  expect(interpreter.getNetwork).toHaveBeenCalledTimes(1);

  expect(ctx.inputs).toHaveLength(0);
  expect(ctx.tokens).toHaveLength(1);

  expect(ctx.outputs).toHaveLength(1);
  expect(ctx.outputs[0].value).toStrictEqual(2n);
  expect(ctx.outputs[0].tokenData).toStrictEqual(129);
  const script = ctx.outputs[0].parseScript(new Network('testnet'));
  if (script && 'address' in script) {
    expect(script.address.base58).toStrictEqual(address);
  } else {
    throw new Error('unexpected script');
  }

  expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
  expect(ctx.balance.balance[token]).toMatchObject({
    tokens: 0n,
    mint_authorities: 0,
    melt_authorities: -1,
  });
};

const ShuffleExecutorTest = async executor => {
  const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
  const interpreter = {};
  const ins = ShuffleInstruction.parse({
    type: 'action/shuffle',
    target: 'all',
  });
  const arr: bigint[] = [];
  for (let i = 1n; i < 10; i++) {
    ctx.addOutputs(-1, new Output(i, Buffer.alloc(1)));
    ctx.addInputs(-1, new Input(txId, Number(i)));
    arr.push(i);
  }
  const balanceBefore = cloneDeep(ctx.balance.balance);
  const outputsBefore = cloneDeep(ctx.outputs);
  const inputsBefore = cloneDeep(ctx.inputs);
  await executor(interpreter, ctx, ins);

  expect(ctx.outputs.map(o => o.value)).not.toStrictEqual(arr);
  expect(ctx.inputs.map(i => i.index)).not.toStrictEqual(arr.map(i => Number(i)));

  // Check that the balance remains the same
  expect(ctx.balance.balance).toStrictEqual(balanceBefore);
  // Check that the outputs are the same, ignoring order
  expect(ctx.outputs).toEqual(expect.arrayContaining(outputsBefore));
  expect(ctx.outputs.length).toEqual(outputsBefore.length);
  // Check that the inputs are the same, ignoring order
  expect(ctx.inputs).toEqual(expect.arrayContaining(inputsBefore));
  expect(ctx.inputs.length).toEqual(inputsBefore.length);
};

/* eslint-disable jest/expect-expect */
describe('execute instruction from executor', () => {
  it('should execute RawInputInstruction', async () => {
    // Using the executor
    await RawInputExecutorTest(execRawInputInstruction);
    // Using runInstruction
    await RawInputExecutorTest(runInstruction);
  });

  it('should execute UtxoSelectInstruction', async () => {
    // Using the executor
    await UtxoSelectExecutorTest(execUtxoSelectInstruction);
    // Using runInstruction
    await UtxoSelectExecutorTest(runInstruction);
  });

  it('should execute AuthoritySelectInstruction', async () => {
    // Using the executor
    await AuthoritySelectExecutorTest(execAuthoritySelectInstruction);
    // Using runInstruction
    await AuthoritySelectExecutorTest(runInstruction);
  });

  it('should execute RawOutputInstruction', async () => {
    // Using the executor
    await RawOutputExecutorTest(execRawOutputInstruction);
    // Using runInstruction
    await RawOutputExecutorTest(runInstruction);
  });

  it('should execute RawOutputInstruction for authority', async () => {
    // Using the executor
    await RawOutputExecutorTestForAuthority(execRawOutputInstruction);
    // Using runInstruction
    await RawOutputExecutorTestForAuthority(runInstruction);
  });

  it('should execute DataOutputInstruction', async () => {
    // Using the executor
    await DataOutputExecutorTest(execDataOutputInstruction);
    // Using runInstruction
    await DataOutputExecutorTest(runInstruction);
  });

  it('should execute TokenOutputInstruction', async () => {
    // Using the executor
    await TokenOutputExecutorTest(execTokenOutputInstruction);
    // Using runInstruction
    await TokenOutputExecutorTest(runInstruction);
  });

  it('should execute AuthorityOutputInstruction', async () => {
    // Using the executor
    await AuthorityOutputExecutorTest(execAuthorityOutputInstruction);
    // Using runInstruction
    await AuthorityOutputExecutorTest(runInstruction);
  });

  it('should execute ShuffleInstruction', async () => {
    // Using the executor
    await ShuffleExecutorTest(execShuffleInstruction);
    // Using runInstruction
    await ShuffleExecutorTest(runInstruction);
  });
});
/* eslint-enable jest/expect-expect */
