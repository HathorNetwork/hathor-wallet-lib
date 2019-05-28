class Storage {
  constructor() {
    if (!Storage.instance) {
      this.store = null;
      this.memory = false;
    }
    return Storage.instance;
  }

  setStorage(myStorage) {
    this.store = myStorage;
  }

  getItem(key) {
    return this.store.getItem(key);
  }

  setItem(key, value) {
    return this.store.setItem(key, value);
  }

  removeItem(key) {
    return this.store.removeItem(key);
  }

  clear() {
    return this.store.clear();
  }

  key(n) {
    return this.store.key(n);
  }

  preStart() {
    return this.store.preStart();
  }
}

const instance = new Storage();

export default instance;
