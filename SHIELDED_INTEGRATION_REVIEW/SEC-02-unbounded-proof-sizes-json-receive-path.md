# SEC-02: No upper bound on range_proof / surjection_proof / script sizes on the JSON receive path before native crypto calls

**Severity:** low - **Status:** confirmed by adversarial review

**Also reported as:** a second SEC-02 write-up (unbounded proof sizes on JSON path) — duplicate deleted; the canonical write-up is a superset (adds the missing `.max(MAX_SHIELDED_OUTPUTS)` array cap at `src/schemas.ts:215` and the persistence path).

## Summary

The binary wire deserializer for shielded outputs enforces the same size caps as hathor-core (range proof ≤ 3328 bytes, script ≤ 1024 bytes, surjection proof ≤ 4096 bytes) before reading any variable-length field. However, the wallet's primary receive path is JSON from the fullnode, validated by zod schemas where `range_proof`, `surjection_proof`, `script`, `commitment`, `ephemeral_pubkey`, and `asset_commitment` are plain `z.string()` with no `.max()` bound and no hex-format check. These unbounded strings are hex-decoded into Buffers and handed directly to the native ct-crypto provider, and are also persisted into wallet storage. A malicious or compromised fullnode can ship multi-megabyte "proof" strings across up to 32 shielded outputs per transaction, forcing large allocations before any layer rejects them.

## Location

- `src/schemas.ts:101-120` — `AmountShieldedOutputSchema` / `FullShieldedOutputSchema`: all shielded byte fields are unbounded `z.string()`
- `src/schemas.ts:174-197` — `IHistoryShieldedOutputSchema`: same, including `script: z.string()`
- `src/schemas.ts:215` — `shielded_outputs: IHistoryShieldedOutputSchema.array().optional()` has no `.max(MAX_SHIELDED_OUTPUTS)` cap
- `src/api/schemas/txApi.ts:96-124` — `fullnodeTxApiShieldedOutputSchema`: identical unbounded strings on the tx-API path
- `src/shielded/processing.ts:122-124, 143-150, 189-195` — decoded Buffers passed to native `rewindFullShieldedOutput` / `rewindAmountShieldedOutput` without size checks
- `src/utils/storage.ts:963-1008` — JSON history path that invokes `processShieldedOutputs` and persists `range_proof` / `surjection_proof` into stored tx outputs
- Contrast (bounds enforced): `src/models/shielded_output.ts:175-176, 187-190, 218-221`; constants at `src/constants.ts:248-266`

## Details

The wallet has two ways to ingest a shielded output:

**1. The binary wire path** (`ShieldedOutput.deserialize`) is properly hardened. It checks each length prefix against the protocol caps before slicing, mirroring hathor-core byte for byte:

```ts
// src/models/shielded_output.ts:174-176
// hathor-core validation: range proof size cannot exceed MAX_RANGE_PROOF_SIZE.
if (rpLen > MAX_RANGE_PROOF_SIZE)
  throw new Error(`range proof size ${rpLen} exceeds maximum ${MAX_RANGE_PROOF_SIZE}`);
```

with equivalent checks for the script (`scriptLen > MAX_SHIELDED_OUTPUT_SCRIPT_SIZE`, lines 187-190) and the surjection proof (`spLen > MAX_SURJECTION_PROOF_SIZE`, lines 218-221). The constants come from `src/constants.ts:254` (`MAX_RANGE_PROOF_SIZE = 3328`), `:260` (`MAX_SURJECTION_PROOF_SIZE = 4096`), `:266` (`MAX_SHIELDED_OUTPUT_SCRIPT_SIZE = 1024`), and `:248` (`MAX_SHIELDED_OUTPUTS = 32`).

**2. The JSON path** — the one actually used during history sync and websocket tx events — has no such bounds. The history schema accepts arbitrary-length strings:

```ts
// src/schemas.ts:183-194 (IHistoryShieldedOutputSchema, excerpt)
commitment: z.string(),
range_proof: z.string(),
script: z.string(),
...
ephemeral_pubkey: z.string(),
decoded: IHistoryOutputDecodedSchema,
asset_commitment: z.string().optional(),
surjection_proof: z.string().optional(),
```

The same shape (also unbounded) appears in `AmountShieldedOutputSchema` / `FullShieldedOutputSchema` at `src/schemas.ts:101-120` and in `fullnodeTxApiShieldedOutputSchema` at `src/api/schemas/txApi.ts:96-124`. Additionally, the `shielded_outputs` array itself (`src/schemas.ts:215`) has no `.max(32)` even though `MAX_SHIELDED_OUTPUTS = 32` exists in `src/constants.ts:248`.

After schema validation, `processShieldedOutputs` decodes the strings and calls straight into the native provider:

```ts
// src/shielded/processing.ts:122-124
const ephPk = Buffer.from(shieldedOutput.ephemeral_pubkey, 'hex');
const commitment = Buffer.from(shieldedOutput.commitment, 'hex');
const rangeProof = Buffer.from(shieldedOutput.range_proof, 'hex');
```

and then (`src/shielded/processing.ts:144-150` / `:189-195`) passes `rangeProof` (and `assetCommitment`) into `cryptoProvider.rewindFullShieldedOutput(...)` or `rewindAmountShieldedOutput(...)` with no length validation in between. There is no other mitigation: a repo-wide search shows `MAX_RANGE_PROOF_SIZE` / `MAX_SURJECTION_PROOF_SIZE` are referenced only in the wire deserializer (`src/models/shielded_output.ts`).

The ct-crypto Rust layer does not impose an early size cap either. `deserialize_range_proof` (`hathor-ct-crypto/src/rangeproof.rs:143-147`) just forwards to `RangeProof::from_slice`, and a test comment (`rangeproof.rs:~298-302`) explicitly states that size enforcement is delegated to the fullnode deserializer — i.e., the Rust library assumes its caller has already bounded the input.

Finally, the oversized strings are not transient: `src/utils/storage.ts:1000-1004` copies `commitment`, `range_proof`, `ephemeral_pubkey`, `asset_commitment`, and `surjection_proof` into the decoded output entry that is persisted via `store.saveTx(tx)` (`:1011`), so attacker-sized blobs would also bloat wallet storage.

## Source of truth

hathor-core enforces these caps on every deserialization, defined canonically in hathorlib:

- hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:24-27 — `MAX_RANGE_PROOF_SIZE = 3328`, `MAX_SURJECTION_PROOF_SIZE = 4096`, `MAX_SHIELDED_OUTPUTS = 32`, `MAX_SHIELDED_OUTPUT_SCRIPT_SIZE = 1024`
- hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:130-132 — rejects `rp_len > MAX_RANGE_PROOF_SIZE`
- hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:143-145 — rejects `script_len > MAX_SHIELDED_OUTPUT_SCRIPT_SIZE`
- hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:186-188 — rejects `sp_len > MAX_SURJECTION_PROOF_SIZE`
- hathor-core:hathor/transaction/shielded_tx_output.py:27-43 re-exports these as the constants the rest of core uses.
- ct-crypto: hathor-core:hathor-ct-crypto/src/rangeproof.rs:143-147 has no internal size cap; its own test (`test_proof_size_fits_fullnode_cap`, rangeproof.rs:~296-302) documents that the size limit is the deserializer's responsibility — meaning a client that skips the bound check provides no defense at all before native code runs.

The wallet's own wire deserializer (`src/models/shielded_output.ts`) and `src/constants.ts:248-266` (whose comments say "Mirrors hathor-core's ...") show the intended behavior; the JSON path simply was never given the same treatment.

## Impact

A compromised or malicious fullnode (or a MITM where TLS is absent/unpinned) responding to history sync or pushing websocket tx events can attach up to 32 shielded outputs per transaction, each carrying multi-megabyte `range_proof` / `surjection_proof` / `script` hex strings. The wallet will:

1. Accept them through zod validation (no `.max()`),
2. Hex-decode each into a Buffer (string + Buffer + native-copy ≈ 2-3x amplification of attacker-transmitted bytes),
3. Hand the oversized buffer to the native ct-crypto layer, which only fails deep inside `RangeProof::from_slice`,
4. Persist the oversized strings into wallet storage via `saveTx`.

Repeated across many fake transactions this is a cheap memory/storage-amplification vector against the wallet process — particularly relevant for the mobile wallet, where memory headroom is small. Severity is low because the attacker must already control the wallet's own fullnode connection (a highly trusted position), and the amplification factor is modest; but it is a real hardening gap that is inconsistent with both the wallet's own wire path and hathor-core.

## Recommendation

Bound the shielded byte fields at the schema layer, reusing the existing constants. Hex strings need `2 * max_bytes` characters; fixed-size fields (commitment, ephemeral_pubkey, asset_commitment = 33 bytes) can be exact:

```ts
import { MAX_RANGE_PROOF_SIZE, MAX_SURJECTION_PROOF_SIZE,
         MAX_SHIELDED_OUTPUT_SCRIPT_SIZE, MAX_SHIELDED_OUTPUTS } from './constants';

const hexString = (maxBytes: number) =>
  z.string().regex(/^[a-fA-F0-9]*$/).max(2 * maxBytes);

// in IHistoryShieldedOutputSchema / fullnodeTxApiShieldedOutputSchema:
commitment: hexString(33),
range_proof: hexString(MAX_RANGE_PROOF_SIZE),
script: hexString(MAX_SHIELDED_OUTPUT_SCRIPT_SIZE),
ephemeral_pubkey: hexString(33),
asset_commitment: hexString(33).optional(),
surjection_proof: hexString(MAX_SURJECTION_PROOF_SIZE).optional(),

// and on the tx schema:
shielded_outputs: IHistoryShieldedOutputSchema.array().max(MAX_SHIELDED_OUTPUTS).optional(),
```

Apply the same bounds in `src/schemas.ts` (both the `IHistoryOutput` union members at :101-120 and `IHistoryShieldedOutputSchema` at :174-197) and `src/api/schemas/txApi.ts:96-124`. As defense in depth (or as a minimal alternative if schema changes are deemed too strict for forward compatibility), length-check the decoded Buffers in `processShieldedOutputs` (`src/shielded/processing.ts:122-124`) before invoking the crypto provider, skipping the output with a logged warning when a field exceeds its cap — mirroring the wire-deserializer behavior.

## Verification notes

The skeptic panel confirmed each link in the chain independently:

1. **Unbounded JSON schemas:** verified `src/schemas.ts:101-120` and `:174-197`, plus `src/api/schemas/txApi.ts:96-124` — every shielded byte field is plain `z.string()` with neither `.max()` nor a hex regex; the `shielded_outputs` array at `src/schemas.ts:215` also lacks `.max(32)` despite `MAX_SHIELDED_OUTPUTS` existing in `src/constants.ts:248`.
2. **Unchecked decode-to-native:** verified `src/shielded/processing.ts:122-124` (`Buffer.from(..., 'hex')`) flows into `rewindFullShieldedOutput` (:144) / `rewindAmountShieldedOutput` (:189) with no intermediate size check, reachable from the JSON history path at `src/utils/storage.ts:963`.
3. **Wire-path contrast:** verified `src/models/shielded_output.ts:175-176, 187-190, 218-221` enforce exactly the hathor-core caps (hathorlib shielded_tx_output.py:24-27, 130-145, 186-188), proving the bounds were intentional and the JSON path is the gap.
4. **No downstream mitigation:** repo-wide grep shows the size constants are used only in the wire deserializer; ct-crypto's `deserialize_range_proof` (rangeproof.rs:143-147) has no early cap, and its test comment explicitly delegates size enforcement to the deserializer. Oversized strings are also persisted (`src/utils/storage.ts:1000-1011`).
5. **Severity calibration:** the attacker must be the wallet's own fullnode or an on-path MITM — already a highly trusted position — and amplification is roughly 2-3x of transmitted bytes, so low severity is appropriate; the finding stands as a hardening-consistency gap rather than a remotely triggerable DoS.
