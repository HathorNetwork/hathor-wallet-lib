/**
 * Regression tests for the WebSocket socket leak + reconnect backoff.
 *
 * Bug: GenericWebSocket.closeWs() only called ws.close() when
 * readyState === OPEN. A socket killed while still CONNECTING (TCP established,
 * HTTP 101 upgrade not yet received) was dereferenced WITHOUT being closed, so
 * the underlying connection lingered ESTABLISHED. Under reconnect churn against
 * a connection-capped server, every retry leaked one ESTABLISHED socket.
 */

import http from 'http';
import net, { AddressInfo } from 'net';
import GenericWebSocket from '../../src/websocket/index';

/** Internal members we need to reach for white-box assertions. */
interface SocketView {
  ws: { readyState: number };
  getReconnectDelay(): number;
}

/** Poll a predicate until it's true, or reject after `timeout` ms. */
function waitFor(pred: () => boolean, timeout = 2000, interval = 20): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (pred()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error('waitFor: condition not met within timeout'));
        return;
      }
      setTimeout(tick, interval);
    };
    tick();
  });
}

describe('BaseWebSocket socket leak (closeWs on a CONNECTING socket)', () => {
  it('tears down the underlying socket even when it is still CONNECTING', async () => {
    // Server that accepts the TCP connection and the upgrade request but never
    // writes the 101 response and never destroys the socket — so the client
    // stays in CONNECTING. Mirrors a fullnode whose nginx per-IP cap accepts the
    // TCP connect but stalls/rejects the WS upgrade.
    let tcpConnected = false;
    const held: net.Socket[] = [];
    const server = http.createServer();
    server.on('connection', () => {
      tcpConnected = true;
    });
    // Hold the upgrade open: no 101, no destroy (a missing 'upgrade' listener
    // would make Node close the socket, which we explicitly do NOT want here).
    server.on('upgrade', (_req: http.IncomingMessage, socket: net.Socket) => {
      held.push(socket);
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;

    const ws = new GenericWebSocket({ wsURL: `ws://127.0.0.1:${port}/` });
    ws.setup();
    const sock = (ws as unknown as SocketView).ws; // underlying isomorphic-ws

    // TCP is established but the handshake never completes -> CONNECTING (0).
    await waitFor(() => tcpConnected);
    expect(sock.readyState).toBe(0); // WebSocket.CONNECTING

    // The fix under test: closeWs() must close/terminate regardless of
    // readyState. Without it, a CONNECTING socket is only dereferenced and the
    // underlying connection is leaked.
    ws.closeWs();

    // With the fix the socket is terminated -> readyState reaches CLOSED (3).
    // Without the fix it stays CONNECTING (0) forever -> this times out.
    await waitFor(() => sock.readyState === 3); // WebSocket.CLOSED
    expect(sock.readyState).toBe(3);

    ws.close();
    held.forEach(s => {
      try {
        s.destroy();
      } catch (_e) {
        // already destroyed
      }
    });
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });
});

describe('BaseWebSocket reconnect backoff', () => {
  it('uses capped exponential backoff with jitter (not a flat interval)', () => {
    const base = 100;
    const max = 1000;
    const ws = new GenericWebSocket({
      wsURL: 'ws://127.0.0.1:1/',
      retryConnectionInterval: base,
      maxRetryConnectionInterval: max,
    });
    const view = ws as unknown as SocketView;

    const delays = Array.from({ length: 10 }, () => view.getReconnectDelay());

    // First retry ~ base (+ up to 25% jitter).
    expect(delays[0]).toBeGreaterThanOrEqual(base);
    expect(delays[0]).toBeLessThanOrEqual(base * 1.25 + 1);
    // Grows over the first attempts (exponential).
    expect(delays[2]).toBeGreaterThan(delays[0]);
    // Never exceeds the cap (+ jitter).
    delays.forEach(d => {
      expect(d).toBeLessThanOrEqual(max * 1.25 + 1);
    });
    // Reaches the cap region by later attempts.
    expect(delays[9]).toBeGreaterThanOrEqual(max);

    ws.close();
  });
});
