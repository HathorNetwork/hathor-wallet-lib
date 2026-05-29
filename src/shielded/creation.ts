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
  IDataAmountShieldedOutput,
  IDataFullShieldedOutput,
  IDataShieldedOutput,
  InputGeneratorInfo,
  IShieldedCryptoProvider,
  ISurjectionDomainEntry,
  ShieldedOutputMode,
  ShieldedOutputProposal,
} from './types';

// ─── per-proposal build context ───────────────────────────────────────────
//
// Shared inputs for the per-proposal helpers. `createdOutputs` is the
// accumulator from previous iterations; the helpers only read from it.
// The orchestrator (`createShieldedOutputs`) pushes the new createdEntry
// returned by each call once the helper has succeeded.

interface ShieldedOutputBuildContext {
  proposal: ShieldedOutputProposal;
  isLast: boolean;
  cryptoProvider: IShieldedCryptoProvider;
  blindedInputs: IBlindingEntry[];
  createdOutputs: IBlindingEntry[];
  recipientPubkeyBuf: Buffer;
  tokenUidBuf: Buffer;
  scriptHex: string;
}

interface FullShieldedBuildContext extends ShieldedOutputBuildContext {
  inputGenerators: InputGeneratorInfo[];
}

// ─── per-mode helpers ──────────────────────────────────────────────────────

/**
 * Build a single AmountShielded output: pick the right blinding factor
 * (random for non-last, balancing for the last output when there are
 * already siblings) and call the crypto provider.
 */
async function buildAmountShieldedOutput(
  ctx: ShieldedOutputBuildContext
): Promise<{ result: IDataAmountShieldedOutput; createdEntry: IBlindingEntry }> {
  const {
    proposal,
    isLast,
    cryptoProvider,
    blindedInputs,
    createdOutputs,
    recipientPubkeyBuf,
    tokenUidBuf,
    scriptHex,
  } = ctx;

  let cryptoResult;
  if (isLast && createdOutputs.length > 0) {
    // Last output: use a balancing vbf so the sum of output blinding factors
    // matches the sum of input blinding factors.
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
  } else {
    // Non-last output (or single-call with no siblings): random vbf.
    const vbf = await cryptoProvider.generateRandomBlindingFactor();
    cryptoResult = await cryptoProvider.createAmountShieldedOutput(
      proposal.value,
      recipientPubkeyBuf,
      tokenUidBuf,
      vbf
    );
  }

  return {
    createdEntry: {
      value: proposal.value,
      valueBlindingFactor: cryptoResult.blindingFactor,
      // AmountShielded does not hide the token; generator blinding factor is zero.
      generatorBlindingFactor: ZERO_TWEAK,
    },
    result: {
      address: proposal.address,
      value: proposal.value,
      token: proposal.token,
      scanPubkey: proposal.scanPubkey,
      shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
      ephemeralPubkey: cryptoResult.ephemeralPubkey,
      commitment: cryptoResult.commitment,
      rangeProof: cryptoResult.rangeProof,
      blindingFactor: cryptoResult.blindingFactor,
      script: scriptHex,
    },
  };
}

/**
 * Build the surjection-proof domain: every input generator contributes one
 * entry (tag + asset commitment). Transparent/AmountShielded inputs use
 * the unblinded generator (ZERO_TWEAK); FullShielded inputs use their
 * stored assetBlindingFactor — same shape the fullnode reconstructs for
 * verification.
 */
async function buildSurjectionDomain(
  inputGenerators: InputGeneratorInfo[],
  cryptoProvider: IShieldedCryptoProvider
): Promise<ISurjectionDomainEntry[]> {
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
  return domain;
}

/**
 * Build a single FullShielded output: pick the right (vbf, abf) pair (both
 * random for non-last; balancing vbf + random abf for the last output),
 * call the crypto provider, then build the surjection proof tying the
 * output's hidden token back to one of the input tokens.
 */
async function buildFullShieldedOutput(
  ctx: FullShieldedBuildContext
): Promise<{ result: IDataFullShieldedOutput; createdEntry: IBlindingEntry }> {
  const {
    proposal,
    isLast,
    cryptoProvider,
    blindedInputs,
    createdOutputs,
    recipientPubkeyBuf,
    tokenUidBuf,
    scriptHex,
    inputGenerators,
  } = ctx;

  let cryptoResult;
  if (isLast && createdOutputs.length > 0) {
    // Last FullShielded output: random abf + balancing vbf computed against it.
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
  } else {
    // Non-last FullShielded output: both random.
    const vbf = await cryptoProvider.generateRandomBlindingFactor();
    const abf = await cryptoProvider.generateRandomBlindingFactor();
    cryptoResult = await cryptoProvider.createShieldedOutputWithBothBlindings(
      proposal.value,
      recipientPubkeyBuf,
      tokenUidBuf,
      vbf,
      abf
    );
  }

  // Contract: the crypto provider is required to return both
  // assetBlindingFactor and assetCommitment for any FullShielded output.
  // Silently falling back to ZERO_TWEAK or skipping the surjection proof
  // would produce a malformed FullShielded output the fullnode (or wallet
  // decryption) rejects later with a confusing error; fail loud here at
  // the contract boundary instead.
  if (!cryptoResult.assetBlindingFactor) {
    throw new Error('Crypto provider returned no assetBlindingFactor for FullShielded output');
  }
  if (!cryptoResult.assetCommitment) {
    throw new Error('Crypto provider returned no assetCommitment for FullShielded output');
  }

  const codomainTag = await cryptoProvider.deriveTag(tokenUidBuf);
  const domain = await buildSurjectionDomain(inputGenerators, cryptoProvider);
  const surjectionProof = await cryptoProvider.createSurjectionProof(
    codomainTag,
    cryptoResult.assetBlindingFactor,
    domain
  );

  return {
    createdEntry: {
      value: proposal.value,
      valueBlindingFactor: cryptoResult.blindingFactor,
      generatorBlindingFactor: cryptoResult.assetBlindingFactor,
    },
    result: {
      address: proposal.address,
      value: proposal.value,
      token: proposal.token,
      scanPubkey: proposal.scanPubkey,
      shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
      ephemeralPubkey: cryptoResult.ephemeralPubkey,
      commitment: cryptoResult.commitment,
      rangeProof: cryptoResult.rangeProof,
      blindingFactor: cryptoResult.blindingFactor,
      assetCommitment: cryptoResult.assetCommitment,
      assetBlindingFactor: cryptoResult.assetBlindingFactor,
      surjectionProof,
      script: scriptHex,
    },
  };
}

// ─── orchestrator ──────────────────────────────────────────────────────────

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
    const isLast = i === proposals.length - 1;
    const recipientPubkeyBuf = Buffer.from(proposal.scanPubkey, 'hex');
    const tokenUidBuf = Buffer.from(
      proposal.token === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : proposal.token,
      'hex'
    );

    // proposal.address is already the spend-derived P2PKH (resolved in
    // `sendManyOutputsSendTransaction`); compute the on-chain script once
    // per iteration so both helpers receive it ready to use.
    const scriptHex = transactionUtils
      .createOutputScript(
        {
          address: proposal.address,
          value: proposal.value,
          timelock: proposal.timelock ?? null,
          authorities: 0n,
          token: proposal.token,
          type: getAddressType(proposal.address, network),
        },
        network
      )
      .toString('hex');

    try {
      const baseCtx: ShieldedOutputBuildContext = {
        proposal,
        isLast,
        cryptoProvider,
        blindedInputs,
        createdOutputs,
        recipientPubkeyBuf,
        tokenUidBuf,
        scriptHex,
      };
      const built =
        proposal.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED
          ? await buildFullShieldedOutput({ ...baseCtx, inputGenerators })
          : await buildAmountShieldedOutput(baseCtx);

      results.push(built.result);
      createdOutputs.push(built.createdEntry);
    } catch (e) {
      const mode = ShieldedOutputMode[proposal.shieldedMode];
      throw new Error(
        `Failed to create shielded output ${i}/${proposals.length} (mode=${mode}, token=${proposal.token}): ${e}`,
        { cause: e }
      );
    }
  }

  return results;
}
