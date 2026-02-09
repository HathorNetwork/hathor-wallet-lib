/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get, has } from 'lodash';
import Address from '../models/address';
import Network from '../models/network';
import ncApi from '../api/nano';
import { NanoContractTransactionParseError } from '../errors';
import { MethodArgInfo, IParsedArgument } from './types';
import leb128 from '../utils/leb128';
import { getFieldParser, normalizeTypeString } from './ncTypes/parser';

class NanoContractTransactionParser {
  blueprintId: string;

  method: string;

  network: Network;

  address: Address;

  args: string | null;

  parsedArgs: IParsedArgument[] | null;

  constructor(
    blueprintId: string,
    method: string,
    address: string,
    network: Network,
    args: string | null
  ) {
    this.blueprintId = blueprintId;
    this.method = method;
    this.args = args;
    this.network = network;
    this.address = new Address(address, { network: this.network });
    this.parsedArgs = null;
  }

  /**
   * Parse the arguments in hex into a list of parsed arguments
   *
   * @memberof NanoContractTransactionParser
   * @inner
   */
  async parseArguments() {
    const parsedArgs: IParsedArgument[] = [];
    if (!this.args) {
      return;
    }

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

    // Number of arguments
    const numArgsReadResult = leb128.decodeUnsigned(argsBuffer);
    const numArgs = Number(numArgsReadResult.value);
    argsBuffer = numArgsReadResult.rest;

    if (numArgs !== methodArgs.length) {
      throw new NanoContractTransactionParseError(`Number of arguments do not match blueprint.`);
    }

    if (methodArgs.length === 0) {
      return;
    }

    for (const arg of methodArgs) {
      // Normalize type string (e.g., union[Address, ContractId] -> CallerId)
      const normalizedType = normalizeTypeString(arg.type);
      let parsed: IParsedArgument;
      let size: number;
      try {
        const field = getFieldParser(normalizedType, this.network);
        const result = field.fromBuffer(argsBuffer);
        parsed = { ...arg, type: normalizedType, value: field.toUser() };
        size = result.bytesRead;
      } catch (err: unknown) {
        throw new NanoContractTransactionParseError(
          `Failed to deserialize argument ${normalizedType}.`
        );
      }
      parsedArgs.push(parsed);
      argsBuffer = argsBuffer.subarray(size);
    }
    if (argsBuffer.length !== 0) {
      throw new Error(`${argsBuffer.length} bytes left after parsing all arguments.`);
    }

    this.parsedArgs = parsedArgs;
  }
}

export default NanoContractTransactionParser;
