/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { axiosInstance } from './walletServiceAxios';

/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */

const walletApi = {
  getWalletStatus(id) {
    return axiosInstance().get('wallet', {'params': {id}});
  },

  createWallet(xpubkey) {
    return axiosInstance().post('wallet', {xpubkey});
  }
};

export default walletApi;