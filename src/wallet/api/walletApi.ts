/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { axiosInstance } from './walletServiceAxios';
import Output from '../../models/output';
import Input from '../../models/input';
import { WalletStatusResponse, AddressesResponse, AddressesToUseResponse, BalanceResponse, HistoryResponse, TxProposalCreateResponse, TxProposalUpdateResponse } from '../types';

/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */

const walletApi = {
  getWalletStatus(id: string): Promise<WalletStatusResponse> {
    const data = { params: { id } }
    return axiosInstance().get('wallet', data);
  },

  createWallet(xpubkey: string): Promise<WalletStatusResponse> {
    const data = { xpubkey };
    return axiosInstance().post('wallet', data);
  },

  getAddresses(id: string): Promise<AddressesResponse> {
    const data = { params: { id } }
    return axiosInstance().get('addresses', data);
  },

  getAddressesToUse(id: string): Promise<AddressesToUseResponse> {
    const data = { params: { id } }
    return axiosInstance().get('addressestouse', data);
  },

  getBalances(id: string, token: string | null = null): Promise<BalanceResponse> {
    const data = { params: { id } }
    if (token) {
      data['params']['token_id'] = token;
    }
    return axiosInstance().get('balances', data);
  },

  getHistory(id: string, token: string | null = null): Promise<HistoryResponse> {
    // TODO add pagination parameters
    const data = { params: { id } }
    if (token) {
      data['params']['token_id'] = token;
    }
    return axiosInstance().get('txhistory', data);
  },

  createTxProposal(id: string, outputs: Output[], inputs: Input[]): Promise<TxProposalCreateResponse> {
    const data = { id, outputs, inputs };
    return axiosInstance().post('txproposals', data);
  },

  updateTxProposal(id: string, timestamp: number, nonce: number, weight: number, parents: string[], inputsData: string[]): Promise<TxProposalUpdateResponse> {
    const data = { timestamp, nonce, weight, parents, inputsSignatures: inputsData };
    return axiosInstance().put(`txproposals/${id}`, data);
  },
};

export default walletApi;