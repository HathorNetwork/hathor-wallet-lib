/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  COMPRESSED_PUBKEY_SIZE_BYTES,
  NATIVE_TOKEN_UID,
  NATIVE_TOKEN_UID_HEX,
  TX_HASH_SIZE_BYTES,
  ZERO_TWEAK,
} from '../constants';
import { getAddressType } from '../utils/address';
import transactionUtils from '../utils/transaction';
import Network from '../models/network';
import {
  IBlindingEntry,
  IDataShieldedOutput,
  InputGeneratorInfo,
  IShieldedCryptoProvider,
  ISurjectionDomainEntry,
  ShieldedOutputMode,
  ShieldedOutputProposal,
} from './types';

/**
 * Create shielded outputs with cryptographic commitments and proofs.
 *
 * N-1 outputs use random blinding factors; the last output's blinding
 * factor is computed via `computeBalancingBlindingFactor` so the
 * homomorphic balance equation holds.
 *
 * hathor-core forbids transactions with a single shielded output
 * (trivial-commitment matching), so we throw when only one proposal is
 * passed. Empty input returns `[]`.
 */
export async function createShieldedOutputs(
  proposals: ShieldedOutputProposal[],
  cryptoProvider: IShieldedCryptoProvider,
  network: Network,
  inputGenerators: InputGeneratorInfo[] = [],
  blindedInputs: IBlindingEntry[] = []
): Promise<IDataShieldedOutput[]> {
  if (proposals.length === 0) return [];
  if (proposals.length === 1) {
    throw new Error(
      'At least 2 shielded outputs are required (hathor-core trivial-commitment rule)'
    );
  }

  // Validate inputs upfront before expensive crypto work
  const hasFullShielded = proposals.some(p => p.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED);
  for (const [idx, proposal] of proposals.entries()) {
    const pubkeyBuf = Buffer.from(proposal.scanPubkey, 'hex');
    if (pubkeyBuf.length !== COMPRESSED_PUBKEY_SIZE_BYTES) {
      throw new Error(
        `Shielded output ${idx}: scanPubkey must be ${COMPRESSED_PUBKEY_SIZE_BYTES} bytes, got ${pubkeyBuf.length}`
      );
    }
    const tokenBuf = Buffer.from(
      proposal.token === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : proposal.token,
      'hex'
    );
    if (tokenBuf.length !== TX_HASH_SIZE_BYTES) {
      throw new Error(
        `Shielded output ${idx}: token UID must be ${TX_HASH_SIZE_BYTES} bytes, got ${tokenBuf.length}`
      );
    }
  }
  if (hasFullShielded && inputGenerators.length === 0) {
    throw new Error(
      'FullShielded outputs require at least one input token UID for surjection proof domain'
    );
  }
  // Validate inputGenerators tokenUid length up front for the same reason
  // we validate proposal.token above: Buffer.from(hex) silently truncates
  // malformed strings, and a wrong-length tag computed downstream by
  // deriveTag would produce a surjection proof the fullnode rejects with
  // a confusing error far from the actual cause.
  for (const [idx, info] of inputGenerators.entries()) {
    const inputTokenBuf = Buffer.from(
      info.tokenUid === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : info.tokenUid,
      'hex'
    );
    if (inputTokenBuf.length !== TX_HASH_SIZE_BYTES) {
      throw new Error(
        `inputGenerators[${idx}]: token UID must be ${TX_HASH_SIZE_BYTES} bytes, got ${inputTokenBuf.length}`
      );
    }
  }

  const results: IDataShieldedOutput[] = [];
  const createdOutputs: Array<IBlindingEntry> = [];

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
          if (!cryptoResult.assetBlindingFactor) {
            // Contract violation: createShieldedOutputWithBothBlindings is
            // required to return the asset blinding factor it used to build
            // the asset commitment. Silently falling back to ZERO_TWEAK
            // here would produce a malformed FullShielded output (the
            // commitment computed with the real abf but the stored
            // generatorBlindingFactor zeroed) — wallet decryption later
            // mismatches and balance corruption ensues.
            throw new Error(
              'Crypto provider returned no assetBlindingFactor for last FullShielded output'
            );
          }
          createdOutputs.push({
            value: proposal.value,
            valueBlindingFactor: cryptoResult.blindingFactor,
            generatorBlindingFactor: cryptoResult.assetBlindingFactor,
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
        if (!cryptoResult.assetBlindingFactor) {
          // Same contract as the last-output branch above — fail loud here
          // rather than store a zeroed generatorBlindingFactor and corrupt
          // the wallet's view of this UTXO downstream.
          throw new Error(
            'Crypto provider returned no assetBlindingFactor for FullShielded output'
          );
        }
        createdOutputs.push({
          value: proposal.value,
          valueBlindingFactor: cryptoResult.blindingFactor,
          generatorBlindingFactor: cryptoResult.assetBlindingFactor,
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
      if (fullyShielded) {
        // assetBlindingFactor is guaranteed non-null inside the FullShielded
        // branches above (we throw if the provider doesn't supply it), but
        // TypeScript can't carry that narrowing across the cryptoResult
        // reassignment in different if-branches — assert here.
        if (!cryptoResult.assetBlindingFactor) {
          throw new Error(
            'FullShielded output reached surjection-proof step without an assetBlindingFactor'
          );
        }
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
        `Failed to create shielded output ${i}/${proposals.length} (mode=${mode}, token=${proposal.token}): ${e}`,
        { cause: e }
      );
    }
  }

  return results;
}
