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
    const data = { params: { id } }
    return axiosInstance().get('wallet', data);
  },

  createWallet(xpubkey) {
    const data = { xpubkey };
    return axiosInstance().post('wallet', data);
  },

  getAddresses(id) {
    const data = { params: { id } }
    return axiosInstance().get('addresses', data);
  },

  getBalances(id, tokenUid = null) {
    const data = { params: { id } }
    if (tokenUid) {
      data['params']['token_id'] = tokenUid;
    }
    return axiosInstance().get('balances', data);
  },

  getHistory(id, tokenId = null) {
    // TODO add pagination parameters
    const data = { params: { id } }
    return axiosInstance().get('txhistory', data);
  },

  createTxProposal(id, outputs, inputs) {
    const data = { id, outputs, inputs };
    return axiosInstance().post('txproposals', data);
  },

  updateTxProposal(id, timestamp, nonce, weight, parents, inputsData) {
    const data = { timestamp, nonce, weight, parents, inputsSignatures: inputsData };
    return axiosInstance().put(`txproposals/${id}`, data);
  },
};

export default walletApi;