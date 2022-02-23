/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { util } from 'bitcore-lib';


class P2SHSignature {
  pubkey: String;
  signatures: Record<number, String>;

  constructor(pubkey: String, signatures: Record<number, String>) {
    if (!pubkey) {
      throw Error('You must provide a pubkey.');
    }

    this.pubkey = pubkey;
    this.signatures = signatures;
  }

  /**
   * Serialize P2SH signatures
   *
   * @memberof P2SHSignature
   * @inner
   */
  serialize() {
    const arr = [this.pubkey];
    for (const [index, sig] of Object.entries(this.signatures)) {
      arr.push(`${index}:${sig}`);
    }
    return arr.join('|');
  }

  /**
   * Deserialize P2SH signatures
   *
   * @memberof P2SHSignature
   * @static
   */
  static deserialize(p2shSig: String) {
    const arr = p2shSig.split('|');
    const xpub = arr[0];
    const signatures: Record<number, String> = {};
    for (const sig of arr.slice(1)) {
      const parts = sig.split(':');
      signatures[+parts[0]] = parts[1];
    }
    return new P2SHSignature(xpub, signatures);
  }
}

export default P2SHSignature;
