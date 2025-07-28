/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NATIVE_TOKEN_UID } from '../../src/constants';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import walletApi from '../../src/wallet/api/walletApi';

// Mock wallet API
jest.mock('../../src/wallet/api/walletApi');
const mockWalletApi = walletApi as jest.Mocked<typeof walletApi>;

describe('getUtxos RPC-style interface', () => {
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
    
    jest.clearAllMocks();
  });

  it('should use RPC interface when token parameter is provided', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 100n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
      {
        txId: 'tx2',
        index: 1,
        value: 200n,
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/1",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      token: 'HTR',
      max_utxos: 10,
    });

    expect(result).toEqual(mockUtxos);
    expect(mockWalletApi.getTxOutputs).toHaveBeenCalledWith(wallet, {
      tokenId: NATIVE_TOKEN_UID,
      authority: undefined,
      addresses: undefined,
      totalAmount: undefined,
      count: 10,
      ignoreLocked: true,
      skipSpent: true,
    });
  });

  it('should use RPC interface when max_utxos parameter is provided', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 100n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      max_utxos: 5,
    });

    expect(result).toEqual(mockUtxos);
    expect(mockWalletApi.getTxOutputs).toHaveBeenCalledWith(wallet, {
      tokenId: undefined,
      authority: undefined,
      addresses: undefined,
      totalAmount: undefined,
      count: 5,
      ignoreLocked: true,
      skipSpent: true,
    });
  });

  it('should handle custom token in RPC interface', async () => {
    const customTokenId = '01a7a04b2c3b7b1b9b8a8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f';
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 50n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: customTokenId,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      token: customTokenId,
      max_utxos: 1,
    });

    expect(result).toEqual(mockUtxos);
    expect(mockWalletApi.getTxOutputs).toHaveBeenCalledWith(wallet, {
      tokenId: customTokenId,
      authority: undefined,
      addresses: undefined,
      totalAmount: undefined,
      count: 1,
      ignoreLocked: true,
      skipSpent: true,
    });
  });

  it('should handle authorities parameter in RPC interface', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 100n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: NATIVE_TOKEN_UID,
        authorities: 1,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      token: 'HTR',
      authorities: 1,
      max_utxos: 1,
    });

    expect(result).toEqual(mockUtxos);
    expect(mockWalletApi.getTxOutputs).toHaveBeenCalledWith(wallet, {
      tokenId: NATIVE_TOKEN_UID,
      authority: 1n,
      addresses: undefined,
      totalAmount: undefined,
      count: 1,
      ignoreLocked: true,
      skipSpent: true,
    });
  });

  it('should handle filter_address parameter in RPC interface', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 100n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      filter_address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
      max_utxos: 10,
    });

    expect(result).toEqual(mockUtxos);
    expect(mockWalletApi.getTxOutputs).toHaveBeenCalledWith(wallet, {
      tokenId: undefined,
      authority: undefined,
      addresses: ['WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx'],
      totalAmount: undefined,
      count: 10,
      ignoreLocked: true,
      skipSpent: true,
    });
  });

  it('should apply amount filters in RPC interface', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 50n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
      {
        txId: 'tx2',
        index: 1,
        value: 150n,
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/1",
      },
      {
        txId: 'tx3',
        index: 2,
        value: 250n,
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/2",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    // Test amount_smaller_than filter
    const result1 = await wallet.getUtxos({
      token: 'HTR',
      amount_smaller_than: 200,
      max_utxos: 10,
    });

    expect(result1).toHaveLength(2);
    expect(result1).toEqual([mockUtxos[0], mockUtxos[1]]);

    // Test amount_bigger_than filter
    const result2 = await wallet.getUtxos({
      token: 'HTR',
      amount_bigger_than: 100,
      max_utxos: 10,
    });

    expect(result2).toHaveLength(2);
    expect(result2).toEqual([mockUtxos[1], mockUtxos[2]]);

    // Test both filters together
    const result3 = await wallet.getUtxos({
      token: 'HTR',
      amount_bigger_than: 100,
      amount_smaller_than: 200,
      max_utxos: 10,
    });

    expect(result3).toHaveLength(1);
    expect(result3).toEqual([mockUtxos[1]]);
  });

  it('should limit results with max_utxos in RPC interface', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 100n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
      {
        txId: 'tx2',
        index: 1,
        value: 200n,
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/1",
      },
      {
        txId: 'tx3',
        index: 2,
        value: 300n,
        address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/2",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      token: 'HTR',
      max_utxos: 2,
    });

    expect(result).toHaveLength(2);
    expect(result).toEqual([mockUtxos[0], mockUtxos[1]]);
  });

  it('should use existing interface when tokenId parameter is provided', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 200n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: NATIVE_TOKEN_UID,
        authorities: 0,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    // Test totalAmount that doesn't exceed available UTXOs
    const result = await wallet.getUtxos({
      tokenId: NATIVE_TOKEN_UID,
      totalAmount: 150n,
    });

    expect(result).toEqual({
      utxos: mockUtxos,
      changeAmount: 50n,
    });
  });

  it('should use existing interface when no RPC-specific parameters are provided', async () => {
    const mockUtxos = [
      {
        txId: 'tx1',
        index: 0,
        value: 1n,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        token: NATIVE_TOKEN_UID,
        authorities: 1,
        addressPath: "m/44'/280'/0'/0/0",
      },
    ];

    mockWalletApi.getTxOutputs.mockResolvedValue({
      txOutputs: mockUtxos,
    });

    const result = await wallet.getUtxos({
      authority: 1n,
      count: 1,
    });

    expect(result).toEqual({
      utxos: mockUtxos,
      changeAmount: 0n,
    });
  });
});