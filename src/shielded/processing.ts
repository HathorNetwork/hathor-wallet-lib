/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { IStorage, IHistoryTx, ILogger } from '../types';
import { NATIVE_TOKEN_UID, NATIVE_TOKEN_UID_HEX } from '../constants';
import tokenUtils from '../utils/tokens';
import {
  IShieldedCryptoProvider,
  IShieldedOutput,
  IProcessedShieldedOutput,
  ShieldedOutputMode,
} from './types';

/**
 * Resolve the token UID for a shielded output.
 *
 * Uses the same token_data convention as transparent outputs (via getTokenIndexFromData).
 * Returns the 32-byte hex UID needed by the crypto layer (NATIVE_TOKEN_UID_HEX for HTR).
 * For FullShielded outputs, the token is unknown until decrypted.
 */
export function resolveTokenUid(shieldedOutput: IShieldedOutput, tx: IHistoryTx): string {
  const tokenIndex = tokenUtils.getTokenIndexFromData(shieldedOutput.token_data);
  if (tokenIndex === 0) {
    return NATIVE_TOKEN_UID_HEX;
  }
  if (tx.tokens && tokenIndex <= tx.tokens.length) {
    const uid = tx.tokens[tokenIndex - 1];
    // Custom token UIDs are already 32-byte hex
    return uid === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : uid;
  }
  return NATIVE_TOKEN_UID_HEX;
}

/**
 * Derive the scan private key for an address.
 *
 * The scan key uses a separate account (m/44'/280'/1'/0) from legacy P2PKH (account 0').
 * Returns the raw 32-byte private key for ECDH, or undefined if not derivable.
 */
async function deriveScanPrivkeyForAddress(
  storage: IStorage,
  addressIndex: number,
  pinCode: string,
  logger: ILogger
): Promise<Buffer | undefined> {
  try {
    const xprivStr = await storage.getScanXPrivKey(pinCode);
    const hdPrivKey = new HDPrivateKey(xprivStr);
    const childKey = hdPrivKey.deriveNonCompliantChild(addressIndex);
    // The native crypto provider (ECDH) needs raw 32-byte private key bytes.
    // Other wallet-lib code passes bitcore PrivateKey objects directly to bitcore
    // signing functions, but here we cross into the native ct-crypto boundary.
    // { size: 32 } ensures zero-padding for keys with leading zeros.
    return childKey.privateKey.toBuffer({ size: 32 });
  } catch (e) {
    logger.warn('Failed to derive scan private key for shielded output at index', addressIndex, e);
    return undefined;
  }
}

/**
 * Process shielded outputs from a transaction.
 * Attempts to decrypt each shielded output using wallet keys.
 * Returns decrypted outputs that belong to this wallet.
 *
 * @param storage - The wallet storage instance
 * @param tx - The transaction containing shielded outputs
 * @param cryptoProvider - The shielded crypto provider to use for decryption
 * @param pinCode - PIN code to unlock wallet keys for decryption
 * @returns Array of successfully decrypted outputs belonging to this wallet
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

  for (const [idx, shieldedOutput] of shieldedOutputs.entries()) {
    const address = shieldedOutput.decoded?.address;
    if (!address) continue;

    // Check if this address belongs to our wallet
    const addressInfo = await storage.getAddressInfo(address);
    if (!addressInfo) continue;

    // Derive the scan private key for this address (ECDH)
    const privkey = await deriveScanPrivkeyForAddress(
      storage,
      addressInfo.bip32AddressIndex,
      pinCode,
      storage.logger
    );
    if (!privkey) continue;

    const ephPk = Buffer.from(shieldedOutput.ephemeral_pubkey, 'hex');
    const commitment = Buffer.from(shieldedOutput.commitment, 'hex');
    const rangeProof = Buffer.from(shieldedOutput.range_proof, 'hex');
    const isFullShielded = shieldedOutput.mode === ShieldedOutputMode.FULLY_SHIELDED;

    try {
      let recoveredValue: bigint;
      let recoveredBf: Buffer;
      let recoveredTokenUid: string;
      let recoveredAbf: Buffer | undefined;
      let outputType: ShieldedOutputMode;

      if (isFullShielded) {
        // FullShielded: rewind recovers token UID and asset blinding factor
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
        recoveredTokenUid = result.tokenUid.toString('hex');
        outputType = ShieldedOutputMode.FULLY_SHIELDED;

        // Cross-check token UID (Section 4.3 of the client guide):
        // https://github.com/HathorNetwork/hathor-core/blob/feat/ct-amount-token-privacy/hathor-ct-crypto/SHIELDED-OUTPUTS-CLIENT-GUIDE.md
        // Verify that the recovered token_uid is consistent with the on-chain asset_commitment.
        const expectedTag = await cryptoProvider.deriveTag(result.tokenUid);
        const expectedAc = await cryptoProvider.createAssetCommitment(
          expectedTag,
          result.assetBlindingFactor
        );
        if (!assetCommitment.equals(expectedAc)) {
          storage.logger.warn(
            'FullShielded token UID cross-check failed — asset commitment mismatch'
          );
          continue;
        }
      } else {
        // AmountShielded: token UID is known from the visible token_data field
        const tokenUid = resolveTokenUid(shieldedOutput, tx);
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
        outputType = ShieldedOutputMode.AMOUNT_SHIELDED;
      }

      results.push({
        txId: tx.tx_id,
        index: transparentCount + idx,
        decrypted: {
          value: recoveredValue,
          blindingFactor: recoveredBf,
          tokenUid: recoveredTokenUid,
          assetBlindingFactor: recoveredAbf,
          outputType,
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
        transparentCount + idx,
        e
      );
      continue;
    }
  }

  return results;
}
