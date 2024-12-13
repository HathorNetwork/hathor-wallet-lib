/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint max-classes-per-file: ["error", 2] */

import { IHistoryTx, ILogger, OutputValueType, getDefaultLogger } from '../../types';
import Input from '../../models/input';
import Output from '../../models/output';
import transactionUtils from '../../utils/transaction';
import { DEFAULT_TX_VERSION, NATIVE_TOKEN_UID } from '../../constants';

export interface TokenBalance {
  tokens: OutputValueType;
  mint_authorities: number;
  melt_authorities: number;
}

export class TxBalance {
  balance: Record<string, TokenBalance>;

  constructor() {
    this.balance = {};
  }

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

  setTokenBalance(token: string, balance: TokenBalance) {
    this.balance[token] = balance;
  }

  addInput(tx: IHistoryTx, index: number) {
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

  addOutput(amount: OutputValueType, token: string) {
    const balance = this.getTokenBalance(token);
    balance.tokens -= amount;
    this.setTokenBalance(token, balance);
  }

  addOutputAuthority(count: number, token: string, authority: 'mint'|'melt') {
    const balance = this.getTokenBalance(token);
    if (authority === 'mint') {
      balance.mint_authorities -= count;
    }
    if (authority === 'melt') {
      balance.melt_authorities -= count;
    }
    this.setTokenBalance(token, balance);
  }
}

export class TxTemplateContext {
  version: number;

  signalBits: number;

  inputs: Input[];

  outputs: Output[];

  tokens: string[]; // use token data?

  balance: TxBalance;

  tokenName?: string;

  tokenSymbol?: string;

  vars: Record<string, any>;

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

  log(message: string): void {
    this._logs.push(message);
    if (this.debug) {
      this._logger.info(message);
    }
  }

  get logArray(): string[] {
    return this._logs;
  }

  addToken(token: string) {
    if (token === NATIVE_TOKEN_UID) {
      return 0;
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
