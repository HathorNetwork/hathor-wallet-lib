import { AxiosInstance, AxiosResponse } from 'axios';
import walletApi from '../../../src/wallet/api/walletApi';
import Network from '../../../src/models/network';
import HathorWalletServiceWallet from '../../../src/wallet/wallet';
import config from '../../../src/config';
import { WalletRequestError } from '../../../src/errors';

const seed =
  'connect sunny silent cabin leopard start turtle tortoise dial timber woman genre pave tuna rice indicate gown draft palm collect retreat meadow assume spray';

// Create a mock axios instance with jest.Mock type
const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
} as jest.Mocked<Pick<AxiosInstance, 'get' | 'post' | 'delete'>>;

// Mock the axiosInstance function to return our mock instance
jest.mock('../../../src/wallet/api/walletServiceAxios', () => ({
  __esModule: true,
  axiosInstance: jest.fn().mockImplementation(() => Promise.resolve(mockAxiosInstance)),
}));

describe('walletApi', () => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getAddresses', async () => {
    config.setWalletServiceBaseUrl('https://wallet-service.hathor.network/');

    // Should fail if status code is different from 200
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 503,
      data: {
        success: true, // If status is != 200, it should fail regardless of the body
      },
    } as AxiosResponse);

    await expect(walletApi.getAddresses(wallet, 0)).rejects.toThrow(
      'Error getting wallet addresses.'
    );

    // Should fail if response data success attribute is false
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200, // Should fail even if status code is 200
      data: {
        success: false,
      },
    } as AxiosResponse);

    await expect(walletApi.getAddresses(wallet, 0)).rejects.toThrow(
      'Error getting wallet addresses.'
    );

    // Should return with data on success
    const data = {
      success: true,
      addresses: [
        {
          address: 'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
          index: 0,
          transactions: 1,
        },
      ],
    };
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data,
    } as AxiosResponse);

    await expect(walletApi.getAddresses(wallet, 0)).resolves.toStrictEqual(data);
  });

  test('getWalletStatus', async () => {
    const mockResponse = {
      success: true,
      status: {
        walletId: 'id',
        xpubkey: 'xpub',
        status: 'ready',
        maxGap: 20,
        createdAt: 123,
        readyAt: 456,
      },
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.getWalletStatus(wallet);
    expect(result).toEqual(mockResponse);

    // Should throw on invalid schema
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        status: {
          // Missing required fields
          walletId: 'id',
        },
      },
    } as AxiosResponse);

    await expect(walletApi.getWalletStatus(wallet)).rejects.toThrow();

    // Should throw on request error
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getWalletStatus(wallet)).rejects.toThrow(WalletRequestError);
  });

  test('getVersionData', async () => {
    const mockResponse = {
      success: true,
      data: {
        timestamp: 123,
        version: '1.0.0',
        network: 'testnet',
        minWeight: 14,
        minTxWeight: 14,
        minTxWeightCoefficient: 1.6,
        minTxWeightK: 100,
        tokenDepositPercentage: 0.01,
        rewardSpendMinBlocks: 3,
        maxNumberInputs: 255,
        maxNumberOutputs: 255,
      },
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.getVersionData(wallet);
    expect(result).toEqual(mockResponse.data);

    // Should throw on request error
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getVersionData(wallet)).rejects.toThrow(WalletRequestError);
  });

  test('getNewAddresses', async () => {
    const mockResponse = {
      success: true,
      addresses: [
        {
          address: 'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
          index: 0,
          addressPath: "m/44'/280'/0'/0/0",
        },
      ],
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.getNewAddresses(wallet);
    expect(result).toEqual(mockResponse);

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getNewAddresses(wallet)).rejects.toThrow(WalletRequestError);
  });

  test('getTokenDetails', async () => {
    const mockResponse = {
      success: true,
      details: {
        tokenInfo: {
          id: '0000000000000000000000000000000000000000000000000000000000000001',
          name: 'Token 1',
          symbol: 'TK1',
          version: 1, // TokenVersion.DEPOSIT
        },
        totalSupply: 1000n,
        totalTransactions: 5,
        authorities: {
          mint: true,
          melt: false,
        },
      },
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.getTokenDetails(wallet, 'token1');
    expect(result).toEqual(mockResponse);

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getTokenDetails(wallet, 'token1')).rejects.toThrow(WalletRequestError);
  });

  test('getBalances', async () => {
    const mockResponse = {
      success: true,
      balances: [
        {
          token: {
            id: '0000000000000000000000000000000000000000000000000000000000000002',
            name: 'Token 1',
            symbol: 'TK1',
            version: 1, // TokenVersion.DEPOSIT
          },
          balance: {
            unlocked: 100n,
            locked: 0n,
          },
          tokenAuthorities: {
            unlocked: {
              mint: true,
              melt: false,
            },
            locked: {
              mint: false,
              melt: false,
            },
          },
          transactions: 5,
          lockExpires: null,
        },
      ],
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.getBalances(wallet);
    expect(result).toEqual(mockResponse);

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getBalances(wallet)).rejects.toThrow(WalletRequestError);
  });

  test('getTxById', async () => {
    const mockResponse = {
      success: true,
      txTokens: [
        {
          txId: 'tx1',
          timestamp: 123,
          version: 1,
          voided: false,
          height: 1,
          weight: 14.5,
          balance: 100n,
          tokenId: 'token1',
          tokenName: 'Token 1',
          tokenSymbol: 'TK1',
        },
      ],
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.getTxById(wallet, 'tx1');
    expect(result).toEqual(mockResponse);

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getTxById(wallet, 'tx1')).rejects.toThrow(WalletRequestError);
  });

  test('getFullTxById', async () => {
    const mockResponse = {
      success: true,
      tx: {
        hash: 'tx1',
        nonce: '123',
        timestamp: 456,
        version: 1,
        weight: 14,
        parents: ['parent1', 'parent2'],
        inputs: [
          {
            tx_id: '00003eeb2ce22e80e0fa72d8afb0b8b01f8919faac94cb3a3b4900782d0f399f',
            index: 0,
            token_data: 0,
            value: 100n,
            script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
            decoded: {
              type: 'P2PKH',
              address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
              timelock: null,
              value: 100n,
              token_data: 0,
            },
          },
        ],
        outputs: [
          {
            value: 100n,
            token_data: 0,
            script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
            decoded: {
              type: 'P2PKH',
              address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
              timelock: null,
              value: 100n,
              token_data: 0,
            },
            address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
            authorities: 0n,
            timelock: null,
          },
        ],
        tokens: [
          {
            uid: '00003693ebadd6e32d5dae134e1f801d3943d5916010b87d4f9ed4447d1f1825',
            name: 'Token 1',
            symbol: 'TK1',
            amount: 100n,
          },
        ],
        token_name: 'Token 1',
        token_symbol: 'TK1',
        raw: 'raw1',
      },
      meta: {
        hash: 'tx1',
        spent_outputs: [],
        received_by: [],
        children: [],
        conflict_with: [],
        voided_by: [],
        twins: [],
        accumulated_weight: 14,
        score: 0,
        height: 1,
        first_block: 'block1',
        received_timestamp: 123456789,
        is_voided: false,
        verification_status: 'verified',
      },
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.getFullTxById(wallet, 'tx1');

    expect(result).toEqual(mockResponse);

    // Should throw on invalid schema (missing required fields)
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        tx: {
          hash: 'tx1',
          // Missing other required fields
        },
      },
    } as AxiosResponse);

    await expect(walletApi.getFullTxById(wallet, 'tx1')).rejects.toThrow();

    // Should throw on request error
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getFullTxById(wallet, 'tx1')).rejects.toThrow(WalletRequestError);
  });

  test('createWallet - wallet already loaded', async () => {
    const mockWalletStatus = {
      success: true,
      status: {
        walletId: 'test-id',
        xpubkey: 'test-xpub',
        status: 'ready',
        maxGap: 20,
        createdAt: 123456789,
        readyAt: 123456790,
      },
      error: 'wallet-already-loaded',
    };

    mockAxiosInstance.post.mockResolvedValueOnce({
      status: 400,
      data: mockWalletStatus,
    });

    const result = await walletApi.createWallet(
      wallet,
      'xpubkey',
      'xpubsig',
      'authxpub',
      'authxpubsig',
      Date.now()
    );

    expect(result).toEqual(mockWalletStatus);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('wallet/init', {
      xpubkey: 'xpubkey',
      xpubkeySignature: 'xpubsig',
      authXpubkey: 'authxpub',
      authXpubkeySignature: 'authxpubsig',
      timestamp: expect.any(Number),
    });

    // Test with invalid schema response
    const invalidMockResponse = {
      success: true,
      status: {
        // Missing required fields
        walletId: 'test-id',
      },
      error: 'wallet-already-loaded',
    };

    mockAxiosInstance.post.mockResolvedValueOnce({
      status: 400,
      data: invalidMockResponse,
    });

    await expect(
      walletApi.createWallet(wallet, 'xpubkey', 'xpubsig', 'authxpub', 'authxpubsig', Date.now())
    ).rejects.toThrow();
  });

  test('getAddressDetails', async () => {
    const address = 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx';
    const mockResponse = {
      success: true,
      data: {
        address,
        index: 1,
        transactions: 5,
        seqnum: 10,
      },
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.getAddressDetails(wallet, address);
    expect(result).toEqual(mockResponse);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(`wallet/address/info?address=${address}`);

    // Should throw on request error
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getAddressDetails(wallet, address)).rejects.toThrow(WalletRequestError);
  });

  test('getFullTxById with nano contract fields', async () => {
    const mockResponseWithNanoFields = {
      success: true,
      tx: {
        hash: 'tx1',
        nonce: '123',
        timestamp: 456,
        version: 1,
        weight: 14,
        signal_bits: 0,
        parents: ['parent1', 'parent2'],
        inputs: [
          {
            tx_id: '00003eeb2ce22e80e0fa72d8afb0b8b01f8919faac94cb3a3b4900782d0f399f',
            index: 0,
            token_data: 0,
            value: 100n,
            script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
            decoded: {
              type: 'P2PKH',
              address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
              timelock: null,
              value: 100n,
              token_data: 0,
            },
          },
        ],
        outputs: [
          {
            value: 100n,
            token_data: 0,
            script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
            decoded: {
              type: 'P2PKH',
              address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
              timelock: null,
              value: 100n,
              token_data: 0,
            },
            address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
          },
        ],
        tokens: [
          {
            uid: '00003693ebadd6e32d5dae134e1f801d3943d5916010b87d4f9ed4447d1f1825',
            name: 'Token 1',
            symbol: 'TK1',
          },
        ],
        raw: 'raw1',
        // Nano contract fields
        nc_id: 'nano-contract-id',
        nc_seqnum: 1,
        nc_blueprint_id: 'blueprint-id',
        nc_method: 'initialize',
        nc_args: 'serialized-args',
        nc_address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        nc_context: {
          actions: [
            {
              type: 'deposit',
              token_uid: '00',
              mint: false,
              melt: false,
            },
          ],
          caller_id: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
          timestamp: 1234567890,
        },
      },
      meta: {
        hash: 'tx1',
        spent_outputs: [],
        received_by: [],
        children: [],
        conflict_with: [],
        voided_by: [],
        twins: [],
        accumulated_weight: 14,
        score: 0,
        height: 1,
        first_block: 'block1',
        received_timestamp: 123456789,
        is_voided: false,
        verification_status: 'verified',
      },
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponseWithNanoFields,
    } as AxiosResponse);

    const result = await walletApi.getFullTxById(wallet, 'tx1');
    expect(result).toEqual(mockResponseWithNanoFields);

    // Verify that nano contract fields are properly parsed
    expect(result.tx.nc_id).toBe('nano-contract-id');
    expect(result.tx.nc_context?.actions).toHaveLength(1);
    expect(result.tx.nc_context?.actions[0].type).toBe('deposit');
  });

  test('schema validation for optional fields', async () => {
    // Test that outputs with missing optional authorities and timelock are valid
    const mockResponseOptionalFields = {
      success: true,
      tx: {
        hash: 'tx1',
        nonce: '123',
        timestamp: 456,
        version: 1,
        weight: 14,
        parents: ['parent1', 'parent2'],
        inputs: [
          {
            tx_id: '00003eeb2ce22e80e0fa72d8afb0b8b01f8919faac94cb3a3b4900782d0f399f',
            index: 0,
            token_data: 0,
            value: 100n,
            script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
            decoded: {
              type: 'P2PKH',
              address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
              timelock: null,
              value: 100n,
              token_data: 0,
            },
          },
        ],
        outputs: [
          {
            value: 100n,
            token_data: 0,
            script: 'dqkULlKfmt6XYPwnJfnUCAVf+fzVkNCIrA==',
            decoded: {
              type: 'P2PKH',
              address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
              timelock: null,
              value: 100n,
              token_data: 0,
            },
            address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
            // authorities and timelock are optional
          },
        ],
        tokens: [
          {
            uid: '00003693ebadd6e32d5dae134e1f801d3943d5916010b87d4f9ed4447d1f1825',
            name: 'Token 1',
            symbol: 'TK1',
            // amount is optional for nano contract token creation
          },
        ],
        raw: 'raw1',
      },
      meta: {
        hash: 'tx1',
        spent_outputs: [],
        received_by: [],
        children: [],
        conflict_with: [],
        voided_by: [],
        twins: [],
        accumulated_weight: 14,
        score: 0,
        height: 1,
        // Optional fields in meta
        first_block: null,
      },
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponseOptionalFields,
    } as AxiosResponse);

    // This should not throw since the optional fields are handled properly
    const result = await walletApi.getFullTxById(wallet, 'tx1');
    expect(result).toEqual(mockResponseOptionalFields);
  });

  test('createReadOnlyAuthToken', async () => {
    const xpubkey =
      'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W8kWb3XNVy8HKXfXd8pKf3Xmb';
    const mockResponse = {
      success: true,
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ3aWQiOiJ0ZXN0LXdhbGxldC1pZCIsImFjY2Vzc1R5cGUiOiJyZWFkLW9ubHkiLCJpYXQiOjE2OTY1ODg4MDAsImV4cCI6MTY5NjU5MDYwMH0.test',
    };

    mockAxiosInstance.post.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.createReadOnlyAuthToken(wallet, xpubkey);
    expect(result).toEqual(mockResponse);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('auth/token/readonly', { xpubkey });

    // Should throw on invalid response status
    mockAxiosInstance.post.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.createReadOnlyAuthToken(wallet, xpubkey)).rejects.toThrow(
      'Error requesting read-only auth token.'
    );

    // Should throw on success: false
    mockAxiosInstance.post.mockResolvedValueOnce({
      status: 200,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.createReadOnlyAuthToken(wallet, xpubkey)).rejects.toThrow(
      'Error requesting read-only auth token.'
    );
  });

  test('deleteTxProposal', async () => {
    const txProposalId = 'proposal-id';
    const mockResponse = {
      success: true,
      txProposalId,
    };

    mockAxiosInstance.delete.mockResolvedValueOnce({
      status: 200,
      data: mockResponse,
    } as AxiosResponse);

    const result = await walletApi.deleteTxProposal(wallet, txProposalId);
    expect(result).toEqual(mockResponse);
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(`tx/proposal/${txProposalId}`);

    // Should throw on invalid response status
    mockAxiosInstance.delete.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.deleteTxProposal(wallet, txProposalId)).rejects.toThrow(
      'Error deleting tx proposal.'
    );

    // Should throw on invalid schema
    mockAxiosInstance.delete.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        // Missing txProposalId
      },
    } as AxiosResponse);

    await expect(walletApi.deleteTxProposal(wallet, txProposalId)).rejects.toThrow();
  });

  test('getHasTxOutsideFirstAddress', async () => {
    // Test successful response with hasTransactions: true
    const mockResponseTrue = {
      success: true,
      hasTransactions: true,
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponseTrue,
    } as AxiosResponse);

    const resultTrue = await walletApi.getHasTxOutsideFirstAddress(wallet);
    expect(resultTrue).toEqual(mockResponseTrue);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      'wallet/addresses/has-transactions-outside-first-address'
    );

    // Test successful response with hasTransactions: false
    const mockResponseFalse = {
      success: true,
      hasTransactions: false,
    };

    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: mockResponseFalse,
    } as AxiosResponse);

    const resultFalse = await walletApi.getHasTxOutsideFirstAddress(wallet);
    expect(resultFalse).toEqual(mockResponseFalse);

    // Should throw on invalid response status
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 400,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getHasTxOutsideFirstAddress(wallet)).rejects.toThrow(
      'Error checking if wallet has transactions outside first address.'
    );

    // Should throw on success: false
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: { success: false },
    } as AxiosResponse);

    await expect(walletApi.getHasTxOutsideFirstAddress(wallet)).rejects.toThrow(
      'Error checking if wallet has transactions outside first address.'
    );

    // Should throw on invalid schema (missing hasTransactions)
    mockAxiosInstance.get.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        // Missing hasTransactions field
      },
    } as AxiosResponse);

    await expect(walletApi.getHasTxOutsideFirstAddress(wallet)).rejects.toThrow();
  });
});
