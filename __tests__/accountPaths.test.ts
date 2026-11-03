/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  HATHOR_NEXT_ACCT_PATH,
  P2PKH_ACCT_PATH,
  SHIELDED_SCAN_ACCT_PATH,
  SHIELDED_SPEND_ACCT_PATH,
} from '../src/constants';

describe('BIP44 account paths', () => {
  it('gives every key family its own account', () => {
    const paths = [
      P2PKH_ACCT_PATH,
      SHIELDED_SCAN_ACCT_PATH,
      SHIELDED_SPEND_ACCT_PATH,
      HATHOR_NEXT_ACCT_PATH,
    ];
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('reserves account 3 for Hathor Next', () => {
    expect(HATHOR_NEXT_ACCT_PATH).toBe("m/44'/280'/3'");
  });
});
