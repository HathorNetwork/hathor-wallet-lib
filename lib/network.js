"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _config = _interopRequireDefault(require("./config"));
var _network = _interopRequireDefault(require("./models/network"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Extend the network to be able to set config when setNetwork is called on the singleton
 */
class ExtendedNetwork extends _network.default {
  /* Until we replace the network singleton with the new config singleton, we need to
   * maintain reverse compatibility as there are multiple use cases using the lib with
   * this network singleton
   *
   * Since config.setNetwork also calls networkInstance.setNetwork, we need the skipConfig
   * parameter to avoid a cyclic call
   *
   * TODO: Remove this when the network singleton is completely deprecated
   */
  setNetwork(name, skipConfig = false) {
    super.setNetwork(name);
    if (!skipConfig) {
      _config.default.setNetwork(name);
    }
  }
}

// Default network for the lib is testnet
const instance = new ExtendedNetwork('testnet');
var _default = exports.default = instance;