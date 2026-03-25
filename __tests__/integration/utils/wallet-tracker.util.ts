/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { WalletStopOptions } from '../../../src/new/types';
import { loggers } from './logger.util';

interface Stoppable {
  stop(options?: WalletStopOptions): Promise<void>;
}

/**
 * Tracks wallet instances and guarantees cleanup via {@link stopAll}.
 *
 * Both test adapters and standalone tests can use this to avoid leaking
 * wallets when an assertion fails before an explicit `stop()` call.
 */
export class WalletTracker<T extends Stoppable> {
  private wallets: T[] = [];

  private readonly stopOptions: WalletStopOptions;

  constructor(stopOptions: WalletStopOptions = { cleanStorage: true }) {
    this.stopOptions = stopOptions;
  }

  track(wallet: T): void {
    this.wallets.push(wallet);
  }

  untrack(wallet: T): void {
    this.wallets = this.wallets.filter(w => w !== wallet);
  }

  async stopAll(): Promise<void> {
    let wallet = this.wallets.pop();
    while (wallet) {
      try {
        await wallet.stop(this.stopOptions);
      } catch (e) {
        loggers.test!.warn('Failed to stop wallet during cleanup', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      wallet = this.wallets.pop();
    }
  }
}
