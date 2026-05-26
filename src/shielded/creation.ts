/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NATIVE_TOKEN_UID, NATIVE_TOKEN_UID_HEX, ZERO_TWEAK } from '../constants';
import { getAddressType } from '../utils/address';
import transactionUtils from '../utils/transaction';
import Network from '../models/network';
import {
  IBlindingEntry,
  IDataShieldedOutput,
  IShieldedCryptoProvider,
  ISurjectionDomainEntry,
  ShieldedOutputMode,
} from './types';

interface ShieldedOutputProposal {
  address: string;
  value: bigint;
  token: string;
  scanPubkey: string;
  shieldedMode: ShieldedOutputMode;
  timelock?: number;
}

/**
 * Re-export of `IBlindingEntry` under wallet-lib's local name. The contract
 * lives in `@hathor/ct-crypto-provider`; alias kept for back-compat with the
 * old `ShieldedInputBlinding` type that callers may still import.
 */
export type ShieldedInputBlinding = IBlindingEntry;

/**
 * Per-input generator info for surjection proof domain construction.
 * For transparent/AmountShielded inputs, only tokenUid is needed (unblinded generator).
 * For FullShielded inputs, the assetBlindingFactor is required to reconstruct
 * the blinded generator (asset_commitment) that the fullnode uses for verification.
 */
export interface InputGeneratorInfo {
  tokenUid: string;
  assetBlindingFactor?: Buffer; // present only for FullShielded inputs
}

/**
 * Create shielded outputs with cryptographic commitments and proofs.
 *
 * The homomorphic balance equation requires blinding factors to sum to zero.
 * For transparent-only inputs, all input blinding factors are zero.
 * For shielded inputs, their blinding factors are passed via `blindedInputs`.
 * N-1 outputs use random blinding factors; the last output's blinding factor
 * is computed via computeBalancingBlindingFactor to satisfy the constraint.
 */
export async function createShieldedOutputs(
  proposals: ShieldedOutputProposal[],
  cryptoProvider: IShieldedCryptoProvider,
  network: Network,
  inputGenerators: InputGeneratorInfo[] = [],
  blindedInputs: ShieldedInputBlinding[] = []
): Promise<IDataShieldedOutput[]> {
  if (proposals.length === 0) return [];

  // Validate inputs upfront before expensive crypto work
  const hasFullShielded = proposals.some(p => p.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED);
  for (const [idx, proposal] of proposals.entries()) {
    const pubkeyBuf = Buffer.from(proposal.scanPubkey, 'hex');
    if (pubkeyBuf.length !== 33) {
      throw new Error(
        `Shielded output ${idx}: scanPubkey must be 33 bytes, got ${pubkeyBuf.length}`
      );
    }
    const tokenBuf = Buffer.from(
      proposal.token === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : proposal.token,
      'hex'
    );
    if (tokenBuf.length !== 32) {
      throw new Error(`Shielded output ${idx}: token UID must be 32 bytes, got ${tokenBuf.length}`);
    }
  }
  if (hasFullShielded && inputGenerators.length === 0) {
    throw new Error(
      'FullShielded outputs require at least one input token UID for surjection proof domain'
    );
  }

  const results: IDataShieldedOutput[] = [];
  const createdOutputs: IBlindingEntry[] = [];

  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    const fullyShielded = proposal.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED;
    const recipientPubkeyBuf = Buffer.from(proposal.scanPubkey, 'hex');
    const tokenUidBuf = Buffer.from(
      proposal.token === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : proposal.token,
      'hex'
    );

    let cryptoResult;
    const isLast = i === proposals.length - 1;

    try {
      if (isLast && createdOutputs.length > 0) {
        if (fullyShielded) {
          // FullShielded last output: generate abf, compute balancing vbf, create with both
          const lastAbf = await cryptoProvider.generateRandomBlindingFactor();
          const balancingBf = await cryptoProvider.computeBalancingBlindingFactor(
            proposal.value,
            lastAbf,
            blindedInputs,
            createdOutputs
          );
          cryptoResult = await cryptoProvider.createShieldedOutputWithBothBlindings(
            proposal.value,
            recipientPubkeyBuf,
            tokenUidBuf,
            balancingBf,
            lastAbf
          );
          createdOutputs.push({
            value: proposal.value,
            valueBlindingFactor: cryptoResult.blindingFactor,
            generatorBlindingFactor: cryptoResult.assetBlindingFactor ?? ZERO_TWEAK,
          });
        } else {
          // AmountShielded last output: compute balancing vbf, create with it
          const balancingBf = await cryptoProvider.computeBalancingBlindingFactor(
            proposal.value,
            ZERO_TWEAK,
            blindedInputs,
            createdOutputs
          );
          cryptoResult = await cryptoProvider.createAmountShieldedOutput(
            proposal.value,
            recipientPubkeyBuf,
            tokenUidBuf,
            balancingBf
          );
          createdOutputs.push({
            value: proposal.value,
            valueBlindingFactor: cryptoResult.blindingFactor,
            generatorBlindingFactor: ZERO_TWEAK,
          });
        }
      } else if (fullyShielded) {
        // FullShielded non-last output: generate both blinding factors
        const vbf = await cryptoProvider.generateRandomBlindingFactor();
        const abf = await cryptoProvider.generateRandomBlindingFactor();
        cryptoResult = await cryptoProvider.createShieldedOutputWithBothBlindings(
          proposal.value,
          recipientPubkeyBuf,
          tokenUidBuf,
          vbf,
          abf
        );
        createdOutputs.push({
          value: proposal.value,
          valueBlindingFactor: cryptoResult.blindingFactor,
          generatorBlindingFactor: cryptoResult.assetBlindingFactor ?? ZERO_TWEAK,
        });
      } else {
        // AmountShielded non-last output: generate random vbf
        const vbf = await cryptoProvider.generateRandomBlindingFactor();
        cryptoResult = await cryptoProvider.createAmountShieldedOutput(
          proposal.value,
          recipientPubkeyBuf,
          tokenUidBuf,
          vbf
        );
        createdOutputs.push({
          value: proposal.value,
          valueBlindingFactor: cryptoResult.blindingFactor,
          generatorBlindingFactor: ZERO_TWEAK,
        });
      }

      // Create the output script for the on-chain address (spend-derived P2PKH).
      // proposal.address is already the spend-derived P2PKH (resolved in sendManyOutputsSendTransaction).
      const scriptBuf = transactionUtils.createOutputScript(
        {
          address: proposal.address,
          value: proposal.value,
          timelock: proposal.timelock ?? null,
          authorities: 0n,
          token: proposal.token,
          type: getAddressType(proposal.address, network),
        },
        network
      );

      // For FullShielded outputs, generate a surjection proof.
      // The domain must include ALL input generators (matching the fullnode's verification).
      // For transparent/AmountShielded inputs: use unblinded generator (ZERO_TWEAK).
      // For FullShielded inputs: use the blinded generator (asset_commitment) reconstructed
      // from the input's asset blinding factor — the fullnode verifies against this.
      let surjectionProof: Buffer | undefined;
      if (fullyShielded && cryptoResult.assetBlindingFactor) {
        const codomainTag = await cryptoProvider.deriveTag(tokenUidBuf);
        const domain: ISurjectionDomainEntry[] = [];
        for (const inputInfo of inputGenerators) {
          const inputTokenBuf = Buffer.from(
            inputInfo.tokenUid === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : inputInfo.tokenUid,
            'hex'
          );
          const inputTag = await cryptoProvider.deriveTag(inputTokenBuf);
          const abf = inputInfo.assetBlindingFactor ?? ZERO_TWEAK;
          const inputGen = await cryptoProvider.createAssetCommitment(inputTag, abf);
          domain.push({ generator: inputGen, tag: inputTag, blindingFactor: abf });
        }
        surjectionProof = await cryptoProvider.createSurjectionProof(
          codomainTag,
          cryptoResult.assetBlindingFactor,
          domain
        );
      }

      results.push({
        address: proposal.address,
        value: proposal.value,
        token: proposal.token,
        scanPubkey: proposal.scanPubkey,
        shieldedMode: proposal.shieldedMode,
        ephemeralPubkey: cryptoResult.ephemeralPubkey,
        commitment: cryptoResult.commitment,
        rangeProof: cryptoResult.rangeProof,
        blindingFactor: cryptoResult.blindingFactor,
        assetCommitment: cryptoResult.assetCommitment,
        assetBlindingFactor: cryptoResult.assetBlindingFactor,
        surjectionProof,
        script: scriptBuf.toString('hex'),
      });
    } catch (e) {
      const mode = fullyShielded ? 'FullShielded' : 'AmountShielded';
      throw new Error(
        `Failed to create shielded output ${i}/${proposals.length} (mode=${mode}, token=${proposal.token}): ${e}`
      );
    }
  }

  return results;
}
