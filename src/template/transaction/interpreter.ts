/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { shuffle } from 'lodash';
import { IHistoryTx, OutputValueType } from '../../types';
import {
  FullNodeInput,
  FullNodeOutput,
  FullNodeToken,
  FullNodeTxResponse,
  Utxo,
} from '../../wallet/types';
import { TxTemplateContext } from './context';
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
  TxTemplateInstruction,
  UtxoSelectInstruction,
  getVariable,
  isAuthorityOutputInstruction,
  isAuthoritySelectInstruction,
  isChangeInstruction,
  isConfigInstruction,
  isDataOutputInstruction,
  isRawInputInstruction,
  isRawOutputInstruction,
  isSetVarInstruction,
  isShuffleInstruction,
  isTokenOutputInstruction,
  isUtxoSelectInstruction,
} from './instructions';
import Input from '../../models/input';
import Output from '../../models/output';
import Transaction from '../../models/transaction';
import HathorWallet from '../../new/wallet';
import {
  NATIVE_TOKEN_UID,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../../constants';
import transactionUtils from '../../utils/transaction';
import tokenUtils from '../../utils/tokens';
import { createOutputScriptFromAddress } from '../../utils/address';
import { ScriptData } from 'src/lib';

interface IGetUtxosOptions {
  token?: string,
  authorities?: OutputValueType,
  filter_address?: string,

  // Dont know if we need these yet
  // max_utxos?: number,
  // amount_smaller_than?: OutputValueType,
  // amount_bigger_than?: OutputValueType,

  // Since we use transactionUtils.selectUtxos to filter the storage call, these early stop args
  // May get in the way of choosing the best selection of utxos.
  // target_amount?: OutputValueType,
  // max_amount?: OutputValueType,

  // Dont know if we need a custom filter yet
  // filter_method?: (utxo: IUtxo) => boolean;
}

export class WalletTxTemplateInterpreter {
  wallet: HathorWallet;

  txCache: Record<string, IHistoryTx>;

  constructor(wallet: HathorWallet) {
    this.wallet = wallet;
    this.txCache = {};
  }

  async build(instructions: TxTemplateInstruction[]): Promise<Transaction> {
    const context = new TxTemplateContext();

    for (const ins of instructions) {
      await runInstruction(this, context, ins);
    }

    return new Transaction(context.inputs, context.outputs);
  }

  async getAddress(markAsUsed: boolean = false): Promise<string> {
    return await this.wallet.getCurrentAddress({ markAsUsed });
  }

  /**
   * XXX: maybe we can save the change address chosen on the context.
   * This way the same change address would be used throughout the transaction
   */
  async getChangeAddress(_ctx: TxTemplateContext) {
    return await this.wallet.getCurrentAddress();
  }

  async getUtxos(amount: OutputValueType, options: IGetUtxosOptions): Promise<{ utxos: Utxo[], changeAmount: number }> {
    // XXX: This may throw, but maybe we should let it.
    return await this.wallet.getUtxosForAmount(amount, options);
  }

  async getAuthorities(amount: OutputValueType, options: IGetUtxosOptions): Promise<Utxo[]> {
    const newOptions = {
      ...options,
      max_utxos: amount,
    };
    let utxos: Utxo[] = [];
    // XXX: This may throw, but maybe we should let it.
    for await (const utxo of this.wallet.storage.selectUtxos(newOptions)) {
      utxos.push(utxo);
    }
    return utxos;
  }

  async getTx(txId: string): Promise<IHistoryTx> {
    if (this.txCache[txId]) {
      return this.txCache[txId];
    }

    const histtx = await this.wallet.getTx(txId);
    if (histtx) {
      this.txCache[txId] = histtx as IHistoryTx;
      return this.txCache[txId];
    }

    function hidrateIOWithToken<T extends FullNodeInput | FullNodeOutput>(
      io: T,
      tokens: FullNodeToken[]
    ) {
      const { token_data } = io;
      if (token_data === 0) {
        return {
          ...io,
          token: NATIVE_TOKEN_UID,
        };
      }

      const tokenIdx = tokenUtils.getTokenIndexFromData(token_data);
      const tokenUid = tokens[tokenIdx - 1]?.uid;
      if (!tokenUid) {
        throw new Error(`Invalid token_data ${token_data}, token not found in tokens list`);
      }

      return { ...io, token: tokenUid } as T;
    }

    const resp = (await this.wallet.getFullTxById(txId)) as FullNodeTxResponse;
    // We can assume the wallet handles any network errors
    const { tx } = resp;
    tx.inputs = tx.inputs.map(i => hidrateIOWithToken<FullNodeInput>(i, tx.tokens));
    tx.outputs = tx.outputs.map(o => hidrateIOWithToken<FullNodeOutput>(o, tx.tokens));
    const normalizedTx = transactionUtils.convertFullNodeTxToHistoryTx(tx);
    this.txCache[txId] = normalizedTx;
    return this.txCache[txId];
  }
}

export async function runInstruction(
  interpreter: WalletTxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: TxTemplateInstruction
) {
  const instructionExecutor = findInstructionExecution(ins);
  await instructionExecutor(interpreter, ctx, ins);
}

export function findInstructionExecution(ins: TxTemplateInstruction): (
  interpreter: WalletTxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: any
) => Promise<void> {
  if (isRawInputInstruction(ins)) {
    return execRawInputInstruction;
  }
  if (isUtxoSelectInstruction(ins)) {
    return execUtxoSelectInstruction;
  }
  if (isAuthoritySelectInstruction(ins)) {
    return execAuthoritySelectInstruction;
  }
  if (isRawOutputInstruction(ins)) {
    return execRawOutputInstruction;
  }
  if (isDataOutputInstruction(ins)) {
    return execDataOutputInstruction;
  }
  if (isTokenOutputInstruction(ins)) {
    return execTokenOutputInstruction;
  }
  if (isAuthorityOutputInstruction(ins)) {
    return execAuthorityOutputInstruction;
  }
  if (isShuffleInstruction(ins)) {
    return execShuffleInstruction;
  }
  if (isChangeInstruction(ins)) {
    return execChangeInstruction;
  }
  if (isConfigInstruction(ins)) {
    return execConfigInstruction;
  }
  if (isSetVarInstruction(ins)) {
    return execSetVarInstruction;
  }

  throw new Error('Cannot determine the instruction to run');
}

/**
 * Execution for RawInputInstruction
 */
export async function execRawInputInstruction(
  interpreter: WalletTxTemplateInterpreter,
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
  interpreter: WalletTxTemplateInterpreter,
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
    const script = createOutputScriptFromAddress(changeAddress, interpreter.wallet.getNetwork());
    const output = new Output(changeAmount, script, { tokenData });
    ctx.addOutput(-1, output);
  }
}

/**
 * Execution for AuthoritySelectInstruction
 */
export async function execAuthoritySelectInstruction(
  interpreter: WalletTxTemplateInterpreter,
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
  _interpreter: WalletTxTemplateInterpreter,
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
  _interpreter: WalletTxTemplateInterpreter,
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
  interpreter: WalletTxTemplateInterpreter,
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

  const script = createOutputScriptFromAddress(address, interpreter.wallet.getNetwork());
  const output = new Output(amount, script, { timelock, tokenData });
  ctx.addOutput(position, output);
}

/**
 * Execution for AuthorityOutputInstruction
 */
export async function execAuthorityOutputInstruction(
  interpreter: WalletTxTemplateInterpreter,
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

  const script = createOutputScriptFromAddress(address, interpreter.wallet.getNetwork());
  const output = new Output(amount, script, { timelock, tokenData });
  // Creates `count` outputs that are copies of the `output`
  ctx.addOutput(position, ...Array(count).fill(output));
}

/**
 * Execution for ShuffleInstruction
 */
export async function execShuffleInstruction(
  _interpreter: WalletTxTemplateInterpreter,
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
  interpreter: WalletTxTemplateInterpreter,
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

  const script = createOutputScriptFromAddress(address, interpreter.wallet.getNetwork());

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
  _interpreter: WalletTxTemplateInterpreter,
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
  _interpreter: WalletTxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: SetVarInstruction
) {
  if (ins.action) {
    // Call action passing ins.options
    return;
  }

  if (ins.value) {
    ctx.vars[ins.name] = ins.value;
    return;
  }

  throw new Error('Invalid SetVar command');
}
