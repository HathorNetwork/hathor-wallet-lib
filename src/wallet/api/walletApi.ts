/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get, isNumber } from 'lodash';
import { isAxiosError } from 'axios';
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
  GetTxOutputsOptions,
  AuthTokenResponseData,
  FullNodeVersionData,
  TxByIdTokensResponseData,
  FullNodeTxResponse,
  FullNodeTxConfirmationDataResponse,
  AddressDetailsResponseData,
  TxProposalDeleteResponseData,
  HasTxOutsideFirstAddressResponseData,
  ShieldedAddressesResponseData,
  ShieldedNewAddressesResponseData,
  ShieldedRegistrationFields,
  SplitBalanceResponseData,
} from '../types';
import HathorWalletServiceWallet from '../wallet';
import { WalletRequestError, TxNotFoundError, ShieldedKeysConflictError } from '../../errors';
import { SEND_TX_TIMEOUT } from '../../constants';
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
  addressDetailsResponseSchema,
  txProposalDeleteResponseSchema,
  hasTxOutsideFirstAddressResponseSchema,
  shieldedAddressesResponseSchema,
  shieldedNewAddressesResponseSchema,
  splitBalanceResponseSchema,
} from './schemas/walletApi';

/**
 * Strip the request body (and the raw request holding it) from a failed
 * request's error.
 */
function withoutRequestBody(err: unknown): unknown {
  if (isAxiosError(err)) {
    // The caller's error is redacted in place, so it keeps its identity
    /* eslint-disable no-param-reassign */
    if (err.config) {
      err.config.data = undefined;
    }
    err.request = undefined;
    /* eslint-enable no-param-reassign */
  }
  return err;
}

/** Body fields of `POST wallet/init` that register the shielded keys. */
const SHIELDED_REGISTRATION_FIELDS: unknown[] = [
  'scanXpriv',
  'spendXpub',
  'firstCtAddress',
  'spendXpubSignature',
  'ctAddressSignature',
];

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
    throw new WalletRequestError('Error getting wallet status.', {
      cause: { status: response.status, data: response.data },
    });
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
    firstAddress: string | null = null,
    shielded: ShieldedRegistrationFields | null = null
  ): Promise<WalletStatusResponseData> {
    const data: {
      authXpubkeySignature: string;
      firstAddress?: string;
      xpubkey: string;
      authXpubkey: string;
      xpubkeySignature: string;
      timestamp: number;
    } & Partial<ShieldedRegistrationFields> = {
      xpubkey,
      xpubkeySignature,
      authXpubkey,
      authXpubkeySignature,
      timestamp,
    };

    if (firstAddress) {
      data.firstAddress = firstAddress;
    }
    if (shielded) {
      // The server requires all five fields together.
      Object.assign(data, shielded);
    }
    const axios = await axiosInstance(wallet, false);
    let response;
    try {
      response = await axios.post('wallet/init', data);
    } catch (err) {
      // The body carries the scan xpriv: keep it out of an error that callers
      // may log, while rethrowing the same error so its type and code remain
      throw withoutRequestBody(err);
    }
    if (response.status === 200 && response.data.success) {
      return parseSchema(response.data, walletStatusResponseSchema);
    }
    if (response.status === 400 && response.data.error === 'wallet-already-loaded') {
      // If it was already loaded, we have to check if it's ready
      return parseSchema(response.data, walletStatusResponseSchema);
    }
    const cause = { status: response.status, data: response.data };
    if (response.status === 409 && response.data?.error === 'shielded-keys-conflict') {
      throw new ShieldedKeysConflictError(
        'The wallet-service already holds different shielded keys for this wallet.',
        { cause }
      );
    }
    const details: { message?: string; path?: unknown[] }[] = Array.isArray(response.data?.details)
      ? response.data.details
      : [];
    if (
      response.data?.error === 'invalid-payload' &&
      details.some(
        d => Array.isArray(d.path) && d.path.some(p => SHIELDED_REGISTRATION_FIELDS.includes(p))
      )
    ) {
      // An older wallet-service rejects the shielded fields as unknown keys,
      // each detail naming the field in its path. The server's messages are
      // kept in the error.
      const reasons = details.map(d => d.message).filter(Boolean);
      throw new WalletRequestError(
        `The wallet-service does not support shielded registration: ${reasons.join('; ')}`,
        { cause }
      );
    }
    if (!response.data?.error && details[0]?.message) {
      // Registration proof failures carry only a message.
      throw new WalletRequestError(details[0].message, { cause });
    }
    throw new WalletRequestError('Error creating wallet.', { cause });
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

  async getShieldedAddresses(
    wallet: HathorWalletServiceWallet,
    index?: number
  ): Promise<ShieldedAddressesResponseData> {
    const axios = await axiosInstance(wallet, true);
    const indexQuery = isNumber(index) ? `index=${index}&` : '';
    const response = await axios.get(`wallet/addresses?${indexQuery}legacy=false`);

    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, shieldedAddressesResponseSchema);
    }

    throw new WalletRequestError('Error getting wallet shielded addresses.');
  },

  async getAddressDetails(
    wallet: HathorWalletServiceWallet,
    address: string
  ): Promise<AddressDetailsResponseData> {
    const axios = await axiosInstance(wallet, true);
    const query = `?address=${address}`;
    const url = `wallet/address/info${query}`;
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

  /**
   * Get the unused shielded addresses, together with their on-chain spend
   * addresses and the unused legacy addresses, in a single request.
   */
  async getShieldedNewAddresses(
    wallet: HathorWalletServiceWallet
  ): Promise<ShieldedNewAddressesResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/addresses/new?legacy=false');
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, shieldedNewAddressesResponseSchema);
    }
    throw new WalletRequestError('Error getting wallet shielded addresses to use.');
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
    throw new WalletRequestError(`Error getting token ${tokenId} details.`);
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

  /**
   * Get the wallet balances with each amount split into its transparent and
   * shielded parts.
   */
  async getSplitBalances(
    wallet: HathorWalletServiceWallet,
    token: string | null = null
  ): Promise<SplitBalanceResponseData> {
    const data: { params: { token_id?: string; split: true } } = { params: { split: true } };
    if (token) {
      data.params.token_id = token;
    }
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/balances', data);
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, splitBalanceResponseSchema);
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
    options: GetTxOutputsOptions = {}
  ): Promise<TxOutputResponseData> {
    const data = { params: options };
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/tx_outputs', data);
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, txOutputResponseSchema);
    }
    throw new WalletRequestError('Error requesting utxo.', {
      cause: { status: response.status, data: response.data },
    });
  },

  async createTxProposal(
    wallet: HathorWalletServiceWallet,
    txHex: string
  ): Promise<TxProposalCreateResponseData> {
    const data = { txHex };
    const axios = await axiosInstance(wallet, true, SEND_TX_TIMEOUT);
    const response = await axios.post('tx/proposal', data);
    if (response.status === 201) {
      return parseSchema(response.data, txProposalCreateResponseSchema);
    }
    throw new WalletRequestError('Error creating tx proposal.', {
      cause: { status: response.status, data: response.data },
    });
  },

  async updateTxProposal(
    wallet: HathorWalletServiceWallet,
    id: string,
    txHex: string
  ): Promise<TxProposalUpdateResponseData> {
    const data = { txHex };
    const axios = await axiosInstance(wallet, true, SEND_TX_TIMEOUT);
    const response = await axios.put(`tx/proposal/${id}`, data);
    if (response.status === 200) {
      return parseSchema(response.data, txProposalUpdateResponseSchema);
    }
    throw new WalletRequestError('Error sending tx proposal.', {
      cause: { status: response.status, data: response.data },
    });
  },

  async deleteTxProposal(
    wallet: HathorWalletServiceWallet,
    id: string
  ): Promise<TxProposalDeleteResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.delete(`tx/proposal/${id}`);
    if (response.status === 200) {
      return parseSchema(response.data, txProposalDeleteResponseSchema);
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

    throw new WalletRequestError('Error requesting auth token.', {
      cause: { status: response.status, data: response.data },
    });
  },

  async createReadOnlyAuthToken(
    wallet: HathorWalletServiceWallet,
    xpubkey: string
  ): Promise<AuthTokenResponseData> {
    const data = {
      xpubkey,
    };
    const axios = await axiosInstance(wallet, false);
    const response = await axios.post('auth/token/readonly', data);
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, authTokenResponseSchema);
    }

    throw new WalletRequestError('Error requesting read-only auth token.', {
      cause: { status: response.status, data: response.data },
    });
  },

  async getTxById(
    wallet: HathorWalletServiceWallet,
    txId: string
  ): Promise<TxByIdTokensResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get(`wallet/transactions/${txId}`);

    // The service might answer a status code 200 but output an error message
    if (response.status === 200 && response.data) {
      if (!response.data.success) {
        walletApi._txNotFoundGuard(response.data);
        throw new WalletRequestError('Error getting transaction by its id.', {
          cause: { status: response.status, data: response.data },
        });
      }
      return parseSchema(response.data, txByIdResponseSchema);
    }

    // A serverless-offline instance may return a 404 with an error body. In those cases
    // we pass the response data to the guard for additional validations.
    if (response.status === 404 && response.data) {
      walletApi._txNotFoundGuard(response.data);
    }

    throw new WalletRequestError('Error getting transaction by its id.', {
      cause: { status: response.status, data: response.data },
    });
  },

  _txNotFoundGuard(data: unknown) {
    const message = get<unknown, string, string>(data, 'message', '');
    if (message === 'Transaction not found') {
      throw new TxNotFoundError();
    }

    const errorMessage = get<unknown, string, string>(data, 'error', '');
    if (errorMessage === 'tx-not-found') {
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
      cause: { status: response.status, data: response.data },
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
        cause: { status: response.status, data: response.data },
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
            cause: { status: response.status, data: response.data },
          }
        );
      }

      return response.data;
    }

    walletApi._txNotFoundGuard(response.data);

    throw new WalletRequestError(
      `Error getting neighbors data for ${txId} from the proxied fullnode.`,
      {
        cause: { status: response.status, data: response.data },
      }
    );
  },

  async getHasTxOutsideFirstAddress(
    wallet: HathorWalletServiceWallet
  ): Promise<HasTxOutsideFirstAddressResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.get('wallet/addresses/has-transactions-outside-first-address');
    if (response.status === 200 && response.data.success === true) {
      return parseSchema(response.data, hasTxOutsideFirstAddressResponseSchema);
    }
    throw new WalletRequestError(
      'Error checking if wallet has transactions outside first address.'
    );
  },
};

export default walletApi;
