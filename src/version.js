/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import versionApi from './api/version';
import helpers from './helpers';
import transaction from './transaction';

/**
 * Methods to validate version
 *
 * @namespace Version
 */

const version = {
  /**
   * Checks if the API version of the server the wallet is connected is valid for this wallet version
   *
   * @return {Promise} Promise that resolves after getting the version and updating Redux
   *
   * @memberof Version
   * @inner
   */
  checkApiVersion() {
    const promise = new Promise((resolve, reject) => {
      versionApi.getVersion((data) => {
        // Update transaction weight constants
        transaction.updateTransactionWeightConstants(data.min_tx_weight, data.min_tx_weight_coefficient, data.min_tx_weight_k);
        resolve(data);
      }, (error) => {
        reject();
      });
    });
    return promise
  },
}

export default version;
