/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export enum NanoContractActionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
}

export interface NanoContractActionDeposit {
  type: NanoContractActionType.DEPOSIT;
  token: string;
  data: NanoContractDepositData;
}

export interface NanoContractActionWithdrawal {
  type: NanoContractActionType.WITHDRAWAL;
  token: string;
  data: NanoContractWithdrawalData;
}

export type NanoContractAction = NanoContractActionDeposit | NanoContractActionWithdrawal;

export interface NanoContractDepositData {
  amount: number;
  address: string | null;
  changeAddress: string | null;
}

export interface NanoContractWithdrawalData {
  amount: number;
  address: string;
}

export interface NanoContractArg {
  type: string;
  value: any;
}
