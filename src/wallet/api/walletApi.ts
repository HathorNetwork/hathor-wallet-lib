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
  getWalletStatus(id: string, network = 'mainnet'): Promise<any> {
    const data = { params: { id } }
    return axiosInstance(network).get('wallet', data);
  },

  createWallet(xpubkey: string, network = 'mainnet'): Promise<any> {
    const data = { xpubkey };
    return axiosInstance(network).post('wallet', data);
  },

  getAddresses(id: string, network = 'mainnet'): Promise<any> {
    const data = { params: { id } }
    return axiosInstance(network).get('addresses', data);
  },

  getBalances(id: string, token: string | null = null, network = 'mainnet'): Promise<any> {
    const data = { params: { id } }
    if (token) {
      data['params']['token_id'] = token;
    }
    return axiosInstance(network).get('balances', data);
  },

  getHistory(id: string, token: string | null = null, network = 'mainnet'): Promise<any> {
    // TODO add pagination parameters
    const data = { params: { id } }
    if (token) {
      data['params']['token_id'] = token;
    }
    return axiosInstance(network).get('txhistory', data);
  },

  createTxProposal(id: string, outputs: Output[], inputs: Input[], network = 'mainnet'): Promise<any> {
    const data = { id, outputs, inputs };
    return axiosInstance(network).post('txproposals', data);
  },

  updateTxProposal(id: string, timestamp: number, nonce: number, weight: number, parents: string[], inputsData: string[], network = 'mainnet'): Promise<any> {
    const data = { timestamp, nonce, weight, parents, inputsSignatures: inputsData };
    return axiosInstance(network).put(`txproposals/${id}`, data);
  },
};

export default walletApi;
