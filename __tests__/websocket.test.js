/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import WebSocketHandler from '../src/WebSocketHandler';
import WS from '../src/websocket';
import helpers from '../src/helpers';

beforeEach(() => {
  // This useFakeTimers allow to handle setTimeout calls
  // With it we can run all pending calls
  jest.useFakeTimers();
  WebSocketHandler.ws = new WS({ wsURL: helpers.getWSServerURL() });
  WebSocketHandler.ws.WebSocket = WebSocket;
  WebSocketHandler.ws.setup();
  jest.runOnlyPendingTimers();
});

test('Ping', (done) => {
  WebSocketHandler.ws.on('pong', (wsData) => {
    done();
  });
  WebSocketHandler.ws.sendPing();
  jest.runOnlyPendingTimers();
}, 10000)

test('Close', () => {

  expect(WebSocketHandler.ws.started).toBe(true);
  expect(WebSocketHandler.ws.connected).toBe(true);
  expect(WebSocketHandler.ws.isOnline).toBe(true);

  WebSocketHandler.ws.onClose();
  expect(WebSocketHandler.ws.started).toBe(false);
  expect(WebSocketHandler.ws.connected).toBe(false);
  expect(WebSocketHandler.ws.isOnline).toBe(false);
})
