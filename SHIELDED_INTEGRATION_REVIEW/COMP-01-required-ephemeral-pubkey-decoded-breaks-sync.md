# COMP-01: Wallet schemas require ephemeral_pubkey/decoded keys that hathor-core legitimately omits — consensus-valid shielded txs become unparseable and break sync

**Severity:** high - **Status:** confirmed by adversarial review

**Also reported as:** WIRE-01 (Zod schemas require `ephemeral_pubkey` ... remote-triggerable sync break) and WIRE-02 (`decoded` required on shielded outputs in the tx-API schema) — both merged here; unique evidence folded into the section below. Related test-coverage gap: TEST-01.

## Summary

hathor-core treats an all-zeros (33-byte) `ephemeral_pubkey` as "absent" and omits the JSON key entirely when serializing a shielded output; it likewise omits `decoded` whenever the output script does not parse as a standard address script. Both shapes are fully consensus-valid and can be crafted by any third party (core's own tooling produces keyless outputs). Wallet-lib's zod schemas make these keys **required**, so a single such output anywhere in a transaction makes the whole transaction unparseable — and because every sync path (websocket real-time, polling history, stream sync, `/transaction` fetch) gates on these schemas, an attacker can permanently break a victim wallet's sync (and hide funds paid to it in the same tx) by sending one cheap transaction.

## Location

- `src/schemas.ts:101-126` — `AmountShieldedOutputSchema` (`ephemeral_pubkey` required at :106) and `FullShieldedOutputSchema` (:116), both members of the `outputs[]` union `IHistoryOutputSchema` (:122-126)
- `src/schemas.ts:174-197` — `IHistoryShieldedOutputSchema`: `ephemeral_pubkey` required at :191, `decoded` required at :192
- `src/api/schemas/txApi.ts:96-124` — `fullnodeTxApiShieldedOutputSchema`: `ephemeral_pubkey` required at :113, `decoded` required at :114; wired into `transactionApiSchema` at :150
- `src/shielded/types.ts:48` — `IShieldedOutput.ephemeral_pubkey: string` (non-optional)
- `src/shielded/processing.ts:122` — `Buffer.from(shieldedOutput.ephemeral_pubkey, 'hex')` outside the per-output `try` at :133
- Consumers that fail: `src/new/wallet.ts:1736-1740`, `src/api/wallet.ts:44-47,86-89`, `src/sync/stream.ts:754`, `src/utils/transaction.ts:1104-1117`

## Details

### What the wallet requires

All four shielded-output schemas treat `ephemeral_pubkey` as required, and two of them also require `decoded`:

```ts
// src/schemas.ts:101-120 — the outputs[] union shapes
const AmountShieldedOutputSchema = z.object({
    type: z.string(),
    commitment: z.string(),
    range_proof: z.string(),
    ephemeral_pubkey: z.string(),   // :106 — required
    token_data: z.number(),
  }).passthrough();

const FullShieldedOutputSchema = z.object({
    ...
    ephemeral_pubkey: z.string(),   // :116 — required
    ...
  }).passthrough();
```

```ts
// src/schemas.ts:191-192 — IHistoryShieldedOutputSchema (shielded_outputs[])
    ephemeral_pubkey: z.string(),
    decoded: IHistoryOutputDecodedSchema,
```

```ts
// src/api/schemas/txApi.ts:113-114 — fullnodeTxApiShieldedOutputSchema
    ephemeral_pubkey: z.string(), // hex, 33 bytes; used for ECDH decryption
    decoded: shieldedDecodedSchema,
```

A keyless shielded entry in `outputs[]` fails **all three** members of `IHistoryOutputSchema` (`src/schemas.ts:122-126`): it cannot match `TransparentOutputSchema` (no `value`/`token`, :90-98), and both shielded members require `ephemeral_pubkey`. Therefore the parent `IHistoryTxSchema` fails for the entire transaction. There is no preprocessing, `.default()`, or `.optional()` anywhere that rescues the absent keys before the schema gate — `normalizeShieldedOutputs` (with its `?? ''` fallbacks) runs only *after* a successful parse (`src/new/wallet.ts:1745`), and the only fallback found (`src/utils/storage.ts:1002`) is also post-parse.

### Every sync path gates on these schemas

1. **Websocket real-time** — `src/new/wallet.ts:1736-1740`:
   ```ts
   const parseResult = IHistoryTxSchema.safeParse(wsData.history);
   if (!parseResult.success) {
     this.logger.error(parseResult.error);
     return;   // entire tx silently dropped
   }
   ```
   The drop includes any **transparent** outputs in the same tx that pay the wallet.

2. **Polling history sync** — `src/api/wallet.ts:44-47` and :86-89 apply `addressHistorySchema` (which is `IHistoryTxSchema.array()`, `src/api/schemas/wallet.ts:16`) as an axios `transformResponse`. The parse helper throws on failure, so one poisoned tx in the wallet's address history makes **every load of that history page** fail, on every sync, forever (the tx never leaves the history).

3. **Stream sync** — `src/sync/stream.ts:754`: `IHistoryTxSchema.parse(wsData.data)` throws, aborting vertex processing.

4. **Input resolution via `/transaction`** — `src/utils/transaction.ts:1104-1117` fetches spent txs through `txApi.getTransaction`, whose `transformResponse` applies `transactionApiSchema` → `fullnodeTxApiShieldedOutputSchema`; this shape additionally requires `decoded`, so it also rejects script-unparseable shielded outputs.

### Secondary issue in the decryption loop

Even if the schemas were relaxed, `src/shielded/processing.ts` would still misbehave: the `Buffer.from(shieldedOutput.ephemeral_pubkey, 'hex')` call at :122 sits **outside** the per-output `try` that starts at :133, so a single output with a missing/garbage key would throw out of the whole loop and abort decryption of every other shielded output in the tx. (This is partially mitigated today by the `decoded?.address` guard at :106-107, which skips script-unparseable outputs before reaching :122 — but a keyless output *with* a parseable script would not be skipped.)

## Source of truth

hathor-core omits both keys for legitimate, consensus-valid outputs:

- **Serializer omits the keys** — hathor-core:hathor/transaction/base_transaction.py:101-102:
  ```python
  if output.ephemeral_pubkey:
      data['ephemeral_pubkey'] = output.ephemeral_pubkey.hex()
  ```
  and :108-112: `decoded` is emitted only when `parse_address_script(output.script)` succeeds. This single serializer (`_shielded_output_to_json`, used by `to_json` at :818 and `to_json_extended` at :891) feeds **all** wallet-consumed endpoints: hathor-core:hathor/p2p/resources/../thin_wallet/address_history.py:262 (polling), hathor-core:hathor/websocket/factory.py:215 (WS real-time), hathor-core:hathor/websocket/streamer.py:300 (stream sync), hathor-core:hathor/transaction/resources/transaction.py:101 (`/transaction`).

- **All-zeros pubkey means "absent" and is consensus-valid** — hathor-core:hathorlib/hathorlib/transaction/shielded_tx_output.py:158-166:
  ```python
  ephemeral_pubkey = b'' if raw_ephemeral == b'\x00' * EPHEMERAL_PUBKEY_SIZE else raw_ephemeral
  ```
  and the verifier validates the pubkey **only when present** — hathor-core:hathor/verification/transaction_verifier.py:787-798 (`if output.ephemeral_pubkey:`). No verification rule requires the shielded script to parse as an address script.

- **Core itself produces and tolerates keyless outputs** — hathor-core:hathor/dag_builder/vertex_exporter.py:573 sets `ephemeral_pubkey=b''`; core's own wallet skips them gracefully (hathor-core:hathor/wallet/base_wallet.py:696-697), confirming skip-not-reject is the intended client behavior.

## Impact

Any third party can craft a consensus-valid transaction containing one shielded output with a zeroed ephemeral pubkey (or a non-standard script, for the `/transaction` path) **and** a transparent output paying a victim wallet's address. The fullnode accepts and propagates it. The victim wallet then:

- silently drops the tx on the websocket path (missed funds — the transparent payment never appears);
- fails the polling history page containing it on every sync attempt thereafter — a persistent, unrecoverable-by-the-user sync failure, since the tx stays in the address history forever;
- throws during stream sync and during input resolution if the poisoned tx is ever referenced.

No funds or keys are compromised (the wallet can be fixed by a schema change and a resync), which keeps this at high rather than critical.

## Recommendation

1. Make `ephemeral_pubkey` optional (e.g. `z.string().optional().default('')`) and `decoded` optional in all four schemas: `src/schemas.ts:101-126` (both union members), `src/schemas.ts:174-197` (`IHistoryShieldedOutputSchema`), and `src/api/schemas/txApi.ts:96-124`. Mirror this in `IShieldedOutput` (`src/shielded/types.ts:48`: `ephemeral_pubkey?: string`) and `decoded?`.
2. In `src/shielded/processing.ts`, explicitly `continue` on outputs with an empty/absent `ephemeral_pubkey` (they are unrecoverable by design — there is nothing to ECDH against), and move the `Buffer.from(...)` hex decoding (:122-124) inside the per-output `try` (:133) so one malformed output cannot abort decryption of the remaining outputs.
3. Audit downstream consumers of the parsed shapes (e.g. `normalizeShieldedOutputs` in `src/utils/transaction.ts`) for assumptions that the fields are present, keeping the existing `?? ''` fallbacks.
4. Add regression tests feeding a tx that contains (a) a keyless shielded output and (b) a script-unparseable shielded output, alongside a transparent output paying the wallet, through the WS path (`onNewTx`), the polling path (`addressHistorySchema`), the stream path, and the `txApi` `/transaction` path, asserting the tx parses and the transparent funds are credited.

## Verification notes

Three independent adversarial passes confirmed every material claim against both codebases:

- Core side: serializer omission (base_transaction.py:101-102, :108-112), zeros-means-absent deserialization (hathorlib shielded_tx_output.py:158-166, with serialization of absent as zeros at :103-104), verifier accepting absent pubkeys (transaction_verifier.py:787-798) and imposing no script-parse rule, and that all four wallet-consumed endpoints flow through this one serializer. One verifier additionally found core *itself* emits keyless outputs (dag_builder/vertex_exporter.py:573) and core's wallet skips them (base_wallet.py:696-697), strengthening the finding.
- Wallet side: required keys at the exact cited lines; that a keyless entry matches no member of the `outputs[]` union, failing the whole `IHistoryTxSchema`; that all four consumer paths gate on the schemas with no pre-parse normalization (grep of every `ephemeral_pubkey` site found only post-parse fallbacks); and that `processing.ts:122` is outside the `try` at :133.
- One precision note from the panel: missing `decoded` **alone** breaks only the `/transaction` (`txApi`) and `shielded_outputs[]` (`IHistoryShieldedOutputSchema`) shapes — the `outputs[]` union members at `src/schemas.ts:101-120` do not require `decoded` — whereas missing `ephemeral_pubkey` breaks all paths. The recommendation covers both.
- Severity high (not critical) agreed: cheaply attacker-triggerable persistent sync failure and missed-funds visibility, but no key or fund compromise, and fully recoverable once schemas are relaxed.

## Evidence folded from WIRE-01 / WIRE-02 (merged duplicates)

- **WIRE-01 — stream-sync failure is a *persistent* DoS, not just an aborted vertex.** The `IHistoryTxSchema.parse(wsData.data)` at `src/sync/stream.ts:754` throws inside a WebSocket listener with no catch; the sync promise never resolves, the wallet is stuck in SYNCING, and it re-stalls on every reconnect. The required field is also baked into the TypeScript types (`src/types.ts:271,349`).
- **WIRE-02 — missing-`decoded` blast radius.** `getFullTxById`/`getTxById` (`src/new/wallet.ts:3244,3391`) throw a `ZodError` via the schema-validating transform (`src/api/txApi.ts:38,86`; `parseSchema` throws at `src/utils/bigint.ts:86-93`); spent-tx resolution in `convertTransactionToHistoryTx` (`src/utils/transaction.ts:1104-1117`) is invoked from the wallet's own send flow (`src/new/sendTransaction.ts:841`), so a wallet that merely processes a tx spending from an odd-script shielded tx is blocked. Note `src/shielded/processing.ts:106` already null-guards `decoded?.address`, confirming optional is the intended downstream shape.
