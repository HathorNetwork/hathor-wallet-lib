/*
 * Profile HathorWalletServiceWallet sendTransaction() against the testnet
 * wallet-service + tx-mining-service.
 *
 * By default: self-sends 1 raw HTR unit (0.01 HTR) from the wallet to its own
 * first address. No real value leaves the wallet; amounts are minimal.
 *
 * Usage:
 *   WALLET_SEED="..." \
 *   npm run profile:send-tx
 *
 * Optional env:
 *   NETWORK=testnet            # default: testnet
 *   SEND_AMOUNT=1              # smallest-unit amount to self-send (default 1 = 0.01 HTR)
 *   SEND_TO=<address>          # override destination (default: wallet's addr index 0)
 *   RUNS=1                     # back-to-back sends (default 1)
 *   WALLET_SERVICE_URL=...     # default: public testnet
 *   WALLET_SERVICE_WS_URL=...
 *   FULLNODE_URL=...
 *   TX_MINING_URL=...          # default: https://txmining.testnet.hathor.network/
 */

import { performance } from 'perf_hooks';
import axios, { AxiosRequestConfig } from 'axios';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

import { HathorWalletServiceWallet, MemoryStore, Storage, Network, config } from '../src';
import walletApi from '../src/wallet/api/walletApi';
import MineTransaction from '../src/wallet/mineTransaction';
import SendTransactionWalletService from '../src/wallet/sendTransactionWalletService';
import { NATIVE_TOKEN_UID } from '../src/constants';

// -- .env.profile loader --
(function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env.profile');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const DEFAULT_WALLET_SERVICE_URL = 'https://wallet-service.testnet.hathor.network/';
const DEFAULT_WALLET_SERVICE_WS_URL = 'wss://ws.wallet-service.testnet.hathor.network/';
const DEFAULT_FULLNODE_URL = 'https://node1.testnet.hathor.network/v1a/';
const DEFAULT_TX_MINING_URL = 'https://txmining.testnet.hathor.network/';

// ---------------------------------------------------------------------------
// Measurement primitives
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

function mark(name: string) { performance.mark(`${runPrefix}.${name}`); }
function measure(name: string, start: string, end: string) {
  try { performance.measure(`${runPrefix}.${name}`, `${runPrefix}.${start}`, `${runPrefix}.${end}`); } catch { /* ignore */ }
}
function collectMeasurementsForRun(): PhaseMeasurement[] {
  const prefix = `${runPrefix}.`;
  return (performance.getEntriesByType('measure') as Array<{ name: string; startTime: number; duration: number }>)
    .filter(e => e.name.startsWith(prefix))
    .map(e => ({ name: e.name.slice(prefix.length), startTime: e.startTime, duration: e.duration }));
}
function clearAllMarksAndMeasures() {
  performance.clearMarks();
  performance.clearMeasures();
}

function installAxiosInterceptors() {
  type Meta = { id: number; start: number };
  const reqI = (cfg: AxiosRequestConfig & { metadata?: Meta }) => {
    const id = ++httpCounter;
    cfg.metadata = { id, start: performance.now() };
    const reqBytes = cfg.data
      ? typeof cfg.data === 'string' ? Buffer.byteLength(cfg.data) : Buffer.byteLength(JSON.stringify(cfg.data))
      : 0;
    const method = (cfg.method || 'get').toUpperCase();
    const url = (cfg.baseURL || '') + (cfg.url || '');
    httpRecords.push({ id, method, url, startTime: cfg.metadata.start, duration: NaN, reqBytes });
    return cfg as AxiosRequestConfig;
  };
  const resI = (resp: { config: AxiosRequestConfig & { metadata?: Meta }; status: number; data: unknown }) => {
    const meta = resp.config.metadata;
    if (meta) {
      const rec = httpRecords.find(r => r.id === meta.id);
      if (rec) {
        rec.duration = performance.now() - meta.start;
        rec.status = resp.status;
        rec.resBytes = resp.data ? Buffer.byteLength(typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data)) : 0;
      }
    }
    return resp;
  };
  const errI = (err: { config?: AxiosRequestConfig & { metadata?: Meta }; response?: { status: number }; message: string }) => {
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
  const origCreate = axios.create.bind(axios);
  (axios as unknown as { create: typeof axios.create }).create = ((cfg?: AxiosRequestConfig) => {
    const inst = origCreate(cfg);
    inst.interceptors.request.use(reqI as never);
    inst.interceptors.response.use(resI as never, errI as never);
    return inst;
  }) as typeof axios.create;
  axios.interceptors.request.use(reqI as never);
  axios.interceptors.response.use(resI as never, errI as never);
}

// ---------------------------------------------------------------------------
// Prototype-level instrumentation (applied once — so every new instance is instrumented)
// ---------------------------------------------------------------------------

function wrapProtoAsync<T>(
  proto: Record<string, unknown>,
  method: string,
  label: string
) {
  const original = proto[method];
  if (typeof original !== 'function' || (original as { __profiled?: boolean }).__profiled) return;
  const wrapped = async function wrapped(this: T, ...args: unknown[]) {
    const l = label;
    mark(`${l}:start`);
    try {
      // @ts-expect-error dynamic
      return await original.apply(this, args);
    } finally {
      mark(`${l}:end`);
      measure(l, `${l}:start`, `${l}:end`);
    }
  };
  (wrapped as { __profiled?: boolean }).__profiled = true;
  proto[method] = wrapped;
}

let jobStatusPollIdx = 0;
function wrapProtoSync<T>(
  proto: Record<string, unknown>,
  method: string,
  labelFn: () => string
) {
  const original = proto[method];
  if (typeof original !== 'function' || (original as { __profiled?: boolean }).__profiled) return;
  const wrapped = function wrapped(this: T, ...args: unknown[]) {
    const l = labelFn();
    mark(`${l}:start`);
    try {
      // @ts-expect-error dynamic
      const ret = original.apply(this, args);
      mark(`${l}:end`);
      measure(l, `${l}:start`, `${l}:end`);
      return ret;
    } catch (e) {
      mark(`${l}:end`);
      measure(l, `${l}:start`, `${l}:end`);
      throw e;
    }
  };
  (wrapped as { __profiled?: boolean }).__profiled = true;
  proto[method] = wrapped;
}

function instrumentPrototypes() {
  const sProto = SendTransactionWalletService.prototype as unknown as Record<string, unknown>;
  wrapProtoAsync<SendTransactionWalletService>(sProto, 'prepareTxData',      'phase.prepareTxData');
  wrapProtoAsync<SendTransactionWalletService>(sProto, 'prepareTx',          'phase.prepareTx');
  wrapProtoAsync<SendTransactionWalletService>(sProto, 'selectUtxosToUse',   'phase.selectUtxosToUse');
  wrapProtoAsync<SendTransactionWalletService>(sProto, 'signTx',             'phase.signTx');
  wrapProtoAsync<SendTransactionWalletService>(sProto, 'validateUtxos',      'phase.validateUtxos');
  wrapProtoAsync<SendTransactionWalletService>(sProto, 'handleSendTxProposal','phase.handleSendTxProposal');
  wrapProtoAsync<SendTransactionWalletService>(sProto, 'runFromMining',      'phase.runFromMining');
  wrapProtoAsync<SendTransactionWalletService>(sProto, 'run',                'phase.send.run');

  const mProto = MineTransaction.prototype as unknown as Record<string, unknown>;
  wrapProtoSync<MineTransaction>(mProto, 'submitJob', () => `phase.mining.submitJob#${++jobStatusPollIdx}`);
  wrapProtoSync<MineTransaction>(mProto, 'handleJobStatus', () => {
    // Each handleJobStatus schedules ONE getJobStatus call via setTimeout. We label
    // the scheduling moment; the actual HTTP happens inside axios interceptor.
    return `phase.mining.scheduleJobStatus`;
  });

  // Note: we don't wrap MineTransaction.start because it emits a sync event and calls submitJob;
  // submitJob is already wrapped.
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

function fmt(ms: number) { return `${ms.toFixed(1).padStart(8)}ms`; }

function report(t0: number, totalMs: number, label: string, phaseMeasurements: PhaseMeasurement[]) {
  const bar = (startMs: number, durMs: number, widthChars = 60, timelineMs = totalMs) => {
    const pre  = Math.max(0, Math.round((startMs / timelineMs) * widthChars));
    const len  = Math.max(1, Math.round((durMs   / timelineMs) * widthChars));
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
    console.log(`  ${bar(rel, p.duration)}  ${fmt(p.duration)}  @${fmt(rel).trim()}  ${p.name}`);
  }

  console.log('\nHTTP calls (chronological):');
  const calls = [...httpRecords].sort((a, b) => a.startTime - b.startTime);
  let totalHttpMs = 0;
  for (const h of calls) {
    const rel = h.startTime - t0;
    const tag = h.error ? `ERR ${h.status ?? ''} ${h.error}` : `${h.status}`;
    console.log(`  ${bar(rel, h.duration)}  ${fmt(h.duration)}  @${fmt(rel).trim()}  ${h.method.padEnd(6)} ${h.url}  [${tag}, req=${h.reqBytes ?? 0}B, res=${h.resBytes ?? 0}B]`);
    totalHttpMs += isNaN(h.duration) ? 0 : h.duration;
  }

  const byHost: Record<string, { count: number; ms: number }> = {};
  for (const h of calls) {
    try {
      const host = new URL(h.url).host;
      byHost[host] ||= { count: 0, ms: 0 };
      byHost[host].count++;
      byHost[host].ms += isNaN(h.duration) ? 0 : h.duration;
    } catch { /* ignore */ }
  }

  console.log('\nSummary:');
  console.log(`  HTTP total (sum)        : ${totalHttpMs.toFixed(1)}ms (serial equivalent)`);
  console.log(`  HTTP calls              : ${calls.length}`);
  for (const [host, agg] of Object.entries(byHost)) {
    console.log(`    ${host.padEnd(55)} ${agg.count.toString().padStart(3)} calls, ${agg.ms.toFixed(1)}ms`);
  }
  const slowest = [...calls].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 5);
  console.log('\nTop 5 slowest HTTP calls:');
  for (const h of slowest) {
    console.log(`  ${fmt(h.duration)}  ${h.method} ${h.url}  [${h.status ?? h.error}]`);
  }

  const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const outPath = `${__dirname}/profiles/sendtx-${safeLabel}.json`;
  const lastPath = `${__dirname}/profiles/last-sendtx.json`;
  const payload = { label, totalMs, t0, phases, http: calls, summary: { totalHttpMs, byHost } };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(lastPath, JSON.stringify(payload, null, 2));
  console.log(`\nDetailed JSON written to: ${outPath}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const walletServiceUrl = process.env.WALLET_SERVICE_URL || DEFAULT_WALLET_SERVICE_URL;
  const walletServiceWsUrl = process.env.WALLET_SERVICE_WS_URL || DEFAULT_WALLET_SERVICE_WS_URL;
  const fullnodeUrl = process.env.FULLNODE_URL || DEFAULT_FULLNODE_URL;
  const txMiningUrl = process.env.TX_MINING_URL || DEFAULT_TX_MINING_URL;
  const seed = process.env.WALLET_SEED;
  if (!seed) {
    throw new Error('Missing required env var: WALLET_SEED (put in .env.profile).');
  }

  config.setServerUrl(fullnodeUrl);
  config.setWalletServiceBaseUrl(walletServiceUrl);
  config.setWalletServiceBaseWsUrl(walletServiceWsUrl);
  config.setTxMiningUrl(txMiningUrl);
  config.setNetwork(process.env.NETWORK || 'testnet');

  axios.defaults.httpAgent = new http.Agent({ keepAlive: true });
  axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });
  installAxiosInterceptors();
  instrumentPrototypes();

  const runs = Number(process.env.RUNS ?? '1');
  const sendAmount = BigInt(process.env.SEND_AMOUNT ?? '1');

  console.log(`Wallet-service URL : ${walletServiceUrl}`);
  console.log(`TX-mining URL      : ${txMiningUrl}`);
  console.log(`Network            : ${process.env.NETWORK || 'testnet'}`);
  console.log(`Amount per send    : ${sendAmount} (smallest unit)`);
  console.log(`Runs               : ${runs}`);

  // --- Warm-up wallet start (not measured). WS disabled — we don't need it for send. ---
  console.log('\nStarting wallet (warm-up, not profiled)...');
  const network = new Network(process.env.NETWORK || 'testnet');
  const storage = new Storage(new MemoryStore());
  const wallet = new HathorWalletServiceWallet({
    requestPassword: async () => 'profile-password',
    seed,
    network,
    storage,
    enableWs: false,
  } as unknown as ConstructorParameters<typeof HathorWalletServiceWallet>[0]);
  await wallet.start({ pinCode: '123456', password: 'profile-password' });

  const sendTo = process.env.SEND_TO || (await wallet.getAddressAtIndex(0));
  if (!sendTo) throw new Error('Failed to resolve destination address');
  console.log(`Sending to         : ${sendTo}`);

  // --- Balance check ---
  try {
    const balances = await wallet.getBalance(NATIVE_TOKEN_UID);
    const avail = (balances?.[0]?.balance?.unlocked ?? 0n) as bigint;
    console.log(`HTR unlocked       : ${avail}  (need >= ${sendAmount})`);
    if (avail < sendAmount) {
      throw new Error(`Insufficient balance: wallet has ${avail}, need ${sendAmount}. Fund it and retry.`);
    }
  } catch (err) {
    if ((err as Error).message?.startsWith('Insufficient')) throw err;
    console.warn(`(balance check failed, proceeding anyway: ${(err as Error).message})`);
  }

  for (let i = 1; i <= runs; i++) {
    runPrefix = `r${i}`;
    clearAllMarksAndMeasures();
    httpRecords.length = 0;
    httpCounter = 0;
    jobStatusPollIdx = 0;

    console.log(`\n--- Send tx run ${i}/${runs} ---`);

    const t0 = performance.now();
    mark('phase.total:start');

    try {
      await wallet.sendTransaction(sendTo, sendAmount, { pinCode: '123456' });
      mark('phase.total:end');
      measure('phase.total', 'phase.total:start', 'phase.total:end');
    } catch (err) {
      mark('phase.total:end');
      measure('phase.total', 'phase.total:start', 'phase.total:end');
      console.error(`Send failed: ${(err as Error).message}`);
      const totalMs = performance.now() - t0;
      const phaseMeasurements = collectMeasurementsForRun();
      report(t0, totalMs, `send-run-${i}-FAILED`, phaseMeasurements);
      throw err;
    }

    const totalMs = performance.now() - t0;
    const phaseMeasurements = collectMeasurementsForRun();
    report(t0, totalMs, `send-run-${i}-of-${runs}`, phaseMeasurements);

    // Between runs: wait a moment for wallet-service to index the tx so UTXO selection
    // on the next run sees the new state.
    if (i < runs) {
      console.log('...waiting 2s for wallet-service to index the tx...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\nProfiling run failed:');
    console.error(err);
    process.exit(1);
  });
