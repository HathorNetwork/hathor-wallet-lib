/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint max-classes-per-file: ["error", 3] */

import { z } from 'zod';
import { IHistoryTx, ILogger, OutputValueType, getDefaultLogger } from '../../types';
import Input from '../../models/input';
import Output from '../../models/output';
import transactionUtils from '../../utils/transaction';
import { CREATE_TOKEN_TX_VERSION, DEFAULT_TX_VERSION, NATIVE_TOKEN_UID } from '../../constants';
import { NanoAction } from './instructions';

export interface TokenBalance {
  tokens: OutputValueType;
  mint_authorities: number;
  melt_authorities: number;
}

export class TxBalance {
  balance: Record<string, TokenBalance>;

  createdTokenBalance: null | TokenBalance;

  constructor() {
    this.balance = {};
    this.createdTokenBalance = null;
  }

  /**
   * Get the current balance of the given token.
   */
  getTokenBalance(token: string): TokenBalance {
    if (!this.balance[token]) {
      this.balance[token] = {
        tokens: 0n,
        mint_authorities: 0,
        melt_authorities: 0,
      };
    }

    return this.balance[token];
  }

  /**
   * Get the current balance of the token being created.
   * Obs: only valid for create token transactions.
   */
  getCreatedTokenBalance(): TokenBalance {
    if (!this.createdTokenBalance) {
      this.createdTokenBalance = {
        tokens: 0n,
        mint_authorities: 0,
        melt_authorities: 0,
      };
    }
    return this.createdTokenBalance;
  }

  /**
   * Set the balance of a token.
   */
  setTokenBalance(token: string, balance: TokenBalance) {
    this.balance[token] = balance;
  }

  /**
   * Set the balance of the created token.
   */
  setCreatedTokenBalance(balance: TokenBalance) {
    this.createdTokenBalance = balance;
  }

  /**
   * Add balance from utxo of the given transaction.
   */
  addBalanceFromUtxo(tx: IHistoryTx, index: number) {
    if (tx.outputs.length <= index) {
      throw new Error('Index does not exist on tx outputs');
    }
    const output = tx.outputs[index];
    const { token } = output;
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

  /**
   * Remove the balance given from the token balance.
   */
  addOutput(amount: OutputValueType, token: string) {
    const balance = this.getTokenBalance(token);
    balance.tokens -= amount;
    this.setTokenBalance(token, balance);
  }

  /**
   * Remove the balance from the token being created.
   */
  addCreatedTokenOutput(amount: OutputValueType) {
    const balance = this.getCreatedTokenBalance();
    balance.tokens -= amount;
    this.setCreatedTokenBalance(balance);
  }

  /**
   * Remove the specified authority from the balance of the given token.
   */
  addOutputAuthority(count: number, token: string, authority: 'mint' | 'melt') {
    const balance = this.getTokenBalance(token);
    if (authority === 'mint') {
      balance.mint_authorities -= count;
    }
    if (authority === 'melt') {
      balance.melt_authorities -= count;
    }
    this.setTokenBalance(token, balance);
  }

  /**
   * Remove the authority from the balance of the token being created.
   */
  addCreatedTokenOutputAuthority(count: number, authority: 'mint' | 'melt') {
    const balance = this.getCreatedTokenBalance();
    if (authority === 'mint') {
      balance.mint_authorities -= count;
    }
    if (authority === 'melt') {
      balance.melt_authorities -= count;
    }
    this.setCreatedTokenBalance(balance);
  }
}

export class NanoContractContext {
  id: string;

  method: string;

  caller: string;

  args: unknown[];

  actions: z.output<typeof NanoAction>[];

  constructor(
    id: string,
    method: string,
    caller: string,
    args: unknown[],
    actions: z.output<typeof NanoAction>[]
  ) {
    this.id = id;
    this.method = method;
    this.caller = caller;
    this.args = args;
    this.actions = actions;
  }
}

export class TxTemplateContext {
  version: number;

  signalBits: number;

  inputs: Input[];

  outputs: Output[];

  tokens: string[];

  balance: TxBalance;

  tokenName?: string;

  tokenSymbol?: string;

  nanoContext?: NanoContractContext;

  vars: Record<string, unknown>;

  _logs: string[];

  _logger: ILogger;

  debug: boolean;

  constructor(logger?: ILogger, debug: boolean = false) {
    this.inputs = [];
    this.outputs = [];
    this.tokens = [];
    this.version = DEFAULT_TX_VERSION;
    this.signalBits = 0;
    this.balance = new TxBalance();
    this.vars = {};
    this._logs = [];
    this._logger = logger ?? getDefaultLogger();
    this.debug = debug;
  }

  /**
   * Add the line to the log array.
   * Optionally use the logger to show the logs as they are being created.
   */
  log(message: string): void {
    this._logs.push(message);
    if (this.debug) {
      this._logger.info(message);
    }
  }

  get logArray(): string[] {
    return this._logs;
  }

  /**
   * Change the current tx
   */
  useCreateTokenTxContext() {
    if (this.tokens.length !== 0) {
      throw new Error(
        `Trying to build a create token tx with ${this.tokens.length} tokens on the array`
      );
    }
    this.version = CREATE_TOKEN_TX_VERSION;
  }

  isCreateTokenTxContext() {
    return this.version === CREATE_TOKEN_TX_VERSION;
  }

  startNanoContractExecution(
    id: string,
    method: string,
    caller: string,
    args: unknown[],
    actions: z.output<typeof NanoAction>[]
  ) {
    if (this.nanoContext) {
      throw new Error('Already building a nano contract tx.');
    }
    this.nanoContext = new NanoContractContext(id, method, caller, args, actions);
  }

  isNanoMethodExecution(): boolean {
    return !!this.nanoContext;
  }

  /**
   * Add a token to the transaction and return its token_data.
   * The token array order will be preserved so the token_data is final.
   *
   * If the transaction is a CREATE_TOKEN_TX it does not have a token array,
   * only HTR (token_data=0) and the created token(token_data=1)
   *
   * @param token Token UID.
   * @returns token_data for the requested token.
   */
  addToken(token: string): number {
    if (token === NATIVE_TOKEN_UID) {
      return 0;
    }
    if (this.version === CREATE_TOKEN_TX_VERSION) {
      throw new Error(`Cannot add a custom token to a CREATE_TOKEN_TX`);
    }
    const index = this.tokens.indexOf(token);
    if (index > -1) {
      // Token is already on the list.
      return index + 1;
    }
    // Token is not on the list, adding now
    this.tokens.push(token);
    return this.tokens.length;
  }

  /**
   * Add inputs to the context.
   */
  addInputs(position: number, ...inputs: Input[]) {
    if (position === -1) {
      this.inputs.push(...inputs);
      return;
    }

    this.inputs.splice(position, 0, ...inputs);
  }

  /**
   * Add outputs to the context.
   */
  addOutputs(position: number, ...outputs: Output[]) {
    if (position === -1) {
      this.outputs.push(...outputs);
      return;
    }

    this.outputs.splice(position, 0, ...outputs);
  }
}
