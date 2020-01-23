/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import versionApi from './api/version';
import transaction from './transaction';
import tokens from './tokens';
import wallet from './wallet';

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
        tokens.updateDepositPercentage(data.token_deposit_percentage);
        transaction.updateMaxInputsConstant(data.max_number_inputs);
        transaction.updateMaxOutputsConstant(data.max_number_outputs);
        wallet.updateRewardLockConstant(data.reward_spend_min_blocks);
        resolve(data);
      }).catch((error) => {
        reject(error);
      });
    });
    return promise
  },
}

export default version;
