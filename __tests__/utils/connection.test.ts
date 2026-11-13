/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MemoryStore, Storage } from '../../src/storage';
import {
  handleSubscribeAddress,
  handleWsDashboard,
  updateNetworkHeight,
} from '../../src/utils/connection';

test('handle ws dashboard', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'setCurrentHeight');
  const handler = handleWsDashboard(storage);
  expect(storage.setCurrentHeight).not.toHaveBeenCalled();
  expect(await storage.getCurrentHeight()).toEqual(0);
  handler({ best_block_height: 100 });
  // Await setCurrentHeight to run
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  expect(storage.setCurrentHeight).toHaveBeenCalled();
  expect(await storage.getCurrentHeight()).toEqual(100);
});

test('updateNetworkHeight stores a new height before it unlocks at it', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  const unlockUtxos = jest.spyOn(storage, 'unlockUtxos').mockImplementation(async height => {
    // The height is already stored when the unlock pass starts.
    expect(await storage.getCurrentHeight()).toEqual(height);
  });

  await updateNetworkHeight(storage, 100);
  expect(await storage.getCurrentHeight()).toEqual(100);
  expect(unlockUtxos).toHaveBeenCalledTimes(1);
  expect(unlockUtxos).toHaveBeenCalledWith(100);

  // The same height again changes nothing.
  await updateNetworkHeight(storage, 100);
  expect(unlockUtxos).toHaveBeenCalledTimes(1);
});

test('handle subscribe address', () => {
  const handler = handleSubscribeAddress();
  handler({ success: true });
  handler({ data: 'anything' });
  expect(() => {
    handler({ success: false, message: 'a known error' });
  }).toThrow('a known error');
});
