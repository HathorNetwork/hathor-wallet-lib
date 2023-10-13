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
  async getNanoContractState(id: string, fields: string[], balances: string[], calls: string[]) {
    const data = { id, fields, balances, calls };
    const axios = await createRequestInstance();
    const response = await axios.get(`nano_contract/state`, {params: data});
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
  async getNanoContractHistory(id: string, count: number | null = null, after: string | null = null) {
    const data = { id };
    if (count) {
      data['count'] = count;
    }

    if (after) {
      data['after'] = after;
    }
    const axios = await createRequestInstance();
    const response = await axios.get(`nano_contract/history`, {params: data});
    const responseData = response.data;
    if (response.status === 200 && responseData.success) {
      return responseData;
    } else {
      throw new NanoRequestError('Error getting nano contract history.')
    }
  },
};

export default ncApi;