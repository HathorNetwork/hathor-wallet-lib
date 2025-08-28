/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { WalletServiceNanoContractBuilder } from '../../src/wallet/walletServiceNanoContractBuilder';
import { WalletServiceStorageProxy } from '../../src/wallet/walletServiceStorageProxy';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { MemoryStore, Storage } from '../../src/storage';
import Network from '../../src/models/network';
import { defaultWalletSeed } from '../__mock_helpers__/wallet-service.fixtures';

import transactionUtils from '../../src/utils/transaction';

// Mock the tokensUtils to avoid circular imports
jest.mock('../../src/utils/tokens', () => ({
  prepareMintTxData: jest.fn(),
}));

// Mock transactionUtils
jest.mock('../../src/utils/transaction', () => ({
  createTransactionFromData: jest.fn(),
}));

describe('WalletServiceNanoContractBuilder', () => {
  let builder: WalletServiceNanoContractBuilder;
  let wallet: HathorWalletServiceWallet;
  let storage: Storage;
  let network: Network;

  beforeEach(() => {
    network = new Network('testnet');
    const store = new MemoryStore();
    storage = new Storage(store);

    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn(),
      seed: defaultWalletSeed,
      network,
      passphrase: '',
      storage,
    });

    builder = new WalletServiceNanoContractBuilder();
    builder.wallet = wallet;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('build', () => {
    it('should throw error when wallet is not set', async () => {
      builder.wallet = null;

      await expect(builder.build()).rejects.toThrow(
        'Wallet must be set before building transaction'
      );
    });

    it('should create storage proxy when building', async () => {
      jest.spyOn(builder, 'buildInputsOutputs').mockResolvedValue({
        inputs: [],
        outputs: [],
        tokens: [],
      });

      const mockTxData = {
        inputs: [],
        outputs: [],
        tokens: [],
        version: 2,
        name: 'Test Token',
        symbol: 'TEST',
      };

      jest
        .spyOn(WalletServiceStorageProxy.prototype, 'prepareCreateTokenData')
        .mockResolvedValue(mockTxData);

      const mockTransaction = { hash: 'mock-tx-hash' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transactionUtils.createTransactionFromData as jest.Mock).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockTransaction as any
      );

      builder.createTokenOptions = {
        mintAddress: 'WAddress123',
        name: 'Test Token',
        symbol: 'TEST',
        amount: 1000n,
        changeAddress: null,
        createMint: true,
        mintAuthorityAddress: null,
        createMelt: true,
        meltAuthorityAddress: null,
        data: null,
        isCreateNFT: false,
        contractPaysTokenDeposit: false,
      };

      const result = await builder.build();

      expect(result).toBe(mockTransaction);
    });

    it('should call super.build() when no token creation options', async () => {
      const superBuildSpy = jest.spyOn(
        Object.getPrototypeOf(WalletServiceNanoContractBuilder.prototype),
        'build'
      );
      const mockTransaction = { hash: 'mock-tx-hash' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      superBuildSpy.mockResolvedValue(mockTransaction as any);

      builder.createTokenOptions = null;

      const result = await builder.build();

      expect(superBuildSpy).toHaveBeenCalled();
      expect(result).toBe(mockTransaction);
    });
  });

  describe('buildTokenCreationWithWalletService', () => {
    it('should build token creation transaction', async () => {
      const mockInputsOutputsTokens = {
        inputs: [{ hash: 'input1', index: 0 }],
        outputs: [{ address: 'WAddr1', value: 100 }],
        tokens: ['token1'],
      };

      jest.spyOn(builder, 'buildInputsOutputs').mockResolvedValue(mockInputsOutputsTokens);

      const mockTransaction = { hash: 'mock-tx-hash' };
      jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(builder as any, 'buildTransactionWithWalletService')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue(mockTransaction);

      builder.createTokenOptions = {
        mintAddress: 'WAddress123',
        name: 'Test Token',
        symbol: 'TEST',
        amount: 1000n,
        changeAddress: null,
        createMint: true,
        mintAuthorityAddress: null,
        createMelt: true,
        meltAuthorityAddress: null,
        data: null,
        isCreateNFT: false,
        contractPaysTokenDeposit: false,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (builder as any).buildTokenCreationWithWalletService();

      expect(result).toBe(mockTransaction);
    });
  });

  describe('buildTransactionWithWalletService', () => {
    it('should throw error when createTokenOptions is null', async () => {
      builder.createTokenOptions = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((builder as any).buildTransactionWithWalletService([], [], [])).rejects.toThrow(
        'Create token options cannot be null when creating a create token transaction.'
      );
    });

    it('should build transaction with wallet service storage proxy', async () => {
      const mockTxData = {
        inputs: [{ hash: 'existing', index: 0 }],
        outputs: [{ address: 'WAddr', value: 100 }],
        tokens: ['existing-token'],
        version: 2,
        name: 'Test Token',
        symbol: 'TEST',
      };

      jest
        .spyOn(WalletServiceStorageProxy.prototype, 'prepareCreateTokenData')
        .mockResolvedValue(mockTxData);

      const mockTransaction = { hash: 'mock-tx-hash' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transactionUtils.createTransactionFromData as jest.Mock).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockTransaction as any
      );

      builder.createTokenOptions = {
        mintAddress: 'WAddress123',
        name: 'Test Token',
        symbol: 'TEST',
        amount: 1000n,
        changeAddress: 'WChangeAddr',
        createMint: true,
        mintAuthorityAddress: 'WMintAddr',
        createMelt: true,
        meltAuthorityAddress: 'WMeltAddr',
        data: ['data1', 'data2'],
        isCreateNFT: false,
        contractPaysTokenDeposit: true,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (builder as any).storageProxy = new WalletServiceStorageProxy(wallet, storage);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (builder as any).tokenFeeAddedInDeposit = true;

      const inputs = [{ hash: 'new-input', index: 1 }];
      const outputs = [{ address: 'WNewAddr', value: 200 }];
      const tokens = ['new-token'];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (builder as any).buildTransactionWithWalletService(
        inputs,
        outputs,
        tokens
      );

      expect(result).toBe(mockTransaction);
      expect(WalletServiceStorageProxy.prototype.prepareCreateTokenData).toHaveBeenCalledWith(
        'WAddress123',
        'Test Token',
        'TEST',
        1000n,
        storage,
        {
          changeAddress: 'WChangeAddr',
          createMint: true,
          mintAuthorityAddress: 'WMintAddr',
          createMelt: true,
          meltAuthorityAddress: 'WMeltAddr',
          data: ['data1', 'data2'],
          isCreateNFT: false,
          skipDepositFee: true,
        }
      );
    });

    it('should concatenate inputs, outputs, and tokens correctly', async () => {
      const mockTxData = {
        inputs: [{ hash: 'existing', index: 0 }],
        outputs: [{ address: 'WAddr', value: 100 }],
        tokens: ['existing-token'],
        version: 2,
        name: 'Test Token',
        symbol: 'TEST',
      };

      jest
        .spyOn(WalletServiceStorageProxy.prototype, 'prepareCreateTokenData')
        .mockResolvedValue(mockTxData);

      const mockTransaction = { hash: 'mock-tx-hash' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transactionUtils.createTransactionFromData as jest.Mock).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockTransaction as any
      );

      builder.createTokenOptions = {
        mintAddress: 'WAddress123',
        name: 'Test Token',
        symbol: 'TEST',
        amount: 1000n,
        changeAddress: null,
        createMint: true,
        mintAuthorityAddress: null,
        createMelt: true,
        meltAuthorityAddress: null,
        data: null,
        isCreateNFT: false,
        contractPaysTokenDeposit: false,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (builder as any).storageProxy = new WalletServiceStorageProxy(wallet, storage);

      const inputs = [{ hash: 'new-input', index: 1 }];
      const outputs = [{ address: 'WNewAddr', value: 200 }];
      const tokens = ['new-token'];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (builder as any).buildTransactionWithWalletService(inputs, outputs, tokens);

      expect(transactionUtils.createTransactionFromData).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: [
            { hash: 'existing', index: 0 },
            { hash: 'new-input', index: 1 },
          ],
          outputs: [
            { address: 'WAddr', value: 100 },
            { address: 'WNewAddr', value: 200 },
          ],
          tokens: ['existing-token', 'new-token'],
        }),
        wallet.getNetworkObject()
      );
    });

    it('should handle duplicate tokens correctly', async () => {
      const mockTxData = {
        inputs: [],
        outputs: [],
        tokens: ['duplicate-token'],
        version: 2,
        name: 'Test Token',
        symbol: 'TEST',
      };

      jest
        .spyOn(WalletServiceStorageProxy.prototype, 'prepareCreateTokenData')
        .mockResolvedValue(mockTxData);

      const mockTransaction = { hash: 'mock-tx-hash' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transactionUtils.createTransactionFromData as jest.Mock).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockTransaction as any
      );

      builder.createTokenOptions = {
        mintAddress: 'WAddress123',
        name: 'Test Token',
        symbol: 'TEST',
        amount: 1000n,
        changeAddress: null,
        createMint: true,
        mintAuthorityAddress: null,
        createMelt: true,
        meltAuthorityAddress: null,
        data: null,
        isCreateNFT: false,
        contractPaysTokenDeposit: false,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (builder as any).storageProxy = new WalletServiceStorageProxy(wallet, storage);

      const tokens = ['duplicate-token', 'new-token'];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (builder as any).buildTransactionWithWalletService([], [], tokens);

      expect(transactionUtils.createTransactionFromData).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: ['duplicate-token', 'new-token'],
        }),
        wallet.getNetworkObject()
      );
    });
  });
});
