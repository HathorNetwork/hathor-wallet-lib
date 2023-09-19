/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Output from '../models/output';
import P2PKH from '../models/p2pkh';
import Input from '../models/input';
import Address from '../models/address';
import NanoContract from '../nano_contracts/nano_contract';
import { hexToBuffer } from '../utils/buffer';
import { NANO_CONTRACTS_VERSION } from '../constants';
import Serializer from './serializer';


class BetTransactionBuilder {
  blueprint: string = '3cb032600bdf7db784800e4ea911b10676fa2f67591f82bb62628c234e771595';

  /**
   * Create bet NC transaction
   *
   * @param {Buffer} pubkey Public key to sign the nano contract transaction
   * @param {Buffer} oracleScript Script of the oracle
   * @param {string} tokenUid Token of the bet
   * @param {number} dateLastOffer Timestamp of the last offer
   *
   * @return {NanoContract}
   * @memberof BetTransactionBuilder
   * @inner
   */
  createBetNC(pubkey: Buffer, oracleScript: Buffer, tokenUid: string, dateLastOffer: number): NanoContract {
    const serializer = new Serializer();
    const serializedOracle = serializer.fromBytes(oracleScript);
    const serializedTokenUid = serializer.fromBytes(hexToBuffer(tokenUid));
    const serializedTimestamp = serializer.fromInt(dateLastOffer);

    const args = [serializedOracle, serializedTokenUid, serializedTimestamp];
    const nc = new NanoContract([], [], this.blueprint, 'initialize', args, pubkey, null);
    return nc;
  }

  /**
   * Create transaction to make a deposit
   *
   * @param {string} nano_contract_id Nano contract id
   * @param {Buffer} pubkey Public key to sign the nano contract transaction
   * @param {Input[]} inputs List of inputs for this deposit transaction
   * @param {Output[]} outputs List of outputs for this deposit transaction
   * @param {Address} address Address to receive the tokens in case of success of the bet
   * @param {string} result Result to bet
   *
   * @return {NanoContract}
   * @memberof BetTransactionBuilder
   * @inner
   */
  deposit(nano_contract_id: string, pubkey: Buffer, inputs: Input[], outputs: Output[], address: Address, result: string): NanoContract {
    const serializer = new Serializer();
    const serializedAddress = serializer.fromBytes(address.decode());
    const serializedResult = serializer.fromString(result);

    const args = [serializedAddress, serializedResult];
    const nc = new NanoContract(inputs, outputs, nano_contract_id, 'bet', args, pubkey, null);
    return nc;
  }

  /**
   * Create transaction to make a withdrawal
   *
   * @param {string} nano_contract_id Nano contract id
   * @param {Buffer} pubkey Public key to sign the nano contract transaction
   * @param {Output[]} outputs List of outputs for this deposit transaction
   *
   * @return {NanoContract}
   * @memberof BetTransactionBuilder
   * @inner
   */
  withdraw(nano_contract_id: string, pubkey: Buffer, outputs: Output[]): NanoContract {
    // Amount and address to withdraw will be in the outputs
    const nc = new NanoContract([], outputs, nano_contract_id, 'withdraw', [], pubkey, null);
    return nc;
  }

  /**
   * Create transaction to set the bet result
   *
   * @param {string} nano_contract_id Nano contract id
   * @param {Buffer} pubkey Public key to sign the nano contract transaction
   * @param {Buffer} inputData Data of the input for the oracle
   * @param {string} result Result of the bet
   *
   * @return {NanoContract}
   * @memberof BetTransactionBuilder
   * @inner
   */
  setResult(nano_contract_id: string, pubkey: Buffer, inputData: Buffer, result: string): NanoContract {
    const serializer = new Serializer();
    // XXX Why the full node has decode to ASCII and not UTF-8?
    // XXX if we decide to go with ASCII the result must be serialized
    // differently than the others strings
    const serializedResult = serializer.fromSigned(inputData, result, 'string');

    const args = [serializedResult];
    const nc = new NanoContract([], [], nano_contract_id, 'set_result', args, pubkey, null);
    return nc;
  }

}

export default BetTransactionBuilder;