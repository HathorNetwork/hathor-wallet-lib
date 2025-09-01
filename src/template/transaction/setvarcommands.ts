/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { ITxTemplateInterpreter } from './types';
import { TxTemplateContext } from './context';
import {
  SetVarGetOracleScriptOpts,
  SetVarGetOracleSignedDataOpts,
  SetVarGetWalletAddressOpts,
  SetVarGetWalletBalanceOpts,
  getVariable,
} from './instructions';
import { getOracleBuffer, getOracleSignedDataFromUser } from '../../nano_contracts/utils';
import { IUserSignedData } from '../../nano_contracts/fields/signedData';

export async function getWalletAddress(
  interpreter: ITxTemplateInterpreter,
  _ctx: TxTemplateContext,
  options: z.infer<typeof SetVarGetWalletAddressOpts>
): Promise<string> {
  if (options.index != null) {
    return interpreter.getAddressAtIndex(options.index);
  }
  return interpreter.getAddress();
}

export async function getWalletBalance(
  interpreter: ITxTemplateInterpreter,
  _ctx: TxTemplateContext,
  options: z.infer<typeof SetVarGetWalletBalanceOpts>
): Promise<number | bigint> {
  const data = await interpreter.getBalance(options.token);
  switch (options.authority) {
    case 'mint':
      return data.tokenAuthorities.unlocked.mint;
    case 'melt':
      return data.tokenAuthorities.unlocked.melt;
    default:
      return data.balance.unlocked;
  }
}

export async function getOracleScript(
  interpreter: ITxTemplateInterpreter,
  _ctx: TxTemplateContext,
  options: z.infer<typeof SetVarGetOracleScriptOpts>
): Promise<string> {
  const address = await interpreter.getAddressAtIndex(options.index);
  const oracle = getOracleBuffer(address, interpreter.getNetwork());
  return oracle.toString('hex');
}

export async function getOracleSignedData(
  interpreter: ITxTemplateInterpreter,
  _ctx: TxTemplateContext,
  options: z.infer<typeof SetVarGetOracleSignedDataOpts>
): Promise<IUserSignedData> {
  const address = await interpreter.getAddressAtIndex(options.index);
  const oracle = getOracleBuffer(address, interpreter.getNetwork());

  const data = getVariable<unknown>(
    options.data,
    _ctx.vars,
    SetVarGetOracleSignedDataOpts.shape.data
  );
  const ncId = getVariable<string>(
    options.ncId,
    _ctx.vars,
    SetVarGetOracleSignedDataOpts.shape.ncId
  );

  return getOracleSignedDataFromUser(oracle, ncId, options.type, data, interpreter.getWallet());
}
