/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { bigIntCoercibleSchema } from '../../../utils/bigint';

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
  address: z.string(), // Address in base58
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
 * Response schema for checking if addresses belong to the wallet.
 * Maps addresses to boolean values indicating ownership.
 */
export const checkAddressesMineResponseSchema = baseResponseSchema.extend({
  addresses: z.record(z.boolean()), // WalletAddressMap
});

/**
 * Schema for address information used in new address generation.
 */
export const addressInfoObjectSchema = z.object({
  address: z.string(),
  index: z.number(),
  addressPath: z.string(),
  info: z.string().optional(),
});

/**
 * Response schema for generating new addresses.
 */
export const newAddressesResponseSchema = baseResponseSchema.extend({
  addresses: z.array(addressInfoObjectSchema),
});

/**
 * Response schema for token details.
 * Contains information about a token's name, symbol, total supply, and authorities.
 */
export const tokenDetailsResponseSchema = baseResponseSchema.extend({
  details: z.object({
    tokenInfo: z.object({
      id: z.string(),
      name: z.string(),
      symbol: z.string(),
    }),
    totalSupply: bigIntCoercibleSchema,
    totalTransactions: z.number(),
    authorities: z.object({
      mint: z.boolean(),
      melt: z.boolean(),
    }),
  }),
});

/**
 * Schema for token information.
 */
export const tokenInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbol: z.string(),
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
  addressPath: z.string(),
});

/**
 * Schema for transaction proposal outputs.
 * Represents the outputs that will be created in a transaction.
 */
export const txProposalOutputsSchema = z.object({
  address: z.string(),
  value: bigIntCoercibleSchema,
  token: z.string(),
  timelock: z.number().nullable(),
});

/**
 * Response schema for creating a transaction proposal.
 * Contains the proposal ID and the transaction details.
 */
export const txProposalCreateResponseSchema = baseResponseSchema.extend({
  txProposalId: z.string(),
  inputs: z.array(txProposalInputsSchema),
  outputs: z.array(txProposalOutputsSchema),
  tokens: z.array(z.string()),
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
 */
export const fullNodeVersionDataSchema = z.object({
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
});

/**
 * Schema for full node transaction inputs.
 * Represents the inputs of a transaction as seen by the full node.
 */
export const fullNodeInputSchema = z.object({
  value: bigIntCoercibleSchema,
  token_data: z.number(),
  script: z.string(),
  decoded: z.object({
    type: z.string(),
    address: z.string(),
    timelock: z.number().nullable().optional(),
    value: bigIntCoercibleSchema,
    token_data: z.number(),
  }),
  tx_id: z.string(),
  index: z.number(),
  token: z.string().nullable().optional(),
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
    type: z.string(),
    address: z.string(),
    timelock: z.number().nullable().optional(),
    value: bigIntCoercibleSchema,
    token_data: z.number(),
  }),
  address: z.string(),
  token: z.string(),
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
  status: z.string(),
  network: z.string(),
  serverUrl: z.string(),
  serverInfo: z.object({
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
  }),
});

/**
 * Response schema for token list.
 * Contains an array of token information.
 */
export const tokensResponseSchema = baseResponseSchema.extend({
  tokens: z.array(
    z.object({
      uid: z.string(),
      name: z.string(),
      symbol: z.string(),
      amount: bigIntCoercibleSchema,
    })
  ),
});

/**
 * Response schema for transaction history.
 * Contains an array of transaction information.
 */
export const historyResponseSchema = baseResponseSchema.extend({
  history: z.array(
    z.object({
      txId: z.string(),
      timestamp: z.number(),
      balance: z.record(z.string(), bigIntCoercibleSchema),
      tokens: z.array(
        z.object({
          uid: z.string(),
          name: z.string(),
          symbol: z.string(),
          amount: bigIntCoercibleSchema,
        })
      ),
    })
  ),
});

/**
 * Response schema for transaction outputs.
 * Contains an array of unspent transaction outputs.
 */
export const txOutputResponseSchema = baseResponseSchema.extend({
  outputs: z.array(
    z.object({
      txId: z.string(),
      index: z.number(),
      address: z.string(),
      value: bigIntCoercibleSchema,
      token: z.string(),
      timelock: z.number().nullable(),
    })
  ),
});

/**
 * Response schema for authentication token.
 * Contains the authentication token and its expiration.
 */
export const authTokenResponseSchema = baseResponseSchema.extend({
  token: z.string(),
  expiresAt: z.number(),
});

/**
 * Response schema for transaction by ID.
 * Contains detailed information about a specific transaction.
 */
export const txByIdResponseSchema = baseResponseSchema.extend({
  tx: z.object({
    txId: z.string(),
    timestamp: z.number(),
    version: z.number(),
    weight: z.number(),
    parents: z.array(z.string()),
    inputs: z.array(
      z.object({
        txId: z.string(),
        index: z.number(),
        address: z.string(),
        value: bigIntCoercibleSchema,
        token: z.string(),
        timelock: z.number().nullable(),
      })
    ),
    outputs: z.array(
      z.object({
        index: z.number(),
        address: z.string(),
        value: bigIntCoercibleSchema,
        token: z.string(),
        timelock: z.number().nullable(),
      })
    ),
    tokens: z.array(
      z.object({
        uid: z.string(),
        name: z.string(),
        symbol: z.string(),
        amount: bigIntCoercibleSchema,
      })
    ),
  }),
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
};
