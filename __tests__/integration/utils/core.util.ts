/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import { P2PKH_ACCT_PATH } from '../../../src/constants';
import Network from '../../../src/models/network';
import { AddressScanPolicyData, SCANNING_POLICY } from '../../../src/types';

// Re-exported so existing call sites keep working. Its home is time.util, which
// has no dependencies — see the note there on why that matters for setup code.
export { delay } from './time.util';

/**
 * Generates a random positive integer between the maximum and minimum values,
 * with the default minimum equals zero
 */
export function getRandomInt(max: number, min: number = 0): number {
  const _min = Math.ceil(min);
  const _max = Math.floor(max);
  return Math.floor(Math.random() * (_max - _min + 1)) + _min;
}

/** Derives the account-level xpub from a mnemonic seed phrase. */
export function deriveXpubFromSeed(words: string): string {
  const code = new Mnemonic(words);
  const rootXpriv = code.toHDPrivateKey('', new Network('testnet'));
  return rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH).xpubkey;
}

/**
 * Generates a gap limit scanning policy configuration.
 */
export function getGapLimitConfig(gapLimit: number = 20): AddressScanPolicyData {
  return { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit };
}
