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
  // Valid change path xpub (depth 4) from wallet utils tests
  const xpub =
    'xpub6EvdxHF4vBs38uFrs6UuN8Zu78LDoqLrskMffXk531wy7xMFb7X9Ntxb9dGL2kbYdKJ1d83dqAifQS2Wzcq2DxJf7HPDPvMZMtNQxyBzAWn';
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

      // When wallet is ready, getReadOnlyAuthToken succeeds immediately
      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
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
      // Optimization: getWalletStatus should NOT be called when token succeeds
      expect(mockGetWalletStatus).not.toHaveBeenCalled();
    });

    it('should retry getReadOnlyAuthToken when wallet is still creating', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;
      const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

      // First two calls fail (wallet still creating), third succeeds
      mockCreateReadOnlyAuthToken
        .mockRejectedValueOnce(new WalletRequestError('Wallet not ready'))
        .mockRejectedValueOnce(new WalletRequestError('Wallet not ready'))
        .mockResolvedValueOnce({
          success: true,
          token: mockToken,
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

      // @ts-expect-error - Accessing private method for testing
      jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

      await wallet.startReadOnly();

      expect(wallet.isReady()).toBe(true);
      // No getWalletStatus calls — we retry the RO token endpoint directly
      expect(mockGetWalletStatus).not.toHaveBeenCalled();
      // Three attempts: 2 failures + 1 success
      expect(mockCreateReadOnlyAuthToken).toHaveBeenCalledTimes(3);
    });

    it('should time out if getReadOnlyAuthToken never succeeds', async () => {
      jest.useFakeTimers();

      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;

      // Always fail — simulates wallet stuck in error or creating state
      mockCreateReadOnlyAuthToken.mockRejectedValue(new WalletRequestError('Wallet not ready'));

      const promise = wallet.startReadOnly();
      // Catch the rejection early to prevent unhandled rejection during timer advancement
      const caught = promise.catch((err: Error) => err);

      // Advance through all 60 polling intervals
      for (let i = 0; i < 60; i++) {
        await jest.advanceTimersByTimeAsync(1000);
      }

      const error = await caught;
      expect(error).toBeInstanceOf(WalletRequestError);
      expect(error.message).toContain('Read-only wallet startup timed out');
      // Should never call getWalletStatus (no authenticated fallback)
      expect(mockGetWalletStatus).not.toHaveBeenCalled();

      jest.useRealTimers();
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

    describe('skipAddressFetch option', () => {
      it('should skip address fetching when skipAddressFetch is true', async () => {
        const wallet = new HathorWalletServiceWallet({
          requestPassword,
          xpub,
          network,
        });

        const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
        const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

        mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
          success: true,
          token: mockToken,
        });

        // Mock the connection setup
        // @ts-expect-error - Accessing private method for testing
        jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

        await wallet.startReadOnly({ skipAddressFetch: true });

        expect(wallet.isReady()).toBe(true);
        expect(mockGetNewAddresses).not.toHaveBeenCalled();
      });

      it('should fetch addresses when skipAddressFetch is false', async () => {
        const wallet = new HathorWalletServiceWallet({
          requestPassword,
          xpub,
          network,
        });

        const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
        const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

        mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
          success: true,
          token: mockToken,
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

        await wallet.startReadOnly({ skipAddressFetch: false });

        expect(wallet.isReady()).toBe(true);
        expect(mockGetNewAddresses).toHaveBeenCalled();
        expect(mockGetNewAddresses).toHaveBeenCalledTimes(1);
      });

      it('should fetch addresses by default when no options are provided', async () => {
        const wallet = new HathorWalletServiceWallet({
          requestPassword,
          xpub,
          network,
        });

        const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
        const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

        mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
          success: true,
          token: mockToken,
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
        expect(mockGetNewAddresses).toHaveBeenCalled();
        expect(mockGetNewAddresses).toHaveBeenCalledTimes(1);
      });

      it('should skip address fetching when skipAddressFetch is true with retries', async () => {
        const wallet = new HathorWalletServiceWallet({
          requestPassword,
          xpub,
          network,
        });

        const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
        const mockGetWalletStatus = walletApi.getWalletStatus as jest.Mock;
        const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

        mockCreateReadOnlyAuthToken.mockReset();

        // First call fails (wallet creating), second succeeds
        mockCreateReadOnlyAuthToken
          .mockRejectedValueOnce(new WalletRequestError('Wallet not ready'))
          .mockResolvedValueOnce({
            success: true,
            token: mockToken,
          });

        // @ts-expect-error - Accessing private method for testing
        jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

        await wallet.startReadOnly({ skipAddressFetch: true });

        expect(wallet.isReady()).toBe(true);
        // Retries go through getReadOnlyAuthToken, not getWalletStatus
        expect(mockGetWalletStatus).not.toHaveBeenCalled();
        expect(mockCreateReadOnlyAuthToken).toHaveBeenCalledTimes(2);
        // Addresses should not be fetched when skipAddressFetch is true
        expect(mockGetNewAddresses).not.toHaveBeenCalled();
      });

      it('should fetch addresses with retries when skipAddressFetch is false', async () => {
        const wallet = new HathorWalletServiceWallet({
          requestPassword,
          xpub,
          network,
        });

        const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
        const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

        // First call fails (wallet creating), second succeeds
        mockCreateReadOnlyAuthToken
          .mockRejectedValueOnce(new WalletRequestError('Wallet not ready'))
          .mockResolvedValueOnce({
            success: true,
            token: mockToken,
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

        // @ts-expect-error - Accessing private method for testing
        jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);

        await wallet.startReadOnly({ skipAddressFetch: false });

        expect(wallet.isReady()).toBe(true);
        // Addresses should be fetched even after retries
        expect(mockGetNewAddresses).toHaveBeenCalledTimes(1);
      });
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
      const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

      // Clear any previous mock implementations
      mockCreateReadOnlyAuthToken.mockReset();
      mockGetNewAddresses.mockReset();

      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
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

    it('should save accessData and enable storage-dependent methods', async () => {
      const wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpub,
        network,
      });

      const mockCreateReadOnlyAuthToken = walletApi.createReadOnlyAuthToken as jest.Mock;
      const mockGetNewAddresses = walletApi.getNewAddresses as jest.Mock;

      mockCreateReadOnlyAuthToken.mockResolvedValueOnce({
        success: true,
        token: mockToken,
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

      // Verify accessData was saved
      const accessData = await wallet.storage.getAccessData();
      expect(accessData).toBeDefined();
      expect(accessData?.xpubkey).toBe(xpub);
      expect(accessData?.walletType).toBe('p2pkh');
      expect(accessData?.walletFlags).toBe(0b00000001); // WALLET_FLAGS.READONLY

      // Verify storage-dependent methods work
      const walletType = await wallet.storage.getWalletType();
      expect(walletType).toBe('p2pkh');

      const isReadonly = await wallet.storage.isReadonly();
      expect(isReadonly).toBe(true);

      // Verify getAddressPathForIndex works (this was the original issue)
      const addressPath = await wallet.getAddressPathForIndex(0);
      expect(addressPath).toBe("m/44'/280'/0'/0/0");
    });
  });
});
