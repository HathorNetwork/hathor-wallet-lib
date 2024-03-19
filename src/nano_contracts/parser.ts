/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Config from '../config';
import Address from '../models/address';
import Deserializer from './deserializer';
import ncApi from '../api/nano';
import { Address as bitcoreAddress, PublicKey as bitcorePublicKey } from 'bitcore-lib';
import { get } from 'lodash';
import { hexToBuffer, unpackToInt } from '../utils/buffer';
import { NanoContractTransactionParseError } from '../errors';
import { MethodArgInfo, NanoContractParsedArgument } from './types';


class NanoContractTransactionParser {
  blueprintId: string;
  method: string;
  publicKey: string;
  address: Address | null;
  args: string | null;
  parsedArgs: NanoContractParsedArgument[] | null;

  constructor(blueprintId: string, method: string, publicKey: string, args: string | null) {
    this.blueprintId = blueprintId;
    this.method = method;
    this.publicKey = publicKey;
    this.args = args;
    this.address = null;
    this.parsedArgs = null;
  }

  /**
   * Parse the nano public key to a base58 address
   *
   * @memberof NanoContractTransactionParser
   * @inner
   */
  parseAddress() {
    const network = Config.getNetwork();
    const pubkeyBuffer = hexToBuffer(this.publicKey);
    const base58 = new bitcoreAddress(bitcorePublicKey(pubkeyBuffer), network.bitcoreNetwork).toString()
    this.address = new Address(base58, { network });
  }

  /**
   * Parse the arguments in hex into a list of parsed arguments
   *
   * @memberof NanoContractTransactionParser
   * @inner
   */
  async parseArguments() {
    const parsedArgs: NanoContractParsedArgument[] = [];
    if (!this.args) {
      return;
    }

    const deserializer = new Deserializer();
    // Get the blueprint data from full node
    const blueprintInformation = await ncApi.getBlueprintInformation(this.blueprintId);
    const methodArgs = get(blueprintInformation, `public_methods.${this.method}.args`, []) as MethodArgInfo[];
    if (!methodArgs) {
      throw new NanoContractTransactionParseError('Failed to parse nano contract transaction. Method not found.');
    }

    let argsBuffer = Buffer.from(this.args, 'hex');
    let size: number;
    for (const arg of methodArgs) {
      [size, argsBuffer] = unpackToInt(2, false, argsBuffer);
      let parsed;
      try {
        parsed = deserializer.deserializeFromType(argsBuffer.slice(0, size), arg.type);
      } catch {
        throw new NanoContractTransactionParseError(`Failed to deserialize argument ${arg.type} .`);
      }
      parsedArgs.push({ ...arg, parsed });
      argsBuffer = argsBuffer.slice(size);
    }

    this.parsedArgs = parsedArgs;
  }
}

export default NanoContractTransactionParser;