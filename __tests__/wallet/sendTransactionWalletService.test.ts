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
    'wood candy festival desk bachelor arrive pumpkin swarm stairs jar feel ship edit drill always calm what oven lobster lesson eternal foot monkey toast';

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: async () => '123',
      seed,
      network: new Network('testnet'),
    });
    // Mocking wallet methods
    wallet.getUtxoFromId = jest.fn();
    wallet.getUtxosForAmount = jest.fn();
    wallet.getCurrentAddress = jest.fn().mockReturnValue({ address: 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc' });
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
});
