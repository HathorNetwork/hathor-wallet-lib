/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { axiosInstance } from './walletServiceAxios';
import Output from '../../models/output';
import Input from '../../models/input';

/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */

const walletApi = {
  getWalletStatus(id: string) {
    const data = { params: { id } }
    return axiosInstance().get('wallet', data);
  },

  createWallet(xpubkey: string) {
    const data = { xpubkey };
    return axiosInstance().post('wallet', data);
  },

  getAddresses(id: string) {
    const data = { params: { id } }
    return axiosInstance().get('addresses', data);
  },

  getBalances(id: string, tokenUid: string | null = null) {
    const data = { params: { id } }
    if (tokenUid) {
      data['params']['token_id'] = tokenUid;
    }
    return axiosInstance().get('balances', data);
  },

  getHistory(id: string, tokenId: string | null = null) {
    // TODO add pagination parameters
    const data = { params: { id } }
    return axiosInstance().get('txhistory', data);
  },

  createTxProposal(id: string, outputs: Output[], inputs: Input[]) {
    const data = { id, outputs, inputs };
    return axiosInstance().post('txproposals', data);
  },

  updateTxProposal(id: string, timestamp: number, nonce: number, weight: number, parents: string[], inputsData: string[]) {
    const data = { timestamp, nonce, weight, parents, inputsSignatures: inputsData };
    return axiosInstance().put(`txproposals/${id}`, data);
  },
};

export default walletApi;