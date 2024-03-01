/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createRequestInstance } from './axiosInstance';
import { NanoRequest404Error, NanoRequestError } from '../errors';
import { AxiosError } from 'axios';

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
   *
   * @memberof ApiNanoContracts
   * @inner
   */
  async getNanoContractState(id: string, fields: string[], balances: string[], calls: string[]) {
    const data = { id, fields, balances, calls };
    const axios = await createRequestInstance();
    try {
      const response = await axios.get(`nano_contract/state`, {params: data});
      const responseData = response.data;
      if (response.status === 200 && responseData.success) {
        return responseData;
      }
    } catch (e) {
      // Workaround to access e.response from axios, so the typescript linter doesn't complain
      const error = e as AxiosError<Error>;
      if (error.response === undefined) {
        throw e;
      }

      if (error.response.status === 404) {
        throw new NanoRequest404Error('Nano contract not found.');
      }
    }

    throw new NanoRequestError('Error getting nano contract state.')
  },

  /**
   * Call get nano contracts history API
   *
   * @param id Nano Contract ID
   * @param count Quantity of elements to return
   * @param after Used for pagination in the results
   *
   * @memberof ApiNanoContracts
   * @inner
   */
  async getNanoContractHistory(id: string, count: number | null = null, after: string | null = null) {
    const data = { id, count, after };
    const axios = await createRequestInstance();
    try {
      const response = await axios.get(`nano_contract/history`, {params: data});
      const responseData = response.data;
      if (response.status === 200 && responseData.success) {
        return responseData;
      }
    } catch (e) {
      // Workaround to access e.response from axios, so the typescript linter doesn't complain
      const error = e as AxiosError<Error>;
      if (error.response === undefined) {
        throw e;
      }

      if (error.response.status === 404) {
        throw new NanoRequest404Error('Nano contract not found.');
      }
    }

    throw new NanoRequestError('Error getting nano contract history.')
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
    try {
      const response = await axios.get(`nano_contract/blueprint`, { params: data });
      const responseData = response.data;
      if (response.status === 200) {
        return responseData;
      }
    } catch (e) {
      // Workaround to access e.response from axios, so the typescript linter doesn't complain
      const error = e as AxiosError<Error>;
      if (error.response === undefined) {
        throw e;
      }

      if (error.response.status === 404) {
        throw new NanoRequest404Error('Blueprint not found.');
      }
    }

    throw new NanoRequestError('Error getting blueprint information.')
  },
};

export default ncApi;