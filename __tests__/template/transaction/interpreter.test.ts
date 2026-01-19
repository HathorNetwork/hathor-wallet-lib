/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../../src/new/wallet';
import { TxTemplateContext } from '../../../src/template/transaction/context';
import { WalletTxTemplateInterpreter } from '../../../src/template/transaction/interpreter';
import FeeHeader from '../../../src/headers/fee';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { getDefaultLogger } from '../../../src/types';

describe('Wallet tx-template interpreter', () => {
  it('should get an address from the wallet', async () => {
    const wallet = {
      getCurrentAddress: jest.fn().mockResolvedValue({ address: 'mocked-address' }),
    } as unknown as HathorWallet;
    const interpreter = new WalletTxTemplateInterpreter(wallet);
    await expect(interpreter.getAddress()).resolves.toStrictEqual('mocked-address');
    expect(wallet.getCurrentAddress).toHaveBeenCalledTimes(1);
  });
  it('should get address at specific index', async () => {
    const wallet = {
      getAddressAtIndex: jest.fn().mockResolvedValue('mocked-address'),
    } as unknown as HathorWallet;
    const interpreter = new WalletTxTemplateInterpreter(wallet);
    await expect(interpreter.getAddressAtIndex(123)).resolves.toStrictEqual('mocked-address');
    expect(wallet.getAddressAtIndex).toHaveBeenCalledTimes(1);
    expect(wallet.getAddressAtIndex).toHaveBeenCalledWith(123);
  });

  it('should get balance from wallet', async () => {
    const wallet = {
      getBalance: jest.fn().mockResolvedValue(['mocked-balance']),
    } as unknown as HathorWallet;
    const interpreter = new WalletTxTemplateInterpreter(wallet);
    await expect(interpreter.getBalance('a-token-uid')).resolves.toStrictEqual('mocked-balance');
    expect(wallet.getBalance).toHaveBeenCalledTimes(1);
    expect(wallet.getBalance).toHaveBeenCalledWith('a-token-uid');
  });

  it('should get a change address from the wallet', async () => {
    const wallet = {
      getCurrentAddress: jest.fn().mockResolvedValue({ address: 'mocked-address' }),
    } as unknown as HathorWallet;
    const interpreter = new WalletTxTemplateInterpreter(wallet);
    const ctx = new TxTemplateContext();
    await expect(interpreter.getChangeAddress(ctx)).resolves.toStrictEqual('mocked-address');
    expect(wallet.getCurrentAddress).toHaveBeenCalledTimes(1);
  });

  it('should get token details from the wallet api', async () => {
    const mockValue = {
      totalSupply: 1000n,
      totalTransactions: 1,
      tokenInfo: {
        name: 'FeeBasedToken',
        symbol: 'FBT',
        version: 2, // TokenVersion.FEE
      },
      authorities: {
        mint: true,
        melt: true,
      },
    };
    const wallet = {
      getTokenDetails: jest.fn().mockResolvedValue(mockValue),
    } as unknown as HathorWallet;
    const interpreter = new WalletTxTemplateInterpreter(wallet);
    await expect(interpreter.getTokenDetails('fbt-token-uid')).resolves.toStrictEqual(mockValue);
    expect(wallet.getTokenDetails).toHaveBeenCalledTimes(1);
  });

  describe('buildFeeHeader', () => {
    const token1 = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';
    const token2 = '0000000220eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670f';

    it('should build a FeeHeader with HTR fee entry', async () => {
      const wallet = {
        logger: getDefaultLogger(),
      } as unknown as HathorWallet;

      const interpreter = new WalletTxTemplateInterpreter(wallet);
      const tx = await interpreter.build([
        { type: 'action/fee', token: NATIVE_TOKEN_UID, amount: 100n },
      ]);

      expect(tx.headers).toHaveLength(1);
      expect(tx.headers[0]).toBeInstanceOf(FeeHeader);

      const feeHeader = tx.getFeeHeader();
      expect(feeHeader).not.toBeNull();
      expect(feeHeader!.entries).toHaveLength(1);
      expect(feeHeader!.entries[0].tokenIndex).toBe(0); // HTR is always index 0
      expect(feeHeader!.entries[0].amount).toBe(100n);
    });

    it('should build a FeeHeader with custom token fee entry', async () => {
      const wallet = {
        logger: getDefaultLogger(),
        getTokenDetails: jest.fn().mockResolvedValue({
          totalSupply: 1000n,
          totalTransactions: 1,
          tokenInfo: { name: 'Token1', symbol: 'TK1', version: 2 },
          authorities: { mint: true, melt: true },
        }),
      } as unknown as HathorWallet;

      const interpreter = new WalletTxTemplateInterpreter(wallet);
      const tx = await interpreter.build([
        // First add the token to the context so it gets a token index
        { type: 'output/raw', script: 'cafe', amount: 10n, token: token1 },
        // Then add the fee
        { type: 'action/fee', token: token1, amount: 500n },
      ]);

      expect(tx.headers).toHaveLength(1);
      const feeHeader = tx.getFeeHeader();
      expect(feeHeader).not.toBeNull();
      expect(feeHeader!.entries).toHaveLength(1);
      expect(feeHeader!.entries[0].tokenIndex).toBe(1); // Custom token is index 1
      expect(feeHeader!.entries[0].amount).toBe(500n);
    });

    it('should build a FeeHeader with multiple fee entries', async () => {
      const wallet = {
        logger: getDefaultLogger(),
        getTokenDetails: jest.fn().mockImplementation(token => {
          if (token === token1) {
            return Promise.resolve({
              totalSupply: 1000n,
              totalTransactions: 1,
              tokenInfo: { name: 'Token1', symbol: 'TK1', version: 2 },
              authorities: { mint: true, melt: true },
            });
          }
          if (token === token2) {
            return Promise.resolve({
              totalSupply: 2000n,
              totalTransactions: 2,
              tokenInfo: { name: 'Token2', symbol: 'TK2', version: 2 },
              authorities: { mint: true, melt: true },
            });
          }
          return Promise.reject(new Error('Unknown token'));
        }),
      } as unknown as HathorWallet;

      const interpreter = new WalletTxTemplateInterpreter(wallet);
      const tx = await interpreter.build([
        // Add tokens to the context
        { type: 'output/raw', script: 'cafe', amount: 10n, token: token1 },
        { type: 'output/raw', script: 'cafe', amount: 20n, token: token2 },
        // Add fees for multiple tokens
        { type: 'action/fee', token: NATIVE_TOKEN_UID, amount: 100n },
        { type: 'action/fee', token: token1, amount: 200n },
        { type: 'action/fee', token: token2, amount: 300n },
      ]);

      expect(tx.headers).toHaveLength(1);
      const feeHeader = tx.getFeeHeader();
      expect(feeHeader).not.toBeNull();
      expect(feeHeader!.entries).toHaveLength(3);

      // Find entries by tokenIndex
      const htrEntry = feeHeader!.entries.find(e => e.tokenIndex === 0);
      const token1Entry = feeHeader!.entries.find(e => e.tokenIndex === 1);
      const token2Entry = feeHeader!.entries.find(e => e.tokenIndex === 2);

      expect(htrEntry).toBeDefined();
      expect(htrEntry!.amount).toBe(100n);

      expect(token1Entry).toBeDefined();
      expect(token1Entry!.amount).toBe(200n);

      expect(token2Entry).toBeDefined();
      expect(token2Entry!.amount).toBe(300n);
    });

    it('should accumulate fees for the same token', async () => {
      const wallet = {
        logger: getDefaultLogger(),
      } as unknown as HathorWallet;

      const interpreter = new WalletTxTemplateInterpreter(wallet);
      const tx = await interpreter.build([
        { type: 'action/fee', token: NATIVE_TOKEN_UID, amount: 50n },
        { type: 'action/fee', token: NATIVE_TOKEN_UID, amount: 30n },
        { type: 'action/fee', token: NATIVE_TOKEN_UID, amount: 20n },
      ]);

      expect(tx.headers).toHaveLength(1);
      const feeHeader = tx.getFeeHeader();
      expect(feeHeader).not.toBeNull();
      expect(feeHeader!.entries).toHaveLength(1);
      expect(feeHeader!.entries[0].tokenIndex).toBe(0);
      expect(feeHeader!.entries[0].amount).toBe(100n); // 50 + 30 + 20
    });

    it('should not add FeeHeader when no fees are present', async () => {
      const wallet = {
        logger: getDefaultLogger(),
      } as unknown as HathorWallet;

      const interpreter = new WalletTxTemplateInterpreter(wallet);
      const tx = await interpreter.build([]);

      expect(tx.headers).toHaveLength(0);
      expect(tx.getFeeHeader()).toBeNull();
    });
  });
});
