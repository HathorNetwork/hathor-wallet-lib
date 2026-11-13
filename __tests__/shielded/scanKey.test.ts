/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { checkScanXPrivKey } from '../../src/shielded/scanKey';
import { SHIELDED_SCAN_ACCT_PATH } from '../../src/constants';

describe('checkScanXPrivKey', () => {
  const root = new HDPrivateKey();
  const scan = root.deriveChild(SHIELDED_SCAN_ACCT_PATH).deriveChild(0);

  it('gives the scan xpriv without the whitespace around it', () => {
    expect(checkScanXPrivKey(` ${scan.xprivkey}\n`, scan.xpubkey)).toBe(scan.xprivkey);
  });

  it('rejects a key that is not a scan key before comparing it', () => {
    expect(() => checkScanXPrivKey(root.xprivkey, scan.xpubkey)).toThrow(
      expect.objectContaining({ errorCode: 'shielded-not-scan-key' })
    );
  });

  it('rejects the scan key of another wallet', () => {
    const other = new HDPrivateKey().deriveChild(SHIELDED_SCAN_ACCT_PATH).deriveChild(0);
    expect(() => checkScanXPrivKey(other.xprivkey, scan.xpubkey)).toThrow(
      expect.objectContaining({ errorCode: 'shielded-key-mismatch' })
    );
  });

  it('rejects an empty or blank key', () => {
    for (const input of ['', '  ', undefined]) {
      expect(() => checkScanXPrivKey(input, scan.xpubkey)).toThrow(
        expect.objectContaining({ errorCode: 'shielded-corrupt-key' })
      );
    }
  });
});
