/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPublicKey } from 'bitcore-lib';

export function getPublicKeyFromXPub(xpub: string, index?: number): Buffer {
  const xpubObj = new HDPublicKey(xpub);

  if (index === undefined) {
    return xpubObj.publicKey;
  }
  return xpubObj.deriveChild(index).publicKey.toBuffer();
}