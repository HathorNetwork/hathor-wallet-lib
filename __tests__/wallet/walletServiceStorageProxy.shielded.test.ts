/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { WalletServiceStorageProxy } from '../../src/wallet/walletServiceStorageProxy';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src/storage';
import walletUtils from '../../src/utils/wallet';
import {
  shieldedFixtureSeed,
  shieldedFixtureAddresses,
  legacyFixtureAddress,
} from '../__mock_helpers__/shielded-ws.fixtures';

async function setup(shielded: boolean) {
  const storage = new Storage(new MemoryStore());
  await storage.saveAccessData(
    walletUtils.generateAccessDataFromSeed(shieldedFixtureSeed, {
      networkName: 'testnet',
      password: 'password',
      pin: '1234',
    })
  );
  const wallet = new HathorWalletServiceWallet({
    requestPassword: jest.fn(),
    seed: shieldedFixtureSeed,
    network: new Network('testnet'),
    storage,
  });
  (wallet as unknown as { shieldedEnabled: boolean }).shieldedEnabled = shielded;
  return { wallet, proxy: new WalletServiceStorageProxy(wallet, storage).createProxy() };
}

describe('getAddressInfo on the shielded spend chain', () => {
  it('marks a spend address of the wallet as shielded-spend', async () => {
    const { wallet, proxy } = await setup(true);
    jest.spyOn(wallet, 'getAddressDetails').mockResolvedValue({
      address: shieldedFixtureAddresses[3].spendBase58,
      index: 3,
      transactions: 1,
      seqnum: 0,
    });
    await expect(
      proxy.getAddressInfo(shieldedFixtureAddresses[3].spendBase58)
    ).resolves.toMatchObject({ bip32AddressIndex: 3, addressType: 'shielded-spend' });
  });

  it('leaves a legacy address unmarked, even at the same index', async () => {
    const { wallet, proxy } = await setup(true);
    jest.spyOn(wallet, 'getAddressDetails').mockResolvedValue({
      address: legacyFixtureAddress,
      index: 3,
      transactions: 1,
      seqnum: 0,
    });
    const info = await proxy.getAddressInfo(legacyFixtureAddress);
    expect(info?.addressType).toBeUndefined();
  });

  it('does not mark addresses of a wallet without shielded keys', async () => {
    const { wallet, proxy } = await setup(false);
    jest.spyOn(wallet, 'getAddressDetails').mockResolvedValue({
      address: shieldedFixtureAddresses[3].spendBase58,
      index: 3,
      transactions: 1,
      seqnum: 0,
    });
    const info = await proxy.getAddressInfo(shieldedFixtureAddresses[3].spendBase58);
    expect(info?.addressType).toBeUndefined();
  });
});
