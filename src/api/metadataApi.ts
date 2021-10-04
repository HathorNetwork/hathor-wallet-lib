/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import explorerServiceAxios from './explorerServiceAxios';
import helpers from '../utils/helpers';
import { METADATA_RETRY_LIMIT, DOWNLOAD_METADATA_RETRY_INTERVAL } from '../constants';
import { GetDagMetadataApiError } from '../errors';

const metadataApi = {
  async getDagMetadata(id: string, network: string, options = {}) {
    type optionsType = {
      retries: number,
      retryInterval: number,
    };
    const newOptions: optionsType = Object.assign({
      retries: METADATA_RETRY_LIMIT,
      retryInterval: DOWNLOAD_METADATA_RETRY_INTERVAL,
    }, options);

    let { retries, retryInterval } = newOptions;
    while (retries >= 0) {
      const axios = await explorerServiceAxios(network);
      try {
        const response = await axios.get(`metadata/dag`, { params: { id }});
        if (response.data) {
          return response.data;
        } else {
          // Error downloading metadata
          // throw Error and the catch will handle it
          throw new GetDagMetadataApiError('Invalid metadata API response.');
        }
      } catch (e) {
        if (e.response && e.response.status === 404) {
          // No need to do anything, the metadata for this token was not found
          // There is no error here, we just return null
          return null;
        } else {
          // Error downloading metadata
          if (retries === 0) {
            // If we have no more retries left, then we propagate the error
            throw new GetDagMetadataApiError(e.message);
          } else {
            // If we still have retry attempts, then we wait a few seconds and retry
            await helpers.sleep(retryInterval);
            retries--;
          }
        }
      }
    }
  }
};

export default metadataApi;