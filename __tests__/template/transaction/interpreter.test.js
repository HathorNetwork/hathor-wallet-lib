/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { WalletTxTemplateInterpreter } from '../../../src/template/transaction/interpreter';

describe('Wallet tx-template interpreter', () => {
  it('should get an address from the wallet', async () => {
    const wallet = {
      getCurrentAddress: jest.fn().mockResolvedValue({ address: 'mocked-address' }),
    };
    const interpreter = WalletTxTemplateInterpreter(wallet);
    await expect(interpreter.getAddress()).resolves.toStrictEqual('mocked-address');
    expect(wallet.getCurrentAddress).toHaveBeenCalledTimes(1);
  });
  it('should get address at specific index', async () => {
    const wallet = {
      getAddressAtIndex: jest.fn().mockResolvedValue('mocked-address'),
    };
    const interpreter = WalletTxTemplateInterpreter(wallet);
    await expect(interpreter.getAddressAtIndex(123)).resolves.toStrictEqual('mocked-address');
    expect(wallet.getAddressAtIndex).toHaveBeenCalledTimes(1);
    expect(wallet.getAddressAtIndex).toHaveBeenCalledWith(123);
  });

  it('should get balance from wallet', async () => {
    const wallet = {
      getBalance: jest.fn().mockResolvedValue('mocked-balance'),
    };
    const interpreter = WalletTxTemplateInterpreter(wallet);
    await expect(interpreter.getBalance('a-token-uid')).resolves.toStrictEqual('mocked-balance');
    expect(wallet.getBalance).toHaveBeenCalledTimes(1);
    expect(wallet.getBalance).toHaveBeenCalledWith('a-token-uid');
  });

  it('should get an address from the wallet', async () => {
    const wallet = {
      getCurrentAddress: jest.fn().mockResolvedValue({ address: 'mocked-address' }),
    };
    const interpreter = WalletTxTemplateInterpreter(wallet);
    await expect(interpreter.getChangeAddress()).resolves.toStrictEqual('mocked-address');
    expect(wallet.getCurrentAddress).toHaveBeenCalledTimes(1);
  });
});
