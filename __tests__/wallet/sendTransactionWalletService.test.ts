/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NATIVE_TOKEN_UID, FEE_PER_OUTPUT } from '../../src/constants';
import SendTransactionWalletService from '../../src/wallet/sendTransactionWalletService';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { OutputType } from '../../src/wallet/types';
import Network from '../../src/models/network';
import Address from '../../src/models/address';
import { TokenVersion } from '../../src/types';
import FeeHeader from '../../src/headers/fee';

describe('prepareTxData', () => {
  let wallet;
  let sendTransaction;

  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: async () => '123',
      seed,
      network: new Network('testnet'),
    });
    // Mocking wallet methods
    wallet.getUtxoFromId = jest.fn();
    wallet.getUtxosForAmount = jest.fn();
    wallet.getCurrentAddress = jest
      .fn()
      .mockReturnValue({ address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc' });
    wallet.getTokenDetails = jest.fn().mockImplementation(async tokenUid => ({
      tokenInfo: {
        id: tokenUid,
        name: 'DepositToken',
        symbol: 'DBT',
        version: TokenVersion.DEPOSIT,
      },
    }));
  });

  it('should prepare transaction data with mixed inputs and a data output', async () => {
    // Mock the address validation - bypass all validation
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    // Mock the return values for the wallet methods
    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'spent-tx-id' && index === 0) {
        return {
          txId: 'spent-tx-id',
          index: 0,
          value: 11n,
          address: 'spent-utxo-address',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      if (txId === 'another-spent-tx-id' && index === 0) {
        return {
          txId: 'another-spent-tx-id',
          index: 0,
          value: 2n,
          address: 'another-spent-utxo-address',
          tokenId: NATIVE_TOKEN_UID,
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/2",
        };
      }
      return null;
    });

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === NATIVE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'another-spent-tx-id',
              index: 0,
              value: 2n,
              tokenId: NATIVE_TOKEN_UID,
              address: 'another-spent-utxo-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/2",
            },
          ],
          changeAmount: 1n,
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    const inputs = [{ txId: 'spent-tx-id', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
      {
        type: OutputType.DATA,
        data: 'abcd',
        value: 1n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });

    const txData = await sendTransaction.prepareTxData();

    // With the mocked values, we expect the following:
    // 1. One user-provided input for token '01' with value 11.
    // 2. One output for token '01' with value 10.
    // 3. One data output with value 1 (for HTR).
    // 4. One automatically selected input for HTR with value 2.
    // 5. A change output for token '01' with value 1 (11 - 10).
    // 6. A change output for HTR with value 1 (2 - 1).

    expect(txData.inputs).toHaveLength(2);
    expect(txData.outputs).toHaveLength(4);
    expect(txData.tokens).toEqual(['01']); // HTR is not in the tokens array

    // Check inputs
    expect(txData.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ txId: 'spent-tx-id', index: 0, token: '01', value: 11n }),
        expect.objectContaining({
          txId: 'another-spent-tx-id',
          index: 0,
          token: NATIVE_TOKEN_UID,
          value: 2n,
        }),
      ])
    );

    // Check outputs
    expect(txData.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
          value: 10n,
          token: '01',
          type: 'p2pkh',
          authorities: 0n,
          timelock: null,
        }),
        expect.objectContaining({
          type: 'data',
          data: '61626364', // 'abcd' in hex
          value: 1n,
          token: NATIVE_TOKEN_UID,
          authorities: 0n,
        }),
        expect.objectContaining({
          address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
          value: 1n,
          token: '01',
          type: 'p2pkh',
          authorities: 0n,
          timelock: null,
        }),
        expect.objectContaining({
          address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
          value: 1n,
          token: NATIVE_TOKEN_UID,
          type: 'p2pkh',
          authorities: 0n,
          timelock: null,
        }),
      ])
    );
  });

  it('should accumulate values for multiple outputs with same token', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'utxo-tx-id' && index === 0) {
        return {
          txId: 'utxo-tx-id',
          index: 0,
          value: 30n,
          address: 'utxo-address',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/3",
        };
      }
      return null;
    });

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === '01') {
        return {
          utxos: [
            {
              txId: 'utxo-tx-id',
              index: 0,
              value: 30n,
              tokenId: '01',
              address: 'utxo-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/3",
            },
          ],
          changeAmount: 5n, // 30 - 25 = 5
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
      {
        type: OutputType.P2PKH,
        address: 'WP2rVhxzT3YTWg8VbBKkacLqLU2LrouWDy',
        value: 15n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    expect(txData.inputs).toHaveLength(1);
    expect(txData.outputs).toHaveLength(3); // 2 outputs + 1 change
    expect(txData.tokens).toEqual(['01']);

    // Verify the total output value is correctly accumulated (25n)
    const outputValues = txData.outputs
      .filter(o => o.token === '01' && o.type === 'p2pkh')
      .reduce((sum, o) => sum + o.value, 0n);
    expect(outputValues).toBe(30n); // 10 + 15 + 5 (change)
  });

  it('should throw error when pre-selected input UTXO is not found', async () => {
    wallet.getUtxoFromId.mockResolvedValue(null);

    const inputs = [{ txId: 'non-existent-tx', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });

    await expect(sendTransaction.prepareTxData()).rejects.toThrow(
      'Invalid input selection. Input non-existent-tx at index 0.'
    );
  });

  it('should throw error when input has token not present in outputs', async () => {
    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'wrong-token-tx' && index === 0) {
        return {
          txId: 'wrong-token-tx',
          index: 0,
          value: 10n,
          address: 'some-address',
          tokenId: '02', // Different token than output
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    const inputs = [{ txId: 'wrong-token-tx', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01', // Different token than input
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });

    await expect(sendTransaction.prepareTxData()).rejects.toThrow(
      'Invalid input selection. Input wrong-token-tx at index 0 has token 02 that is not on the outputs.'
    );
  });

  it('should accumulate values for multiple pre-selected inputs with same token', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'input-1' && index === 0) {
        return {
          txId: 'input-1',
          index: 0,
          value: 15n,
          address: 'address-1',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      if (txId === 'input-2' && index === 0) {
        return {
          txId: 'input-2',
          index: 0,
          value: 20n,
          address: 'address-2',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/2",
        };
      }
      return null;
    });

    const inputs = [
      { txId: 'input-1', index: 0 },
      { txId: 'input-2', index: 0 },
    ];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 30n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });
    const txData = await sendTransaction.prepareTxData();

    expect(txData.inputs).toHaveLength(2);
    expect(txData.outputs).toHaveLength(2); // 1 output + 1 change (35 - 30 = 5)

    // Check change output
    const changeOutput = txData.outputs.find(
      o => o.address === 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc'
    );
    expect(changeOutput).toBeDefined();
    expect(changeOutput.value).toBe(5n);
  });

  it('should throw error when no UTXOs are available for automatic selection', async () => {
    wallet.getUtxosForAmount.mockResolvedValue({ utxos: [], changeAmount: 0n });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });

    await expect(sendTransaction.prepareTxData()).rejects.toThrow(
      'No utxos available to fill the request. Token: 01 - Amount: 10.'
    );
  });

  it('should throw error when pre-selected inputs sum is less than outputs sum', async () => {
    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'insufficient-tx' && index === 0) {
        return {
          txId: 'insufficient-tx',
          index: 0,
          value: 5n, // Less than output value
          address: 'some-address',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    const inputs = [{ txId: 'insufficient-tx', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });

    await expect(sendTransaction.prepareTxData()).rejects.toThrow(
      'Invalid input selection. Sum of inputs for token 01 is smaller than the sum of outputs.'
    );
  });

  it('should not shuffle outputs when no change is added', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'exact-tx' && index === 0) {
        return {
          txId: 'exact-tx',
          index: 0,
          value: 10n, // Exact amount needed
          address: 'some-address',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    const inputs = [{ txId: 'exact-tx', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });
    const txData = await sendTransaction.prepareTxData();

    expect(txData.outputs).toHaveLength(1); // No change output
    expect(txData.outputs[0].address).toBe('WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx');
  });

  it('should successfully use cached UTXO data for final processing', async () => {
    // Test that UTXO data is cached and reused, not fetched multiple times
    let callCount = 0;
    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      callCount++;
      if (txId === 'cached-tx' && index === 0) {
        return {
          txId: 'cached-tx',
          index: 0,
          value: 10n,
          address: 'some-address',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    const inputs = [{ txId: 'cached-tx', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });

    const txData = await sendTransaction.prepareTxData();

    // Verify the UTXO data is correctly used
    expect(txData.inputs).toHaveLength(1);
    expect(txData.inputs[0]).toEqual(
      expect.objectContaining({
        txId: 'cached-tx',
        index: 0,
        token: '01',
        value: 10n,
      })
    );

    // Verify getUtxoFromId was called only once (during validation, not during final processing)
    expect(callCount).toBe(1);
  });

  it('should throw error when output is missing address or token', async () => {
    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'some-tx' && index === 0) {
        return {
          txId: 'some-tx',
          index: 0,
          value: 10n,
          address: 'some-address',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    wallet.getUtxosForAmount.mockResolvedValue({
      utxos: [
        {
          txId: 'some-tx',
          index: 0,
          value: 10n,
          tokenId: '01',
          address: 'some-address',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        },
      ],
      changeAmount: 0n,
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: null, // Missing address
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });

    await expect(sendTransaction.prepareTxData()).rejects.toThrow(
      'Output is missing address or token.'
    );
  });

  it('should handle scenario with only pre-selected inputs and no automatic selection', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'token1-tx' && index === 0) {
        return {
          txId: 'token1-tx',
          index: 0,
          value: 20n,
          address: 'address-1',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      if (txId === 'token2-tx' && index === 0) {
        return {
          txId: 'token2-tx',
          index: 0,
          value: 15n,
          address: 'address-2',
          tokenId: '02',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/2",
        };
      }
      return null;
    });

    const inputs = [
      { txId: 'token1-tx', index: 0 },
      { txId: 'token2-tx', index: 0 },
    ];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 18n,
        token: '01',
      },
      {
        type: OutputType.P2PKH,
        address: 'WP2rVhxzT3YTWg8VbBKkacLqLU2LrouWDy',
        value: 12n,
        token: '02',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });
    const txData = await sendTransaction.prepareTxData();

    expect(txData.inputs).toHaveLength(2);
    expect(txData.outputs).toHaveLength(4); // 2 outputs + 2 change outputs
    expect(txData.tokens).toEqual(['01', '02']);

    // Verify change outputs exist for both tokens
    const changeOutputs = txData.outputs.filter(
      o => o.address === 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc'
    );
    expect(changeOutputs).toHaveLength(2);
    expect(changeOutputs.find(o => o.token === '01' && o.value === 2n)).toBeDefined();
    expect(changeOutputs.find(o => o.token === '02' && o.value === 3n)).toBeDefined();
  });

  it('should handle mixed tokens with automatic selection and change outputs', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'pre-selected-tx' && index === 0) {
        return {
          txId: 'pre-selected-tx',
          index: 0,
          value: 25n,
          address: 'address-1',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      if (txId === 'auto-selected-tx' && index === 0) {
        return {
          txId: 'auto-selected-tx',
          index: 0,
          value: 30n,
          address: 'auto-address',
          tokenId: '02',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/2",
        };
      }
      if (txId === 'htr-tx' && index === 0) {
        return {
          txId: 'htr-tx',
          index: 0,
          value: 5n,
          address: 'htr-address',
          tokenId: NATIVE_TOKEN_UID,
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/3",
        };
      }
      return null;
    });

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === '02') {
        return {
          utxos: [
            {
              txId: 'auto-selected-tx',
              index: 0,
              value: 30n,
              tokenId: '02',
              address: 'auto-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/2",
            },
          ],
          changeAmount: 10n, // 30 - 20 = 10
        };
      }
      if (token === NATIVE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'htr-tx',
              index: 0,
              value: 5n,
              token: NATIVE_TOKEN_UID,
              address: 'htr-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/3",
            },
          ],
          changeAmount: 2n, // 5 - 3 = 2
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    const inputs = [{ txId: 'pre-selected-tx', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 20n,
        token: '01',
      },
      {
        type: OutputType.P2PKH,
        address: 'WP2rVhxzT3YTWg8VbBKkacLqLU2LrouWDy',
        value: 20n,
        token: '02',
      },
      {
        type: OutputType.P2PKH,
        address: 'WP3rVhxzT3YTWg8VbBKkacLqLU2LrouWDz',
        value: 3n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });
    const txData = await sendTransaction.prepareTxData();

    expect(txData.inputs).toHaveLength(3); // 1 pre-selected + 2 auto-selected
    expect(txData.outputs).toHaveLength(6); // 3 outputs + 3 change outputs
    expect(txData.tokens).toEqual(['01', '02']); // HTR not included

    // Verify all tokens have proper change outputs
    const changeOutputs = txData.outputs.filter(
      o => o.address === 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc'
    );
    expect(changeOutputs).toHaveLength(3);
  });

  it('should handle outputs with timelock parameter', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'timelock-tx' && index === 0) {
        return {
          txId: 'timelock-tx',
          index: 0,
          value: 10n,
          address: 'some-address',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    wallet.getUtxosForAmount.mockResolvedValue({
      utxos: [
        {
          txId: 'timelock-tx',
          index: 0,
          value: 10n,
          tokenId: '01',
          address: 'some-address',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        },
      ],
      changeAmount: 0n,
    });

    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
        timelock: futureTimestamp,
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    expect(txData.outputs).toHaveLength(1);
    expect(txData.outputs[0].timelock).toBe(futureTimestamp);
  });

  it('should handle P2SH addresses in outputs', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2sh');

    wallet.getUtxosForAmount.mockResolvedValue({
      utxos: [
        {
          txId: 'p2sh-tx',
          index: 0,
          value: 10n,
          tokenId: '01',
          address: 'some-address',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        },
      ],
      changeAmount: 0n,
    });

    const outputs = [
      {
        type: OutputType.P2SH,
        address: 'wcUZ7SrNrG3peJ8729k7Mvy2SrkJhQGLEC', // P2SH address
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    expect(txData.outputs[0].type).toBe('p2sh');
    expect(txData.outputs[0].address).toBe('wcUZ7SrNrG3peJ8729k7Mvy2SrkJhQGLEC');
  });

  it('should create correct P2SH script in outputDataToModel for P2SH addresses', async () => {
    // This test verifies the actual script creation for P2SH addresses
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2sh');

    const outputs = [
      {
        type: OutputType.P2SH,
        address: 'wcUZ7SrNrG3peJ8729k7Mvy2SrkJhQGLEC',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });

    // Call outputDataToModel directly to verify script creation
    const outputModel = sendTransaction.outputDataToModel(outputs[0], ['01']);

    // Verify the output was created with the correct value
    expect(outputModel.value).toBe(10n);

    // P2SH script should start with OP_HASH160 (0xa9), not OP_DUP (0x76)
    // The script format is: OP_HASH160 <20 bytes hash> OP_EQUAL
    const scriptHex = outputModel.script.toString('hex');
    expect(scriptHex.startsWith('a9')).toBe(true); // OP_HASH160
    expect(scriptHex.endsWith('87')).toBe(true); // OP_EQUAL
    // Should NOT start with OP_DUP (0x76) which would be P2PKH
    expect(scriptHex.startsWith('76')).toBe(false);
  });

  it('should create correct P2PKH script in outputDataToModel for P2PKH addresses', async () => {
    // This test verifies the actual script creation for P2PKH addresses
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });

    // Call outputDataToModel directly to verify script creation
    const outputModel = sendTransaction.outputDataToModel(outputs[0], ['01']);

    // Verify the output was created with the correct value
    expect(outputModel.value).toBe(10n);

    // P2PKH script should start with OP_DUP (0x76)
    // The script format is: OP_DUP OP_HASH160 <20 bytes hash> OP_EQUALVERIFY OP_CHECKSIG
    const scriptHex = outputModel.script.toString('hex');
    expect(scriptHex.startsWith('76')).toBe(true); // OP_DUP
    expect(scriptHex.endsWith('ac')).toBe(true); // OP_CHECKSIG
    // Should NOT end with OP_EQUAL (0x87) which would be P2SH
    expect(scriptHex.endsWith('87')).toBe(false);
  });

  it('should handle multiple tokens including HTR in single transaction', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === NATIVE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'htr-tx',
              index: 0,
              value: 20n,
              tokenId: NATIVE_TOKEN_UID,
              address: 'htr-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/1",
            },
          ],
          changeAmount: 5n, // 20 - 15 = 5
        };
      }
      if (token === '01') {
        return {
          utxos: [
            {
              txId: 'token-tx',
              index: 0,
              value: 30n,
              tokenId: '01',
              address: 'token-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/2",
            },
          ],
          changeAmount: 10n, // 30 - 20 = 10
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 15n,
        token: NATIVE_TOKEN_UID,
      },
      {
        type: OutputType.P2PKH,
        address: 'WP2rVhxzT3YTWg8VbBKkacLqLU2LrouWDy',
        value: 20n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    expect(txData.inputs).toHaveLength(2);
    expect(txData.outputs).toHaveLength(4); // 2 outputs + 2 change outputs
    expect(txData.tokens).toEqual(['01']); // HTR should not be in tokens array
  });

  it('should throw error when token is in outputs but not in userInputAmountMap', async () => {
    // This tests the safety check in the else branch
    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'wrong-mapping' && index === 0) {
        return {
          txId: 'wrong-mapping',
          index: 0,
          value: 10n,
          address: 'some-address',
          tokenId: '02', // Different from output
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    const inputs = [{ txId: 'wrong-mapping', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });

    await expect(sendTransaction.prepareTxData()).rejects.toThrow(
      'Invalid input selection. Input wrong-mapping at index 0 has token 02 that is not on the outputs.'
    );
  });

  it('should correctly set fullTxData and _utxosAddressPath properties', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'test-tx' && index === 0) {
        return {
          txId: 'test-tx',
          index: 0,
          value: 10n,
          address: 'some-address',
          tokenId: '01',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    const inputs = [{ txId: 'test-tx', index: 0 }];
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { inputs, outputs });
    const txData = await sendTransaction.prepareTxData();

    // Check that the instance properties are set
    expect(sendTransaction.fullTxData).toBe(txData);
    expect(sendTransaction._utxosAddressPath).toEqual(["m/44'/280'/0'/0/1"]);
  });

  it('should use changeAddress if provided instead of generating new one', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxosForAmount.mockResolvedValue({
      utxos: [
        {
          txId: 'change-test-tx',
          index: 0,
          value: 15n,
          tokenId: '01',
          address: 'some-address',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        },
      ],
      changeAmount: 5n,
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 10n,
        token: '01',
      },
    ];

    const customChangeAddress = 'WCustomChangeAddressForTesting';
    sendTransaction = new SendTransactionWalletService(wallet, {
      outputs,
      changeAddress: customChangeAddress,
    });

    const txData = await sendTransaction.prepareTxData();

    const changeOutput = txData.outputs.find(o => o.value === 5n);
    expect(changeOutput).toBeDefined();
    expect(changeOutput.address).toBe(customChangeAddress);
  });
});

describe('selectUtxosToUse', () => {
  let wallet;
  let sendTransaction;

  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: async () => '123',
      seed,
      network: new Network('testnet'),
    });
    wallet.getUtxosForAmount = jest.fn();
    wallet.getCurrentAddress = jest
      .fn()
      .mockReturnValue({ address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc' });
  });

  it('should select UTXOs and create change outputs for multiple tokens', async () => {
    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === NATIVE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'htr-utxo',
              index: 0,
              value: 100n,
              tokenId: NATIVE_TOKEN_UID,
              address: 'htr-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/1",
            },
          ],
          changeAmount: 50n, // 100 - 50 = 50
        };
      }
      if (token === '01') {
        return {
          utxos: [
            {
              txId: 'token-utxo',
              index: 0,
              value: 200n,
              tokenId: '01',
              address: 'token-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/2",
            },
          ],
          changeAmount: 100n, // 200 - 100 = 100
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 50n,
        token: NATIVE_TOKEN_UID,
      },
      {
        type: OutputType.P2PKH,
        address: 'WP2rVhxzT3YTWg8VbBKkacLqLU2LrouWDy',
        value: 100n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });

    const tokenAmountMap = {
      [NATIVE_TOKEN_UID]: 50n,
      '01': 100n,
    };

    const addressPaths = await sendTransaction.selectUtxosToUse(tokenAmountMap);

    // Verify address paths are returned
    expect(addressPaths).toEqual(["m/44'/280'/0'/0/1", "m/44'/280'/0'/0/2"]);

    // Verify getUtxosForAmount was called correctly
    expect(wallet.getUtxosForAmount).toHaveBeenCalledWith(50n, { token: NATIVE_TOKEN_UID });
    expect(wallet.getUtxosForAmount).toHaveBeenCalledWith(100n, { token: '01' });

    // Verify inputs and outputs were updated
    expect(sendTransaction.inputs).toHaveLength(2);
    expect(sendTransaction.outputs).toHaveLength(4); // 2 original + 2 change
  });

  it('should throw error when no UTXOs are available for a token', async () => {
    wallet.getUtxosForAmount.mockResolvedValue({ utxos: [], changeAmount: 0n });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });

    const tokenAmountMap = { '01': 100n };

    await expect(sendTransaction.selectUtxosToUse(tokenAmountMap)).rejects.toThrow(
      'No utxos available to fill the request. Token: 01 - Amount: 100.'
    );
  });

  it('should handle exact amount without creating change', async () => {
    wallet.getUtxosForAmount.mockResolvedValue({
      utxos: [
        {
          txId: 'exact-utxo',
          index: 0,
          value: 100n,
          tokenId: '01',
          address: 'exact-address',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        },
      ],
      changeAmount: 0n, // No change needed
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: '01',
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });

    const tokenAmountMap = { '01': 100n };

    const addressPaths = await sendTransaction.selectUtxosToUse(tokenAmountMap);

    expect(addressPaths).toEqual(["m/44'/280'/0'/0/1"]);
    expect(sendTransaction.outputs).toHaveLength(1); // No change output added
  });

  it('should use custom changeAddress when provided', async () => {
    wallet.getUtxosForAmount.mockResolvedValue({
      utxos: [
        {
          txId: 'change-utxo',
          index: 0,
          value: 150n,
          tokenId: '01',
          address: 'some-address',
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        },
      ],
      changeAmount: 50n,
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: '01',
      },
    ];

    const customChangeAddress = 'WCustomChangeAddress123';
    sendTransaction = new SendTransactionWalletService(wallet, {
      outputs,
      changeAddress: customChangeAddress,
    });

    const tokenAmountMap = { '01': 100n };

    await sendTransaction.selectUtxosToUse(tokenAmountMap);

    // Find the change output
    const changeOutput = sendTransaction.outputs.find(o => o.value === 50n);
    expect(changeOutput).toBeDefined();
    expect(changeOutput.address).toBe(customChangeAddress);
  });
});

describe('prepareTxData - Fee Tokens', () => {
  let wallet;
  let sendTransaction;

  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';

  const FEE_TOKEN_UID = 'fbt';

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: async () => '123',
      seed,
      network: new Network('testnet'),
    });
    // Mocking wallet methods
    wallet.getUtxoFromId = jest.fn();
    wallet.getUtxosForAmount = jest.fn();
    wallet.getCurrentAddress = jest
      .fn()
      .mockReturnValue({ address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc' });
    wallet.getTokenDetails = jest.fn().mockImplementation(async tokenUid => ({
      tokenInfo: {
        id: tokenUid,
        name: 'FeeToken',
        symbol: 'FBT',
        version: TokenVersion.FEE,
      },
    }));
  });

  it('should prepare fee token transaction with single output and charge 1 HTR fee', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    // Mock fee token UTXO
    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      if (txId === 'fee-token-tx' && index === 0) {
        return {
          txId: 'fee-token-tx',
          index: 0,
          value: 100n,
          address: 'fee-token-address',
          tokenId: FEE_TOKEN_UID,
          authorities: 0,
          addressPath: "m/44'/280'/0'/0/1",
        };
      }
      return null;
    });

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === FEE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'fee-token-tx',
              index: 0,
              value: 100n,
              tokenId: FEE_TOKEN_UID,
              address: 'fee-token-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/1",
            },
          ],
          changeAmount: 50n, // 100 - 50 = 50
        };
      }
      // HTR needed for fee payment (1 HTR per non-authority output)
      if (token === NATIVE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'htr-fee-tx',
              index: 0,
              value: 2n,
              tokenId: NATIVE_TOKEN_UID,
              address: 'htr-fee-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/2",
            },
          ],
          changeAmount: 1n, // 2 - 1 (fee) = 1
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 50n,
        token: FEE_TOKEN_UID,
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    // 1 fee token input + 1 HTR input for fee
    expect(txData.inputs).toHaveLength(2);
    // 1 output + 1 fee token change + 1 HTR change
    expect(txData.outputs).toHaveLength(3);
    expect(txData.tokens).toEqual([FEE_TOKEN_UID]);

    // Verify FeeHeader is present
    expect(txData.headers).toBeDefined();
    expect(txData.headers).toHaveLength(1);
    expect(txData.headers![0]).toBeInstanceOf(FeeHeader);

    // Verify the fee amount (1 HTR per non-authority fee token output)
    // 1 user output + 1 change output = 2 fee token outputs = 2 HTR fee
    const feeHeader = txData.headers![0] as FeeHeader;
    expect(feeHeader.entries[0].amount).toBe(2n * FEE_PER_OUTPUT);
  });

  it('should charge fee for each fee token output', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === FEE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'fee-token-tx',
              index: 0,
              value: 300n,
              tokenId: FEE_TOKEN_UID,
              address: 'fee-token-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/1",
            },
          ],
          changeAmount: 0n,
        };
      }
      // HTR needed for fee payment (3 HTR for 3 outputs)
      if (token === NATIVE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'htr-fee-tx',
              index: 0,
              value: 5n,
              tokenId: NATIVE_TOKEN_UID,
              address: 'htr-fee-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/2",
            },
          ],
          changeAmount: 2n, // 5 - 3 (fee) = 2
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    // 3 fee token outputs = 3 HTR fee expected
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: FEE_TOKEN_UID,
      },
      {
        type: OutputType.P2PKH,
        address: 'WP2rVhxzT3YTWg8VbBKkacLqLU2LrouWDy',
        value: 100n,
        token: FEE_TOKEN_UID,
      },
      {
        type: OutputType.P2PKH,
        address: 'WP3rVhxzT3YTWg8VbBKkacLqLU2LrouWDz',
        value: 100n,
        token: FEE_TOKEN_UID,
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    // 1 fee token input + 1 HTR input for fee
    expect(txData.inputs).toHaveLength(2);
    // 3 outputs + 1 HTR change
    expect(txData.outputs).toHaveLength(4);
    expect(txData.tokens).toEqual([FEE_TOKEN_UID]);

    // All 3 outputs should be for the fee token
    const feeTokenOutputs = txData.outputs.filter(o => o.token === FEE_TOKEN_UID);
    expect(feeTokenOutputs).toHaveLength(3);

    // Verify FeeHeader with correct fee (3 HTR for 3 outputs)
    expect(txData.headers).toHaveLength(1);
    const feeHeader = txData.headers![0] as FeeHeader;
    expect(feeHeader.entries[0].amount).toBe(3n * FEE_PER_OUTPUT);
  });

  it('should auto-select HTR to pay fee when not enough HTR in inputs', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    let htrCallCount = 0;
    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === FEE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'fee-token-tx',
              index: 0,
              value: 100n,
              tokenId: FEE_TOKEN_UID,
              address: 'fee-token-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/1",
            },
          ],
          changeAmount: 0n,
        };
      }
      if (token === NATIVE_TOKEN_UID) {
        htrCallCount++;
        // First call: for user output (1 HTR)
        // Second call: for fee payment (1 HTR)
        return {
          utxos: [
            {
              txId: `htr-tx-${htrCallCount}`,
              index: 0,
              value: 10n,
              tokenId: NATIVE_TOKEN_UID,
              address: 'htr-address',
              authorities: 0,
              addressPath: `m/44'/280'/0'/0/${htrCallCount + 1}`,
            },
          ],
          changeAmount: htrCallCount === 1 ? 9n : 9n,
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    // Fee token output + HTR output
    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: FEE_TOKEN_UID,
      },
      {
        type: OutputType.P2PKH,
        address: 'WP2rVhxzT3YTWg8VbBKkacLqLU2LrouWDy',
        value: 1n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    // Fee token input + HTR inputs (for output and for fee)
    expect(txData.inputs.length).toBeGreaterThanOrEqual(2);
    expect(txData.tokens).toEqual([FEE_TOKEN_UID]); // HTR is not in tokens array

    // HTR inputs should be auto-selected
    const htrInputs = txData.inputs.filter(i => i.token === NATIVE_TOKEN_UID);
    expect(htrInputs.length).toBeGreaterThanOrEqual(1);

    // FeeHeader should be present
    expect(txData.headers).toHaveLength(1);
  });

  it('should include FeeHeader in transaction when fee > 0', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === FEE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'fee-token-tx',
              index: 0,
              value: 100n,
              tokenId: FEE_TOKEN_UID,
              address: 'fee-token-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/1",
            },
          ],
          changeAmount: 50n,
        };
      }
      // HTR for fee payment
      if (token === NATIVE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'htr-fee-tx',
              index: 0,
              value: 2n,
              tokenId: NATIVE_TOKEN_UID,
              address: 'htr-fee-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/2",
            },
          ],
          changeAmount: 1n,
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 50n,
        token: FEE_TOKEN_UID,
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    // Verify we have the expected structure for fee token transaction
    expect(txData.tokens).toEqual([FEE_TOKEN_UID]);
    expect(txData.outputs.some(o => o.token === FEE_TOKEN_UID)).toBe(true);

    // FeeHeader should be automatically added by prepareTxData
    expect(txData.headers).toBeDefined();
    expect(txData.headers).toHaveLength(1);
    expect(txData.headers![0]).toBeInstanceOf(FeeHeader);

    // 1 user output + 1 change output = 2 fee token outputs = 2 HTR fee
    const feeHeader = txData.headers![0] as FeeHeader;
    expect(feeHeader.entries).toHaveLength(1);
    expect(feeHeader.entries[0].amount).toBe(2n * FEE_PER_OUTPUT);
  });

  it('should handle fee token with change output correctly', async () => {
    const mockIsValid = jest.spyOn(Address.prototype, 'isValid');
    mockIsValid.mockReturnValue(true);

    const mockGetType = jest.spyOn(Address.prototype, 'getType');
    mockGetType.mockReturnValue('p2pkh');

    let htrCallCount = 0;
    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { token }) => {
      if (token === FEE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'fee-token-tx',
              index: 0,
              value: 200n,
              tokenId: FEE_TOKEN_UID,
              address: 'fee-token-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/1",
            },
          ],
          changeAmount: 100n, // 200 - 100 = 100
        };
      }
      if (token === NATIVE_TOKEN_UID) {
        htrCallCount++;
        if (htrCallCount === 1) {
          // First call: for HTR output (2 HTR)
          return {
            utxos: [
              {
                txId: 'htr-tx',
                index: 0,
                value: 5n,
                tokenId: NATIVE_TOKEN_UID,
                address: 'htr-address',
                authorities: 0,
                addressPath: "m/44'/280'/0'/0/2",
              },
            ],
            changeAmount: 3n, // 5 - 2 (output) = 3
          };
        }
        // Second call: for fee payment (1 HTR for fee token output)
        // But we have 3 HTR change from first call, so need additional if fee > change
        return {
          utxos: [
            {
              txId: 'htr-fee-tx',
              index: 0,
              value: 2n,
              tokenId: NATIVE_TOKEN_UID,
              address: 'htr-fee-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/3",
            },
          ],
          changeAmount: 1n,
        };
      }
      return { utxos: [], changeAmount: 0n };
    });

    const outputs = [
      {
        type: OutputType.P2PKH,
        address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx',
        value: 100n,
        token: FEE_TOKEN_UID,
      },
      {
        type: OutputType.P2PKH,
        address: 'WP2rVhxzT3YTWg8VbBKkacLqLU2LrouWDy',
        value: 2n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    sendTransaction = new SendTransactionWalletService(wallet, { outputs });
    const txData = await sendTransaction.prepareTxData();

    // Fee token input + HTR inputs
    expect(txData.inputs.length).toBeGreaterThanOrEqual(2);
    expect(txData.tokens).toEqual([FEE_TOKEN_UID]);

    // Verify change outputs exist for fee token
    const feeTokenChange = txData.outputs.find(
      o => o.token === FEE_TOKEN_UID && o.address === 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc'
    );
    expect(feeTokenChange).toBeDefined();
    expect(feeTokenChange!.value).toBe(100n);

    // FeeHeader should be present
    expect(txData.headers).toHaveLength(1);
  });
});
