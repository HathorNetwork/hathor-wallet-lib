# SEC-01: Shielded value blinding factors and recovered plaintext amounts persisted unencrypted, unlike all other wallet key material

**Severity:** high - **Status:** confirmed by adversarial review

**Also reported as:** STATE-05 (decrypted values and blinding factors persisted in plaintext) and CRY-02 (blinding factors plaintext while spend keys are PIN-encrypted) — merged here. Previously tracked in TODO_FIX_38_BLINDING_FACTORS_PLAINTEXT_STORAGE.md (earlier PR-stack review; file since removed from the repo root).

## Summary

When the wallet decrypts (rewinds) a shielded output it belongs to, it permanently stores the recovered plaintext amount, the value blinding factor and, for FullShielded outputs, the asset blinding factor as raw hex/bigint in both the transaction-history record and the UTXO record. Every other wallet secret — main, account, auth, and the new shielded scan/spend xprivs — is PIN-encrypted with `encryptData` before persistence; blinding factors get no protection at all. A blinding factor combined with the public on-chain Pedersen commitment is a full commitment opening, so any reader of the wallet store can not only see the confidential amount but cryptographically *prove* it to a third party and link it on-chain, defeating the amount-confidentiality the shielded feature exists to provide.

## Location

- src/utils/storage.ts:985-1008 — decoded shielded entry built with plaintext `value` (:987), `blindingFactor` (:1005), `assetBlindingFactor` (:1006)
- src/utils/storage.ts:1011 — `await store.saveTx(tx)` persists the entry on the history tx
- src/utils/storage.ts:1131-1148 — `store.saveUtxo({ ... shielded: true, blindingFactor, assetBlindingFactor })` (:1141-1146)
- src/utils/storage.ts:700-717 — second `saveUtxo` persistence site (re-delivery/recovery path), same plaintext spread at :710-715
- src/types.ts:352-353 — `IShieldedOutputEntry.blindingFactor` / `assetBlindingFactor` declared as plain hex strings ("hex, 32 bytes")
- src/types.ts:472-474 — `IUtxo.shielded` / `blindingFactor` / `assetBlindingFactor`, plain hex
- src/new/wallet.ts:1093-1095 — `getTx()` returns the stored `IHistoryTx` verbatim, openings included
- Contrast (key material that IS encrypted): src/utils/wallet.ts:620, 631, 636, 642-644; decrypted on use in src/storage/storage.ts:948, 964, 976, 988

## Details

### The persistence path

After rewinding a shielded output, `processSingleTxUtil` appends a decoded entry to `tx.outputs` and saves it:

```ts
// src/utils/storage.ts:985-1011
tx.outputs.push({
  type: 'shielded',
  value: result.decrypted.value,                                        // :987 — plaintext amount
  ...
  blindingFactor: result.decrypted.blindingFactor.toString('hex'),       // :1005 — raw hex
  assetBlindingFactor: result.decrypted.assetBlindingFactor?.toString('hex'), // :1006 — raw hex
  onChainIndex: result.index,
} as IShieldedOutputEntry & { onChainIndex: number });
...
await store.saveTx(tx);                                                  // :1011
```

The same secrets are duplicated into the UTXO store:

```ts
// src/utils/storage.ts:1131-1148
await store.saveUtxo({
  txId: tx.tx_id,
  index: utxoIndex,
  ...
  ...(isShielded
    ? {
        shielded: true,
        blindingFactor: (output as IShieldedOutputEntry).blindingFactor,
        assetBlindingFactor: (output as IShieldedOutputEntry).assetBlindingFactor,
      }
    : {}),
});
```

A third copy is written on the re-delivery/recovery path at src/utils/storage.ts:700-717 (identical spread at :710-715).

The store layer applies no transformation: `MemoryStore.saveUtxo` is a verbatim `this.utxos.set(key, utxo)` (src/storage/memory_store.ts:864-866) and `saveTx` likewise. A repo-wide grep for `encryptData` shows it is applied exclusively to xprivs and the seed in src/utils/wallet.ts — never to blinding factors — and no read path redacts them.

### The inconsistency

The same integration carefully PIN-encrypts the new shielded key material, on the explicit assumption that store readers exist:

```ts
// src/utils/wallet.ts:631, :636
accessData.scanMainKey = encryptData(scanXpriv.xprivkey, pin);
accessData.spendMainKey = encryptData(spendXpriv2.xprivkey, pin);
```

and decrypts only on use (`getScanXPrivKey` / `getSpendXPrivKey`, src/storage/storage.ts:971-989). Blinding factors are the *output* of using that protected scan key — without the plaintext copies, a store reader cannot recover them, because rewinding the range proof requires the PIN-encrypted scan xpriv. Persisting them plaintext is therefore a strict downgrade of the at-rest protection the rest of the design provides.

### Why this is secret material, not display data

A Pedersen commitment `C = v·H + r·G` is public on-chain. Possessing the blinding factor `r` plus the value `v` is the commitment opening: it lets anyone verify that `C` recomputes, i.e. *prove* the hidden amount of a specific on-chain output to any third party. This is qualitatively different from the transparent history amounts the wallet has always stored plaintext (those are public on-chain anyway). The fields also ride on `IHistoryTx` returned by `wallet.getTx()` (src/new/wallet.ts:1093-1095), so any consumer that exports, syncs, logs, or transmits history — a routine operation for mobile and headless wallets — carries the openings with it.

## Source of truth

- The official client integration guide explicitly designates blinding factors as secrets: `value_blinding_factor` "kept secret (needed for spending)" — SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md:31 — and `asset_blinding_factor` "kept secret" — :36. The rewind section (:80-84) repeats that the recovered `blinding_factor` is "needed to spend", i.e. spending-critical witness material.
- hathor-core never persists blindings. Rewind recovers them transiently into an in-memory `ShieldedOutputSecrets` and discards them — hathor-core:hathor/transaction/shielded_tx_output.py:85-107; hathor-core:hathor/crypto/shielded/balance.py is sender-side only. A grep of hathor-core:hathor/crypto/shielded/ for any storage/persistence code returns zero hits: blinding-factor custody is entirely wallet policy (verification rule inventory §10), so the wallet-lib cannot lean on the node for protection.

## Impact

Threat model: anyone who can read the wallet's persisted store — the exact adversary the library already defends against by PIN-encrypting every xpriv. Concretely: a stolen or seized device backup, a leaked headless-wallet storage dump, a malicious app sharing the same storage sandbox, or any history export/sync feature built on `getTx()`.

What goes wrong:

1. **Direct confidentiality loss.** The reader sees every shielded amount the wallet ever received (plaintext `value`), with addresses and tx ids attached.
2. **Provable disclosure.** With `blindingFactor` + the public `commitment`, the reader can prove those amounts to third parties (chain-analysis firms, litigants, extortionists). The victim cannot deny the amounts — strictly worse than a screenshot of a balance.
3. **On-chain linkage.** Openings let the reader confirm which on-chain shielded outputs belong to the wallet and trace value flow through the shielded pool, degrading confidentiality for counterparties too.
4. **Propagation.** Because the openings live on `IHistoryTx`, every downstream consumer (mobile, headless HTTP API responses, debug logs, cloud backups) silently carries them.

Funds are not directly at risk (spending still requires the PIN-encrypted spend xpriv signature), which is why this is high rather than critical — but the leak defeats the sole purpose of the shielded-outputs feature for any store reader.

## Recommendation

Treat blinding factors as PIN-protected secret material, the same class as xprivs:

1. **Encrypt at rest.** Wrap `blindingFactor` / `assetBlindingFactor` (and ideally the recovered `value`) with `encryptData(..., pin)` before `saveTx` / `saveUtxo`, changing the field types to `IEncryptedData`. Decrypt transiently at the consumption sites, which already have the PIN in hand:
   - spend path: src/new/sendTransaction.ts:462-484 reads `utxo.blindingFactor` / `utxo.assetBlindingFactor` (and src/utils/transaction.ts:1362-1370);
   - explicit user-requested unblinding API in src/new/wallet.ts.

   Sketch: `blindingFactor: encryptData(bf.toString('hex'), pinCode)` at write; `Buffer.from(decryptData(utxo.blindingFactor, pinCode), 'hex')` at use — mirroring exactly how `getScanXPrivKey` works (src/storage/storage.ts:971-977).

2. **Alternative: don't persist at all.** Re-derive blindings on demand via rangeproof rewind using the scan xpriv (already PIN-gated). Costs one rewind per shielded input at spend time; eliminates the at-rest secret entirely.

3. **At minimum** (if neither lands before release): strip `blindingFactor` / `assetBlindingFactor` from `getTx()` / history-export output, and document loudly that the host store MUST be encrypted at rest. This is a weaker stopgap — it does not protect against store readers.

## Verification notes

The skeptic panel independently re-read the code and confirmed every cited line:

- Plaintext writes verified verbatim at src/utils/storage.ts:987, :1005-1006, :1011, :1141-1147, plus a third persistence site the original finding missed at src/utils/storage.ts:710-715 (re-delivery recovery path).
- Exhaustive grep across src/ shows `encryptData` is applied only to xprivs/seed (src/utils/wallet.ts:596, 620, 631, 636, 642-650, 727, 729, 807-809) and never to blinding factors; no redaction exists in the storage layer (src/storage/memory_store.ts:864-866 stores verbatim), the shielded module, or the zod schemas.
- Export-path claim confirmed: src/new/wallet.ts:1093-1095 returns the stored history tx with openings intact.
- Source-of-truth check: hathor-core rewinds secrets transiently and never stores them (hathor-core:hathor/transaction/shielded_tx_output.py:85-107); the client guide marks both factors "kept secret" (client-guide-checklist.md:31, :36).
- Functional-necessity counterargument tested and rejected: plaintext persistence is not required — the spend path already receives the PIN (it decrypts the spend xpriv there), so decrypt-on-use or rewind-on-demand are both feasible. Persistence is a convenience, not a requirement.
- Severity calibration: not critical (no key/fund loss; transparent history was always plaintext), but high stands — blinding factors are cryptographic witnesses enabling provable disclosure and on-chain linkage, unrecoverable by a store reader except via the PIN-encrypted scan key, so plaintext storage leaks exactly what the key-encryption design otherwise protects.
- One citation slip in the original finding was corrected: the "keys are PIN-decrypted" contrast cite `storage.ts:971-989` resolves to src/storage/storage.ts (not src/utils/storage.ts); substance unaffected.

## Evidence folded from STATE-05 / CRY-02 (merged duplicates)

- **CRY-02 — a PIN-less export API compounds the exposure.** `getShieldedUnblindingForTx(txId)` (`src/new/wallet.ts:1119-1175`) builds explorer unblinding payloads `{ index, value, token, vbf, abf? }` straight from the plaintext fields with **no PIN gate** (signature takes only a `txId`). Recommendation addition: give it a `pinCode` parameter so explorer unblinding is an explicit, authenticated disclosure rather than a free read.
- **CRY-02 panel caveat:** the same records already store decrypted `value`/`token` in plaintext (`src/utils/storage.ts:987,991`), so a store reader learns amounts regardless; the blinding factors' *incremental* harm is converting that knowledge into transferable, third-party-checkable cryptographic proof bound to the on-chain commitments.
- **STATE-05 — fix feasibility.** The wallet already recovers `(value, blindingFactor, assetBlindingFactor)` on demand via rewind from the scan key + on-chain data (`src/shielded/processing.ts:144-197`); persisting them is a cache, not a requirement, so the don't-persist option costs only one rewind per shielded input at spend time.
