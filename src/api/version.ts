/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createRequestInstance } from './axiosInstance';
import { ApiVersion } from '../types';

/**
 * Api calls for version
 *
 * @namespace ApiVersion
 */

const versionApi = {
  /**
   * Get version of full node running in connected server
   *
   * @param resolve Method to be called after response arrives
   *
   * @deprecated Use asyncGetVersion instead
   * @return Promise that resolves to void (result is passed through callback)
   * @memberof ApiVersion
   * @inner
   */
  // TODO: This method uses a callback pattern but also returns a Promise, which is an anti-pattern
  // NOTE: createRequestInstance has legacy typing (resolve?: null) that doesn't match actual usage.
  getVersion(resolve: (data: ApiVersion) => void) {
    return createRequestInstance(resolve as unknown as null)
      .get<ApiVersion>(`version`)
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
  },

  /**
   * Get version of full node running in connected server
   *
   * @return Promise resolving to the version data
   * @memberof ApiVersion
   * @inner
   */
  async asyncGetVersion(): Promise<ApiVersion> {
    // FIXME: This function wraps a Promise around another Promise, which is an anti-pattern.
    return new Promise((resolve, reject) => {
      // NOTE: createRequestInstance has legacy typing (resolve?: null) that doesn't match actual usage.
      createRequestInstance(resolve as unknown as null)
        .get<ApiVersion>(`version`)
        .then(
          res => {
            resolve(res.data);
          },
          err => {
            reject(err);
          }
        );
    });
  },
};

export default versionApi;
