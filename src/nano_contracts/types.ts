/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { z } from 'zod';
import { IHistoryTx, OutputValueType, TokenVersion } from '../types';
import { bigIntCoercibleSchema } from '../utils/bigint';
import { NCFieldBase } from './fields';

export interface IArgumentField {
  name: string;
  type: string;
  field: NCFieldBase;
}

export interface IParsedArgument {
  name: string;
  type: string;
  value: unknown;
}

export enum NanoContractVertexType {
  TRANSACTION = 'transaction',
  CREATE_TOKEN_TRANSACTION = 'createTokenTransaction',
}

export enum NanoContractActionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  GRANT_AUTHORITY = 'grant_authority',
  ACQUIRE_AUTHORITY = 'acquire_authority',
}

export enum NanoContractHeaderActionType {
  DEPOSIT = 1,
  WITHDRAWAL = 2,
  GRANT_AUTHORITY = 3,
  ACQUIRE_AUTHORITY = 4,
}

export const ActionTypeToActionHeaderType: Record<
  NanoContractActionType,
  NanoContractHeaderActionType
> = {
  [NanoContractActionType.DEPOSIT]: NanoContractHeaderActionType.DEPOSIT,
  [NanoContractActionType.WITHDRAWAL]: NanoContractHeaderActionType.WITHDRAWAL,
  [NanoContractActionType.GRANT_AUTHORITY]: NanoContractHeaderActionType.GRANT_AUTHORITY,
  [NanoContractActionType.ACQUIRE_AUTHORITY]: NanoContractHeaderActionType.ACQUIRE_AUTHORITY,
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

export const INanoContractActionAcquireAuthoritySchema = INanoContractActionAuthorityBase.extend({
  type: z.literal('acquire_authority'),
  address: z.string(),
}).passthrough();

export const INanoContractActionSchema = z.discriminatedUnion('type', [
  INanoContractActionWithdrawalSchema,
  INanoContractActionDepositSchema,
  INanoContractActionGrantAuthoritySchema,
  INanoContractActionAcquireAuthoritySchema,
]);

export type NanoContractAction = z.output<typeof INanoContractActionSchema>;

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
  // View methods available
  view_methods: Map<string, MethodInfo>;
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
  value: unknown;
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
  // Blueprint id
  blueprint_id: string;
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
  // Version of the token being created (DEPOSIT or FEE)
  tokenVersion: TokenVersion;
}

/**
 * Data for creating a nano contract transaction
 */
export type CreateNanoTxData = {
  blueprintId?: string | null;
  ncId?: string | null;
  actions?: NanoContractAction[];
  args?: unknown[];
};

export type CreateNanoTxOptions = {
  pinCode?: string | null;
  /** Optional maximum fee in NATIVE_TOKEN_UID. If not set, fee is auto-calculated without limit. */
  maxFee?: OutputValueType;
};

export interface NanoContractBlueprintSourceCodeAPIResponse {
  // Blueprint ID
  blueprint_id: string;
  // Blueprint source code
  source_code: string;
}

export interface BlueprintListItem {
  // Blueprint ID
  id: string;
  // Blueprint name
  name: string;
}

export interface NanoContractBlueprintListAPIResponse {
  // If the request succeeded
  success: boolean;
  // List of blueprints
  blueprints: BlueprintListItem[];
  // Has more blueprints to fetch
  has_more: boolean;
}

export interface NanoContractCreationListItem {
  // Nano contract ID
  nc_id: string;
  // Blueprint ID
  blueprint_id: string;
  // Blueprint name
  blueprint_name: string;
  // Transaction ID that created the nano contract
  tx_id: string;
  // Timestamp of creation
  timestamp: number;
}

export interface NanoContractCreationListAPIResponse {
  // If the request succeeded
  success: boolean;
  // List of nano contract creations
  contracts: NanoContractCreationListItem[];
  // Has more contracts to fetch
  has_more: boolean;
}

export interface NanoContractLogsAPIResponse {
  // If the request succeeded
  success: boolean;
  // Nano contract ID
  nc_id: string;
  // Execution metadata
  nc_execution: string | null;
  // Logs organized by block ID (hex string keys)
  logs: Record<string, unknown>;
}
