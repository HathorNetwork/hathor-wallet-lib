/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IShieldedCryptoProvider, ShieldedOutputMode } from './types';
import type { ShieldedScanKey } from './scanKey';

/**
 * The on-chain data needed to rewind one shielded output.
 */
export interface IShieldedOutputOpening {
  mode: ShieldedOutputMode;
  ephemeralPubkey: Buffer;
  commitment: Buffer;
  rangeProof: Buffer;
  /** AmountShielded only: the visible token, as 32-byte hex (NATIVE_TOKEN_UID_HEX for HTR). */
  tokenUid?: string;
  /** FullShielded only: the commitment hiding the token. */
  assetCommitment?: Buffer;
}

/**
 * What rewinding an owned shielded output recovers.
 */
export interface IRewoundShieldedOutput {
  mode: ShieldedOutputMode;
  value: bigint;
  /** 32-byte hex token UID (NATIVE_TOKEN_UID_HEX for HTR). */
  tokenUid: string;
  blindingFactor: Buffer;
  /** FullShielded only. */
  assetBlindingFactor?: Buffer;
}

export type ShieldedRewindFailure = 'asset-commitment-mismatch' | 'non-positive-value';

/**
 * A rewind that succeeded cryptographically but whose result cannot be trusted.
 */
export class ShieldedRewindError extends Error {
  reason: ShieldedRewindFailure;

  constructor(reason: ShieldedRewindFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Derive the per-address scan private key from the decrypted scan key, as the
 * raw 32-byte buffer the crypto provider needs for ECDH.
 *
 * Compliant BIP32 derivation, matching the scan public key in the shielded
 * address (shieldedAddress.ts). Shielded keys are new, so unlike the legacy
 * P2PKH chain they do not need deriveNonCompliantChild.
 *
 * The returned buffer is a private key: zero it (`fill(0)`) once done with it.
 *
 * @param scanHdPrivKey The scan key, from `parseScanXPrivKey`
 * @param addressIndex The index of the shielded address
 * @throws {Error} when the index is not an address index, a non-negative
 *   integer below 2^31, as deriveShieldedAddress does
 */
export function deriveScanChildPrivkey(
  scanHdPrivKey: ShieldedScanKey,
  addressIndex: number
): Buffer {
  // From an index of 2^31 or more, bitcore would derive a hardened child, the
  // key of no address, and it truncates a fractional index.
  if (!Number.isInteger(addressIndex) || addressIndex < 0 || addressIndex >= 0x80000000) {
    throw new Error(
      `Invalid BIP32 address index: expected a non-negative integer < 2^31, got ${addressIndex}`
    );
  }
  // bitcore pads the key to 32 bytes
  return scanHdPrivKey.deriveChild(addressIndex).privateKey.toBuffer();
}

/**
 * Rewind one shielded output with the per-address scan private key, recovering
 * its value, token and blinding factors.
 *
 * A FullShielded result is accepted only when the recovered token and asset
 * blinding factor reproduce the on-chain asset commitment; otherwise the
 * output was built wrongly or forged. A non-positive value means a corrupted
 * rewind. Both throw {@link ShieldedRewindError}; provider failures propagate
 * as thrown by the provider. An output the key did not receive fails with the
 * provider's `ScanMissError` (exported on the `shielded` namespace) when the
 * provider recognises the case.
 *
 * The provider's rewind already checks that the recovered value and blinding
 * factor open the value commitment, so that is not checked again here.
 *
 * The blinding factors returned are secret: zero them once done with them.
 */
export async function rewindShieldedOutput(
  cryptoProvider: IShieldedCryptoProvider,
  scanChildPrivkey: Buffer,
  opening: IShieldedOutputOpening
): Promise<IRewoundShieldedOutput> {
  const { mode, ephemeralPubkey, commitment, rangeProof } = opening;
  let result: IRewoundShieldedOutput;

  if (mode === ShieldedOutputMode.FULLY_SHIELDED) {
    if (!opening.assetCommitment) {
      throw new Error('A fully shielded output needs its asset commitment to be rewound.');
    }
    const rewound = await cryptoProvider.rewindFullShieldedOutput(
      scanChildPrivkey,
      ephemeralPubkey,
      commitment,
      rangeProof,
      opening.assetCommitment
    );
    const expectedTag = await cryptoProvider.deriveTag(Buffer.from(rewound.tokenUid, 'hex'));
    const expectedAc = await cryptoProvider.createAssetCommitment(
      expectedTag,
      rewound.assetBlindingFactor
    );
    if (!opening.assetCommitment.equals(expectedAc)) {
      throw new ShieldedRewindError(
        'asset-commitment-mismatch',
        `asset commitment mismatch: recovered tokenUid=${rewound.tokenUid}, ` +
          `on-chain assetCommitment=${opening.assetCommitment.toString('hex')}, ` +
          `expected assetCommitment=${expectedAc.toString('hex')}`
      );
    }
    result = {
      mode,
      value: rewound.value,
      tokenUid: rewound.tokenUid,
      blindingFactor: rewound.blindingFactor,
      assetBlindingFactor: rewound.assetBlindingFactor,
    };
  } else {
    if (!opening.tokenUid) {
      throw new Error('An amount shielded output needs its token to be rewound.');
    }
    const rewound = await cryptoProvider.rewindAmountShieldedOutput(
      scanChildPrivkey,
      ephemeralPubkey,
      commitment,
      rangeProof,
      Buffer.from(opening.tokenUid, 'hex')
    );
    result = {
      mode: ShieldedOutputMode.AMOUNT_SHIELDED,
      value: rewound.value,
      tokenUid: opening.tokenUid,
      blindingFactor: rewound.blindingFactor,
      assetBlindingFactor: undefined,
    };
  }

  if (result.value <= 0n) {
    throw new ShieldedRewindError(
      'non-positive-value',
      `rewind returned non-positive value ${result.value}`
    );
  }
  return result;
}
