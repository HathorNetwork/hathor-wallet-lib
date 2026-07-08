/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { util } from 'bitcore-lib';
import {
  OP_GREATERTHAN_TIMESTAMP,
  OP_DUP,
  OP_HASH160,
  OP_EQUALVERIFY,
  OP_CHECKSIG_WEBAUTHN,
} from '../opcodes';
import { intToBytes } from '../utils/buffer';
import helpers from '../utils/helpers';
import Address from './address';
import { IHistoryOutputDecoded } from '../types';

type optionsType = {
  timelock?: number | null | undefined;
};

/**
 * Pay-to-WebAuthn-pubkey-hash (PoC). Same shape as P2PKH but the committed pubkey is a
 * P-256 passkey and the final opcode verifies a WebAuthn assertion envelope.
 *
 * output script: [<timelock> OP_GREATERTHAN_TIMESTAMP]? OP_DUP OP_HASH160 <h160>
 *                OP_EQUALVERIFY OP_CHECKSIG_WEBAUTHN
 */
class P2WEBAUTHN {
  address: Address;

  timelock: number | null;

  constructor(address: Address, options: optionsType = {}) {
    const newOptions = Object.assign({ timelock: null }, options);
    if (!address) {
      throw Error('You must provide an address.');
    }
    this.address = address;
    this.timelock = newOptions.timelock;
  }

  // eslint-disable-next-line class-methods-use-this -- This method returns a hardcoded constant
  getType(): 'p2webauthn' {
    return 'p2webauthn';
  }

  createScript(): Buffer {
    const arr: Buffer[] = [];
    const addressBytes = this.address.decode();
    const addressHash = addressBytes.slice(1, -4);
    if (this.timelock) {
      const timelockBytes = intToBytes(this.timelock, 4);
      helpers.pushDataToStack(arr, timelockBytes);
      arr.push(OP_GREATERTHAN_TIMESTAMP);
    }
    arr.push(OP_DUP);
    arr.push(OP_HASH160);
    arr.push(intToBytes(addressHash.length, 1));
    arr.push(addressHash);
    arr.push(OP_EQUALVERIFY);
    arr.push(OP_CHECKSIG_WEBAUTHN);
    return util.buffer.concat(arr);
  }

  toData(): IHistoryOutputDecoded {
    return {
      type: this.getType().toUpperCase(),
      address: this.address.base58,
      timelock: this.timelock,
    };
  }

  /**
   * Identify a script as P2WEBAUTHN (P2PKH shape ending in OP_CHECKSIG_WEBAUTHN).
   */
  static identify(buf: Buffer): boolean {
    const op_greaterthan_timestamp = OP_GREATERTHAN_TIMESTAMP.readUInt8(0);
    const op_dup = OP_DUP.readUInt8(0);
    const op_hash160 = OP_HASH160.readUInt8(0);
    const op_equalverify = OP_EQUALVERIFY.readUInt8(0);
    const op_checksig_webauthn = OP_CHECKSIG_WEBAUTHN.readUInt8(0);
    if (buf.length !== 31 && buf.length !== 25) {
      return false;
    }
    let ptr = 0;
    if (buf.length === 31) {
      if (buf.readUInt8(ptr++) !== 4) {
        return false;
      }
      ptr += 4;
      if (buf.readUInt8(ptr++) !== op_greaterthan_timestamp) {
        return false;
      }
    }
    if (buf.readUInt8(ptr++) !== op_dup || buf.readUInt8(ptr++) !== op_hash160) {
      return false;
    }
    if (buf.readUInt8(ptr++) !== 20) {
      return false;
    }
    ptr += 20;
    if (buf.readUInt8(ptr++) !== op_equalverify || buf.readUInt8(ptr++) !== op_checksig_webauthn) {
      return false;
    }
    return true;
  }
}

export default P2WEBAUTHN;
