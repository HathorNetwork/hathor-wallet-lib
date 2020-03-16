/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Class to define the current storage instance to be used at the moment
 *
 * Any storage access will be done by StorageProxy.getStorage().method
 * and this allow many storage instances to exist.
 *
 * Anytime you want to change the current storage instance to be used,
 * just need to call StorageProxy.setStorage(storage)
 *
 * @class
 * @name StorageProxy
 */
class StorageProxy {
  constructor() {
    this.storage = null;
  }

  /**
   * Set current storage
   *
   * @param {Storage} storage The storage to be used
   */
  setStorage(storage) {
    this.storage = storage;
  }

  /**
   * Get storage object to be used
   *
   * @return {Storage} Storage object to be used at the moment
   */
  getStorage() {
    return this.storage
  }
}

const instance = new StorageProxy();

export default instance;