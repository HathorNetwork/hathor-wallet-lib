"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _explorerServiceAxios = _interopRequireDefault(require("./explorerServiceAxios"));
var _helpers = _interopRequireDefault(require("../utils/helpers"));
var _constants = require("../constants");
var _errors = require("../errors");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const metadataApi = {
  /**
   * Returns the Dag Metadata for a given transaction id
   * @param id Tx Identifier
   * @param network Network name
   * @param options
   * @param [options.retries] Number of retries that the method will attempt before rejecting
   * @param [options.retryInterval] Interval, in miliseconds, between each attempt
   */
  async getDagMetadata(id, network, options = {}) {
    const newOptions = {
      retries: _constants.METADATA_RETRY_LIMIT,
      retryInterval: _constants.DOWNLOAD_METADATA_RETRY_INTERVAL,
      ...options
    };
    const {
      retryInterval
    } = newOptions;
    let {
      retries
    } = newOptions;
    let metaData = null;
    while (retries >= 0) {
      const client = await (0, _explorerServiceAxios.default)(network);
      try {
        const response = await client.get('metadata/dag', {
          params: {
            id
          }
        });
        if (response.data) {
          metaData = response.data;
          break;
        }
        // Error downloading metadata
        // throw Error and the catch will handle it
        throw new _errors.GetDagMetadataApiError('Invalid metadata API response.');
      } catch (e) {
        if (e.response?.status === 404) {
          // 404 is not flagged as an error by our current Axios configuration
          // No need to do anything, the metadata for this token was not found
          // There is no error here, we just return null
          metaData = null;
          break;
        }
        if (!(e instanceof Error)) {
          // This is for the typescript compiler, since it doesn't know that e is an Error
          throw new _errors.GetDagMetadataApiError('Unknown error.');
        }
        // Error downloading metadata
        if (retries === 0) {
          // If we have no more retries left, then we propagate the error
          throw new _errors.GetDagMetadataApiError(e.message);
        } else {
          // If we still have retry attempts, then we wait a few seconds and retry
          await _helpers.default.sleep(retryInterval);
          retries--;
        }
      }
    }
    return metaData;
  }
};
var _default = exports.default = metadataApi;