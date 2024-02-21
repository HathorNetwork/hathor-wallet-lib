/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createRequestInstance } from './axiosInstance';
import { NanoRequest404Error, NanoRequestError } from '../errors';

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
      if (response.status === 404) {
        throw new NanoRequest404Error('Nano contract not found.');
      } else {
        throw new NanoRequestError('Error getting nano contract state.')
      }
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
      if (response.status === 404) {
        throw new NanoRequest404Error('Nano contract not found.');
      } else {
        throw new NanoRequestError('Error getting nano contract history.')
      }
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
  async getBlueprintInformation(id: string) {
    const data = { blueprint_id: id };
    const axios = await createRequestInstance();
    const response = await axios.get(`nano_contract/blueprint`, { params: data });
    const responseData = response.data;
    if (response.status === 200) {
      return responseData;
    } else {
      if (response.status === 404) {
        throw new NanoRequest404Error('Blueprint not found.');
      } else {
        throw new NanoRequestError('Error getting blueprint information.')
      }
    }
  },
};

export default ncApi;