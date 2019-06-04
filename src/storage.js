/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Interface to use the storage object set by the client
 *
 * This storage should have the same methods as localStorage (from the browser) and has
 * to support storaing js objects. It should handle any serialization needed.
 *
 * @class
 * @name Storage
 */
class Storage {
  constructor() {
    if (!Storage.instance) {
      this.store = null;
      this.memory = false;
    }
    return Storage.instance;
  }

  /**
   * Set the underlying storage object
   *
   * @param {Object} myStorage The storage to be used
   */
  setStorage(myStorage) {
    this.store = myStorage;
  }

  /**
   * Return the current value associated with the given key
   *
   * @param {string} key Key associated with the object
   *
   * @return {Object} the object stored
   */
  getItem(key) {
    return this.store.getItem(key);
  }

  /**
   * Add the given object to the storage
   *
   * @param {string} key Key associated with the object
   * @param {Object} value Object to be stored
   */
  setItem(key, value) {
    return this.store.setItem(key, value);
  }

  /**
   * Remove the key and associated object from storage
   *
   * @param {string} key Key associated with the object
   */
  removeItem(key) {
    return this.store.removeItem(key);
  }

  /**
   * Remove all key and associated objects from storage
   */
  clear() {
    return this.store.clear();
  }

  /**
   * Return the name of the nth key in storage
   *
   * @param {string} n
   *
   * @return {Object} Object associated with nth key
   */
  key(n) {
    return this.store.key(n);
  }

  /**
   * This method is optional and may be used to initialize the storage before the
   * lib starts using it
   */
  preStart() {
    return this.store.preStart();
  }
}

const instance = new Storage();

export default instance;
