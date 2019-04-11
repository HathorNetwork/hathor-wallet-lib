'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _constants = require('./constants');

var _helpers = require('./helpers');

var _helpers2 = _interopRequireDefault(_helpers);

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
   * Checks if the wallet version is allowed to continue using the wallet or needs a reset
   *
   * @return {boolean}
   *
   * @memberof Version
   * @inner
   */
  checkWalletVersion: function checkWalletVersion() {
    var version = localStorage.getItem('wallet:version');
    if (version !== null && _helpers2.default.isVersionAllowed(version, _constants.FIRST_WALLET_COMPATIBLE_VERSION)) {
      return true;
    } else {
      return false;
    }
  }
};

exports.default = version;