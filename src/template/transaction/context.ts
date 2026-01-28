/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint max-classes-per-file: ["error", 3] */

// eslint-disable-next-line max-classes-per-file
import { z } from 'zod';
import {
  TokenVersion,
  IHistoryTx,
  ILogger,
  OutputValueType,
  getDefaultLogger,
  AuthorityType,
} from '../../types';
import Input from '../../models/input';
import Output from '../../models/output';
import transactionUtils from '../../utils/transaction';
import {
  CREATE_TOKEN_TX_VERSION,
  DEFAULT_TX_VERSION,
  NATIVE_TOKEN_UID,
  FEE_PER_OUTPUT,
  FEE_DIVISOR,
} from '../../constants';
import { NanoAction } from './instructions';
import { ITxTemplateInterpreter, IWalletTokenDetails } from './types';

export interface TokenBalance {
  tokens: OutputValueType;
  tokenVersion?: TokenVersion;
  mint_authorities: number;
  melt_authorities: number;
  /**
   * Count of non-authority outputs that is used to calculate the fee
   */
  chargeableOutputs: number;
  /**
   * Count of non-authority inputs that is used to calculate the fee
   */
  chargeableInputs: number;
}

/**
 * Create a new TokenBalance with default values.
 */
function createTokenBalance(tokenVersion?: TokenVersion): TokenBalance {
  return {
    tokens: 0n,
    mint_authorities: 0,
    melt_authorities: 0,
    chargeableOutputs: 0,
    chargeableInputs: 0,
    tokenVersion,
  };
}

/**
 * Calculate the fee for a single token balance.
 */
function calculateTokenFee(balance: TokenBalance): bigint {
  let fee = 0n;
  if (balance.chargeableOutputs > 0) {
    fee += BigInt(balance.chargeableOutputs) * FEE_PER_OUTPUT;
  } else if (balance.chargeableInputs > 0) {
    fee += FEE_PER_OUTPUT;
  }
  return fee;
}

type TokenVersionGetter = (token: string) => TokenVersion;

export class TxBalance {
  balance: Record<string, TokenBalance>;

  createdTokenBalance: null | TokenBalance;

  private _getTokenVersion: TokenVersionGetter;

  constructor(getTokenVersion: TokenVersionGetter) {
    this.balance = {};
    this.createdTokenBalance = null;
    this._getTokenVersion = getTokenVersion;
  }

  /**
   * Get the current balance of the given token.
   * @param token - The token UID
   */
  getTokenBalance(token: string): TokenBalance {
    if (!this.balance[token]) {
      const tokenVersion = this._getTokenVersion(token);
      this.balance[token] = createTokenBalance(tokenVersion);
    }
    return this.balance[token];
  }

  /**
   * Get the current balance of the token being created.
   * Obs: only valid for create token transactions.
   */
  getCreatedTokenBalance(tokenVersion: TokenVersion): TokenBalance {
    if (!this.createdTokenBalance) {
      this.createdTokenBalance = createTokenBalance(tokenVersion);
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
   * @param tx - The transaction containing the UTXO
   * @param index - The output index
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

      if (balance.tokenVersion === TokenVersion.FEE) {
        balance.chargeableInputs += 1;
      }
    }

    this.setTokenBalance(token, balance);
  }

  /**
   * Remove the balance given from the token balance.
   * @param amount - The amount to subtract
   * @param token - The token UID
   */
  addOutput(amount: OutputValueType, token: string) {
    const balance = this.getTokenBalance(token);
    balance.tokens -= amount;

    if (balance.tokenVersion === TokenVersion.FEE) {
      balance.chargeableOutputs += 1;
    }
    this.setTokenBalance(token, balance);
  }

  /**
   * Remove the balance from the token being created.
   */
  addCreatedTokenOutput(amount: OutputValueType, tokenVersion: TokenVersion) {
    const balance = this.getCreatedTokenBalance(tokenVersion);
    balance.tokens -= amount;

    if (balance.tokenVersion === TokenVersion.FEE) {
      balance.chargeableOutputs += 1;
    }
    this.setCreatedTokenBalance(balance);
  }

  /**
   * Remove the specified authority from the balance of the given token.
   * @param count - Number of authorities to remove
   * @param token - The token UID
   * @param authority - The authority type ('mint' or 'melt')
   */
  addOutputAuthority(count: number, token: string, authority: AuthorityType) {
    const balance = this.getTokenBalance(token);
    if (authority === AuthorityType.MINT) {
      balance.mint_authorities -= count;
    }
    if (authority === AuthorityType.MELT) {
      balance.melt_authorities -= count;
    }
    this.setTokenBalance(token, balance);
  }

  /**
   * Remove the authority from the balance of the token being created.
   */
  addCreatedTokenOutputAuthority(
    count: number,
    authority: AuthorityType,
    tokenVersion: TokenVersion
  ) {
    const balance = this.getCreatedTokenBalance(tokenVersion);
    if (authority === AuthorityType.MINT) {
      balance.mint_authorities -= count;
    }
    if (authority === AuthorityType.MELT) {
      balance.melt_authorities -= count;
    }
    this.setCreatedTokenBalance(balance);
  }

  /**
   * Calculate the total fee based on the number of chargeable outputs and inputs for each token in the transaction.
   *
   * **This method should be used only after the balances has been calculated using the addBalanceFromUtxo, and addOutput methods.**
   *
   * The fee is determined using the following rules:
   * - If a token has one or more chargeable outputs, the fee is calculated as `chargeable_outputs * FEE_PER_OUTPUT`.
   * - If a token has zero chargeable outputs but one or more chargeable inputs, a flat fee of `FEE_PER_OUTPUT` is applied.
   * @returns the total fee in HTR
   */
  calculateFee(): bigint {
    let fee = 0n;

    if (this.createdTokenBalance) {
      fee += calculateTokenFee(this.createdTokenBalance);
    }

    for (const token of Object.keys(this.balance)) {
      fee += calculateTokenFee(this.balance[token]);
    }
    return fee;
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

  tokenVersion?: TokenVersion;

  private _fees: Map<string, bigint>;

  /**
   * Cache of token details fetched during template execution.
   * Note: `totalSupply` and `totalTransactions` values may become stale
   * as they are cached at the time of the first fetch and not updated.
   */
  private _tokenDetails: Map<string, IWalletTokenDetails>;

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
    this._fees = new Map();
    this._tokenDetails = new Map();
    this.balance = new TxBalance(this.getTokenVersion.bind(this));
    this.vars = {};
    this._logs = [];
    this._logger = logger ?? getDefaultLogger();
    this.debug = debug;
    this._fees = new Map();
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

  get fees(): Map<string, bigint> {
    return this._fees;
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
   * Also fetches and caches the token version for later use.
   *
   * If the transaction is a CREATE_TOKEN_TX it does not have a token array,
   * only HTR (token_data=0) and the created token(token_data=1)
   *
   * @param interpreter The interpreter to fetch token details from.
   * @param token Token UID.
   * @returns token_data for the requested token.
   */
  async addToken(interpreter: ITxTemplateInterpreter, token: string): Promise<number> {
    // Ensure token details are cached
    await this.cacheTokenDetails(interpreter, token);

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
   * Cache token details without adding to the tokens array.
   * Use this when you need the token version but won't create an output.
   *
   * @param interpreter The interpreter to fetch token details from.
   * @param token Token UID.
   */
  async cacheTokenDetails(interpreter: ITxTemplateInterpreter, token: string): Promise<void> {
    if (this._tokenDetails.has(token)) {
      return;
    }

    if (token === NATIVE_TOKEN_UID) {
      // Native token has a fixed version and doesn't need to be fetched
      this._tokenDetails.set(token, {
        totalSupply: 0n,
        totalTransactions: 0,
        tokenInfo: {
          name: 'Hathor',
          symbol: 'HTR',
          version: TokenVersion.NATIVE,
        },
        authorities: {
          mint: false,
          melt: false,
        },
      });
    } else {
      const tokenDetails = await interpreter.getTokenDetails(token);
      if (tokenDetails.tokenInfo.version == null) {
        throw new Error(`Token ${token} does not have version information`);
      }
      this._tokenDetails.set(token, tokenDetails);
    }
  }

  /**
   * Check if token details are already cached.
   * @param token Token UID.
   * @returns True if the token details are cached, false otherwise.
   */
  hasTokenDetails(token: string): boolean {
    return this._tokenDetails.has(token);
  }

  /**
   * Get the cached token version for a token.
   * The token version must have been previously fetched via cacheTokenDetails or addToken.
   * @param token Token UID.
   * @returns The token version.
   * @throws Error if the token details are not cached.
   */
  getTokenVersion(token: string): TokenVersion {
    const tokenDetails = this._tokenDetails.get(token);
    if (tokenDetails?.tokenInfo.version == null) {
      const cachedTokens = Array.from(this._tokenDetails.keys());
      throw new Error(
        `Token version not found for token ${token}. ` +
          `Call cacheTokenDetails or addToken first. ` +
          `Currently cached tokens: [${cachedTokens.join(', ') || 'none'}]`
      );
    }
    return tokenDetails.tokenInfo.version;
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

  /**
   * Add a token that will be used to pay fees when the transaction is built.
   * @param token token uid
   * @param amount amount of the fee in the smallest unit ("cents").
   */
  addFee(token: string, amount: bigint) {
    if (token !== NATIVE_TOKEN_UID && amount % BigInt(FEE_DIVISOR)) {
      throw new Error(
        `Invalid fee amount for token ${token}: ${amount}. Must be a multiple of ${FEE_DIVISOR}`
      );
    }
    const fee = this._fees.get(token) || 0n;
    this._fees.set(token, fee + amount);
  }
}
