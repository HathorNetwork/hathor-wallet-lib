/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { getBalanceObject, getAddressesObject, getHistoryObject } from './types';

interface HathorWalletInterface {
  start(): Promise<void | Object>; // The old facade resolves the promise with some server info
  stop(): void;
  getAllAddresses(): Promise<getAddressesObject []>;
  getBalance(token: string | null): Promise<getBalanceObject []>;
  getTxHistory(options: { token?: string }): Promise<getHistoryObject []>;
  //sendManyOutputsTransaction(outputs, options: { inputs?: <Object []>, changeAddress?: string }): Promise<null>;
  //sendTransaction(address, value, options: { token?: string, changeAddress?: string }): Promise<null>;
  getAddressAtIndex(index: number): string;
}

export default HathorWalletInterface;