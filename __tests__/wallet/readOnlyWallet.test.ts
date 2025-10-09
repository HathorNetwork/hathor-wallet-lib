/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import walletApi from '../../src/wallet/api/walletApi';
import { WalletRequestError } from '../../src/errors';

// Mock walletApi methods
jest.mock('../../src/wallet/api/walletApi', () => ({
  __esModule: true,
  default: {
    createReadOnlyAuthToken: jest.fn(),
    getWalletStatus: jest.fn(),
    getNewAddresses: jest.fn(),
  },
}));

describe('Read-Only Wallet Access', () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const xpub =
    'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W8kWb3XNVy8HKXfXd8pKf3Xmb';
  const mockToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ3aWQiOiJ0ZXN0LXdhbGxldC1pZCIsImFjY2Vzc1R5cGUiOiJyZWFkLW9ubHkiLCJpYXQiOjE2OTY1ODg4MDAsImV4cCI6MTY5NjU5MDYwMH0.test';
  const mockWalletId = '23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getReadOnlyAuthToken', () => {
    it('should get read-only auth token with xpub', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
      });

      const token = await wallet.getReadOnlyAuthToken();

      expect(token).toBe(mockToken);
      expect(wallet.getAuthToken()).toBe(mockToken);
      expect(mockCreateReadOnlyAuthToken).toHaveBeenCalledWith(wallet, xpub);
      expect(wallet.walletId).toBeDefined();
    });

    it('should throw error if xpub is not set', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        seed: 'connect sunny silent cabin leopard start turtle tortoise dial timber woman genre pave tuna rice indicate gown draft palm collect retreat meadow assume spray',
        network,
      });

      // @ts-expect-error - Setting xpub to null to test error
      wallet.xpub = null;

      await expect(wallet.getReadOnlyAuthToken()).rejects.toThrow(
        'xpub is required to get read-only auth token.'
      );
    });

    it('should derive walletId from xpub if not set', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
      });

      expect(wallet.walletId).toBeNull();

      await wallet.getReadOnlyAuthToken();

      expect(wallet.walletId).toBeDefined();
      expect(wallet.walletId).toBe(HathorWalletServiceWallet.getWalletIdFromXPub(xpub));
    });
  });

  describe('startReadOnly', () => {
    it('should start wallet in read-only mode when wallet is ready', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;
      const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
      });

      mockGetWalletStatus.mockResolvedValueOnce({
        success: true,
        status: {
          walletId: mockWalletId,
          xpubkey: xpub,
          status: 'ready',
          maxGap: 20,
          createdAt: 123456789,
          readyAt: 123456790,
        },
      });

      mockGetNewAddresses.mockResolvedValueOnce({
        success: true,
        addresses: [
          {
            address: 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
            index: 0,
            addressPath: "m/44'/280'/0'/0/0",
          },
        ],
      });

      // Mock the connection setup
      // @ts-expect-error - Accessing private method for testing
      jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

      await wallet.startReadOnly();

      expect(wallet.isReady()).toBe(true);
      expect(wallet.walletId).toBe(HathorWalletServiceWallet.getWalletIdFromXPub(xpub));
      expect(mockCreateReadOnlyAuthToken).toHaveBeenCalledWith(wallet, xpub);
      expect(mockGetWalletStatus).toHaveBeenCalled();
    });

    it('should poll for wallet status when wallet is creating', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;
      const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
      });

      // First call returns 'creating' status
      mockGetWalletStatus.mockResolvedValueOnce({
        success: true,
        status: {
          walletId: mockWalletId,
          xpubkey: xpub,
          status: 'creating',
          maxGap: 20,
          createdAt: 123456789,
          readyAt: null,
        },
      });

      // Subsequent polling calls return 'ready' status
      mockGetWalletStatus.mockResolvedValue({
        success: true,
        status: {
          walletId: mockWalletId,
          xpubkey: xpub,
          status: 'ready',
          maxGap: 20,
          createdAt: 123456789,
          readyAt: 123456790,
        },
      });

      mockGetNewAddresses.mockResolvedValueOnce({
        success: true,
        addresses: [
          {
            address: 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
            index: 0,
            addressPath: "m/44'/280'/0'/0/0",
          },
        ],
      });

      // Mock the connection setup
      // @ts-expect-error - Accessing private method for testing
      jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

      await wallet.startReadOnly();

      expect(wallet.isReady()).toBe(true);
      // getWalletStatus should be called at least twice (initial + polling)
      expect(mockGetWalletStatus).toHaveBeenCalledTimes(2);
    });

    it('should throw error if wallet is not ready', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;

      // Mock both calls since startReadOnly will be called twice
      mockCreateReadOnlyAuthToken.mockResolvedValue({
        success: true,
        token: mockToken,
      });

      mockGetWalletStatus.mockResolvedValue({
        success: true,
        status: {
          walletId: mockWalletId,
          xpubkey: xpub,
          status: 'error',
          maxGap: 20,
          createdAt: 123456789,
          readyAt: null,
        },
      });

      await expect(wallet.startReadOnly()).rejects.toThrow(WalletRequestError);
      await expect(wallet.startReadOnly()).rejects.toThrow(
        'Wallet must be initialized and ready before starting in read-only mode.'
      );
    });

    it('should throw error if xpub is not set', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        seed: 'connect sunny silent cabin leopard start turtle tortoise dial timber woman genre pave tuna rice indicate gown draft palm collect retreat meadow assume spray',
        network,
      });

      // @ts-expect-error - Setting xpub to null to test error
      wallet.xpub = null;

      await expect(wallet.startReadOnly()).rejects.toThrow(
        'xpub is required to start wallet in read-only mode.'
      );
    });

    it('should set wallet to LOADING state during startup', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;
      const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

      // Track state changes
      const states: string[] = [];
      wallet.on('state', state => {
        states.push(state);
      });

      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
      });

      mockGetWalletStatus.mockResolvedValueOnce({
        success: true,
        status: {
          walletId: mockWalletId,
          xpubkey: xpub,
          status: 'ready',
          maxGap: 20,
          createdAt: 123456789,
          readyAt: 123456790,
        },
      });

      mockGetNewAddresses.mockResolvedValueOnce({
        success: true,
        addresses: [
          {
            address: 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
            index: 0,
            addressPath: "m/44'/280'/0'/0/0",
          },
        ],
      });

      // Mock the connection setup
      // @ts-expect-error - Accessing private method for testing
      jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

      await wallet.startReadOnly();

      expect(states).toContain('Loading');
      expect(states).toContain('Ready');
      expect(wallet.isReady()).toBe(true);
    });

    it('should call onWalletReady after successful startup', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;
      const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
      });

      mockGetWalletStatus.mockResolvedValueOnce({
        success: true,
        status: {
          walletId: mockWalletId,
          xpubkey: xpub,
          status: 'ready',
          maxGap: 20,
          createdAt: 123456789,
          readyAt: 123456790,
        },
      });

      mockGetNewAddresses.mockResolvedValueOnce({
        success: true,
        addresses: [
          {
            address: 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
            index: 0,
            addressPath: "m/44'/280'/0'/0/0",
          },
        ],
      });

      // Mock the connection setup
      // @ts-expect-error - Accessing private method for testing
      jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

      // @ts-expect-error - Accessing private method for testing
      const onWalletReadySpy = jest.spyOn(wallet, 'onWalletReady');

      await wallet.startReadOnly();

      expect(onWalletReadySpy).toHaveBeenCalled();
      expect(wallet.isReady()).toBe(true);
    });
  });

  describe('Integration with IHathorWallet interface', () => {
    it('should allow read operations after startReadOnly', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;
      const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
      });

      mockGetWalletStatus.mockResolvedValueOnce({
        success: true,
        status: {
          walletId: mockWalletId,
          xpubkey: xpub,
          status: 'ready',
          maxGap: 20,
          createdAt: 123456789,
          readyAt: 123456790,
        },
      });

      mockGetNewAddresses.mockResolvedValueOnce({
        success: true,
        addresses: [
          {
            address: 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
            index: 0,
            addressPath: "m/44'/280'/0'/0/0",
          },
        ],
      });

      // Mock the connection setup
      // @ts-expect-error - Accessing private method for testing
      jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

      await wallet.startReadOnly();

      // Wallet should be ready for read operations
      expect(wallet.isReady()).toBe(true);
      expect(() => wallet.failIfWalletNotReady()).not.toThrow();
    });
  });
});
