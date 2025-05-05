/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { FEE_PER_OUTPUT, NATIVE_TOKEN_UID } from '../constants';
import { IDataInput, IDataOutput, IDataOutputWithToken, IStorage } from '../types';
import { TokenInfoVersion } from './enum/token_info_version';
import Output from './output';

export class Fee {
  /**
   * Calculate the fee for a transaction.
   * @param inputs the inputs of the transaction
   * @param outputs the outputs of the transaction
   * @returns fee amount in HTR
   */
  static async calculate(
    storage: IStorage,
    inputs: IDataInput[],
    outputs: IDataOutputWithToken[]
  ): Promise<number> {
    const nonAuthorityInputs = Fee.getNonAuthorityUtxoByTokenUid(inputs);
    const nonAuthorityOutputs = Fee.getNonAuthorityUtxoByTokenUid(outputs);

    const tokens = new Set([...nonAuthorityInputs.keys(), ...nonAuthorityOutputs.keys()]);
    tokens.delete(NATIVE_TOKEN_UID);

    let fee = 0;

    for (const token of tokens) {
      // TODO-RAUL: checar se precisa fazer o get via api nesse momento
      const tokenData = await storage.getToken(token);

      if (!tokenData) {
        throw new Error(`Token ${token} not found`);
      }

      if (tokenData.version !== TokenInfoVersion.FEE) {
        continue;
      }
      // melt operation without outputs should be charged
      if (nonAuthorityInputs.has(token) && !nonAuthorityOutputs.has(token)) {
        fee += FEE_PER_OUTPUT;
      }

      fee += (nonAuthorityOutputs.get(token) || []).length * FEE_PER_OUTPUT;
    }

    return fee;
  }

  /**
   * Simplified fee calculation for a create token transaction with outputs related to the token being created.
   * This method should be used only for minting operations.
   * @param outputs the outputs of the transaction
   * @returns fee amount in HTR
   */
  static calculateTokenCreationTxFee(outputs: Output[]): number {
    return Fee.getNonAuthorityOutputs(outputs).length * FEE_PER_OUTPUT;
  }

  static getNonAuthorityOutputs(outputs: Output[]): Output[] {
    return outputs.filter(output => !output.isAuthority());
  }

  static isAuthorityInput(input: IDataInput | IDataOutput): boolean {
    return input.authorities === 0n;
  }

  static getNonAuthorityUtxoByTokenUid(
    utxos: (IDataInput | IDataOutputWithToken)[]
  ): Map<string, (IDataInput | IDataOutputWithToken)[]> {
    const map = new Map<string, (IDataInput | IDataOutputWithToken)[]>();

    for (const utxo of utxos) {
      if (!Fee.isAuthorityInput(utxo)) {
        const tokenUid = utxo.token;
        if (!map.has(tokenUid)) {
          map.set(tokenUid, []);
        }
        map.get(tokenUid)?.push(utxo);
      }
    }
    return map;
  }
}
