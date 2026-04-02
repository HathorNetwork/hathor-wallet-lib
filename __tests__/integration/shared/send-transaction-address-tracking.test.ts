/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared address tracking tests.
 *
 * Validates that numTransactions is correctly tracked per address after
 * sending transactions, for both the fullnode ({@link HathorWallet}) and
 * wallet-service ({@link HathorWalletServiceWallet}) facades.
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] sendTransaction — address tracking — $name', adapter => {
  let wallet: FuzzyWalletType;
  let externalWallet: FuzzyWalletType;

  beforeAll(async () => {
    await adapter.suiteSetup();

    const created = await adapter.createWallet();
    wallet = created.wallet;
    await adapter.injectFunds(wallet, (await wallet.getAddressAtIndex(0))!, 10n);

    externalWallet = (await adapter.createWallet()).wallet;
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should track address usage for HTR transactions', async () => {
    const addr0 = (await wallet.getAddressAtIndex(0))!;
    const addr2 = (await wallet.getAddressAtIndex(2))!;

    // Send within wallet — addr0 is input, addr2 is recipient, addr1 gets change
    const { transaction: tx1 } = await adapter.sendTransaction(wallet, addr2, 6n);

    expect(tx1).toMatchObject({
      hash: expect.any(String),
      inputs: expect.any(Array),
      outputs: expect.any(Array),
      version: expect.any(Number),
      weight: expect.any(Number),
      nonce: expect.any(Number),
      timestamp: expect.any(Number),
      parents: expect.any(Array),
      tokens: expect.any(Array),
    });

    // addr0: funding tx + send tx = 2
    const info0 = await adapter.getAddressInfo(wallet, addr0);
    expect(info0).toHaveProperty('numTransactions', 2);

    // addr1: change output = 1
    const addr1 = (await wallet.getAddressAtIndex(1))!;
    const info1 = await adapter.getAddressInfo(wallet, addr1);
    expect(info1).toHaveProperty('numTransactions', 1);

    // addr2: recipient = 1
    const info2 = await adapter.getAddressInfo(wallet, addr2);
    expect(info2).toHaveProperty('numTransactions', 1);

    // Send to external wallet with explicit change address
    const addr5 = (await wallet.getAddressAtIndex(5))!;
    const externalAddr = (await externalWallet.getAddressAtIndex(0))!;
    await adapter.sendTransaction(wallet, externalAddr, 8n, { changeAddress: addr5 });

    const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(2n);

    // addr5: change output = 1
    const info5 = await adapter.getAddressInfo(wallet, addr5);
    expect(info5).toHaveProperty('numTransactions', 1);

    // addr6: never used = 0
    const addr6 = (await wallet.getAddressAtIndex(6))!;
    const info6 = await adapter.getAddressInfo(wallet, addr6);
    expect(info6).toHaveProperty('numTransactions', 0);
  });
});
