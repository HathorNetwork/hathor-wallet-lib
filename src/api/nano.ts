/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createRequestInstance } from './axiosInstance';
import { NanoRequestError } from '../errors';

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
   *
   * @return {Promise}
   * @memberof ApiNanoContracts
   * @inner
   */
  async getNanoContractState(id: string, fields: string[]) {
    const data = { id, fields };
    const axios = await createRequestInstance();
    const response = await axios.get(`nano_contracts/state`, {params: data});
    const responseData = response.data;
    if (response.status === 200 && responseData.success) {
      return responseData;
    } else {
      throw new NanoRequestError('Error getting nano contract state.')
    }
  },

  /**
   * Call get nano contracts history API
   *
   * @param id Nano Contract ID
   *
   * @return {Promise}
   * @memberof ApiNanoContracts
   * @inner
   */
  async getNanoContractHistory(id: string) {
    const data = { id };
    const axios = await createRequestInstance();
    const response = await axios.get(`nano_contracts/history`, {params: data});
    const responseData = response.data;
    if (response.status === 200 && responseData.success) {
      return responseData;
    } else {
      throw new NanoRequestError('Error getting nano contract history.')
    }
  },
};

export default ncApi;