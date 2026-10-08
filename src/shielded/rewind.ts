/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { PRIVATE_KEY_SIZE_BYTES } from '../constants';
import { IShieldedCryptoProvider, ShieldedOutputMode } from './types';

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
 */
export function deriveScanChildPrivkey(scanHdPrivKey: HDPrivateKey, addressIndex: number): Buffer {
  // { size } zero-pads keys with leading zeros
  return scanHdPrivKey.deriveChild(addressIndex).privateKey.toBuffer({
    size: PRIVATE_KEY_SIZE_BYTES,
  });
}

/**
 * Rewind one shielded output with the per-address scan private key, recovering
 * its value, token and blinding factors.
 *
 * A FullShielded result is accepted only when the recovered token and asset
 * blinding factor reproduce the on-chain asset commitment; otherwise the
 * output was built wrongly or forged. A non-positive value means a corrupted
 * rewind. Both throw {@link ShieldedRewindError}; provider failures (the output
 * is not this wallet's) propagate as thrown by the provider.
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
