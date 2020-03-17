/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import WebSocketHandler from '../src/WebSocketHandler';


test('Ping', (done) => {
  WebSocketHandler.ws.started = true;
  WebSocketHandler.ws.on('pong', (wsData) => {
    done();
  });
  WebSocketHandler.ws.sendPing();
}, 10000)

test('Close', () => {
  WebSocketHandler.ws.setup();
  expect(WebSocketHandler.ws.started).toBe(true);
  expect(WebSocketHandler.ws.connected).toBe(true);
  expect(WebSocketHandler.ws.isOnline).toBe(true);

  WebSocketHandler.ws.onClose();
  expect(WebSocketHandler.ws.started).toBe(false);
  expect(WebSocketHandler.ws.connected).toBe(false);
  expect(WebSocketHandler.ws.isOnline).toBe(false);
})
