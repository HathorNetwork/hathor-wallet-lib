/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AxiosError } from 'axios';
import explorerServiceAxios from './explorerServiceAxios';
import helpers from '../utils/helpers';
import { METADATA_RETRY_LIMIT, DOWNLOAD_METADATA_RETRY_INTERVAL } from '../constants';
import { GetDagMetadataApiError } from '../errors';

type MetadataApiResponse = {
  id: string;
  nft?: boolean;
  banned?: boolean;
  verified?: boolean;
  reason?: string;
  nft_media?: { file: string; type: string; loop: boolean; autoplay: boolean; mime_type?: string };
};

const metadataApi = {
  /**
   * Returns the Dag Metadata for a given transaction id
   * @param id Tx Identifier
   * @param network Network name
   * @param options
   * @param [options.retries] Number of retries that the method will attempt before rejecting
   * @param [options.retryInterval] Interval, in miliseconds, between each attempt
   */
  async getDagMetadata(
    id: string,
    network: string,
    options: { retries?: number; retryInterval?: number } = {}
  ) {
    type optionsType = {
      retries: number;
      retryInterval: number;
    };
    const newOptions: optionsType = {
      retries: METADATA_RETRY_LIMIT,
      retryInterval: DOWNLOAD_METADATA_RETRY_INTERVAL,
      ...options,
    };

    const { retryInterval } = newOptions;
    let { retries } = newOptions;
    let metaData: null | MetadataApiResponse = null;
    while (retries >= 0) {
      const client = await explorerServiceAxios(network);
      try {
        const response = await client.get('metadata/dag', { params: { id } });
        if (response.data) {
          metaData = response.data;
          break;
        }
        // Error downloading metadata
        // throw Error and the catch will handle it
        throw new GetDagMetadataApiError('Invalid metadata API response.');
      } catch (e) {
        if ((e as AxiosError).response?.status === 404) {
          // 404 is not flagged as an error by our current Axios configuration
          // No need to do anything, the metadata for this token was not found
          // There is no error here, we just return null
          metaData = null;
          break;
        }
        if (!(e instanceof Error)) {
          // This is for the typescript compiler, since it doesn't know that e is an Error
          throw new GetDagMetadataApiError('Unknown error.');
        }
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
    return metaData;
  },
};

export default metadataApi;
