/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { AxiosResponse } from 'axios';
import { AddressHistorySchema, GeneralTokenInfoSchema } from './schemas/wallet';
/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */
declare const walletApi: {
    /**
     * Get address history from passed addresses
     *
     * @param {Array} addresses Array of addresses to search for the history
     * @param {String} hash String of the hash to start the search in the first address (optional)
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getAddressHistory(addresses: any, hash: any, resolve: any): Promise<void | AxiosResponse<AddressHistorySchema>>;
    /**
     * Call API to get address history
     *
     * XXX Our current method to allow retry a request demands that we create an axios
     * instance with a resolve callback, which will be used in case of failure and the
     * user decides to retry. Because of that, it's impossible to use the old method (getAddressHistory)
     * to get data with async/await, only with promises. Because of the pagination,
     * we are in a loop getting data while not finished, so the code with async/await is
     * much cleaner.
     *
     * So, right now to use async/await we must use this method and it's not possible to
     * retry a request executed here. We must redesign the retry structure, so we can
     * support calling API methods with async/await.
     *
     * @param {Array} addresses Array of addresses to search for the history
     * @param {String} hash String of the hash to start the search in the first address (optional)
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getAddressHistoryForAwait(addresses: any, hash: any): Promise<AxiosResponse<AddressHistorySchema>>;
    /**
     * Same as the GET API but as a POST, in order to support requests with many addresses
     * in the GET we are getting 414, which is URI too large
     *
     * @param {Array} addresses Array of addresses to search for the history
     * @param {String} hash String of the hash to start the search in the first address (optional)
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getAddressHistoryForAwaitPOST(addresses: any, hash: any): Promise<AxiosResponse<AddressHistorySchema>>;
    /**
     * Execute method to send tokens
     *
     * @param {string} txHex Complete transaction serialized in hexadecimal
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    sendTokens(txHex: any, resolve: any): Promise<void>;
    /**
     * Call get general token info API
     *
     * @param {string} uid Token uid to get the general info
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getGeneralTokenInfo(uid: any, resolve: any): Promise<void | AxiosResponse<GeneralTokenInfoSchema>>;
    /**
     * Call get token transaction history API
     *
     * @param {string} uid Token uid to get the info
     * @param {number} count Quantity of elements to be returned
     * @param {string} hash Hash of transaction as reference in pagination
     * @param {number} timestamp Timestamp of transaction as reference in pagination
     * @param {string} page The button clicked in the pagination ('previous' or 'next')
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getTokenHistory(uid: any, count: any, hash: any, timestamp: any, page: any, resolve: any): Promise<void>;
    /**
     * Call get mining info data
     *
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getMiningInfo(resolve: any): Promise<void>;
    /**
     * Call get tokens list API
     *
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getTokensList(resolve: any): Promise<void>;
    /**
     * Get address balance summary
     *
     * @param {String} addresse Address to get the balance summary
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getAddressBalance(address: any, resolve: any): Promise<void>;
    /**
     * Search address
     *
     * @param {String} address Address to search history
     * @param {Number} count Quantity of elements to return
     * @param {String} hash Optional pagination parameter to reference the search
     * @param {String} page Optional pagination parameter to indicate which page button was clicked
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiWallet
     * @inner
     */
    getSearchAddress(address: any, count: any, hash: any, page: any, token: any, resolve: any): Promise<void>;
};
export default walletApi;
//# sourceMappingURL=wallet.d.ts.map