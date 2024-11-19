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
 * Create an axios instance to be used when sending requests
 *
 * @param url Base URL for the api requests
 * @param _resolve (UNUSED) Callback to be stored and used in case of a retry after a fail
 * @param timeout Timeout in milliseconds for the request
 * @param additionalHeaders Headers to be sent with the request
 */
export declare const axiosWrapperCreateRequestInstance: (url: string, _resolve?: undefined | null, timeout?: number | null, additionalHeaders?: {}) => import("axios").AxiosInstance;
export default axiosWrapperCreateRequestInstance;
//# sourceMappingURL=axiosWrapper.d.ts.map