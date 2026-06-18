# STATE-08: Shielded decryption is silently skipped when the wallet instance has no cached pinCode — start({pinCode}) does not enable it, and no error or warning is surfaced

**Severity:** medium - **Status:** confirmed by adversarial review

## Summary

All receive-side shielded decryption is gated on `this.pinCode`, which is assigned exactly once — in the `HathorWallet` constructor. Passing `pinCode` to `start()` initializes/migrates access data (including the shielded scan keys) but never persists the pin to the instance, and every send method accepts a per-call `options.pinCode`, so the long-supported "PIN per operation, never on the instance" integration pattern silently produces a wallet that derives and subscribes shielded addresses yet never decrypts a single incoming shielded output. No warning or error distinguishes this state from normal operation; balances simply omit shielded funds and the wallet's own shielded change goes untracked.

## Location

- src/new/wallet.ts:387 — `this.pinCode = pinCode` (constructor; the only assignment in the codebase)
- src/new/wallet.ts:2052-2055 — `start()` reads `options.pinCode` into a local and never sets `this.pinCode`
- src/new/wallet.ts:659, 1657, 1674, 1824, 1829, 3832 — every receive-side processing site passes `this.pinCode ?? undefined`
- src/new/wallet.ts:1851, 1865 — STATE-02 safety net also gated on `this.pinCode`
- src/utils/storage.ts:951-956 — decode block silently skipped when `pinCode === undefined`
- src/new/sendTransaction.ts:849 — post-push local insert goes through `enqueueOnNewTx` → `onNewTx` → `this.pinCode` (the per-call signing pin from src/new/sendTransaction.ts:665-674 is not forwarded)

## Details

### The gate

`processNewTx` only attempts shielded decryption when a pin is present (src/utils/storage.ts:951-956):

```ts
const alreadyDecoded = tx.outputs.some(o => transactionUtils.isShieldedOutputEntry(o));
if (
  !alreadyDecoded &&
  storage.shieldedCryptoProvider &&
  tx.shielded_outputs?.length &&
  pinCode !== undefined
) {
```

There is no `else` branch: when `pinCode` is `undefined` the block is skipped with no log line. The only error logging (`storage.ts:1016`) lives inside the block's `catch` and never runs in this case. So "provider set but no pin" is observationally identical to "no shielded outputs at all".

The pin is genuinely required — the scan xpriv is pin-encrypted at rest (`decryptData(accessData.scanMainKey, pinCode)` at src/storage/storage.ts:976, consumed by `deriveScanPrivkeyForAddress` in src/shielded/processing.ts:58-76). There is no pinless view-key path.

### Why per-call-PIN wallets hit it

`this.pinCode` is assigned only in the constructor (src/new/wallet.ts:387). `start()` does this (src/new/wallet.ts:2052-2055):

```ts
async start(optionsParams: WalletStartOptions = {}): Promise<ApiVersion> {
  const options = { pinCode: null, password: null, ...optionsParams };
  const pinCode = options.pinCode || this.pinCode;
```

That local `pinCode` is used to generate access data (lines 2092-2106) and to run `migrateShieldedAccessData` (lines 2121-2129) — so the shielded scan keys are correctly derived and persisted — but it is never written back to `this.pinCode`. (`clearSensitiveData()` at lines 2897-2900 clears only `xpriv`/`seed`, so this is an omission, not a deliberate scrub.)

Meanwhile every send method treats per-call pin as a first-class option: `const pin = newOptions.pinCode || this.pinCode` at src/new/wallet.ts:1973, 2270, 2471, 2587, 2691, 2807, 3184, 3529, 3622, 3725, 3854, 3913. A consumer that constructs the wallet without `pinCode`, calls `start({ pinCode })`, and passes `pinCode` to each send is using a fully supported pattern — and gets zero shielded receive tracking.

### Every receive path is affected

All processing sites pass the instance field:

- Initial sync after connect: `syncHistory(..., this.pinCode ?? undefined)` (src/new/wallet.ts:659) and `this.storage.processHistory(this.pinCode ?? undefined)` (1657)
- Address-scan extension: 1674
- New tx via websocket: `processNewTx(newTx, this.pinCode ?? undefined)` (1824) and the shielded-newly-available reprocess (1829)
- Reload path: 3832
- The STATE-02 stuck-tx safety net cannot fire either, because it requires `this.storage.shieldedCryptoProvider && this.pinCode` (1851) before calling `processHistory(this.pinCode)` (1865)

The sender's own change is also affected: after a successful push, `SendTransaction` inserts the tx locally via `wallet.enqueueOnNewTx(...)` (src/new/sendTransaction.ts:849), which flows into `onNewTx` and therefore `this.pinCode` — the pin the caller just supplied for signing (src/new/sendTransaction.ts:665-674) is not threaded through. So even the operation that *had* the pin in hand loses its shielded change from tracking.

## Source of truth

This is a wallet-availability contract issue rather than a consensus divergence; hathor-core is indifferent to whether a client decrypts. But the client integration guide makes background scanning a core obligation of a shielded-capable wallet:

- SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md:92 — "Wrong recipient: nonce derivation fails → error (expected during scanning); no false positives" and :115 — "Rewind failure with wrong key: expected, continue scanning": the guide assumes the client *attempts* rewind on every incoming shielded output as part of scanning. A configuration where scanning is silently disabled — while the wallet still advertises shielded addresses and accepts shielded sends — has no sanctioned place in that model.
- The scan keypath itself (m/44'/280'/1'/0 per src/shielded/processing.ts:54-57, matching hathor-core's ECDH scheme in hathor-core:hathor/crypto/shielded/) exists precisely so received outputs can be rewound; storing it pin-encrypted is a wallet-lib design choice, which makes pin availability a wallet-lib obligation to surface, not the protocol's.

## Impact

Concrete scenario: a headless/exchange-style integration constructs `HathorWallet` without `pinCode` (deliberately, to keep the PIN out of long-lived memory), calls `start({ pinCode })`, sets `shieldedCryptoProvider`, and passes `pinCode` to each send call.

1. Shielded addresses are derived, exposed via `getCurrentShieldedAddress`-style APIs, and given out to depositors; scan keys are migrated into access data during `start()`.
2. A depositor sends a shielded output. `onNewTx` runs `processNewTx(tx, undefined)`; the decode block is skipped, the tx is stored with raw `shielded_outputs` only, no UTXO is saved, and the balance does not move. No log entry is produced.
3. The wallet sends a shielded tx with shielded change; the post-push local insert also skips decoding, so its own change disappears from tracking until a future full reprocess.
4. The STATE-02 safety net, which exists to rescue stuck undecoded txs, is disabled by the same gate, so the state persists indefinitely for this process lifetime.

Recovery is possible — restarting with `pinCode` in the constructor triggers `processHistory` with a pin and the `alreadyDecoded`/`shieldedNewlyAvailable` machinery (src/new/wallet.ts:1811-1830) picks the funds up — which is why this is medium (availability gap with a confusing failure mode) rather than fund loss. The danger is operational: an integrator can run for months believing shielded deposits "don't arrive", with zero diagnostic signal.

## Recommendation

1. In `start()`, persist the resolved pin: after line 2054, set `this.pinCode = pinCode` (or at minimum when `this.pinCode` was previously null and `options.pinCode` was supplied). Alternatively — per the project's explicit-options-over-inference convention — add an explicit API such as `wallet.setPinCode(pin)` / `enableShieldedSync(pin)` so consumers opt in deliberately:

```ts
const pinCode = options.pinCode || this.pinCode;
const password = options.password || this.password;
if (pinCode) {
  // Shielded receive-side decryption requires the pin on the instance
  // (scan xpriv is pin-encrypted; see utils/storage.ts processNewTx gate).
  this.pinCode = pinCode;
}
```

2. Surface the degraded state: in `processNewTx` (src/utils/storage.ts:951-956), when `storage.shieldedCryptoProvider` is set and `tx.shielded_outputs?.length` but `pinCode === undefined`, emit a one-time `logger.warn` stating that shielded outputs cannot be decrypted without a pin and how to enable it.
3. Thread the signing pin into the post-push local insert (src/new/sendTransaction.ts:849) — or document that change tracking also depends on the instance pin.
4. Document the contract: shielded receive tracking requires the PIN to be available on the wallet instance for the lifetime of the session; per-call pins cover signing only.

## Verification notes

The skeptic panel confirmed every link in the chain against the worktree:

1. `grep` over src/ finds `this.pinCode =` only at src/new/wallet.ts:387; no `setPinCode`/`enableShieldedSync` API exists.
2. `start()` (src/new/wallet.ts:2052-2130) demonstrably uses the local pin for access-data generation and `migrateShieldedAccessData` — so scan keys *are* provisioned — yet never assigns the instance field; `clearSensitiveData` (2897-2900) touches only `xpriv`/`seed`.
3. All six receive-side sites (659, 1657, 1674, 1824, 1829, 3832) pass `this.pinCode ?? undefined`; the STATE-02 net is gated at 1851/1865, so it cannot compensate.
4. src/utils/storage.ts:951-956 has no else branch and no warning; the only error log (storage.ts:1016) is unreachable when the block is skipped.
5. Pin necessity verified: `getScanXPrivKey` decrypts `accessData.scanMainKey` with the pin (src/storage/storage.ts:976), consumed by src/shielded/processing.ts:65; no pinless view-key path exists anywhere in src/.
6. Sender-change exposure verified: src/new/sendTransaction.ts:849 routes through `enqueueOnNewTx` → `onNewTx` → `this.pinCode`, and the per-call signing pin (sendTransaction.ts:665-674) is not forwarded.
7. Severity calibrated as medium because a later restart with a constructor `pinCode` recovers all funds via `processHistory` and the `shieldedNewlyAvailable` reprocess path (src/new/wallet.ts:1811-1830) — the failure is availability plus diagnosability, not permanent loss.
