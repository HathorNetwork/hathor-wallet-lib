/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage, IUtxo, IUtxoFilterOptions } from '../types';
import { orderBy } from 'lodash';


/**
 * Select utxos to fill the amount required.
 * This method should be faster since it stops the iteration once the target amount is reached.
 * Obs: Does not work with authority utxos.
 *
 * @param {IStorage} storage The wallet storage to select the utxos
 * @param {string} token The token uid to select the utxos
 * @param {number} amount The target amount of tokens required
 * @returns {Promise<{ utxos: IUtxo[], utxosAmount: number}>
 */
export async function fastUtxoSelection(
  storage: IStorage,
  token: string,
  amount: number,
): Promise<{ utxos: IUtxo[], amount: number}> {
  const utxos: IUtxo[] = [];
  let utxosAmount = 0;

  const options = {
    token,
    authorities: 0,
    target_amount: amount,
    only_available_utxos: true,
  };

  for await (const utxo of storage.selectUtxos(options)) {
    // We let selectUtxos to filter the utxos for us and stop after target amount is reached
    utxosAmount += utxo.value;
    utxos.push(utxo);
  }

  if (utxosAmount < amount) {
    // Not enough funds to fill the amount required.
    return {
      utxos: [],
      amount: 0,
    };
  }

  return { utxos, amount: utxosAmount };
}

/**
 * Select utxos to fill the amount required.
 * This method will select the smallest utxos that are bigger than the amount required.
 * Obs: this will iterate on all available utxos to choose the best suited selection.
 * Obs: Does not work with authority utxos.
 *
 * @param {IStorage} storage The wallet storage to select the utxos
 * @param {string} token The token uid to select the utxos
 * @param {number} amount The target amount of tokens required
 * @returns {Promise<{ utxos: IUtxo[], utxosAmount: number}>
 */
export async function bestUtxoSelection(
  storage: IStorage,
  token: string,
  amount: number,
): Promise<{ utxos: IUtxo[], amount: number}> {
  const utxos: IUtxo[] = [];
  let utxosAmount = 0;
  let selectedUtxo: IUtxo|null = null;

  const options: IUtxoFilterOptions = {
    token,
    authorities: 0,
    only_available_utxos: true,
    order_by_value: 'desc',
  };
  for await (const utxo of storage.selectUtxos(options)) {
    // storage ensures the utxo can be used
    if (utxo.value === amount) {
      return {
        utxos: [utxo],
        amount: amount,
      };
    }

    utxos.push(utxo);
    utxosAmount += utxo.value;

    if (utxo.value > amount) {
      // We want to select the smallest utxo that is bigger than the amount
      if (selectedUtxo === null || utxo.value < selectedUtxo.value) {
        selectedUtxo = utxo;
      }
    }

    if ((utxo.value < amount) && (selectedUtxo !== null)) {
      // We already have an utxo that is bigger than the amount required
      // with the lowest possible value.
      // We don't need to iterate more
      break;
    }
  }

  if (selectedUtxo !== null) {
    return {
      utxos: [selectedUtxo],
      amount: selectedUtxo.value,
    };
  } else if (utxosAmount < amount) {
    // We don't have enough funds
    return {
      utxos: [],
      amount: 0,
    };
  } else {
    // We have enough funds but we need to select more than one utxo
    // We will sort by value descending and get the utxos until the amount is fulfilled
    // This will ensure we use the smallest number of utxos and avoid hitting the maximum number of inputs
    const sortedUtxos = orderBy(utxos, ['value'], ['desc']);
    const selectedUtxos: IUtxo[] = [];
    let selectedAmount = 0;
    for (const utxo of sortedUtxos) {
      selectedUtxos.push(utxo);
      selectedAmount += utxo.value;
      if (selectedAmount >= amount) {
        break;
      }
    }
    return {
      utxos: selectedUtxos,
      amount: selectedAmount,
    };
  }
}
