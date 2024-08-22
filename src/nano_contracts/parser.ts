/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get, has } from 'lodash';
import Address from '../models/address';
import Network from '../models/network';
import Deserializer from './deserializer';
import ncApi from '../api/nano';
import { unpackToInt } from '../utils/buffer';
import { getAddressFromPubkey } from '../utils/address';
import { NanoContractTransactionParseError } from '../errors';
import { MethodArgInfo, NanoContractParsedArgument } from './types';

class NanoContractTransactionParser {
  blueprintId: string;

  method: string;

  publicKey: string;

  network: Network;

  address: Address | null;

  args: string | null;

  parsedArgs: NanoContractParsedArgument[] | null;

  constructor(
    blueprintId: string,
    method: string,
    publicKey: string,
    network: Network,
    args: string | null
  ) {
    this.blueprintId = blueprintId;
    this.method = method;
    this.publicKey = publicKey;
    this.args = args;
    this.network = network;
    this.address = null;
    this.parsedArgs = null;
  }

  /**
   * Parse the nano public key to an address object
   *
   * @memberof NanoContractTransactionParser
   * @inner
   */
  parseAddress() {
    this.address = getAddressFromPubkey(this.publicKey, this.network);
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

    const deserializer = new Deserializer(this.network);
    // Get the blueprint data from full node
    const blueprintInformation = await ncApi.getBlueprintInformation(this.blueprintId);
    if (!has(blueprintInformation, `public_methods.${this.method}`)) {
      // If this.method is not in the blueprint information public methods, then there's an error
      throw new NanoContractTransactionParseError(
        'Failed to parse nano contract transaction. Method not found.'
      );
    }

    const methodArgs = get(
      blueprintInformation,
      `public_methods.${this.method}.args`,
      []
    ) as MethodArgInfo[];
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
