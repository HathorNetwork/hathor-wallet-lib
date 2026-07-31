/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import NanoContractTransactionBuilder from '../../src/nano_contracts/builder';
import Network from '../../src/models/network';
import HathorWallet from '../../src/new/wallet';
import { NanoContractActionType } from '../../src/nano_contracts/types';
import Address from '../../src/models/address';
import { NANO_CONTRACTS_INITIALIZE_METHOD, NATIVE_TOKEN_UID } from '../../src/constants';

/**
 * Change-address resolution in the builder.
 *
 * Two independent change addresses are in play: the one a deposit action
 * declares for its own change, and the transaction-level one used for the
 * change of whatever the builder itself selects (notably the fee). These tests
 * pin the precedence between them and the ownership check on the second, both
 * of which are otherwise only reachable through an integration run.
 */
describe('NanoContractTransactionBuilder change addresses', () => {
  const network = new Network('testnet');

  // Three distinct real testnet addresses so getAddressType resolves each.
  const ACTION_ADDRESS = 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi';
  const TX_ADDRESS = 'WSFK832SPd6WKzpKkymj5Ya4JLnkvW2Y5A';
  const CURRENT_ADDRESS = 'WU2hD9d38tK9Gw1QuvT7Qc9Pe9ZvhuuCvY';
  const FOREIGN_ADDRESS = 'WVGsakYbCprn8oc5f1QcxEzKxWAHUibQGR';

  function makeWallet(overrides = {}) {
    return {
      getNetworkObject: () => network,
      isAddressMine: jest.fn().mockResolvedValue(true),
      markUtxoSelected: jest.fn().mockResolvedValue(undefined),
      getCurrentAddress: jest.fn().mockResolvedValue({ address: CURRENT_ADDRESS }),
      getUtxosForAmount: jest.fn().mockResolvedValue({
        utxos: [
          {
            txId: 'a'.repeat(64),
            index: 0,
            value: 30n,
            authorities: 0n,
            tokenId: NATIVE_TOKEN_UID,
            address: CURRENT_ADDRESS,
          },
        ],
        changeAmount: 20n,
      }),
      ...overrides,
    } as unknown as HathorWallet;
  }

  /**
   * The middle rung is the one this precedence table exists for: with an action
   * that declares no change address of its own, the transaction-level address
   * has to win over the wallet's current address. Dropping it would otherwise
   * leave every existing test green.
   */
  it.each([
    ['action address wins over the transaction one', ACTION_ADDRESS, TX_ADDRESS, ACTION_ADDRESS],
    [
      'transaction address is used when the action declares none',
      undefined,
      TX_ADDRESS,
      TX_ADDRESS,
    ],
    ['current address is the last resort', undefined, null, CURRENT_ADDRESS],
  ])('%s', async (_name, actionAddress, txAddress, expected) => {
    const builder = new NanoContractTransactionBuilder().setWallet(makeWallet());
    if (txAddress) {
      builder.setChangeAddress(txAddress);
    }

    const { outputs } = await builder.executeDeposit({
      type: NanoContractActionType.DEPOSIT,
      token: NATIVE_TOKEN_UID,
      amount: 10n,
      ...(actionAddress ? { changeAddress: actionAddress } : {}),
    });

    expect(outputs).toHaveLength(1);
    expect(outputs[0].isChange).toBe(true);
    expect(outputs[0].address).toBe(expected);
  });

  it('rejects a deposit change address that is not the wallet’s', async () => {
    const builder = new NanoContractTransactionBuilder().setWallet(
      makeWallet({ isAddressMine: jest.fn().mockResolvedValue(false) })
    );

    await expect(
      builder.executeDeposit({
        type: NanoContractActionType.DEPOSIT,
        token: NATIVE_TOKEN_UID,
        amount: 10n,
        changeAddress: FOREIGN_ADDRESS,
      })
    ).rejects.toThrow('Change address must belong to the same wallet.');
  });

  /**
   * The transaction-level address is validated up front rather than at each use
   * site, so a bad one fails before any utxo is selected. Its message is
   * distinct from the deposit one above precisely so a caller holding both can
   * tell which was rejected — assert the wording, not just the throw.
   */
  it('rejects a transaction change address that is not the wallet’s', async () => {
    const isAddressMine = jest.fn().mockResolvedValue(false);
    const builder = new NanoContractTransactionBuilder()
      .setWallet(makeWallet({ isAddressMine }))
      // initialize + a preset blueprint id keeps verify() off the network, so
      // the change-address check is reached without a fullnode.
      .setMethod(NANO_CONTRACTS_INITIALIZE_METHOD)
      .setBlueprintId('b'.repeat(64))
      .setCaller(new Address(CURRENT_ADDRESS, { network }));
    builder.setChangeAddress(FOREIGN_ADDRESS);

    await expect(builder.verify()).rejects.toThrow(
      'Transaction change address must belong to the same wallet.'
    );
    expect(isAddressMine).toHaveBeenCalledWith(FOREIGN_ADDRESS);
  });
});
