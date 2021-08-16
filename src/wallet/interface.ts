/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AddressInfoObject, GetBalanceObject, GetAddressesObject, GetHistoryObject, TxProposalUpdateResponseData, SendManyTxOptionsParam, SendTxOptionsParam } from './types';

interface HathorWalletInterface {
  start(): Promise<void | Object>; // The old facade resolves the promise with some server info
  stop(): void;
  getAllAddresses(): Promise<GetAddressesObject []>;
  getBalance(token: string | null): Promise<GetBalanceObject []>;
  getTxHistory(options: { token?: string }): Promise<GetHistoryObject []>;
  sendManyOutputsTransaction(outputs, options: SendManyTxOptionsParam): Promise<TxProposalUpdateResponseData>;
  sendTransaction(address, value, options: SendTxOptionsParam): Promise<TxProposalUpdateResponseData>;
  getAddressAtIndex(index: number): string;
  getCurrentAddress(): AddressInfoObject;
  getNextAddress(): AddressInfoObject;
}

export default HathorWalletInterface;