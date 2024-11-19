"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * This class purpose is serialization/deserialization of signatures from a MultiSig participant
 * The structure of the serialized signature string is:
 * "<pubkey>|<index>:<signature>|<index>:<signature>|..."
 *
 * The `pubkey` is required so we can identify the original signer (and his position on the redeemScript)
 * The `<index>:<signature>` pair is the input index and the signature for that input.
 * The signature is formatted to DER and hex encoded.
 *
 * With this information we will be able to encode the signatures for all inputs on one string.
 * It also has all information needed to assemble the input data if you have enough participants' P2SHSignature serialized signatures.
 */
class P2SHSignature {
  constructor(pubkey, signatures) {
    _defineProperty(this, "pubkey", void 0);
    _defineProperty(this, "signatures", void 0);
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
  static deserialize(p2shSig) {
    const arr = p2shSig.split('|');
    const xpub = arr[0];
    const signatures = {};
    for (const sig of arr.slice(1)) {
      const [key, value] = sig.split(':');
      signatures[+key] = value;
    }
    return new P2SHSignature(xpub, signatures);
  }
}
var _default = exports.default = P2SHSignature;