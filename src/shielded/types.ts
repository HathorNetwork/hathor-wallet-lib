/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ShieldedOutputMode } from '@hathor/ct-crypto-provider';
import type { OutputValueType } from '../types';

// ─── crypto-provider contract — re-exported from @hathor/ct-crypto-provider ─
//
// The shielded crypto provider interface, abstract class, and result
// shapes are owned by `@hathor/ct-crypto-provider`. Re-exporting them
// here keeps wallet-lib's internal import paths short (`./types` instead
// of the full package path) without making wallet-lib the owner of the
// contract.
export { ShieldedOutputMode };
export type {
  IShieldedCryptoProvider,
  ICreatedShieldedOutput,
  IRewoundAmountShieldedOutput,
  IRewoundFullShieldedOutput,
  IBlindingEntry,
  ISurjectionDomainEntry,
  IOpenedFullShieldedCommitment,
} from '@hathor/ct-crypto-provider';

// ─── wallet-lib-domain shielded types ──────────────────────────────────────

/**
 * A shielded output as received from the full node API.
 * This is the on-chain data before decryption.
 */
/**
 * The on-chain confidential fields of a shielded output: the Pedersen value
 * commitment, its range proof, the ECDH ephemeral pubkey, and (FullShielded
 * only) the asset commitment + surjection proof. Defined once and shared by
 * every shielded-output representation — the wire `IShieldedOutput` here and
 * the history/storage `IHistoryShieldedOutput` in tx.shielded_outputs[]
 * (src/types.ts) — so the field set can't drift between them.
 */
export interface IShieldedOutputProofs {
  commitment: string; // hex, 33 bytes
  range_proof: string; // hex, variable (~675 bytes)
  ephemeral_pubkey: string; // hex, 33 bytes
  // FullShielded only:
  asset_commitment?: string; // hex, 33 bytes
  surjection_proof?: string; // hex, variable
}

export interface IShieldedOutput extends IShieldedOutputProofs {
  // Optional because hathor-core nodes pre-`_shielded_output_to_json`
  // mode-field addition still send shielded outputs without `mode`.
  // Readers must fall back to detecting FullShielded via the presence
  // of `asset_commitment` (the same pattern already used in the
  // explorer's `TxData.isFullShielded`).
  mode?: ShieldedOutputMode;
  script: string; // hex, output script (P2PKH/P2SH)
  // FullShielded outputs may omit `token_data` (the token UID is hidden
  // behind `asset_commitment`, so the field has no meaningful value).
  token_data?: number; // token index (AmountShielded only)
  decoded: IShieldedOutputDecoded;
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
  mode: ShieldedOutputMode;
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

// ─── createShieldedOutputs I/O ─────────────────────────────────────────────

/**
 * Caller-supplied description of one shielded output to be built by
 * `createShieldedOutputs()`. The function takes an array of these and
 * returns an `IDataShieldedOutput[]` with the cryptographic fields
 * populated.
 */
export interface ShieldedOutputProposal {
  address: string;
  value: bigint;
  token: string;
  scanPubkey: string;
  shieldedMode: ShieldedOutputMode;
  timelock?: number;
}

/**
 * Per-input generator info for surjection proof domain construction.
 * For transparent/AmountShielded inputs, only `tokenUid` is needed (unblinded
 * generator). For FullShielded inputs, the `assetBlindingFactor` is required
 * to reconstruct the blinded generator (asset_commitment) that the fullnode
 * uses for verification.
 */
export interface InputGeneratorInfo {
  tokenUid: string;
  assetBlindingFactor?: Buffer; // present only for FullShielded inputs
}

/**
 * Fields populated for every shielded output (both modes) by
 * `createShieldedOutputs()`. The non-crypto prefix mirrors what
 * `ShieldedOutputProposal` carries in; everything else is filled in by the
 * crypto provider in a single pass.
 */
interface IDataShieldedOutputBase {
  address: string;
  value: OutputValueType;
  token: string;
  scanPubkey: string; // hex, 33 bytes compressed EC pubkey for ECDH
  ephemeralPubkey: Buffer;
  commitment: Buffer;
  rangeProof: Buffer;
  blindingFactor: Buffer;
  script: string; // hex, the P2PKH/P2SH output script
}

/**
 * AmountShielded output — value is hidden but the token UID is in the clear
 * (encoded as the output's token index). No asset commitment or surjection
 * proof.
 */
export interface IDataAmountShieldedOutput extends IDataShieldedOutputBase {
  shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED;
}

/**
 * FullShielded output — both value and token UID are hidden behind a
 * Pedersen-style asset commitment, plus a surjection proof tying the output
 * back to one of the inputs' tokens.
 */
export interface IDataFullShieldedOutput extends IDataShieldedOutputBase {
  shieldedMode: ShieldedOutputMode.FULLY_SHIELDED;
  assetCommitment: Buffer;
  assetBlindingFactor: Buffer;
  surjectionProof: Buffer;
}

/**
 * Intermediary representation of a shielded output during transaction
 * building — return shape of `createShieldedOutputs()`. Discriminated on
 * `shieldedMode`: consumers that need the FullShielded-only fields narrow
 * with `if (out.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED)`.
 */
export type IDataShieldedOutput = IDataAmountShieldedOutput | IDataFullShieldedOutput;

/**
 * Result of deriving a shielded address at a BIP32 index from the scan and
 * spend xpubs — return shape of `utils/shieldedAddress.deriveShieldedAddress()`.
 */
export interface IShieldedAddressInfo {
  /** Full shielded address in base58 */
  base58: string;
  /** BIP32 index used to derive both scan and spend keys */
  bip32AddressIndex: number;
  /** 33-byte compressed scan pubkey (hex) */
  scanPubkey: string;
  /** 33-byte compressed spend pubkey (hex) */
  spendPubkey: string;
  /** P2PKH address derived from HASH160(spend_pubkey) — the on-chain address */
  spendAddress: string;
}

/**
 * Structural parts of a decoded 71-byte shielded address — return shape of
 * `Address.parseShielded()`: version(1) | scan(33) | spend(33) | checksum(4).
 */
export interface IShieldedAddressParts {
  /** Network version byte (first byte) */
  versionByte: number;
  /** 33-byte compressed scan pubkey (ECDH detection) */
  scanPubkey: Buffer;
  /** 33-byte compressed spend pubkey (signing authority) */
  spendPubkey: Buffer;
  /** 4-byte checksum over the first 67 bytes */
  checksum: Buffer;
}
