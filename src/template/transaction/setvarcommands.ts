/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { ITxTemplateInterpreter, IGetUtxosOptions } from './types';
import { TxTemplateContext } from './context';
import { SetVarGetWalletAddressOpts, SetVarGetWalletBalanceOpts } from './instructions';

export async function getWalletAddress(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  options: z.infer<typeof SetVarGetWalletAddressOpts>,
): Promise<string> {
  // TODO: Find address based on options?
  return interpreter.getAddress();
}

export async function getWalletBalance(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  options: z.infer<typeof SetVarGetWalletAddressOpts>,
): Promise<number> {
  return 0;
}
