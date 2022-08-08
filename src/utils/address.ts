/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Address from '../models/address';
import Network from '../models/network';

/**
 * Parse address and return the address type
 *
 * @param {string} address
 * @param {Network} network
 *
 * @returns {string} output type of the address (p2pkh or p2sh)
 */
export const getAddressType = (address: string, network: Network): string => {
  const addressObj = new Address(address, { network });
  return addressObj.getType();
}
