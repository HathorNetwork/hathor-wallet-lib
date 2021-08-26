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

    let utxosToUse: Utxo[] = [];
    let filledAmount = 0;
    for (const utxo of utxos) {
      if (utxo.value >= totalAmount) {
        utxosToUse = [utxo];
        filledAmount = utxo.value;
      } else {
        if (filledAmount >= totalAmount) {
          break
        }
        filledAmount += utxo.value;
        utxosToUse.push(utxo);
     }
    }
    if (filledAmount < totalAmount) {
      throw new UtxoError('Don\'t have enough utxos to fill total amount.');
    }

    return {
      utxos: utxosToUse,
      changeAmount: filledAmount - totalAmount,
    }
  },
}

export default transaction;
