/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BLINDING_FACTOR_SIZE_BYTES,
  COMPRESSED_PUBKEY_SIZE_BYTES,
  MAX_RANGE_PROOF_SIZE,
  MAX_SHIELDED_OUTPUT_VALUE,
  MAX_SHIELDED_OUTPUTS,
  MAX_SURJECTION_DOMAIN,
  MAX_SURJECTION_PROOF_SIZE,
  NATIVE_TOKEN_UID,
  NATIVE_TOKEN_UID_HEX,
  TX_HASH_SIZE_BYTES,
  ZERO_TWEAK,
} from '../constants';
import { getAddressType } from '../utils/address';
import { assertValidCompressedPubkey } from '../utils/shieldedAddress';
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

// ─── provider-output shape checks (SUP-02) ─────────────────────────────────
//
// We trust the crypto provider's MATH (re-verifying every proof would double
// the cost and the provider is pinned), but a buggy or version-skewed provider
// returning a wrong-size buffer would serialize to invalid wire data the
// fullnode rejects only post-PoW. These cheap length asserts fail loud at the
// boundary instead.

function assertProviderBuffer(buf: Buffer | undefined, expectedLen: number, name: string): void {
  if (!buf || buf.length !== expectedLen) {
    throw new Error(
      `Crypto provider returned ${name} of ${buf?.length ?? 0} bytes, expected ${expectedLen}`
    );
  }
}

function assertProviderProof(buf: Buffer | undefined, maxLen: number, name: string): void {
  if (!buf || buf.length < 1 || buf.length > maxLen) {
    throw new Error(
      `Crypto provider returned ${name} of ${buf?.length ?? 0} bytes, expected [1, ${maxLen}]`
    );
  }
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
    // Non-last output: random vbf.
    const vbf = await cryptoProvider.generateRandomBlindingFactor();
    cryptoResult = await cryptoProvider.createAmountShieldedOutput(
      proposal.value,
      recipientPubkeyBuf,
      tokenUidBuf,
      vbf
    );
  }

  // SUP-02: shape-check the provider output before it reaches the wire.
  assertProviderBuffer(
    cryptoResult.ephemeralPubkey,
    COMPRESSED_PUBKEY_SIZE_BYTES,
    'ephemeralPubkey'
  );
  assertProviderBuffer(cryptoResult.commitment, COMPRESSED_PUBKEY_SIZE_BYTES, 'commitment');
  assertProviderBuffer(cryptoResult.blindingFactor, BLINDING_FACTOR_SIZE_BYTES, 'blindingFactor');
  assertProviderProof(cryptoResult.rangeProof, MAX_RANGE_PROOF_SIZE, 'rangeProof');

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

  // SUP-02: shape-check the provider output before it reaches the wire.
  assertProviderBuffer(
    cryptoResult.ephemeralPubkey,
    COMPRESSED_PUBKEY_SIZE_BYTES,
    'ephemeralPubkey'
  );
  assertProviderBuffer(cryptoResult.commitment, COMPRESSED_PUBKEY_SIZE_BYTES, 'commitment');
  assertProviderBuffer(cryptoResult.blindingFactor, BLINDING_FACTOR_SIZE_BYTES, 'blindingFactor');
  assertProviderProof(cryptoResult.rangeProof, MAX_RANGE_PROOF_SIZE, 'rangeProof');
  assertProviderBuffer(
    cryptoResult.assetCommitment,
    COMPRESSED_PUBKEY_SIZE_BYTES,
    'assetCommitment'
  );
  assertProviderBuffer(
    cryptoResult.assetBlindingFactor,
    BLINDING_FACTOR_SIZE_BYTES,
    'assetBlindingFactor'
  );

  const codomainTag = await cryptoProvider.deriveTag(tokenUidBuf);
  const domain = await buildSurjectionDomain(inputGenerators, cryptoProvider);
  const surjectionProof = await cryptoProvider.createSurjectionProof(
    codomainTag,
    cryptoResult.assetBlindingFactor,
    domain
  );
  assertProviderProof(surjectionProof, MAX_SURJECTION_PROOF_SIZE, 'surjectionProof');

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
  // INP-03: bound the count up front. The build loop is synchronous-ish work
  // per output; without this an oversized batch stalls the event loop on work
  // the fullnode rejects anyway (it enforces the same MAX_SHIELDED_OUTPUTS).
  if (proposals.length > MAX_SHIELDED_OUTPUTS) {
    throw new Error(
      `At most ${MAX_SHIELDED_OUTPUTS} shielded outputs are allowed, got ${proposals.length} ` +
        `(hathor-core consensus limit)`
    );
  }

  // Validate inputs upfront before expensive crypto work
  const hasFullShielded = proposals.some(p => p.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED);
  for (const [idx, proposal] of proposals.entries()) {
    // INP-02: reject a truncated/typo'd scanPubkey. `Buffer.from(hex)` silently
    // truncates at the first non-hex pair (e.g. '02'+…+'zz' decodes to a
    // length-valid-but-WRONG key), so check the source string is canonical
    // 66-hex AND a real on-curve compressed point. A length-only gate would
    // build an output nobody can spend (silent fund loss).
    if (!/^[0-9a-fA-F]{66}$/.test(proposal.scanPubkey)) {
      throw new Error(
        `Shielded output ${idx}: scanPubkey must be ${COMPRESSED_PUBKEY_SIZE_BYTES * 2} hex characters`
      );
    }
    assertValidCompressedPubkey(
      Buffer.from(proposal.scanPubkey, 'hex'),
      `shielded output ${idx} scanPubkey`
    );

    const tokenBuf = Buffer.from(
      proposal.token === NATIVE_TOKEN_UID ? NATIVE_TOKEN_UID_HEX : proposal.token,
      'hex'
    );
    if (tokenBuf.length !== TX_HASH_SIZE_BYTES) {
      throw new Error(
        `Shielded output ${idx}: token UID must be ${TX_HASH_SIZE_BYTES} bytes, got ${tokenBuf.length}`
      );
    }

    // VULN-2 / DISC-02: bound the value to the range proof's domain. The
    // fullnode enforces no explicit value ceiling (only a proof byte-size cap),
    // so an over-cap value would build a node-accepted protocol violation and
    // leak the amount magnitude via the on-wire proof length.
    if (proposal.value < 1n || proposal.value >= MAX_SHIELDED_OUTPUT_VALUE) {
      throw new Error(`Shielded output ${idx}: value must be in [1, 2^40), got ${proposal.value}`);
    }

    // INP-04: timelock is silently coerced (setUint32, mod 2^32) into the
    // on-chain script downstream; reject out-of-range values up front.
    if (
      proposal.timelock != null &&
      (!Number.isInteger(proposal.timelock) ||
        proposal.timelock < 0 ||
        proposal.timelock > 0xffffffff)
    ) {
      throw new Error(
        `Shielded output ${idx}: timelock must be an integer in [0, 2^32), got ${proposal.timelock}`
      );
    }
  }
  if (hasFullShielded && inputGenerators.length === 0) {
    throw new Error(
      'FullShielded outputs require at least one input token UID for surjection proof domain'
    );
  }
  // CRY-01: the surjection-proof domain has one entry per input generator;
  // exceeding the prover's limit triggers an UNCATCHABLE native abort (SIGABRT),
  // so reject an oversized domain here, before any crypto runs.
  if (inputGenerators.length > MAX_SURJECTION_DOMAIN) {
    throw new Error(
      `inputGenerators length ${inputGenerators.length} exceeds the surjection-proof ` +
        `domain limit of ${MAX_SURJECTION_DOMAIN}`
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
    // INP-07: a wrong-length assetBlindingFactor would feed a garbage scalar
    // into createAssetCommitment; validate length symmetric with the token
    // check. (Its *correctness* vs the real tx input is the caller's job —
    // creation.ts has no access to the transaction's inputs.)
    if (
      info.assetBlindingFactor &&
      info.assetBlindingFactor.length !== BLINDING_FACTOR_SIZE_BYTES
    ) {
      throw new Error(
        `inputGenerators[${idx}]: assetBlindingFactor must be ${BLINDING_FACTOR_SIZE_BYTES} bytes, ` +
          `got ${info.assetBlindingFactor.length}`
      );
    }
  }

  const results: IDataShieldedOutput[] = [];
  const createdOutputs: IBlindingEntry[] = [];

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
      // VULN-1: the token UID is precisely the secret a FullShielded output
      // hides (it has no on-chain slot — it lives only inside asset_commitment).
      // Never leak it into the error MESSAGE (which flows to logs/telemetry):
      // redact it for FullShielded. The full inner error is preserved via
      // `cause` for local debugging, so dropping the `${e}` interpolation (which
      // also crossed the message boundary) loses no diagnostics.
      const tokenLabel =
        proposal.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED ? '<hidden>' : proposal.token;
      throw new Error(
        `Failed to create shielded output ${i}/${proposals.length} (mode=${mode}, token=${tokenLabel})`,
        { cause: e }
      );
    }
  }

  return results;
}
