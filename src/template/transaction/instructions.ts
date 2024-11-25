/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// export const enum INSTRUCTION_TYPES {
//   InputUtxo = 'input/utxo',
//   InputAuthority = 'input/authority',
//   InputRaw = 'input/raw',
//   OutputRaw = 'output/raw',
//   OutputToken = 'output/token',
//   OutputData = 'output/data',
//   ActionShuffle = 'action/shuffle',
//   ActionChange = 'action/change',
//   ActionConfig = 'action/config',
//   ActionSetvar = 'action/setvar',
// };

export const INSTRUCTION_TYPES = {
  InputUtxo:       'input/utxo',
  InputAuthority:  'input/authority',
  InputRaw:        'input/raw',
  OutputRaw:       'output/raw',
  OutputToken:     'output/token',
  OutputAuthority: 'output/authority',
  OutputData:      'output/data',
  ActionShuffle:   'action/shuffle',
  ActionChange:    'action/change',
  ActionConfig:    'action/config',
  ActionSetvar:    'action/setvar',
};

export type InstructionType = typeof INSTRUCTION_TYPES[keyof typeof INSTRUCTION_TYPES];

export interface BaseTemplateInstruction {
  readonly type: InstructionType;
}

export type TemplateVarValue = string | number;
export type TemplateVarName = string;
export type TemplateVarRef = `{${TemplateVarName}}`;
export const TEMPLATE_VAR_REF_RE = /^{(.+)}$/;
export type TemplateVar<T extends TemplateVarValue> = TemplateVarRef | T;

/**
 * If the key matches a template reference (i.e. `{name}`) it returns the variable of that name.
 * If not the key should be the actual value.
 */
export function getVariable<T extends TemplateVarValue>(
  ref: TemplateVar<T>,
  vars: Record<TemplateVarName, TemplateVarValue>
): T {
  if (typeof ref === 'string') {
    const match = ref.match(TEMPLATE_VAR_REF_RE);
    if (match !== null) {
      const key = match[1];
      if (!vars[key]) {
        throw new Error(`Variable ${key} not found in available variables`);
      }
      return vars[key] as T;
    }
  }

  return ref as T;
}

export interface RawInputInstruction extends BaseTemplateInstruction {
  readonly type: 'input/raw';
  position?: number;
  txId: TemplateVar<string>;
  index: TemplateVar<number>;
}

export function isRawInputInstruction(x: TxTemplateInstruction): x is RawInputInstruction {
  return 'type' in x && x.type === 'input/raw';
}

export interface UtxoSelectInstruction extends BaseTemplateInstruction {
  readonly type: 'input/utxo';
  position: number;
  fill: TemplateVar<number>;
  token?: TemplateVar<string>;
  address?: TemplateVar<string>;
  autoChange?: boolean;
}

export function isUtxoSelectInstruction(x: TxTemplateInstruction): x is UtxoSelectInstruction {
  return 'type' in x && x.type === 'input/utxo';
}

export interface AuthoritySelectInstruction extends BaseTemplateInstruction {
  readonly type: 'input/authority';
  position: number;
  authority: 'mint' | 'melt';
  token: TemplateVar<string>;
  amount?: TemplateVar<number>;
  address?: TemplateVar<string>;
}

export function isAuthoritySelectInstruction(x: TxTemplateInstruction): x is AuthoritySelectInstruction {
  return 'type' in x && x.type === 'input/authority';
}

export interface RawOutputInstruction extends BaseTemplateInstruction {
  readonly type: 'output/raw';
  position: number;
  amount?: TemplateVar<number>;
  script: TemplateVar<string>; // base64 or hex?
  token?: TemplateVar<string>;
  timelock?: TemplateVar<number>;
  authority?: 'mint' | 'melt';
}

export function isRawOutputInstruction(x: TxTemplateInstruction): x is RawOutputInstruction {
  return 'type' in x && x.type === 'output/raw';
}

export interface DataOutputInstruction extends BaseTemplateInstruction {
  readonly type: 'output/data';
  position: number;
  data: TemplateVar<string>;
}

export function isDataOutputInstruction(x: TxTemplateInstruction): x is DataOutputInstruction {
  return 'type' in x && x.type === 'output/data';
}

export interface TokenOutputInstruction extends BaseTemplateInstruction {
  readonly type: 'output/token';
  position: number;
  amount: TemplateVar<number>;
  token?: TemplateVar<string>;
  address?: TemplateVar<string>;
  timelock?: TemplateVar<number>;
  checkAddress?: boolean;
}

export function isTokenOutputInstruction(x: TxTemplateInstruction): x is TokenOutputInstruction {
  return 'type' in x && x.type === 'output/token';
}

export interface AuthorityOutputInstruction extends BaseTemplateInstruction {
  readonly type: 'output/authority';
  position: number;
  amount: TemplateVar<number>;
  token: TemplateVar<string>;
  authority: 'mint' | 'melt';
  address?: TemplateVar<string>;
  timelock?: TemplateVar<number>;
  checkAddress?: boolean;
}

export function isAuthorityOutputInstruction(x: TxTemplateInstruction): x is AuthorityOutputInstruction {
  return 'type' in x && x.type === 'output/authority';
}

export interface ShuffleInstruction extends BaseTemplateInstruction {
  readonly type: 'action/shuffle';
  target: 'inputs' | 'outputs' | 'all';
}

export function isShuffleInstruction(x: TxTemplateInstruction): x is ShuffleInstruction {
  return 'type' in x && x.type === 'action/shuffle';
}

export interface ChangeInstruction extends BaseTemplateInstruction {
  readonly type: 'action/change';
  token?: TemplateVar<string>;
  address?: TemplateVar<string>;
  timelock?: TemplateVar<number>;
}

export function isChangeInstruction(x: TxTemplateInstruction): x is ChangeInstruction {
  return 'type' in x && x.type === 'action/change';
}

export interface ConfigInstruction extends BaseTemplateInstruction {
  readonly type: 'action/config';
  version?: TemplateVar<number>;
  signalBits?: TemplateVar<number>;
  tokenName?: TemplateVar<string>;
  tokenSymbol?: TemplateVar<string>;
}

export function isConfigInstruction(x: TxTemplateInstruction): x is ConfigInstruction {
  return 'type' in x && x.type === 'action/config';
}

export type SetVarCommand = 'get_wallet_address' | 'get_wallet_balance';

export type SetVarGetWalletAddressOpts = {
  unused?: boolean;
  withBalance?: number;
  withAuthority?: 'mint' | 'melt';
  token?: string;
};

export type SetVarGetWalletBalanceOpts = {
  token?: string;
};

export type SetVarOptions = SetVarGetWalletAddressOpts | SetVarGetWalletBalanceOpts;

export interface SetVarInstruction extends BaseTemplateInstruction {
  readonly type: 'action/setvar';
  name: TemplateVarName;
  value?: TemplateVarValue;
  action?: SetVarCommand;
  options?: SetVarOptions;
}

export function isSetVarInstruction(x: TxTemplateInstruction): x is SetVarInstruction {
  return 'type' in x && x.type === 'action/setvar';
}

export type TxTemplateInstruction =
  | RawInputInstruction
  | UtxoSelectInstruction
  | AuthoritySelectInstruction
  | RawOutputInstruction
  | TokenOutputInstruction
  | AuthorityOutputInstruction
  | DataOutputInstruction
  | ShuffleInstruction
  | ChangeInstruction
  | ConfigInstruction
  | SetVarInstruction;

export type TransactionTemplate = TxTemplateInstruction[];
