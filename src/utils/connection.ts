/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage } from '../types';

/**
 * Store a network height the fullnode sent, and unlock the block rewards that
 * leave the reward lock at it. A height equal to the stored one changes nothing.
 *
 * @param storage The wallet storage
 * @param height The network height
 */
export async function updateNetworkHeight(storage: IStorage, height: number): Promise<void> {
  const currentHeight = await storage.getCurrentHeight();
  if (height !== currentHeight) {
    await storage.setCurrentHeight(height);
    storage.unlockUtxos(height);
  }
}

export function handleWsDashboard(storage: IStorage) {
  return (data: { best_block_height: number }) => {
    updateNetworkHeight(storage, data.best_block_height);
  };
}

export function handleSubscribeAddress() {
  return (data: { success?: boolean; message?: string }) => {
    if (data.success === false) {
      // If an address subscription fails we stop the service
      throw new Error(data.message);
    }
  };
}
