/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { clone, shuffle } from 'lodash';
import { OutputValueType } from 'src/types';
import {
  AuthorityOutputInstruction,
  AuthoritySelectInstruction,
  CompleteTxInstruction,
  ConfigInstruction,
  DataOutputInstruction,
  NanoAcquireAuthorityAction,
  NanoAction,
  NanoDepositAction,
  NanoGrantAuthorityAction,
  NanoMethodInstruction,
  NanoWithdrawalAction,
  RawInputInstruction,
  RawOutputInstruction,
  SetVarGetOracleScriptOpts,
  SetVarGetOracleSignedDataOpts,
  SetVarGetWalletAddressOpts,
  SetVarGetWalletBalanceOpts,
  SetVarInstruction,
  ShuffleInstruction,
  TokenOutputInstruction,
  TxTemplateInstruction,
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
import { JSONBigInt } from '../../utils/bigint';
import ScriptData from '../../models/script_data';
import {
  getOracleScript,
  getOracleSignedData,
  getWalletAddress,
  getWalletBalance,
} from './setvarcommands';
import { selectAuthorities, selectTokens } from './utils';

/**
 * Find and run the executor function for the instruction.
 */
export async function runInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof TxTemplateInstruction>
) {
  const instructionExecutor = findInstructionExecution(ins);
  await instructionExecutor(interpreter, ctx, ins);
}

/**
 * Get the executor function for a specific instruction.
 * Since we parse the instruction we can guarantee the validity.
 */
export function findInstructionExecution(
  ins: unknown
  /* eslint-disable @typescript-eslint/no-explicit-any */
): (interpreter: ITxTemplateInterpreter, ctx: TxTemplateContext, ins: any) => Promise<void> {
  /* eslint-enable @typescript-eslint/no-explicit-any */
  switch (TxTemplateInstruction.parse(ins).type) {
    case 'input/raw':
      return execRawInputInstruction;
    case 'input/utxo':
      return execUtxoSelectInstruction;
    case 'input/authority':
      return execAuthoritySelectInstruction;
    case 'output/raw':
      return execRawOutputInstruction;
    case 'output/data':
      return execDataOutputInstruction;
    case 'output/token':
      return execTokenOutputInstruction;
    case 'output/authority':
      return execAuthorityOutputInstruction;
    case 'action/shuffle':
      return execShuffleInstruction;
    case 'action/complete':
      return execCompleteTxInstruction;
    case 'action/config':
      return execConfigInstruction;
    case 'action/setvar':
      return execSetVarInstruction;
    case 'nano/execute':
      return execNanoMethodInstruction;
    default:
      throw new Error('Cannot determine the instruction to run');
  }
}

/**
 * Execution for RawInputInstruction
 */
export async function execRawInputInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof RawInputInstruction>
) {
  ctx.log(`Begin RawInputInstruction: ${JSONBigInt.stringify(ins)}`);
  const { position } = ins;
  const txId = getVariable<string>(ins.txId, ctx.vars, RawInputInstruction.shape.txId);
  const index = getVariable<number>(ins.index, ctx.vars, RawInputInstruction.shape.index);
  ctx.log(`index(${index}), txId(${txId})`);

  // Find the original transaction from the input
  const origTx = await interpreter.getTx(txId);
  // Add balance to the ctx.balance
  ctx.balance.addBalanceFromUtxo(origTx, index);

  const input = new Input(txId, index);
  ctx.addInputs(position, input);
}

/**
 * Execution for UtxoSelectInstruction
 */
export async function execUtxoSelectInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof UtxoSelectInstruction>
) {
  ctx.log(`Begin UtxoSelectInstruction: ${JSONBigInt.stringify(ins)}`);
  const { position } = ins;
  const fill = getVariable<bigint>(ins.fill, ctx.vars, UtxoSelectInstruction.shape.fill);
  const token = getVariable<string>(ins.token, ctx.vars, UtxoSelectInstruction.shape.token);
  const address = getVariable<string | undefined>(
    ins.address,
    ctx.vars,
    UtxoSelectInstruction.shape.address
  );
  ctx.log(`fill(${fill}), address(${address}), token(${token})`);

  const { autoChange } = ins;

  // Find utxos
  const options: IGetUtxosOptions = { token };
  if (address) {
    options.filter_address = address;
  }

  const changeAddress =
    getVariable<string | undefined>(
      ins.changeAddress,
      ctx.vars,
      UtxoSelectInstruction.shape.changeAddress
    ) ?? (await interpreter.getChangeAddress(ctx));

  await selectTokens(interpreter, ctx, fill, options, autoChange, changeAddress, position);
}

/**
 * Execution for AuthoritySelectInstruction
 */
export async function execAuthoritySelectInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof AuthoritySelectInstruction>
) {
  ctx.log(`Begin AuthoritySelectInstruction: ${JSONBigInt.stringify(ins)}`);
  const position = ins.position ?? -1;
  const { authority } = ins;
  const token = getVariable<string>(ins.token, ctx.vars, AuthoritySelectInstruction.shape.token);
  const count = getVariable<number>(ins.count, ctx.vars, AuthoritySelectInstruction.shape.count);
  const address = getVariable<string | undefined>(
    ins.address,
    ctx.vars,
    AuthoritySelectInstruction.shape.address
  );
  ctx.log(`count(${count}), address(${address}), token(${token})`);

  let authoritiesInt = 0n;
  if (authority === 'mint') {
    authoritiesInt += TOKEN_MINT_MASK;
  }
  if (authority === 'melt') {
    authoritiesInt += TOKEN_MELT_MASK;
  }

  // Find utxos
  const options: IGetUtxosOptions = {
    token,
    authorities: authoritiesInt,
  };
  if (address) {
    options.filter_address = address;
  }
  await selectAuthorities(interpreter, ctx, options, count, position);
}

/**
 * Execution for RawOutputInstruction
 */
export async function execRawOutputInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof RawOutputInstruction>
) {
  ctx.log(`Begin RawOutputInstruction: ${JSONBigInt.stringify(ins)}`);
  const { position, authority, useCreatedToken } = ins;
  const scriptStr = getVariable<string>(ins.script, ctx.vars, RawOutputInstruction.shape.script);
  const script = Buffer.from(scriptStr, 'hex');
  const token = getVariable<string>(ins.token, ctx.vars, RawOutputInstruction.shape.token);
  const timelock = getVariable<number | undefined>(
    ins.timelock,
    ctx.vars,
    RawOutputInstruction.shape.timelock
  );
  let amount = getVariable<bigint | undefined>(
    ins.amount,
    ctx.vars,
    RawOutputInstruction.shape.amount
  );
  ctx.log(`amount(${amount}) timelock(${timelock}) script(${script}) token(${token})`);
  if (!(authority || amount)) {
    throw new Error('Raw token output missing amount');
  }

  // get tokenData and update token balance on the context
  let tokenData: number;
  if (useCreatedToken) {
    if (!ctx.isCreateTokenTxContext()) {
      ctx.log(`Current transaction is not creating a token.`);
      throw new Error('Current transaction is not creating a token.');
    }
    tokenData = 1;
    if (authority) {
      ctx.log(`Creating authority output`);
      ctx.balance.addCreatedTokenOutputAuthority(1, authority);
    } else {
      ctx.log(`Creating token output`);
      if (amount) {
        ctx.balance.addCreatedTokenOutput(amount);
      }
    }
  } else {
    // Add token to tokens array
    tokenData = ctx.addToken(token);
    if (authority) {
      ctx.log(`Creating authority output`);
      ctx.balance.addOutputAuthority(1, token, authority);
    } else {
      ctx.log(`Creating token output`);
      if (amount) {
        ctx.balance.addOutput(amount, token);
      }
    }
  }

  switch (authority) {
    case 'mint':
      amount = TOKEN_MINT_MASK;
      tokenData |= TOKEN_AUTHORITY_MASK;
      break;
    case 'melt':
      amount = TOKEN_MELT_MASK;
      tokenData |= TOKEN_AUTHORITY_MASK;
      break;
    default:
      break;
  }
  if (!amount) {
    throw new Error('Raw token output missing amount');
  }

  const output = new Output(amount, script, { timelock, tokenData });
  ctx.addOutputs(position, output);
}

/**
 * Execution for DataOutputInstruction
 */
export async function execDataOutputInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof DataOutputInstruction>
) {
  ctx.log(`Begin DataOutputInstruction: ${JSONBigInt.stringify(ins)}`);
  const { position, useCreatedToken } = ins;
  const data = getVariable<string>(ins.data, ctx.vars, DataOutputInstruction.shape.data);
  const token = getVariable<string>(ins.token, ctx.vars, DataOutputInstruction.shape.token);
  ctx.log(`Creating data(${data}) output for token(${token})`);

  let tokenData: number;
  if (useCreatedToken) {
    if (!ctx.isCreateTokenTxContext()) {
      ctx.log(`Current transaction is not creating a token.`);
      throw new Error('Current transaction is not creating a token.');
    }
    ctx.log(`Using created token`);
    tokenData = 1;
    ctx.balance.addCreatedTokenOutput(1n);
  } else {
    ctx.log(`Using token(${token})`);
    // Add token to tokens array
    tokenData = ctx.addToken(token);
    ctx.balance.addOutput(1n, token);
  }

  const dataScript = new ScriptData(data);
  const script = dataScript.createScript();
  const output = new Output(1n, script, { tokenData });
  ctx.addOutputs(position, output);
}

/**
 * Execution for TokenOutputInstruction
 */
export async function execTokenOutputInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof TokenOutputInstruction>
) {
  ctx.log(`Begin TokenOutputInstruction: ${JSONBigInt.stringify(ins)}`);
  const { position, useCreatedToken } = ins;
  const token = getVariable<string>(ins.token, ctx.vars, TokenOutputInstruction.shape.token);
  const address = getVariable<string>(ins.address, ctx.vars, TokenOutputInstruction.shape.address);
  const timelock = getVariable<number | undefined>(
    ins.timelock,
    ctx.vars,
    TokenOutputInstruction.shape.timelock
  );
  const amount = getVariable<bigint>(ins.amount, ctx.vars, TokenOutputInstruction.shape.amount);
  ctx.log(`Creating token output with amount(${amount}) address(${address}) timelock(${timelock})`);

  let tokenData: number;
  if (useCreatedToken) {
    if (!ctx.isCreateTokenTxContext()) {
      ctx.log(`Current transaction is not creating a token.`);
      throw new Error('Current transaction is not creating a token.');
    }
    ctx.log(`Using created token`);
    tokenData = 1;
    ctx.balance.addCreatedTokenOutput(amount);
  } else {
    ctx.log(`Using token(${token})`);
    // Add token to tokens array
    tokenData = ctx.addToken(token);
    ctx.balance.addOutput(amount, token);
  }

  const script = createOutputScriptFromAddress(address, interpreter.getNetwork());
  const output = new Output(amount, script, { timelock, tokenData });
  ctx.addOutputs(position, output);
}

/**
 * Execution for AuthorityOutputInstruction
 */
export async function execAuthorityOutputInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof AuthorityOutputInstruction>
) {
  ctx.log(`Begin AuthorityOutputInstruction: ${JSONBigInt.stringify(ins)}`);
  const { authority, position, useCreatedToken } = ins;
  const token = getVariable<string | undefined>(
    ins.token,
    ctx.vars,
    AuthorityOutputInstruction.shape.token
  );
  const address = getVariable<string>(
    ins.address,
    ctx.vars,
    AuthorityOutputInstruction.shape.address
  );
  const timelock = getVariable<number | undefined>(
    ins.timelock,
    ctx.vars,
    AuthorityOutputInstruction.shape.timelock
  );
  const count = getVariable<number>(ins.count, ctx.vars, AuthorityOutputInstruction.shape.count);
  ctx.log(
    `Creating count(${count}) "${authority}" authority outputs with address(${address}) timelock(${timelock})`
  );

  let tokenData: number;
  if (useCreatedToken) {
    if (!ctx.isCreateTokenTxContext()) {
      ctx.log(`Current transaction is not creating a token.`);
      throw new Error('Current transaction is not creating a token.');
    }
    ctx.log(`Using created token`);
    tokenData = 1;
    ctx.balance.addCreatedTokenOutputAuthority(count, authority);
  } else {
    if (!token) {
      throw new Error(`token is required when trying to add an authority output`);
    }
    ctx.log(`Using token(${token})`);
    // Add token to tokens array
    tokenData = ctx.addToken(token);
    // Add balance to the ctx.balance
    ctx.balance.addOutputAuthority(count, token, authority);
  }

  let amount: OutputValueType | undefined = 0n;
  switch (authority) {
    case 'mint':
      amount = TOKEN_MINT_MASK;
      tokenData |= TOKEN_AUTHORITY_MASK;
      break;
    case 'melt':
      amount = TOKEN_MELT_MASK;
      tokenData |= TOKEN_AUTHORITY_MASK;
      break;
    default:
      throw new Error('Authority token output missing `authority`');
  }

  const script = createOutputScriptFromAddress(address, interpreter.getNetwork());
  const output = new Output(amount, script, { timelock, tokenData });
  // Creates `count` outputs that are copies of the `output`
  ctx.addOutputs(position, ...Array(count).fill(output));
}

/**
 * Execution for ShuffleInstruction
 */
export async function execShuffleInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof ShuffleInstruction>
) {
  ctx.log(`Begin ShuffleInstruction: ${JSONBigInt.stringify(ins)}`);
  const { target } = ins;

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
 * Execution for CompleteTxInstruction
 */
export async function execCompleteTxInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof CompleteTxInstruction>
) {
  ctx.log(`Begin CompleteTxInstruction: ${JSONBigInt.stringify(ins)}`);
  const token = getVariable<string | undefined>(
    ins.token,
    ctx.vars,
    CompleteTxInstruction.shape.token
  );
  const changeAddress =
    getVariable<string | undefined>(
      ins.changeAddress,
      ctx.vars,
      CompleteTxInstruction.shape.changeAddress
    ) ?? (await interpreter.getChangeAddress(ctx));
  const address = getVariable<string | undefined>(
    ins.address,
    ctx.vars,
    CompleteTxInstruction.shape.address
  );
  const timelock = getVariable<number | undefined>(
    ins.timelock,
    ctx.vars,
    CompleteTxInstruction.shape.timelock
  );
  const { skipSelection, skipAuthorities, skipChange, calculateFee } = ins;
  ctx.log(
    `changeAddress(${changeAddress}) address(${address}) timelock(${timelock}) token(${token}), calculateFee(${calculateFee}), skipSelection(${skipSelection}), skipChange(${skipChange}), skipAuthorities(${skipAuthorities})`
  );

  const tokensToCheck: string[] = [];
  if (token) {
    tokensToCheck.push(token);
  } else {
    // Check HTR and all tokens on the transaction
    tokensToCheck.push(NATIVE_TOKEN_UID);
    ctx.tokens.forEach(tk => {
      tokensToCheck.push(tk);
    });
  }

  // calculate token creation fee
  if (calculateFee && ctx.isCreateTokenTxContext()) {
    // INFO: Currently fees only make sense for create token transactions.

    const amount = ctx.balance.createdTokenBalance!.tokens;
    const deposit = interpreter.getHTRDeposit(amount);

    // Add the required HTR to create the tokens
    const balance = ctx.balance.getTokenBalance(NATIVE_TOKEN_UID);
    balance.tokens += deposit;
    ctx.balance.setTokenBalance(NATIVE_TOKEN_UID, balance);

    // If we weren't going to check HTR, we need to include in the tokens to check
    if (!tokensToCheck.includes(NATIVE_TOKEN_UID)) {
      tokensToCheck.push(NATIVE_TOKEN_UID);
    }
  }

  const changeScript = createOutputScriptFromAddress(changeAddress, interpreter.getNetwork());

  for (const tokenUid of tokensToCheck) {
    ctx.log(`Completing tx for token ${tokenUid}`);
    // Check balances for token.
    const balance = ctx.balance.getTokenBalance(tokenUid);
    const tokenData = ctx.addToken(tokenUid);
    if (balance.tokens > 0 && !skipChange) {
      const value = balance.tokens;
      // Surplus of token on the inputs, need to add a change output
      ctx.log(`Creating a change output for ${value} / ${tokenUid}`);
      // Add balance to the ctx.balance
      ctx.balance.addOutput(value, tokenUid);

      // Creates an output with the value of the outstanding balance
      const output = new Output(value, changeScript, { timelock, tokenData });
      ctx.addOutputs(-1, output);
    } else if (balance.tokens < 0 && !skipSelection) {
      const value = -balance.tokens;
      ctx.log(`Finding inputs for ${value} / ${tokenUid}`);
      // Surplus of tokens on the outputs, need to select tokens and add inputs
      const options: IGetUtxosOptions = { token: tokenUid };
      if (address) {
        options.filter_address = address;
      }
      const { changeAmount, utxos } = await interpreter.getUtxos(value, options);

      // Add utxos as inputs on the transaction
      const inputs: Input[] = [];
      for (const utxo of utxos) {
        ctx.log(`Found utxo with ${utxo.value} of ${utxo.tokenId}`);
        ctx.log(`Create input ${utxo.index} / ${utxo.txId}`);
        inputs.push(new Input(utxo.txId, utxo.index));
        // Update balance
        const origTx = await interpreter.getTx(utxo.txId);
        ctx.balance.addBalanceFromUtxo(origTx, utxo.index);
      }

      // Then add inputs to context
      ctx.addInputs(-1, ...inputs);

      if (changeAmount) {
        ctx.log(`Creating change with ${changeAmount} for address: ${changeAddress}`);
        const output = new Output(changeAmount, changeScript, { tokenData });
        ctx.balance.addOutput(changeAmount, tokenUid);
        ctx.addOutputs(-1, output);
      }
    }

    // Skip authority blocks if we wish to not include authority completion.
    if (skipAuthorities) {
      continue;
    }

    if (balance.mint_authorities > 0) {
      const count = balance.mint_authorities;
      ctx.log(`Creating ${count} mint outputs / ${tokenUid}`);
      // Need to create a token output
      // Add balance to the ctx.balance
      ctx.balance.addOutputAuthority(count, tokenUid, 'mint');

      // Creates an output with the value of the outstanding balance
      const output = new Output(TOKEN_MINT_MASK, changeScript, {
        timelock,
        tokenData: tokenData | TOKEN_AUTHORITY_MASK,
      });
      ctx.addOutputs(-1, ...Array(count).fill(output));
    } else if (balance.mint_authorities < 0) {
      const count = -balance.mint_authorities;
      ctx.log(`Finding inputs for ${count} mint authorities / ${tokenUid}`);
      // Need to find authorities to fill balance
      const utxos = await interpreter.getAuthorities(count, {
        token: tokenUid,
        authorities: 1n, // Mint
      });

      // Add utxos as inputs on the transaction
      const inputs: Input[] = [];
      for (const utxo of utxos) {
        ctx.log(`Found authority utxo ${utxo.authorities} of ${token}`);
        ctx.log(`Create input ${utxo.index} / ${utxo.txId}`);
        inputs.push(new Input(utxo.txId, utxo.index));
      }
      // First, update balance
      for (const input of inputs) {
        const origTx = await interpreter.getTx(input.hash);
        ctx.balance.addBalanceFromUtxo(origTx, input.index);
      }

      // Then add inputs to context
      ctx.addInputs(-1, ...inputs);
    }

    if (balance.melt_authorities > 0) {
      const count = balance.melt_authorities;
      ctx.log(`Creating ${count} melt outputs / ${tokenUid}`);
      // Need to create a token output
      // Add balance to the ctx.balance
      ctx.balance.addOutputAuthority(count, tokenUid, 'melt');

      // Creates an output with the value of the outstanding balance
      const output = new Output(TOKEN_MELT_MASK, changeScript, {
        timelock,
        tokenData: tokenData | TOKEN_AUTHORITY_MASK,
      });
      ctx.addOutputs(-1, ...Array(count).fill(output));
    } else if (balance.melt_authorities < 0) {
      const count = -balance.melt_authorities;
      ctx.log(`Finding inputs for ${count} melt authorities / ${tokenUid}`);
      // Need to find authorities to fill balance
      const utxos = await interpreter.getAuthorities(count, {
        token: tokenUid,
        authorities: 2n, // Melt
      });

      // Add utxos as inputs on the transaction
      const inputs: Input[] = [];
      for (const utxo of utxos) {
        ctx.log(`Found authority utxo ${utxo.authorities} of ${token}`);
        ctx.log(`Create input ${utxo.index} / ${utxo.txId}`);
        inputs.push(new Input(utxo.txId, utxo.index));
      }
      // First, update balance
      for (const input of inputs) {
        const origTx = await interpreter.getTx(input.hash);
        ctx.balance.addBalanceFromUtxo(origTx, input.index);
      }

      // Then add inputs to context
      ctx.addInputs(-1, ...inputs);
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
  ctx.log(`Begin ConfigInstruction: ${JSONBigInt.stringify(ins)}`);
  const version = getVariable<number | undefined>(
    ins.version,
    ctx.vars,
    ConfigInstruction.shape.version
  );
  const signalBits = getVariable<number | undefined>(
    ins.signalBits,
    ctx.vars,
    ConfigInstruction.shape.signalBits
  );
  const tokenName = getVariable<string | undefined>(
    ins.tokenName,
    ctx.vars,
    ConfigInstruction.shape.tokenName
  );
  const tokenSymbol = getVariable<string | undefined>(
    ins.tokenSymbol,
    ctx.vars,
    ConfigInstruction.shape.tokenSymbol
  );
  const createToken = getVariable<boolean | undefined>(
    ins.createToken,
    ctx.vars,
    ConfigInstruction.shape.createToken
  );
  ctx.log(
    `version(${version}) signalBits(${signalBits}) tokenName(${tokenName}) tokenSymbol(${tokenSymbol}) createToken(${createToken})`
  );

  if (version) {
    ctx.version = version;
  }
  if (signalBits) {
    ctx.signalBits = signalBits;
  }
  if (tokenName) {
    ctx.tokenName = tokenName;
  }
  if (tokenSymbol) {
    ctx.tokenSymbol = tokenSymbol;
  }
  if (createToken) {
    ctx.useCreateTokenTxContext();
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
  ctx.log(`Begin SetVarInstruction: ${JSONBigInt.stringify(ins)}`);
  if (!ins.call) {
    ctx.log(`Setting ${ins.name} with ${ins.value}`);
    ctx.vars[ins.name] = ins.value;
    return;
  }

  if (ins.call.method === 'get_wallet_address') {
    // Validate options and get token variable
    const callArgs = SetVarGetWalletAddressOpts.parse(ins.call);
    // Call action with valid options
    const address = await getWalletAddress(interpreter, ctx, callArgs);
    ctx.log(`Setting ${ins.name} with ${address}`);
    ctx.vars[ins.name] = address;
    return;
  }
  if (ins.call.method === 'get_wallet_balance') {
    // Validate options and get token variable
    const callArgs = SetVarGetWalletBalanceOpts.parse(ins.call);
    const token = getVariable<string>(
      callArgs.token,
      ctx.vars,
      SetVarGetWalletBalanceOpts.shape.token
    );
    const newOptions = clone(callArgs);
    newOptions.token = token;
    // Call action with valid options
    const balance = await getWalletBalance(interpreter, ctx, newOptions);
    ctx.vars[ins.name] = balance;
    ctx.log(`Setting ${ins.name} with ${balance}`);
    return;
  }
  if (ins.call.method === 'get_oracle_script') {
    const callArgs = SetVarGetOracleScriptOpts.parse(ins.call);
    const oracle = await getOracleScript(interpreter, ctx, callArgs);
    ctx.log(`Setting ${ins.name} with ${oracle}`);
    ctx.vars[ins.name] = oracle;
    return;
  }
  if (ins.call.method === 'get_oracle_signed_data') {
    const callArgs = SetVarGetOracleSignedDataOpts.parse(ins.call);
    const signedData = await getOracleSignedData(interpreter, ctx, callArgs);
    ctx.log(`Setting ${ins.name} with ${signedData}`);
    ctx.vars[ins.name] = signedData;
    return;
  }
  throw new Error('Invalid setvar command');
}

/** ******************* */

async function validateDepositNanoAction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  action: z.infer<typeof NanoDepositAction>
) {
  const token = getVariable<string>(action.token, ctx.vars, NanoDepositAction.shape.token);
  const amount = getVariable<OutputValueType>(
    action.amount,
    ctx.vars,
    NanoDepositAction.shape.amount
  );
  const address = getVariable<string | undefined>(
    action.address,
    ctx.vars,
    NanoDepositAction.shape.address
  );

  // This is the action without variables, which will be used to create the header
  // Change address may be a reference but since its not used on the header it makes no difference.
  const actual = {
    ...action,
    token,
    amount,
    address,
  };

  if (action.skipSelection) {
    // Do not select inputs
    return actual;
  }

  // Find utxos
  const options: IGetUtxosOptions = { token };
  if (address) {
    options.filter_address = address;
  }
  const changeAddress =
    getVariable<string | undefined>(
      action.changeAddress,
      ctx.vars,
      NanoDepositAction.shape.changeAddress
    ) ?? (await interpreter.getChangeAddress(ctx));

  await selectTokens(interpreter, ctx, amount, options, action.autoChange, changeAddress);

  return actual;
}

async function validateWithdrawalNanoAction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  action: z.infer<typeof NanoWithdrawalAction>
) {
  const token = getVariable<string>(action.token, ctx.vars, NanoWithdrawalAction.shape.token);
  const amount = getVariable<OutputValueType>(
    action.amount,
    ctx.vars,
    NanoWithdrawalAction.shape.amount
  );
  const address =
    getVariable<string | undefined>(action.address, ctx.vars, NanoWithdrawalAction.shape.address) ??
    (await interpreter.getAddress());

  // This is the action without variables, which will be used to create the header
  const actual = {
    ...action,
    token,
    amount,
    address,
  };

  const tokenData = action.useCreatedToken ? 1 : ctx.addToken(token);
  const script = createOutputScriptFromAddress(address, interpreter.getNetwork());
  const output = new Output(amount, script, { tokenData });
  ctx.addOutputs(-1, output);
  return actual;
}

async function validateGrantAuthorityNanoAction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  action: z.infer<typeof NanoGrantAuthorityAction>
) {
  const token = getVariable<string>(action.token, ctx.vars, NanoGrantAuthorityAction.shape.token);
  const { authority } = action;
  const address = getVariable<string | undefined>(
    action.address,
    ctx.vars,
    NanoGrantAuthorityAction.shape.address
  );

  // This is the action without variables, which will be used to create the header
  const actual = {
    ...action,
    token,
    authority,
    address,
  };

  if (action.skipSelection) {
    // Do not select inputs
    return actual;
  }

  let authoritiesInt = 0n;
  if (authority === 'mint') {
    authoritiesInt += TOKEN_MINT_MASK;
  }
  if (authority === 'melt') {
    authoritiesInt += TOKEN_MELT_MASK;
  }

  // Find utxos
  const options: IGetUtxosOptions = {
    token,
    authorities: authoritiesInt,
  };
  if (address) {
    options.filter_address = address;
  }
  await selectAuthorities(interpreter, ctx, options);
  return actual;
}

async function validateAcquireAuthorityNanoAction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  action: z.infer<typeof NanoAcquireAuthorityAction>
) {
  const token = getVariable<string>(action.token, ctx.vars, NanoAcquireAuthorityAction.shape.token);
  const address =
    getVariable<string | undefined>(
      action.address,
      ctx.vars,
      NanoAcquireAuthorityAction.shape.address
    ) ?? (await interpreter.getAddress());

  // This is the action without variables, which will be used to create the header
  const actual = {
    ...action,
    token,
    authority: action.authority,
    address,
  };

  const tokenData = TOKEN_AUTHORITY_MASK | (action.useCreatedToken ? 1 : ctx.addToken(token));
  let amount: OutputValueType;
  if (action.authority === 'mint') {
    amount = TOKEN_MINT_MASK;
  } else if (action.authority === 'melt') {
    amount = TOKEN_MELT_MASK;
  } else {
    throw new Error('This should never happen');
  }

  const script = createOutputScriptFromAddress(address, interpreter.getNetwork());
  const output = new Output(amount, script, { tokenData });
  ctx.addOutputs(-1, output);
  return actual;
}

/**
 * Execution for NanoMethodInstruction
 */
export async function execNanoMethodInstruction(
  _interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: z.infer<typeof NanoMethodInstruction>
) {
  ctx.log(`Begin NanoMethodInstruction: ${JSONBigInt.stringify(ins)}`);

  const id = getVariable<string>(ins.id, ctx.vars, NanoMethodInstruction.shape.id);
  const { method } = ins;
  const caller = getVariable<string>(ins.caller, ctx.vars, NanoMethodInstruction.shape.caller);

  const args: unknown[] = [];
  for (const arg of ins.args) {
    const parsedArg = getVariable<unknown>(arg, ctx.vars, z.string().or(z.unknown()));
    args.push(parsedArg);
  }

  ctx.log(`id(${id}) method(${method}) caller(${caller}) args(${args})`);

  const actions: z.output<typeof NanoAction>[] = [];
  for (const action of ins.actions || []) {
    switch (action.action) {
      case 'deposit':
        actions.push(await validateDepositNanoAction(_interpreter, ctx, action));
        break;
      case 'withdrawal':
        actions.push(await validateWithdrawalNanoAction(_interpreter, ctx, action));
        break;
      case 'grant_authority':
        actions.push(await validateGrantAuthorityNanoAction(_interpreter, ctx, action));
        break;
      case 'acquire_authority':
        actions.push(await validateAcquireAuthorityNanoAction(_interpreter, ctx, action));
        break;
      default:
        ctx.log(`Called nano method execute with action ${JSON.stringify(action)}`);
        throw new Error('This should never happen');
    }
  }

  ctx.startNanoContractExecution(id, method, caller, args, actions);
}
