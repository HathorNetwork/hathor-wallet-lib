/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { z } from 'zod';
import { IHistoryTx, OutputValueType } from '../types';
import { bigIntCoercibleSchema } from '../utils/bigint';

export const NanoContractArgumentByteTypes = z.enum([
  'bytes',
  'BlueprintId',
  'ContractId',
  'TokenUid',
  'TxOutputScript',
  'VertexId',
]);

/**
 * Single type names
 */
export const NanoContractArgumentSingleTypeNameSchema = z.enum([
  'bool',
  'int',
  'str',
  'Address',
  'Timestamp',
  'Amount',
  'VarInt',
  ...NanoContractArgumentByteTypes.options,
]);
export type NanoContractArgumentSingleTypeName = z.output<
  typeof NanoContractArgumentSingleTypeNameSchema
>;

/**
 * Container type names
 */
export const NanoContractArgumentContainerTypeNameSchema = z.enum([
  'Optional',
  'SignedData',
  'RawSignedData',
  'Tuple',
]);
export type NanoContractArgumentContainerType = z.output<
  typeof NanoContractArgumentContainerTypeNameSchema
>;

/**
 * Will match any `Container[subtype]` as long as Container is a valid ContainerType.
 * Also works with optional `InnerType?` as long as InnerType is a valid single type
 */
export const NanoContractArgumentFullContainerTypeNameSchema = z.string().refine(val => {
  if (val.endsWith('?')) {
    return NanoContractArgumentSingleTypeNameSchema.safeParse(val.slice(0, -1)).success;
  }
  const match = val.match(/^(.*?)\[(.*)\]/);
  if (match === null) return false;
  return NanoContractArgumentContainerTypeNameSchema.safeParse(match[1]).success;
}, 'Invalid Container type');

export const NanoContractArgumentTypeNameSchema = z.union([
  NanoContractArgumentSingleTypeNameSchema,
  NanoContractArgumentFullContainerTypeNameSchema,
]);
export type NanoContractArgumentTypeName = z.output<typeof NanoContractArgumentTypeNameSchema>;

/**
 * There are the types that can be received via api
 * when querying for a nano contract value.
 */
export const NanoContractArgumentApiInputSchema = z.union([
  z.string(),
  z.number(),
  z.bigint(),
  z.boolean(),
  z.null(),
]);
export type NanoContractArgumentApiInputType = z.output<typeof NanoContractArgumentApiInputSchema>;

/**
 * These are the possible `Single` types after parsing
 * We include Buffer since some types are decoded as Buffer (e.g. bytes, TokenUid, ContractId)
 */
export const NanoContractArgumentSingleSchema = z.union([
  NanoContractArgumentApiInputSchema,
  z.instanceof(Buffer),
]);
export type NanoContractArgumentSingleType = z.output<typeof NanoContractArgumentSingleSchema>;

/**
 * NanoContract SignedData method argument type
 */
export const NanoContractSignedDataSchema = z.object({
  type: NanoContractArgumentSingleTypeNameSchema,
  signature: z.instanceof(Buffer),
  value: NanoContractArgumentSingleSchema,
});
export type NanoContractSignedData = z.output<typeof NanoContractSignedDataSchema>;

/**
 * Intermediate schema for all possible Nano contract argument type
 * that do not include tuple/arrays/repetition
 */
const _NanoContractArgumentType1Schema = z.union([
  NanoContractArgumentSingleSchema,
  NanoContractSignedDataSchema,
]);

/**
 * Nano Contract method argument type as a native TS type
 */
export const NanoContractArgumentSchema = z.union([
  _NanoContractArgumentType1Schema,
  z.array(_NanoContractArgumentType1Schema),
]);
export type NanoContractArgumentType = z.output<typeof NanoContractArgumentSchema>;

export enum NanoContractVertexType {
  TRANSACTION = 'transaction',
  CREATE_TOKEN_TRANSACTION = 'createTokenTransaction',
}

export enum NanoContractActionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  GRANT_AUTHORITY = 'grant_authority',
  INVOKE_AUTHORITY = 'invoke_authority',
}

export enum NanoContractHeaderActionType {
  DEPOSIT = 1,
  WITHDRAWAL = 2,
  GRANT_AUTHORITY = 3,
  INVOKE_AUTHORITY = 4,
}

export const ActionTypeToActionHeaderType: Record<
  NanoContractActionType,
  NanoContractHeaderActionType
> = {
  [NanoContractActionType.DEPOSIT]: NanoContractHeaderActionType.DEPOSIT,
  [NanoContractActionType.WITHDRAWAL]: NanoContractHeaderActionType.WITHDRAWAL,
  [NanoContractActionType.GRANT_AUTHORITY]: NanoContractHeaderActionType.GRANT_AUTHORITY,
  [NanoContractActionType.INVOKE_AUTHORITY]: NanoContractHeaderActionType.INVOKE_AUTHORITY,
};

// The action in the header is serialized/deserialized in the class
// and it's used only to help calculate the token balance
// That's why it's simple and with less fields
export interface NanoContractActionHeader {
  type: NanoContractHeaderActionType;
  tokenIndex: number;
  amount: OutputValueType;
}

export const INanoContractActionBase = z.object({
  token: z.string(),
});

export const INanoContractActionTokenBase = INanoContractActionBase.extend({
  amount: bigIntCoercibleSchema,
});

export const INanoContractActionAuthorityBase = INanoContractActionBase.extend({
  authority: z.string(),
});

export const INanoContractActionWithdrawalSchema = INanoContractActionTokenBase.extend({
  type: z.literal('withdrawal'),
  address: z.string(),
}).passthrough();

export const INanoContractActionDepositSchema = INanoContractActionTokenBase.extend({
  type: z.literal('deposit'),
  address: z.string().optional(),
  changeAddress: z.string().optional(),
}).passthrough();

export const INanoContractActionGrantAuthoritySchema = INanoContractActionAuthorityBase.extend({
  type: z.literal('grant_authority'),
  address: z.string().optional(),
  authorityAddress: z.string().optional(),
}).passthrough();

export const INanoContractActionInvokeAuthoritySchema = INanoContractActionAuthorityBase.extend({
  type: z.literal('invoke_authority'),
  address: z.string(),
}).passthrough();

export const INanoContractActionSchema = z.discriminatedUnion('type', [
  INanoContractActionWithdrawalSchema,
  INanoContractActionDepositSchema,
  INanoContractActionGrantAuthoritySchema,
  INanoContractActionInvokeAuthoritySchema,
]);

export type NanoContractAction = z.output<typeof INanoContractActionSchema>;

// Arguments for blueprint methods
export interface NanoContractParsedArgument {
  // Argument name in the blueprint code
  name: string;
  // Argument type from hathor-core code
  type: string;
  // Parsed value
  parsed: NanoContractArgumentType;
}

export interface MethodArgInfo {
  // Name of the method argument
  name: string;
  // Type of the method argument
  type: string;
}

interface MethodInfo {
  // List of information about the method arguments
  args: MethodArgInfo[];
  // Method return type
  return_type?: string;
}

export interface NanoContractBlueprintInformationAPIResponse {
  // Blueprint ID
  id: string;
  // Blueprint name
  name: string;
  // Blueprint attributes object where the key is the attribute
  // name and the value is the attribute type
  attributes: Map<string, string>;
  // Public methods available
  public_methods: Map<string, MethodInfo>;
  // Private methods available
  private_methods: Map<string, MethodInfo>;
}

export interface NanoContractHistoryAPIResponse {
  // If the request succeeded
  success: boolean;
  // Amount of elements requested
  count: number;
  // After which hash was requested
  after?: string;
  // List of elements
  history: IHistoryTx[];
}

interface StateValueSuccess {
  // State value return
  value: NanoContractArgumentApiInputType;
}

interface StateValueError {
  // State value error
  errmsg: string;
}

export interface NanoContractStateAPIResponse {
  // If the request succeeded
  success: boolean;
  // ID of the nano contract
  nc_id: string;
  // Blueprint name
  blueprint_name: string;
  // Fields requested
  fields: Map<string, StateValueSuccess | StateValueError>;
  // Balances requested
  balances: Map<string, StateValueSuccess | StateValueError>;
  // Calls requested
  calls: Map<string, StateValueSuccess | StateValueError>;
}

export interface NanoContractStateAPIParameters {
  id: string;
  fields: string[];
  balances: string[];
  calls: string[];
  block_hash?: string;
  block_height?: number;
}

/**
 * Buffer Read Only (RO) Extract value.
 * For methods that read a value from a buffer without altering the input buffer (read-only).
 * The method should return the value (T) extracted and the number of bytes read.
 * This way the caller has full control of the buffer since the method does not alter the inputs.
 */
export type BufferROExtract<T = unknown> = {
  value: T;
  bytesRead: number;
};

export interface NanoContractBuilderCreateTokenOptions {
  // Token name
  name: string;
  // Token symbol
  symbol: string;
  // Token mint amount
  amount: OutputValueType;
  // Address to send the minted tokens
  mintAddress: string;
  // If the contract will pay for the token deposit fee
  contractPaysTokenDeposit: boolean;
  // Change address to send change values
  changeAddress: string | null;
  // If should create a mint authority output
  createMint: boolean;
  // The address to send the mint authority output to
  mintAuthorityAddress: string | null;
  // If should create a melt authority output
  createMelt: boolean;
  // The address to send the melt authority output to
  meltAuthorityAddress: string | null;
  // List of data strings to create data outputs
  data: string[] | null;
  // If this token is an NFT
  isCreateNFT: boolean;
}
