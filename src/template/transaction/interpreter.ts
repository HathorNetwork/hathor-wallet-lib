/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { RawInputInstruction, RawOutputInstruction, TemplateVarName, TemplateVarValue, TxTemplateInstruction, UtxoSelectInstruction, getVariable, isRawInputInstruction, isRawOutputInstruction, isUtxoSelectInstruction } from './instructions';
import Input from '../../models/input';
import Output from '../../models/output';
import Transaction from '../../models/transaction';
import HathorWallet from '../../new/wallet';
// import { IHathorWallet } from '../../wallet/types';
// import {  } from '../../types';
import { DEFAULT_TX_VERSION, NATIVE_TOKEN_UID, TOKEN_AUTHORITY_MASK, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../constants';
import { IHistoryTx } from 'src/types';
import transactionUtils from '../../utils/transaction';
import tokenUtils from '../../utils/tokens';
import { FullNodeInput, FullNodeOutput, FullNodeToken, FullNodeTxResponse } from 'src/wallet/types';

export interface TokenBalance {
  tokens: number;
  mint_authorities: number;
  melt_authorities: number;
}

export class TxBalance {
  balance: Record<string, TokenBalance>

  constructor() {
    this.balance = {};
  }

  getTokenBalance(token: string): TokenBalance {
    if (!this.balance[token]) {
      this.balance[token] = {
        tokens: 0,
        mint_authorities: 0,
        melt_authorities: 0,
      };
    }

    return this.balance[token];
  }

  setTokenBalance(token: string, balance: TokenBalance) {
    this.balance[token] = balance;
  }

  addInput(tx: IHistoryTx, index: number) {
    console.log(index);
    console.log(JSON.stringify(tx, null, 2));
    console.log(`${tx.outputs.length} > ${index}`);
    if (tx.outputs.length <= index) {
      throw new Error('Index does not exist on tx outputs');
    }
    const output = tx.outputs[index];
    const token = output.token;
    const balance = this.getTokenBalance(token);
    
    if (transactionUtils.isAuthorityOutput(output)) {
      if (transactionUtils.isMint(output)) {
        balance.mint_authorities += 1;
      }

      if (transactionUtils.isMelt(output)) {
        balance.melt_authorities += 1;
      }
    } else {
      balance.tokens += output.value;
    }

    this.setTokenBalance(token, balance);
  }

  addOutput(amount: number, token: string, authority: 'mint' | 'melt' | undefined) {
    const balance = this.getTokenBalance(token);
    if (authority === undefined) {
      balance.tokens -= amount;
    }
    if (authority === 'mint') {
      balance.mint_authorities -= amount;
    }
    if (authority === 'melt') {
      balance.melt_authorities -= amount;
    }
    this.setTokenBalance(token, balance);
  }
}

export class TxTemplateContext {
  version: number;
  signalBits: number;
  inputs: Input[];
  outputs: Output[]
  tokens: string[]; // use token data?
  balance: TxBalance
  tokenName?: string;
  tokenSymbol?: string;
  vars: Record<TemplateVarName, TemplateVarValue>;
  
  constructor() {
    this.inputs = [];
    this.outputs = [];
    this.tokens = [];
    this.version = DEFAULT_TX_VERSION;
    this.signalBits = 0;
    this.balance = new TxBalance();
    this.vars = {};
  }

  addToken(token: string) {
    if (token === NATIVE_TOKEN_UID) {
      return -1;
    }
    const index = this.tokens.indexOf(token);
    if (index > -1) {
      // Token is already on the list.
      return index;
    }
    this.tokens.push(token);
    return this.tokens.length - 1;
  }

  addInput(position: number, ...inputs: Input[]) {
    if (position === -1) {
      this.inputs.push(...inputs);
      return;
    }

    this.inputs.splice(position, 0, ...inputs);
  }

  addOutput(position: number, ...outputs: Output[]) {
    if (position === -1) {
      this.outputs.push(...outputs);
      return;
    }

    this.outputs.splice(position, 0, ...outputs);
  }
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

  async getTx(txId: string): Promise<IHistoryTx> {
    if (this.txCache[txId]) {
      return this.txCache[txId];
    }

    const histtx = await this.wallet.getTx(txId);
    if (histtx) {
      this.txCache[txId] = histtx as IHistoryTx;
      return this.txCache[txId];
    }

    function hidrateIOWithToken<T extends FullNodeInput|FullNodeOutput>(io: T, tokens: FullNodeToken[]) {
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

    const resp = await this.wallet.getFullTxById(txId) as FullNodeTxResponse;
    // We can assume the wallet handles any network errors
    const tx = resp.tx;
    tx.inputs = tx.inputs.map(i => hidrateIOWithToken<FullNodeInput>(i, tx.tokens));
    tx.outputs = tx.outputs.map(o => hidrateIOWithToken<FullNodeOutput>(o, tx.tokens));
    const normalizedTx = transactionUtils.convertFullNodeTxToHistoryTx(tx);
    this.txCache[txId] = normalizedTx;
    return this.txCache[txId];
  }
}

export async function runInstruction(interpreter: WalletTxTemplateInterpreter, ctx: TxTemplateContext, ins: TxTemplateInstruction) {
  if (isRawInputInstruction(ins)) {
    await execRawInputInstruction(interpreter, ctx, ins);
    return;
  }
  if (isUtxoSelectInstruction(ins)) {
    await execUtxoSelectInstruction(interpreter, ctx, ins);
  }
  if (isRawOutputInstruction(ins)) {
    await execRawOutputInstruction(interpreter, ctx, ins);
    return;
  }
}

export async function execRawInputInstruction(interpreter: WalletTxTemplateInterpreter, ctx: TxTemplateContext, ins: RawInputInstruction) {
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

export async function execUtxoSelectInstruction(interpreter: WalletTxTemplateInterpreter, ctx: TxTemplateContext, ins: UtxoSelectInstruction) {
  const position = ins.position ?? -1;
  const fill = getVariable<number>(ins.fill, ctx.vars);
  const token = ins.token ? getVariable<string>(ins.token, ctx.vars) : NATIVE_TOKEN_UID;
  const address = ins.address ? getVariable<string>(ins.address, ctx.vars) : null;
  const authority = ins.authority;
  
  const autoChange = ins.autoChange ?? true;

  // Find utxos
  // XXX: create Utxo selection method
  const { amount, utxos } = { amount: 0, utxos: [{txId: '', index: 0}] } // interpreter.getUtxos(...);

  const inputs = utxos.map(u => (new Input(u.txId, u.index)));
  // add each input to the balance
  for (const input of inputs) {
    const origTx = await interpreter.getTx(input.hash);
    ctx.balance.addInput(origTx, input.index);
  }

  // Add inputs to the array
  ctx.addInput(position, ...inputs);
  
  // XXX: Create change address selection
  // XXX: handle authority selection?
  if (autoChange && (amount > fill)) {
    // Token should only be on the array if present on the outputs
    const tokenIndex = ctx.addToken(token);
    let tokenData = tokenIndex;
    // Get a wallet address from interpreter
    // const address = interpreter.getWalletAddress();
    // Create script for address?
    const script = Buffer.from('cafe', 'hex');
    const output = new Output(amount - fill, script,  { tokenData });
    ctx.addOutput(-1, output);
  }
}

export async function execRawOutputInstruction(_interpreter: WalletTxTemplateInterpreter, ctx: TxTemplateContext, ins: RawOutputInstruction) {
  const position = ins.position ?? -1;
  const scriptStr = getVariable<string>(ins.script, ctx.vars);
  const script = Buffer.from(scriptStr, 'hex');
  const token = ins.token ? getVariable<string>(ins.token, ctx.vars) : NATIVE_TOKEN_UID;
  let timelock: number|undefined = undefined;
  if (ins.timelock) {
    timelock = getVariable<number>(ins.timelock, ctx.vars);
  }
  const authority = ins.authority;

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
