/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import walletApi from '../../../src/wallet/api/walletApi';
import Network from '../../../src/models/network';
import HathorWalletServiceWallet from '../../../src/wallet/wallet';
import { ShieldedKeysConflictError, WalletRequestError } from '../../../src/errors';
import {
  buildShieldedAddressRow,
  buildShieldedNewAddressesResponse,
  buildShieldedTxOutputEntry,
  buildSplitBalanceResponse,
} from '../../__mock_helpers__/shielded-ws.fixtures';

const seed =
  'connect sunny silent cabin leopard start turtle tortoise dial timber woman genre pave tuna rice indicate gown draft palm collect retreat meadow assume spray';

const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
} as jest.Mocked<Pick<AxiosInstance, 'get' | 'post' | 'put' | 'delete'>>;

jest.mock('../../../src/wallet/api/walletServiceAxios', () => ({
  __esModule: true,
  axiosInstance: jest.fn().mockImplementation(() => Promise.resolve(mockAxiosInstance)),
}));

const statusBody = {
  success: true,
  status: {
    walletId: 'wallet1',
    xpubkey: 'xpub1',
    status: 'creating',
    maxGap: 20,
    createdAt: 1,
    readyAt: null,
    shieldedMaxGap: 20,
    lastUsedShieldedIndex: -1,
  },
};

const shielded = {
  scanXpriv: 'scan-xpriv',
  spendXpub: 'spend-xpub',
  firstCtAddress: 'first-ct-address',
  spendXpubSignature: 'spend-sig',
  ctAddressSignature: 'ct-sig',
};

describe('walletApi shielded support', () => {
  const wallet = new HathorWalletServiceWallet({
    requestPassword: jest.fn(),
    seed,
    network: new Network('testnet'),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createWallet = () =>
    walletApi.createWallet(
      wallet,
      'xpubkey',
      'xpubsig',
      'authxpub',
      'authxpubsig',
      100,
      'first-address',
      shielded
    );

  describe('createWallet', () => {
    it('sends the shielded registration fields', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: statusBody,
      } as AxiosResponse);
      const result = await createWallet();
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('wallet/init', {
        xpubkey: 'xpubkey',
        xpubkeySignature: 'xpubsig',
        authXpubkey: 'authxpub',
        authXpubkeySignature: 'authxpubsig',
        timestamp: 100,
        firstAddress: 'first-address',
        ...shielded,
      });
      expect(result.status.shieldedMaxGap).toBe(20);
    });

    it('sends no shielded fields when none are given', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: statusBody,
      } as AxiosResponse);
      await walletApi.createWallet(wallet, 'xpubkey', 'xpubsig', 'authxpub', 'authxpubsig', 100);
      const body = mockAxiosInstance.post.mock.calls[0][1] as Record<string, unknown>;
      expect(Object.keys(body)).not.toContain('scanXpriv');
      expect(Object.keys(body)).not.toContain('firstAddress');
    });

    it('maps a shielded keys conflict', async () => {
      const data = { success: false, error: 'shielded-keys-conflict' };
      mockAxiosInstance.post.mockResolvedValueOnce({ status: 409, data } as AxiosResponse);
      const err = await createWallet().catch(e => e);
      expect(err).toBeInstanceOf(ShieldedKeysConflictError);
      expect(err).toBeInstanceOf(WalletRequestError);
      expect(err.cause).toEqual({ status: 409, data });
    });

    it('surfaces the message of a registration proof failure', async () => {
      const data = { success: false, details: [{ message: 'spendXpub signature is not valid' }] };
      mockAxiosInstance.post.mockResolvedValueOnce({ status: 403, data } as AxiosResponse);
      const err = await createWallet().catch(e => e);
      expect(err).toBeInstanceOf(WalletRequestError);
      expect(err).not.toBeInstanceOf(ShieldedKeysConflictError);
      expect(err.message).toBe('spendXpub signature is not valid');
      expect(err.cause).toEqual({ status: 403, data });
    });

    it('explains when the server does not know the shielded fields', async () => {
      const data = {
        success: false,
        error: 'invalid-payload',
        details: [{ message: '"scanXpriv" is not allowed', path: ['scanXpriv'] }],
      };
      mockAxiosInstance.post.mockResolvedValueOnce({ status: 400, data } as AxiosResponse);
      const err = await createWallet().catch(e => e);
      expect(err).toBeInstanceOf(WalletRequestError);
      expect(err.message).toContain('does not support shielded registration');
      expect(err.message).toContain('"scanXpriv" is not allowed');
      expect(err.cause).toEqual({ status: 400, data });
    });

    it('keeps the generic error for other failures, with the response as cause', async () => {
      const data = { success: false, error: 'something-else' };
      mockAxiosInstance.post.mockResolvedValueOnce({ status: 500, data } as AxiosResponse);
      const err = await createWallet().catch(e => e);
      expect(err.message).toBe('Error creating wallet.');
      expect(err.cause).toEqual({ status: 500, data });
    });

    it('keeps the scan key out of a failed request error', async () => {
      const failure = new AxiosError(
        'timeout of 10000ms exceeded',
        AxiosError.ECONNABORTED,
        { data: JSON.stringify({ scanXpriv: shielded.scanXpriv }) } as never,
        { _header: 'POST /wallet/init', outputData: [shielded.scanXpriv] }
      );
      mockAxiosInstance.post.mockRejectedValueOnce(failure);
      const err = await createWallet().catch(e => e);
      // Still the axios error, so callers can tell a timeout apart
      expect(err).toBe(failure);
      expect(err.code).toBe(AxiosError.ECONNABORTED);
      expect(JSON.stringify(err.config ?? {})).not.toContain(shielded.scanXpriv);
      expect(err.request).toBeUndefined();
      expect(JSON.stringify(err.toJSON())).not.toContain(shielded.scanXpriv);
    });

    it('still accepts wallet-already-loaded', async () => {
      const data = { ...statusBody, success: false, error: 'wallet-already-loaded' };
      mockAxiosInstance.post.mockResolvedValueOnce({ status: 400, data } as AxiosResponse);
      await expect(createWallet()).resolves.toMatchObject({ status: { walletId: 'wallet1' } });
    });
  });

  describe('read parameters', () => {
    it('getShieldedAddresses asks for the shielded chain', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 200,
        data: { success: true, addresses: [buildShieldedAddressRow(0)] },
      } as AxiosResponse);
      const result = await walletApi.getShieldedAddresses(wallet);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('wallet/addresses?legacy=false');
      expect(result.addresses[0]).toMatchObject({ spendAddress: expect.any(String) });
    });

    it('getShieldedAddresses combines index and legacy', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 200,
        data: { success: true, addresses: [buildShieldedAddressRow(2)] },
      } as AxiosResponse);
      await walletApi.getShieldedAddresses(wallet, 2);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('wallet/addresses?index=2&legacy=false');
    });

    it('getAddresses keeps the legacy request unchanged', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 200,
        data: { success: true, addresses: [] },
      } as AxiosResponse);
      await walletApi.getAddresses(wallet, 3);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('wallet/addresses?index=3');
    });

    it('getShieldedNewAddresses asks for the shielded chain', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 200,
        data: buildShieldedNewAddressesResponse(),
      } as AxiosResponse);
      const result = await walletApi.getShieldedNewAddresses(wallet);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('wallet/addresses/new?legacy=false');
      expect(result.spendAddresses).toHaveLength(3);
      expect(result.legacyAddresses).toHaveLength(1);
    });

    it('getSplitBalances asks for the split balance', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 200,
        data: buildSplitBalanceResponse(),
      } as AxiosResponse);
      const result = await walletApi.getSplitBalances(wallet, '00');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('wallet/balances', {
        params: { token_id: '00', split: true },
      });
      expect(result.balances[0].balance.unlocked.total).toBe(3500n);
    });

    it('getTxOutputs passes kind', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 200,
        data: { success: true, txOutputs: [buildShieldedTxOutputEntry()] },
      } as AxiosResponse);
      const result = await walletApi.getTxOutputs(wallet, { tokenId: '00', kind: 'shielded' });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('wallet/tx_outputs', {
        params: { tokenId: '00', kind: 'shielded' },
      });
      expect(result.txOutputs[0].kind).toBe('shielded');
    });
  });

  describe('tx proposals', () => {
    it('keeps the response of a refused proposal as the cause', async () => {
      const data = { success: false, error: 'inputs-shielded-unsupported', shielded: [] };
      mockAxiosInstance.post.mockResolvedValueOnce({ status: 400, data } as AxiosResponse);
      const err = await walletApi.createTxProposal(wallet, '00').catch(e => e);
      expect(err).toBeInstanceOf(WalletRequestError);
      expect(err.cause).toEqual({ status: 400, data });

      mockAxiosInstance.put.mockResolvedValueOnce({ status: 400, data } as AxiosResponse);
      const updateErr = await walletApi.updateTxProposal(wallet, 'id', '00').catch(e => e);
      expect(updateErr.cause).toEqual({ status: 400, data });
    });
  });
});
