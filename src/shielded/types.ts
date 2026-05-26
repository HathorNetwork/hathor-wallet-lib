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

/**
 * Intermediary representation of a shielded output during transaction
 * building — used as the return shape of `createShieldedOutputs()`.
 *
 * The non-optional prefix is the pre-crypto definition (mirrors what
 * `ShieldedOutputProposal` carries in). Everything after `shieldedMode` is
 * populated by the crypto provider in a single pass; the fields are
 * marked optional only because `assetCommitment`/`assetBlindingFactor`/
 * `surjectionProof` are FullShielded-only — for AmountShielded outputs
 * they remain undefined.
 */
export interface IDataShieldedOutput {
  address: string;
  value: OutputValueType;
  token: string;
  scanPubkey: string; // hex, 33 bytes compressed EC pubkey for ECDH
  shieldedMode: ShieldedOutputMode; // matches ShieldedOutputProposal.shieldedMode
  // Populated after crypto processing:
  ephemeralPubkey?: Buffer;
  commitment?: Buffer;
  rangeProof?: Buffer;
  blindingFactor?: Buffer;
  assetCommitment?: Buffer;
  assetBlindingFactor?: Buffer;
  surjectionProof?: Buffer;
  script?: string; // hex, the P2PKH/P2SH output script
}
