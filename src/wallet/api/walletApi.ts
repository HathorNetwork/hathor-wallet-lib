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
  WalletStatusResponseData,
  AddressesResponseData,
  NewAddressesResponseData,
  BalanceResponseData,
  HistoryResponseData,
  TokensResponseData,
  TxProposalCreateResponseData,
  TxProposalUpdateResponseData,
  UtxoResponseData,
  AuthTokenResponseData
} from '../types';
import HathorWalletServiceWallet from '../wallet';
import { WalletRequestError } from '../../errors';

/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */

const walletApi = {
  async getWalletStatus(wallet: HathorWalletServiceWallet): Promise<WalletStatusResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/status');
    const data = response.data;
    if (response.status === 200 && data.success) {
      return data;
    } else {
      throw new WalletRequestError('Error getting wallet status.');
    }
  },

  async createWallet(
    wallet: HathorWalletServiceWallet,
    xpubkey: string,
    authXpub: string,
    firstAddress: string | null = null,
  ): Promise<WalletStatusResponseData> {
    const data = {
      xpubkey,
      authXpubkey: authXpub,
    };

    if (firstAddress) {
      data['firstAddress'] = firstAddress;
    }
    const axios = await axiosInstance(wallet, false);
    const response = await axios.post('wallet/init', data);
    console.log('respoauthXpubnse: ', response);
    if (response.status === 200 && response.data.success) {
      return response.data;
    } else if (response.status === 400 && response.data.error === 'wallet-already-loaded') {
      // If it was already loaded, we have to check if it's ready
      return response.data;
    } else {
      throw new WalletRequestError('Error creating wallet.');
    }
  },

  async getAddresses(wallet: HathorWalletServiceWallet): Promise<AddressesResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/addresses');
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    } else {
      throw new WalletRequestError('Error getting wallet addresses.');
    }
  },

  async getNewAddresses(wallet: HathorWalletServiceWallet): Promise<NewAddressesResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/addresses/new');
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    } else {
      throw new WalletRequestError('Error getting wallet addresses to use.');
    }
  },

  async getBalances(wallet: HathorWalletServiceWallet, token: string | null = null): Promise<BalanceResponseData> {
    const data = { params: {} };
    if (token) {
      data['params']['token_id'] = token;
    }
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/balances', data);
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    } else {
      throw new WalletRequestError('Error getting wallet balance.');
    }
  },

  async getTokens(wallet: HathorWalletServiceWallet): Promise<TokensResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/tokens');
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    } else {
      throw new WalletRequestError('Error getting list of tokens.');
    }
  },

  async getHistory(wallet: HathorWalletServiceWallet, options = {}): Promise<HistoryResponseData> {
    const data = { params: options };
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/history', data);
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    } else {
      throw new WalletRequestError('Error getting wallet history.');
    }
  },

  async getUtxos(wallet: HathorWalletServiceWallet, options = {}): Promise<UtxoResponseData> {
    const data = { params: options }
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/utxos', data);
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    } else {
      throw new WalletRequestError('Error requesting utxo.');
    }
  },

  async createTxProposal(wallet: HathorWalletServiceWallet, txHex: string): Promise<TxProposalCreateResponseData> {
    const data = { txHex };
    const axios = await axiosInstance(wallet, true);
    const response = await axios.post('tx/proposal', data);
    if (response.status === 201) {
      return response.data;
    } else {
      throw new WalletRequestError('Error creating tx proposal.');
    }
  },

  async updateTxProposal(wallet: HathorWalletServiceWallet, id: string, txHex: string): Promise<TxProposalUpdateResponseData> {
    const data = { txHex };
    const axios = await axiosInstance(wallet, true);
    const response = await axios.put(`tx/proposal/${id}`, data);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new WalletRequestError('Error sending tx proposal.');
    }
  },

  async createAuthToken(
      wallet: HathorWalletServiceWallet,
      timestamp: number,
      xpub: string,
      sign: string,
  ): Promise<AuthTokenResponseData> {
    const data = { ts: timestamp, xpub, sign };
    const axios = await axiosInstance(wallet, false);
    const response = await axios.post('auth/token', data);
    console.log('Request auth token; ', response);
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    } else {
      throw new WalletRequestError('Error requesting auth token.');
    }
  },
};

export default walletApi;
