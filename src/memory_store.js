/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export default class MemoryStore {
  constructor() {
    this.hathorMemoryStorage = {};
  }

  getItem(key) {
    const ret = this.hathorMemoryStorage[key];
    if (ret === undefined) {
      return null
    }
    return ret;
  }

  setItem(key, value) {
    this.hathorMemoryStorage[key] = value;
  }

  removeItem(key) {
    delete this.hathorMemoryStorage[key];
  }

  clear() {
    this.hathorMemoryStorage = {};
  }
}