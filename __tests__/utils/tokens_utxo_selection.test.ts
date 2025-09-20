/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import tokensUtils from '../../src/utils/tokens';
import { WalletServiceStorage } from '../../src/storage/wallet_service_memory_storage';
import { MemoryStore, Storage } from '../../src/storage';
import HathorWalletServiceWallet from '../../src/wallet/wallet';

// Mock dependencies
jest.mock('../../src/wallet/wallet');

describe('tokensUtils.getUtxoSelectionAlgorithm', () => {
  let mockWallet: jest.Mocked<HathorWalletServiceWallet>;
  let memoryStore: MemoryStore;
  let regularStorage: Storage;
  let walletServiceStorage: WalletServiceStorage;

  beforeEach(() => {
    mockWallet = {
      getUtxos: jest.fn(),
    } as jest.Mocked<HathorWalletServiceWallet>;

    memoryStore = new MemoryStore();
    regularStorage = new Storage(memoryStore);
    walletServiceStorage = new WalletServiceStorage(memoryStore, mockWallet);
  });

  it('should return walletServiceUtxoSelection for WalletServiceStorage', () => {
    const algorithm = tokensUtils.getUtxoSelectionAlgorithm(walletServiceStorage, null);

    // The function should be a bound version of walletServiceUtxoSelection
    expect(typeof algorithm).toBe('function');
    expect(algorithm.name).toBe('bound walletServiceUtxoSelection');
  });

  it('should return provided algorithm for non-WalletServiceStorage', () => {
    const mockAlgorithm = jest.fn();

    const algorithm = tokensUtils.getUtxoSelectionAlgorithm(regularStorage, mockAlgorithm);

    expect(algorithm).toBe(mockAlgorithm);
  });

  it('should return bestUtxoSelection as fallback for non-WalletServiceStorage with null algorithm', () => {
    const algorithm = tokensUtils.getUtxoSelectionAlgorithm(regularStorage, null);

    // Should return the default bestUtxoSelection function
    expect(typeof algorithm).toBe('function');
    expect(algorithm).not.toBe(walletServiceStorage.walletServiceUtxoSelection);
  });
});
