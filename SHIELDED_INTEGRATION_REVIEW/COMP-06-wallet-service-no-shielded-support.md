# COMP-06: Wallet-service wallet has no shielded support and the new core events-API plumbing is not consumed anywhere in wallet-lib
**Severity:** medium - **Status:** confirmed by adversarial review

## Summary

The shielded-outputs integration is entirely confined to the fullnode wallet (`HathorWallet`). The wallet-service wallet (`HathorWalletServiceWallet`) received only 25 lines of defensive tolerance — it skips shielded inputs in balance math and passes shielded history entries through unparsed — but has no shielded address derivation, no crypto provider, no decode/rewind, and no shielded send path. Meanwhile, hathor-core's alpha-v4 HEAD commit exists specifically to carry shielded data through the event-queue API that the wallet-service stack consumes, and wallet-lib contains zero consumers of that API. A user who shields funds via the fullnode wallet and then opens the same seed in the wallet-service wallet sees those funds silently vanish, with no guard or warning.

## Location

- `src/wallet/wallet.ts:766-767` — the only shielded-aware logic in the wallet-service wallet (`getTxBalance` input skip)
- `src/wallet/wallet.ts:1495` — `getAddressAtIndex(index: number)` silently ignores the shielded chain option
- `src/wallet/wallet.ts:1547` — `getCurrentAddress` likewise has no `IAddressChainOptions` parameter
- `src/wallet/types.ts:363,369,371` — `IHathorWallet` declares `opts?: IAddressChainOptions` on these methods
- `src/types.ts:118-120` — `IAddressChainOptions` (`{ legacy?: boolean }`, default legacy)
- `src/wallet/walletServiceStorageProxy.ts:192-199` — shielded history entries passed through untouched

## Details

The diff to `src/wallet/` on this branch is 25 inserted lines across 3 files (`git diff master...HEAD --stat -- src/wallet/`). Everything in it is defensive, not functional:

1. **Balance computation skips shielded inputs.** `getTxBalance` in `HathorWalletServiceWallet` gained exactly one shielded-related change (`src/wallet/wallet.ts:766-767`):

   ```ts
   for (const txin of tx.inputs) {
     // Shielded inputs don't have value/token/token_data fields
     if (txin.token === undefined) continue;
   ```

   That prevents a crash, but the outputs loop above it still requires `txout.decoded && txout.decoded.address` to add value — so a shielded receive (which has a commitment instead of a decoded address/value) contributes **nothing** to any balance. There is no other shielded handling in the file: `grep -n shielded src/wallet/wallet.ts` returns only this comment-and-skip pair.

2. **Storage proxy is pass-through only.** `src/wallet/walletServiceStorageProxy.ts:192-199` simply forwards shielded output entries verbatim when reshaping service history:

   ```ts
   outputs: tx.outputs.map(output => {
     if (transactionUtils.isShieldedOutputEntry(output)) return output;
     ...
   ```

   No unblinding, no valuation, no ownership detection.

3. **Interface implemented with silently-dropped options.** `IHathorWallet` was extended so address methods accept `opts?: IAddressChainOptions` (`src/wallet/types.ts:363`), where `IAddressChainOptions = { legacy?: boolean }` defaults to the legacy chain (`src/types.ts:118-120`). The fullnode wallet honors it; the wallet-service wallet implements the method with **fewer parameters**:

   ```ts
   // src/wallet/wallet.ts:1495
   async getAddressAtIndex(index: number): Promise<string> {
   ```

   TypeScript permits implementing an interface method with fewer parameters, so this compiles cleanly. A caller doing `wallet.getAddressAtIndex(5, { legacy: false })` through the `IHathorWallet` interface gets a **legacy address back with no error** — the worst failure mode, because the caller may hand that address out believing it is a shielded receive address. `getCurrentAddress` (`src/wallet/wallet.ts:1547`) has the same shape.

4. **Nothing missing is guarded.** There is no shielded address chain registration with the service, no crypto-provider hook (`setShieldedCryptoProvider` exists only on the fullnode `HathorWallet`), no rewind/blinding storage, no shielded branch in any of the wallet-service `sendTransaction` flows, and no warning when service history contains shielded entries the wallet cannot value.

5. **The event-queue API has no wallet-lib consumer.** `grep -rln 'v1a/event\|NEW_VERTEX_ACCEPTED\|EventQueue' src/` returns nothing. This is fine for the fullnode wallet (its legacy WebSocket history is shielded-aware), but it means the groundwork core laid for shielded-aware event consumers has no counterpart anywhere in wallet-lib.

## Source of truth

hathor-core's alpha-v4 HEAD commit (`00a4532b`, "experimental: shielded outputs alpha v4 - events API") exists specifically to push shielded data into the event stream consumed by the wallet-service stack:

- `hathor-core:hathor/event/model/event_data.py:46-69` — pydantic `ShieldedTxOutput` model mirroring `_shielded_output_to_json` (type discriminator `'shielded'`, `mode`, `commitment`, `range_proof`, `ephemeral_pubkey`, `asset_commitment`, `surjection_proof`, ...).
- `hathor-core:hathor/event/model/event_data.py:74` — `TxInput.spent_output: TxOutput | ShieldedTxOutput` smart union so shielded spends route correctly.
- `hathor-core:hathor/event/model/event_data.py:160-172` — `TxData.shielded_outputs: list[ShieldedTxOutput]`, with an in-code comment stating the explicit purpose: without it, `extra='ignore'` silently dropped the key and "downstream consumers (the EventQueue WS API, hathor-wallet-service) never see the shielded outputs of a tx — which made it impossible for shielded-aware wallets to discover their own shielded receives over the wallet-service event stream."

Core therefore anticipates shielded-aware wallets on the wallet-service path. The wallet-lib integration delivers no such wallet, and the client integration guide's discovery/unblinding flow (provider decode of wallet-owned outputs, balance contribution of shielded receives) is implemented only for the fullnode wallet.

## Impact

Concrete scenario:

1. A user runs the fullnode wallet, registers a shielded crypto provider, and moves 100 HTR into shielded outputs (receive or change). Fullnode wallet shows the funds correctly.
2. The same user opens the same seed in a wallet-service-backed app (the architecture used by Hathor's production mobile/desktop wallets).
3. The wallet-service wallet computes balances from `getTxBalance`: the shielded inputs are skipped and the shielded outputs are never valued. The 100 HTR **silently disappears** from the displayed balance — no error, no warning, no indication that the wallet is showing an incomplete picture.
4. Worse, any code path that requests a shielded address via the shared `IHathorWallet` interface (`{ legacy: false }`) silently receives a **legacy** address, so an app could display a transparent address while the user believes they are receiving shielded.

This is the same silent-incompleteness failure mode as COMP-05, extended across wallet implementations. Severity is medium rather than high because the wallet-service backend itself is not yet shielded-ready (so no production deployment can hit it today) and no fullnode shielded flow is buggy — but the silent address-chain substitution and vanishing balances are exactly the kind of cross-wallet inconsistency that erodes trust in confidential funds.

## Recommendation

For this release, make the wallet-service wallet **explicitly and loudly non-shielded**:

1. Throw on shielded chain requests instead of silently dropping the option:

   ```ts
   async getAddressAtIndex(index: number, opts?: IAddressChainOptions): Promise<string> {
     if (opts && opts.legacy === false) {
       throw new WalletError('Shielded addresses are not supported by the wallet-service wallet.');
     }
     ...
   }
   ```

   Apply the same to `getCurrentAddress` / `getNextAddress` so the implementations match the `IHathorWallet` signatures and fail fast.

2. Surface a detectable signal (event or warning flag) when service history contains shielded entries (`isShieldedOutputEntry` hits in `walletServiceStorageProxy.ts` or `token === undefined` inputs in `getTxBalance`), so client apps can tell the user the displayed balance excludes shielded funds rather than silently under-reporting.

3. Document the limitation in the wallet-service wallet's class docs and the integration changelog.

4. Track full parity as the follow-up that core's events plumbing anticipates: shielded address chain registration with the wallet-service, consumption of `TxData.shielded_outputs` / `spent_output` from the event stream (directly or via the wallet-service daemon), provider-based decode of wallet-owned outputs, and blinding storage — mirroring the fullnode implementation in `src/shielded/processing.ts` and `src/shielded/unblinding.ts`.

## Verification notes

The skeptic panel confirmed every cited claim against the worktrees:

1. `src/wallet/wallet.ts:766-767` is the only shielded handling in `HathorWalletServiceWallet` (grep for `shielded` in the file yields just this comment + skip); the outputs loop requires `decoded.address`, so shielded receives contribute no balance.
2. `src/wallet/wallet.ts:1495` declares `getAddressAtIndex(index: number)` with no `opts`, despite `IHathorWallet` at `src/wallet/types.ts:363` declaring `opts?: IAddressChainOptions` (`src/types.ts:118-120`). TypeScript allows implementing with fewer parameters, so `{ legacy: false }` is silently discarded — the silent-substitution failure was confirmed, not hypothesized.
3. `src/wallet/walletServiceStorageProxy.ts:193` is pass-through only for shielded entries.
4. `git diff master...HEAD --stat -- src/wallet/` shows 25 inserted lines across 3 files; no shielded derivation, crypto provider, send path, or decode exists in the wallet-service wallet.
5. `grep -rln 'v1a/event|NEW_VERTEX_ACCEPTED|EventQueue' src/` is empty — zero event-queue API consumers in wallet-lib.
6. Core side verified at HEAD `00a4532b`: `hathor/event/model/event_data.py:46` (`ShieldedTxOutput`), `:74` (`spent_output` union), `:172` (`shielded_outputs` list), including the in-code comment naming hathor-wallet-service as the intended consumer.

Severity medium was judged appropriate: a silent-incompleteness/parity gap (funds appear to vanish across wallet implementations of the same seed) rather than a bug in the shipped fullnode shielded flows, mitigated by the wallet-service backend not yet being shielded-ready.
