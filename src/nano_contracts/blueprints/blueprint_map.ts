/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export default {
  Bet: {
    initialize: {
      token: 'string',
      dateLastBet: 'number',
      oracle: 'string',
    },
    bet: {
      address: 'string',
      result: 'string',
      amount: 'number',
      token: 'string',
      'changeAddress?': 'string',
    },
    withdraw: {
      amount: 'number',
      address: 'string',
      token: 'string',
    },
    setResult: {
      result: 'string',
      oracleData: 'string',
    },
  },
};