/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { Utxo } from '../wallet/types';
import { UtxoError } from '../errors';

const transaction = {
  /**
   * Select best utxos with the algorithm described below. This method expects the utxos to be sorted by greatest value
   *
   * 1. If we have a single utxo capable of handle the full amount requested,
   * we return the utxo with smaller amount among the ones that have an amount bigger than the requested
   * 2. Otherwise we reverse sort the utxos by amount and select the utxos in order until the full amount is fulfilled.
   *
   * @memberof transaction
   * @inner
   */
  selectUtxos(utxos: Utxo[], totalAmount: number): {utxos: Utxo[], changeAmount: number} {
    if (totalAmount <= 0) {
      throw new UtxoError('Total amount must be a positive integer.');
    }

    if (utxos.length === 0) {
      throw new UtxoError('Don\'t have enough utxos to fill total amount.');
    }

    if (utxos[0].value < totalAmount) {
      // We can't fill the total amount with a single utxo
      // so we start pushing utxos to an array until we fill the total amount
      const utxosToUse: any[] = [];
      let filledAmount = 0;
      for (const utxo of utxos) {
        utxosToUse.push(utxo);
        filledAmount += utxo.value;

        if (filledAmount >= totalAmount) {
          break;
        }
      }

      if (filledAmount < totalAmount) {
        // It means that all utxos combined are not enough to fill the requested amount
        throw new UtxoError('Don\'t have enough utxos to fill total amount.');
      }

      return {
        utxos: utxosToUse,
        changeAmount: filledAmount - totalAmount
      };
    } else {
      // We can fill the total amount with a single utxo
      // we will find the smallest utxo that can fill the total amount
      let lastUtxo: Utxo | null = null;

      for (const utxo of utxos) {
        if (utxo.value === totalAmount) {
          return {
            utxos: [utxo],
            changeAmount: 0
          };
        }

        if (utxo.value < totalAmount) {
          // The last one is the smallest single utxo that can fill the amount
          // it's safe to use lastUtxo because it will never be null
          // this is inside the else that checked that at least one utxo fills the total amount
          return {
            utxos: [lastUtxo!],
            changeAmount: lastUtxo!.value - totalAmount
          };
        }

        lastUtxo = utxo;
      }

      // If I got here, it means that all utxos in the array are bigger than the expected amount
      // then I must use the last utxo, which has the smallest value
      const smallestUtxo = utxos[utxos.length - 1];
      return {
        utxos: [smallestUtxo],
        changeAmount: smallestUtxo.value - totalAmount
      };
    }
  },
}

export default transaction;
