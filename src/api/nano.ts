/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios, { AxiosError } from 'axios';
import { createRequestInstance } from './axiosInstance';
import { NanoRequest404Error, NanoRequestError } from '../errors';
import {
  NanoContractBlueprintInformationAPIResponse,
  NanoContractHistoryAPIResponse,
  NanoContractStateAPIResponse,
  NanoContractStateAPIParameters,
} from '../nano_contracts/types';

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
  async getNanoContractState(
    id: string,
    fields: string[],
    balances: string[],
    calls: string[],
    block_hash: string | null = null,
    block_height: number | null = null
  ): Promise<NanoContractStateAPIResponse> {
    const data: NanoContractStateAPIParameters = { id, fields, balances, calls };

    if (block_hash) {
      data.block_hash = block_hash;
    }

    if (block_height) {
      data.block_height = block_height;
    }

    const axiosInstance = await createRequestInstance();
    try {
      const response = await axiosInstance.get(`nano_contract/state`, { params: data });
      const responseData = response.data;
      if (response.status === 200 && responseData.success) {
        return responseData;
      }

      throw new NanoRequestError('Error getting nano contract state.', null, response);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const e = error as AxiosError<Error>;
        if (e.response && e.response.status === 404) {
          throw new NanoRequest404Error('Nano contract not found.', e, e.response);
        }
      }

      throw new NanoRequestError('Error getting nano contract state.', error);
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
  async getNanoContractHistory(
    id: string,
    count: number | null = null,
    after: string | null = null,
    before: string | null = null
  ): Promise<NanoContractHistoryAPIResponse> {
    const data = { id, count, after, before };
    const axiosInstance = await createRequestInstance();
    try {
      const response = await axiosInstance.get(`nano_contract/history`, { params: data });
      const responseData = response.data;
      if (response.status === 200 && responseData.success) {
        return responseData;
      }

      throw new NanoRequestError('Error getting nano contract history.', null, response);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const e = error as AxiosError<Error>;
        if (e.response && e.response.status === 404) {
          throw new NanoRequest404Error('Nano contract not found.', e, e.response);
        }
      }

      throw new NanoRequestError('Error getting nano contract history.', error);
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
  async getBlueprintInformation(id: string): Promise<NanoContractBlueprintInformationAPIResponse> {
    const data = { blueprint_id: id };
    const axiosInstance = await createRequestInstance();
    try {
      const response = await axiosInstance.get(`nano_contract/blueprint/info`, { params: data });
      const responseData = response.data;
      if (response.status === 200) {
        return responseData;
      }

      throw new NanoRequestError('Error getting blueprint information.', null, response);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const e = error as AxiosError<Error>;
        if (e.response && e.response.status === 404) {
          throw new NanoRequest404Error('Blueprint not found.', e, e.response);
        }
      }

      throw new NanoRequestError('Error getting blueprint information.', error);
    }
  },
};

export default ncApi;
