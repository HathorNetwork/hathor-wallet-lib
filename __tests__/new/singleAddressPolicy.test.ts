/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MemoryStore, Storage } from '../../src/storage';
import { SCANNING_POLICY } from '../../src/types';
import {
  scanPolicyStartAddresses,
  checkScanningPolicy,
} from '../../src/utils/storage';

describe('single-address policy integration', () => {
  it('should load only 1 address and never request more', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);

    // Set single-address policy
    await storage.setScanningPolicyData({ policy: SCANNING_POLICY.SINGLE_ADDRESS });

    // scanPolicyStartAddresses should return 1 address starting at 0
    const startAddresses = await scanPolicyStartAddresses(storage);
    expect(startAddresses).toEqual({ nextIndex: 0, count: 1 });

    // Save the single address
    await store.saveAddress({
      base58: 'addr0',
      bip32AddressIndex: 0,
    });

    // checkScanningPolicy should never request more
    const moreAddresses = await checkScanningPolicy(storage);
    expect(moreAddresses).toBeNull();
  });

  it('should not advance currentAddressIndex when saving tx', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);

    await storage.setScanningPolicyData({ policy: SCANNING_POLICY.SINGLE_ADDRESS });

    await store.saveAddress({
      base58: 'addr0',
      bip32AddressIndex: 0,
    });

    // Verify initial state
    let walletData = await store.getWalletData();
    expect(walletData.currentAddressIndex).toBe(0);

    // Save a transaction that references addr0
    await store.saveTx({
      tx_id: 'tx1',
      version: 1,
      weight: 1,
      timestamp: 1,
      is_voided: false,
      inputs: [],
      outputs: [
        {
          value: 100n,
          token: '00',
          token_data: 0,
          script: 'dummyscript',
          decoded: { type: 'P2PKH', address: 'addr0', timelock: null },
          spent_by: null,
          selected_as_input: false,
        },
      ],
      parents: [],
    });

    // currentAddressIndex should still be 0
    walletData = await store.getWalletData();
    expect(walletData.currentAddressIndex).toBe(0);
  });

  it('getCurrentAddress with markAsUsed should always return same address', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);

    await storage.setScanningPolicyData({ policy: SCANNING_POLICY.SINGLE_ADDRESS });

    await store.saveAddress({
      base58: 'addr0',
      bip32AddressIndex: 0,
    });

    const addr1 = await store.getCurrentAddress(true);
    const addr2 = await store.getCurrentAddress(true);
    const addr3 = await store.getCurrentAddress(true);

    expect(addr1).toBe('addr0');
    expect(addr2).toBe('addr0');
    expect(addr3).toBe('addr0');

    const walletData = await store.getWalletData();
    expect(walletData.currentAddressIndex).toBe(0);
  });
});
