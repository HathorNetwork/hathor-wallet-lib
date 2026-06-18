# COMP-03: Multisig wallets derive and expose single-sig shielded addresses — the shielded receive chain silently bypasses the P2SH multisig policy

**Severity:** high - **Status:** confirmed by adversarial review

**Also reported as:** EDGE-03 (multisig wallets silently receive single-key shielded addresses) — merged here. Related test-coverage gap: TEST-08. Previously tracked in TODO_FIX_37_MULTISIG_SHIELDED_KEYS_DERIVED.md (earlier PR-stack review; file since removed from the repo root).

## Summary

A wallet initialized as MULTISIG (m-of-n P2SH) still derives shielded scan/spend key chains from the **local participant's seed only**, auto-loads single-sig shielded addresses into its address book, and hands them out via `getCurrentAddress`/`getAddressAtIndex` with `{ legacy: false }`. The on-chain spend script for a shielded address is a plain P2PKH over one cosigner's spend pubkey, and the signing path signs shielded-spend inputs with that single key. Any funds received at a "multisig wallet's" shielded address are therefore controlled by exactly one cosigner — the m-of-n custody policy is silently bypassed, and the other cosigners (different seeds, hence different scan/spend chains) can neither see nor co-sign those funds. Nothing in the integration gates shielded functionality on wallet type, and no test asserts such gating.

## Location

- src/utils/wallet.ts:686-692 vs 710-715, 726-729 — `generateAccessDataFromSeed`: multisig branch only affects the legacy account key; scan/spend xprivs derived unconditionally from the local `rootXpriv`
- src/utils/wallet.ts:758-813 — `migrateShieldedAccessData`: retrofits shielded keys onto existing multisig wallets, gated only on field presence and `accessData.words` (called unconditionally from `src/new/wallet.ts` on `wallet.start`)
- src/utils/storage.ts:117-131 — `loadAddresses`: derives, saves, and subscribes the shielded/spend address pair for every index with no `walletType` check
- src/utils/address.ts:178-211 — `deriveShieldedAddressFromStorage`: gates only on scan/spend xpub presence (which multisig wallets now always have)
- src/new/wallet.ts:837-850, 897-911 — `getAddressAtIndex(i, { legacy: false })` and `getCurrentAddress({}, { legacy: false })` expose shielded addresses with no multisig gating
- src/utils/shieldedAddress.ts:91-92 — on-chain spend script is `publicKeyToP2PKH(spendKey.publicKey)`: single-key custody
- src/utils/transaction.ts:413-419 — `shielded-spend` inputs are signed single-sig via `getSpendXPrivKey`
- src/new/sendTransaction.ts:1090-1110 — shielded change conversion routes a multisig wallet's HTR change to the local participant's single-sig shielded chain

## Details

### 1. Key derivation ignores wallet type

`generateAccessDataFromSeed` (src/utils/wallet.ts) branches on `walletType` only to pick the legacy account path:

```ts
if (walletType === WalletType.MULTISIG) {
  accXpriv = rootXpriv.deriveNonCompliantChild(P2SH_ACCT_PATH);
  xpriv = accXpriv.deriveNonCompliantChild(0);
} else {
  accXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
  xpriv = accXpriv.deriveNonCompliantChild(0);
}
```

…and then, a few lines later, derives the shielded chains unconditionally from the **local participant's** root key, and stores them for every wallet type:

```ts
// Derive shielded scan (account 1') and spend (account 2') keys.
// Separate from legacy (account 0') so scan key only grants view access.
const scanAcctXpriv = rootXpriv.deriveNonCompliantChild(SHIELDED_SCAN_ACCT_PATH);
const scanXpriv = scanAcctXpriv.deriveNonCompliantChild(0);
const spendAcctXpriv = rootXpriv.deriveNonCompliantChild(SHIELDED_SPEND_ACCT_PATH);
const spendXpriv = spendAcctXpriv.deriveNonCompliantChild(0);

return {
  walletType,
  multisigData,
  ...
  scanXpubkey: scanXpriv.xpubkey,
  scanMainKey: encryptData(scanXpriv.xprivkey, pin),
  spendXpubkey: spendXpriv.xpubkey,
  spendMainKey: encryptData(spendXpriv.xprivkey, pin),
};
```

The migration helper `migrateShieldedAccessData` (src/utils/wallet.ts:758-813) is equally ungated — it checks only that the shielded fields are absent and that `accessData.words` exists, then derives and writes the same keys. Since it runs on `wallet.start`, **pre-existing multisig wallets are retrofitted with single-sig shielded keys on upgrade** with no opt-in.

### 2. Address loading and exposure ignore wallet type

`loadAddresses` (src/utils/storage.ts:117-131) auto-derives the shielded pair for every index of every wallet that has the keys — which, per the above, is every wallet including MULTISIG:

```ts
// Always generate shielded address pair at the same index (if keys are available).
const shieldedResult = await deriveShieldedAddressFromStorage(i, storage);
if (shieldedResult) {
  ...
  await storage.saveAddress(shieldedResult.shieldedAddress);
  ...
  await storage.saveAddress(shieldedResult.spendAddress);
  ...
  addresses.push(shieldedResult.spendAddress.base58);
}
```

`deriveShieldedAddressFromStorage` (src/utils/address.ts:182-186) gates only on key presence:

```ts
const scanXpub = await storage.getScanXPubKey();
const spendXpub = await storage.getSpendXPubKey();
if (!scanXpub || !spendXpub) {
  return null;
}
```

And the public API hands these addresses out on a multisig wallet without any check. `getAddressAtIndex` (src/new/wallet.ts:837-850) even derives on demand:

```ts
if (opts?.legacy === false) {
  // Shielded address not yet derived at this index — derive and save
  const result = await deriveShieldedAddressFromStorage(index, this.storage);
  ...
  return result.shieldedAddress.base58;
}
```

The only MULTISIG check in the vicinity (`getAddressPathForIndex`) is skipped entirely on the `legacy: false` path. `getCurrentAddress` (src/new/wallet.ts:897-911) is a plain storage passthrough.

### 3. Custody of the resulting funds is 1-of-1

The on-chain script that receives shielded outputs is a P2PKH over the single spend pubkey (src/utils/shieldedAddress.ts:91-92):

```ts
// Derive on-chain P2PKH from spend_pubkey
const spendAddress = publicKeyToP2PKH(spendKey.publicKey, network);
```

and spending is signed with that one key chain (src/utils/transaction.ts:413-419):

```ts
if (addressInfo.addressType === 'shielded-spend') {
  // Use spend key chain (m/44'/280'/2'/0) for shielded UTXO inputs
  if (!spendXprivkey) {
    const spendXprivStr = await storage.getSpendXPrivKey(pinCode);
    spendXprivkey = HDPrivateKey.fromString(spendXprivStr);
  }
  derivedKey = spendXprivkey.deriveNonCompliantChild(addressInfo.bip32AddressIndex);
}
```

There is no P2SH/multisig path for shielded spends anywhere in the codebase.

### 4. Aggravating path: change conversion

`convertHtrChangeIfRequested` (src/new/sendTransaction.ts:1090-1110) sends a transaction's HTR change to `wallet.getCurrentAddress({}, { legacy: false })` — i.e., to the local participant's single-sig shielded chain. Since nothing gates shielded sends on wallet type (`getOutputTypeFromWallet` at src/new/sendTransaction.ts:1114-1123 happily handles MULTISIG for transparent outputs), a multisig wallet performing a shielded send **silently moves its change from m-of-n P2SH custody to 1-of-1 custody** of whichever participant's device built the transaction.

## Source of truth

Consensus offers no shielded multisig concept to lean on, so this custody policy must be enforced wallet-side:

- hathor-core:hathor/conf/mainnet.py:23-24 — only `P2PKH_VERSION_BYTE=b'\x28'` and `MULTISIG_VERSION_BYTE=b'\x64'` exist; the shielded address format is purely a wallet-layer convention.
- hathor-core:hathor/transaction/shielded_tx_output.py — no address concept at all (outputs carry commitments and on-chain scripts), and hathor-core:hathor/crypto/shielded/ contains zero multisig references.

Because core is custody-agnostic, the wallet is the only place where "shielded receive on a multisig wallet" can be blocked — and the integration does not block it anywhere.

## Impact

Concrete scenario: a 2-of-3 treasury wallet upgrades to a wallet-lib version with this integration. On the next `wallet.start`, `migrateShieldedAccessData` silently injects shielded keys derived from cosigner A's seed. Any consumer app that enables shielded receive/send UI (the library gives no signal not to) then:

1. Shows a shielded receive address whose funds are spendable by **cosigner A alone** — the 2-of-3 policy is bypassed for everything received there.
2. Hides those funds from cosigners B and C entirely: their wallets derive different scan/spend chains from their own seeds, so they cannot scan, see, or co-sign these outputs. Auditing cosigners observe funds "disappearing" from the multisig.
3. On any shielded send initiated from cosigner A's device, even the **change** of the multisig's transparent funds is auto-converted into A's single-sig shielded custody (src/new/sendTransaction.ts:1090-1110).

Not critical — no third party can steal, and a legitimate participant retains the keys — but it silently defeats the entire purpose of an m-of-n wallet, and the loss-of-visibility for other cosigners is indistinguishable from theft from their point of view.

## Recommendation

Gate shielded functionality on wallet type until a multisig-aware shielded scheme exists (e.g. P2SH spend scripts plus a shared scan key):

1. In `generateAccessDataFromSeed` and `migrateShieldedAccessData` (src/utils/wallet.ts), skip scan/spend key derivation when `walletType === WalletType.MULTISIG` (cheapest, most complete fix — every downstream path gates on key presence already, so `loadAddresses`, `deriveShieldedAddressFromStorage`, and change conversion all become no-ops automatically).
2. Defense in depth: throw a clear, typed error (`ShieldedNotSupportedForMultisig` or similar) from `getAddressAtIndex`/`getCurrentAddress` when `opts.legacy === false` and the wallet type is MULTISIG, and reject shielded output definitions / `convertHtrChangeIfRequested` in `sendTransaction` for multisig wallets.

Sketch for (1):

```ts
// generateAccessDataFromSeed
let shieldedKeys = {};
if (walletType !== WalletType.MULTISIG) {
  const scanXpriv = rootXpriv.deriveNonCompliantChild(SHIELDED_SCAN_ACCT_PATH).deriveNonCompliantChild(0);
  const spendXpriv = rootXpriv.deriveNonCompliantChild(SHIELDED_SPEND_ACCT_PATH).deriveNonCompliantChild(0);
  shieldedKeys = {
    scanXpubkey: scanXpriv.xpubkey,
    scanMainKey: encryptData(scanXpriv.xprivkey, pin),
    spendXpubkey: spendXpriv.xpubkey,
    spendMainKey: encryptData(spendXpriv.xprivkey, pin),
  };
}
return { walletType, multisigData, ..., ...shieldedKeys };
```

Add regression tests asserting: (a) multisig access data contains no shielded keys after both seed generation and migration; (b) `getAddressAtIndex(i, { legacy: false })` and `getCurrentAddress({}, { legacy: false })` throw on a multisig wallet; (c) shielded sends are rejected for multisig wallets.

## Verification notes

The skeptic panel re-read every cited line in the worktree and confirmed all claims with no refuting code found:

- src/utils/wallet.ts:674-678 sets `walletType = WalletType.MULTISIG`; 686-692 branch on it only for the legacy account key; 710-715 and 726-729 derive and store scan/spend keys unconditionally. `migrateShieldedAccessData` (758-813) gates only on field presence and `accessData.words` and is called unconditionally from `wallet.start` (src/new/wallet.ts:2117-2129).
- Exhaustive grep across `src/` for any file combining shielded + multisig logic found only incidental co-occurrences (the transparent-change script-type selection in src/new/sendTransaction.ts:1114-1123 and type imports). No guard, no throw, no `getWalletType` call exists anywhere on the shielded receive/send/sign paths.
- No test in `__tests__/` covers the multisig + shielded interaction; the shielded tests in `__tests__/utils/wallet.test.ts` are migration-only.
- Core side verified against the source of truth: only P2PKH/MULTISIG version bytes exist (hathor-core:hathor/conf/mainnet.py:23-24); `hathor/crypto/shielded/` and the shielded headers have no multisig concept, confirming the gating must be wallet-side.
- Severity high (not critical) agreed: real custody-policy bypass with cosigner-invisible funds, but it requires the multisig wallet to actually use the shielded (`{ legacy: false }`) flow and no third-party theft is possible.

## Evidence folded from EDGE-03 (merged duplicate)

- **Funds-availability hazard (aggravating).** Each multisig participant has a different root seed, so each library instance derives *different* shielded scan/spend chains. Shielded funds received via one participant's shielded address are invisible to and unrecoverable by the other n-1 participants; if that one participant loses their seed, the shielded funds are gone even though the multisig quorum is intact.
- The same unconditional derivation also exists in `generateAccessData` for any root xpriv (`src/utils/wallet.ts:624-637` — gated on `argXpriv.depth === 0`, never on `walletType`).
