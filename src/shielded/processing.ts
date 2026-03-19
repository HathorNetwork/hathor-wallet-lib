/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage, IHistoryTx } from '../types';
import { NATIVE_TOKEN_UID } from '../constants';
import {
  IShieldedCryptoProvider,
  IShieldedOutput,
  IProcessedShieldedOutput,
} from './types';

/**
 * Resolve the token UID for a shielded output.
 *
 * For AmountShielded outputs, the token is determined by token_data
 * referencing the tx.tokens array (0 = native token, 1+ = custom tokens).
 * For FullShielded outputs, the token is unknown until decrypted.
 */
function resolveTokenUid(shieldedOutput: IShieldedOutput, tx: IHistoryTx): string {
  // token_data uses the same convention as transparent outputs:
  // The lower bits indicate the token index (0 = HTR, 1+ = index into tx.tokens)
  const tokenIndex = shieldedOutput.token_data & 0b01111111;
  if (tokenIndex === 0) {
    // Native token (HTR) — use 32 zero bytes
    return '00'.repeat(32);
  }
  if (tx.tokens && tokenIndex <= tx.tokens.length) {
    return tx.tokens[tokenIndex - 1];
  }
  // Fallback: use zero bytes (will fail decryption if wrong)
  return '00'.repeat(32);
}

/**
 * Derive the private key for an address.
 *
 * Requires the wallet to be unlocked (pin code available / key material in memory).
 * Returns the raw 32-byte private key for ECDH, or null if not derivable.
 */
async function derivePrivkeyForAddress(
  storage: IStorage,
  addressIndex: number,
  pinCode: string,
): Promise<Buffer | null> {
  try {
    const { HDPrivateKey } = require('bitcore-lib');
    const acctPathXPriv = await storage.getAcctPathXPrivKey(pinCode);
    const hdPrivKey = new HDPrivateKey(acctPathXPriv);
    const childKey = hdPrivKey.deriveChild(addressIndex);
    // bitcore-lib stores the private key as a BN; convert to 32-byte Buffer
    return childKey.privateKey.toBuffer({ size: 32 });
  } catch {
    return null;
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
  pinCode: string,
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

    // Derive the private key for this address
    const privkey = await derivePrivkeyForAddress(
      storage,
      addressInfo.bip32AddressIndex,
      pinCode,
    );
    if (!privkey) continue;

    // Determine token_uid for the decryption
    const tokenUid = resolveTokenUid(shieldedOutput, tx);

    try {
      const decrypted = cryptoProvider.decryptShieldedOutput(
        privkey,
        Buffer.from(shieldedOutput.ephemeral_pubkey, 'hex'),
        Buffer.from(shieldedOutput.commitment, 'hex'),
        Buffer.from(shieldedOutput.range_proof, 'hex'),
        Buffer.from(tokenUid, 'hex'),
        shieldedOutput.asset_commitment
          ? Buffer.from(shieldedOutput.asset_commitment, 'hex')
          : null,
      );

      results.push({
        txId: tx.tx_id,
        index: transparentCount + idx,
        decrypted,
        address,
        tokenUid: decrypted.tokenUid,
      });
    } catch {
      // Decryption failed — output doesn't belong to us or data is corrupt
      continue;
    }
  }

  return results;
}
