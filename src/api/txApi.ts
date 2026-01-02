/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createRequestInstance } from './axiosInstance';
import { transformJsonBigIntResponse } from '../utils/bigint';
import {
  FullNodeTxApiResponse,
  GraphvizNeighboursResponse,
  TransactionAccWeightResponse,
  transactionApiSchema,
} from './schemas/txApi';

/**
 * Api calls for transaction
 *
 * @namespace ApiTransaction
 */

const txApi = {
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
  getTransactionBase(data, resolve, schema?) {
    return createRequestInstance(resolve)
      .get(`transaction`, {
        params: data,
        transformResponse: res => (schema ? transformJsonBigIntResponse(res, schema) : res),
      })
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
  getTransactions(type, count, timestamp, hash, page, resolve) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { type, count };
    if (hash) {
      data.hash = hash;
      data.timestamp = timestamp;
      data.page = page;
    }
    return this.getTransactionBase(data, resolve);
  },

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
  getTransaction(id: string, resolve: (response: FullNodeTxApiResponse) => void): Promise<void> {
    const data = { id };
    return this.getTransactionBase(data, resolve, transactionApiSchema);
  },

  /**
   * Call api to get confirmation data of a tx
   *
   * @param id Transaction hash in hex
   * @param resolve Method to be called after response arrives
   */
  getConfirmationData(id: string, resolve: (response: TransactionAccWeightResponse) => void) {
    // TODO: This method uses a callback pattern but also returns a Promise, which is an anti-pattern
    // NOTE: createRequestInstance has legacy typing (resolve?: null) that doesn't match actual usage.
    const data = { id };
    return createRequestInstance(resolve as unknown as null)
      .get<TransactionAccWeightResponse>(`transaction_acc_weight`, { params: data })
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          Promise.reject(res);
        }
      );
  },

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
  decodeTx(hex_tx, resolve) {
    const data = { hex_tx };
    return createRequestInstance(resolve)
      .get(`decode_tx`, { params: data })
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
   * Call api to push a transaction
   *
   * @param {string} hex_tx Full transaction in hexadecimal
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiTransaction
   * @inner
   */
  pushTx(hex_tx, force, resolve) {
    const data = { hex_tx, force };
    return createRequestInstance(resolve)
      .post(`push_tx`, data)
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
  getDashboardTx(block, tx, resolve) {
    const data = { block, tx };
    return createRequestInstance(resolve)
      .get(`dashboard_tx`, { params: data })
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
   * Call api to get graphviz
   *
   * @param {string} url URL to get graph data
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiTransaction
   * @inner
   * @deprecated Not being used anywhere. Will be removed soon.
   */
  getGraphviz(url, resolve) {
    return createRequestInstance(resolve)
      .get(url)
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
   * Call api to get graphviz neighbors
   *
   * @param {string} tx Transaction hash
   * @param {string} graphType Type of graph ('funds', 'verification', etc.)
   * @param {number} maxLevel Maximum depth level for the graph
   * @param {function} resolve Method to be called after response arrives
   *
   * @return {Promise}
   * @memberof ApiTransaction
   * @inner
   */
  getGraphvizNeighbors(
    tx: string,
    graphType: string,
    maxLevel: number,
    resolve: (response: GraphvizNeighboursResponse) => void
  ): Promise<void> {
    // TODO: This method uses a callback pattern but also returns a Promise, which is an anti-pattern
    // NOTE: createRequestInstance has legacy typing (resolve?: null) that doesn't match actual usage.
    const data = { tx, graph_type: graphType, max_level: maxLevel };
    return createRequestInstance(resolve as unknown as null)
      .get<GraphvizNeighboursResponse>(`graphviz/neighbours.dot`, { params: data })
      .then(
        res => {
          resolve(res.data);
        },
        res => {
          return Promise.reject(res);
        }
      );
  },

  // Expose the txApi zod schemas
  schemas: {
    transactionApi: transactionApiSchema,
  },
};

export default txApi;
