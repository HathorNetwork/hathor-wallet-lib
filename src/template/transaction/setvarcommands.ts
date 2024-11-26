import { ITxTemplateInterpreter, IGetUtxosOptions } from './types';
import { TxTemplateContext } from './context';
import { SetVarGetWalletAddressOpts, SetVarGetWalletBalanceOpts } from './instructions';

export async function getWalletAddress(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  options: SetVarGetWalletAddressOpts,
): Promise<string> {
  // TODO: Find address based on options?
  return interpreter.getAddress();
}

export async function getWalletBalance(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  options: SetVarGetWalletAddressOpts,
): Promise<number> {
  return 0;
}
