/**
 * Regression tests for the WebSocket socket leak + reconnect backoff.
 *
 * Bug: GenericWebSocket.closeWs() only called ws.close() when
 * readyState === OPEN. A socket retired while still CONNECTING (TCP established,
 * HTTP 101 upgrade not yet received) — or CLOSING — was dereferenced WITHOUT
 * being closed, so the underlying connection lingered ESTABLISHED on the OS
 * until keepalive eventually reaped it. Under reconnect churn against a
 * connection-capped server (e.g. nginx limit_conn accepting the TCP connect but
 * never completing the upgrade), every retry leaked one ESTABLISHED socket — a
 * self-reinforcing loop that saturated the per-IP cap.
 */

import http from 'http';
import net, { AddressInfo } from 'net';
import _WebSocket from 'isomorphic-ws';
import GenericWebSocket from '../../src/websocket/index';

/** A socket we can inspect/tear down regardless of which platform `ws` we got. */
interface RawSocket {
  readyState: number;
  terminate?: () => void;
  close: (code?: number, reason?: string) => void;
}

/** Internal members we override/read for the assertions. */
interface SocketView {
  WebSocket: unknown;
  getReconnectDelay(): number;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

describe('BaseWebSocket socket leak under reconnect churn (integration)', () => {
  it('closes every retired socket instead of accumulating them', async () => {
    // A real server that accepts the TCP connection and the upgrade request but
    // never writes the 101 response and never destroys the socket — so every
    // client connection stays CONNECTING. This mirrors a fullnode whose nginx
    // per-IP cap accepts the TCP connect but stalls/rejects the WS upgrade.
    const heldUpgrades: net.Socket[] = [];
    const server = http.createServer();
    server.on('upgrade', (_req: http.IncomingMessage, socket: net.Socket) => {
      heldUpgrades.push(socket);
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;

    // Track every underlying socket the library opens, so we can count — with
    // real OS sockets — how many are left alive at the end.
    const opened: RawSocket[] = [];
    const WsCtor = _WebSocket as unknown as { new (url: string): RawSocket };
    class TrackingWebSocket extends WsCtor {
      constructor(url: string) {
        super(url);
        opened.push(this);
      }
    }

    const ws = new GenericWebSocket({
      wsURL: `ws://127.0.0.1:${port}/`,
      retryConnectionInterval: 20,
    });
    (ws as unknown as SocketView).WebSocket = TrackingWebSocket;

    // Open a connection, then retire-and-reopen several times — the churn an
    // unhealthy/capped connection produces. endConnection() runs the same
    // closeWs() teardown the reconnect path (onClose) uses.
    ws.setup();
    await delay(40);
    const CYCLES = 8;
    for (let i = 0; i < CYCLES; i += 1) {
      ws.endConnection();
      ws.setup();
      await delay(40);
    }
    await delay(120);

    // A socket still CONNECTING (0) or OPEN (1) is alive on the OS. With the fix
    // only the final, current connection may be alive; every retired socket has
    // been terminated. Without the fix retired CONNECTING sockets are merely
    // dereferenced (never closed), so all of them stay alive and accumulate.
    const alive = opened.filter(s => s.readyState === 0 || s.readyState === 1);

    ws.close();
    opened.forEach(s => {
      try {
        if (typeof s.terminate === 'function') {
          s.terminate();
        } else {
          s.close();
        }
      } catch (_e) {
        // already gone
      }
    });
    heldUpgrades.forEach(s => {
      try {
        s.destroy();
      } catch (_e) {
        // already destroyed
      }
    });
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });

    // The churn actually happened: one initial + one per cycle.
    expect(opened.length).toBe(CYCLES + 1);
    // No accumulation: at most the single current connection is still alive.
    expect(alive.length).toBeLessThanOrEqual(1);
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
