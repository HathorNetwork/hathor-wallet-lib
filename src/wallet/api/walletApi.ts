/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { axiosInstance } from './walletServiceAxios';
import {
  CheckAddressesMineResponseData,
  WalletStatusResponseData,
  AddressesResponseData,
  NewAddressesResponseData,
  BalanceResponseData,
  HistoryResponseData,
  TokensResponseData,
  TxProposalCreateResponseData,
  TxProposalUpdateResponseData,
  TokenDetailsResponseData,
  TxOutputResponseData,
  AuthTokenResponseData,
  FullNodeVersionData,
  TxByIdTokensResponseData,
  FullNodeTxResponse,
  FullNodeTxConfirmationDataResponse,
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

  async getVersionData(wallet: HathorWalletServiceWallet): Promise<FullNodeVersionData> {
    const axios = await axiosInstance(wallet, false);
    const response = await axios.get('version');
    const data = response.data;

    if (response.status === 200 && data.success) {
      return data.data;
    } else {
      throw new WalletRequestError('Error getting fullnode data.');
    }
  },

  async createWallet(
    wallet: HathorWalletServiceWallet,
    xpubkey: string,
    xpubkeySignature: string,
    authXpubkey: string,
    authXpubkeySignature: string,
    timestamp: number,
    firstAddress: string | null = null,
  ): Promise<WalletStatusResponseData> {
    const data = {
      xpubkey,
      xpubkeySignature,
      authXpubkey,
      authXpubkeySignature,
      timestamp,
    };

    if (firstAddress) {
      data['firstAddress'] = firstAddress;
    }
    const axios = await axiosInstance(wallet, false);
    const response = await axios.post('wallet/init', data);
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

  async checkAddressesMine(
    wallet: HathorWalletServiceWallet,
    addresses: string[],
  ): Promise<CheckAddressesMineResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.post('wallet/addresses/check_mine', { addresses });
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    }

    throw new WalletRequestError('Error checking wallet addresses.');
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

  async getTokenDetails(wallet: HathorWalletServiceWallet, tokenId: string): Promise<TokenDetailsResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/tokens/${tokenId}/details`);

    if (response.status === 200 && response.data.success === true) {
      return response.data;
    } else {
      throw new WalletRequestError('Error getting token details.');
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

  async getTxOutputs(wallet: HathorWalletServiceWallet, options = {}): Promise<TxOutputResponseData> {
    const data = { params: options }
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/tx_outputs', data);
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
    const data = {
      ts: timestamp,
      xpub,
      sign,
      walletId: wallet.walletId,
    };
    const axios = await axiosInstance(wallet, false);
    const response = await axios.post('auth/token', data);
    if (response.status === 200 && response.data.success === true) {
      return response.data;
    }

    throw new WalletRequestError('Error requesting auth token.');
  },

  async getTxById(
    wallet: HathorWalletServiceWallet,
    txId: string,
  ): Promise<TxByIdTokensResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/transactions/${txId}`);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }

    throw new WalletRequestError('Error getting transaction by its id.', {
      cause: response.data,
    });
  },

  async getFullTxById(
    wallet: HathorWalletServiceWallet,
    txId: string,
  ): Promise<FullNodeTxResponse> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/proxy/transactions/${txId}`);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }

    throw new WalletRequestError('Error getting transaction by its id from the proxied fullnode.', {
      cause: response.data,
    });
  },

  async getTxConfirmationData(
    wallet: HathorWalletServiceWallet,
    txId: string,
  ): Promise<FullNodeTxConfirmationDataResponse> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/proxy/transactions/${txId}/confirmation_data`);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }

    throw new WalletRequestError('Error getting transaction confirmation data by its id from the proxied fullnode.', {
      cause: response.data,
    });
  },

  async graphvizNeighborsQuery(
    wallet: HathorWalletServiceWallet,
    txId: string,
    graphType: string,
    maxLevel: number,
  ): Promise<string> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/proxy/graphviz/neighbours?txId=${txId}&graphType=${graphType}&maxLevel=${maxLevel}`);
    if (response.status === 200) {
      // The service might answer a status code 200 but output an error message like
      // { success: false, message: '...' }, we need to handle it.
      //
      // We also need to check if `success` is a key to the object since this API will return
      // a string on success.
      if (Object.hasOwnProperty.call(response.data, 'success') && !response.data.success) {
        throw new WalletRequestError(`Error getting neighbors data for ${txId} from the proxied fullnode.`, {
          cause: response.data.message,
        });
      }

      return response.data;
    }

    throw new WalletRequestError(`Error getting neighbors data for ${txId} from the proxied fullnode.`, {
      cause: response.data,
    });
  },
};

export default walletApi;
