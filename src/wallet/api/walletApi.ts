/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { axiosInstance } from './walletServiceAxios';
import Output from '../../models/output';
import Input from '../../models/input';
import {
  WalletStatusResponse,
  AddressesResponse,
  AddressesToUseResponse,
  BalanceResponse,
  HistoryResponse,
  TxProposalCreateResponse,
  TxProposalUpdateResponse,
  UtxoResponse,
  AuthTokenResponse
} from '../types';
import HathorWalletServiceWallet from '../wallet';

/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */

const walletApi = {
  async getWalletStatus(wallet: HathorWalletServiceWallet): Promise<WalletStatusResponse> {
    const axios = await axiosInstance(wallet);
    return axios.get('wallet');
  },

  async createWallet(xpubkey: string): Promise<WalletStatusResponse> {
    const data = { xpubkey };
    const axios = await axiosInstance();
    return axios.post('wallet', data);
  },

  async getAddresses(wallet: HathorWalletServiceWallet): Promise<AddressesResponse> {
    const axios = await axiosInstance(wallet);
    return axios.get('addresses');
  },

  async getAddressesToUse(wallet: HathorWalletServiceWallet): Promise<AddressesToUseResponse> {
    const axios = await axiosInstance(wallet);
    return axios.get('addressestouse');
  },

  async getBalances(wallet: HathorWalletServiceWallet, token: string | null = null): Promise<BalanceResponse> {
    const data = { params: {} };
    if (token) {
      data['params']['token_id'] = token;
    }
    const axios = await axiosInstance(wallet);
    return axios.get('balances', data);
  },

  async getHistory(wallet: HathorWalletServiceWallet, token: string | null = null): Promise<HistoryResponse> {
    // TODO add pagination parameters
    const data = { params: {} };
    if (token) {
      data['params']['token_id'] = token;
    }
    const axios = await axiosInstance(wallet);
    return axios.get('txxhistory', data);
  },

  async getUtxos(wallet: HathorWalletServiceWallet, options = {}): Promise<UtxoResponse> {
    const data = { params: options }
    const axios = await axiosInstance(wallet);
    return axios.get('utxos', data);
  },

  async createTxProposal(wallet: HathorWalletServiceWallet, txHex: string): Promise<TxProposalCreateResponse> {
    const data = { txHex };
    const axios = await axiosInstance(wallet);
    return axios.post('txproposals', data);
  },

  async updateTxProposal(wallet: HathorWalletServiceWallet, id: string, txHex: string): Promise<TxProposalUpdateResponse> {
    const data = { txHex };
    const axios = await axiosInstance(wallet);
    return axios.put(`txproposals/${id}`, data);
  },

  async createAuthToken(timestamp: number, xpub: string, sign: string): Promise<AuthTokenResponse> {
    const data = { ts: timestamp, xpub, sign };
    const axios = await axiosInstance();
    return axios.post('auth/token', data);
  },
};

export default walletApi;