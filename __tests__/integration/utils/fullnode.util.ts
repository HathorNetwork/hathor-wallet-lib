/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import txApi from '../../../src/api/txApi';
import { delay } from './time.util';
import { FULLNODE_URL } from '../configuration/test-constants';

/** Current best-block height, read straight from the fullnode. */
async function getBestBlockHeight(): Promise<number> {
  const { data } = await axios.get(`${FULLNODE_URL}status`, { timeout: 10000 });
  return data?.dag?.best_block?.height ?? 0;
}

/**
 * Wait until the fullnode's best block advances past the height at call time.
 *
 * The wallet-free counterpart of `waitNextBlock`, which reads
 * `storage.getCurrentHeight()` and therefore needs a started, connected wallet.
 * Height is a property of the chain rather than of any wallet, so asking the
 * fullnode directly avoids that dependency. Prefer this one unless a caller
 * already has a started wallet on hand.
 */
export async function waitForNextBlock({
  timeoutMs = 600000,
  pollIntervalMs = 1000,
}: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<void> {
  const startingHeight = await getBestBlockHeight();
  const deadline = Date.now() + timeoutMs;

  while ((await getBestBlockHeight()) === startingHeight) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for a block past height ${startingHeight}`
      );
    }
    await delay(pollIntervalMs);
  }
}

/**
 * Wait until the wall clock is strictly past `txId`'s timestamp second.
 *
 * Transaction timestamps have one-second granularity and the fullnode rejects a
 * transaction that shares its parent's timestamp, with
 * `full validation failed: tx=… timestamp=N, spent_tx=… timestamp=N`. A test
 * that funds an address and immediately spends that UTXO hits this whenever
 * both land inside the same second.
 *
 * The fullnode-based counterpart of `waitUntilNextTimestamp`, which reads
 * `wallet.getTx()` — unavailable on the wallet-service facade, where `getTx`
 * throws `Not implemented`. Reading the timestamp from the fullnode also asks
 * the authority that actually enforces the rule.
 */
export async function waitPastTxTimestamp(txId: string): Promise<void> {
  const timestamp = await new Promise<number | undefined>(resolve => {
    txApi
      .getTransaction(txId, response => resolve(response?.tx?.timestamp))
      .catch(() => resolve(undefined));
  });

  if (timestamp === undefined) {
    // Nothing to order against; the caller's own wait already covers arrival.
    return;
  }

  const nextValidMs = (timestamp + 1) * 1000;
  const remaining = nextValidMs - Date.now();
  if (remaining > 0) {
    await delay(remaining + 10);
  }
}

/**
 * Wait until the fullnode knows about `txId`.
 *
 * Needed where no wallet is available to observe with — chiefly funding an
 * address *before* its wallet starts. The helper's `POST /fund` returns as soon
 * as the transaction is broadcast (its own tx observation only defers releasing
 * the UTXO reservation, it does not gate the response), so a caller that starts
 * a wallet immediately afterwards would otherwise race the fullnode's indexing
 * and see an empty history.
 *
 * @param txId Transaction to wait for
 * @param options.timeoutMs Total time to wait before throwing
 * @param options.pollIntervalMs Gap between attempts
 */
export async function waitForTxOnFullnode(
  txId: string,
  { timeoutMs = 30000, pollIntervalMs = 500 }: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    // txApi is callback-style, and `success: false` is its normal "not indexed
    // yet" answer. A rejection is treated the same way rather than rethrown, so
    // a momentary blip while the fullnode is busy does not fail the wait — the
    // deadline below still bounds it, and a persistent failure surfaces as the
    // timeout rather than hanging.
    const found = await new Promise<boolean>(resolve => {
      txApi
        .getTransaction(txId, response => resolve(Boolean(response?.success)))
        .catch(() => {
          resolve(false);
        });
    });

    if (found) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for tx ${txId} on the fullnode`);
    }
    await delay(pollIntervalMs);
  }
}
