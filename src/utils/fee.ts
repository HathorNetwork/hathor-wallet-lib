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

/**
 * Check if the utxo is an authority utxo by checking the `isAuthority` method or ther `authorities` property.
 * @param utxo utxo to check
 * @returns true if the utxo is an authority utxo, false otherwise
 */
export function isAuthorityUtxo(utxo: TokenUtxo): boolean {
  if (utxo instanceof Output) {
    return utxo.isAuthority();
  }
  return utxo.authorities !== 0n;
}

/**
 * Filter the outputs to get only those that are not authority outputs.
 * @param outputs outputs of the transaction
 * @returns an array of outputs that are not authority outputs
 */
export function getNonAuthorityOutputs(
  outputs: (TokenUtxo | Omit<TokenUtxo, 'token'>)[]
): (TokenUtxo | Omit<TokenUtxo, 'token'>)[] {
  return outputs.filter(output => !isAuthorityUtxo(output as never)); // casting to never since we don't need the token property here.
}

/**
 * Check if the utxo is a non-authority utxo by checking the isAuthorityUtxo method, then grouping them by token UID.
 * @param utxos an array of utxos to check
 * @returns a map where the keys are the token UIDs and the values are arrays of non-authority utxos for that token
 */
export function getNonAuthorityUtxoByTokenUid(utxos: TokenUtxo[]): Map<string, TokenUtxo[]> {
  const map = new Map<string, TokenUtxo[]>();

  for (const utxo of utxos) {
    if (!isAuthorityUtxo(utxo)) {
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

/**
 * Calculate the fee for a transaction.
 * @param inputs the inputs of the transaction
 * @param outputs the outputs of the transaction
 * @param tokens the map with token data
 * @returns fee amount in HTR
 */
export async function calculateFee(
  inputs: (IDataInput | Utxo | IUtxo)[],
  outputs: (IDataOutputWithToken | Output)[],
  tokens: Map<string, ITokenData | TokenInfo>
): Promise<number> {
  const nonAuthorityInputs = getNonAuthorityUtxoByTokenUid(inputs);
  const nonAuthorityOutputs = getNonAuthorityUtxoByTokenUid(outputs);

  const tokensSet = new Set([...nonAuthorityInputs.keys(), ...nonAuthorityOutputs.keys()]);
  tokensSet.delete(NATIVE_TOKEN_UID);

  let fee = 0;

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
export function calculateTokenCreationTxFee(outputs: Omit<TokenUtxo, 'token'>[]): number {
  return getNonAuthorityOutputs(outputs).length * FEE_PER_OUTPUT;
}
