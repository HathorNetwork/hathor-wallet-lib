#!/usr/bin/env node
/**
 * Waits for the integration fullnode to be READY and for the feature-activation
 * features the shielded suite depends on (NANO_CONTRACTS, FEE_TOKENS) to reach
 * ACTIVE before the integration tests run.
 *
 * The genesis-funded wallet sends shielded txs immediately after the
 * node is READY, but the fullnode rejects them until those features activate
 * (a few blocks past genesis) — the first shielded send otherwise fails with
 * "invalid vertex version". Wired into the `pretest_network_integration` hook,
 * after the on-demand crypto-provider install.
 */
const http = require('http');

const BASE = 'http://localhost:8083/v1a';
const REQUIRED_FEATURES = ['NANO_CONTRACTS', 'FEE_TOKENS'];
const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 2000;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.on('data', c => {
        body += c;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
  });
}

async function isReady() {
  try {
    const d = await getJson(`${BASE}/status`);
    return d && d.server && d.server.state === 'READY';
  } catch {
    return false;
  }
}

async function featuresActive() {
  try {
    const d = await getJson(`${BASE}/feature`);
    const states = Object.fromEntries((d.features || []).map(f => [f.name, f.state]));
    return REQUIRED_FEATURES.every(name => states[name] === 'ACTIVE');
  } catch {
    return false;
  }
}

const sleep = ms =>
  new Promise(r => {
    setTimeout(r, ms);
  });

(async () => {
  const deadline = Date.now() + TIMEOUT_MS;
  /* eslint-disable no-console, no-await-in-loop */
  process.stdout.write('[wait-for-node-ready] waiting for fullnode READY');
  while (!(await isReady())) {
    if (Date.now() > deadline) {
      console.error('\n[wait-for-node-ready] TIMEOUT waiting for READY');
      process.exit(1);
    }
    process.stdout.write('.');
    await sleep(POLL_MS);
  }
  process.stdout.write(
    ` ok.\n[wait-for-node-ready] waiting for ${REQUIRED_FEATURES.join(' + ')} ACTIVE`
  );
  while (!(await featuresActive())) {
    if (Date.now() > deadline) {
      console.error('\n[wait-for-node-ready] TIMEOUT waiting for features ACTIVE');
      process.exit(1);
    }
    process.stdout.write('.');
    await sleep(POLL_MS);
  }
  console.log(' ok.');
  /* eslint-enable no-console, no-await-in-loop */
})();
