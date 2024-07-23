/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage, IUtxo, IUtxoFilterOptions, UtxoSelectionAlgorithm } from '../types';

export enum UtxoSelection {
  FAST = 'fast',
  BEST = 'best',
}

/**
 * Get the algorithm function from the enum value.
 *
 * @param algorithm The algorithm to get
 * @returns {UtxoSelectionAlgorithm} The algorithm function
 */
export function getAlgorithmFromEnum(algorithm: UtxoSelection): UtxoSelectionAlgorithm {
  switch (algorithm) {
    case UtxoSelection.FAST:
      return fastUtxoSelection;
    case UtxoSelection.BEST:
      return bestUtxoSelection;
    default:
      throw new Error(`Unknown algorithm ${algorithm}`);
  }
}

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
  amount: bigint
): Promise<{ utxos: IUtxo[]; amount: bigint }> {
  const utxos: IUtxo[] = [];
  let utxosAmount = 0n;

  const options: IUtxoFilterOptions = {
    token,
    authorities: 0n,
    target_amount: amount,
    only_available_utxos: true,
    order_by_value: 'desc',
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
      amount: 0n,
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
  amount: bigint
): Promise<{ utxos: IUtxo[]; amount: bigint }> {
  const utxos: IUtxo[] = [];
  let utxosAmount = 0n;
  let selectedUtxo: IUtxo | null = null;

  const options: IUtxoFilterOptions = {
    token,
    authorities: 0n,
    only_available_utxos: true,
    order_by_value: 'desc',
  };
  for await (const utxo of storage.selectUtxos(options)) {
    // storage ensures the utxo can be used
    if (utxo.value === amount) {
      return {
        utxos: [utxo],
        amount,
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

    if (utxo.value < amount) {
      if (selectedUtxo !== null) {
        // We already have an utxo that is bigger than the amount required
        // with the lowest possible value.
        // We don't need to iterate more
        break;
      }

      if (utxosAmount >= amount) {
        // We have enough funds to fill the amount required
        // We don't need to iterate more
        break;
      }
    }
  }

  if (selectedUtxo !== null) {
    return {
      utxos: [selectedUtxo],
      amount: selectedUtxo.value,
    };
  }
  if (utxosAmount < amount) {
    // We don't have enough funds
    return {
      utxos: [],
      amount: 0n,
    };
  }
  // We need to ensure we use the smallest number of utxos and avoid hitting the maximum number of inputs
  // This can be done by ordering the utxos by value and selecting the highest values first until the amount is fulfilled
  // But since the store ensures the utxos are ordered by value descending
  // (Which is ensured by options.order_by_value = 'desc' on the selectUtxos method)
  // And we stop selecting when the amount in the utxos array is greater than or equal to the requested amount
  // We can just return the utxos selected during the loop above
  return {
    utxos,
    amount: utxosAmount,
  };
}
