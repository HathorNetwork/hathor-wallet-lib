/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { shuffle } from 'lodash';
import {
  AuthorityOutputInstruction,
  AuthoritySelectInstruction,
  ChangeInstruction,
  ConfigInstruction,
  DataOutputInstruction,
  RawInputInstruction,
  RawOutputInstruction,
  SetVarInstruction,
  ShuffleInstruction,
  TokenOutputInstruction,
  UtxoSelectInstruction,
  getVariable,
} from './instructions';
import { TxTemplateContext } from './context';
import { ITxTemplateInterpreter, IGetUtxosOptions } from './types';
import Input from '../../models/input';
import Output from '../../models/output';
import {
  NATIVE_TOKEN_UID,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../../constants';
import { createOutputScriptFromAddress } from '../../utils/address';
import ScriptData from '../../models/script_data';
import { getWalletAddress, getWalletBalance } from './setvarcommands';

/**
 * Execution for RawInputInstruction
 */
export async function execRawInputInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof RawInputInstruction>
) {
  const position = ins.position;
  const txId = getVariable<string>(ins.txId, ctx.vars, RawInputInstruction.shape.txId);
  const index = getVariable<number>(ins.index, ctx.vars, RawInputInstruction.shape.index);

  // Find the original transaction from the input
  const origTx = await interpreter.getTx(txId);
  // Add balance to the ctx.balance
  ctx.balance.addInput(origTx, index);

  const input = new Input(txId, index);
  ctx.addInput(position, input);
}

/**
 * Execution for UtxoSelectInstruction
 */
export async function execUtxoSelectInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof UtxoSelectInstruction>
) {
  const position = ins.position;
  const fill = getVariable<bigint>(ins.fill, ctx.vars, UtxoSelectInstruction.shape.fill);
  const token = getVariable<string>(ins.token, ctx.vars, UtxoSelectInstruction.shape.token);
  const address = getVariable<string|undefined>(ins.address, ctx.vars, UtxoSelectInstruction.shape.address);

  const autoChange = ins.autoChange;

  // Find utxos
  const options: IGetUtxosOptions = { token };
  if (address) {
    options.filter_address = address;
  }
  const { changeAmount, utxos } = await interpreter.getUtxos(fill, options);

  // Add utxos as inputs on the transaction
  const inputs = utxos.map(u => new Input(u.txId, u.index));
  // First, update balance
  for (const input of inputs) {
    const origTx = await interpreter.getTx(input.hash);
    ctx.balance.addInput(origTx, input.index);
  }

  // Then add inputs to context
  ctx.addInput(position, ...inputs);

  if (autoChange && changeAmount) {
    // get change address
    let changeAddress = getVariable<string|undefined>(ins.changeAddress, ctx.vars, UtxoSelectInstruction.shape.changeAddress);
    if (!changeAddress) {
      changeAddress = await interpreter.getChangeAddress(ctx);
    }
    // Token should only be on the array if present on the outputs
    const tokenData = ctx.addToken(token);
    const script = createOutputScriptFromAddress(changeAddress, interpreter.getNetwork());
    const output = new Output(changeAmount, script, { tokenData });
    ctx.balance.addOutput(changeAmount, token);
    ctx.addOutput(-1, output);
  }
}

/**
 * Execution for AuthoritySelectInstruction
 */
export async function execAuthoritySelectInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof AuthoritySelectInstruction>
) {
  const position = ins.position ?? -1;
  const authority = ins.authority;
  const token = getVariable<string>(ins.token, ctx.vars, AuthoritySelectInstruction.shape.token);
  const count = getVariable<number>(ins.count, ctx.vars,AuthoritySelectInstruction.shape.count);
  const address = getVariable<string|undefined>(ins.address, ctx.vars,AuthoritySelectInstruction.shape.address);

  let authoritiesInt = 0;
  if (authority === 'mint') {
    authoritiesInt += 1;
  }
  if (authority === 'melt') {
    authoritiesInt += 2;
  }

  // Find utxos
  const options: IGetUtxosOptions = {
    token,
    authorities: authoritiesInt,
  };
  if (address) {
    options.filter_address = address;
  }
  const utxos = await interpreter.getAuthorities(count, options);

  // Add utxos as inputs on the transaction
  const inputs = utxos.map(u => new Input(u.txId, u.index));
  // First, update balance
  for (const input of inputs) {
    const origTx = await interpreter.getTx(input.hash);
    ctx.balance.addInput(origTx, input.index);
  }

  // Then add inputs to context
  ctx.addInput(position, ...inputs);
}

/**
 * Execution for RawOutputInstruction
 */
export async function execRawOutputInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof RawOutputInstruction>
) {
  const { position, authority } = ins;
  const scriptStr = getVariable<string>(ins.script, ctx.vars,RawOutputInstruction.shape.script);
  const script = Buffer.from(scriptStr, 'hex');
  const token = getVariable<string>(ins.token, ctx.vars,RawOutputInstruction.shape.token);
  const timelock = getVariable<number|undefined>(ins.timelock, ctx.vars, RawOutputInstruction.shape.timelock);

  // Add token to tokens array
  const tokenIndex = ctx.addToken(token);
  let tokenData = tokenIndex;

  let amount = 0;
  switch (authority) {
    case 'mint':
      amount = TOKEN_MINT_MASK;
      tokenData &= TOKEN_AUTHORITY_MASK;
      break;
    case 'melt':
      amount = TOKEN_MELT_MASK;
      tokenData &= TOKEN_AUTHORITY_MASK;
      break;
    default: {
      amount = getVariable<bigint|undefined>(ins.amount, ctx.vars,RawOutputInstruction.shape.amount);
    }

  }
  if (!amount) {
    throw new Error('Raw token output missing amount');
  }

  // Add balance to the ctx.balance
  if (authority) {
    ctx.balance.addOutputAuthority(1, token, authority);
  } else {
    ctx.balance.addOutput(amount, token);
  }

  const output = new Output(amount, script, { timelock, tokenData });
  ctx.addOutput(position, output);
}

/**
 * Execution for DataOutputInstruction
 */
export async function execDataOutputInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof DataOutputInstruction>
) {
  const position = ins.position;
  const data = getVariable<string>(ins.data, ctx.vars,DataOutputInstruction.shape.data);
  const token = getVariable<string>(ins.token, ctx.vars,DataOutputInstruction.shape.token);

  // Add token to tokens array
  const tokenData = ctx.addToken(token);

  // Add balance to the ctx.balance
  ctx.balance.addOutput(1, token);

  const dataScript = new ScriptData(data);
  const script = dataScript.createScript();
  const output = new Output(1, script, { tokenData });
  ctx.addOutput(position, output);
}

/**
 * Execution for TokenOutputInstruction
 */
export async function execTokenOutputInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof TokenOutputInstruction>
) {
  const position = ins.position;
  const token = getVariable<string>(ins.token, ctx.vars,TokenOutputInstruction.shape.token);
  const address = getVariable<string>(ins.address, ctx.vars,TokenOutputInstruction.shape.address);
  const timelock = getVariable<number|undefined>(ins.timelock, ctx.vars, TokenOutputInstruction.shape.timelock);
  const amount = getVariable<bigint>(ins.amount, ctx.vars, TokenOutputInstruction.shape.amount);

  // Add token to tokens array
  const tokenData = ctx.addToken(token);

  // Add balance to the ctx.balance
  ctx.balance.addOutput(amount, token);

  const script = createOutputScriptFromAddress(address, interpreter.getNetwork());
  const output = new Output(amount, script, { timelock, tokenData });
  ctx.addOutput(position, output);
}

/**
 * Execution for AuthorityOutputInstruction
 */
export async function execAuthorityOutputInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof AuthorityOutputInstruction>
) {
  const { authority, position } = ins;
  const token = getVariable<string>(ins.token, ctx.vars, AuthorityOutputInstruction.shape.token);
  const address = getVariable<string>(ins.address, ctx.vars,AuthorityOutputInstruction.shape.address);
  const timelock = getVariable<number|undefined>(ins.timelock, ctx.vars, AuthorityOutputInstruction.shape.timelock);
  const count = getVariable<number>(ins.count, ctx.vars, AuthorityOutputInstruction.shape.count);

  // Add token to tokens array
  const tokenIndex = ctx.addToken(token);
  let tokenData = tokenIndex;

  let amount = 0;
  switch(authority) {
    case 'mint':
      amount = TOKEN_MINT_MASK;
      tokenData &= TOKEN_AUTHORITY_MASK;
      break;
    case 'melt':
      amount = TOKEN_MELT_MASK;
      tokenData &= TOKEN_AUTHORITY_MASK;
      break;
    default:
      throw new Error('Authority token output missing `authority`');
  }

  // Add balance to the ctx.balance
  ctx.balance.addOutputAuthority(count, token, authority);

  const script = createOutputScriptFromAddress(address, interpreter.getNetwork());
  const output = new Output(amount, script, { timelock, tokenData });
  // Creates `count` outputs that are copies of the `output`
  ctx.addOutput(position, ...Array(count).fill(output));
}

/**
 * Execution for ShuffleInstruction
 */
export async function execShuffleInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof ShuffleInstruction>
) {
  const target = ins.target;

  // The token array should never be shuffled since outputs have a "pointer" to the token position
  // on the token array, so shuffling would make the outputs target different outputs.

  if (target === 'inputs' || target === 'all') {
    ctx.inputs = shuffle(ctx.inputs);
  }

  if (target === 'outputs' || target === 'all') {
    ctx.outputs = shuffle(ctx.outputs);
  }
}

/**
 * Execution for ChangeInstruction
 */
export async function execChangeInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof ChangeInstruction>
) {
  const token = ins.token ? getVariable<string>(ins.token, ctx.vars) : null;
  const address = ins.address
    ? getVariable<string>(ins.address, ctx.vars)
    : await interpreter.getChangeAddress(ctx);
  const timelock = ins.timelock ? getVariable<number>(ins.timelock, ctx.vars) : null;

  const tokensToCheck: string[] = [];
  if (token) {
    tokensToCheck.push(token);
  } else {
    // Check HTR and all tokens on the transaction
    tokensToCheck.push(NATIVE_TOKEN_UID);
    for (const tk in ctx.tokens) {
      tokensToCheck.push(tk);
    }
  }

  const script = createOutputScriptFromAddress(address, interpreter.getNetwork());

  for (const tokenUid of tokensToCheck) {
    const balance = ctx.balance.getTokenBalance(tokenUid);
    const tokenData = ctx.addToken(tokenUid);
    if (balance.tokens > 0) {
      // Need to create a token output
      // Add balance to the ctx.balance
      ctx.balance.addOutput(balance.tokens, tokenUid);

      // Creates an output with the value of the outstanding balance
      const output = new Output(balance.tokens, script, { timelock, tokenData });
      ctx.addOutput(-1, output);
    }

    if (balance.mint_authorities > 0) {
      // Need to create a token output
      // Add balance to the ctx.balance
      ctx.balance.addOutput(balance.mint_authorities, tokenUid, 'mint');

      // Creates an output with the value of the outstanding balance
      const output = new Output(TOKEN_MINT_MASK, script, { timelock, tokenData });
      ctx.addOutput(-1, ...Array(balance.mint_authorities).fill(output));
    }

    if (balance.melt_authorities > 0) {
      // Need to create a token output
      // Add balance to the ctx.balance
      ctx.balance.addOutput(balance.melt_authorities, tokenUid, 'melt');

      // Creates an output with the value of the outstanding balance
      const output = new Output(TOKEN_MELT_MASK, script, { timelock, tokenData });
      ctx.addOutput(-1, ...Array(balance.melt_authorities).fill(output));
    }
  }
}

/**
 * Execution for ConfigInstruction
 */
export async function execConfigInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof ConfigInstruction>
) {
  if (ins.version) {
    ctx.version = getVariable<number>(ins.version, ctx.vars);
  }
  if (ins.signalBits) {
    ctx.signalBits = getVariable<number>(ins.signalBits, ctx.vars);
  }
  if (ins.tokenName) {
    ctx.tokenName = getVariable<string>(ins.tokenName, ctx.vars);
  }
  if (ins.tokenSymbol) {
    ctx.tokenSymbol = getVariable<string>(ins.tokenSymbol, ctx.vars);
  }
}

/**
 * Execution for SetVarInstruction
 */
export async function execSetVarInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof SetVarInstruction>
) {
  if (ins.action) {
    if (ins.action === 'get_wallet_address') {
      // Call action passing ins.options
      const newOptions = ins.options ?? {};
      const address = await getWalletAddress(interpreter, ctx, newOptions);
      ctx.vars[ins.name] = address;
      return;
    }
    if (ins.action === 'get_wallet_balance') {
      // Call action passing ins.options
      const newOptions = ins.options ?? {};
      const balance = await getWalletBalance(interpreter, ctx, newOptions);
      ctx.vars[ins.name] = balance;
      return;
    }
    throw new Error('Invalid setvar command');
  }

  if (ins.value) {
    ctx.vars[ins.name] = ins.value;
    return;
  }

  throw new Error('Invalid SetVar command');
}
