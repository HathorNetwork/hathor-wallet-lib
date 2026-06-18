# COMP-05: Readonly/xpub wallets have zero shielded capability and there is no scan-key (view-key) import path — balances silently incomplete

**Severity:** medium - **Status:** confirmed by adversarial review

## Summary

Wallets started from an xpub (readonly / hardware) get access data with no shielded key material, and there is no start option — anywhere in the API — to supply scan/spend xpubs or a view-only scan key. As a result the shielded address chain is never loaded, shielded receipts are never matched, and shielded balances are silently omitted from a wallet that otherwise claims to be fully synced. The fullnode explicitly exposes a `has_shielded` hint on the thin-wallet endpoints for exactly this situation, but wallet-lib never reads it, so the user gets a wrong balance with no warning. The scan/spend key split (accounts 1'/2') was designed specifically to make view-only shielded wallets possible, yet that capability is unreachable.

## Location

- src/utils/wallet.ts:476-534 — `generateAccessDataFromXpub` returns no shielded fields and accepts none
- src/utils/wallet.ts:627-637 — shielded keys derived only when `argXpriv.depth === 0` (root xpriv)
- src/utils/wallet.ts:758-773 — `migrateShieldedAccessData` bails for xpub-only records (`if (!accessData.words) return false;` at :773)
- src/new/wallet.ts:2107-2110 — start path passes only `{ multisig }` to `generateAccessDataFromXpub`
- src/new/wallet.ts:2115-2121 — migration only invoked when `pinCode && password` are present
- src/utils/address.ts:178-186 — `deriveShieldedAddressFromStorage` returns `null` without scan+spend xpubs
- src/utils/storage.ts:382, 425, 439 — shielded chain loading gated on `accessData.spendXpubkey`
- src/storage/storage.ts:971-977 — `getScanXPrivKey` throws without `scanMainKey` + PIN
- src/new/wallet.ts:1851 — decryption-retry safety net gated on `this.pinCode`
- src/api/wallet.ts:253-264, 279-302 — `address_balance` / `address_search` responses passed through raw; `has_shielded` never consumed
- src/types.ts:498-505 — `IWalletAccessData` shielded fields, all optional

## Details

### 1. The xpub start path produces shielded-less access data with no escape hatch

`generateAccessDataFromXpub` (src/utils/wallet.ts:476) takes only `{ multisig, hardware }` and returns:

```ts
return {
  // Change path hdpublickey in string format
  xpubkey: xpub.xpubkey,
  walletType,
  multisigData,
  // We force the readonly flag because we are starting a wallet without the private key
  walletFlags,
};
```

No `scanXpubkey`, `spendXpubkey`, `scanMainKey`, or `spendMainKey`, and the options bag has no parameter through which a caller could provide them. The only call site, the wallet start path, confirms this:

```ts
// src/new/wallet.ts:2107-2110
} else if (this.xpub) {
  accessData = walletUtils.generateAccessDataFromXpub(this.xpub, {
    multisig: this.multisig,
  });
```

An exhaustive search shows the only writers of the shielded access-data fields are `generateAccessDataFromSeed`, `generateAccessDataFromXpriv` — and the latter only when given a *root* key (`if (argXpriv.depth === 0)`, src/utils/wallet.ts:627; account/change-path xpriv wallets are also silently shielded-less) — and `migrateShieldedAccessData`. The migration is a deliberate no-op for readonly wallets:

```ts
// src/utils/wallet.ts:772-773
if (hasAll) return false;
if (!accessData.words) return false;
```

and is only invoked when both `pinCode && password` are supplied (src/new/wallet.ts:2115), which readonly wallets never do.

### 2. The cascade: no shielded chain, no matching, no decoding

- **Address derivation:** `deriveShieldedAddressFromStorage` (src/utils/address.ts:178-186) requires both scan and spend xpubs and returns `null` otherwise — so neither the shielded address nor its spend-derived P2PKH companion address is ever computed.
- **Chain loading:** the scan-policy helpers gate the shielded cursor on `spendXpubkey` (src/utils/storage.ts:382, 425, 439), so the spend chain (account 2') P2PKH addresses are never loaded into the address set. Incoming shielded outputs are therefore never even *matched* to the wallet — the failure happens before any decryption question arises.
- **Decryption:** even if matching worked, unblinding needs the scan xpriv: `Storage.getScanXPrivKey` (src/storage/storage.ts:971-977) throws unless `scanMainKey` exists and a PIN is supplied, and `deriveScanPrivkeyForAddress` (src/shielded/processing.ts:58-80) goes through it. The decryption-retry safety net in `onNewTx` is likewise gated on `this.pinCode` (src/new/wallet.ts:1851), which readonly wallets don't have.

Net effect: a readonly wallet over a seed that actively uses shielded outputs reports a balance that excludes all shielded funds, while presenting itself as fully synced and READY.

### 3. No "shielded activity present" signal either

The fullnode's thin-wallet endpoints return a `has_shielded` boolean precisely as a "this address has activity you cannot account" hint, but wallet-lib's `getAddressBalance` / `getSearchAddress` (src/api/wallet.ts:253-264, 279-302) resolve `res.data` raw and `grep -rn has_shielded src/` returns zero hits. Nothing in the library detects `shielded_outputs` in history for an unmatched address and surfaces it. There is no event, flag, or warning a wallet UI could use.

### 4. The view-key design exists but is unexploitable

wallet-lib's own code documents the intent:

```ts
// src/types.ts:502
scanXpubkey?: string; // xpub at m/44'/280'/1'/0 (scan chain — view-only access)
```

and src/utils/wallet.ts:625-626 ("the scan key only grants view access, not spending authority over legacy funds"). The whole point of splitting scan (account 1') from spend (account 2') is that the scan key can be shared to build a watch/view-only wallet. Yet there is no entry point: even a user who externally derives and hands over the scan xpriv (or scan+spend xpubs) has no API through which to inject them.

## Source of truth

- **hathor-core exposes the warning hint the wallet ignores.** `has_shielded` is computed and returned by both thin-wallet endpoints: hathor-core:hathor/wallet/resources/thin_wallet/address_balance.py:103-157 (set when an input spends a shielded output or any `tx.shielded_outputs` entry pays the queried address; `data['has_shielded'] = has_shielded` at :157) and hathor-core:hathor/wallet/resources/thin_wallet/address_search.py:138-146 (set when any returned tx has `shielded_outputs`). These exist exactly so transparent-only balance consumers can flag that their numbers are incomplete.
- **The RFC's key architecture is built for view-only access.** The scan/spend split with per-output ephemeral keypairs and ECDH-based derivation (SHIELDED_INTEGRATION_REVIEW/reference/rfc-summary.md:11) means possession of the scan key alone suffices to detect and unblind received shielded outputs without conferring spend authority — the canonical view-key pattern. The client guide's receive flow only requires the scan private key for ECDH plus the spend *pubkey* hash for matching; none of that requires the seed.

## Impact

Concrete scenario: a user runs their seed wallet on mobile (sends/receives shielded outputs) and also monitors the same account on a desktop watch-only wallet started via `xpub`. After shielded activity:

- The watch-only wallet shows a balance missing every shielded UTXO (received and change), with no indication anything is hidden. For a treasury/accounting/auditor use case — the primary consumer of readonly wallets — this is silently wrong data, the worst failure mode short of fund loss.
- Hardware-wallet users (xpub start with `hardware: true`) are in the same bucket.
- Wallets started from a non-root xpriv (depth > 0) hit the same silent gap via src/utils/wallet.ts:627.
- The advertised view-only capability of the scan key (a selling point of the design) cannot be used by any wallet-lib consumer.

No funds are at risk and spending is unaffected, hence medium rather than high.

## Recommendation

Two tiers, either of which resolves the "silent" part:

1. **(Preferred) Add a view-key start path.** Extend `generateAccessDataFromXpub` options (and `HathorWallet` start config) with optional `scanXpubkey` + `spendXpubkey` — enough to derive shielded addresses (src/utils/address.ts:178) and load the spend chain (src/utils/storage.ts:382/425), so shielded receipts are at least *matched* and can be shown as "shielded — amount hidden". Optionally also accept a scan xpriv (PIN-encrypted into `scanMainKey`) to enable full view-only unblinding through the existing `getScanXPrivKey`/`deriveScanPrivkeyForAddress` path. Sketch:

   ```ts
   generateAccessDataFromXpub(xpubkey, {
     multisig, hardware,
     shielded?: { scanXpubkey: string; spendXpubkey: string; scanXprivkey?: string; pin?: string },
   })
   ```

   Per the project convention, this should be an explicit named option, not inferred.

2. **(Minimum) Surface a "shielded activity not visible" indicator.** Consume the fullnode's `has_shielded` flag from `address_balance`/`address_search` (src/api/wallet.ts:253/289), and/or detect non-empty `shielded_outputs` on history txs in wallets lacking `scanXpubkey`, and expose it (wallet event or `getBalance` metadata) so UIs can warn that displayed balances exclude shielded funds.

Also worth fixing alongside: the `argXpriv.depth === 0` restriction (src/utils/wallet.ts:627) silently produces shielded-less wallets for account-path xpriv starts; that case should at least log/flag.

Note: this gap is already tracked in the repo as TODO_FIX_39_READONLY_WALLETS_SHIELDED.md.

## Verification notes

The skeptic panel confirmed via static review of the worktree:

1. Read `generateAccessDataFromXpub` end to end (src/utils/wallet.ts:476-534): the returned object contains only `xpubkey`, `walletType`, `multisigData`, `walletFlags`; the options type admits no shielded inputs; the sole caller (src/new/wallet.ts:2108) passes `{ multisig }` only.
2. Exhaustive grep for writers of `scanXpubkey|spendXpubkey|scanMainKey|spendMainKey`: only seed/root-xpriv generation (src/utils/wallet.ts:627-637) and `migrateShieldedAccessData`; no start option or import API anywhere in src/.
3. Confirmed the migration bail-out (`if (!accessData.words) return false;`, src/utils/wallet.ts:773) and its `pinCode && password` invocation guard (src/new/wallet.ts:2115) — both unreachable for readonly wallets.
4. Traced the full cascade: null shielded derivation (src/utils/address.ts:182-186), spend-chain loading gated on `spendXpubkey` (src/utils/storage.ts:382/425/439), `getScanXPrivKey` throw (src/storage/storage.ts:971-977), PIN-gated retry (src/new/wallet.ts:1851). Since the account-2' P2PKH addresses are never loaded, shielded outputs are never matched at all — confirming "silently incomplete" rather than "errors out".
5. Verified `has_shielded` exists server-side (hathor-core:hathor/wallet/resources/thin_wallet/address_balance.py:103-157, address_search.py:138-146) and that zero wallet-lib src/ code reads it (API responses passed through raw at src/api/wallet.ts:253-264, 279-302).
6. Confirmed the view-only intent is stated in wallet-lib's own comments (src/types.ts:502, src/utils/wallet.ts:625-626) yet has no usable entry point — establishing this as a real capability gap, not an out-of-scope fantasy feature. Severity medium: silently wrong balances for a supported wallet type, but no fund loss and plausibly deferred scope (repo already carries TODO_FIX_39).
