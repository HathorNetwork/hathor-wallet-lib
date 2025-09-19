/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import PromiseQueue from '../models/promise_queue';

const MAX_CONCURRENT_LOAD_TASKS = 3;

const GLL = new PromiseQueue();
GLL.concurrent = MAX_CONCURRENT_LOAD_TASKS;

export default GLL;

export function stopGLLBackgroundTask() {
  GLL.stopBackgroundTask();
}
