/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { OutputValueType } from 'src/types';
import { NATIVE_TOKEN_UID } from 'src/constants';
import { TxTemplateContext } from './context';
import { ITxTemplateInterpreter, IGetUtxosOptions } from './types';
import { createOutputScriptFromAddress } from '../../utils/address';
import Input from '../../models/input';
import Output from '../../models/output';

/**
 * Select tokens from interpreter and modify context as required by the tokens found.
 */
export async function selectTokens(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  amount: OutputValueType,
  options: IGetUtxosOptions,
  autoChange: boolean,
  changeAddress: string,
  position: number = -1
) {
  const token = options.token ?? NATIVE_TOKEN_UID;
  const { changeAmount, utxos } = await interpreter.getUtxos(amount, options);

  // Add utxos as inputs on the transaction
  const inputs: Input[] = [];
  for (const utxo of utxos) {
    ctx.log(`Found utxo with ${utxo.value} of ${utxo.tokenId}`);
    ctx.log(`Create input ${utxo.index} / ${utxo.txId}`);
    inputs.push(new Input(utxo.txId, utxo.index));
  }

  // First, update balance
  for (const input of inputs) {
    const origTx = await interpreter.getTx(input.hash);
    ctx.balance.addBalanceFromUtxo(origTx, input.index);
  }

  // Then add inputs to context
  ctx.addInputs(position, ...inputs);

  ctx.log(`changeAmount: ${changeAmount} autoChange(${autoChange})`);

  if (autoChange && changeAmount) {
    ctx.log(`Creating change for address: ${changeAddress}`);
    // Token should only be on the array if present on the outputs
    const tokenData = ctx.addToken(token);
    const script = createOutputScriptFromAddress(changeAddress, interpreter.getNetwork());
    const output = new Output(changeAmount, script, { tokenData });
    ctx.balance.addOutput(changeAmount, token);
    ctx.addOutputs(-1, output);
  }
}

/**
 * Select authorities from interpreter and modify context as required by the selection.
 */
export async function selectAuthorities(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  options: IGetUtxosOptions,
  count: number = 1,
  position: number = -1
) {
  const token = options.token ?? NATIVE_TOKEN_UID;
  const utxos = await interpreter.getAuthorities(count, options);

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
  ctx.addInputs(position, ...inputs);
}
