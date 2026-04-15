/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NATIVE_TOKEN_UID_HEX } from '../constants';
import { IDataShieldedOutput } from '../types';
import { getAddressType } from '../utils/address';
import transactionUtils from '../utils/transaction';
import Network from '../models/network';
import { IShieldedCryptoProvider, ShieldedOutputMode } from './types';

const HTR_UID = '00';

// Zero blinding factor representing transparent (unblinded) inputs/outputs
// in Pedersen commitment balance equations.
const ZERO_TWEAK = Buffer.alloc(32, 0);

interface ShieldedOutputDef {
  address: string;
  value: bigint;
  token: string;
  scanPubkey: string;
  shieldedMode: ShieldedOutputMode;
}

/**
 * Create shielded outputs with cryptographic commitments and proofs.
 *
 * The homomorphic balance equation requires blinding factors to sum to zero
 * (when all inputs are transparent). N-1 outputs use random blinding factors;
 * the last output's blinding factor is computed via computeBalancingBlindingFactor
 * to satisfy this constraint.
 */
export async function createShieldedOutputs(
  defs: ShieldedOutputDef[],
  cryptoProvider: IShieldedCryptoProvider,
  network: Network,
  inputTokenUids: string[] = []
): Promise<IDataShieldedOutput[]> {
  const results: IDataShieldedOutput[] = [];
  const createdOutputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }> = [];

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const fullyShielded = def.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED;
    const recipientPubkeyBuf = Buffer.from(def.scanPubkey, 'hex');
    const tokenUidBuf = Buffer.from(
      def.token === HTR_UID ? NATIVE_TOKEN_UID_HEX : def.token,
      'hex'
    );

    let cryptoResult;
    const isLast = i === defs.length - 1;

    if (isLast && createdOutputs.length > 0) {
      if (fullyShielded) {
        // FullShielded last output: generate abf, compute balancing vbf, create with both
        const lastAbf = await cryptoProvider.generateRandomBlindingFactor();
        const balancingBf = await cryptoProvider.computeBalancingBlindingFactor(
          def.value,
          lastAbf,
          [], // no blinded inputs (all transparent)
          createdOutputs
        );
        cryptoResult = await cryptoProvider.createShieldedOutputWithBothBlindings(
          def.value,
          recipientPubkeyBuf,
          tokenUidBuf,
          balancingBf,
          lastAbf
        );
        createdOutputs.push({
          value: def.value,
          vbf: cryptoResult.blindingFactor,
          gbf: cryptoResult.assetBlindingFactor ?? ZERO_TWEAK,
        });
      } else {
        // AmountShielded last output: compute balancing vbf, create with it
        const balancingBf = await cryptoProvider.computeBalancingBlindingFactor(
          def.value,
          ZERO_TWEAK,
          [],
          createdOutputs
        );
        cryptoResult = await cryptoProvider.createAmountShieldedOutput(
          def.value,
          recipientPubkeyBuf,
          tokenUidBuf,
          balancingBf
        );
        createdOutputs.push({
          value: def.value,
          vbf: cryptoResult.blindingFactor,
          gbf: ZERO_TWEAK,
        });
      }
    } else if (fullyShielded) {
      // FullShielded non-last output: generate both blinding factors
      const vbf = await cryptoProvider.generateRandomBlindingFactor();
      const abf = await cryptoProvider.generateRandomBlindingFactor();
      cryptoResult = await cryptoProvider.createShieldedOutputWithBothBlindings(
        def.value,
        recipientPubkeyBuf,
        tokenUidBuf,
        vbf,
        abf
      );
      createdOutputs.push({
        value: def.value,
        vbf: cryptoResult.blindingFactor,
        gbf: cryptoResult.assetBlindingFactor ?? ZERO_TWEAK,
      });
    } else {
      // AmountShielded non-last output: generate random vbf
      const vbf = await cryptoProvider.generateRandomBlindingFactor();
      cryptoResult = await cryptoProvider.createAmountShieldedOutput(
        def.value,
        recipientPubkeyBuf,
        tokenUidBuf,
        vbf
      );
      createdOutputs.push({
        value: def.value,
        vbf: cryptoResult.blindingFactor,
        gbf: ZERO_TWEAK,
      });
    }

    // Create the output script for the on-chain address (spend-derived P2PKH).
    // def.address is already the spend-derived P2PKH (resolved in sendManyOutputsSendTransaction).
    const scriptBuf = transactionUtils.createOutputScript(
      {
        address: def.address,
        value: def.value,
        timelock: null,
        authorities: 0n,
        token: def.token,
        type: getAddressType(def.address, network),
      },
      network
    );

    // For FullShielded outputs, generate a surjection proof.
    // The domain must include ALL transparent input generators (matching the fullnode's verification).
    let surjectionProof: Buffer | undefined;
    if (fullyShielded && cryptoResult.assetBlindingFactor) {
      const codomainTag = await cryptoProvider.deriveTag(tokenUidBuf);
      const domain: Array<{ generator: Buffer; tag: Buffer; blindingFactor: Buffer }> = [];
      for (const inputToken of inputTokenUids) {
        const inputTokenBuf = Buffer.from(
          inputToken === HTR_UID ? NATIVE_TOKEN_UID_HEX : inputToken,
          'hex'
        );
        const inputTag = await cryptoProvider.deriveTag(inputTokenBuf);
        const inputGen = await cryptoProvider.createAssetCommitment(inputTag, ZERO_TWEAK);
        domain.push({ generator: inputGen, tag: inputTag, blindingFactor: ZERO_TWEAK });
      }
      surjectionProof = await cryptoProvider.createSurjectionProof(
        codomainTag,
        cryptoResult.assetBlindingFactor,
        domain
      );
    }

    results.push({
      address: def.address,
      value: def.value,
      token: def.token,
      scanPubkey: def.scanPubkey,
      mode: def.shieldedMode,
      ephemeralPubkey: cryptoResult.ephemeralPubkey,
      commitment: cryptoResult.commitment,
      rangeProof: cryptoResult.rangeProof,
      blindingFactor: cryptoResult.blindingFactor,
      assetCommitment: cryptoResult.assetCommitment,
      assetBlindingFactor: cryptoResult.assetBlindingFactor,
      surjectionProof,
      script: scriptBuf.toString('hex'),
    });
  }

  return results;
}
