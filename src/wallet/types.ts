/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export interface getAddressesObject {
  address: string; // Address in base58
  index: number; // derivation index of the address
  transactions: number; // quantity of transactions
}

export interface getBalanceObject {
  token: TokenInfo; // Information about the token
  balance: Balance; // Balance information
  tokenAuthorities: AuthoritiesBalance; // Authorities mint/melt availability
  transactions: number; // quantity of transactions
  lockExpires: number | null; // When next lock expires, if has a timelock
}

export interface TokenInfo {
  id: string; // Token id
  name: string; // Token name
  symbol: string; // Token symbol
}

export interface Balance {
  unlocked: number; // Available amount
  locked: number; // Locked amount
}

export interface AuthoritiesBalance {
  unlocked: Authority; // unlocked mint/melt
  locked: Authority; // locked mint/melt
}

export interface Authority {
  mint: boolean; // if has mint authority
  melt: boolean; // if has melt authority
}

export interface getHistoryObject {
  txId: string; // Transaction ID
  balance: number; // Balance of this tx in this wallet (can be negative)
  timestamp: number; // Transaction timestamp
}