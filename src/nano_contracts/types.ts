/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { IHistoryTx, OutputValueType } from '../types';
import { z } from 'zod';

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
export const NanoContractArgumentSingleSchema = z.union([NanoContractArgumentApiInputSchema, z.instanceof(Buffer)]);
export type NanoContractArgumentSingleType = z.output<typeof NanoContractArgumentSingleSchema>;

/**
 * A `SignedData` value is the tuple `[ContractId, Value]`
 * which is parsed as `[Buffer, NanoContractArgumentSingleType]`
 */
export type NanoContractSignedDataInnerType = [Buffer, NanoContractArgumentSingleType];

/**
 * NanoContract SignedData method argument type
 */
export const NanoContractSignedDataSchema = z.object({
  type: z.string(),
  signature: z.instanceof(Buffer),
  value: z.tuple([z.instanceof(Buffer), NanoContractArgumentSingleSchema]),
});
export type NanoContractSignedData = z.output<typeof NanoContractSignedDataSchema>;

/**
 * NanoContract RawSignedData method argument type
 */
export const NanoContractRawSignedDataSchema = z.object({
  type: z.string(),
  signature: z.instanceof(Buffer),
  value: NanoContractArgumentSingleSchema,
});
export type NanoContractRawSignedData = z.output<typeof NanoContractRawSignedDataSchema>;

/**
 * Intermediate schema for all possible Nano contract argument type
 * that do not include tuple/arrays/repetition
 */
const _NanoContractArgumentType1Schema = z.union([NanoContractArgumentSingleSchema, NanoContractSignedDataSchema, NanoContractRawSignedDataSchema])

/**
 * Nano Contract method argument type as a native TS type
 */
export const NanoContractArgumentSchema = z.union([_NanoContractArgumentType1Schema, z.array(_NanoContractArgumentType1Schema)]);
export type NanoContractArgumentType = z.output<typeof NanoContractArgumentSchema>;

/**
 * Container type names
 */
export type NanoContractArgumentContainerType =
  | 'Optional'
  | 'SignedData'
  | 'RawSignedData'
  | 'Tuple';

export enum NanoContractActionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
}

export enum NanoContractHeaderActionType {
  DEPOSIT = 1,
  WITHDRAWAL = 2,
}

export const ActionTypeToActionHeaderType: Record<
  NanoContractActionType,
  NanoContractHeaderActionType
> = {
  [NanoContractActionType.DEPOSIT]: NanoContractHeaderActionType.DEPOSIT,
  [NanoContractActionType.WITHDRAWAL]: NanoContractHeaderActionType.WITHDRAWAL,
};

// The action in the header is serialized/deserialized in the class
// and it's used only to help calculate the token balance
// That's why it's simple and with less fields
export interface NanoContractActionHeader {
  type: NanoContractHeaderActionType;
  tokenIndex: number;
  amount: OutputValueType;
}

export interface NanoContractAction {
  type: NanoContractActionType;
  token: string;
  amount: OutputValueType;
  // For withdrawal is required, which is address to send the output
  // For deposit is optional, and it's the address to filter the utxos
  address: string | null;
  // For deposit action is the change address used by the change output after selecting the utxos
  changeAddress: string | null;
}

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

export type BufferROExtract<T = any> = {
  value: T;
  bytesRead: number;
};
