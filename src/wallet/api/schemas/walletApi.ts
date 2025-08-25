/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { NATIVE_TOKEN_UID } from '../../../constants';
import { txIdSchema } from '../../../schemas';
import { bigIntCoercibleSchema } from '../../../utils/bigint';

/**
 * Schema for validating Hathor addresses.
 * Addresses are base58 encoded and must be 34-35 characters long.
 * They can only contain characters from the base58 alphabet.
 */
export const AddressSchema = z
  .string()
  .regex(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{34,35}$/);

/**
 * Schema for validating BIP44 derivation paths.
 * Must start with 'm' followed by zero or more segments.
 * Each segment starts with '/' followed by numbers and may end with a single quote (').
 * Example: m/44'/280'/0'/0/0
 */
export const AddressPathSchema = z
  .string()
  .regex(/^m(\/\d+'?)*$/, 'Invalid BIP44 derivation path format');

/**
 * Base response schema that all API responses extend from.
 * Contains a success flag indicating if the operation was successful.
 */
const baseResponseSchema = z.object({
  success: z.boolean(),
});

/**
 * Schema for individual address information.
 * Represents a single address in the wallet with its derivation index and transaction count.
 */
export const getAddressesObjectSchema = z.object({
  address: AddressSchema, // Address in base58
  index: z.number(), // derivation index of the address
  transactions: z.number(), // quantity of transactions
});

/**
 * Response schema for getting all addresses in the wallet.
 */
export const addressesResponseSchema = baseResponseSchema.extend({
  addresses: z.array(getAddressesObjectSchema),
});

/**
 * Response schema for getting address info in the wallet.
 */
export const getAddressDetailsObjectSchema = z.object({
  address: AddressSchema,
  index: z.number(),
  transactions: z.number(),
  seqnum: z.number(),
});

/**
 * Response schema for getting address details in the wallet.
 */
export const addressDetailsResponseSchema = baseResponseSchema.extend({
  data: getAddressDetailsObjectSchema,
});

/**
 * Response schema for checking if addresses belong to the wallet.
 * Maps addresses to boolean values indicating ownership.
 */
export const checkAddressesMineResponseSchema = baseResponseSchema.extend({
  addresses: z.record(AddressSchema, z.boolean()), // WalletAddressMap with validated address keys
});

/**
 * Schema for address information used in new address generation.
 */
export const addressInfoObjectSchema = z
  .object({
    address: AddressSchema,
    index: z.number(),
    addressPath: AddressPathSchema,
    info: z.string().optional(),
  })
  .strict();

/**
 * Response schema for generating new addresses.
 */
export const newAddressesResponseSchema = baseResponseSchema.extend({
  addresses: z.array(addressInfoObjectSchema),
});

/**
 * TokenId schema
 */
export const tokenIdSchema = z.union([txIdSchema, z.literal(NATIVE_TOKEN_UID)]);

/**
 * Schema for token information.
 */
export const tokenInfoSchema = z.object({
  id: tokenIdSchema,
  name: z.string(),
  symbol: z.string(),
});

/**
 * Response schema for token details.
 * Contains information about a token's name, symbol, total supply, and authorities.
 */
export const tokenDetailsResponseSchema = baseResponseSchema.extend({
  details: z.object({
    tokenInfo: tokenInfoSchema,
    totalSupply: bigIntCoercibleSchema,
    totalTransactions: z.number(),
    authorities: z.object({
      mint: z.boolean(),
      melt: z.boolean(),
    }),
  }),
});

/**
 * Schema for token balance information.
 * Represents both unlocked and locked balances for a token.
 */
export const balanceSchema = z.object({
  unlocked: bigIntCoercibleSchema,
  locked: bigIntCoercibleSchema,
});

/**
 * Schema for token authority balances.
 * Represents mint and melt authority balances in both unlocked and locked states.
 */
export const authorityBalanceSchema = z.object({
  unlocked: z.object({
    mint: z.boolean(),
    melt: z.boolean(),
  }),
  locked: z.object({
    mint: z.boolean(),
    melt: z.boolean(),
  }),
});

/**
 * Schema for balance object.
 * Contains token info, balance, authorities, and transaction count.
 */
export const getBalanceObjectSchema = z.object({
  token: tokenInfoSchema,
  balance: balanceSchema,
  tokenAuthorities: authorityBalanceSchema,
  transactions: z.number(),
  lockExpires: z.number().nullable(),
});

/**
 * Response schema for token balances.
 * Contains an array of balance objects for each token.
 */
export const balanceResponseSchema = baseResponseSchema.extend({
  balances: z.array(getBalanceObjectSchema),
});

/**
 * Schema for transaction proposal inputs.
 * Represents the inputs that will be used in a transaction.
 */
export const txProposalInputsSchema = z.object({
  txId: z.string(),
  index: z.number(),
  addressPath: AddressPathSchema,
});

/**
 * Schema for transaction proposal outputs.
 * Represents the outputs that will be created in a transaction.
 */
export const txProposalOutputsSchema = z.object({
  address: AddressSchema,
  value: bigIntCoercibleSchema,
  token: tokenIdSchema,
  timelock: z.number().nullable(),
});

/**
 * Response schema for creating a transaction proposal.
 * Contains the proposal ID and the transaction details.
 */
export const txProposalCreateResponseSchema = baseResponseSchema.extend({
  txProposalId: z.string(),
  inputs: z.array(txProposalInputsSchema),
});

/**
 * Response schema for updating a transaction proposal.
 * Contains the proposal ID and the transaction hex.
 */
export const txProposalUpdateResponseSchema = baseResponseSchema.extend({
  txProposalId: z.string(),
  txHex: z.string(),
});

/**
 * Schema for full node version data.
 * Contains network parameters and configuration values.
 * Uses passthrough() to allow additional fields in the response without breaking validation,
 * as the full node may add new fields in future versions without changing the API version.
 */
export const fullNodeVersionDataSchema = z
  .object({
    timestamp: z.number(),
    version: z.string(),
    network: z.string(),
    minWeight: z.number(),
    minTxWeight: z.number(),
    minTxWeightCoefficient: z.number(),
    minTxWeightK: z.number(),
    tokenDepositPercentage: z.number(),
    rewardSpendMinBlocks: z.number(),
    maxNumberInputs: z.number(),
    maxNumberOutputs: z.number(),
    decimalPlaces: z.number().nullable().optional(),
    genesisBlockHash: z.string().nullable().optional(),
    genesisTx1Hash: z.string().nullable().optional(),
    genesisTx2Hash: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * Schema for full node transaction inputs.
 * Represents the inputs of a transaction as seen by the full node.
 */
export const fullNodeInputSchema = z.object({
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: z.object({
    type: z.string().nullable().optional(),
    address: AddressSchema.nullable().optional(),
    timelock: z.number().nullable().optional(),
    value: bigIntCoercibleSchema.nullable().optional(),
    token_data: z.number().nullable().optional(),
  }),
  tx_id: txIdSchema,
  index: z.number(),
  token: tokenIdSchema.nullable().optional(),
  spent_by: z.string().nullable().optional(),
});

/**
 * Schema for full node transaction outputs.
 * Represents the outputs of a transaction as seen by the full node.
 */
export const fullNodeOutputSchema = z.object({
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: z.object({
    type: z.string().nullable().optional(),
    address: AddressSchema.nullable().optional(),
    timelock: z.number().nullable().optional(),
    value: bigIntCoercibleSchema.nullable().optional(),
    token_data: z.number().nullable().optional(),
  }),
  address: AddressSchema.nullable().optional(),
  token: tokenIdSchema.nullable().optional(),
  authorities: bigIntCoercibleSchema,
  timelock: z.number().nullable(),
});

/**
 * Schema for full node token information.
 * Represents token details as seen by the full node.
 */
export const fullNodeTokenSchema = z.object({
  uid: z.string(),
  name: z.string(),
  symbol: z.string(),
  amount: bigIntCoercibleSchema,
});

/**
 * Schema for full node transaction data.
 * Contains all information about a transaction as seen by the full node.
 */
export const fullNodeTxSchema = z.object({
  hash: z.string(),
  nonce: z.string(),
  timestamp: z.number(),
  version: z.number(),
  weight: z.number(),
  parents: z.array(z.string()),
  inputs: z.array(fullNodeInputSchema),
  outputs: z.array(fullNodeOutputSchema),
  tokens: z.array(fullNodeTokenSchema),
  token_name: z.string().nullable(),
  token_symbol: z.string().nullable(),
  raw: z.string(),
});

/**
 * Schema for full node transaction metadata.
 * Contains additional information about a transaction's status and relationships.
 */
export const fullNodeMetaSchema = z.object({
  hash: z.string(),
  received_by: z.array(z.string()),
  children: z.array(z.string()),
  conflict_with: z.array(z.string()),
  first_block: z.string().nullable(),
  height: z.number(),
  voided_by: z.array(z.string()),
  spent_outputs: z.array(z.tuple([z.number(), z.array(z.string())])),
  received_timestamp: z.number().nullable(),
  is_voided: z.boolean(),
  verification_status: z.string(),
  twins: z.array(z.string()),
  accumulated_weight: z.number(),
  score: z.number(),
});

/**
 * Response schema for full node transaction data.
 * Contains the transaction details, metadata, and optional message.
 */
export const fullNodeTxResponseSchema = baseResponseSchema.extend({
  tx: fullNodeTxSchema,
  meta: fullNodeMetaSchema,
  message: z.string().optional(),
  spent_outputs: z.record(z.string()).optional(),
});

/**
 * Response schema for transaction confirmation data.
 * Contains information about the transaction's confirmation status and weight.
 */
export const fullNodeTxConfirmationDataResponseSchema = baseResponseSchema.extend({
  accumulated_weight: z.number(),
  accumulated_bigger: z.boolean(),
  stop_value: z.number(),
  confirmation_level: z.number(),
});

/**
 * Response schema for wallet status.
 * Contains information about the wallet's current state.
 */
export const walletStatusResponseSchema = baseResponseSchema.extend({
  status: z.object({
    walletId: z.string(),
    xpubkey: z.string(),
    status: z.string(),
    maxGap: z.number(),
    createdAt: z.number(),
    readyAt: z.number().nullable(),
  }),
  error: z.string().optional(),
});

/**
 * Response schema for token list.
 * Contains an array of token information.
 */
export const tokensResponseSchema = baseResponseSchema.extend({
  tokens: z.array(z.string()),
});

/**
 * Response schema for transaction history.
 * Contains an array of transaction information.
 */
export const historyResponseSchema = baseResponseSchema.extend({
  history: z.array(
    z.object({
      txId: z.string(),
      balance: bigIntCoercibleSchema,
      timestamp: z.number(),
      voided: z.number().transform(val => val === 1),
      version: z.number(),
    })
  ),
});

/**
 * Response schema for transaction outputs.
 * Contains an array of unspent transaction outputs.
 */
export const txOutputResponseSchema = baseResponseSchema.extend({
  txOutputs: z.array(
    z.object({
      txId: z.string(),
      index: z.number(),
      tokenId: z.string(),
      address: AddressSchema,
      value: bigIntCoercibleSchema,
      authorities: bigIntCoercibleSchema,
      timelock: z.number().nullable(),
      heightlock: z.number().nullable(),
      locked: z.boolean(),
      addressPath: AddressPathSchema,
    })
  ),
});

/**
 * Response schema for authentication token.
 * Contains the authentication token.
 */
export const authTokenResponseSchema = baseResponseSchema.extend({
  token: z
    .string()
    .regex(/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+$/, 'Invalid JWT token format'),
});

/**
 * Schema for transaction by ID response.
 * Contains detailed information about a specific transaction.
 */
export const txByIdResponseSchema = baseResponseSchema.extend({
  txTokens: z.array(
    z.object({
      txId: z.string(),
      timestamp: z.number(),
      version: z.number(),
      voided: z.boolean(),
      height: z.number().nullable().optional(),
      weight: z.number(),
      balance: bigIntCoercibleSchema,
      tokenId: z.string(),
      tokenName: z.string(),
      tokenSymbol: z.string(),
    })
  ),
});

/**
 * Schema for transaction input.
 * Represents a transaction input with its decoded data.
 */
export const txInputSchema = z.object({
  tx_id: txIdSchema,
  index: z.number(),
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: z.object({
    type: z.string(),
    address: AddressSchema,
    timelock: z.number().nullable().optional(),
    value: bigIntCoercibleSchema,
    token_data: z.number(),
  }),
});

/**
 * Schema for transaction output.
 * Represents a transaction output with its decoded data.
 */
export const txOutputSchema = z.object({
  index: z.number(),
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: z.object({
    type: z.string().nullable().optional(),
    address: AddressSchema.optional(),
    timelock: z.number().nullable().optional(),
    value: bigIntCoercibleSchema,
    token_data: z.number().optional(),
  }),
});

/**
 * Schema for Buffer-like scripts
 */
const bufferScriptSchema = z.object({
  type: z.literal('Buffer'),
  data: z.array(z.number()),
});

/**
 * Schema for websocket transaction input.
 */
const wsTxInputSchema = z.object({
  tx_id: txIdSchema,
  index: z.number(),
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: bufferScriptSchema,
  token: tokenIdSchema,
  decoded: z.object({
    type: z.string(),
    address: AddressSchema,
    timelock: z.number().nullable().optional(),
  }),
});

/**
 * Schema for websocket transaction output.
 */
const wsTxOutputSchema = z.object({
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: bufferScriptSchema,
  decodedScript: z.any().nullable().optional(),
  token: tokenIdSchema,
  locked: z.boolean(),
  index: z.number(),
  decoded: z.object({
    type: z.string().nullable().optional(),
    address: AddressSchema.optional(),
    timelock: z.number().nullable().optional(),
  }),
});

/**
 * Schema for websocket transaction events.
 * Represents the structure of transactions received via websocket.
 */
export const wsTransactionSchema = z.object({
  tx_id: txIdSchema,
  nonce: z.number(),
  timestamp: z.number(),
  version: z.number(),
  voided: z.boolean(),
  weight: z.number(),
  parents: z.array(z.string()),
  inputs: z.array(wsTxInputSchema),
  outputs: z.array(wsTxOutputSchema),
  height: z.number().nullable().optional(),
  token_name: z.string().nullable(),
  token_symbol: z.string().nullable(),
  signal_bits: z.number(),
});

/**
 * Collection of all wallet API schemas.
 * Used for type validation and documentation of the wallet API.
 */
export const walletApiSchemas = {
  addressesResponse: addressesResponseSchema,
  checkAddressesMineResponse: checkAddressesMineResponseSchema,
  newAddressesResponse: newAddressesResponseSchema,
  tokenDetailsResponse: tokenDetailsResponseSchema,
  balanceResponse: balanceResponseSchema,
  txProposalCreateResponse: txProposalCreateResponseSchema,
  txProposalUpdateResponse: txProposalUpdateResponseSchema,
  fullNodeVersionData: fullNodeVersionDataSchema,
  fullNodeTxResponse: fullNodeTxResponseSchema,
  fullNodeTxConfirmationDataResponse: fullNodeTxConfirmationDataResponseSchema,
  walletStatusResponse: walletStatusResponseSchema,
  tokensResponse: tokensResponseSchema,
  historyResponse: historyResponseSchema,
  txOutputResponse: txOutputResponseSchema,
  authTokenResponse: authTokenResponseSchema,
  txByIdResponse: txByIdResponseSchema,
  wsTransaction: wsTransactionSchema,
};
