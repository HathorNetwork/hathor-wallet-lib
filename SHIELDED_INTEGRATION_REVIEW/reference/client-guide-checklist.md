# Shielded Outputs: Client Integration Guide — Review Checklist

Source: https://github.com/HathorNetwork/hathor-core/blob/feat/ct-amount-token-privacy/hathor-ct-crypto/SHIELDED-OUTPUTS-CLIENT-GUIDE.md
(Fetched 2026-06-09. The hathor-core code at `experimental/shielded-outputs-alpha-v4` is the ultimate source of truth and overrides this guide where they diverge.)

## 1. Output Types & Architecture

### AmountShieldedOutput
- **Hides:** amount only; token type visible
- **On-chain fields:**
  - `commitment` (33 B): Pedersen `C = value * H_token + r * G`
  - `range_proof` (~675 B): Bulletproof for [1, 2^64)
  - `ephemeral_pubkey` (33 B): sender's ECDH ephemeral public key
  - `script` (variable): P2PKH or similar locking script
  - `token_data` (1 B): token index (matches `TxOutput.token_data`)

### FullShieldedOutput
- **Hides:** both amount and token type
- **Additional on-chain fields:**
  - `asset_commitment` (33 B): blinded generator `A = H_token + r_asset * G`
  - `surjection_proof` (~130 B): proves hidden token is in input token set
- Range proof embeds encrypted token UID + asset blinding

## 2. Creating Shielded Outputs

### 2.0 Blinding Factor Generation
- Must be valid secp256k1 scalars (non-zero, < curve order)
- Use library's `generate_random_blinding_factor()` exclusively (raw urandom may produce invalid scalars)

### 2.1 AmountShieldedOutput Creation
- Params: `value` (u64), `recipient_pubkey` (33 B), `token_uid` (32 B, HTR = all zeros), `value_blinding_factor` (32 B)
- Returns: `ephemeral_pubkey`, `commitment`, `range_proof` → on-chain; `value_blinding_factor` kept secret (needed for spending)

### 2.2 FullShieldedOutput Creation
- Additional param: `asset_blinding_factor` (32 B)
- Additional returns: `asset_commitment` → on-chain; `asset_blinding_factor` kept secret
- Naming: Rust `create_full_shielded_output`, Python `create_shielded_output_with_both_blindings`, TS `createShieldedOutputWithBothBlindings`

### 2.3 Blinding Factor Balance (Homomorphic Property)
- `Commit(a, r1) + Commit(b, r2) = Commit(a+b, r1+r2)`
- Requirement: `sum(input_vbf) = sum(output_vbf)` and `sum(input_gbf) = sum(output_gbf)`
- Practical approach: random blindings for all outputs except the last; compute last via `compute_balancing_blinding_factor(value, generator_blinding_factor, inputs, other_outputs)` where inputs/other_outputs are (value, vbf, gbf) triples
- Transparent entries: vbf = gbf = 32 zero bytes
- AmountShielded entries: gbf = zeros; FullShielded: actual abf

### 2.4 Full Unshield (Shielded Input → Transparent Outputs Only)
- No shielded output to absorb residual blinding → reveal excess scalar via `UnshieldBalanceHeader` (header id `0x13`)
- `excess = sum(input_vbf) - sum(output_vbf)`, 32-byte scalar, covered by sighash
- Mutually exclusive with `ShieldedOutputsHeader`
- Privacy: single shielded input → excess = that input's r (input already spent, no regression); multiple → only sum revealed
- Compute via `compute_balancing_blinding_factor(value=0, gbf=zeros, inputs=[shielded inputs], other_outputs=[all transparent entries incl. fees])`

## 3. Verifying Shielded Outputs

### Order
1. Point validation: `validate_commitment()` (33 B commitment), `validate_generator()` (asset commitment, FullShielded only) — reject non-curve points first
2. Range proof: value in [1, 2^64). Generator: AmountShielded → `derive_asset_tag(token_uid)` (unblinded); FullShielded → `output.asset_commitment` (blinded)
3. Surjection proof (FullShielded only): domain = transparent inputs' `derive_asset_tag(token_uid)` + shielded inputs' `asset_commitment`; codomain = output's `asset_commitment`
4. Balance: `sum(C_in) = sum(C_out)`; full unshield: `sum(C_in) = sum(C_out) + excess * G`

### verify_balance() inputs
- Transparent inputs: (amount, token_uid) pairs; shielded input commitments: 33-B points
- Transparent outputs: (amount, token_uid) pairs; shielded output commitments: 33-B points (empty for full unshield)
- `excess_blinding_factor` optional 32-B scalar

### Structural invariants (FFI-enforced)
1. excess present → shielded_outputs must be empty
2. excess present → at least one shielded input
3. excess must be exactly 32 bytes

### Transaction-layer invariants (node-enforced)
1. Full unshield must carry `UnshieldBalanceHeader`
2. Cannot carry both `UnshieldBalanceHeader` and `ShieldedOutputsHeader`
3. `UnshieldBalanceHeader` requires ≥1 shielded input

## 4. Rewinding (Recipient)

### 4.1 AmountShielded rewind
- Inputs: `private_key` (32 B), `ephemeral_pubkey`, `commitment`, `range_proof`, `token_uid` (known from token_data)
- Outputs: `value` (u64), `blinding_factor` (32 B, needed to spend)

### 4.2 FullShielded rewind
- Inputs: same + `asset_commitment` (used as generator)
- Additional outputs: `token_uid` (recovered from proof message), `asset_blinding_factor`

### 4.3 FullShielded token UID cross-check (MANDATORY)
- Threat: attacker can embed incorrect token_uid in range proof message
- Procedure: `expected_tag = derive_tag(recovered_token_uid)`; `expected_ac = create_asset_commitment(expected_tag, recovered_abf)`; assert `expected_ac == output.asset_commitment`
- `derive_tag()` → 32-B raw tag (surjection); `derive_asset_tag()` → 33-B unblinded generator (range proof); `create_asset_commitment()` → 33-B blinded generator

### 4.4 Rewind failure modes
- Wrong recipient: nonce derivation fails → error (expected during scanning); no false positives
- Corrupted on-chain data: error (not recoverable)

## 5. ECDH Internals
- `derive_ecdh_shared_secret(privkey, peer_pubkey)` → `SHA256(version || x-coord)` 32 B
- `derive_rewind_nonce(shared_secret)` → `SHA256("Hathor_CT_nonce_v1" || secret)` 32 B
- `rewind_range_proof(proof, commitment, nonce, generator)` → (value, blinding, message)
- `generate_ephemeral_keypair()` → (32 B priv, 33 B pub)

## 6. Cross-language bindings
- TS names: `createAmountShieldedOutput`, `createShieldedOutputWithBothBlindings`, `rewindAmountShieldedOutput`, `rewindFullShieldedOutput`
- TS fields: `blindingFactor`, `assetCommitment`, `assetBlindingFactor`
- TS transparent entries as objects `{ amount, tokenUid }`

## 7. Wire formats
| Value | Size | Notes |
|-------|------|-------|
| Private key / blinding factors / excess / shared secret / nonce / token UID / raw tag | 32 B | scalars/digests |
| Pubkeys / commitment / generator / asset tag / ephemeral pubkey | 33 B | compressed points |
| Range proof | ~675 B | hard max 1024 B buffer |
| Surjection proof | ~130 B | hard max 4096 B buffer |

## 8. Error handling
- Rewind failure with wrong key: expected, continue scanning
- Rewind failure on corrupted data: log and skip
- Invalid blinding factor (zero or ≥ order): use library generator
- Verification failures: return false/Err — reject

## 9. Key warnings
1. Blinding factors must be valid secp256k1 scalars — use library generator
2. Balance equation is strict per token type
3. FullShielded token UID cross-check is mandatory (spoofing threat)
4. Excess scalar reveals residual blinding factor (sum only for multiple inputs)
5. Full nodes must enforce the three transaction-layer invariants — not automatic from crypto verification
