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
  getWalletStatus(authToken: string): Promise<any> {
    return axiosInstance(authToken).get('wallet');
  },

  createWallet(xpubkey: string): Promise<any> {
    const data = { xpubkey };
    return axiosInstance().post('wallet', data);
  },

  getAddresses(authToken: string): Promise<any> {
    return axiosInstance(authToken).get('addresses');
  },

  getBalances(authToken: string, token: string | null = null): Promise<any> {
    const data = { params: {} };
    if (token) {
      data['params']['token_id'] = token;
    }
    return axiosInstance(authToken).get('balances', data);
  },

  getHistory(authToken: string, token: string | null = null): Promise<any> {
    // TODO add pagination parameters
    const data = { params: {} };
    if (token) {
      data['params']['token_id'] = token;
    }
    return axiosInstance(authToken).get('txxhistory', data);
  },

  getUtxos(authToken: string, options = {}): Promise<any> {
    const data = { params: options }
    return axiosInstance(authToken).get('utxos', data);
  },

  createTxProposal(authToken: string, txHex: string): Promise<any> {
    const data = { txHex };
    return axiosInstance(authToken).post('txproposals', data);
  },

  updateTxProposal(authToken: string, id: string, txHex: string): Promise<any> {
    const data = { txHex };
    return axiosInstance(authToken).put(`txproposals/${id}`, data);
  },

  createAuthToken(timestamp: number, xpub: string, sign: string): Promise<any> {
    const data = { ts: timestamp, xpub, sign };
    return axiosInstance().post('auth/token', data);
  },
};

export default walletApi;