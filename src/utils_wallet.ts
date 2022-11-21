/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IMultisigData, IStorageWalletData, IStorage } from './types';
import { getPublicKeyFromXPub } from './utils_crypto';


export function generateAccessDataFromXPub(xpubkey: string, multisigData?: IMultisigData): IStorageWalletData {
  const accessData: IStorageWalletData = { xpubkey };

  if (multisigData) {
    const pubkey = getPublicKeyFromXPub(xpubkey);
    accessData.multisigData = {
      ...multisigData,
      pubkey: pubkey.toString('hex'),
    }
  }
  return accessData;
}