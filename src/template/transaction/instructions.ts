/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NATIVE_TOKEN_UID } from '../../constants';
import { z } from 'zod';


// export const INSTRUCTION_TYPES = {
//   InputUtxo:       'input/utxo',
//   InputAuthority:  'input/authority',
//   InputRaw:        'input/raw',
//   OutputRaw:       'output/raw',
//   OutputToken:     'output/token',
//   OutputAuthority: 'output/authority',
//   OutputData:      'output/data',
//   ActionShuffle:   'action/shuffle',
//   ActionChange:    'action/change',
//   ActionConfig:    'action/config',
//   ActionSetvar:    'action/setvar',
// };

// export type InstructionType = typeof INSTRUCTION_TYPES[keyof typeof INSTRUCTION_TYPES];

// export type TemplateVarValue = string | number;
// export type TemplateVarName = string;
// export type TemplateVarRef = `{${TemplateVarName}}`;
// export const TEMPLATE_VAR_REF_RE = /^{(.+)}$/;
// export type ins.type === 'input/rawemplateVar<T extends TemplateVarValue> = TemplateVarRef | T;

const TEMPLATE_REFERENCE_RE = /\{[\w\d]+\}/;

export const TemplateRef = z.string().regex(TEMPLATE_REFERENCE_RE);

/**
 * If the key matches a template reference (i.e. `{name}`) it returns the variable of that name.
 * If not the ref should be the actual value.
 * This is validated by the `schema` argument which is a ZodType that parses either:
 *   - A `TemplateRef` or;
 *   - A ZodType that outputs `S`;
 *
 * The generic system allows with just the first argument a validation that the
 * schema will parse to the expected type and that `ref` is `string | S`.
 * This way changes on validation affect the executors and the value from vars
 * will be of the expected type.
 * The goal of this system is to avoid too much verbosity while keeping strong cohesive typing.
 *
 * @example
 * ```
 * const TokenSchema = TemplateRef.or(z.string().regex(/^[A-F0-9]{64}&1/));
 * const AmountSchema = TemplateRef.or(z.bigint());
 * const IndexSchema = TemplateRef.or(z.number().min(0));
 *
 * const token: string = getVariable<string>(ref1, {foo: 'bar'}, TokenSchema);
 * const amount: bigint = getVariable<bigint>(ref2, {foo: 10n}, AmountSchema);
 * const token: string = getVariable<number>(ref3, {foo: 27}, IndexSchema);
 * ```
 */
export function getVariable<S, T extends z.ZodUnion<[typeof TemplateRef, z.ZodType<S, z.ZodTypeDef, any>]> = z.ZodUnion<[typeof TemplateRef, z.ZodType<S, z.ZodTypeDef, any>]>>(
  ref: z.infer<T>,
  vars: Record<string, unknown>,
  schema: T,
): S {
  let val = ref; // type should be: string | S
  const parsed = TemplateRef.safeParse(ref);
  if (parsed.success) {
    const match = parsed.data.match(TEMPLATE_REFERENCE_RE);
    if (match !== null) {
      const key = match[1];
      if (!vars[key]) {
        throw new Error(`Variable ${key} not found in available variables`);
      }
      // We assume that the variable in the context is of type S and we validate this.
      // The case where a `{...}` string is saved is not possible since we do not
      // allow this type of string as variable.
      val = vars[key] as S;
    }
  }

  return schema.parse(val) as S;
}

// Transaction IDs and Custom Tokens are sha256 hex encoded
export const Sha256HexSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
export const TxIdSchema = Sha256HexSchema;
export const CustomTokenSchema = Sha256HexSchema;
// If we want to represent all tokens we need to include the native token uid 00
export const TokenSchema = z.string().regex(/^[a-fA-F0-9]{64}|00$/);
// Addresses are base58 with length 34, may be 35 depending on the choice of version byte
export const AddressSchema = z.string().regex(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{34,35}$/);

export const RawInputInstruction = z.object({
  type: z.literal('input/raw'),
  position: z.number().default(-1),
  index: TemplateRef.or(z.coerce.number()),
  txId: TemplateRef.or(TxIdSchema),
});

export const UtxoSelectInstruction = z.object({
  type: z.literal('input/utxo'),
  position: z.number().default(-1),
  fill: TemplateRef.or(z.coerce.bigint()),
  token: TemplateRef.or(TokenSchema.default(NATIVE_TOKEN_UID)),
  address: TemplateRef.or(AddressSchema.optional()),
  autoChange: z.boolean().default(true),
  changeAddress: TemplateRef.or(AddressSchema.optional()),
});

export const AuthoritySelectInstruction = z.object({
  type: z.literal('input/authority'),
  position: z.number().default(-1),
  authority: z.enum(['mint', 'melt']),
  token: TemplateRef.or(CustomTokenSchema),
  count: TemplateRef.or(z.coerce.number().default(1)),
  address: TemplateRef.or(AddressSchema.optional()),
});

export const RawOutputInstruction = z.object({
  type: z.literal('output/raw'),
  position: z.number().default(-1),
  amount: TemplateRef.or(z.coerce.bigint().optional()),
  script: TemplateRef.or(z.string()),
  token: TemplateRef.or(TokenSchema.default('00')),
  timelock: TemplateRef.or(z.coerce.number().optional()),
  authority: z.enum(['mint', 'melt']).optional(),
});

export const TokenOutputInstruction = z.object({
  type: z.literal('output/token'),
  position: z.number().default(-1),
  amount: TemplateRef.or(z.coerce.bigint()),
  token: TemplateRef.or(TokenSchema.default('00')),
  address: TemplateRef.or(AddressSchema),
  timelock: TemplateRef.or(z.coerce.number().optional()),
  checkAddress: z.boolean().optional(),
});

export const AuthorityOutputInstruction = z.object({
  type: z.literal('output/authority'),
  position: z.number().default(-1),
  count: TemplateRef.or(z.coerce.number()),
  token: TemplateRef.or(CustomTokenSchema),
  authority: z.enum(['mint', 'melt']),
  address: TemplateRef.or(AddressSchema),
  timelock: TemplateRef.or(z.coerce.number().optional()),
  checkAddress: z.boolean().optional(),
});

export const DataOutputInstruction = z.object({
  type: z.literal('output/data'),
  position: z.number().default(-1),
  data: TemplateRef.or(z.string()),
  token: TemplateRef.or(TokenSchema.default(NATIVE_TOKEN_UID)),
});

export const ShuffleInstruction = z.object({
  type: z.literal('action/shuffle'),
  target: z.enum(['inputs', 'outputs', 'all']),
});

export const ChangeInstruction = z.object({
  type: z.literal('action/change'),
  token: TemplateRef.or(TokenSchema.optional()),
  address: TemplateRef.or(AddressSchema.optional()),
  timelock: TemplateRef.or(z.coerce.number().optional()),
});

export const CompleteTxInstruction = z.object({
  type: z.literal('action/complete'),
  token: TemplateRef.or(TokenSchema.optional()),
  address: TemplateRef.or(z.string().optional()),
  changeAddress: TemplateRef.or(AddressSchema.optional()),
  timelock: TemplateRef.or(z.coerce.number()).optional(),
});

export const ConfigInstruction = z.object({
  type: z.literal('action/config'),
  version: TemplateRef.or(z.number().optional()),
  signalBits: TemplateRef.or(z.number().optional()),
  tokenName: TemplateRef.or(z.string().optional()),
  tokenSymbol: TemplateRef.or(z.string().optional()),
});

export const SetVarGetWalletAddressOpts = z.object({
  unused: z.boolean().optional(),
  withBalance: z.number().optional(),
  authority: z.enum(['mint', 'melt']).optional(),
  token: TemplateRef.or(TokenSchema.default(NATIVE_TOKEN_UID)),
});

export const SetVarGetWalletBalanceOpts = z.object({
  token: TemplateRef.or(TokenSchema.default('00')),
});

export const SetVarOptions = z.union([SetVarGetWalletAddressOpts, SetVarGetWalletBalanceOpts]);

export const SetVarInstruction = z.object({
  type: z.literal('action/setvar'),
  name: z.string().regex(/[\d\w]+/),
  value: z.any().optional(),
  action: z.enum(['get_wallet_address', 'get_wallet_balance']),
  options: SetVarOptions.optional(),
});

export const TxTemplateInstruction = z.discriminatedUnion('type', [
  RawInputInstruction,
  UtxoSelectInstruction,
  AuthoritySelectInstruction,
  RawOutputInstruction,
  DataOutputInstruction,
  TokenOutputInstruction,
  AuthorityOutputInstruction,
  ShuffleInstruction,
  ChangeInstruction,
  CompleteTxInstruction,
  ConfigInstruction,
  SetVarInstruction,
]);
export type TxTemplateInstructionType = z.infer<typeof TxTemplateInstruction>;

export const TransactionTemplate = z.array(TxTemplateInstruction);
