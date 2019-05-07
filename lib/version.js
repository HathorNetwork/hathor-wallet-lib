'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _version = require('./api/version');

var _version2 = _interopRequireDefault(_version);

var _transaction = require('./transaction');

var _transaction2 = _interopRequireDefault(_transaction);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Methods to validate version
 *
 * @namespace Version
 */

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var version = {
  /**
   * Checks if the API version of the server the wallet is connected is valid for this wallet version
   *
   * @return {Promise} Promise that resolves after getting the version and updating Redux
   *
   * @memberof Version
   * @inner
   */
  checkApiVersion: function checkApiVersion() {
    var promise = new Promise(function (resolve, reject) {
      _version2.default.getVersion(function (data) {
        // Update transaction weight constants
        _transaction2.default.updateTransactionWeightConstants(data.min_tx_weight, data.min_tx_weight_coefficient, data.min_tx_weight_k);
        resolve(data);
      }, function (error) {
        reject();
      });
    });
    return promise;
  }
};

exports.default = version;