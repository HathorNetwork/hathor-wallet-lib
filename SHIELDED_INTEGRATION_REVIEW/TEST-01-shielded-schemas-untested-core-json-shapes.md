# TEST-01: Shielded zod schemas have zero tests and are never exercised against the canonical hathor-core JSON shapes (required ephemeral_pubkey/decoded vs core omit-when-absent)

**Severity:** high - **Status:** confirmed by adversarial review

**Also reported as:** a second TEST-01 write-up (shielded zod schemas untested against core shapes) — merged here. Root-cause bug tracked as COMP-01.

## Summary

The new shielded zod schemas (`IHistoryShieldedOutputSchema`, the shielded variants of `IHistoryOutputSchema`, `fullnodeTxApiShieldedOutputSchema`, `fullnodeTxApiShieldedInputSchema`) are not referenced by a single test, and every existing test only replays JSON that wallet-lib itself produced. The schemas mark `ephemeral_pubkey` and `decoded` as required, but hathor-core omits both fields in consensus-valid cases (absent ephemeral pubkey, unparseable script). A third party — or an attacker spending one extra output to a victim address — can therefore craft a fully valid transaction that the wallet's schemas reject, causing the entire transaction (including its transparent outputs to the wallet) to be silently dropped on websocket sync, or a thrown error on stream sync. No test would catch this today, nor any future regression in these schemas.

## Location

- `src/schemas.ts:191-192` — `IHistoryShieldedOutputSchema` requires `ephemeral_pubkey` and `decoded`
- `src/schemas.ts:106` and `src/schemas.ts:116` — `AmountShieldedOutputSchema` / `FullShieldedOutputSchema` (inlined-output union members of `IHistoryOutputSchema`) require `ephemeral_pubkey`
- `src/api/schemas/txApi.ts:113-114` — `fullnodeTxApiShieldedOutputSchema` requires `ephemeral_pubkey` and `decoded`
- `src/api/schemas/txApi.ts:149` — dead `shielded_inputs` key that hathor-core never emits
- Consumers that fail: `src/new/wallet.ts:1736-1740` (`onNewTx` safeParse → silent drop), `src/sync/stream.ts:754` (`IHistoryTxSchema.parse` → throw mid stream-sync), `src/api/txApi.ts` (`transactionApiSchema` → `fullnodeTxApiTxSchema`)
- Test gap: nothing under `__tests__/` references any of these schemas

## Details

### 1. The schemas require fields hathor-core omits

`IHistoryShieldedOutputSchema` (`src/schemas.ts:174-197`):

```ts
const IHistoryShieldedOutputSchema = z
  .object({
    mode: z.number().optional(),
    commitment: z.string(),
    range_proof: z.string(),
    script: z.string(),
    token_data: z.number().optional().default(0),
    ephemeral_pubkey: z.string(),          // REQUIRED — core omits when absent
    decoded: IHistoryOutputDecodedSchema,  // REQUIRED — core omits when script unparseable
    ...
```

The same pattern repeats in the two shielded branches of `IHistoryOutputSchema` (`src/schemas.ts:106`, `src/schemas.ts:116` — `ephemeral_pubkey: z.string()` required in both `AmountShieldedOutputSchema` and `FullShieldedOutputSchema`) and in `fullnodeTxApiShieldedOutputSchema` (`src/api/schemas/txApi.ts:113-114`). Notably, the integration authors *did* make `mode` and `token_data` optional with explanatory comments about node-version skew — but left `ephemeral_pubkey` and `decoded` required, with no test that would have surfaced the mismatch.

### 2. Both parse paths consume the core shapes that omit these fields

- **WebSocket sync:** `HathorWallet.onNewTx` (`src/new/wallet.ts:1736-1740`) runs `IHistoryTxSchema.safeParse(wsData.history)` and on failure logs and `return`s — the entire transaction is silently discarded. Shielded entries arrive *inlined into `outputs[]`* (core `to_json_extended`), so an output with the missing field fails all three branches of the `IHistoryOutputSchema` union; `normalizeShieldedOutputs` (`src/new/wallet.ts:1745`) runs only *after* the parse and cannot rescue it.
- **Stream sync:** `src/sync/stream.ts:754` uses bare `IHistoryTxSchema.parse(wsData.data)`, which throws inside the websocket listener mid-stream.
- **Transaction API:** `txApi.getTransaction` validates against `transactionApiSchema` → `fullnodeTxApiTxSchema` (`src/api/schemas/txApi.ts:132-155`, used at `src/api/txApi.ts`), hitting the same required `ephemeral_pubkey`/`decoded` in `fullnodeTxApiShieldedOutputSchema`.

### 3. Dead `shielded_inputs` schema member

`fullnodeTxApiTxSchema` declares `shielded_inputs: fullnodeTxApiShieldedInputSchema.array().nullish()` (`src/api/schemas/txApi.ts:149`). hathor-core never emits a top-level `shielded_inputs` key: inputs that spend shielded outputs are inlined into `inputs[]` (see Source of truth). The key is `.nullish()` so it is harmless at runtime, but it is dead code that cannot be exercised by any real fixture — and, like everything else here, it is unpinned by tests.

### 4. Zero test coverage

```
grep -rE "IHistoryTxSchema|fullnodeTxApi|IHistoryOutputSchema|IHistoryShieldedOutputSchema" __tests__
→ no matches
```

The only shielded history fixtures (`__tests__/new/hathorwallet.test.ts:940-997`) hardcode `ephemeral_pubkey: ''` plus a `decoded` block and cast `as unknown as IHistoryTx`, bypassing zod entirely. Integration tests (`__tests__/integration/shielded_outputs/`) only replay shapes wallet-lib itself produced — wallet-lib always sets an ephemeral pubkey and always uses standard P2PKH scripts, so the omit-when-absent variants are never exercised. The closest case, `__tests__/integration/shielded_outputs/crypto_failures.test.ts` (test J.41), feeds a *present* `'00'.repeat(33)` string — which passes `z.string()` — never the omitted-key shape core canonically emits. `__tests__/shielded/processing.test.ts:125` covers a missing `decoded` only at the post-parse processing layer, after the schema has already rejected the tx.

## Source of truth

- **Core omits `ephemeral_pubkey` and `decoded` when absent** — hathor-core:hathor/transaction/base_transaction.py:101-102 (`if output.ephemeral_pubkey: data['ephemeral_pubkey'] = ...`) and :108-112 (`decoded` only emitted when `decode_script` AND `parse_address_script(output.script)` returns truthy).
- **Absent ephemeral pubkey is consensus-valid** — hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:103-104 (serializes 33 zero bytes when not present) and :158-166 (33 zero bytes deserialize back to empty/absent); hathor-core:hathor/verification/transaction_verifier.py:787-797 validates the pubkey only `if output.ephemeral_pubkey` — a tx with the field absent passes full verification.
- **These shapes reach the wallet's parse paths** — shielded outputs are inlined into `outputs[]` in `to_json_extended` (hathor-core:hathor/transaction/base_transaction.py:888-896), which feeds the websocket history payloads parsed by `IHistoryTxSchema`; the `/transaction` resource serializes with `tx.to_json(decode_script=True)` (hathor-core:hathor/transaction/resources/transaction.py:62), feeding `fullnodeTxApiTxSchema` with top-level `shielded_outputs` built by the same `_shielded_output_to_json`.
- **No top-level `shielded_inputs` exists in core** — spent shielded outputs are inlined into `inputs[]` both in the `/transaction` resource (hathor-core:hathor/transaction/resources/transaction.py:97-105) and in `to_json_extended` (hathor-core:hathor/transaction/base_transaction.py:862-880); no core code emits a `shielded_inputs` key.
- The client integration guide checklist (SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md) requires clients to handle every endpoint variant of the shielded JSON shapes, including outputs without ephemeral pubkeys and the minimal vs. full shielded-input shapes.

## Impact

A consensus-valid transaction containing one shielded output with an absent ephemeral pubkey (or any non-standard/unparseable script) fails schema validation in its entirety. Concrete griefing scenario: an attacker builds a valid tx that (a) pays 100 HTR to a victim's transparent address and (b) includes one shielded output with the ephemeral pubkey omitted. The fullnode accepts and propagates it; the victim's wallet:

- on **websocket sync** silently drops the whole tx (`src/new/wallet.ts:1737-1740`) — the 100 HTR payment never appears in history or balance, with only a log line as evidence; wallet state diverges from chain state;
- on **stream sync** throws from `IHistoryTxSchema.parse` (`src/sync/stream.ts:754`) inside the websocket listener, breaking the history load;
- via **txApi.getTransaction** fails `transactionApiSchema` validation for the same tx.

This costs the attacker only the dust value of one shielded output, and applies equally to honest third-party wallets that legitimately omit the ephemeral pubkey (an allowed mode for senders that deliver blinding data out-of-band). Because there is zero test coverage of these schemas, neither the current bug nor any future schema regression is detectable by CI.

## Recommendation

1. **Fix the schemas to match core's omit-when-absent behavior:**
   - `ephemeral_pubkey: z.string().optional()` in `src/schemas.ts:106`, `:116`, `:191` and `src/api/schemas/txApi.ts:113`;
   - `decoded: IHistoryOutputDecodedSchema.optional()` in `src/schemas.ts:192` and the equivalent in `src/api/schemas/txApi.ts:114`;
   - audit downstream consumers (`normalizeShieldedOutputs`, `src/shielded/processing.ts`, `src/utils/storage.ts`) to treat the now-optional fields as "not recoverable via ECDH" / "no decoded address" rather than assuming presence.
2. **Delete `shielded_inputs` from `fullnodeTxApiTxSchema`** (`src/api/schemas/txApi.ts:149`) or add a comment citing the core endpoint that would emit it (none currently does — spent shielded outputs arrive inlined in `inputs[]`).
3. **Add unit fixture tests that parse the exact JSON hathor-core emits**, one per variant from the integration guide:
   - shielded output WITHOUT `ephemeral_pubkey` (omitted key, not empty string);
   - shielded output WITHOUT `decoded` (unparseable script);
   - `to_json_extended` minimal shielded-input shape inlined in `inputs[]` (hex script, no mode/range_proof — see hathor-core:hathor/transaction/base_transaction.py:865-873);
   - `get_tx_extra_data` full shielded-input shape inlined in `inputs[]` (hathor-core:hathor/transaction/resources/transaction.py:97-105);
   - mode-less outputs from pre-`mode` nodes (already accepted; pin with a test).
   Assert `IHistoryTxSchema`, `IHistoryOutputSchema`, and `transactionApiSchema` all accept them.
4. **Add one integration test** that injects an absent-ephemeral-pubkey shielded output via `onNewTx` alongside a transparent output to the wallet, and asserts the tx is stored (not dropped) with the transparent output credited and no shielded credit.

## Verification notes

Three independent skeptic passes confirmed every sub-claim:

- **Required-field mismatch:** verified at `src/schemas.ts:106,116,191-192` and `src/api/schemas/txApi.ts:113-114` against hathor-core:hathor/transaction/base_transaction.py:101-102,108-112. The diff shows the authors deliberately relaxed `mode`/`token_data` (with comments) but left `ephemeral_pubkey`/`decoded` required — strong evidence the omit-when-absent variants were never run against the schemas.
- **Consensus validity of the failing shape:** hathorlib treats 33 zero bytes as "not present" on (de)serialization (shielded_tx_output.py:103-104,158-166) and the verifier validates the pubkey only when present (transaction_verifier.py:787) — so the rejected tx is fully valid on-chain.
- **Failure modes real:** `safeParse` → silent drop confirmed at `src/new/wallet.ts:1736-1740` (normalization at :1745 runs post-parse); bare `.parse` throw confirmed at `src/sync/stream.ts:754`; txApi path confirmed via `transactionApiSchema` → `fullnodeTxApiTxSchema`.
- **Test absence:** grep over `__tests__/` for the schema names returns zero matches; the only indirect exercise (crypto_failures.test.ts calling `onNewTx`) uses a present `'00'.repeat(33)` pubkey string that passes `z.string()`, never the omitted-key shape; unit fixtures bypass zod with `as unknown as IHistoryTx`.
- **Dead `shielded_inputs`:** confirmed no core code emits the key; spent shielded outputs are inlined in `inputs[]` in both serialization paths.
- Minor nuance noted by one reviewer: the reviewed core version emits `mode` unconditionally, so the wallet's `mode: optional` is forward-compat only — no impact on this finding. Severity high upheld (one reviewer noted medium defensible): cheap, repeatable griefing vector causing silent loss of legitimate payments from history/balance plus stream-sync breakage, with zero regression coverage.

## Evidence folded from the duplicate write-up

- The closest existing fixture proves the gap: `__tests__/new/hathorwallet.test.ts:979,994` bypasses zod entirely via `as unknown as IHistoryTx` and uses `ephemeral_pubkey: ''` — a key-present shape hathor-core never emits — so even the nearest test exercises a wire shape the node cannot produce.
