/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Funding for integration tests, served by the integration-test-helper.
 *
 * The helper owns the genesis wallet and hands out funds from a reserved UTXO
 * pool over `POST /fund`. The suite therefore keeps no genesis wallet of its
 * own and never competes with the helper for the same UTXOs.
 */
import HathorWallet from '../../../src/new/wallet';
import Transaction from '../../../src/models/transaction';
import { OutputValueType } from '../../../src/types';
import { waitForTxReceived, waitUntilNextTimestamp } from './wallet.helper';
import { loggers } from '../utils/logger.util';
import { ithService, IthServiceError } from './ith-service';

export interface InjectFundsOptions {
  waitTimeout?: number;
}

/**
 * What funding returns: the helper's `/fund` answers with a txId and nothing
 * else, so this is narrowed to exactly that rather than claiming to be a full
 * `Transaction`. A wider type would compile at every call site while returning
 * `undefined` for `.outputs`, `.inputs` or `.timestamp`.
 */
export type InjectedFundsTx = Pick<Transaction, 'hash'>;

/**
 * Send HTR to a wallet's address through the integration-test-helper.
 *
 * @param destinationWallet Wallet receiving the funds
 * @param address Address to fund
 * @param value Amount to send
 * @param [options.waitTimeout] Websocket confirmation timeout; 0 skips the wait
 */
export async function injectFunds(
  destinationWallet: HathorWallet,
  address: string,
  value: OutputValueType,
  options: InjectFundsOptions = {}
): Promise<InjectedFundsTx> {
  // Captured outside the try so the catch can tell "the helper never funded"
  // apart from "it funded and our wallet never saw the tx".
  let fundedTxId: string | undefined;
  try {
    // /fund returns once the tx is broadcast, not once it is indexed. Wait
    // until the destination wallet observes it, which is the guarantee callers
    // actually rely on.
    fundedTxId = (await ithService.fund(address, value)).txId;
    const result: InjectedFundsTx = { hash: fundedTxId };

    if (options.waitTimeout === 0) {
      return result;
    }

    await waitForTxReceived(destinationWallet, fundedTxId, options.waitTimeout);
    // Timestamps are per-second and a tx must be timestamped strictly after
    // its parent. Without this wait, a test that spends the just-funded UTXO
    // within the same second collides with the funding tx and flakes. Applied
    // via the destination wallet, which is the one that now has the tx.
    await waitUntilNextTimestamp(destinationWallet, fundedTxId);
    return result;
  } catch (e) {
    // Two very different failures reach here: the helper refused to fund, or
    // it funded and our wallet never observed the tx. Logging the txId is what
    // separates them, and it is the key to cross-reference against the
    // helper's own logs and the fullnode.
    const cause =
      e instanceof IthServiceError
        ? `${e.code} (HTTP ${e.status}, retryable=${e.retryable}): ${e.message}`
        : (e as Error).message;
    loggers.test!.error(
      `Failed to inject funds: address=${address} value=${value} ` +
        `txId=${fundedTxId ?? 'not-broadcast'} — ${cause}`
    );
    throw e;
  }
}
