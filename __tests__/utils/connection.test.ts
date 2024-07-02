/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MemoryStore, Storage } from '../../src/storage';
import { handleSubscribeAddress, handleWsDashboard } from '../../src/utils/connection';

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

test('handle subscribe address', () => {
  const handler = handleSubscribeAddress();
  handler({ success: true });
  handler({ data: 'anything' });
  expect(() => {
    handler({ success: false, message: 'a known error' });
  }).toThrow('a known error');
});
