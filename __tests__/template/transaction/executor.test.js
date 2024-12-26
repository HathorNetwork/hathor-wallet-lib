/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import {
  execAuthorityOutputInstruction,
  execAuthoritySelectInstruction,
  execChangeInstruction,
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
import { AuthorityOutputInstruction, AuthoritySelectInstruction, DataOutputInstruction, RawInputInstruction, RawOutputInstruction, ShuffleInstruction, TokenOutputInstruction, UtxoSelectInstruction } from '../../../src/template/transaction/instructions';
import Network from '../../../src/models/network';
import Output from '../../../src/models/output';
import Input from '../../../src/models/input';

const DEBUG = true;

const address = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
const token = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';
const txId = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';
const CASES = {
  GOOD: {
    'input/raw': {
      type: 'input/raw',
      index: 0,
      txId,
    },
    'input/utxo': {
      type: 'input/utxo',
      fill: 40,
    },
    'input/authority': {
      type: 'input/authority',
      authority: 'mint',
      token,
    },
    'output/raw': {
      type: 'output/raw',
      script: 'cafe',
      amount: 10,
    },
    'output/token': {
      type: 'output/token',
      amount: 23,
      address,
    },
    'output/authority': {
      type: 'output/authority',
      authority: 'mint',
      token,
      address,
    },
    'output/data': {
      type: 'output/data',
      data: 'cafe',
    },
    'action/shuffle': {
      type: 'action/shuffle',
      target: 'all',
    },
    'action/change': {
      type: 'action/change',
    },
    'action/complete': {
      type: 'action/complete',
    },
    'action/config': {
      type: 'action/config',
      version: 5,
      signalBits: 12,
      tokenName: 'foo',
      tokenSymbol: 'bar',
    },
    'action/setvar': {
      type: 'action/setvar',
      name: 'foo',
      value: 'bar',
    },
  },
  BAD: {
    'input/raw': {
      type: 'input/raw',
      index: 300,
      txId,
    },
    'input/utxo': {
      type: 'input/utxo',
      fill: '11g',
    },
    'input/authority': {
      type: 'input/authority',
      authority: 'none',
      token,
    },
    'output/raw': {
      type: 'output/raw',
      script: 'caf',
      amount: 10,
    },
    'output/token': {
      type: 'output/token',
      amount: '23g',
      address,
    },
    'output/authority': {
      type: 'output/authority',
      authority: 'none',
      token,
    },
    'output/data': {
      type: 'output/data',
      data: { foo: 'bar' },
    },
    'action/shuffle': {
      type: 'action/shuffle',
      target: 'none',
    },
    'action/change': {
      type: 'action/change',
      token: 4556,
    },
    'action/complete': {
      type: 'action/complete',
      token: 123,
    },
    'action/config': {
      type: 'action/config',
      version: 300,
      signalBits: 8001,
      tokenName: '',
      tokenSymbol: 'foobar',
    },
    'action/setvar': {
      type: 'action/setvar',
    },
  }
}

describe('findInstructionExecution', () => {
  it('should find the correct executor', () => {
    expect(findInstructionExecution(CASES.GOOD['input/raw'])).toBe(execRawInputInstruction);
    expect(findInstructionExecution(CASES.GOOD['input/utxo'])).toBe(execUtxoSelectInstruction);
    expect(findInstructionExecution(CASES.GOOD['input/authority'])).toBe(execAuthoritySelectInstruction);
    expect(findInstructionExecution(CASES.GOOD['output/raw'])).toBe(execRawOutputInstruction);
    expect(findInstructionExecution(CASES.GOOD['output/token'])).toBe(execTokenOutputInstruction);
    expect(findInstructionExecution(CASES.GOOD['output/authority'])).toBe(execAuthorityOutputInstruction);
    expect(findInstructionExecution(CASES.GOOD['output/data'])).toBe(execDataOutputInstruction);
    expect(findInstructionExecution(CASES.GOOD['action/shuffle'])).toBe(execShuffleInstruction);
    expect(findInstructionExecution(CASES.GOOD['action/change'])).toBe(execChangeInstruction);
    expect(findInstructionExecution(CASES.GOOD['action/complete'])).toBe(execCompleteTxInstruction);
    expect(findInstructionExecution(CASES.GOOD['action/config'])).toBe(execConfigInstruction);
    expect(findInstructionExecution(CASES.GOOD['action/setvar'])).toBe(execSetVarInstruction);
  });

  it('should throw with an invalid instruction', () => {
    expect(() => (findInstructionExecution(CASES.BAD['input/raw']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['input/utxo']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['input/authority']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['output/raw']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['output/token']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['output/authority']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['output/data']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['action/shuffle']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['action/change']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['action/complete']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['action/config']))).toThrow();
    expect(() => (findInstructionExecution(CASES.BAD['action/setvar']))).toThrow();
  });
});

describe('execute instruction', () => {
  it('should execute RawInputInstruction', async () => {
    const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
    const interpreter = {
      getTx: jest.fn().mockReturnValue(Promise.resolve({
        outputs: [{
          value: 123n,
          token,
          token_data: 1,
        }],
      })),
    };
    const ins = RawInputInstruction.parse(CASES.GOOD['input/raw']);
    await execRawInputInstruction(interpreter, ctx, ins);

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
  });

  it('should execute UtxoSelectInstruction', async () => {
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
    const ins = UtxoSelectInstruction.parse({type: 'input/utxo', fill: 30, token});
    await execUtxoSelectInstruction(interpreter, ctx, ins);

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
  });

  it('should execute AuthoritySelectInstruction', async () => {
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
    await execAuthoritySelectInstruction(interpreter, ctx, ins);

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
  });

  it('should execute RawOutputInstruction', async () => {
    const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
    const interpreter = {}; // interpreter is not used on raw output instruction
    const ins = RawOutputInstruction.parse({
      type: 'output/raw',
      script: 'cafe',
      amount: 11,
    });
    await execRawOutputInstruction(interpreter, ctx, ins);

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
  });

  it('should execute RawOutputInstruction for authority', async () => {
    const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
    const interpreter = {}; // interpreter is not used on raw output instruction
    const ins = RawOutputInstruction.parse({
      type: 'output/raw',
      script: 'cafe',
      authority: 'mint',
      token,
    });
    await execRawOutputInstruction(interpreter, ctx, ins);

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
  });

  it('should execute DataOutputInstruction', async () => {
    const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
    const interpreter = {}; // interpreter is not used on data output instruction
    const ins = DataOutputInstruction.parse({
      type: 'output/data',
      data: 'foobar',
      token,
    });
    await execDataOutputInstruction(interpreter, ctx, ins);

    expect(ctx.inputs).toHaveLength(0);
    expect(ctx.tokens).toHaveLength(1);

    expect(ctx.outputs).toHaveLength(1);
    expect(ctx.outputs[0].value).toStrictEqual(1n);
    expect(ctx.outputs[0].tokenData).toStrictEqual(1);
    expect(ctx.outputs[0].parseScript(new Network('testnet')).data).toStrictEqual('foobar');

    expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
    expect(ctx.balance.balance[token]).toMatchObject({
      tokens: -1n,
      mint_authorities: 0,
      melt_authorities: 0,
    });
  });


  it('should execute TokenOutputInstruction', async () => {
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
    await execTokenOutputInstruction(interpreter, ctx, ins);

    expect(interpreter.getNetwork).toHaveBeenCalledTimes(1);

    expect(ctx.inputs).toHaveLength(0);
    expect(ctx.tokens).toHaveLength(1);

    expect(ctx.outputs).toHaveLength(1);
    expect(ctx.outputs[0].value).toStrictEqual(23n);
    expect(ctx.outputs[0].tokenData).toStrictEqual(1);
    expect(ctx.outputs[0].parseScript(new Network('testnet')).address.base58).toStrictEqual(address);

    expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
    expect(ctx.balance.balance[token]).toMatchObject({
      tokens: -23n,
      mint_authorities: 0,
      melt_authorities: 0,
    });
  });

  it('should execute AuthorityOutputInstruction', async () => {
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
    await execAuthorityOutputInstruction(interpreter, ctx, ins);

    expect(interpreter.getNetwork).toHaveBeenCalledTimes(1);

    expect(ctx.inputs).toHaveLength(0);
    expect(ctx.tokens).toHaveLength(1);

    expect(ctx.outputs).toHaveLength(1);
    expect(ctx.outputs[0].value).toStrictEqual(2n);
    expect(ctx.outputs[0].tokenData).toStrictEqual(129);
    expect(ctx.outputs[0].parseScript(new Network('testnet')).address.base58).toStrictEqual(address);

    expect(Object.keys(ctx.balance.balance)).toHaveLength(1);
    expect(ctx.balance.balance[token]).toMatchObject({
      tokens: 0n,
      mint_authorities: 0,
      melt_authorities: -1,
    });
  });


  it('should execute ShuffleInstruction', async () => {
    const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);
    const interpreter = {};
    const ins = ShuffleInstruction.parse({
      type: 'action/shuffle',
      target: 'all',
    });
    const arr = [];
    for (let i = 1n; i < 10; i++) {
      ctx.addOutput(-1, new Output(i, Buffer.alloc(1)))
      ctx.addInput(-1, new Input(txId, i));
      arr.push(i);
    }
    await execShuffleInstruction(interpreter, ctx, ins);

    expect(ctx.outputs.map(o => o.value)).not.toStrictEqual(arr);
    expect(ctx.inputs.map(i => i.index)).not.toStrictEqual(arr);
  });

});
