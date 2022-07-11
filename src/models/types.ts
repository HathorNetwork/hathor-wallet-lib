/**
 * An output object enriched by the wallet's history methods
 */
export type HistoryTransactionOutput = {
  value: number,
  token_data: number,
  script: string,
  decoded: {
    type?: string,
    address?: string,
    timelock?: number | null,
  },
  token: string,
  spent_by?: string | null,
  selected_as_input?: boolean,
};

/**
 * An input object enriched by the wallet's history methods
 */
export type HistoryTransactionInput = {
  value: number,
  token_data: number,
  script: string,
  decoded: {
    type?: string,
    address?: string,
    timelock?: number | null,
  },
  token: string,
  tx_id: string,
  index: number,
};

/**
 * A populated object from the wallet's history methods,
 * containing decoded outputs and enriched input objects.
 */
export type HistoryTransaction = {
  tx_id: string,
  version: number,
  weight: number,
  timestamp: number,
  is_voided: boolean,
  nonce: number,
  inputs: HistoryTransactionInput[],
  outputs: HistoryTransactionOutput[],
  parents: string[],
  token_name?: string,
  token_symbol?: string,
  tokens: string[],
}
