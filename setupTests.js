/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

process.env.NODE_ENV = 'test';

// Creating memory storage to be used in the place of localStorage
class MemoryOnlyStore {
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

// Mocking localStorage for tests
import 'jest-localstorage-mock';
const storage = require('./src/storage').default;

// Mocking WebSocket for tests
import { Server, WebSocket } from 'mock-socket';
global.WebSocket = WebSocket;

import helpers from './src/helpers';

storage.setStore(new MemoryOnlyStore());
storage.setItem('wallet:server', 'http://localhost:8080/');
let wsURL = helpers.getWSServerURL();

// Creating a ws mock server
const mockServer = new Server(wsURL);
mockServer.on('connection', socket => {
  socket.on('message', data => {
    let jsonData = JSON.parse(data);
    if (jsonData.type === 'subscribe_address') {
      // Only for testing purposes
      socket.send(JSON.stringify({'type': 'subscribe_success', 'address': jsonData.address}));
    } else if (jsonData.type === 'ping') {
      socket.send(JSON.stringify({'type': 'pong'}));
    }
  });
});

// When using asyncronous test jest expect does not raise fail
// so we need to call done.fail() ourselves when some test is wrong
global.check = (realValue, expectedValue, doneCb) => {
  if (expectedValue !== realValue) {
    doneCb.fail(`${expectedValue} != ${realValue}`);
  }
}

global.checkNot = (realValue, notExpectedValue, doneCb) => {
  if (notExpectedValue === realValue) {
    doneCb.fail(`${notExpectedValue} != ${realValue}`);
  }
}

global.isObjectEmpty = (obj) => {
  return Object.entries(obj).length === 0 && obj.constructor === Object
}

// Mocking axios
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
global.mock = new MockAdapter(axios);

// Default mock for /thin_wallet/address_history
mock.onGet('thin_wallet/address_history').reply((config) => {
  return [200, {'success': true, 'has_more': false, 'history': []}];
});

mock.onGet('version').reply((config) => {
  const data = {
    version: '1.0.0',
    network: 'mainnet',
    min_tx_weight: 14,
    min_tx_weight_coefficient: 1.6,
    min_tx_weight_k: 100,
    token_deposit_percentage: 0.01,
  }
  return [200, data];
});

import WebSocketHandler from './src/WebSocketHandler';
import WS from './src/websocket';

WebSocketHandler.websocket = new WS({ wsURL });
WebSocketHandler.websocket.WebSocket = WebSocket;
WebSocketHandler.websocket.setup();

expect.extend({
  toMatchBuffer(received, expected) {
    let pass;
    if ((received instanceof Buffer === false) || (expected instanceof Buffer === false)) {
      pass = false;
    } else {
      pass = expected.equals(received);
    }
    if (pass) {
      return {
        message: () => `expected Buffer(${received.toString('hex')}) to not match Buffer(${expected.toString('hex')})`,
        pass: true,
      }
    } else {
      return {
        message: () => `expected Buffer(${received.toString('hex')}) to match Buffer(${expected.toString('hex')})`,
        pass: false,
      }
    }
  }
});


global.window = {};
