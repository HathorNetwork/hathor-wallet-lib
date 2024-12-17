/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
  ins: RawInputInstruction
) {
  const position = ins.position ?? -1;
  const txId = getVariable<string>(ins.txId, ctx.vars);
  const index = getVariable<number>(ins.index, ctx.vars);

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
  ins: UtxoSelectInstruction
) {
  const position = ins.position ?? -1;
  const fill = getVariable<number>(ins.fill, ctx.vars);
  const token = ins.token ? getVariable<string>(ins.token, ctx.vars) : NATIVE_TOKEN_UID;
  const address = ins.address ? getVariable<string>(ins.address, ctx.vars) : null;

  const autoChange = ins.autoChange ?? true;

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
    // Token should only be on the array if present on the outputs
    const tokenIndex = ctx.addToken(token);
    const tokenData = tokenIndex;
    // get change address
    const changeAddress = await interpreter.getChangeAddress(ctx);
    // XXX: add network? maybe in interpreter
    const script = createOutputScriptFromAddress(changeAddress, interpreter.getNetwork());
    const output = new Output(changeAmount, script, { tokenData });
    ctx.addOutput(-1, output);
  }
}

/**
 * Execution for AuthoritySelectInstruction
 */
export async function execAuthoritySelectInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: AuthoritySelectInstruction
) {
  const position = ins.position ?? -1;
  const authority = ins.authority;
  const token = ins.token ? getVariable<string>(ins.token, ctx.vars) : NATIVE_TOKEN_UID;
  const amount = ins.amount ? getVariable<number>(ins.amount, ctx.vars) : 1;
  const address = ins.address ? getVariable<string>(ins.address, ctx.vars) : null;

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
  const utxos = await interpreter.getAuthorities(amount, options);

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
  ins: RawOutputInstruction
) {
  const position = ins.position ?? -1;
  const scriptStr = getVariable<string>(ins.script, ctx.vars);
  const script = Buffer.from(scriptStr, 'hex');
  const token = ins.token ? getVariable<string>(ins.token, ctx.vars) : NATIVE_TOKEN_UID;
  let timelock: number | undefined;
  if (ins.timelock) {
    timelock = getVariable<number>(ins.timelock, ctx.vars);
  }
  const { authority } = ins;

  // Add token to tokens array
  const tokenIndex = ctx.addToken(token);
  let tokenData = tokenIndex;

  let amount = 0;
  if (authority === 'mint') {
    amount = TOKEN_MINT_MASK;
    tokenData &= TOKEN_AUTHORITY_MASK;
  } else if (authority === 'melt') {
    amount = TOKEN_MELT_MASK;
    tokenData &= TOKEN_AUTHORITY_MASK;
  } else {
    if (!ins.amount) {
      throw new Error('Raw token output missing amount');
    }
    amount = getVariable<number>(ins.amount, ctx.vars);
  }

  // Add balance to the ctx.balance
  ctx.balance.addOutput(amount, token, authority);

  const output = new Output(amount, script, { timelock, tokenData });
  ctx.addOutput(position, output);
}

/**
 * Execution for DataOutputInstruction
 */
export async function execDataOutputInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: DataOutputInstruction
) {
  const position = ins.position ?? -1;
  const data = getVariable<string>(ins.data, ctx.vars);

  // Add balance to the ctx.balance
  ctx.balance.addOutput(1, NATIVE_TOKEN_UID);

  const dataScript = new ScriptData(data);
  const script = dataScript.createScript();
  const output = new Output(1, script);
  ctx.addOutput(position, output);
}

/**
 * Execution for TokenOutputInstruction
 */
export async function execTokenOutputInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: TokenOutputInstruction
) {
  const position = ins.position ?? -1;
  const token = ins.token ? getVariable<string>(ins.token, ctx.vars) : NATIVE_TOKEN_UID;
  const address = ins.address
    ? getVariable<string>(ins.address, ctx.vars)
    : await interpreter.getAddress();
  let timelock: number | undefined;
  if (ins.timelock) {
    timelock = getVariable<number>(ins.timelock, ctx.vars);
  }
  const amount = getVariable<number>(ins.amount, ctx.vars);

  // Add token to tokens array
  const tokenIndex = ctx.addToken(token);
  const tokenData = tokenIndex;

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
  ins: AuthorityOutputInstruction
) {
  const position = ins.position ?? -1;
  const token = getVariable<string>(ins.token, ctx.vars);
  const address = ins.address
    ? getVariable<string>(ins.address, ctx.vars)
    : await interpreter.getAddress();
  const count = getVariable<number>(ins.amount, ctx.vars);
  let timelock: number | undefined;
  if (ins.timelock) {
    timelock = getVariable<number>(ins.timelock, ctx.vars);
  }

  const { authority } = ins;

  // Add token to tokens array
  const tokenIndex = ctx.addToken(token);
  let tokenData = tokenIndex;

  let amount = 0;
  if (authority === 'mint') {
    amount = TOKEN_MINT_MASK;
    tokenData &= TOKEN_AUTHORITY_MASK;
  } else if (authority === 'melt') {
    amount = TOKEN_MELT_MASK;
    tokenData &= TOKEN_AUTHORITY_MASK;
  } else {
    throw new Error('Authority token output missing `authority`');
  }

  // Add balance to the ctx.balance
  ctx.balance.addOutput(count, token, authority);

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
  ins: ShuffleInstruction
) {
  const target = ins.target;

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
  ins: ChangeInstruction
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
  ins: ConfigInstruction
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
  ins: SetVarInstruction
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
