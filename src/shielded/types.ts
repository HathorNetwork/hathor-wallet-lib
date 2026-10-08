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

/** Whether an output, or the UTXO it becomes, is transparent or shielded. */
export enum OutputKind {
  TRANSPARENT = 'transparent',
  SHIELDED = 'shielded',
}

/**
 * The mode of a change output. Extends the crypto-provider's shielded modes
 * with `OutputKind.TRANSPARENT` — the provider enum cannot grow a member, and
 * "transparent" is a wallet-level concept, not a crypto one.
 *
 * As the `changeShieldedMode` send option: absent or `null` means the wallet's
 * automatic selection rules decide the change mode per token; any explicit
 * value — `OutputKind.TRANSPARENT`, AMOUNT_SHIELDED or FULLY_SHIELDED — is
 * respected for every change output.
 */
export type ChangeOutputMode = ShieldedOutputMode | OutputKind.TRANSPARENT;

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
  // hex, 33 bytes. Protocol-optional: on-chain the field is all-zeros when
  // absent and the fullnode omits the JSON key. Without it the output can
  // never be rewound via ECDH (see shielded/processing.ts).
  ephemeral_pubkey?: string;
  // FullShielded only:
  asset_commitment?: string; // hex, 33 bytes
  surjection_proof?: string; // hex, variable
}

export interface IShieldedOutput extends IShieldedOutputProofs {
  // First byte of every shielded output on the wire (see
  // ShieldedOutput.serialize/deserialize): the fullnode always sets it
  // (1=AmountShielded, 2=FullShielded), so readers classify directly from it.
  mode: ShieldedOutputMode;
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

// ─── shielded view key ─────────────────────────────────────────────────────

/**
 * Why a wallet cannot decode its shielded outputs.
 *
 * Its scan key was not unlocked:
 * - `not-supplied`: no PIN was given, or the record holds no encrypted scan key;
 * - `wrong-pin`: the PIN does not decrypt the scan key;
 * - `corrupt-key`: the PIN decrypts the scan key record, but it holds no valid
 *   extended private key;
 * - `error`: unlocking failed with an unexpected error, such as a store read.
 *
 * The record has no shielded keys because the migration that adds them failed:
 * - `wrong-password`: the password does not decrypt the words;
 * - `wrong-pin`: the PIN does not decrypt the wallet's keys;
 * - `passphrase-mismatch`: the words and passphrase do not derive the wallet's
 *   own keys.
 *
 * The record is inconsistent, so its shielded keys are not used:
 * - `key-mismatch`: the scan key the PIN decrypts is not the key of the
 *   record's `scanXpubkey`.
 */
export type ShieldedCapabilityCause =
  | 'not-supplied'
  | 'wrong-pin'
  | 'corrupt-key'
  | 'error'
  | 'wrong-password'
  | 'passphrase-mismatch'
  | 'key-mismatch';

/**
 * The wallet's own shielded outputs that it holds but has not decoded, over
 * the history it has loaded. An output is the wallet's when it carries an
 * ephemeral public key and its address is one of the wallet's shielded spend
 * addresses, which needs no key to check.
 *
 * The counts are approximate in both directions: an output's address is wire
 * data, so crafted outputs can raise them, and they only cover the address
 * windows the wallet loaded. They never change a balance.
 */
export interface IShieldedUndecodedSummary {
  /** The txs with at least one such output, sorted. */
  txIds: string[];
  /**
   * Outputs not decoded because no scan key or no crypto provider was
   * available. Unlocking the key, or registering the provider, and processing
   * the history again decodes them.
   */
  locked: number;
  /**
   * Outputs that a decode ran on and that did not open with the wallet's scan
   * key, or that are malformed. Processing them again gives the same result.
   */
  unreadable: number;
  /**
   * Outputs whose decode failed in a way a retry may fix, such as a store read
   * failure. Processing the history again retries them.
   */
  error: number;
}

/**
 * What the wallet can do with shielded outputs:
 * - `none`: nothing. It has no shielded chain it can use, so it derives,
 *   watches and gives out no shielded address;
 * - `watch`: it watches its shielded addresses and counts the outputs paid to
 *   them, but cannot decode them, because its scan key is not unlocked;
 * - `view`: it decodes its shielded outputs, but cannot spend them;
 * - `full`: it decodes and spends its shielded outputs.
 */
export type ShieldedCapabilityLevel = 'none' | 'watch' | 'view' | 'full';

/**
 * Why the capability level is below `full`:
 * - `not-started`: the wallet is not started (before `start()`, after
 *   `stop()`, or after a failed start);
 * - `wallet-service`: the wallet-service facade has no shielded support;
 * - `multisig`: the wallet is multisig, whose shielded keys are
 *   single-signature keys;
 * - `integrity`: the record's shielded keys do not match each other, so they
 *   are not used (the cause says which);
 * - `needs-password`: the record has no shielded keys, and its words can
 *   derive them with the wallet's password (the cause says why an attempt at
 *   start failed, if one did);
 * - `hardware`: the record of a hardware wallet has no shielded keys;
 * - `no-shielded-keys`: the record has no shielded keys, and nothing to derive
 *   them from;
 * - `no-provider`: no shielded crypto provider is registered;
 * - `locked`: the wallet's scan key is not unlocked (the cause says why);
 * - `no-spend-authority`: the wallet cannot sign the inputs that spend its
 *   shielded outputs.
 */
export type ShieldedCapabilityReason =
  | 'not-started'
  | 'wallet-service'
  | 'multisig'
  | 'integrity'
  | 'needs-password'
  | 'hardware'
  | 'no-shielded-keys'
  | 'no-provider'
  | 'locked'
  | 'no-spend-authority';

/**
 * What the wallet can do with shielded outputs, and why it cannot do more.
 * `HathorWallet.getShieldedCapability()` returns it, and the wallet emits it
 * with the `'shielded-capability'` event whenever it changes. It holds no key
 * material.
 */
export interface IShieldedCapability {
  level: ShieldedCapabilityLevel;
  /** Why the level is below `full`; null at `full`. */
  reason: ShieldedCapabilityReason | null;
  /**
   * The detail of the `locked`, `needs-password` and `integrity` reasons, or
   * null.
   */
  cause: ShieldedCapabilityCause | null;
  /**
   * Whether the wallet sees what its shielded addresses receive: the level is
   * `view` or `full`, and the history is synced by polling. The streaming sync
   * modes do not watch the addresses shielded outputs are paid to.
   */
  canReceive: boolean;
  /**
   * Whether the wallet can sign the inputs that spend its shielded outputs:
   * with an external tx signer, whether the signer declared that it signs
   * them; otherwise whether the record holds the encrypted spend key.
   */
  canSpend: boolean;
  /**
   * Whether the wallet loaded all of its shielded history. False at level
   * `none`, in the streaming sync modes, and when the address discovery of
   * the last history walk stopped at its round limit.
   */
  historyComplete: boolean;
  /** The wallet's own shielded outputs that it holds but has not decoded. */
  undecoded: IShieldedUndecodedSummary;
}
