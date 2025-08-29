/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MemoryStore } from '../../src/storage';
import { WalletServiceStorage } from '../../src/storage/wallet_service_memory_storage';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { IHistoryTx } from '../../src/types';
import { FullNodeTxResponse, GetAddressDetailsObject } from '../../src/wallet/types';

// Mock dependencies
jest.mock('../../src/wallet/wallet');
jest.mock('../../src/utils/transaction', () => ({
  getSignatureForTx: jest.fn().mockResolvedValue({ signatures: ['sig1', 'sig2'] }),
}));

describe('WalletServiceStorage', () => {
  let mockWallet: jest.Mocked<HathorWalletServiceWallet>;
  let memoryStore: MemoryStore;
  let walletServiceStorage: WalletServiceStorage;

  const mockAddressDetails: GetAddressDetailsObject = {
    address: 'HNXsVtRUmwDCtpcCJUrH4QiHo9kUKx199A',
    index: 0,
    transactions: 5,
    seqnum: 10,
  };

  const mockFullTxResponse: FullNodeTxResponse = {
    success: true,
    tx: {
      hash: 'tx-hash-123',
      nonce: '12345',
      timestamp: 1640995200,
      version: 1,
      weight: 100,
      signal_bits: 0,
      parents: ['parent1', 'parent2'],
      inputs: [
        {
          value: 1000n,
          token_data: 0,
          script: 'input-script',
          decoded: {
            type: 'P2PKH',
            address: 'input-address',
            timelock: null,
          },
          tx: 'input-tx-hash',
          index: 0,
        },
      ],
      outputs: [
        {
          value: 500n,
          token_data: 0,
          script: 'output-script',
          decoded: {
            type: 'P2PKH',
            address: 'output-address',
            timelock: null,
          },
        },
      ],
      tokens: [{ uid: 'token-id', name: 'TestToken', symbol: 'TST' }],
      token_name: 'TestToken',
      token_symbol: 'TST',
    },
    meta: {
      hash: 'tx-hash-123',
      spent_outputs: [],
      conflict: [],
      voided_by: [],
      received_by: [],
      children: [],
      twins: [],
      accumulated_weight: 100,
      score: 10,
      height: 1000,
      first_block: 'block-hash',
    },
  };

  beforeEach(() => {
    mockWallet = {
      getAddressDetails: jest.fn(),
      getFullTxById: jest.fn(),
      getCurrentAddress: jest.fn(),
      isAddressMine: jest.fn(),
      getUtxosForAmount: jest.fn(),
      getUtxos: jest.fn(),
    } as jest.Mocked<HathorWalletServiceWallet>;

    memoryStore = new MemoryStore();
    walletServiceStorage = new WalletServiceStorage(memoryStore, mockWallet);

    // Clear any selected UTXOs from previous tests
    walletServiceStorage.utxosSelectedAsInput.clear();
  });

  describe('getAddressInfo', () => {
    it('should return address info when address details exist', async () => {
      mockWallet.getAddressDetails.mockResolvedValue(mockAddressDetails);

      const result = await walletServiceStorage.getAddressInfo(
        'HNXsVtRUmwDCtpcCJUrH4QiHo9kUKx199A'
      );

      expect(result).toEqual({
        bip32AddressIndex: 0,
        base58: 'HNXsVtRUmwDCtpcCJUrH4QiHo9kUKx199A',
        seqnum: 10,
        numTransactions: 5,
        balance: new Map(),
      });
      expect(mockWallet.getAddressDetails).toHaveBeenCalledWith(
        'HNXsVtRUmwDCtpcCJUrH4QiHo9kUKx199A'
      );
    });

    it('should return null when address details do not exist', async () => {
      mockWallet.getAddressDetails.mockResolvedValue(null);

      const result = await walletServiceStorage.getAddressInfo('invalid-address');

      expect(result).toBeNull();
    });
  });

  describe('getTx', () => {
    it('should return converted transaction when found', async () => {
      mockWallet.getFullTxById.mockResolvedValue(mockFullTxResponse);

      const result = await walletServiceStorage.getTx('tx-hash-123');

      expect(result).toEqual({
        tx_id: 'tx-hash-123',
        signalBits: 0,
        version: 1,
        weight: 100,
        timestamp: 1640995200,
        is_voided: false,
        nonce: 12345,
        inputs: expect.any(Array),
        outputs: expect.any(Array),
        parents: ['parent1', 'parent2'],
        tokens: ['token-id'],
        height: 1000,
        first_block: 'block-hash',
        token_name: 'TestToken',
        token_symbol: 'TST',
      });
    });

    it('should return null when transaction not found', async () => {
      mockWallet.getFullTxById.mockRejectedValue(new Error('Not found'));

      const result = await walletServiceStorage.getTx('invalid-tx-hash');

      expect(result).toBeNull();
    });
  });

  describe('getCurrentAddress', () => {
    it('should return current address successfully', async () => {
      mockWallet.getCurrentAddress.mockResolvedValue({ address: 'HCurrentAddress123' });

      const result = await walletServiceStorage.getCurrentAddress(true);

      expect(result).toBe('HCurrentAddress123');
      expect(mockWallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });

    it('should throw error when current address is not loaded', async () => {
      mockWallet.getCurrentAddress.mockRejectedValue(new Error('API Error'));

      await expect(walletServiceStorage.getCurrentAddress()).rejects.toThrow(
        'Current address is not loaded'
      );
    });
  });

  describe('getChangeAddress', () => {
    it('should return provided change address when valid', async () => {
      mockWallet.isAddressMine.mockResolvedValue(true);

      const result = await walletServiceStorage.getChangeAddress({
        changeAddress: 'HChangeAddress123',
      });

      expect(result).toBe('HChangeAddress123');
      expect(mockWallet.isAddressMine).toHaveBeenCalledWith('HChangeAddress123');
    });

    it('should fallback to new address when provided address is not from wallet', async () => {
      mockWallet.isAddressMine.mockResolvedValue(false);
      mockWallet.getCurrentAddress.mockResolvedValue({ address: 'HFallbackAddress123' });

      const result = await walletServiceStorage.getChangeAddress({
        changeAddress: 'HForeignAddress123',
      });

      expect(result).toBe('HFallbackAddress123');
      expect(mockWallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });

    it('should get new address when no change address provided', async () => {
      mockWallet.getCurrentAddress.mockResolvedValue({ address: 'HNewAddress123' });

      const result = await walletServiceStorage.getChangeAddress();

      expect(result).toBe('HNewAddress123');
      expect(mockWallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });

    it('should get new address when change address is empty', async () => {
      mockWallet.getCurrentAddress.mockResolvedValue({ address: 'HNewAddress123' });

      const result = await walletServiceStorage.getChangeAddress({ changeAddress: '' });

      expect(result).toBe('HNewAddress123');
    });
  });

  describe('walletServiceUtxoSelection', () => {
    it('should return utxos using getUtxosForAmount', async () => {
      const mockUtxosResponse = {
        utxos: [
          {
            txId: 'utxo-tx-1',
            index: 0,
            tokenId: 'token-123',
            address: 'HUtxoAddress1',
            value: 1000n,
            authorities: 0n,
            timelock: null,
          },
        ],
      };
      mockWallet.getUtxosForAmount.mockResolvedValue(mockUtxosResponse);

      const result = await walletServiceStorage.walletServiceUtxoSelection(null, 'token-123', 500n);

      expect(result).toEqual({
        utxos: [
          {
            txId: 'utxo-tx-1',
            index: 0,
            token: 'token-123',
            address: 'HUtxoAddress1',
            value: 1000n,
            authorities: 0n,
            timelock: null,
            type: 1,
            height: null,
          },
        ],
        amount: 1000n,
        available: 1000n,
      });
    });

    it('should fallback to getUtxos when getUtxosForAmount fails', async () => {
      mockWallet.getUtxosForAmount.mockRejectedValue(new Error('Method not supported'));
      mockWallet.getUtxos.mockResolvedValue({
        utxos: [
          {
            tx_id: 'utxo-tx-2',
            index: 1,
            address: 'HUtxoAddress2',
            amount: 2000n,
          },
        ],
        total_amount_available: 2000n,
        total_utxos_available: 1,
        total_amount_locked: 0n,
        total_utxos_locked: 0,
      });

      const result = await walletServiceStorage.walletServiceUtxoSelection(
        null,
        'token-456',
        1500n
      );

      expect(result).toEqual({
        utxos: [
          {
            txId: 'utxo-tx-2',
            index: 1,
            token: 'token-456',
            address: 'HUtxoAddress2',
            value: 2000n,
            authorities: 0n,
            timelock: null,
            type: 1,
            height: null,
          },
        ],
        amount: 2000n,
        available: 2000n,
      });

      expect(mockWallet.getUtxos).toHaveBeenCalledWith({
        token: 'token-456',
        only_available_utxos: true,
        max_amount: 1500n,
      });
    });
  });

  describe('getTxSignatures', () => {
    it('should return transaction signatures', async () => {
      const mockTx = { hash: 'mock-tx' } as Parameters<
        typeof walletServiceStorage.getTxSignatures
      >[0];
      const pinCode = 'test-pin';
      const expectedSignatures = { signatures: ['sig1', 'sig2'] };

      const result = await walletServiceStorage.getTxSignatures(mockTx, pinCode);

      expect(result).toEqual(expectedSignatures);
    });
  });

  describe('selectUtxos', () => {
    it('should yield UTXOs with filter options', async () => {
      const mockUtxo1 = {
        txId: 'tx1',
        index: 0,
        token: 'token1',
        address: 'address1',
        value: 1000n,
        authorities: 0n,
        timelock: null,
        type: 1,
        height: 100,
      };

      const mockUtxo2 = {
        txId: 'tx2',
        index: 1,
        token: 'token1',
        address: 'address2',
        value: 2000n,
        authorities: 0n,
        timelock: null,
        type: 1,
        height: 200,
      };

      // Mock the store's selectUtxos method
      jest.spyOn(memoryStore, 'selectUtxos').mockImplementation(async function* () {
        yield mockUtxo1;
        yield mockUtxo2;
      });

      // Mock version data
      walletServiceStorage.version = { reward_spend_min_blocks: 10 };

      const utxos = [];
      for await (const utxo of walletServiceStorage.selectUtxos({ only_available_utxos: true })) {
        utxos.push(utxo);
      }

      expect(utxos).toHaveLength(2);
      expect(utxos[0]).toEqual(mockUtxo1);
      expect(utxos[1]).toEqual(mockUtxo2);
      expect(memoryStore.selectUtxos).toHaveBeenCalledWith({
        only_available_utxos: true,
        filter_method: expect.any(Function),
        reward_lock: 10,
      });
    });

    it('should filter out selected UTXOs when only_available_utxos is true', async () => {
      const mockUtxo = {
        txId: 'tx1',
        index: 0,
        token: 'token1',
        address: 'address1',
        value: 1000n,
        authorities: 0n,
        timelock: null,
        type: 1,
        height: 100,
      };

      // Mark UTXO as selected
      walletServiceStorage.utxosSelectedAsInput.set('tx1:0', true);

      // Mock the store to call the filter function
      jest.spyOn(memoryStore, 'selectUtxos').mockImplementation(async function* (options) {
        // Apply the filter if provided
        if (options.filter_method && !options.filter_method(mockUtxo)) {
          return; // Filter out the UTXO
        }
        yield mockUtxo;
      });

      const utxos = [];
      for await (const utxo of walletServiceStorage.selectUtxos({ only_available_utxos: true })) {
        utxos.push(utxo);
      }

      expect(utxos).toHaveLength(0); // Should be filtered out
    });

    it('should not filter selected UTXOs when only_available_utxos is false', async () => {
      const mockUtxo = {
        txId: 'tx1',
        index: 0,
        token: 'token1',
        address: 'address1',
        value: 1000n,
        authorities: 0n,
        timelock: null,
        type: 1,
        height: 100,
      };

      // Mark UTXO as selected
      walletServiceStorage.utxosSelectedAsInput.set('tx1:0', true);

      // Mock the store to call the filter function
      jest.spyOn(memoryStore, 'selectUtxos').mockImplementation(async function* (options) {
        // Apply the filter if provided
        if (options.filter_method && !options.filter_method(mockUtxo)) {
          return; // Filter out the UTXO
        }
        yield mockUtxo;
      });

      const utxos = [];
      for await (const utxo of walletServiceStorage.selectUtxos({ only_available_utxos: false })) {
        utxos.push(utxo);
      }

      expect(utxos).toHaveLength(1); // Should not be filtered out
      expect(utxos[0]).toEqual(mockUtxo);
    });
  });

  describe('getSpentTxs', () => {
    it('should yield transactions for each input with caching', async () => {
      const mockInputs = [
        { hash: 'tx1', index: 0 },
        { hash: 'tx2', index: 1 },
        { hash: 'tx1', index: 2 }, // Same hash to test caching
      ] as Parameters<typeof walletServiceStorage.getSpentTxs>[0];

      const mockTx1: IHistoryTx = { tx_id: 'tx1' } as IHistoryTx;
      const mockTx2: IHistoryTx = { tx_id: 'tx2' } as IHistoryTx;

      // Mock getTx method
      jest
        .spyOn(walletServiceStorage, 'getTx')
        .mockResolvedValueOnce(mockTx1)
        .mockResolvedValueOnce(mockTx2);

      const results = [];
      for await (const result of walletServiceStorage.getSpentTxs(mockInputs)) {
        results.push(result);
      }

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ tx: mockTx1, input: mockInputs[0], index: 0 });
      expect(results[1]).toEqual({ tx: mockTx2, input: mockInputs[1], index: 1 });
      expect(results[2]).toEqual({ tx: mockTx1, input: mockInputs[2], index: 2 }); // Cached

      // Verify getTx was called only twice due to caching
      expect(walletServiceStorage.getTx).toHaveBeenCalledTimes(2);
    });
  });
});
