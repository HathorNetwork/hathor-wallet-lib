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
  // Optional because hathor-core nodes pre-`_shielded_output_to_json`
  // mode-field addition still send shielded outputs without `mode`.
  // Readers must fall back to detecting FullShielded via the presence
  // of `asset_commitment` (the same pattern already used in the
  // explorer's `TxData.isFullShielded`).
  mode?: ShieldedOutputMode;
  commitment: string; // hex, 33 bytes
  range_proof: string; // hex, variable (~675 bytes)
  script: string; // hex, output script (P2PKH/P2SH)
  // FullShielded outputs may omit `token_data` (the token UID is hidden
  // behind `asset_commitment`, so the field has no meaningful value).
  token_data?: number; // token index (AmountShielded only)
  ephemeral_pubkey: string; // hex, 33 bytes
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
  tokenUid: string; // hex, 32 bytes
  assetBlindingFactor?: Buffer;
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
  assetCommitment?: Buffer;
  assetBlindingFactor?: Buffer;
  surjectionProof?: Buffer;
}

/**
 * Swappable crypto provider interface.
 * Function names follow the SHIELDED-OUTPUTS-CLIENT-GUIDE.md specification.
 *
 * Implementations:
 * - Node.js: @hathor/ct-crypto-node (napi-rs, default)
 * - iOS: Swift wrapper via UniFFI
 * - Android: Kotlin wrapper via UniFFI
 */
export interface IShieldedCryptoProvider {
  /**
   * Generate a random 32-byte blinding factor (valid secp256k1 scalar).
   * MUST use the Rust crypto RNG — never use JS crypto.randomBytes.
   */
  generateRandomBlindingFactor(): Buffer | Promise<Buffer>;

  /**
   * Create an AmountShielded output (amount hidden, token visible).
   * Caller provides the value blinding factor (from generateRandomBlindingFactor
   * or computeBalancingBlindingFactor).
   */
  createAmountShieldedOutput(
    value: bigint,
    recipientPubkey: Buffer,
    tokenUid: Buffer,
    valueBlindingFactor: Buffer
  ): ICreatedShieldedOutput | Promise<ICreatedShieldedOutput>;

  /**
   * Create a FullShielded output (amount AND token hidden).
   * Caller provides both the value and asset blinding factors.
   */
  createShieldedOutputWithBothBlindings(
    value: bigint,
    recipientPubkey: Buffer,
    tokenUid: Buffer,
    valueBlindingFactor: Buffer,
    assetBlindingFactor: Buffer
  ): ICreatedShieldedOutput | Promise<ICreatedShieldedOutput>;

  /**
   * Rewind an AmountShielded output to recover value and blinding factor.
   * The token UID is known from the visible token_data field.
   */
  rewindAmountShieldedOutput(
    privateKey: Buffer,
    ephemeralPubkey: Buffer,
    commitment: Buffer,
    rangeProof: Buffer,
    tokenUid: Buffer
  ): IRewoundAmountShieldedOutput | Promise<IRewoundAmountShieldedOutput>;

  /**
   * Rewind a FullShielded output to recover value, blinding factor, token UID,
   * and asset blinding factor. Does NOT take tokenUid — it's recovered from the proof message.
   */
  rewindFullShieldedOutput(
    privateKey: Buffer,
    ephemeralPubkey: Buffer,
    commitment: Buffer,
    rangeProof: Buffer,
    assetCommitment: Buffer
  ): IRewoundFullShieldedOutput | Promise<IRewoundFullShieldedOutput>;

  /**
   * Compute the balancing blinding factor for the last shielded output.
   * Uses secp256k1-zkp's compute_adaptive_blinding_factor.
   *
   * @param value - The value of the last output
   * @param generatorBlindingFactor - Generator bf for the last output (zero for AmountShielded)
   * @param inputs - Array of {value, vbf, gbf} for all inputs
   * @param otherOutputs - Array of {value, vbf, gbf} for all other outputs (not the last)
   */
  computeBalancingBlindingFactor(
    value: bigint,
    generatorBlindingFactor: Buffer,
    inputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }>,
    otherOutputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }>
  ): Buffer | Promise<Buffer>;

  /**
   * Derive a raw Tag from a token UID (for surjection proofs and cross-checks).
   */
  deriveTag(tokenUid: Buffer): Buffer | Promise<Buffer>;

  /**
   * Derive a blinded asset generator from a raw tag and blinding factor.
   */
  createAssetCommitment(tag: Buffer, blindingFactor: Buffer): Buffer | Promise<Buffer>;

  /**
   * Create a surjection proof proving the output asset derives from one of the input assets.
   */
  createSurjectionProof(
    codomainTag: Buffer,
    codomainBlindingFactor: Buffer,
    domain: Array<{ generator: Buffer; tag: Buffer; blindingFactor: Buffer }>
  ): Buffer | Promise<Buffer>;

  /**
   * ECDH shared secret derivation (for scanning optimization).
   */
  deriveEcdhSharedSecret(privkey: Buffer, pubkey: Buffer): Buffer | Promise<Buffer>;

  /**
   * Recompute the AmountShielded value commitment from the cleartext
   * `value`, `vbf`, and the (public) `tokenUid`. Equivalent to
   * `createCommitment(value, vbf, deriveAssetTag(tokenUid))`. Used by
   * verifier-only consumers (e.g. the explorer's "view tx unblinded"
   * path) to confirm a shared opening matches the on-chain commitment
   * without needing a range proof or ephemeral key.
   *
   * Returns the 33-byte serialized Pedersen commitment.
   */
  openAmountShieldedCommitment(
    value: bigint,
    vbf: Buffer,
    tokenUid: Buffer
  ): Buffer | Promise<Buffer>;

  /**
   * Recompute both the value and asset commitments for a FullShielded
   * output from cleartext `value`, `vbf`, `tokenUid` and `abf`.
   * Equivalent to:
   *   tag = deriveTag(tokenUid)
   *   assetCommitment = createAssetCommitment(tag, abf)
   *   valueCommitment = createCommitment(value, vbf, assetCommitment)
   *
   * Returns both 33-byte serialized commitments. Verifier compares
   * each to the on-chain bytes.
   */
  openFullShieldedCommitment(
    value: bigint,
    vbf: Buffer,
    tokenUid: Buffer,
    abf: Buffer
  ):
    | { valueCommitment: Buffer; assetCommitment: Buffer }
    | Promise<{ valueCommitment: Buffer; assetCommitment: Buffer }>;
}

/**
 * Result of rewinding an AmountShielded output.
 */
export interface IRewoundAmountShieldedOutput {
  value: bigint;
  blindingFactor: Buffer;
}

/**
 * Result of rewinding a FullShielded output.
 */
export interface IRewoundFullShieldedOutput {
  value: bigint;
  blindingFactor: Buffer;
  tokenUid: Buffer; // 32 bytes, recovered from proof message
  assetBlindingFactor: Buffer; // 32 bytes, recovered from proof message
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
