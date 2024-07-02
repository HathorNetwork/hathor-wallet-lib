/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { MemoryStore, Storage } from '../../src/storage';
import { scanPolicyStartAddresses, checkScanningPolicy } from '../../src/utils/storage';

describe('scanning policy methods', () => {
  it('start addresses', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const gapLimit = 27;
    jest.spyOn(storage, 'getGapLimit').mockReturnValue(Promise.resolve(gapLimit));
    jest.spyOn(storage, 'getScanningPolicy').mockReturnValue(Promise.resolve('gap-limit'));
    await expect(scanPolicyStartAddresses(storage)).resolves.toEqual({
      nextIndex: 0,
      count: gapLimit,
    });
  });

  it('check address scanning policy', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const gapLimit = 27;
    jest.spyOn(storage, 'getScanningPolicyData').mockReturnValue(
      Promise.resolve({
        policy: 'gap-limit',
        gapLimit,
      })
    );
    const policyMock = jest.spyOn(storage, 'getScanningPolicy');

    policyMock.mockReturnValue(Promise.resolve('gap-limit'));
    await expect(checkScanningPolicy(storage)).resolves.toEqual({
      nextIndex: 1,
      count: 26,
    });

    policyMock.mockReturnValue(Promise.resolve('invalid-policy'));
    await expect(checkScanningPolicy(storage)).resolves.toEqual(null);
  });
});
