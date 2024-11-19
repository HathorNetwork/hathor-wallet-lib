/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * Method that creates an axios instance
 *
 * @module Axios
 */
/**
 * Create an axios instance to be used when sending requests to the explorer service
 *
 * @param {string} network The network to access the explorer service
 * @param {number} timeout Timeout in milliseconds for the request
 */
export declare const axiosInstance: (network: string, timeout?: number) => Promise<import("axios").AxiosInstance>;
export default axiosInstance;
//# sourceMappingURL=explorerServiceAxios.d.ts.map