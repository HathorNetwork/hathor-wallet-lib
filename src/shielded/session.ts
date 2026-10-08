/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// eslint-disable-next-line max-classes-per-file -- The session and the internal error its key sources throw
import { crypto } from 'bitcore-lib';
import { ShieldedKeyError } from '../errors';
import { ErrorMessages } from '../errorMessages';
import type { HistorySyncMode, IStorage } from '../types';
import type { IShieldedUndecodedSummary, ShieldedCapabilityCause } from './types';

/**
 * A wallet's scan private key (m/44'/280'/1'/0) as raw buffers: the private key
 * `k` (32 bytes), its chain code `c` (32 bytes) and its compressed public key
 * `K = k·G` (33 bytes).
 *
 * Whoever holds the material owns its buffers and zeroes them with
 * {@link wipeScanKeyMaterial} when done. No HDPrivateKey and no xpriv string is
 * kept for the key: bitcore keeps keys in immutable strings, which cannot be
 * zeroed.
 */
export interface IScanKeyMaterial {
  privateKey: Buffer;
  chainCode: Buffer;
  publicKey: Buffer;
}

/**
 * Derives the scan private keys of one wallet's shielded addresses.
 */
export interface IScanKeySource {
  /**
   * The scan private key at m/44'/280'/1'/0/`index`: the key that opens the
   * shielded outputs paid to the wallet's shielded address at `index`. The
   * caller owns the returned 32-byte buffer and zeroes it after use.
   */
  derive(index: number): Buffer;
}

/**
 * Counts of the wallet's own shielded outputs that one tx left undecoded. The
 * meaning of each count is documented on {@link IShieldedUndecodedSummary}.
 */
export type ShieldedUndecodedCounts = Pick<
  IShieldedUndecodedSummary,
  'locked' | 'unreadable' | 'error'
>;

/** Why the session holds no key, or why the record has no shielded keys. */
export type ShieldedSessionCause = Exclude<ShieldedCapabilityCause, 'key-mismatch'>;

/** A record whose own scan key and scan xpub disagree. */
export type ShieldedIntegrityCause = Extract<ShieldedCapabilityCause, 'key-mismatch'>;

/** The first hardened BIP32 index. */
const HARDENED_INDEX = 0x80000000;

/**
 * The order n of the secp256k1 group, as 33 big-endian bytes with a leading
 * zero byte: the width of the sums it reduces.
 */
const CURVE_ORDER: Buffer = Buffer.concat([
  Buffer.alloc(1),
  crypto.Point.getN().toBuffer({ size: 32 }),
]);

/** Compare two big-endian numbers of the same length. */
function compareBytes(a: Buffer, b: Buffer): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** `a -= b`, for big-endian numbers of the same length, with `a >= b`. */
function subtractInPlace(a: Buffer, b: Buffer): void {
  let borrow = 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const difference = a[i] - b[i] - borrow;
    // eslint-disable-next-line no-param-reassign
    a[i] = difference & 0xff;
    borrow = difference < 0 ? 1 : 0;
  }
}

function isZero(bytes: Buffer): boolean {
  return bytes.every(byte => byte === 0);
}

/**
 * Whether `privateKey` holds a valid secp256k1 private key: 32 big-endian
 * bytes `k` with `0 < k < n`.
 */
export function isValidPrivateKey(privateKey: Buffer): boolean {
  if (privateKey.length !== 32 || isZero(privateKey)) {
    return false;
  }
  return compareBytes(privateKey, CURVE_ORDER.subarray(1)) < 0;
}

/**
 * Zero the buffers of a scan key.
 */
export function wipeScanKeyMaterial(material: IScanKeyMaterial): void {
  material.privateKey.fill(0);
  material.chainCode.fill(0);
  material.publicKey.fill(0);
}

/**
 * The non-hardened child private key at `index` of the key in `material`: the
 * key bitcore's `HDPrivateKey.deriveChild(index)` gives.
 *
 * - `I = HMAC-SHA512(c, K ‖ ser32(index))`, and the child key is
 *   `(I_L + k) mod n`, where `I_L` is the first half of `I`;
 * - when that is zero, which is not a valid key, it moves on to `index + 1`,
 *   as bitcore does.
 *
 * It works on buffers only, so it creates no bitcore key object and no key
 * string, and it zeroes its temporaries before it returns. Note that one child
 * key and the public scanXpubkey are enough to compute the parent key (BIP32),
 * so a child key needs the same care as the parent.
 *
 * @param material The parent key
 * @param index A non-hardened index, from 0 to 2^31 - 1
 * @returns A new 32-byte buffer with the child private key, which the caller
 *   zeroes after use
 */
export function deriveScanChildKey(material: IScanKeyMaterial, index: number): Buffer {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED_INDEX) {
    throw new Error(`Invalid non-hardened index: ${index}`);
  }
  const data = Buffer.alloc(37);
  // I_L + k needs one byte more than either term.
  const sum = Buffer.alloc(33);
  try {
    material.publicKey.copy(data, 0);
    for (let i = index; i < HARDENED_INDEX; i += 1) {
      data.writeUInt32BE(i, 33);
      const digest: Buffer = crypto.Hash.sha512hmac(data, material.chainCode);
      let carry = 0;
      for (let j = 31; j >= 0; j -= 1) {
        const total = digest[j] + material.privateKey[j] + carry;
        sum[j + 1] = total & 0xff;
        carry = total >> 8;
      }
      sum[0] = carry;
      digest.fill(0);
      // I_L < 2^256 and k < n, and 2^256 < 2n, so the sum is below 3n: at most
      // two subtractions reduce it.
      while (compareBytes(sum, CURVE_ORDER) >= 0) {
        subtractInPlace(sum, CURVE_ORDER);
      }
      if (!isZero(sum)) {
        const child = Buffer.alloc(32);
        sum.copy(child, 0, 1);
        return child;
      }
    }
  } finally {
    data.fill(0);
    sum.fill(0);
  }
  throw new Error(`No valid child key from index ${index} to the end of the non-hardened range`);
}

/**
 * Thrown when work bound to a shielded session outlives it: a key source used,
 * or a decode finished, after the session was closed or opened again because
 * the wallet was stopped or started again. Internal; callers treat it as a
 * stop.
 */
export class SessionClosedError extends Error {
  constructor() {
    super('The shielded session was closed.');
    this.name = 'SessionClosedError';
  }
}

/**
 * The shielded view of a started wallet: its scan key, held in memory from
 * `start()` to `stop()` and never persisted, and what the wallet found out
 * about the shielded outputs it could not decode.
 *
 * There is one session per storage object (see {@link shieldedSessionOf}).
 * Its state lives in private fields, so it cannot be reached through the
 * storage, serialized or inspected, which keeps the key out of stores, logs and
 * events. This is not a boundary against code running in the same process.
 */
export class ShieldedSession {
  #key: IScanKeyMaterial | null = null;

  /** The keys decode passes unlocked with a PIN, while they run. */
  #passKeys = new Set<IScanKeyMaterial>();

  #epoch = 0;

  #active = false;

  #closed = false;

  #cause: ShieldedSessionCause | null = null;

  #integrity: ShieldedIntegrityCause | null = null;

  #spendSigner = false;

  #syncMode: HistorySyncMode | null = null;

  #discoveryCapped = false;

  #undecoded = new Map<string, ShieldedUndecodedCounts>();

  /**
   * Incremented by every open() and close(). Work that started under another
   * value belongs to a session that was closed since, and must not write what
   * it computed.
   */
  get epoch(): number {
    return this.#epoch;
  }

  /** Whether the wallet is started: true from open() until close(). */
  get active(): boolean {
    return this.#active;
  }

  /**
   * Whether the session was closed and not opened again: the wallet was
   * stopped. A session that was never opened is not closed.
   */
  get closed(): boolean {
    return this.#closed;
  }

  /** Whether the session holds a scan key. */
  get hasKey(): boolean {
    return this.#key !== null;
  }

  /**
   * Why the session holds no key, or why the record has no shielded keys.
   * Null when there is a key, or when nothing failed.
   */
  get cause(): ShieldedSessionCause | null {
    return this.#cause;
  }

  /**
   * A mismatch inside the record found while unlocking its key. The record's
   * shielded keys are not used while it is set.
   */
  get integrity(): ShieldedIntegrityCause | null {
    return this.#integrity;
  }

  /**
   * Whether the external tx signer declared that it signs shielded spend
   * inputs. Like the signer itself, it survives open() and close().
   */
  get spendSigner(): boolean {
    return this.#spendSigner;
  }

  /** The history sync mode the wallet last used, or null before its first sync. */
  get syncMode(): HistorySyncMode | null {
    return this.#syncMode;
  }

  /** Whether the address discovery of the last history walk stopped at its round limit. */
  get discoveryCapped(): boolean {
    return this.#discoveryCapped;
  }

  /**
   * Start a session, at `start()`: drop the key and everything known from an
   * earlier start, except the signer declaration.
   */
  open(): void {
    this.#reset();
    this.#active = true;
    this.#closed = false;
    this.#epoch += 1;
  }

  /**
   * End the session, at `stop()`: zero the key, and the keys decode passes
   * unlocked with a PIN, and drop everything except the signer declaration. It
   * is synchronous, so it takes effect before the caller awaits anything.
   */
  close(): void {
    this.#reset();
    this.#active = false;
    this.#closed = true;
    this.#epoch += 1;
  }

  /**
   * Hold `material`, a scan key a decode pass unlocked with a PIN while the
   * session held none, until the pass releases it. Opening or closing the
   * session zeroes it, so stop() leaves no key of a pass behind either.
   */
  holdPassKey(material: IScanKeyMaterial): void {
    this.#passKeys.add(material);
  }

  /** Stop holding a pass key, which the pass zeroes itself. */
  releasePassKey(material: IScanKeyMaterial): void {
    this.#passKeys.delete(material);
  }

  /**
   * Hold `material` as the session's scan key. The session takes ownership of
   * the buffers, and zeroes the key it held before.
   *
   * The caller verified the key against the wallet's record, so filling also
   * clears the cause and any integrity failure.
   *
   * @param material The verified scan key
   * @param epochAtEntry The epoch the caller read before it started to unlock
   *   the key
   * @throws {ShieldedKeyError} `shielded-not-started` when the session is not
   *   open, or was closed or opened again since `epochAtEntry`. The material is
   *   zeroed first.
   */
  fill(material: IScanKeyMaterial, epochAtEntry: number): void {
    if (!this.#active || this.#epoch !== epochAtEntry) {
      wipeScanKeyMaterial(material);
      throw new ShieldedKeyError(
        ErrorMessages.SHIELDED_NOT_STARTED,
        'The wallet was stopped or started again while its shielded view key was unlocked.'
      );
    }
    if (
      !isValidPrivateKey(material.privateKey) ||
      material.chainCode.length !== 32 ||
      material.publicKey.length !== 33
    ) {
      wipeScanKeyMaterial(material);
      throw new ShieldedKeyError(
        ErrorMessages.SHIELDED_INVALID_KEY,
        'The shielded view key is not a valid extended private key.'
      );
    }
    const previous = this.#key;
    this.#key = material;
    if (previous && previous !== material) {
      wipeScanKeyMaterial(previous);
    }
    this.#cause = null;
    this.#integrity = null;
  }

  /**
   * A source that derives with the session's key, or null when the session
   * holds none. The source is bound to the current epoch: once the session is
   * closed or opened again, its `derive` throws {@link SessionClosedError}.
   */
  source(): IScanKeySource | null {
    if (this.#key === null) {
      return null;
    }
    const epoch = this.#epoch;
    return {
      derive: (index: number): Buffer => {
        if (this.#epoch !== epoch || this.#key === null) {
          throw new SessionClosedError();
        }
        return deriveScanChildKey(this.#key, index);
      },
    };
  }

  setCause(cause: ShieldedSessionCause | null): void {
    this.#cause = cause;
  }

  setIntegrity(integrity: ShieldedIntegrityCause | null): void {
    this.#integrity = integrity;
  }

  setSpendSigner(spendSigner: boolean): void {
    this.#spendSigner = spendSigner;
  }

  setSyncMode(syncMode: HistorySyncMode | null): void {
    this.#syncMode = syncMode;
  }

  setDiscoveryCapped(discoveryCapped: boolean): void {
    this.#discoveryCapped = discoveryCapped;
  }

  /**
   * Record the wallet's own outputs that the last decode pass over `txId` left
   * undecoded, replacing what was recorded for it. Zero counts remove the tx.
   */
  recordUndecoded(txId: string, counts: ShieldedUndecodedCounts): void {
    if (counts.locked + counts.unreadable + counts.error > 0) {
      this.#undecoded.set(txId, {
        locked: counts.locked,
        unreadable: counts.unreadable,
        error: counts.error,
      });
    } else {
      this.#undecoded.delete(txId);
    }
  }

  /** Drop every recorded tx, before a walk over the whole history records them again. */
  resetUndecoded(): void {
    this.#undecoded.clear();
  }

  /** The recorded counts, summed over every tx. */
  undecodedSummary(): IShieldedUndecodedSummary {
    const summary: IShieldedUndecodedSummary = {
      txIds: [...this.#undecoded.keys()].sort(),
      locked: 0,
      unreadable: 0,
      error: 0,
    };
    for (const counts of this.#undecoded.values()) {
      summary.locked += counts.locked;
      summary.unreadable += counts.unreadable;
      summary.error += counts.error;
    }
    return summary;
  }

  #reset(): void {
    if (this.#key !== null) {
      wipeScanKeyMaterial(this.#key);
      this.#key = null;
    }
    for (const material of this.#passKeys) {
      wipeScanKeyMaterial(material);
    }
    this.#passKeys.clear();
    this.#cause = null;
    this.#integrity = null;
    this.#syncMode = null;
    this.#discoveryCapped = false;
    this.#undecoded.clear();
  }
}

const sessions = new WeakMap<IStorage, ShieldedSession>();

/**
 * The shielded session of a storage object, created on first use.
 *
 * The session is kept in a module-private map instead of a storage member, so
 * no IStorage implementation needs to change, and nothing that serializes or
 * inspects the storage or the wallet reaches it. This module is internal: the
 * lib does not export it.
 *
 * @param storage The wallet storage
 */
export function shieldedSessionOf(storage: IStorage): ShieldedSession {
  let session = sessions.get(storage);
  if (!session) {
    session = new ShieldedSession();
    sessions.set(storage, session);
  }
  return session;
}
