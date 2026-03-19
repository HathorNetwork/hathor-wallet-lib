/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shielded output modes matching the Hathor protocol.
 */
export enum ShieldedOutputMode {
  AMOUNT_SHIELDED = 1,
  FULLY_SHIELDED = 2,
}

/**
 * A shielded output as received from the full node API.
 * This is the on-chain data before decryption.
 */
export interface IShieldedOutput {
  mode: ShieldedOutputMode;
  commitment: string;        // hex, 33 bytes
  range_proof: string;       // hex, variable (~675 bytes)
  script: string;            // hex, output script (P2PKH/P2SH)
  token_data: number;        // token index (AmountShielded only)
  ephemeral_pubkey: string;  // hex, 33 bytes
  decoded: IShieldedOutputDecoded;
  // FullShielded only:
  asset_commitment?: string; // hex, 33 bytes
  surjection_proof?: string; // hex, variable
}

export interface IShieldedOutputDecoded {
  type?: string;
  address?: string;
  timelock?: number | null;
}

/**
 * The result of successfully decrypting a shielded output.
 */
export interface IDecryptedShieldedOutput {
  value: bigint;
  blindingFactor: Buffer;
  tokenUid: string;           // hex, 32 bytes
  assetBlindingFactor: Buffer | null;
  outputType: ShieldedOutputMode;
}

/**
 * Result of creating a shielded output via the crypto provider.
 */
export interface ICreatedShieldedOutput {
  ephemeralPubkey: Buffer;
  commitment: Buffer;
  rangeProof: Buffer;
  blindingFactor: Buffer;
  assetCommitment: Buffer | null;
  assetBlindingFactor: Buffer | null;
}

/**
 * Swappable crypto provider interface.
 *
 * Implementations:
 * - Node.js: @hathor/ct-crypto-node (napi-rs, default)
 * - iOS: Swift wrapper via UniFFI
 * - Android: Kotlin wrapper via UniFFI
 */
export interface IShieldedCryptoProvider {
  /**
   * Full decrypt pipeline: ECDH -> nonce -> generator -> rewind -> verify.
   */
  decryptShieldedOutput(
    recipientPrivkey: Buffer,
    ephemeralPubkey: Buffer,
    commitment: Buffer,
    rangeProof: Buffer,
    tokenUid: Buffer,
    assetCommitment: Buffer | null,
  ): IDecryptedShieldedOutput;

  /**
   * ECDH shared secret derivation (for scanning optimization).
   */
  deriveEcdhSharedSecret(privkey: Buffer, pubkey: Buffer): Buffer;

  /**
   * Create a shielded output for a recipient.
   *
   * Encapsulates the full creation pipeline:
   * ephemeral key generation, ECDH, nonce derivation, generator/asset commitment,
   * range proof creation. The ephemeral private key never leaves the crypto layer.
   *
   * @param value - The output value
   * @param recipientPubkey - 33 bytes compressed EC public key of the recipient
   * @param tokenUid - 32 bytes token UID (all zeros for HTR)
   * @param fullyShielded - true for FullShielded (hides token), false for AmountShielded
   */
  createShieldedOutput(
    value: bigint,
    recipientPubkey: Buffer,
    tokenUid: Buffer,
    fullyShielded: boolean,
  ): ICreatedShieldedOutput;
}

/**
 * Result of processing shielded outputs for a single transaction.
 */
export interface IProcessedShieldedOutput {
  txId: string;
  index: number;
  decrypted: IDecryptedShieldedOutput;
  address: string;
  tokenUid: string;
}
