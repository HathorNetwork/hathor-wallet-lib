/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { TokenInfo, Utxo } from '../wallet/types';
import { FEE_PER_OUTPUT, NATIVE_TOKEN_UID } from '../constants';
import { IDataInput, IDataOutputWithToken, ITokenData, IUtxo, TokenVersion } from '../types';
import Output from '../models/output';

type TokenUtxo = IDataInput | Utxo | IUtxo | IDataInput | IDataOutputWithToken | Output;

export class Fee {
  /**
   * Calculate the fee for a transaction.
   * @param inputs the inputs of the transaction
   * @param outputs the outputs of the transaction
   * @param tokens the map with token data
   * @returns fee amount in HTR
   */
  static async calculate(
    inputs: (IDataInput | Utxo | IUtxo)[],
    outputs: (IDataOutputWithToken | Output)[],
    tokens: Map<string, ITokenData | TokenInfo>
  ): Promise<bigint> {
    const nonAuthorityInputs = Fee.getNonAuthorityUtxoByTokenUid(inputs);
    const nonAuthorityOutputs = Fee.getNonAuthorityUtxoByTokenUid(outputs);

    const tokensSet = new Set([...nonAuthorityInputs.keys(), ...nonAuthorityOutputs.keys()]);
    tokensSet.delete(NATIVE_TOKEN_UID);

    let fee = 0n;

    for (const token of tokensSet) {
      const tokenData = tokens.get(token);
      if (!tokenData) {
        throw new Error(`Token ${token} not found in tokens.`);
      }

      if (tokenData.version !== TokenVersion.FEE) {
        continue;
      }
      // melt operation without outputs should be charged
      if (nonAuthorityInputs.has(token) && !nonAuthorityOutputs.has(token)) {
        fee += BigInt(FEE_PER_OUTPUT);
      }

      fee += BigInt((nonAuthorityOutputs.get(token) || []).length) * BigInt(FEE_PER_OUTPUT);
    }

    return fee;
  }

  /**
   * Simplified fee calculation for a create token transaction with outputs related to the token being created.
   * This method should be used only for minting operations.
   * @param outputs the outputs of the transaction
   * @returns fee amount in HTR
   * @memberof Fee
   * @static
   */
  static calculateTokenCreationTxFee(outputs: Omit<TokenUtxo, 'token'>[]): bigint {
    return BigInt(Fee.getNonAuthorityOutputs(outputs).length * FEE_PER_OUTPUT);
  }

  /**
   * Filter the outputs to get only those that are not authority outputs.
   * @param outputs outputs of the transaction
   * @returns an array of outputs that are not authority outputs
   * @memberof Fee
   * @static
   */
  static getNonAuthorityOutputs(
    outputs: (TokenUtxo | Omit<TokenUtxo, 'token'>)[]
  ): (TokenUtxo | Omit<TokenUtxo, 'token'>)[] {
    return outputs.filter(output => !Fee.isAuthorityUtxo(output as never)); // casting to never since we don't need the token property here.
  }

  /**
   * Check if the utxo is an authority utxo by checking the `isAuthority` method or ther `authorities` property.
   * @param utxo utxo to check
   * @returns true if the utxo is an authority utxo, false otherwise
   * @memberof Fee
   * @static
   */
  static isAuthorityUtxo(utxo: TokenUtxo): boolean {
    if (utxo instanceof Output) {
      return utxo.isAuthority();
    }
    return utxo.authorities !== 0n;
  }

  /**
   * Check if the utxo is a non-authority utxo by checking the isAuthorityUtxo method, then grouping them by token UID.
   * @param utxos an array of utxos to check
   * @returns a map where the keys are the token UIDs and the values are arrays of non-authority utxos for that token
   * @memberof Fee
   * @static
   */
  static getNonAuthorityUtxoByTokenUid(utxos: TokenUtxo[]): Map<string, TokenUtxo[]> {
    const map = new Map<string, TokenUtxo[]>();

    for (const utxo of utxos) {
      if (!Fee.isAuthorityUtxo(utxo)) {
        let tokenUid: string = '';
        if ('token' in utxo) {
          tokenUid = utxo.token;
        }
        if ('tokenId' in utxo) {
          tokenUid = utxo.tokenId;
        }
        if (!tokenUid) {
          throw new Error('Token UID not found in utxo');
        }
        if (!map.has(tokenUid)) {
          map.set(tokenUid, []);
        }
        map.get(tokenUid)?.push(utxo);
      }
    }
    return map;
  }
}
