/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Simple way to wait asynchronously before continuing the funcion. Does not block the JS thread.
 * @param {number} ms Amount of milliseconds to delay
 * @returns {Promise<unknown>}
 */
export async function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Generates a random positive integer between the maximum and minimum values,
 * with the default minimum equals zero
 * @param {number} max
 * @param {number} [min=0]
 * @returns {number} Random number
 */
export function getRandomInt(max, min = 0) {
  const _min = Math.ceil(min);
  const _max = Math.floor(max);
  return Math.floor(Math.random() * (_max - _min + 1)) + _min;
}
