/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { DecryptionError, InvalidPasswdError, ShieldedKeyError } from '../errors';
import { ErrorMessages } from '../errorMessages';
import type { IStorage } from '../types';

/**
 * Decrypt the wallet's scan private key (xpriv) with its PIN, without checking
 * it against the record.
 *
 * @throws {ShieldedKeyError} `shielded-wrong-pin` when the PIN does not decrypt
 *   the key, and `shielded-corrupt-key` when the record cannot be decrypted.
 *   Any other error, such as a failed store read, is rethrown as it is.
 */
export async function decryptScanXPrivKey(storage: IStorage, pinCode: string): Promise<string> {
  try {
    return await storage.getScanXPrivKey(pinCode);
  } catch (e) {
    if (e instanceof InvalidPasswdError) {
      throw new ShieldedKeyError(
        ErrorMessages.SHIELDED_WRONG_PIN,
        'The PIN does not decrypt the shielded view key.',
        e
      );
    }
    if (e instanceof DecryptionError) {
      throw new ShieldedKeyError(
        ErrorMessages.SHIELDED_CORRUPT_KEY,
        'The shielded view key of the wallet record cannot be decrypted.',
        e
      );
    }
    throw e;
  }
}

/**
 * The scan key an xpriv holds.
 *
 * @throws {ShieldedKeyError} `shielded-corrupt-key` when it is not an extended
 *   private key
 */
export function parseScanXPrivKey(xpriv: string): HDPrivateKey {
  let key: HDPrivateKey | null;
  try {
    key = new HDPrivateKey(xpriv);
  } catch {
    key = null;
  }
  // bitcore also reads some extended public keys as private ones. Only a
  // private key serializes back to the text it was read from.
  if (!key || key.xprivkey !== xpriv) {
    throw new ShieldedKeyError(
      ErrorMessages.SHIELDED_CORRUPT_KEY,
      'The shielded view key of the wallet record is not an extended private key.'
    );
  }
  return key;
}

/**
 * Decrypt the wallet's scan private key (xpriv) with its PIN, and check that it
 * is the key of the record's scanXpubkey.
 *
 * @throws {ShieldedKeyError}
 *   - `shielded-no-keys` when the record has no encrypted scan key or no scan
 *     xpub;
 *   - `shielded-wrong-pin` and `shielded-corrupt-key` when the key cannot be
 *     decrypted, or is not an extended private key;
 *   - `shielded-key-mismatch` when it is not the key of the scan xpub.
 *
 *   Any other error, such as a failed store read, is rethrown as it is.
 */
export async function unlockScanXPrivKey(storage: IStorage, pinCode: string): Promise<string> {
  const accessData = await storage.getAccessData();
  // Without any record, getScanXPrivKey reports the uninitialized wallet.
  if (accessData && (!accessData.scanMainKey || !accessData.scanXpubkey)) {
    throw new ShieldedKeyError(
      ErrorMessages.SHIELDED_NO_KEYS,
      'The wallet record has no shielded view key.'
    );
  }
  const xpriv = await decryptScanXPrivKey(storage, pinCode);
  if (parseScanXPrivKey(xpriv).xpubkey !== accessData?.scanXpubkey) {
    throw new ShieldedKeyError(
      ErrorMessages.SHIELDED_KEY_MISMATCH,
      'The shielded view key does not match the scan xpub of the wallet record.'
    );
  }
  return xpriv;
}

/** Gives a decode pass its scan key, or null when there is none. */
export type ScanKeyOfPass = () => Promise<HDPrivateKey | null>;

/**
 * The scan key of one decode pass, a walk over the history or one tx:
 * `storage.scanXPrivKey`, which start() keeps in memory, or else the key
 * `pinCode` unlocks, at most once for the whole pass.
 *
 * A PIN that gives no usable key is logged, and leaves the wallet's shielded
 * outputs counted locked. An unexpected failure is thrown, and tried again for
 * the next tx. An empty PIN and null are not tried.
 *
 * @param storage The wallet storage
 * @param pinCode The PIN to unlock the key with while the storage holds none
 */
export function scanKeyOfPass(storage: IStorage, pinCode?: string | null): ScanKeyOfPass {
  let parsed: { xpriv: string; key: HDPrivateKey } | null = null;
  let fromPin: Promise<HDPrivateKey | null> | null = null;
  return async () => {
    const { scanXPrivKey } = storage;
    if (scanXPrivKey) {
      if (parsed?.xpriv !== scanXPrivKey) {
        parsed = { xpriv: scanXPrivKey, key: parseScanXPrivKey(scanXPrivKey) };
      }
      return parsed.key;
    }
    if (!pinCode) {
      return null;
    }
    if (!fromPin) {
      fromPin = unlockScanXPrivKey(storage, pinCode).then(
        xpriv => parseScanXPrivKey(xpriv),
        error => {
          if (!(error instanceof ShieldedKeyError)) {
            fromPin = null;
            throw error;
          }
          storage.logger.warn(
            `The PIN given to decode shielded outputs gives no usable scan key (${error.errorCode}), ` +
              "so the wallet's shielded outputs stay locked."
          );
          return null;
        }
      );
    }
    return fromPin;
  };
}
