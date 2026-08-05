/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import txApi from '../../../src/api/txApi';
import { delay } from './time.util';

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
