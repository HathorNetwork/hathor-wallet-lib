/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An output object enriched by the wallet's history methods
 */
export type HistoryTransactionOutput = {
  value: bigint;
  token_data: number;
  script: string;
  decoded: {
    type?: string;
    address?: string;
    timelock?: number | null;
  };
  token: string;
  spent_by?: string | null;
  selected_as_input?: boolean;
};

/**
 * An input object enriched by the wallet's history methods
 */
export type HistoryTransactionInput = {
  value: number;
  token_data: number;
  script: string;
  decoded: {
    type?: string;
    address?: string;
    timelock?: number | null;
  };
  token: string;
  tx_id: string;
  index: number;
};

/**
 * A populated object from the wallet's history methods,
 * containing decoded outputs and enriched input objects.
 */
export type HistoryTransaction = {
  tx_id: string;
  signalBits: number;
  version: number;
  weight: number;
  timestamp: number;
  is_voided: boolean;
  nonce: number;
  inputs: HistoryTransactionInput[];
  outputs: HistoryTransactionOutput[];
  parents: string[];
  token_name?: string;
  token_symbol?: string;
  tokens: string[];
};

/**
 * A balance object for a token on a transaction or across transactions
 * containing token and authority balances.
 */
export interface Balance {
  balance: TokenBalance;
  authority: AuthorityBalance;
}

export interface TokenBalance {
  unlocked: bigint;
  locked: bigint;
}

export interface AuthorityBalance {
  unlocked: Authority;
  locked: Authority;
}

export interface Authority {
  mint: number;
  melt: number;
}

/**
 * A backend-mediated Atomic Swap proposal, containing backend metadata such as id, version and history
 */
export interface AtomicSwapProposal {
  proposalId: string;
  partialTx: string;
  signatures: string | null;
  timestamp: string;
  version: number;
  history: { partialTx: string; timestamp: string }[];
}
