/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IHathorWallet, TokenInfo, Utxo } from '../wallet/types';
import { FEE_PER_OUTPUT, NATIVE_TOKEN_UID } from '../constants';
import { IDataInput, IDataOutputWithToken, ITokenData, IUtxo, TokenVersion } from '../types';
import Output from '../models/output';
import HathorWallet from '../new/wallet';

type TokenElement = IDataInput | Utxo | IUtxo | IDataInput | IDataOutputWithToken | Output;

export class Fee {
  /**
   * Calculate the fee for a transaction.
   *
   * https://github.com/HathorNetwork/rfcs/pull/94
   * According to the fee rfc, the fee is calculated based on the number of non-authority outputs.
   * If the transaction is a create token transaction, the fee is calculated based on the number of outputs related to the token being created.
   * If the transaction is a melt operation, the fee is calculated based on the number of outputs related to the token being melted. In this case, we should consider the melt operation without outputs as a non-authority output.
   *
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
    const nonAuthorityInputs = Fee.groupTokenElementsByTokenUid(inputs);
    const nonAuthorityOutputs = Fee.groupTokenElementsByTokenUid(outputs);

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
        fee += FEE_PER_OUTPUT;
      }

      fee += BigInt((nonAuthorityOutputs.get(token) || []).length) * FEE_PER_OUTPUT;
    }

    return fee;
  }

  /**
   * Fetch the tokens from the wallet and calculate the fee.
   * @param wallet the wallet to fetch the tokens from
   * @param inputs the inputs of the transaction
   * @param outputs the outputs of the transaction
   * @param tokens the tokens to calculate the fee for
   * @returns fee amount in HTR
   */
  static async fetchTokensAndCalculateFee(
    wallet: IHathorWallet | HathorWallet,
    inputs: (IDataInput | Utxo | IUtxo)[],
    outputs: (IDataOutputWithToken | Output)[],
    tokens: string[]
  ): Promise<{ fee: bigint; tokensMap: Map<string, ITokenData> }> {
    const tokensMap = new Map<string, ITokenData>();
    for (const uid of tokens) {
      let tokenData = await wallet.storage.getToken(uid);
      if (!tokenData || tokenData.version === undefined) {
        const { tokenInfo } = await wallet.getTokenDetails(uid);
        tokenData = {
          uid,
          name: tokenInfo.name,
          symbol: tokenInfo.symbol,
          version: tokenInfo.version,
        };
      }
      tokensMap.set(uid, tokenData);
    }

    return {
      fee: await Fee.calculate(inputs, outputs as IDataOutputWithToken[], tokensMap),
      tokensMap,
    };
  }

  /**
   * Simplified fee calculation for a create token transaction with outputs related to the token being created.
   * This method should be used only for minting operations.
   * @param outputs the outputs of the transaction
   * @returns fee amount in HTR
   * @memberof Fee
   * @static
   */
  static calculateTokenCreationTxFee(outputs: Omit<TokenElement, 'token'>[]): bigint {
    return BigInt(Fee.getNonAuthorityTokenElement(outputs).length) * FEE_PER_OUTPUT;
  }

  /**
   * Filter the outputs to get only those that are not authority outputs.
   * @param outputs outputs of the transaction
   * @returns an array of outputs that are not authority outputs
   * @memberof Fee
   * @static
   */
  static getNonAuthorityTokenElement(
    outputs: (TokenElement | Omit<TokenElement, 'token'>)[]
  ): (TokenElement | Omit<TokenElement, 'token'>)[] {
    return outputs.filter(output => !Fee.isAuthorityTokenElement(output as never)); // casting to never since we don't need the token property here.
  }

  /**
   * Check if the token element is an authority by checking the `isAuthority` method or the `authorities` property.
   * @param tokenElement token element to check
   * @returns true if the token element is an authority, false otherwise
   * @memberof Fee
   * @static
   */
  static isAuthorityTokenElement(tokenElement: TokenElement): boolean {
    if (tokenElement instanceof Output) {
      return tokenElement.isAuthority();
    }
    return tokenElement.authorities !== 0n;
  }

  /**
   * Check if the token element is a non-authority token element by checking the isAuthorityTokenElement method, then grouping them by token UID.
   * @param tokenElements an array of token elements to check
   * @returns a map where the keys are the token UIDs and the values are arrays of non-authority token elements for that token
   * @memberof Fee
   * @static
   */
  static groupTokenElementsByTokenUid(tokenElements: TokenElement[]): Map<string, TokenElement[]> {
    const map = new Map<string, TokenElement[]>();

    for (const tokenElement of tokenElements) {
      if (!Fee.isAuthorityTokenElement(tokenElement)) {
        let tokenUid: string = '';
        if ('token' in tokenElement) {
          tokenUid = tokenElement.token;
        }
        if ('tokenId' in tokenElement) {
          tokenUid = tokenElement.tokenId;
        }
        if (!tokenUid) {
          throw new Error('Token UID not found in token element');
        }
        if (!map.has(tokenUid)) {
          map.set(tokenUid, []);
        }
        map.get(tokenUid)?.push(tokenElement);
      }
    }
    return map;
  }
}
