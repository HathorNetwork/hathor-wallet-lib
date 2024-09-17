/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import PromiseQueue from '../../src/models/promise_queue';

describe('PromiseQueue operations', () => {
  it('should start unpaused and be pausable', () => {
    const q = new PromiseQueue();
    expect(q.isPaused).toBeFalsy();
    q.stop();
    expect(q.isPaused).toBeTruthy();
    q.continue();
    expect(q.isPaused).toBeFalsy();
  });

  it('should be able to set the concurrency', async () => {
    const q = new PromiseQueue();
    expect(q.concurrent).toEqual(1);
    q.concurrent = 3;
    expect(q.concurrent).toEqual(3);

    // Check that the concurrent actually runs only 2 tasks
    q.concurrent = 2;

    const task = async () => {
      return new Promise<void>(resolve => {
        setTimeout(resolve, 2000);
      });
    };
    q.add(task);
    q.add(task);
    q.add(task);
    // wait 50ms so jobs can start
    await new Promise<void>(resolve => {
      setTimeout(resolve, 50);
    });
    // Expect that only 2 jobs are running
    expect(q.jobsRunning).toEqual(2);

    // Wait for either all tasks to finish or a timeout.
    await Promise.race([
      new Promise<void>(resolve => {
        // idle is sent when the queue  is empty and there are no events running
        q.on('idle', resolve);
      }),
      new Promise<void>((_, reject) => {
        setTimeout(reject, 5000);
      }),
    ]);
  });
});
