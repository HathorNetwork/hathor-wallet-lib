/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { ITxTemplateInterpreter } from './types';
import { TxTemplateContext } from './context';
import { SetVarGetWalletAddressOpts, SetVarGetWalletBalanceOpts } from './instructions';

export async function getWalletAddress(
  interpreter: ITxTemplateInterpreter,
  _ctx: TxTemplateContext,
  options: z.infer<typeof SetVarGetWalletAddressOpts>
): Promise<string> {
  if (options.index) {
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
