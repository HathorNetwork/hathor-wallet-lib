/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { IStorage, IHistoryTx, IHistoryShieldedOutput, ILogger } from '../types';
import { NATIVE_TOKEN_UID, NATIVE_TOKEN_UID_HEX, PRIVATE_KEY_SIZE_BYTES } from '../constants';
import tokenUtils from '../utils/tokens';
import { IShieldedCryptoProvider, IProcessedShieldedOutput, ShieldedOutputMode } from './types';
import type { ShieldedUndecodedCounts } from './view';
import { ScanKeyOfPass, decryptScanXPrivKey, parseScanXPrivKey } from './scanKey';

/**
 * Resolve the 32-byte hex token UID (NATIVE_TOKEN_UID_HEX for HTR) from an
 * output's `token_data` and the tx's token list. Generic over any output — the
 * same `token_data` → token-index convention transparent I/O uses (see
 * transaction.ts `hydrateIOWithToken`).
 *
 * The caller must not call this for FullShielded outputs, whose token is hidden
 * behind `asset_commitment` and only recovered by rewind (decodeShieldedOutputs
 * routes them away before reaching here).
 */
export function resolveTokenUid(tokenData: number | undefined, tx: IHistoryTx): string {
  // `token_data` is only ever absent on FullShielded outputs (handled by the
  // caller), so a missing value here is a bug — fail loud rather than silently
  // resolving to the native slot, which would misattribute a custom token as HTR.
  if (tokenData === undefined) {
    throw new Error(`Output on tx ${tx.tx_id} is missing token_data`);
  }
  const tokenIndex = tokenUtils.getTokenIndexFromData(tokenData);
  if (tokenIndex === 0) {
    return NATIVE_TOKEN_UID_HEX;
  }
  if (tx.tokens && tokenIndex <= tx.tokens.length) {
    const uid = tx.tokens[tokenIndex - 1];
    return uid === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : uid;
  }
  throw new Error(
    `Invalid token_data index ${tokenIndex} for tx ${tx.tx_id} ` +
      `(transaction has ${tx.tokens?.length ?? 0} custom tokens)`
  );
}

/**
 * Derive the per-address scan private key from an already-decrypted scan
 * HDPrivateKey. The parent xpriv is unlocked once per pass by the caller; only
 * the cheap per-address child derivation runs here.
 *
 * The scan key uses a separate account (m/44'/280'/1'/0) from legacy P2PKH (account 0').
 * Returns the raw 32-byte private key for ECDH, or undefined if not derivable.
 */
function deriveScanChildPrivkey(
  scanHdPrivKey: HDPrivateKey,
  addressIndex: number,
  logger: ILogger
): Buffer | undefined {
  try {
    // Compliant BIP32 derivation, matching the scan PUBLIC key put into the
    // shielded address (shieldedAddress.ts). Shielded keys are new — there is no
    // legacy key material to stay bug-compatible with — so unlike the legacy
    // P2PKH chain (still on deriveNonCompliantChild) they use the correct method.
    const childKey = scanHdPrivKey.deriveChild(addressIndex);
    // The native crypto provider (ECDH) needs raw private key bytes. Other
    // wallet-lib code passes bitcore PrivateKey objects directly to bitcore
    // signing functions, but here we cross into the native ct-crypto boundary.
    // { size } ensures zero-padding for keys with leading zeros.
    return childKey.privateKey.toBuffer({ size: PRIVATE_KEY_SIZE_BYTES });
  } catch (e) {
    logger.warn('Failed to derive scan private key for shielded output at index', addressIndex, e);
    return undefined;
  }
}

/**
 * What a decode pass did with the wallet's own shielded outputs of one tx.
 *
 * An output is the wallet's when it is not decoded yet, carries an ephemeral
 * public key, and its address is one of the wallet's addresses, which takes no
 * key to check. Outputs of other wallets are in no list. The lists hold
 * absolute on-chain indexes (`tx.outputs.length + s`). Their lengths are the
 * counts recorded for the tx, as described on IShieldedUndecodedSummary.
 */
export interface IShieldedDecodeOutcome {
  /**
   * The outputs this pass decoded. Their fields were written in place on
   * `tx.shielded_outputs`.
   */
  decoded: IProcessedShieldedOutput[];
  /** Not decoded because there was no crypto provider or no scan key. */
  locked: number[];
  /**
   * Decoded with the wallet's key without success: the output does not open
   * with it, or is malformed (a non-positive value, an asset commitment that
   * does not match the recovered token, an invalid token index, an address
   * without a derivation index). Decoding again gives the same result.
   */
  unreadable: number[];
  /**
   * Not decoded because the pass stopped on `failure`. It includes outputs
   * whose ownership was not checked yet, so it can count outputs of other
   * wallets.
   */
  error: number[];
  /**
   * The unexpected error that stopped the pass, such as a failed store read or
   * a failure of the key provider other than a known key problem. Null when the
   * pass did not stop.
   */
  failure: { cause: unknown } | null;
}

/** An output of the wallet, found by a decode pass. */
interface IOwnedShieldedOutput {
  output: IHistoryShieldedOutput;
  address: string;
  absoluteIndex: number;
  /** The BIP32 index of its address, or null when the store has none. */
  addressIndex: number | null;
}

/**
 * The counts of a pass's outcome: how many of the wallet's outputs it left
 * undecoded, by reason.
 */
export function undecodedCountsOf(outcome: IShieldedDecodeOutcome): ShieldedUndecodedCounts {
  return {
    locked: outcome.locked.length,
    unreadable: outcome.unreadable.length,
    error: outcome.error.length,
  };
}

/**
 * Log one line about the wallet's shielded outputs that could not be decoded:
 * at warn level when some are unreadable or in error, at info level when they
 * are all locked. Nothing is logged when every output was decoded.
 *
 * @param logger The logger to use
 * @param subject Where the outputs are, such as `tx <id>`
 * @param counts The outputs left undecoded
 */
export function logUndecodedOutputs(
  logger: ILogger,
  subject: string,
  counts: ShieldedUndecodedCounts
): void {
  if (counts.locked + counts.unreadable + counts.error === 0) {
    return;
  }
  const message =
    `Shielded outputs of the wallet in ${subject} could not be decoded: ` +
    `${counts.locked} locked, ${counts.unreadable} unreadable, ${counts.error} in error`;
  if (counts.unreadable + counts.error > 0) {
    logger.warn(message);
  } else {
    logger.info(message);
  }
}

/**
 * Write a decoded output's fields IN PLACE onto its on-chain-ordered shielded
 * output entry. `value !== undefined` is then the single ownership gate:
 * downstream loops (creditOutput, getTxBalance) read straight off these
 * fields. The `decoded.address` was already present on the wire entry; it is
 * kept, but not relied on for ownership.
 */
function writeDecodedOutput(
  shieldedOutput: IHistoryShieldedOutput,
  decoded: IProcessedShieldedOutput
): void {
  const { value, blindingFactor, tokenUid, assetBlindingFactor, mode } = decoded.decrypted;
  /* eslint-disable no-param-reassign */
  shieldedOutput.value = value;
  shieldedOutput.token = tokenUid === NATIVE_TOKEN_UID_HEX ? NATIVE_TOKEN_UID : tokenUid;
  shieldedOutput.blindingFactor = blindingFactor.toString('hex');
  shieldedOutput.assetBlindingFactor = assetBlindingFactor?.toString('hex');
  shieldedOutput.decoded = { ...shieldedOutput.decoded, address: decoded.address };
  shieldedOutput.mode = mode;
  /* eslint-enable no-param-reassign */
}

/**
 * Decode one output of the wallet with its scan key. Nothing is written: the
 * pass writes what it recovered once every output is done.
 *
 * @returns The decoded output, or null when it is unreadable. Each reason is
 *   logged at debug level.
 */
async function decodeOwnedOutput(
  storage: IStorage,
  tx: IHistoryTx,
  cryptoProvider: IShieldedCryptoProvider,
  scanKey: HDPrivateKey,
  owned: IOwnedShieldedOutput
): Promise<IProcessedShieldedOutput | null> {
  const { output: shieldedOutput, address, absoluteIndex } = owned;
  if (owned.addressIndex === null) {
    storage.logger.debug(
      'Shielded output address has no derivation index for tx',
      tx.tx_id,
      'index',
      absoluteIndex
    );
    return null;
  }

  // Derive this address's scan private key (ECDH).
  const privkey = deriveScanChildPrivkey(scanKey, owned.addressIndex, storage.logger);
  if (!privkey) {
    return null;
  }

  // The fullnode always sets `mode`, so classify directly from it.
  const isFullShielded = shieldedOutput.mode === ShieldedOutputMode.FULLY_SHIELDED;

  try {
    // Inside the try: a malformed field makes this output unreadable, and the
    // finally still zeroes its key.
    const ephPk = Buffer.from(shieldedOutput.ephemeral_pubkey!, 'hex');
    const commitment = Buffer.from(shieldedOutput.commitment, 'hex');
    const rangeProof = Buffer.from(shieldedOutput.range_proof, 'hex');
    let recoveredValue: bigint;
    let recoveredBf: Buffer;
    let recoveredTokenUid: string;
    let recoveredAbf: Buffer | undefined;
    let mode: ShieldedOutputMode;

    if (isFullShielded) {
      // FullShielded: rewind recovers token UID and asset blinding factor
      // asset_commitment is guaranteed for FullShielded outputs (protocol invariant)
      const assetCommitment = Buffer.from(shieldedOutput.asset_commitment!, 'hex');
      const result = await cryptoProvider.rewindFullShieldedOutput(
        privkey,
        ephPk,
        commitment,
        rangeProof,
        assetCommitment
      );
      recoveredValue = result.value;
      recoveredBf = result.blindingFactor;
      recoveredAbf = result.assetBlindingFactor;
      recoveredTokenUid = result.tokenUid;
      mode = ShieldedOutputMode.FULLY_SHIELDED;

      // Verify that the recovered token_uid is consistent with the on-chain asset_commitment.
      const expectedTag = await cryptoProvider.deriveTag(Buffer.from(recoveredTokenUid, 'hex'));
      const expectedAc = await cryptoProvider.createAssetCommitment(
        expectedTag,
        result.assetBlindingFactor
      );
      if (!assetCommitment.equals(expectedAc)) {
        // Drop the output. This branch indicates either a bug in tag/commitment
        // construction (ours or hathor-core's) or forgery: an `asset_commitment`
        // that doesn't match the recovered `tokenUid`. The output is unreadable,
        // which the caller reports at warn level; the recovered tokenUid and the
        // commitments make the failure debuggable from the debug log alone.
        storage.logger.debug(
          `FullShielded token UID cross-check failed for tx ${tx.tx_id} ` +
            `output ${absoluteIndex} — asset commitment mismatch. ` +
            `recovered tokenUid=${recoveredTokenUid}, ` +
            `on-chain assetCommitment=${assetCommitment.toString('hex')}, ` +
            `expected assetCommitment=${expectedAc.toString('hex')}`
        );
        return null;
      }
    } else {
      // AmountShielded: token UID is known from the visible token_data field
      const tokenUid = resolveTokenUid(shieldedOutput.token_data, tx);
      const result = await cryptoProvider.rewindAmountShieldedOutput(
        privkey,
        ephPk,
        commitment,
        rangeProof,
        Buffer.from(tokenUid, 'hex')
      );
      recoveredValue = result.value;
      recoveredBf = result.blindingFactor;
      recoveredTokenUid = tokenUid;
      mode = ShieldedOutputMode.AMOUNT_SHIELDED;
    }

    // Validate recovered value — a corrupted rewind could return garbage.
    // Leave value undefined (do NOT write in place) so the slot stays
    // "not owned" and is excluded by the `value !== undefined` gate.
    if (recoveredValue <= 0n) {
      storage.logger.debug(
        `Shielded output rewind returned non-positive value ${recoveredValue} ` +
          `for tx ${tx.tx_id} output ${absoluteIndex} — skipping`
      );
      return null;
    }

    return {
      txId: tx.tx_id,
      index: absoluteIndex,
      decrypted: {
        value: recoveredValue,
        blindingFactor: recoveredBf,
        tokenUid: recoveredTokenUid,
        assetBlindingFactor: recoveredAbf,
        mode,
      },
      address,
      tokenUid: recoveredTokenUid,
    };
  } catch (e) {
    // Rewind failed — output doesn't belong to us or data is corrupt
    storage.logger.debug(
      'Shielded output rewind failed for tx',
      tx.tx_id,
      'index',
      absoluteIndex,
      e
    );
    return null;
  } finally {
    // Zero the private key buffer to reduce the window for memory-scraping attacks.
    // Not guaranteed by JS GC but a defense-in-depth best practice.
    privkey.fill(0);
  }
}

/**
 * Decode the wallet's own shielded outputs of a transaction (SEPARATED model).
 *
 * The recovered fields are written IN PLACE on `tx.shielded_outputs[s]`:
 * `value`, `token`, `decoded.address`, `blindingFactor`, `mode` and, for
 * FullShielded outputs, `assetBlindingFactor`. `value !== undefined` is the
 * single decoded marker every consumer (balance, credit, sign) gates on. Other
 * slots are left untouched, so the on-chain order is preserved and the
 * arithmetic resolver still lands on the right slot.
 *
 * It first finds the wallet's outputs, which takes no key, and asks
 * `getScanKey` for the scan key only when it found one, so a tx without one
 * never unlocks a key. Without a key or a crypto provider, the wallet's outputs
 * are counted locked. A failure of one output stays with that output. An
 * unexpected error, such as a failed store read, stops the pass and is returned
 * in the outcome's `failure` instead of being thrown.
 *
 * @param storage The wallet storage
 * @param tx The transaction whose shielded outputs are decoded (mutated in place)
 * @param cryptoProvider The provider that rewinds outputs, or null when none is set
 * @param getScanKey Gives the scan key, or null when the wallet has none
 * @returns What happened to each of the wallet's outputs
 */
export async function decodeShieldedOutputs(
  storage: IStorage,
  tx: IHistoryTx,
  cryptoProvider: IShieldedCryptoProvider | null,
  getScanKey: ScanKeyOfPass | null
): Promise<IShieldedDecodeOutcome> {
  const outcome: IShieldedDecodeOutcome = {
    decoded: [],
    locked: [],
    unreadable: [],
    error: [],
    failure: null,
  };
  const transparentCount = tx.outputs.length;

  const candidates: Omit<IOwnedShieldedOutput, 'addressIndex'>[] = [];
  for (const [sIndex, output] of (tx.shielded_outputs ?? []).entries()) {
    // Already decoded on a prior pass — idempotent skip. Gating per SLOT (not
    // per tx) lets a tx whose other owned slot failed a transient rewind be
    // completed on a later attempt, without re-rewinding the ones that worked.
    if (output.value !== undefined) continue;
    // No ECDH hint (the on-chain field was all-zeros, so the fullnode omitted
    // it): the output can never be rewound by this wallet — treat as non-owned.
    // Checked first: it needs no storage access or key material.
    if (!output.ephemeral_pubkey) continue;
    // No decoded address: the fullnode accepts ANY script on a shielded output
    // (consensus validates only the crypto material plus a script size cap) and
    // fills `decoded.address` only when the script parses as a standard type.
    // An output owned by this wallet always carries its spend P2PKH script, so
    // a slot without a decoded address cannot be ours — skip it.
    const address = output.decoded?.address;
    if (!address) continue;
    candidates.push({ output, address, absoluteIndex: transparentCount + sIndex });
  }
  if (candidates.length === 0) {
    return outcome;
  }

  // The candidates that could still be the wallet's and are not decoded yet.
  // When the pass stops, they are its outputs in error.
  const pending = new Set(candidates.map(candidate => candidate.absoluteIndex));
  try {
    const owned: IOwnedShieldedOutput[] = [];
    for (const candidate of candidates) {
      if (await storage.isAddressMine(candidate.address)) {
        // The address is in storage; its info gives the derivation index.
        const addressInfo = await storage.getAddressInfo(candidate.address);
        owned.push({ ...candidate, addressIndex: addressInfo?.bip32AddressIndex ?? null });
      } else {
        pending.delete(candidate.absoluteIndex);
      }
    }
    if (owned.length === 0) {
      return outcome;
    }

    const scanKey = cryptoProvider && getScanKey ? await getScanKey() : null;
    if (!cryptoProvider || !scanKey) {
      outcome.locked = owned.map(slot => slot.absoluteIndex);
      return outcome;
    }

    const recovered: Array<{ slot: IOwnedShieldedOutput; decoded: IProcessedShieldedOutput }> = [];
    for (const slot of owned) {
      const decoded = await decodeOwnedOutput(storage, tx, cryptoProvider, scanKey, slot);
      if (decoded) {
        recovered.push({ slot, decoded });
      } else {
        outcome.unreadable.push(slot.absoluteIndex);
      }
      pending.delete(slot.absoluteIndex);
    }
    for (const { slot, decoded } of recovered) {
      writeDecodedOutput(slot.output, decoded);
      outcome.decoded.push(decoded);
    }
  } catch (e) {
    outcome.error = [...pending];
    outcome.failure = { cause: e };
  }
  return outcome;
}

/**
 * Process the shielded outputs of a transaction (SEPARATED model).
 *
 * Decodes the wallet's own shielded outputs with the scan key `pinCode`
 * decrypts, writing the recovered fields IN PLACE on `tx.shielded_outputs`, as
 * {@link decodeShieldedOutputs} does. It does not use the scan key the wallet
 * keeps in memory: the key is decrypted with the PIN for this call, only once it
 * found an output of the wallet.
 *
 * The returned report lists the slots that were decoded (absolute on-chain
 * index `tx.outputs.length + s`), for callers that want the result without
 * re-scanning the array. The authoritative state lives on
 * `tx.shielded_outputs[]`. Outputs that do not open are logged in one line at
 * warn level, with the detail of each at debug level.
 *
 * @param storage - The wallet storage instance
 * @param tx - The transaction whose shielded outputs are processed (mutated in place)
 * @param cryptoProvider - The shielded crypto provider to use for decryption
 * @param pinCode - PIN code to unlock wallet keys for decryption
 * @returns Report of successfully decoded outputs belonging to this wallet
 * @throws {ShieldedKeyError} `shielded-wrong-pin` when the PIN does not decrypt
 *   the scan key, `shielded-corrupt-key` when the record cannot be decrypted or
 *   holds no extended private key. Any other failure to read the key or the
 *   store is thrown as it is.
 */
export async function processShieldedOutputs(
  storage: IStorage,
  tx: IHistoryTx,
  cryptoProvider: IShieldedCryptoProvider,
  pinCode: string
): Promise<IProcessedShieldedOutput[]> {
  const outcome = await decodeShieldedOutputs(storage, tx, cryptoProvider, async () =>
    parseScanXPrivKey(await decryptScanXPrivKey(storage, pinCode))
  );
  if (outcome.failure) {
    throw outcome.failure.cause;
  }
  logUndecodedOutputs(storage.logger, `tx ${tx.tx_id}`, undecodedCountsOf(outcome));
  return outcome.decoded;
}
