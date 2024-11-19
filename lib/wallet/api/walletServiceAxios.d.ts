/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import HathorWalletServiceWallet from '../wallet';
/**
 * Method that creates an axios instance
 *
 * @module Axios
 */
/**
 * Create an axios instance to be used when sending requests
 *
 * @param {number} timeout Timeout in milliseconds for the request
 */
export declare const axiosInstance: (wallet: HathorWalletServiceWallet, needsAuth: boolean, timeout?: number) => Promise<import("axios").AxiosInstance>;
export default axiosInstance;
//# sourceMappingURL=walletServiceAxios.d.ts.map