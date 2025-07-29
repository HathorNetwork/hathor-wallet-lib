/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get, isNumber } from 'lodash';
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
  AddressDetailsResponseData,
} from '../types';
import HathorWalletServiceWallet from '../wallet';
import { WalletRequestError, TxNotFoundError } from '../../errors';
import { parseSchema } from '../../utils/bigint';
import {
  addressesResponseSchema,
  checkAddressesMineResponseSchema,
  newAddressesResponseSchema,
  tokenDetailsResponseSchema,
  balanceResponseSchema,
  txProposalCreateResponseSchema,
  txProposalUpdateResponseSchema,
  fullNodeVersionDataSchema,
  fullNodeTxResponseSchema,
  fullNodeTxConfirmationDataResponseSchema,
  walletStatusResponseSchema,
  tokensResponseSchema,
  historyResponseSchema,
  txOutputResponseSchema,
  authTokenResponseSchema,
  txByIdResponseSchema,
  addressInfoObjectSchema,
  addressInfoResponseSchema,
  addressDetailsResponseSchema,
} from './schemas/walletApi';

/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */

const walletApi = {
  async getWalletStatus(wallet: HathorWalletServiceWallet): Promise<WalletStatusResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/status');
    const { data } = response;
    if (response.status === 200 && data.success) {
      return parseSchema(data, walletStatusResponseSchema);
    }
    throw new WalletRequestError('Error getting wallet status.');
  },

  async getVersionData(wallet: HathorWalletServiceWallet): Promise<FullNodeVersionData> {
    const axios = await axiosInstance(wallet, false);
    const response = await axios.get('version');
    const { data } = response;

    if (response.status === 200 && data.success) {
      return parseSchema(data.data, fullNodeVersionDataSchema);
    }
    throw new WalletRequestError('Error getting fullnode data.');
  },

  async createWallet(
    wallet: HathorWalletServiceWallet,
    xpubkey: string,
    xpubkeySignature: string,
    authXpubkey: string,
    authXpubkeySignature: string,
    timestamp: number,
    firstAddress: string | null = null
  ): Promise<WalletStatusResponseData> {
    const data: {
      authXpubkeySignature: string;
      firstAddress?: string;
      xpubkey: string;
      authXpubkey: string;
      xpubkeySignature: string;
      timestamp: number;
    } = {
      xpubkey,
      xpubkeySignature,
      authXpubkey,
      authXpubkeySignature,
      timestamp,
    };

    if (firstAddress) {
      data.firstAddress = firstAddress;
    }
    const axios = await axiosInstance(wallet, false);
    const response = await axios.post('wallet/init', data);
    if (response.status === 200 && response.data.success) {
      return parseSchema(response.data, walletStatusResponseSchema);
    }
    if (response.status === 400 && response.data.error === 'wallet-already-loaded') {
      // If it was already loaded, we have to check if it's ready
      return parseSchema(response.data, walletStatusResponseSchema);
    }
    throw new WalletRequestError('Error creating wallet.');
  },

  async getAddresses(
    wallet: HathorWalletServiceWallet,
    index?: number
  ): Promise<AddressesResponseData> {
    const axios = await axiosInstance(wallet, true);
    const path = isNumber(index) ? `?index=${index}` : '';
    const url = `wallet/addresses${path}`;
    const response = await axios.get(url);

    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, addressesResponseSchema);
    }

    throw new WalletRequestError('Error getting wallet addresses.');
  },

  async getAddressDetails(
    wallet: HathorWalletServiceWallet,
    address: string
  ): Promise<AddressDetailsResponseData> {
    const axios = await axiosInstance(wallet, true);
    const path = `?address=${address}`;
    const url = `wallet/address/info${path}`;
    const response = await axios.get(url);

    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, addressDetailsResponseSchema);
    }

    throw new WalletRequestError('Error getting address info.');
  },

  async checkAddressesMine(
    wallet: HathorWalletServiceWallet,
    addresses: string[]
  ): Promise<CheckAddressesMineResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.post('wallet/addresses/check_mine', { addresses });
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, checkAddressesMineResponseSchema);
    }

    throw new WalletRequestError('Error checking wallet addresses.');
  },

  async getNewAddresses(wallet: HathorWalletServiceWallet): Promise<NewAddressesResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/addresses/new');
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, newAddressesResponseSchema);
    }
    throw new WalletRequestError('Error getting wallet addresses to use.');
  },

  async getTokenDetails(
    wallet: HathorWalletServiceWallet,
    tokenId: string
  ): Promise<TokenDetailsResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/tokens/${tokenId}/details`);

    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, tokenDetailsResponseSchema);
    }
    throw new WalletRequestError('Error getting token details.');
  },

  async getBalances(
    wallet: HathorWalletServiceWallet,
    token: string | null = null
  ): Promise<BalanceResponseData> {
    const data: { params: { token_id?: string } } = { params: {} };
    if (token) {
      data.params.token_id = token;
    }
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/balances', data);
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, balanceResponseSchema);
    }
    throw new WalletRequestError('Error getting wallet balance.');
  },

  async getTokens(wallet: HathorWalletServiceWallet): Promise<TokensResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/tokens');
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, tokensResponseSchema);
    }
    throw new WalletRequestError('Error getting list of tokens.');
  },

  async getHistory(wallet: HathorWalletServiceWallet, options = {}): Promise<HistoryResponseData> {
    const data = { params: options };
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/history', data);
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, historyResponseSchema);
    }
    throw new WalletRequestError('Error getting wallet history.');
  },

  async getTxOutputs(
    wallet: HathorWalletServiceWallet,
    options = {}
  ): Promise<TxOutputResponseData> {
    const data = { params: options };
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/tx_outputs', data);
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, txOutputResponseSchema);
    }
    throw new WalletRequestError('Error requesting utxo.');
  },

  async createTxProposal(
    wallet: HathorWalletServiceWallet,
    txHex: string
  ): Promise<TxProposalCreateResponseData> {
    const data = { txHex };
    const axios = await axiosInstance(wallet, true);
    const response = await axios.post('tx/proposal', data);
    if (response.status === 201) {
      return parseSchema(response.data, txProposalCreateResponseSchema);
    }
    throw new WalletRequestError('Error creating tx proposal.');
  },

  async updateTxProposal(
    wallet: HathorWalletServiceWallet,
    id: string,
    txHex: string
  ): Promise<TxProposalUpdateResponseData> {
    const data = { txHex };
    const axios = await axiosInstance(wallet, true);
    const response = await axios.put(`tx/proposal/${id}`, data);
    if (response.status === 200) {
      return parseSchema(response.data, txProposalUpdateResponseSchema);
    }
    throw new WalletRequestError('Error sending tx proposal.');
  },

  async deleteTxProposal(
    wallet: HathorWalletServiceWallet,
    id: string
  ): Promise<TxProposalUpdateResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.delete(`tx/proposal/${id}`);
    if (response.status === 200) {
      return parseSchema(response.data, txProposalUpdateResponseSchema);
    }
    throw new WalletRequestError('Error deleting tx proposal.');
  },

  async createAuthToken(
    wallet: HathorWalletServiceWallet,
    timestamp: number,
    xpub: string,
    sign: string
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
      return parseSchema(response.data, authTokenResponseSchema);
    }

    throw new WalletRequestError('Error requesting auth token.');
  },

  async getTxById(
    wallet: HathorWalletServiceWallet,
    txId: string
  ): Promise<TxByIdTokensResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/transactions/${txId}`);
    if (response.status === 200 && response.data) {
      if (!response.data.success) {
        walletApi._txNotFoundGuard(response.data);
        throw new WalletRequestError('Error getting transaction by its id.', {
          cause: response.data,
        });
      }
      return parseSchema(response.data, txByIdResponseSchema);
    }

    throw new WalletRequestError('Error getting transaction by its id.', {
      cause: response.data,
    });
  },

  _txNotFoundGuard(data: unknown) {
    const message = get<unknown, string, string>(data, 'message', '');

    if (message === 'Transaction not found') {
      throw new TxNotFoundError();
    }
  },

  async getFullTxById(
    wallet: HathorWalletServiceWallet,
    txId: string
  ): Promise<FullNodeTxResponse> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/proxy/transactions/${txId}`);
    if (response.status === 200 && response.data.success) {
      return parseSchema(response.data, fullNodeTxResponseSchema);
    }

    walletApi._txNotFoundGuard(response.data);

    throw new WalletRequestError('Error getting transaction by its id from the proxied fullnode.', {
      cause: response.data,
    });
  },

  async getTxConfirmationData(
    wallet: HathorWalletServiceWallet,
    txId: string
  ): Promise<FullNodeTxConfirmationDataResponse> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/proxy/transactions/${txId}/confirmation_data`);
    if (response.status === 200 && response.data.success) {
      return parseSchema(response.data, fullNodeTxConfirmationDataResponseSchema);
    }

    walletApi._txNotFoundGuard(response.data);

    throw new WalletRequestError(
      'Error getting transaction confirmation data by its id from the proxied fullnode.',
      {
        cause: response.data,
      }
    );
  },

  async graphvizNeighborsQuery(
    wallet: HathorWalletServiceWallet,
    txId: string,
    graphType: string,
    maxLevel: number
  ): Promise<string> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(
      `wallet/proxy/graphviz/neighbours?txId=${txId}&graphType=${graphType}&maxLevel=${maxLevel}`
    );
    if (response.status === 200) {
      // The service might answer a status code 200 but output an error message like
      // { success: false, message: '...' }, we need to handle it.
      //
      // We also need to check if `success` is a key to the object since this API will return
      // a string on success.
      if (Object.hasOwnProperty.call(response.data, 'success') && !response.data.success) {
        walletApi._txNotFoundGuard(response.data);

        throw new WalletRequestError(
          `Error getting neighbors data for ${txId} from the proxied fullnode.`,
          {
            cause: response.data.message,
          }
        );
      }

      return response.data;
    }

    throw new WalletRequestError(
      `Error getting neighbors data for ${txId} from the proxied fullnode.`,
      {
        cause: response.data,
      }
    );
  },
};

export default walletApi;
