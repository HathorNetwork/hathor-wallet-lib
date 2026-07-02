/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { IStorage, IHistoryTx, ILogger } from '../types';
import { NATIVE_TOKEN_UID, NATIVE_TOKEN_UID_HEX, PRIVATE_KEY_SIZE_BYTES } from '../constants';
import tokenUtils from '../utils/tokens';
import { IShieldedCryptoProvider, IProcessedShieldedOutput, ShieldedOutputMode } from './types';

/**
 * Resolve the 32-byte hex token UID (NATIVE_TOKEN_UID_HEX for HTR) from an
 * output's `token_data` and the tx's token list. Generic over any output — the
 * same `token_data` → token-index convention transparent I/O uses (see
 * transaction.ts `hydrateIOWithToken`).
 *
 * The caller must not call this for FullShielded outputs, whose token is hidden
 * behind `asset_commitment` and only recovered by rewind (processShieldedOutputs
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
 * HDPrivateKey. The parent xpriv is unlocked once per tx by the caller; only the
 * cheap per-address child derivation runs here.
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
    // deriveNonCompliantChild is required for private keys due to a historical
    // bitcore-lib serialization bug. Public key derivation (in shieldedAddress.ts)
    // uses standard deriveChild because it was always correct. Do not align these.
    const childKey = scanHdPrivKey.deriveNonCompliantChild(addressIndex);
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
 * Process the shielded outputs of a transaction (SEPARATED model).
 *
 * For each entry in `tx.shielded_outputs[]`, attempt to detect ownership and
 * decrypt it with the wallet's per-address scan key. When an output is owned,
 * the recovered fields are written **IN PLACE** onto the corresponding
 * `tx.shielded_outputs[s]` entry — `value`, `token`, `decoded.address`,
 * `blindingFactor` and (FullShielded only) `assetBlindingFactor`. The single
 * ownership/decoded marker is the top-level `value !== undefined`; every
 * downstream consumer (balance, credit, sign) gates off that.
 *
 * Non-owned slots and 0-value rewinds are left untouched (value stays
 * `undefined`), so the full on-chain-ordered list is preserved and the
 * arithmetic resolver still lands on the right slot.
 *
 * The function also returns an `IProcessedShieldedOutput[]` report of the slots
 * that were decoded (absolute on-chain index `tx.outputs.length + s`), useful
 * for callers/tests that want to inspect the result without re-scanning the
 * array. The authoritative state, however, lives on `tx.shielded_outputs[]`.
 *
 * @param storage - The wallet storage instance
 * @param tx - The transaction whose shielded outputs are processed (mutated in place)
 * @param cryptoProvider - The shielded crypto provider to use for decryption
 * @param pinCode - PIN code to unlock wallet keys for decryption
 * @returns Report of successfully decoded outputs belonging to this wallet
 */
export async function processShieldedOutputs(
  storage: IStorage,
  tx: IHistoryTx,
  cryptoProvider: IShieldedCryptoProvider,
  pinCode: string
): Promise<IProcessedShieldedOutput[]> {
  const shieldedOutputs = tx.shielded_outputs ?? [];
  if (shieldedOutputs.length === 0) return [];

  const results: IProcessedShieldedOutput[] = [];
  const transparentCount = tx.outputs.length;

  // Unlock the scan xpriv + build the HDPrivateKey ONCE per tx (lazily, on the
  // first owned shielded output). The PBKDF2 unlock + HD construction are the
  // expensive part; only the cheap per-address child derivation runs per output.
  // Every wallet reloads its history from block 0, so this hot path walks every
  // shielded tx on first sync.
  let scanHdPrivKey: HDPrivateKey | undefined;

  for (const [sIndex, shieldedOutput] of shieldedOutputs.entries()) {
    const absoluteIndex = transparentCount + sIndex;
    const address = shieldedOutput.decoded?.address;
    // No decoded address means a data output or a non-canonical/non-P2PKH script,
    // which can't be an owned shielded output — skip it. Shielded outputs are
    // expected to carry a spend P2PKH address (the fullnode is believed to reject
    // non-P2PKH shielded scripts — to confirm with core), so this is defensive.
    if (!address) continue;

    // Check if this address belongs to our wallet
    if (!(await storage.isAddressMine(address))) continue;

    if (!scanHdPrivKey) {
      // Unlock the scan xpriv once per tx. A failure here (wrong PIN, or a
      // missing/corrupted scan key) is systemic — it would fail for every owned
      // shielded output — so let it propagate and fail loud rather than silently
      // under-counting the wallet's shielded balance.
      scanHdPrivKey = new HDPrivateKey(await storage.getScanXPrivKey(pinCode));
    }
    // Derive this address's scan private key (ECDH) from the cached HD key.
    // isAddressMine above guarantees the address is in storage, so getAddressInfo
    // is non-null; we fetch it here only for the bip32 derivation index.
    const addressInfo = await storage.getAddressInfo(address);
    const privkey = deriveScanChildPrivkey(
      scanHdPrivKey,
      addressInfo!.bip32AddressIndex,
      storage.logger
    );
    // Defensive: deriveScanChildPrivkey only returns undefined if bitcore's child
    // derivation throws (it logs a warning inside), which shouldn't happen for a
    // valid owned address at a valid index — skip rather than crash the sync.
    if (!privkey) continue;

    const ephPk = Buffer.from(shieldedOutput.ephemeral_pubkey, 'hex');
    const commitment = Buffer.from(shieldedOutput.commitment, 'hex');
    const rangeProof = Buffer.from(shieldedOutput.range_proof, 'hex');
    // The fullnode always sets `mode`, so classify directly from it.
    const isFullShielded = shieldedOutput.mode === ShieldedOutputMode.FULLY_SHIELDED;

    try {
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
          // Drop the output AND log loudly: this branch indicates either a bug
          // in tag/commitment construction (ours or hathor-core's) or active
          // forgery — someone constructing an `asset_commitment` that doesn't
          // match the recovered `tokenUid`. Either way, an operator needs to
          // see this, so route to `error` and include the recovered tokenUid +
          // on-chain assetCommitment hex so the failure is debuggable from
          // logs alone.
          storage.logger.error(
            `FullShielded token UID cross-check failed for tx ${tx.tx_id} ` +
              `output ${absoluteIndex} — asset commitment mismatch. ` +
              `recovered tokenUid=${recoveredTokenUid}, ` +
              `on-chain assetCommitment=${assetCommitment.toString('hex')}, ` +
              `expected assetCommitment=${expectedAc.toString('hex')}`
          );
          continue;
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
        storage.logger.warn(
          `Shielded output rewind returned non-positive value ${recoveredValue} ` +
            `for tx ${tx.tx_id} output ${absoluteIndex} — skipping`
        );
        continue;
      }

      const walletTokenUid =
        recoveredTokenUid === NATIVE_TOKEN_UID_HEX ? NATIVE_TOKEN_UID : recoveredTokenUid;

      // Write the decoded data IN PLACE onto the on-chain-ordered shielded
      // output entry. `value !== undefined` is now the single ownership gate;
      // downstream loops (creditOutput, getTxBalance) read straight off these
      // fields. The `decoded.address` was already present on the wire entry —
      // we keep it but do NOT rely on it for ownership.
      shieldedOutput.value = recoveredValue;
      shieldedOutput.token = walletTokenUid;
      shieldedOutput.blindingFactor = recoveredBf.toString('hex');
      shieldedOutput.assetBlindingFactor = recoveredAbf?.toString('hex');
      shieldedOutput.decoded = { ...shieldedOutput.decoded, address };
      shieldedOutput.mode = mode;

      results.push({
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
      });
    } catch (e) {
      // Rewind failed — output doesn't belong to us or data is corrupt
      storage.logger.debug(
        'Shielded output rewind failed for tx',
        tx.tx_id,
        'index',
        absoluteIndex,
        e
      );
      continue;
    } finally {
      // Zero the private key buffer to reduce the window for memory-scraping attacks.
      // Not guaranteed by JS GC but a defense-in-depth best practice.
      privkey.fill(0);
    }
  }

  return results;
}
