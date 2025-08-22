/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NATIVE_TOKEN_UID } from '../../src/constants';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import SendTransactionWalletService from '../../src/wallet/sendTransactionWalletService';
import { OutputType } from '../../src/wallet/types';
import Network from '../../src/models/network';
import { WalletFromXPubGuard } from '../../src/errors';
import helpers from '../../src/utils/helpers';

// Mock the helpers module
jest.mock('../../src/utils/helpers');
const mockHelpers = helpers as jest.Mocked<typeof helpers>;

describe('sendManyOutputsSendTransaction', () => {
  let wallet: HathorWalletServiceWallet;
  const seed =
    'wood candy festival desk bachelor arrive pumpkin swarm stairs jar feel ship edit drill always calm what oven lobster lesson eternal foot monkey toast';

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: async () => 'test-pin',
      seed,
      network: new Network('testnet'),
    });

    // Mock wallet methods
    wallet.failIfWalletNotReady = jest.fn();
    wallet.storage = {
      isReadonly: jest.fn().mockResolvedValue(false),
    } as Partial<typeof wallet.storage>;

    // Mock helpers.getOutputTypeFromAddress
    mockHelpers.getOutputTypeFromAddress.mockReturnValue(OutputType.P2PKH);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create SendTransactionWalletService with HTR outputs', async () => {
    const outputs = [
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        value: 50n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    const sendTx = await wallet.sendManyOutputsSendTransaction(outputs, {
      pinCode: 'test-pin',
    });

    expect(sendTx).toBeInstanceOf(SendTransactionWalletService);
    expect(wallet.failIfWalletNotReady).toHaveBeenCalled();
    expect(wallet.storage.isReadonly).toHaveBeenCalled();
    expect(mockHelpers.getOutputTypeFromAddress).toHaveBeenCalledTimes(2);
  });

  it('should create SendTransactionWalletService with custom token outputs', async () => {
    const customTokenId =
      '01a7a04b2c3b7b1b9b8a8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f';
    const outputs = [
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: customTokenId,
      },
    ];

    const sendTx = await wallet.sendManyOutputsSendTransaction(outputs, {
      pinCode: 'test-pin',
    });

    expect(sendTx).toBeInstanceOf(SendTransactionWalletService);
    expect(mockHelpers.getOutputTypeFromAddress).toHaveBeenCalledWith(
      'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
      wallet.network
    );
  });

  it('should handle data outputs correctly', async () => {
    const outputs = [
      {
        type: OutputType.DATA,
        data: 'test-data',
      },
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    const sendTx = await wallet.sendManyOutputsSendTransaction(outputs, {
      pinCode: 'test-pin',
    });

    expect(sendTx).toBeInstanceOf(SendTransactionWalletService);
    // Data outputs should not call getOutputTypeFromAddress
    expect(mockHelpers.getOutputTypeFromAddress).toHaveBeenCalledTimes(1);
  });

  it('should handle mixed inputs and change address', async () => {
    const outputs = [
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    const inputs = [{ txId: 'input-tx-id', index: 0 }];
    const changeAddress = 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc';

    const sendTx = await wallet.sendManyOutputsSendTransaction(outputs, {
      inputs,
      changeAddress,
      pinCode: 'test-pin',
    });

    expect(sendTx).toBeInstanceOf(SendTransactionWalletService);
  });

  it('should throw WalletFromXPubGuard when wallet is readonly', async () => {
    wallet.storage.isReadonly = jest.fn().mockResolvedValue(true);

    const outputs = [
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    await expect(wallet.sendManyOutputsSendTransaction(outputs)).rejects.toThrow(
      WalletFromXPubGuard
    );
  });

  it('should throw error when wallet is not ready', async () => {
    wallet.failIfWalletNotReady = jest.fn().mockImplementation(() => {
      throw new Error('Wallet not ready');
    });

    const outputs = [
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    await expect(wallet.sendManyOutputsSendTransaction(outputs)).rejects.toThrow(
      'Wallet not ready'
    );
  });

  it('should throw error when no pin is provided and requestPassword fails', async () => {
    wallet.requestPassword = jest.fn().mockResolvedValue('');

    const outputs = [
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    await expect(wallet.sendManyOutputsSendTransaction(outputs)).rejects.toThrow(
      'Pin is required.'
    );
  });

  it('should use requestPassword when pinCode is not provided', async () => {
    const mockRequestPassword = jest.fn().mockResolvedValue('requested-pin');
    wallet.requestPassword = mockRequestPassword;

    const outputs = [
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    const sendTx = await wallet.sendManyOutputsSendTransaction(outputs);

    expect(mockRequestPassword).toHaveBeenCalled();
    expect(sendTx).toBeInstanceOf(SendTransactionWalletService);
  });

  it('should process mixed output types correctly', async () => {
    const outputs = [
      {
        type: OutputType.DATA,
        data: 'data-output',
      },
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        value: 50n,
        token: '01a7a04b2c3b7b1b9b8a8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f',
      },
    ];

    const sendTx = await wallet.sendManyOutputsSendTransaction(outputs, {
      pinCode: 'test-pin',
    });

    expect(sendTx).toBeInstanceOf(SendTransactionWalletService);
    // Should only call getOutputTypeFromAddress for non-data outputs
    expect(mockHelpers.getOutputTypeFromAddress).toHaveBeenCalledTimes(2);
  });

  it('should handle default options correctly', async () => {
    const mockRequestPassword = jest.fn().mockResolvedValue('default-pin');
    wallet.requestPassword = mockRequestPassword;

    const outputs = [
      {
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    // Call without options
    const sendTx = await wallet.sendManyOutputsSendTransaction(outputs);

    expect(sendTx).toBeInstanceOf(SendTransactionWalletService);
    expect(mockRequestPassword).toHaveBeenCalled();
  });
});
