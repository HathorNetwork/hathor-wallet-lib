# SEC-03: Shielded HTR change is routed to the non-rotating current shielded address and is always the last (balancing) output

**Severity:** low - **Status:** confirmed by adversarial review

**Also reported as:** a second SEC-03 write-up (shielded change always last output) — duplicate deleted; the canonical write-up is a superset (adds the cursor-rotation analysis that bounded the original claim).

## Summary

When `sendTransaction` converts transparent HTR change into a shielded output, the change is sent to the wallet's *current* shielded receive address (the same address handed out to payees) and is appended as the *last* shielded output. Shielded outputs are never shuffled — unlike transparent outputs, which are deliberately shuffled "so we don't have change output always in the same index" — so an observer can deterministically identify the change output by position, and (because shielded output scripts are cleartext P2PKH) link it to the wallet whenever the wallet's current receive address is known to a counterparty. The originally claimed "address never rotates, every change output is linkable" mechanism was refuted: the shielded cursor does advance once the wallet processes its own transaction history. What survives is a positional fingerprint plus first-cycle/receive-address linkability — genuine but bounded privacy-hardening gaps.

## Location

- `src/new/sendTransaction.ts:1090` — change recipient resolved via `wallet.getCurrentAddress({}, { legacy: false })` (no `markAsUsed`, no internal change chain)
- `src/new/sendTransaction.ts:1102` — converted change pushed last onto `shieldedOutputDefs`
- `src/new/sendTransaction.ts:419-426` — output shuffle covers transparent outputs only; shielded outputs are never shuffled
- `src/shielded/creation.ts:74` and `src/shielded/creation.ts:169` — the balancing blinding factor is always placed on the last shielded output (`isLast && createdOutputs.length > 0`)
- `src/storage/storage.ts:308-310`, `src/storage/memory_store.ts:395-419` — `getCurrentAddress` semantics (cursor only advances on `markAsUsed` or history processing)
- `src/utils/storage.ts:985-1008`, `src/utils/storage.ts:1040-1043`, `src/utils/storage.ts:824-833` — the shielded-chain rotation path that *does* exist (via tx-history processing)
- `src/new/wallet.ts:1824` — wallet processes its own sent tx (WS echo) with `this.pinCode`, which is what triggers rotation

## Details

### 1. Change recipient is the current shielded receive address

`convertHtrChangeIfRequested` (src/new/sendTransaction.ts:1060) replaces the transparent HTR change output with a shielded one. The recipient is resolved as:

```ts
// src/new/sendTransaction.ts:1090-1095
const { address: shieldedAddress } = await wallet.getCurrentAddress({}, { legacy: false });
const addressObj = new Address(shieldedAddress, { network });
if (!addressObj.isShielded()) {
  throw new SendTxError('Wallet did not return a shielded address for HTR change conversion.');
}
const spendAddress = addressObj.getSpendAddress();
```

`getCurrentAddress` is called without `{ markAsUsed: true }`, so the call itself does not advance the shielded cursor (`src/storage/memory_store.ts:395-419`: the cursor only moves when `markAsUsed` is set, or when `setCurrentAddressIndex` is called by history processing). The wallet has no internal/change shielded chain at all — change goes to the same external receive address the wallet hands to payees.

### 2. Change is deterministically the last shielded output

The converted change is appended at the end of `shieldedOutputDefs`:

```ts
// src/new/sendTransaction.ts:1102-1109
shieldedOutputDefs.push({
  type: OutputType.P2PKH,
  address: spendAddress.base58,
  value: transparentChange.value - additionalFee,
  ...
});
```

Transparent outputs are shuffled precisely to hide the change position:

```ts
// src/new/sendTransaction.ts:419-426
const shouldShuffleOutputs =
  partialTxData.outputs.length > 0 || partialHtrTxData.outputs.length > 0;
let outputs = [...txData.outputs];
if (shouldShuffleOutputs) {
  // Shuffle outputs, so we don't have change output always in the same index
  outputs = shuffle([...partialOutputs, ...partialHtrTxData.outputs]);
}
```

No equivalent shuffle exists for `shieldedOutputDefs`; the array order is preserved into the shielded outputs header, so the wallet-generated change is always the final shielded output of every shielded send that produced HTR change.

### 3. Balancing blinding factor coincides with the change position

`src/shielded/creation.ts:74` (AmountShielded) and `src/shielded/creation.ts:169` (FullShielded) place the balancing blinding factor on the last proposal (`isLast && createdOutputs.length > 0`). This is cryptographically required for commitments to balance and is *not* observable on-chain by itself — but combined with point 2 it means the change output is also always the balancing output, reinforcing the deterministic structure.

### 4. The "address never rotates" claim — refuted, with residual gaps

The shielded cursor *does* rotate, just not at hand-out time:

- `processNewTx` appends decoded wallet-owned shielded outputs with their `shielded-spend` address (`src/utils/storage.ts:985-1008`).
- The history processor tracks `shieldedMaxIndexUsed` for `addressType === 'shielded-spend'` (`src/utils/storage.ts:1040-1043`).
- `updateWalletMetadataFromProcessedTxData` then advances `shieldedCurrentAddressIndex` to `maxIndexUsed + 1` (`src/utils/storage.ts:824-833`).
- The wallet processes its own sent transaction via the WebSocket echo with `this.pinCode` (`src/new/wallet.ts:1824`), so under normal online operation the next send's change goes to a fresh address.

This mirrors the transparent-change semantics (`src/storage/storage.ts` also resolves change via `getCurrentAddress` without `markAsUsed`; rotation always happens through history processing). Residual gaps:

- **Receive-address overlap:** because change uses the current *receive* address, a payee who was handed that address can identify the change output of the wallet's next transaction (one tx, not all). There is no internal change chain (pre-existing design, shared with transparent flow).
- **Back-to-back sends:** sends issued before the WS echo is processed reuse the same address.
- **Rotation failure modes:** rotation depends on `this.pinCode` being available and decryption succeeding; in contexts where the echo cannot be decrypted the cursor stalls.

## Source of truth

hathor-core enforces nothing here — address reuse, output ordering, and change placement are entirely client-side concerns. `hathor/verification/` contains no ordering or reuse check for shielded outputs, consistent with the rule inventory ("Address/script reuse, output ordering ... entirely client-side"). The privacy relevance comes from the wire format itself: shielded outputs carry their P2PKH script in cleartext — `hathor-core:hathor/transaction/shielded_tx_output.py:27-43` re-exports `ShieldedOutput`/`serialize_shielded_output` from hathorlib, where the script is a plain serialized field with `MAX_SHIELDED_OUTPUT_SCRIPT_SIZE` bounds, parsed and indexed by the node like transparent scripts. Only the value (and asset, in FullShielded mode) is blinded; the destination address is public. So any structural or reuse pattern in shielded outputs is fully observable on-chain.

## Impact

A passive on-chain observer can apply the heuristic "last shielded output = sender's change" to every transaction built by this wallet, since the position is deterministic. That converts shielded change — whose value is hidden — into a reliable transaction-graph edge: the observer knows *which* output returns to the sender and at *which* address, enabling wallet clustering across transactions even though amounts stay confidential. Additionally, any counterparty who has been handed the wallet's current shielded receive address can recognize that same address as the change destination of the wallet's next shielded send (first-cycle linkability), and back-to-back sends before history processing reuse one address across multiple transactions. The headline impact is privacy degradation, not fund loss; severity stays low, but it is a real gap in a feature whose entire purpose is unlinkability — especially given the codebase already shuffles transparent outputs for exactly this reason.

## Recommendation

1. **Shuffle the shielded outputs** (or at minimum randomize the change/balancing position) before building the header, mirroring the transparent shuffle at `src/new/sendTransaction.ts:419-426`. The balancing blinding factor must still be computed for whichever output is serialized last, so shuffle `shieldedOutputDefs` *before* `creation.ts` assigns `isLast` — the balancing-bf logic already keys off the final array position, so a pre-creation shuffle is sufficient and cheap:

```ts
// in prepareTxData, before shielded output creation:
shieldedOutputDefs = shuffle(shieldedOutputDefs);
```

2. **Derive change to a fresh address**: prefer an internal shielded change chain (never handed to payees); short of that, call `getCurrentAddress({ markAsUsed: true }, { legacy: false })` for change so back-to-back sends and the receive-address overlap don't reuse the payee-visible address. (Introducing a change chain is a larger design change shared with the transparent flow; the positional shuffle is the high-value, low-cost fix.)

## Verification notes

The skeptic panel rated this PARTIALLY REAL. Confirmed: the change recipient is the non-advancing current shielded receive address (src/new/sendTransaction.ts:1090, src/storage/memory_store.ts:395-419); the change is appended last with no shielded shuffle (src/new/sendTransaction.ts:1102 vs the transparent-only shuffle at :419-426, whose own comment states the purpose is hiding the change position); the balancing bf is always on the last output (src/shielded/creation.ts:74, :169) though that alone is unobservable; scripts are cleartext on-chain per hathor-core/hathorlib; and core enforces no rule here. Refuted: the claim that the address never rotates and "every" change output is linkable — rotation happens via the wallet's own WS-echo history processing (src/utils/storage.ts:824-833, :1040-1043; src/new/wallet.ts:1824), identical in shape to transparent-change semantics. Surviving issues: the deterministic last-position fingerprint (the strongest point, inconsistent with the deliberate transparent shuffle), first-cycle linkability via the shared receive address, address reuse on back-to-back sends, and rotation failure when the pin/decryption is unavailable. Severity kept at low because the clustering-impact claim was overstated, but the positional leak is systematic and trivially fixable.
