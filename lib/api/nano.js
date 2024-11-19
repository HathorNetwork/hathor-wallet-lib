"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _axios = _interopRequireDefault(require("axios"));
var _axiosInstance = require("./axiosInstance");
var _errors = require("../errors");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Api calls for nano contracts
 *
 * @namespace ApiNanoContracts
 */

const ncApi = {
  /**
   * Call get nano contracts state API
   *
   * @param id Nano Contract ID
   * @param fields Array of fields to get state
   * @param balances Array of balances to get state
   * @param calls Array of private method calls to execute in the nano contract and get the result
   * @param block_hash Hash of the block to get the state of the nano
   * @param block_height Height of the block to get the state of the nano
   *
   * @memberof ApiNanoContracts
   * @inner
   */
  async getNanoContractState(id, fields, balances, calls, block_hash = null, block_height = null) {
    const data = {
      id,
      fields,
      balances,
      calls
    };
    if (block_hash) {
      data.block_hash = block_hash;
    }
    if (block_height) {
      data.block_height = block_height;
    }
    const axiosInstance = await (0, _axiosInstance.createRequestInstance)();
    try {
      const response = await axiosInstance.get(`nano_contract/state`, {
        params: data
      });
      const responseData = response.data;
      if (response.status === 200 && responseData.success) {
        return responseData;
      }
      throw new _errors.NanoRequestError('Error getting nano contract state.', null, response);
    } catch (error) {
      if (_axios.default.isAxiosError(error)) {
        const e = error;
        if (e.response && e.response.status === 404) {
          throw new _errors.NanoRequest404Error('Nano contract not found.', e, e.response);
        }
      }
      throw new _errors.NanoRequestError('Error getting nano contract state.', error);
    }
  },
  /**
   * Call get nano contracts history API
   *
   * @param id Nano Contract ID
   * @param count Quantity of elements to return
   * @param after Used for pagination in the results
   * @param before Used for pagination in the results
   *
   * @memberof ApiNanoContracts
   * @inner
   */
  async getNanoContractHistory(id, count = null, after = null, before = null) {
    const data = {
      id,
      count,
      after,
      before
    };
    const axiosInstance = await (0, _axiosInstance.createRequestInstance)();
    try {
      const response = await axiosInstance.get(`nano_contract/history`, {
        params: data
      });
      const responseData = response.data;
      if (response.status === 200 && responseData.success) {
        return responseData;
      }
      throw new _errors.NanoRequestError('Error getting nano contract history.', null, response);
    } catch (error) {
      if (_axios.default.isAxiosError(error)) {
        const e = error;
        if (e.response && e.response.status === 404) {
          throw new _errors.NanoRequest404Error('Nano contract not found.', e, e.response);
        }
      }
      throw new _errors.NanoRequestError('Error getting nano contract history.', error);
    }
  },
  /**
   * Call get blueprint information
   *
   * @param id Blueprint ID
   *
   * @return {Promise}
   * @memberof ApiNanoContracts
   * @inner
   */
  async getBlueprintInformation(id) {
    const data = {
      blueprint_id: id
    };
    const axiosInstance = await (0, _axiosInstance.createRequestInstance)();
    try {
      const response = await axiosInstance.get(`nano_contract/blueprint/info`, {
        params: data
      });
      const responseData = response.data;
      if (response.status === 200) {
        return responseData;
      }
      throw new _errors.NanoRequestError('Error getting blueprint information.', null, response);
    } catch (error) {
      if (_axios.default.isAxiosError(error)) {
        const e = error;
        if (e.response && e.response.status === 404) {
          throw new _errors.NanoRequest404Error('Blueprint not found.', e, e.response);
        }
      }
      throw new _errors.NanoRequestError('Error getting blueprint information.', error);
    }
  }
};
var _default = exports.default = ncApi;