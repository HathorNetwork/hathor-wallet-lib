/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { HistorySyncMode } from '../types';
import type { IShieldedUndecodedSummary, ShieldedCapabilityCause } from './types';

/**
 * Counts of the wallet's own shielded outputs that one tx left undecoded. The
 * meaning of each count is documented on {@link IShieldedUndecodedSummary}.
 */
export type ShieldedUndecodedCounts = Pick<
  IShieldedUndecodedSummary,
  'locked' | 'unreadable' | 'error'
>;

/** Why the wallet holds no scan key, or why its record has no shielded keys. */
export type ShieldedViewCause = Exclude<ShieldedCapabilityCause, 'key-mismatch'>;

/**
 * What a started wallet knows about its shielded view, besides the scan key
 * itself, which is `storage.scanXPrivKey`. It is plain data: start() and stop()
 * reset it, and the shielded capability is computed from it.
 */
export class ShieldedViewState {
  /** Whether the wallet is started: true from start() until stop(). */
  started = false;

  /** Why the wallet holds no scan key, or why its record has no shielded keys. */
  cause: ShieldedViewCause | null = null;

  /**
   * Set when the record's own scan key and scan xpub disagree. The record's
   * shielded keys are not used while it is set.
   */
  integrity: 'key-mismatch' | null = null;

  /**
   * Whether the external tx signer declared that it signs shielded spend
   * inputs. Like the signer itself, it survives start() and stop().
   */
  spendSigner = false;

  /** The history sync mode the wallet last used, or null before its first sync. */
  syncMode: HistorySyncMode | null = null;

  /** Whether the address discovery of the last history walk stopped at its round limit. */
  discoveryCapped = false;

  /** The wallet's own shielded outputs that the last decode of each tx left undecoded. */
  readonly undecoded = new Map<string, ShieldedUndecodedCounts>();

  /** Forget what is known about the view, except the signer declaration. */
  reset(): void {
    this.cause = null;
    this.integrity = null;
    this.syncMode = null;
    this.discoveryCapped = false;
    this.undecoded.clear();
  }

  /**
   * Record the wallet's own outputs that the last decode of `txId` left
   * undecoded, replacing what was recorded for it. Zero counts remove the tx.
   */
  recordUndecoded(txId: string, counts: ShieldedUndecodedCounts): void {
    if (counts.locked + counts.unreadable + counts.error > 0) {
      this.undecoded.set(txId, {
        locked: counts.locked,
        unreadable: counts.unreadable,
        error: counts.error,
      });
    } else {
      this.undecoded.delete(txId);
    }
  }

  /** The recorded counts, summed over every tx. */
  undecodedSummary(): IShieldedUndecodedSummary {
    const summary: IShieldedUndecodedSummary = {
      txIds: [...this.undecoded.keys()].sort(),
      locked: 0,
      unreadable: 0,
      error: 0,
    };
    for (const counts of this.undecoded.values()) {
      summary.locked += counts.locked;
      summary.unreadable += counts.unreadable;
      summary.error += counts.error;
    }
    return summary;
  }
}
