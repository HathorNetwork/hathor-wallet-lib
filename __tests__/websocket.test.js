/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import WebSocketHandler from '../src/WebSocketHandler';


test('Ping', (done) => {
  WebSocketHandler.started = true;
  WebSocketHandler.on('pong', (wsData) => {
    done();
  });
  WebSocketHandler.sendPing();
}, 10000)

test('Close', () => {
  expect(WebSocketHandler.started).toBe(true);
  expect(WebSocketHandler.connected).toBe(true);
  expect(WebSocketHandler.isOnline).toBe(true);

  WebSocketHandler.onClose();
  expect(WebSocketHandler.started).toBe(false);
  expect(WebSocketHandler.connected).toBe(false);
  expect(WebSocketHandler.isOnline).toBe(false);
})