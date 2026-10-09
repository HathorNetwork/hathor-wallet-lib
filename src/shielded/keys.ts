/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { crypto, encoding, HDPrivateKey } from 'bitcore-lib';
import { DecryptionError, InvalidPasswdError, ShieldedKeyError } from '../errors';
import { ErrorMessages } from '../errorMessages';
import type { IStorage, IWalletAccessData } from '../types';
import {
  IScanKeyMaterial,
  IScanKeySource,
  SessionClosedError,
  deriveScanChildKey,
  isValidPrivateKey,
  shieldedSessionOf,
  wipeScanKeyMaterial,
} from './session';

/** The length of a serialized extended key, without its checksum (BIP32). */
const EXTENDED_KEY_LENGTH = 78;

/**
 * Version bytes of extended public keys: `xpub`, which every Hathor network
 * uses, and Bitcoin's testnet `tpub`.
 */
const PUBLIC_KEY_VERSIONS = new Set([0x0488b21e, 0x043587cf]);

/**
 * Version bytes of extended private keys: Hathor's `htpr` (mainnet) and `tnpr`
 * (testnet and privatenet), and Bitcoin's `xprv` and `tprv`.
 */
const PRIVATE_KEY_VERSIONS = new Set([0x03523b05, 0x0434c8c4, 0x0488ade4, 0x04358394]);

/**
 * What an extended key is, read from its serialized bytes. The buffers are
 * copies that the caller owns; the caller zeroes a private key's buffers when
 * done.
 */
export type ClassifiedExtendedKey =
  | { type: 'private'; depth: number; chainCode: Buffer; privateKey: Buffer }
  | { type: 'public'; depth: number; chainCode: Buffer; publicKey: Buffer }
  | { type: 'invalid' };

function copyOf(source: Buffer, start: number, end: number): Buffer {
  const copy = Buffer.alloc(end - start);
  source.copy(copy, 0, start, end);
  return copy;
}

/**
 * The serialized bytes of an extended key given as a string or an
 * HDPrivateKey, or null for any other input. An HDPrivateKey is serialized
 * through its public `toBuffer()`, which holds its base58 text, so none of its
 * other properties is trusted.
 */
function decodeExtendedKey(input: unknown): Buffer | null {
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else if (input instanceof HDPrivateKey) {
    const serialized: Buffer = (input as HDPrivateKey).toBuffer();
    text = serialized.toString();
    serialized.fill(0);
  } else {
    return null;
  }
  try {
    return encoding.Base58Check.decode(text);
  } catch {
    // bitcore's errors can carry their input, so they are not passed on.
    return null;
  }
}

/**
 * Classify an extended key by its bytes alone, without bitcore's validators:
 * bitcore takes Hathor's private keys (`htpr`, `tnpr`) for public ones, and
 * parses a public key given as a private one into a bogus private key.
 *
 * - A string is Base58Check-decoded, and must be 78 bytes. An HDPrivateKey is
 *   decoded from its serialization. Any other input is invalid.
 * - A public key has a public version and the key byte 0x02 or 0x03.
 * - A private key has a private version, the key byte 0x00 and `0 < k < n`.
 *
 * It never throws, so no error can carry the input.
 *
 * @param input The key to classify
 */
export function classifyExtendedKey(input: unknown): ClassifiedExtendedKey {
  const decoded = decodeExtendedKey(input);
  if (decoded === null) {
    return { type: 'invalid' };
  }
  try {
    if (decoded.length !== EXTENDED_KEY_LENGTH) {
      return { type: 'invalid' };
    }
    const version = decoded.readUInt32BE(0);
    const depth = decoded[4];
    const keyByte = decoded[45];
    if (PUBLIC_KEY_VERSIONS.has(version) && (keyByte === 0x02 || keyByte === 0x03)) {
      return {
        type: 'public',
        depth,
        chainCode: copyOf(decoded, 13, 45),
        publicKey: copyOf(decoded, 45, 78),
      };
    }
    if (PRIVATE_KEY_VERSIONS.has(version) && keyByte === 0x00) {
      const privateKey = copyOf(decoded, 46, 78);
      if (isValidPrivateKey(privateKey)) {
        return { type: 'private', depth, chainCode: copyOf(decoded, 13, 45), privateKey };
      }
      privateKey.fill(0);
    }
    return { type: 'invalid' };
  } finally {
    decoded.fill(0);
  }
}

/**
 * The compressed public key `k·G` of a private key.
 *
 * bitcore's elliptic-curve code makes copies of `k` (bignum limbs, and its
 * representation for the multiplication) that cannot be reached to be zeroed;
 * the limbs created here are zeroed.
 */
function publicKeyOf(privateKey: Buffer): Buffer {
  const scalar = new crypto.BN(privateKey);
  try {
    return crypto.Point.pointToCompressed(crypto.Point.getG().mul(scalar));
  } finally {
    scalar.words.fill(0);
  }
}

/**
 * The key material of an extended private key given as a string or an
 * HDPrivateKey. The public key is computed from the private key, never read
 * from the input.
 *
 * @param input The extended private key
 * @throws {ShieldedKeyError} `shielded-invalid-key` unless the input is an
 *   extended private key
 */
export function keyMaterialFromExtendedKey(input: unknown): IScanKeyMaterial {
  const key = classifyExtendedKey(input);
  if (key.type !== 'private') {
    throw new ShieldedKeyError(
      ErrorMessages.SHIELDED_INVALID_KEY,
      'The key is not a valid extended private key.'
    );
  }
  return {
    privateKey: key.privateKey,
    chainCode: key.chainCode,
    publicKey: publicKeyOf(key.privateKey),
  };
}

/**
 * Decrypt the wallet's scan key (m/44'/280'/1'/0) with its PIN, without
 * checking it against the record (see {@link unlockScanKeyWithPin}).
 *
 * The xpriv string the store decrypts cannot be zeroed, and stays in memory
 * until it is garbage collected.
 *
 * @param storage The wallet storage
 * @param pinCode The PIN that encrypts the key
 * @throws {ShieldedKeyError} `shielded-wrong-pin` when the PIN does not decrypt
 *   the key, and `shielded-corrupt-key` when the record cannot be decrypted or
 *   holds no extended private key. Any other error, such as a failed store
 *   read, is rethrown as it is.
 */
export async function decryptScanKeyWithPin(
  storage: IStorage,
  pinCode: string
): Promise<IScanKeyMaterial> {
  let xpriv: string;
  try {
    xpriv = await storage.getScanXPrivKey(pinCode);
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
  try {
    return keyMaterialFromExtendedKey(xpriv);
  } catch {
    throw new ShieldedKeyError(
      ErrorMessages.SHIELDED_CORRUPT_KEY,
      'The shielded view key of the wallet record is not an extended private key.'
    );
  }
}

/**
 * Unlock the wallet's scan key with its PIN, and check that it is the key of
 * the record's `scanXpubkey`: the same public key and chain code. Version bytes
 * are not compared, since every Hathor network serializes xpubs with the same
 * version.
 *
 * @param storage The wallet storage
 * @param pinCode The PIN that encrypts the key
 * @throws {ShieldedKeyError}
 *   - `shielded-no-keys` when the record has no encrypted scan key or no scan
 *     xpub;
 *   - `shielded-wrong-pin` and `shielded-corrupt-key` as
 *     {@link decryptScanKeyWithPin} throws them;
 *   - `shielded-key-mismatch` when the key is not the key of the scan xpub.
 *
 *   Any other error, such as a failed store read, is rethrown as it is.
 */
export async function unlockScanKeyWithPin(
  storage: IStorage,
  pinCode: string
): Promise<IScanKeyMaterial> {
  const accessData = await storage.getAccessData();
  // Without any record, getScanXPrivKey reports the uninitialized wallet.
  if (accessData && (!accessData.scanMainKey || !accessData.scanXpubkey)) {
    throw new ShieldedKeyError(
      ErrorMessages.SHIELDED_NO_KEYS,
      'The wallet record has no shielded view key.'
    );
  }
  const material = await decryptScanKeyWithPin(storage, pinCode);
  const stored = classifyExtendedKey(accessData?.scanXpubkey);
  const matches =
    stored.type === 'public' &&
    stored.publicKey.equals(material.publicKey) &&
    stored.chainCode.equals(material.chainCode);
  if (!matches) {
    wipeScanKeyMaterial(material);
    throw new ShieldedKeyError(
      ErrorMessages.SHIELDED_KEY_MISMATCH,
      'The shielded view key does not match the scan xpub of the wallet record.'
    );
  }
  return material;
}

/**
 * How the Base58 text of an extended private key starts: Hathor's `htpr` and
 * `tnpr`, and Bitcoin's `xprv` and `tprv`.
 */
const PRIVATE_KEY_PREFIXES = ['htpr', 'tnpr', 'xprv', 'tprv'];

/** Whether `value` is key material in binary form: an HDPrivateKey or a Buffer. */
function isBinaryKeyMaterial(value: unknown): boolean {
  return value instanceof HDPrivateKey || value instanceof Uint8Array;
}

function holdsPrivateKeyMaterial(value: unknown): boolean {
  if (isBinaryKeyMaterial(value)) {
    return true;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    // Key text that fails its checksum, or carries more than the key, is still
    // key text.
    if (PRIVATE_KEY_PREFIXES.some(prefix => text.startsWith(prefix))) {
      return true;
    }
    const key = classifyExtendedKey(text);
    if (key.type === 'private') {
      key.privateKey.fill(0);
      key.chainCode.fill(0);
      return true;
    }
    return false;
  }
  // An object or array that holds buffers, such as the key material the lib
  // keeps in memory ({ privateKey, chainCode, publicKey }).
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(isBinaryKeyMaterial);
  }
  return false;
}

/**
 * Throw when a top-level field of `accessData` holds private key material in
 * the clear:
 * - an HDPrivateKey or a Buffer;
 * - a string that is an extended private key, or that starts like one (`htpr`,
 *   `tnpr`, `xprv` or `tprv`) once trimmed, even when its checksum fails;
 * - an object or an array that holds an HDPrivateKey or a Buffer, such as
 *   the key material the lib keeps in memory.
 *
 * Access data is persisted as it is. Encrypted keys and public strings pass.
 *
 * @param accessData The access data about to be saved
 */
export function assertNoPrivateKeyMaterial(accessData: IWalletAccessData): void {
  for (const [field, value] of Object.entries(accessData)) {
    if (holdsPrivateKeyMaterial(value)) {
      throw new Error(`Private key material cannot be saved in the access data field '${field}'.`);
    }
  }
}

/**
 * The scan key of one decode pass: a walk over the whole history, or one
 * realtime tx.
 *
 * The session's key wins: while the session holds one, the pass's PIN is not
 * used. While it holds none, a non-empty PIN unlocks the key, at most once for
 * the whole pass, and the key is checked against the record. That key is never
 * put in the session (only the wallet's start and unlock fill it), and it is
 * zeroed by dispose(). A PIN that fails for a known reason (see
 * {@link unlockScanKeyWithPin}) gives no key, so the wallet's outputs are
 * counted locked, and is not tried again in the pass. An unexpected failure is
 * thrown, and tried again for the next tx.
 *
 * The pass is bound to the session it started in. The session holds the key
 * the PIN unlocked until the pass ends, so closing or opening the session
 * zeroes it, and its source stops deriving. A pass that starts after the
 * session was closed, once the wallet was stopped, belongs to no session: it
 * unlocks nothing and writes nothing.
 */
export class ScanKeyContext {
  /** The session epoch when the pass started. */
  readonly epoch: number;

  readonly #storage: IStorage;

  readonly #pinCode: string | null;

  /** Whether the session was already closed when the pass started. */
  readonly #startedClosed: boolean;

  #material: IScanKeyMaterial | null = null;

  #pinFailed = false;

  /**
   * @param storage The wallet storage
   * @param pinCode The PIN to unlock the key with while the session holds
   *   none. An empty string and null are not tried.
   */
  constructor(storage: IStorage, pinCode?: string | null) {
    this.#storage = storage;
    this.#pinCode = typeof pinCode === 'string' && pinCode.length > 0 ? pinCode : null;
    const session = shieldedSessionOf(storage);
    this.epoch = session.epoch;
    this.#startedClosed = session.closed;
  }

  /**
   * The key source for the next decode, or null when there is no key.
   *
   * @throws {SessionClosedError} When the session was closed or opened again
   *   since the pass started, or was closed when it started. A source it gave
   *   throws it too.
   */
  async getSource(): Promise<IScanKeySource | null> {
    this.assertCurrent();
    const session = shieldedSessionOf(this.#storage);
    const sessionSource = session.source();
    if (sessionSource) {
      return sessionSource;
    }
    if (this.#pinCode === null || this.#pinFailed) {
      return null;
    }
    if (this.#material === null) {
      let material: IScanKeyMaterial;
      try {
        material = await unlockScanKeyWithPin(this.#storage, this.#pinCode);
      } catch (e) {
        if (!(e instanceof ShieldedKeyError)) {
          throw e;
        }
        this.#pinFailed = true;
        this.#storage.logger.warn(
          `The PIN given to decode shielded outputs gives no usable scan key (${e.errorCode}), ` +
            "so the wallet's shielded outputs stay locked."
        );
        return null;
      }
      if (session.epoch !== this.epoch) {
        // Closed or opened again during the unlock: the pass is over.
        wipeScanKeyMaterial(material);
        throw new SessionClosedError();
      }
      session.holdPassKey(material);
      this.#material = material;
    }
    const material = this.#material;
    return {
      derive: (index: number): Buffer => {
        this.assertCurrent();
        if (this.#material !== material) {
          throw new Error('The scan key of this decode pass was dropped.');
        }
        return deriveScanChildKey(material, index);
      },
    };
  }

  /**
   * Throw SessionClosedError when the session was closed or opened again since
   * the pass started, or was closed when it started: the wallet was stopped or
   * started again, and what the pass computed must not be written.
   */
  assertCurrent(): void {
    if (this.#startedClosed || shieldedSessionOf(this.#storage).epoch !== this.epoch) {
      throw new SessionClosedError();
    }
  }

  /** Zero the key the PIN unlocked, if any. */
  dispose(): void {
    if (this.#material !== null) {
      shieldedSessionOf(this.#storage).releasePassKey(this.#material);
      wipeScanKeyMaterial(this.#material);
      this.#material = null;
    }
  }
}
