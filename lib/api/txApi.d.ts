/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { AxiosResponse } from 'axios';
import { TransactionSchema } from './schemas/txApi';
/**
 * Api calls for transaction
 *
 * @namespace ApiTransaction
 */
declare const txApi: {
    /**
     * Call get transaction API with data passed as parameter
     *
     * @param {Object} data Data to be sent in the request
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiTransaction
     * @inner
     */
    getTransactionBase(data: any, resolve: any, schema?: any): Promise<void>;
    /**
     * Call api to get many transactions
     *
     * @param {string} type 'block' or 'tx' (if we are getting txs or blocks)
     * @param {number} count How many objects we want
     * @param {number} timestamp (optional) timestamp reference for the pagination (works together with 'page' parameter)
     * @param {string} hash (optional)  hash reference for the pagination (works together with 'page' parameter)
     * @param {string} page (optional) 'previous' or 'next': if 'previous', we get the objects before the hash reference. If 'next', we get the objects after the hash reference
     * @params {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiTransaction
     * @inner
     */
    getTransactions(type: any, count: any, timestamp: any, hash: any, page: any, resolve: any): Promise<void>;
    /**
     * Call api to get one transaction
     *
     * @param {string} id Transaction ID to search
     * @params {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiTransaction
     * @inner
     */
    getTransaction(id: any, resolve: any): Promise<void | AxiosResponse<TransactionSchema>>;
    /**
     * Call api to get confirmation data of a tx
     *
     * @param {string} id Transaction hash in hex
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiTransaction
     * @inner
     */
    getConfirmationData(id: any, resolve: any): Promise<void>;
    /**
     * Call api to decode a transaction
     *
     * @param {string} hex_tx Full transaction in hexadecimal
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiTransaction
     * @inner
     */
    decodeTx(hex_tx: any, resolve: any): Promise<void>;
    /**
     * Call api to push a transaction
     *
     * @param {string} hex_tx Full transaction in hexadecimal
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiTransaction
     * @inner
     */
    pushTx(hex_tx: any, force: any, resolve: any): Promise<void>;
    /**
     * Call api to get dashboard data
     *
     * @param {number} block Quantity of blocks to return
     * @param {number} tx Quantity of transactions to return
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiTransaction
     * @inner
     */
    getDashboardTx(block: any, tx: any, resolve: any): Promise<void>;
    /**
     * Call api to get graphviz
     *
     * @param {string} url URL to get graph data
     * @param {function} resolve Method to be called after response arrives
     *
     * @return {Promise}
     * @memberof ApiTransaction
     * @inner
     */
    getGraphviz(url: any, resolve: any): Promise<void>;
};
export default txApi;
//# sourceMappingURL=txApi.d.ts.map