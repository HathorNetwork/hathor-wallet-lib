/*
 * Profile HathorWalletServiceWallet.start() against a real wallet-service.
 *
 * Usage:
 *   WALLET_SERVICE_URL=https://... \
 *   WALLET_SERVICE_WS_URL=wss://... \
 *   FULLNODE_URL=https://... \
 *   WALLET_SEED="24 words ..." \
 *   NETWORK=testnet \
 *   SCENARIO=fresh \   # fresh | reopen (reopen runs start() twice, reusing storage)
 *   npm run profile:wallet
 *
 * Optional flags (env):
 *   ENABLE_WS=1           # open the wallet-service WS after start (default: 1)
 *   WAIT_WS_READY=1       # extend measurement until WS is_online=true (default: 1)
 *   CPU_PROF=1            # write .cpuprofile files into profiling/profiles
 *   RUNS=1                # how many times to run start() back-to-back (fresh scenario)
 *
 * Outputs:
 *   - Phase waterfall (perf_hooks mark/measure)
 *   - HTTP call log (method, url, status, elapsed_ms, bytes)
 *   - If CPU_PROF=1: .cpuprofile in profiling/profiles (open in Chrome DevTools)
 */

import { performance } from 'perf_hooks';
import axios, { AxiosRequestConfig } from 'axios';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

import { HathorWalletServiceWallet, MemoryStore, Storage, Network, config } from '../src';
import walletUtils from '../src/utils/wallet';
import { P2PKH_ACCT_PATH } from '../src/constants';

// Load .env.profile from repo root (simple KEY=VALUE parser, no external dep)
(function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env.profile');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip matched surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
})();

// Public-testnet defaults (used when env vars are unset)
const DEFAULT_WALLET_SERVICE_URL = 'https://wallet-service.testnet.hathor.network/';
const DEFAULT_WALLET_SERVICE_WS_URL = 'wss://ws.wallet-service.testnet.hathor.network/';
const DEFAULT_FULLNODE_URL = 'https://node1.testnet.hathor.network/v1a/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PhaseMeasurement = { name: string; startTime: number; duration: number };
type HttpRecord = {
  id: number;
  method: string;
  url: string;
  status?: number;
  startTime: number;
  duration: number;
  reqBytes?: number;
  resBytes?: number;
  error?: string;
};

const httpRecords: HttpRecord[] = [];
let httpCounter = 0;
let runPrefix = 'r0';

function mark(name: string) {
  performance.mark(`${runPrefix}.${name}`);
}
function measure(name: string, start: string, end: string) {
  try {
    performance.measure(`${runPrefix}.${name}`, `${runPrefix}.${start}`, `${runPrefix}.${end}`);
  } catch (err) {
    // swallow — missing mark in error paths
  }
}

function collectMeasurementsForRun(): PhaseMeasurement[] {
  const all = performance.getEntriesByType('measure') as Array<{
    name: string;
    startTime: number;
    duration: number;
  }>;
  const prefix = `${runPrefix}.`;
  return all
    .filter(e => e.name.startsWith(prefix))
    .map(e => ({ name: e.name.slice(prefix.length), startTime: e.startTime, duration: e.duration }));
}

function clearAllMarksAndMeasures() {
  performance.clearMarks();
  performance.clearMeasures();
}

async function timePhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startMark = `${name}:start`;
  const endMark = `${name}:end`;
  mark(startMark);
  try {
    return await fn();
  } finally {
    mark(endMark);
    measure(name, startMark, endMark);
  }
}

// ---------------------------------------------------------------------------
// Axios global interceptors — capture every HTTP call the lib makes
// ---------------------------------------------------------------------------

function installAxiosInterceptors() {
  const reqInterceptor = (cfg: AxiosRequestConfig & { metadata?: { id: number; start: number } }) => {
    const id = ++httpCounter;
    cfg.metadata = { id, start: performance.now() };
    const reqBytes = cfg.data
      ? typeof cfg.data === 'string'
        ? Buffer.byteLength(cfg.data)
        : Buffer.byteLength(JSON.stringify(cfg.data))
      : 0;
    const method = (cfg.method || 'get').toUpperCase();
    const url = (cfg.baseURL || '') + (cfg.url || '');
    httpRecords.push({
      id,
      method,
      url,
      startTime: cfg.metadata.start,
      duration: NaN,
      reqBytes,
    });
    return cfg as AxiosRequestConfig;
  };

  const resInterceptor = (resp: {
    config: AxiosRequestConfig & { metadata?: { id: number; start: number } };
    status: number;
    data: unknown;
  }) => {
    const meta = resp.config.metadata;
    if (meta) {
      const rec = httpRecords.find(r => r.id === meta.id);
      if (rec) {
        rec.duration = performance.now() - meta.start;
        rec.status = resp.status;
        rec.resBytes = resp.data
          ? Buffer.byteLength(typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data))
          : 0;
      }
    }
    return resp;
  };

  const errInterceptor = (err: {
    config?: AxiosRequestConfig & { metadata?: { id: number; start: number } };
    response?: { status: number };
    message: string;
  }) => {
    const meta = err.config?.metadata;
    if (meta) {
      const rec = httpRecords.find(r => r.id === meta.id);
      if (rec) {
        rec.duration = performance.now() - meta.start;
        rec.status = err.response?.status;
        rec.error = err.message;
      }
    }
    return Promise.reject(err);
  };

  // Patch axios.create so every instance the lib makes has our interceptors
  const origCreate = axios.create.bind(axios);
  (axios as unknown as { create: typeof axios.create }).create = ((cfg?: AxiosRequestConfig) => {
    const inst = origCreate(cfg);
    inst.interceptors.request.use(reqInterceptor as never);
    inst.interceptors.response.use(resInterceptor as never, errInterceptor as never);
    return inst;
  }) as typeof axios.create;

  // Also patch the default axios instance (unlikely used here, but safe)
  axios.interceptors.request.use(reqInterceptor as never);
  axios.interceptors.response.use(resInterceptor as never, errInterceptor as never);
}

// ---------------------------------------------------------------------------
// Instance-level monkey patches — expose sub-phases inside start()
// ---------------------------------------------------------------------------

function instrumentWalletUtilsOnce() {
  type Utils = Record<string, (...args: unknown[]) => unknown>;
  const u = walletUtils as unknown as Utils;
  const targets = [
    'generateAccessDataFromSeed',
    'generateAccessDataFromXpriv',
    'generateAccessDataFromXpub',
    'getXPrivKeyFromSeed',
  ];
  for (const method of targets) {
    const original = u[method];
    if (typeof original !== 'function' || (original as { __profiled?: boolean }).__profiled)
      continue;
    const wrapped = function wrapped(this: unknown, ...args: unknown[]) {
      const label = `phase.walletUtils.${method}`;
      mark(`${label}:start`);
      try {
        const result = (original as (...a: unknown[]) => unknown).apply(this, args);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).finally(() => {
            mark(`${label}:end`);
            measure(label, `${label}:start`, `${label}:end`);
          });
        }
        mark(`${label}:end`);
        measure(label, `${label}:start`, `${label}:end`);
        return result;
      } catch (err) {
        mark(`${label}:end`);
        measure(label, `${label}:start`, `${label}:end`);
        throw err;
      }
    };
    (wrapped as { __profiled?: boolean }).__profiled = true;
    u[method] = wrapped as (...args: unknown[]) => unknown;
  }
}

function instrumentInstance(wallet: HathorWalletServiceWallet) {
  const targets: Array<{ method: string; phase: string }> = [
    { method: 'generateCreateWalletAuthData', phase: 'phase.generateCreateWalletAuthData' },
    { method: 'pollForWalletStatus', phase: 'phase.pollForWalletStatus' },
    { method: 'validateAndRenewAuthToken', phase: 'phase.validateAndRenewAuthToken' },
    { method: 'renewAuthToken', phase: 'phase.renewAuthToken' },
    { method: 'getReadOnlyAuthToken', phase: 'phase.getReadOnlyAuthToken' },
    { method: 'onWalletReady', phase: 'phase.onWalletReady' },
    { method: 'getNewAddresses', phase: 'phase.getNewAddresses' },
    { method: 'setupConnection', phase: 'phase.setupConnection' },
  ];

  type AnyWallet = Record<string, (...args: unknown[]) => unknown>;
  const w = wallet as unknown as AnyWallet;

  for (const { method, phase } of targets) {
    const original = w[method];
    if (typeof original !== 'function') continue;
    let callIdx = 0;
    w[method] = async function instrumented(this: unknown, ...args: unknown[]) {
      const idx = ++callIdx;
      const label = `${phase}#${idx}`;
      const startMark = `${label}:start`;
      const endMark = `${label}:end`;
      mark(startMark);
      try {
        return await (original as (...a: unknown[]) => unknown).apply(this, args);
      } finally {
        mark(endMark);
        measure(label, startMark, endMark);
      }
    } as (...args: unknown[]) => unknown;
  }
}

// ---------------------------------------------------------------------------
// Waterfall reporter
// ---------------------------------------------------------------------------

function fmt(ms: number) {
  return `${ms.toFixed(1).padStart(8)}ms`;
}

function report(t0: number, totalMs: number, label: string, phaseMeasurements: PhaseMeasurement[]) {
  const bar = (startMs: number, durMs: number, widthChars = 60, timelineMs = totalMs) => {
    const pre = Math.max(0, Math.round((startMs / timelineMs) * widthChars));
    const len = Math.max(1, Math.round((durMs / timelineMs) * widthChars));
    const post = Math.max(0, widthChars - pre - len);
    return `${' '.repeat(pre)}${'█'.repeat(len)}${' '.repeat(post)}`;
  };

  console.log('\n================================================================================');
  console.log(`Profile: ${label}    total=${totalMs.toFixed(1)}ms`);
  console.log('================================================================================');

  console.log('\nPhase waterfall (relative to t0):');
  const phases = [...phaseMeasurements].sort((a, b) => a.startTime - b.startTime);
  for (const p of phases) {
    const rel = p.startTime - t0;
    console.log(
      `  ${bar(rel, p.duration)}  ${fmt(p.duration)}  @${fmt(rel).trim()}  ${p.name}`
    );
  }

  console.log('\nHTTP calls (chronological):');
  const calls = [...httpRecords].sort((a, b) => a.startTime - b.startTime);
  let totalHttpMs = 0;
  for (const h of calls) {
    const rel = h.startTime - t0;
    const tag = h.error ? `ERR ${h.status ?? ''} ${h.error}` : `${h.status}`;
    console.log(
      `  ${bar(rel, h.duration)}  ${fmt(h.duration)}  @${fmt(rel).trim()}  ${h.method.padEnd(
        6
      )} ${h.url}  [${tag}, req=${h.reqBytes ?? 0}B, res=${h.resBytes ?? 0}B]`
    );
    totalHttpMs += isNaN(h.duration) ? 0 : h.duration;
  }

  console.log('\nSummary:');
  console.log(`  HTTP total (sum)        : ${totalHttpMs.toFixed(1)}ms (serial equivalent)`);
  console.log(`  HTTP calls              : ${calls.length}`);
  const byHost: Record<string, { count: number; ms: number }> = {};
  for (const h of calls) {
    try {
      const host = new URL(h.url).host;
      byHost[host] ||= { count: 0, ms: 0 };
      byHost[host].count++;
      byHost[host].ms += isNaN(h.duration) ? 0 : h.duration;
    } catch {
      /* ignore */
    }
  }
  for (const [host, agg] of Object.entries(byHost)) {
    console.log(`    ${host.padEnd(60)} ${agg.count.toString().padStart(3)} calls, ${agg.ms.toFixed(1)}ms`);
  }

  const slowest = [...calls].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 5);
  console.log('\nTop 5 slowest HTTP calls:');
  for (const h of slowest) {
    console.log(`  ${fmt(h.duration)}  ${h.method} ${h.url}  [${h.status ?? h.error}]`);
  }

  // JSON dump for machine consumption
  const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const outPath = `${__dirname}/profiles/run-${safeLabel}.json`;
  const lastPath = `${__dirname}/profiles/last-run.json`;
  const payload = {
    label,
    totalMs,
    t0,
    phases,
    http: calls,
    summary: { totalHttpMs, byHost },
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(lastPath, JSON.stringify(payload, null, 2));
  console.log(`\nDetailed JSON written to: ${outPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required env var: ${name}. See comments at top of profile-wallet-load.ts for usage.`
    );
  }
  return v;
}

function deriveXpubFromSeed(seed: string, networkName: string): string {
  // Uses the same derivation the facade uses internally (P2PKH account path).
  // We do NOT instrument this call; it's a harness-only helper.
  const root = walletUtils.getXPrivKeyFromSeed(seed, { networkName }) as {
    deriveNonCompliantChild: (path: string) => { xpubkey: string };
  };
  return root.deriveNonCompliantChild(P2PKH_ACCT_PATH).xpubkey;
}

async function runOnce(
  seed: string,
  opts: {
    enableWs: boolean;
    waitWsReady: boolean;
    label: string;
    runIdx: number;
    storage?: Storage;
    readOnly?: boolean;
    xpub?: string;
  }
) {
  runPrefix = `r${opts.runIdx}`;
  clearAllMarksAndMeasures();
  httpRecords.length = 0;
  httpCounter = 0;

  const network = new Network(process.env.NETWORK || 'testnet');
  // Reuse storage across runs if provided (reopen scenario); else fresh MemoryStore
  const storage = opts.storage ?? new Storage(new MemoryStore());

  const wallet = new HathorWalletServiceWallet({
    requestPassword: async () => 'profile-password',
    // In read-only mode, pass xpub (no seed). Otherwise pass seed.
    ...(opts.readOnly ? { xpub: opts.xpub } : { seed }),
    network,
    storage,
    enableWs: opts.enableWs,
  } as unknown as ConstructorParameters<typeof HathorWalletServiceWallet>[0]);

  instrumentWalletUtilsOnce();
  instrumentInstance(wallet);

  // Hook the internal wallet-service connection's state event so we can time the full
  // WebSocket open + 'join-success' handshake (ConnectionState.CONNECTED).
  let wsOpenStart = 0;
  const wsReadyPromise =
    opts.enableWs && opts.waitWsReady
      ? new Promise<void>(resolve => {
          const origSetupConnection = (wallet as unknown as {
            setupConnection: () => void;
          }).setupConnection;
          (wallet as unknown as { setupConnection: () => void }).setupConnection =
            function setupConnectionWrapped(this: unknown) {
              wsOpenStart = performance.now();
              mark('phase.ws.open+join:start');
              origSetupConnection.apply(this);
              const conn = (wallet as unknown as {
                conn?: {
                  on: (evt: string, cb: (s: unknown) => void) => void;
                  websocket?: {
                    sendMessage: (msg: string) => void;
                    on: (evt: string, cb: (p: unknown) => void) => void;
                  };
                };
              }).conn;

              // Hook WS-level send + receive to prove any retries
              const ws = conn?.websocket;
              if (ws) {
                const origSend = ws.sendMessage.bind(ws);
                ws.sendMessage = (msg: string) => {
                  console.log(`  [ws] SEND  @${(performance.now() - wsOpenStart).toFixed(0)}ms  ${msg}`);
                  return origSend(msg);
                };
                ws.on('join-success', () => {
                  console.log(
                    `  [ws] RECV join-success @${(performance.now() - wsOpenStart).toFixed(0)}ms`
                  );
                });
              }

              conn?.on('state', (s: unknown) => {
                if (s === 2 /* CONNECTED */) {
                  mark('phase.ws.open+join:end');
                  measure(
                    'phase.ws.open+join',
                    'phase.ws.open+join:start',
                    'phase.ws.open+join:end'
                  );
                  resolve();
                }
              });
            };
        })
      : Promise.resolve();

  const t0 = performance.now();
  mark('phase.start:start');
  if (opts.readOnly) {
    await wallet.startReadOnly();
  } else {
    await wallet.start({ pinCode: '123456', password: 'profile-password' });
  }
  mark('phase.start:end');
  measure('phase.start', 'phase.start:start', 'phase.start:end');

  if (opts.enableWs && opts.waitWsReady) {
    await Promise.race([
      wsReadyPromise,
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error('WS ready timeout (10s)')), 10_000)),
    ]).catch(err => console.warn(`(WS wait) ${(err as Error).message}`));
  }

  const totalMs = performance.now() - t0;
  // Synchronously collect measures before any further await/microtask
  const phaseMeasurements = collectMeasurementsForRun();
  report(t0, totalMs, opts.label, phaseMeasurements);

  // Cleanup
  try {
    if (opts.enableWs) {
      // Close the WS connection so the process can exit
      const conn = (wallet as unknown as { conn?: { websocket?: { endConnection?: () => void } } }).conn;
      conn?.websocket?.endConnection?.();
    }
  } catch {
    /* ignore */
  }

  return { wallet, storage };
}

async function main() {
  const walletServiceUrl = process.env.WALLET_SERVICE_URL || DEFAULT_WALLET_SERVICE_URL;
  const walletServiceWsUrl = process.env.WALLET_SERVICE_WS_URL || DEFAULT_WALLET_SERVICE_WS_URL;
  const fullnodeUrl = process.env.FULLNODE_URL || DEFAULT_FULLNODE_URL;
  const seed = requireEnv('WALLET_SEED');

  config.setServerUrl(fullnodeUrl);
  config.setWalletServiceBaseUrl(walletServiceUrl);
  config.setWalletServiceBaseWsUrl(walletServiceWsUrl);
  config.setNetwork(process.env.NETWORK || 'testnet');

  // Force keep-alive off so TLS handshake cost is visible on every call — matches axios default
  axios.defaults.httpAgent = new http.Agent({ keepAlive: true });
  axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });

  installAxiosInterceptors();

  const enableWs = (process.env.ENABLE_WS ?? '1') === '1';
  const waitWsReady = (process.env.WAIT_WS_READY ?? '1') === '1';
  const runs = Number(process.env.RUNS ?? '1');
  const scenario = (process.env.SCENARIO ?? 'fresh').toLowerCase();
  const readOnly = (process.env.READONLY ?? '0') === '1';

  const xpub = readOnly ? deriveXpubFromSeed(seed, process.env.NETWORK || 'testnet') : undefined;

  console.log(`Wallet-service URL : ${walletServiceUrl}`);
  console.log(`WS URL             : ${walletServiceWsUrl}`);
  console.log(`Fullnode URL       : ${fullnodeUrl}`);
  console.log(`Network            : ${process.env.NETWORK || 'testnet'}`);
  console.log(`Mode               : ${readOnly ? 'READ-ONLY (startReadOnly, xpub only)' : 'FULL (start, with seed)'}`);
  console.log(`Scenario           : ${scenario}`);
  console.log(`Runs               : ${runs}`);
  console.log(`Enable WS          : ${enableWs}  (wait_ready=${waitWsReady})`);

  // For "reopen" or "both", reuse storage across runs so accessData persists.
  // For pure "fresh", give each run a clean MemoryStore (server-side wallet still exists).
  let sharedStorage: Storage | undefined;
  for (let i = 1; i <= runs; i++) {
    const isReopen = (scenario === 'reopen' || scenario === 'both') && i > 1;
    const labelTag = isReopen ? 'reopen' : 'fresh';
    console.log(`\n--- Run ${i}/${runs} (${labelTag}) ---`);
    const result = await runOnce(seed, {
      enableWs,
      waitWsReady,
      label: `${readOnly ? 'ro-' : ''}${labelTag} run ${i}/${runs}`,
      runIdx: i,
      storage: isReopen ? sharedStorage : undefined,
      readOnly,
      xpub,
    });
    if (scenario === 'reopen' || scenario === 'both') {
      sharedStorage = result.storage;
    }
  }

  // Give any in-flight WS close handshakes a moment
  await new Promise(r => setTimeout(r, 200));
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('\nProfiling run failed:');
    console.error(err);
    process.exit(1);
  });
