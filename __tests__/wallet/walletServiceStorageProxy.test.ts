/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Mock the transaction utils before importing
import { WalletServiceStorageProxy } from '../../src/wallet/walletServiceStorageProxy';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import { IStorage } from '../../src/types';
import Transaction from '../../src/models/transaction';
import Input from '../../src/models/input';
import transactionUtils from '../../src/utils/transaction';
import tokensUtils from '../../src/utils/tokens';
import { AddressInfoObject } from '../../src/wallet/types';
import { TOKEN_MELT_MASK } from '../../src/constants';

jest.mock('../../src/utils/transaction', () => ({
  getSignatureForTx: jest.fn(),
}));

jest.mock('../../src/utils/tokens', () => ({
  prepareMintTxData: jest.fn(),
}));

describe('WalletServiceStorageProxy', () => {
  let wallet: HathorWalletServiceWallet;
  let mockStorage: jest.Mocked<IStorage>;
  let storageProxy: WalletServiceStorageProxy;
  let proxiedStorage: IStorage;

  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn(),
      seed,
      network: new Network('testnet'),
    });

    // Mock the storage methods we need
    mockStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      cleanStorage: jest.fn(),
      getAccessData: jest.fn(),
      saveAccessData: jest.fn(),
      saveAddress: jest.fn(),
      getAddress: jest.fn(),
      existsAddress: jest.fn(),
      isAddressMine: jest.fn(),
      getWalletData: jest.fn(),
      saveWalletData: jest.fn(),
      saveTransaction: jest.fn(),
      getTransaction: jest.fn(),
      addToAddressUtxoTable: jest.fn(),
      removeFromAddressUtxoTable: jest.fn(),
      getAddressUtxo: jest.fn(),
      getUtxos: jest.fn(),
      selectUtxos: jest.fn(),
      getLockedUtxos: jest.fn(),
      lockUtxo: jest.fn(),
      unlockUtxo: jest.fn(),
      unlockUtxos: jest.fn(),
      isUtxoLocked: jest.fn(),
      addToUtxoTable: jest.fn(),
      removeFromUtxoTable: jest.fn(),
      updateTxOutputSpentBy: jest.fn(),
      getTxOutput: jest.fn(),
      getAllTransactions: jest.fn(),
      getTransactionHistory: jest.fn(),
      saveTokenInfo: jest.fn(),
      getTokenInfo: jest.fn(),
      registerToken: jest.fn(),
      unregisterToken: jest.fn(),
      isTokenRegistered: jest.fn(),
      getRegisteredTokens: jest.fn(),
      addNewAddresses: jest.fn(),
      getCurrentAddress: jest.fn(),
      canGenerateAddresses: jest.fn(),
      getAllAddresses: jest.fn(),
      getNextAddress: jest.fn(),
      getAddressList: jest.fn(),
      getAddressAtIndex: jest.fn(),
      generateAddresses: jest.fn(),
      iterateOverTransactions: jest.fn(),
      getTxBalance: jest.fn(),
      updateToken: jest.fn(),
      getTxSignatures: jest.fn(),
      getAddressInfo: jest.fn(),
      getTx: jest.fn(),
      getSpentTxs: jest.fn(),
      config: {
        getServerUrl: jest.fn(),
        setServerUrl: jest.fn(),
        getWsServerUrl: jest.fn(),
        setWsServerUrl: jest.fn(),
        getExplorerUrl: jest.fn(),
        setExplorerUrl: jest.fn(),
        getTokenDepositPercentage: jest.fn(),
        setTokenDepositPercentage: jest.fn(),
        getNetwork: jest.fn(),
        setNetwork: jest.fn(),
        isReadonly: jest.fn(),
      },
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    } as unknown as jest.Mocked<IStorage>;

    storageProxy = new WalletServiceStorageProxy(wallet, mockStorage);
    proxiedStorage = storageProxy.createProxy();

    // Mock wallet methods
    wallet.getAddressDetails = jest.fn();
    wallet.getFullTxById = jest.fn();
    wallet.getCurrentAddress = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createProxy', () => {
    it('should create a proxy that intercepts specific methods', () => {
      expect(proxiedStorage).toBeDefined();
      expect(typeof proxiedStorage.getAddressInfo).toBe('function');
      expect(typeof proxiedStorage.getTx).toBe('function');
      expect(typeof proxiedStorage.getSpentTxs).toBe('function');
      expect(typeof proxiedStorage.getCurrentAddress).toBe('function');
      expect(typeof proxiedStorage.getTxSignatures).toBe('function');
    });

    it('should preserve original storage methods', () => {
      mockStorage.getItem.mockReturnValue('test-value');

      expect(proxiedStorage.getItem('test-key')).toBe('test-value');
      expect(mockStorage.getItem).toHaveBeenCalledWith('test-key');
    });

    it('should bind original methods to maintain correct context', () => {
      const testFunction = jest.fn().mockReturnValue('bound-result');
      mockStorage.getTokenInfo = testFunction;

      const result = proxiedStorage.getTokenInfo('test-token');

      expect(result).toBe('bound-result');
      expect(testFunction).toHaveBeenCalledWith('test-token');
    });
  });

  describe('getAddressInfo', () => {
    it('should return address info when address details are found', async () => {
      const mockAddressDetails = {
        success: true,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        index: 5,
        transactions: 10,
        seqnum: 15,
      };

      (wallet.getAddressDetails as jest.Mock).mockResolvedValue(mockAddressDetails);

      const result = await proxiedStorage.getAddressInfo('WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx');

      expect(result).toEqual({
        bip32AddressIndex: 5,
        base58: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        seqnum: 15,
        numTransactions: 10,
        balance: new Map(),
      });
      expect(wallet.getAddressDetails).toHaveBeenCalledWith('WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx');
    });

    it('should return null when address details are not found', async () => {
      (wallet.getAddressDetails as jest.Mock).mockResolvedValue(null);

      const result = await proxiedStorage.getAddressInfo('non-existent-address');

      expect(result).toBeNull();
    });

    it('should handle errors from getAddressDetails', async () => {
      (wallet.getAddressDetails as jest.Mock).mockRejectedValue(new Error('Address not found'));

      await expect(proxiedStorage.getAddressInfo('invalid-address')).rejects.toThrow(
        'Address not found'
      );
    });
  });

  describe('getTx', () => {
    const mockFullTxResponse = {
      success: true,
      tx: {
        hash: 'tx123',
        version: 1,
        weight: 10.5,
        timestamp: 1234567890,
        nonce: '42',
        inputs: [
          {
            tx_id: 'input-tx',
            index: 0,
            decoded: {
              type: 'P2PKH',
              address: 'WAddress1',
              timelock: null,
            },
          },
        ],
        outputs: [
          {
            value: 100,
            token_data: 0,
            decoded: {
              type: 'P2PKH',
              address: 'WAddress2',
              timelock: null,
            },
          },
        ],
        parents: ['parent1', 'parent2'],
        tokens: [{ uid: 'token1' }],
        token_name: 'TestToken',
        token_symbol: 'TT',
      },
      meta: {
        height: 1000,
        first_block: 'block1',
        voided_by: [],
      },
    };

    it('should fetch and convert transaction successfully', async () => {
      (wallet.getFullTxById as jest.Mock).mockResolvedValue(mockFullTxResponse);

      const result = await proxiedStorage.getTx('tx123');

      expect(result).toEqual({
        tx_id: 'tx123',
        signalBits: 0,
        version: 1,
        weight: 10.5,
        timestamp: 1234567890,
        is_voided: false,
        nonce: 42,
        inputs: [
          {
            tx_id: 'input-tx',
            index: 0,
            decoded: {
              type: 'P2PKH',
              address: 'WAddress1',
              timelock: null,
            },
          },
        ],
        outputs: [
          {
            value: 100,
            token_data: 0,
            decoded: {
              type: 'P2PKH',
              address: 'WAddress2',
              timelock: null,
            },
          },
        ],
        parents: ['parent1', 'parent2'],
        tokens: ['token1'],
        height: 1000,
        first_block: 'block1',
        token_name: 'TestToken',
        token_symbol: 'TT',
      });
      expect(wallet.getFullTxById).toHaveBeenCalledWith('tx123');
    });

    it('should return null when transaction fetch fails', async () => {
      (wallet.getFullTxById as jest.Mock).mockRejectedValue(new Error('Transaction not found'));

      const result = await proxiedStorage.getTx('non-existent-tx');

      expect(result).toBeNull();
    });

    it('should handle voided transactions', async () => {
      const voidedTxResponse = {
        ...mockFullTxResponse,
        meta: {
          ...mockFullTxResponse.meta,
          voided_by: ['void-tx-1', 'void-tx-2'],
        },
      };

      (wallet.getFullTxById as jest.Mock).mockResolvedValue(voidedTxResponse);

      const result = await proxiedStorage.getTx('voided-tx');

      expect(result?.is_voided).toBe(true);
    });

    it('should handle transactions without optional fields', async () => {
      const minimalTxResponse = {
        success: true,
        tx: {
          hash: 'minimal-tx',
          version: 1,
          weight: 5.0,
          timestamp: 1000000,
          inputs: [],
          outputs: [],
          parents: [],
          tokens: [],
        },
        meta: {
          height: 500,
          first_block: 'first',
          voided_by: [],
        },
      };

      (wallet.getFullTxById as jest.Mock).mockResolvedValue(minimalTxResponse);

      const result = await proxiedStorage.getTx('minimal-tx');

      expect(result).toEqual({
        tx_id: 'minimal-tx',
        signalBits: 0,
        version: 1,
        weight: 5.0,
        timestamp: 1000000,
        is_voided: false,
        nonce: 0,
        inputs: [],
        outputs: [],
        parents: [],
        tokens: [],
        height: 500,
        first_block: 'first',
        token_name: undefined,
        token_symbol: undefined,
      });
    });
  });

  describe('getSpentTxs', () => {
    const mockInputs = [
      new Input('tx1', 0),
      new Input('tx2', 1),
      new Input('tx1', 2), // Same tx as first input
    ];

    it('should yield transaction data for each input', async () => {
      const mockTx1Response = {
        success: true,
        tx: {
          hash: 'tx1',
          version: 1,
          weight: 5.0,
          timestamp: 1000000,
          inputs: [],
          outputs: [],
          parents: [],
          tokens: [],
        },
        meta: {
          height: 500,
          first_block: 'first',
          voided_by: [],
        },
      };

      const mockTx2Response = {
        success: true,
        tx: {
          hash: 'tx2',
          version: 1,
          weight: 5.0,
          timestamp: 2000000,
          inputs: [],
          outputs: [],
          parents: [],
          tokens: [],
        },
        meta: {
          height: 600,
          first_block: 'second',
          voided_by: [],
        },
      };

      (wallet.getFullTxById as jest.Mock)
        .mockResolvedValueOnce(mockTx1Response)
        .mockResolvedValueOnce(mockTx2Response);

      // Convert to async generator result array
      const results = [];
      for await (const item of proxiedStorage.getSpentTxs(mockInputs)) {
        results.push(item);
      }

      expect(results).toHaveLength(3);
      expect(results[0].input).toBe(mockInputs[0]);
      expect(results[0].index).toBe(0);
      expect(results[0].tx).toBeDefined();
      expect(results[0].tx.tx_id).toBe('tx1');
      expect(results[1].input).toBe(mockInputs[1]);
      expect(results[1].index).toBe(1);
      expect(results[1].tx.tx_id).toBe('tx2');
      expect(results[2].input).toBe(mockInputs[2]);
      expect(results[2].index).toBe(2);
      expect(results[2].tx.tx_id).toBe('tx1'); // Should use cached tx1
    });

    it('should cache transactions to avoid duplicate fetches', async () => {
      const mockTx1Response = {
        success: true,
        tx: {
          hash: 'tx1',
          version: 1,
          weight: 5.0,
          timestamp: 1000000,
          inputs: [],
          outputs: [],
          parents: [],
          tokens: [],
        },
        meta: {
          height: 500,
          first_block: 'first',
          voided_by: [],
        },
      };

      const mockTx2Response = {
        success: true,
        tx: {
          hash: 'tx2',
          version: 1,
          weight: 5.0,
          timestamp: 2000000,
          inputs: [],
          outputs: [],
          parents: [],
          tokens: [],
        },
        meta: {
          height: 600,
          first_block: 'second',
          voided_by: [],
        },
      };

      (wallet.getFullTxById as jest.Mock)
        .mockResolvedValueOnce(mockTx1Response)
        .mockResolvedValueOnce(mockTx2Response);

      const results = [];
      for await (const item of proxiedStorage.getSpentTxs(mockInputs)) {
        results.push(item);
      }

      // Should only call getFullTxById twice (once for each unique tx)
      expect(wallet.getFullTxById).toHaveBeenCalledTimes(2);
      expect(wallet.getFullTxById).toHaveBeenCalledWith('tx1');
      expect(wallet.getFullTxById).toHaveBeenCalledWith('tx2');
      expect(results).toHaveLength(3);
    });

    it('should skip inputs when transaction fetch fails', async () => {
      const mockTx1Response = {
        success: true,
        tx: {
          hash: 'tx1',
          version: 1,
          weight: 5.0,
          timestamp: 1000000,
          inputs: [],
          outputs: [],
          parents: [],
          tokens: [],
        },
        meta: {
          height: 500,
          first_block: 'first',
          voided_by: [],
        },
      };

      (wallet.getFullTxById as jest.Mock)
        .mockResolvedValueOnce(mockTx1Response)
        .mockRejectedValueOnce(new Error('Transaction not found'));

      const results = [];
      for await (const item of proxiedStorage.getSpentTxs(mockInputs.slice(0, 2))) {
        results.push(item);
      }

      // Should only yield the first input since second tx fetch failed
      expect(results).toHaveLength(1);
      expect(results[0].input).toBe(mockInputs[0]);
      expect(results[0].tx.tx_id).toBe('tx1');
    });
  });

  describe('getCurrentAddress', () => {
    it('should return current address successfully', async () => {
      const mockAddressInfo: AddressInfoObject = {
        address: 'WCurrentAddress123',
        index: 10,
        addressPath: "m/44'/280'/0'/1/0",
        info: '',
      };

      (wallet.getCurrentAddress as jest.Mock).mockResolvedValue(mockAddressInfo);

      const result = await proxiedStorage.getCurrentAddress();

      expect(result).toBe('WCurrentAddress123');
      expect(wallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: undefined });
    });

    it('should pass markAsUsed parameter correctly', async () => {
      const mockAddressInfo: AddressInfoObject = {
        address: 'WCurrentAddress123',
        index: 10,
        addressPath: "m/44'/280'/0'/1/0",
        info: '',
      };

      (wallet.getCurrentAddress as jest.Mock).mockResolvedValue(mockAddressInfo);

      const result = await proxiedStorage.getCurrentAddress(true);

      expect(result).toBe('WCurrentAddress123');
      expect(wallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });

    it('should handle errors from getCurrentAddress', async () => {
      (wallet.getCurrentAddress as jest.Mock).mockRejectedValue(
        new Error('Address loading failed')
      );

      await expect(proxiedStorage.getCurrentAddress()).rejects.toThrow(
        'Current address is not loaded'
      );
    });
  });

  describe('getTxSignatures', () => {
    it('should delegate to transaction utils', async () => {
      const mockTransaction = new Transaction([], []);
      const mockSignatures = ['signature1', 'signature2'];

      (transactionUtils.getSignatureForTx as jest.Mock).mockResolvedValue(mockSignatures);

      const result = await proxiedStorage.getTxSignatures(mockTransaction, 'pin123');

      expect(result).toBe(mockSignatures);
      expect(transactionUtils.getSignatureForTx).toHaveBeenCalledWith(
        mockTransaction,
        proxiedStorage,
        'pin123'
      );
    });
  });

  describe('getUtxoSelectionAlgorithm', () => {
    it('should return bound walletServiceUtxoSelection function', () => {
      const algorithm = storageProxy.getUtxoSelectionAlgorithm();

      expect(typeof algorithm).toBe('function');
      expect(algorithm.name).toBe('bound walletServiceUtxoSelection');
    });
  });

  describe('prepareCreateTokenData', () => {
    beforeEach(() => {
      (tokensUtils.prepareMintTxData as jest.Mock).mockResolvedValue({
        inputs: [],
        outputs: [{ type: 'mint', address: 'WMintAddr', value: 1000, authorities: 1n }],
        tokens: ['token123'],
        version: 2,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(wallet, 'getCurrentAddress').mockResolvedValue({ address: 'WCurrentAddr' } as any);
    });

    it('should prepare create token data with default options', async () => {
      const result = await storageProxy.prepareCreateTokenData(
        'WAddress123',
        'Test Token',
        'TEST',
        1000n,
        proxiedStorage
      );

      expect(result.name).toBe('Test Token');
      expect(result.symbol).toBe('TEST');
      expect(result.version).toBe(2);
      expect(tokensUtils.prepareMintTxData).toHaveBeenCalledWith(
        'WAddress123',
        1000n,
        proxiedStorage,
        expect.objectContaining({
          createAnotherMint: true,
          skipDepositFee: false,
          utxoSelection: expect.any(Function),
        })
      );
    });

    it('should add melt authority output when createMelt is true', async () => {
      const result = await storageProxy.prepareCreateTokenData(
        'WAddress123',
        'Test Token',
        'TEST',
        1000n,
        proxiedStorage,
        {
          createMelt: true,
          meltAuthorityAddress: 'WMeltAddr',
        }
      );

      expect(result.outputs).toContainEqual({
        type: 'melt',
        address: 'WMeltAddr',
        value: TOKEN_MELT_MASK,
        timelock: null,
        authorities: 2n,
      });
    });

    it('should use current address for melt authority when no address provided', async () => {
      await storageProxy.prepareCreateTokenData(
        'WAddress123',
        'Test Token',
        'TEST',
        1000n,
        proxiedStorage,
        { createMelt: true }
      );

      expect(wallet.getCurrentAddress).toHaveBeenCalled();
    });

    it('should skip melt authority when createMelt is false', async () => {
      const result = await storageProxy.prepareCreateTokenData(
        'WAddress123',
        'Test Token',
        'TEST',
        1000n,
        proxiedStorage,
        { createMelt: false }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(result.outputs.filter((o: any) => o.type === 'melt')).toHaveLength(0);
    });

    it('should handle data placement correctly for NFTs', async () => {
      (tokensUtils.prepareMintTxData as jest.Mock).mockResolvedValue({
        inputs: [],
        outputs: [
          { type: 'mint', address: 'WMintAddr', value: 1000, authorities: 1n },
          { type: 'data', value: 'data1' },
          { type: 'data', value: 'data2' },
        ],
        tokens: ['token123'],
        version: 2,
      });

      const result = await storageProxy.prepareCreateTokenData(
        'WAddress123',
        'NFT Token',
        'NFT',
        1n,
        proxiedStorage,
        {
          data: ['data1', 'data2'],
          isCreateNFT: true,
          createMelt: true,
          meltAuthorityAddress: 'WMeltAddr',
        }
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meltIndex = result.outputs.findIndex((o: any) => o.type === 'melt');
      expect(meltIndex).toBeGreaterThan(-1);
    });

    it('should pass custom options correctly', async () => {
      await storageProxy.prepareCreateTokenData(
        'WAddress123',
        'Test Token',
        'TEST',
        1000n,
        proxiedStorage,
        {
          changeAddress: 'WChangeAddr',
          createMint: false,
          mintAuthorityAddress: 'WMintAuth',
          skipDepositFee: true,
          data: ['custom-data'],
          isCreateNFT: true,
        }
      );

      expect(tokensUtils.prepareMintTxData).toHaveBeenCalledWith(
        'WAddress123',
        1000n,
        proxiedStorage,
        expect.objectContaining({
          createAnotherMint: false,
          mintAuthorityAddress: 'WMintAuth',
          changeAddress: 'WChangeAddr',
          skipDepositFee: true,
          data: ['custom-data'],
          unshiftData: true,
          utxoSelection: expect.any(Function),
        })
      );
    });
  });

  describe('getChangeAddress', () => {
    beforeEach(() => {
      jest.spyOn(wallet, 'isAddressMine').mockResolvedValue(true);
      jest.spyOn(wallet, 'getCurrentAddress').mockResolvedValue({ address: 'WNewChangeAddr' });
    });

    it('should use provided change address when valid', async () => {
      const result = await storageProxy.getChangeAddress({ changeAddress: 'WProvidedAddr' });

      expect(result).toBe('WProvidedAddr');
      expect(wallet.isAddressMine).toHaveBeenCalledWith('WProvidedAddr');
    });

    it('should get new address when no change address provided', async () => {
      const result = await storageProxy.getChangeAddress();

      expect(result).toBe('WNewChangeAddr');
      expect(wallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });

    it('should get new address when change address is empty', async () => {
      const result = await storageProxy.getChangeAddress({ changeAddress: '' });

      expect(result).toBe('WNewChangeAddr');
      expect(wallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });

    it('should get new address when change address is null', async () => {
      const result = await storageProxy.getChangeAddress({ changeAddress: null });

      expect(result).toBe('WNewChangeAddr');
      expect(wallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });

    it('should fallback to new address when isAddressMine fails', async () => {
      (wallet.isAddressMine as jest.Mock).mockRejectedValue(new Error('Address check failed'));

      const result = await storageProxy.getChangeAddress({ changeAddress: 'WProvidedAddr' });

      expect(result).toBe('WNewChangeAddr');
      expect(wallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });

    it('should fallback to new address when change address is not mine', async () => {
      jest.spyOn(wallet, 'isAddressMine').mockResolvedValue(false);

      const result = await storageProxy.getChangeAddress({ changeAddress: 'WNotMineAddr' });

      expect(result).toBe('WNewChangeAddr');
      expect(wallet.getCurrentAddress).toHaveBeenCalledWith({ markAsUsed: true });
    });
  });

  describe('walletServiceUtxoSelection', () => {
    beforeEach(() => {
      jest.spyOn(wallet, 'getUtxosForAmount').mockResolvedValue({
        utxos: [
          {
            txId: 'utxo1',
            index: 0,
            tokenId: '00',
            address: 'WAddr1',
            value: 500n,
            authorities: 0,
            timelock: null,
          },
          {
            txId: 'utxo2',
            index: 1,
            tokenId: '00',
            address: 'WAddr2',
            value: 600n,
            authorities: 0,
            timelock: 1234567890,
          },
        ],
      });
    });

    it('should select UTXOs for native token', async () => {
      const result = await storageProxy.walletServiceUtxoSelection(proxiedStorage, '00', 1000n);

      expect(wallet.getUtxosForAmount).toHaveBeenCalledWith(1000n, { tokenId: '00' });
      expect(result.utxos).toHaveLength(2);
      expect(result.amount).toBe(1100n);
      expect(result.available).toBe(1100n);
    });

    it('should convert wallet service UTXOs to IUtxo format', async () => {
      const result = await storageProxy.walletServiceUtxoSelection(
        proxiedStorage,
        'custom-token',
        500n
      );

      expect(result.utxos[0]).toEqual({
        txId: 'utxo1',
        index: 0,
        token: '00',
        address: 'WAddr1',
        value: 500n,
        authorities: 0,
        timelock: null,
        type: 1,
        height: null,
      });

      expect(result.utxos[1]).toEqual({
        txId: 'utxo2',
        index: 1,
        token: '00',
        address: 'WAddr2',
        value: 600n,
        authorities: 0,
        timelock: 1234567890,
        type: 1,
        height: null,
      });
    });

    it('should calculate total amount correctly', async () => {
      const result = await storageProxy.walletServiceUtxoSelection(proxiedStorage, '00', 1000n);

      expect(result.amount).toBe(1100n);
      expect(result.available).toBe(1100n);
    });

    it('should handle custom token selection', async () => {
      await storageProxy.walletServiceUtxoSelection(proxiedStorage, 'custom-token-uid', 500n);

      expect(wallet.getUtxosForAmount).toHaveBeenCalledWith(500n, { tokenId: 'custom-token-uid' });
    });
  });
});
