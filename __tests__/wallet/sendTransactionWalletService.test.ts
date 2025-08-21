/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NATIVE_TOKEN_UID } from '../../src/constants';
import SendTransactionWalletService from '../../src/wallet/sendTransactionWalletService';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { OutputType } from '../../src/wallet/types';
import Network from '../../src/models/network';
import Address from '../../src/models/address';

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

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { tokenId }) => {
      if (tokenId === NATIVE_TOKEN_UID) {
        return {
          utxos: [
            {
              txId: 'another-spent-tx-id',
              index: 0,
              value: 2n,
              token: NATIVE_TOKEN_UID,
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

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { tokenId }) => {
      if (tokenId === '01') {
        return {
          utxos: [
            {
              txId: 'utxo-tx-id',
              index: 0,
              value: 30n,
              token: '01',
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

  it('should throw error when UTXO cannot be retrieved during final input processing', async () => {
    // First call returns the UTXO, second call returns null (simulating retrieval failure)
    let callCount = 0;
    wallet.getUtxoFromId.mockImplementation(async (txId, index) => {
      callCount++;
      if (callCount === 1 && txId === 'flaky-tx' && index === 0) {
        return {
          txId: 'flaky-tx',
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

    const inputs = [{ txId: 'flaky-tx', index: 0 }];
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
      'Could not retrieve utxo details for input flaky-tx:0'
    );
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
          token: '01',
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

    wallet.getUtxosForAmount.mockImplementation(async (totalAmount, { tokenId }) => {
      if (tokenId === '02') {
        return {
          utxos: [
            {
              txId: 'auto-selected-tx',
              index: 0,
              value: 30n,
              token: '02',
              address: 'auto-address',
              authorities: 0,
              addressPath: "m/44'/280'/0'/0/2",
            },
          ],
          changeAmount: 10n, // 30 - 20 = 10
        };
      }
      if (tokenId === NATIVE_TOKEN_UID) {
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
          token: '01',
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
});
