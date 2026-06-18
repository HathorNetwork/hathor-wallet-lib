# TEST-05: Stream-sync (XPUB_STREAM_WS / MANUAL_STREAM_WS) shielded address derivation is completely untested — and its swallow-all catch makes regressions silent

**Severity:** medium - **Status:** confirmed by adversarial review

## Summary

The integration added per-address shielded address derivation inside `StreamManager.processQueue()` (the handler for address items in the stream-based history-sync modes), wrapped in a try/catch that only logs and continues. There is not a single test — unit or integration — exercising the stream sync path with shielded keys: `__tests__/stream.test.ts` is byte-identical to master, no test anywhere references `StreamManager`, and none of the 23 shielded integration suites configures `XPUB_STREAM_WS` or `MANUAL_STREAM_WS`. If this derivation ever regresses (throws, or silently returns `null`), the wallet never registers its shielded addresses and every shielded receive becomes invisible, with nothing but a log line to show for it.

## Location

- `src/sync/stream.ts:566-587` — shielded derivation in `StreamManager.processQueue()`, swallow-all catch
- `src/sync/stream.ts:260-284` and `src/sync/stream.ts:286-310` — new `pinCode` parameter threaded through `xpubStreamSyncHistory` / `manualStreamSyncHistory`, untested
- `src/sync/stream.ts:831-832` — `processHistory(pinCode)` after the stream finishes
- `src/shielded/processing.ts:105-111` — receive-side dependence on registered addresses (skip when not mine)
- `__tests__/stream.test.ts` — unchanged from master, zero shielded coverage
- `__tests__/integration/shielded_outputs/` — 23 suites, all running the default polling sync only

## Details

The address-item branch of `StreamManager.processQueue()` now derives and saves the shielded address pair at the same BIP32 index as each streamed transparent address (`src/sync/stream.ts:560-587`):

```ts
      if (isStreamItemAddress(item)) {
        const addr = item.address;
        const alreadyExists = await this.storage.isAddressMine(addr.base58);
        if (!alreadyExists) {
          await this.storage.saveAddress(addr);
        }
        // Generate shielded address pair at the same index (if keys are available).
        // Wrapped in try/catch so derivation failures don't crash the queue.
        try {
          const shieldedResult = await deriveShieldedAddressFromStorage(
            addr.bip32AddressIndex,
            this.storage
          );
          if (shieldedResult) {
            if (!(await this.storage.isAddressMine(shieldedResult.shieldedAddress.base58))) {
              await this.storage.saveAddress(shieldedResult.shieldedAddress);
            }
            if (!(await this.storage.isAddressMine(shieldedResult.spendAddress.base58))) {
              await this.storage.saveAddress(shieldedResult.spendAddress);
            }
          }
        } catch (e) {
          this.logger.error(
            'Failed to derive shielded address at index',
            addr.bip32AddressIndex,
            e
          );
        }
      }
```

Two silent-failure paths exist:

1. **Exception path** — any throw from `deriveShieldedAddressFromStorage` (bad key material, ct-crypto failure, storage error) is caught, logged via `this.logger.error`, and the queue moves on. Nothing is surfaced to the caller, no error state is set on the manager, and the stream completes "successfully".
2. **Null path** — `deriveShieldedAddressFromStorage` (`src/utils/address.ts:178-186`) returns `null` whenever `storage.getScanXPubKey()` or `storage.getSpendXPubKey()` is missing. This is by design for non-shielded wallets, but it also means a shielded wallet whose keys failed to load takes the same silent no-op branch — without even a log line in that case.

The downstream consequence is total: after the stream, `streamSyncHistory` calls `manager.storage.processHistory(pinCode)` (`src/sync/stream.ts:831-832`), which runs `processShieldedOutputs` (`src/utils/storage.ts:963`). That function skips any shielded output whose `decoded.address` is not a registered wallet address (`src/shielded/processing.ts:110-111`):

```ts
    const addressInfo = await storage.getAddressInfo(address);
    if (!addressInfo) continue;
```

This skip-when-unknown behavior is itself pinned by a unit test (`__tests__/shielded/processing.test.ts:138-148`, "should skip outputs for unknown addresses"). So if stream-sync fails to register the shielded/spend addresses, no decryption is even attempted, no rewind happens later (unknown addresses trigger no reprocessing), and shielded funds simply never appear.

**The test gap is exhaustive:**

- `git diff master...HEAD -- __tests__/stream.test.ts` → empty diff; the file contains no occurrence of "shielded".
- `grep -rn -E "HistorySyncMode|STREAM_WS|xpubStreamSyncHistory|manualStreamSyncHistory|streamSyncHistory|StreamManager" __tests__/integration/` → zero matches; all 23 suites under `__tests__/integration/shielded_outputs/` run the default polling sync.
- No test in the entire repository references `StreamManager`.
- `deriveShieldedAddressFromStorage` is tested only directly (`__tests__/utils/address.test.ts`, `__tests__/storage/memory_store.test.ts`), never through the stream path.
- The new optional `pinCode` parameter added to both stream entry points (`src/sync/stream.ts:266`, `src/sync/stream.ts:292`) and forwarded to `processHistory` (`src/sync/stream.ts:832`) has no coverage either — a regression that drops the pin (making post-stream shielded decryption fail) would also pass the suite.

**Additional risk the missing tests would surface:** in stream modes the fullnode-side address set is derived from the account xpub only — `loadAddressesCPUIntensive` produces plain BIP44 P2PKH addresses (`src/sync/stream.ts:240-254`), and in `XPUB_STREAM_WS` the fullnode derives them itself. The spend-derived P2PKH addresses come from a *different* xpub (`getSpendXPubKey`), so unlike the polling path — where `loadAddresses` explicitly pushes `spendAddress.base58` into the fetched/subscribed set (`src/utils/storage.ts:119-131`) — it is not evident that transactions paying only shielded spend addresses are ever included in the streamed history at all. Whether this is a real functional gap or handled elsewhere is exactly the kind of question an integration test comparing stream-sync vs polling-sync balances would answer; today nothing answers it.

## Source of truth

- The client integration guide requires wallets to derive and register the shielded address pair alongside each transparent address so incoming shielded outputs can be matched by their on-chain `decoded.address` (see `SHIELDED_INTEGRATION_REVIEW/reference/client-guide-checklist.md`, address derivation/registration items). The wallet's own polling-sync implementation (`src/utils/storage.ts:117-131`) treats this as mandatory per index — a sync-mode choice must not change which funds a wallet can see, so the stream path must provide equivalent guarantees.
- hathor-core indexes transactions by on-chain script address (the spend-derived P2PKH), not by the user-facing shielded address — acknowledged by the wallet's own comment at `src/utils/storage.ts:126-130`. A wallet that fails to register spend addresses therefore has no other mechanism to discover shielded receives.

## Impact

A user whose wallet (or an embedding application such as the desktop/mobile wallets) is configured with `HistorySyncMode.XPUB_STREAM_WS` or `MANUAL_STREAM_WS` and holds shielded keys depends on completely unverified code for the registration of every shielded address:

- If `deriveShieldedAddressFromStorage` throws on this path (e.g., a future refactor changes its preconditions, key decryption fails, ct-crypto misbehaves), the stream completes normally, the wallet reports READY, and all shielded receives — past and future, since no rewind is attempted for unknown addresses — are silently missing. The only artifact is a `logger.error` line.
- If the scan/spend xpubs are unexpectedly absent, the `null` branch produces the same outcome with no log at all.
- Any regression in the new `pinCode` threading breaks post-stream shielded decryption the same silent way.

The failure mode is "wallet shows less money than it has" with no error surfaced — among the worst possible outcomes for a wallet library. Severity is medium rather than high only because this is a coverage gap on a non-default sync mode, not a demonstrated bug in the current code.

## Recommendation

1. **Unit tests for `StreamManager` address handling** (extend `__tests__/stream.test.ts`):
   - With shielded keys present in storage: process an address stream item and assert that both `shieldedAddress` and `spendAddress` are saved at the same `bip32AddressIndex` as the transparent address.
   - With `deriveShieldedAddressFromStorage` mocked to throw: assert the queue continues processing subsequent items, **and** that the failure is surfaced beyond a log line — e.g., the manager records the failed indices or sets an error/degraded flag that `streamSyncHistory` can expose, so callers can trigger re-derivation or warn the user instead of silently under-reporting balance. Sketch:

   ```ts
   } catch (e) {
     this.shieldedDerivationFailures.push(addr.bip32AddressIndex);
     this.logger.error('Failed to derive shielded address at index', addr.bip32AddressIndex, e);
   }
   // after shutdown: if (manager.shieldedDerivationFailures.length) { emit event / set error / retry }
   ```

   - A test pinning that `xpubStreamSyncHistory` / `manualStreamSyncHistory` forward `pinCode` into `storage.processHistory` (`src/sync/stream.ts:831-832`).
2. **Integration coverage:** parameterize one existing shielded receive suite (e.g., `__tests__/integration/shielded_outputs/core.test.ts`) — or add a dedicated `stream_sync.test.ts` — to run a shielded receive under `HistorySyncMode.XPUB_STREAM_WS` and `MANUAL_STREAM_WS`, asserting the credited shielded balance and registered addresses equal the polling-sync result for the same seed. This would also definitively answer whether spend-address transactions are present in the streamed history at all (see Details).

## Verification notes

The skeptic panel confirmed all claims independently:

1. **Code path:** `src/sync/stream.ts:566-587` re-read — the try/catch only calls `this.logger.error` and continues; the `null` return (keys unavailable) is also silent. No error state, no event, no rethrow.
2. **Impact chain:** `src/sync/stream.ts:831-832` → `processHistory(pinCode)` → `src/utils/storage.ts:963` `processShieldedOutputs` → `src/shielded/processing.ts:110-111` `if (!addressInfo) continue;`. The skip behavior for unknown addresses is pinned by `__tests__/shielded/processing.test.ts:138-148`.
3. **Test absence (exhaustive):** `git diff master...HEAD -- __tests__/stream.test.ts` is empty (file last touched in pre-shielded commit 5a08f53b) and contains no "shielded" reference; grep for `HistorySyncMode`/`STREAM_WS`/`xpubStreamSyncHistory`/`manualStreamSyncHistory`/`streamSyncHistory`/`StreamManager` over `__tests__/integration` returns zero matches across all 23 shielded suites; no test anywhere references `StreamManager`; `deriveShieldedAddressFromStorage` is tested only directly (`__tests__/utils/address.test.ts`, `__tests__/storage/memory_store.test.ts`), never via the stream path; the new `pinCode` parameters (`src/sync/stream.ts:266`, `:292`) are untested.
4. **Refutation attempts failed:** the alternate derivation sites (`src/utils/storage.ts:119` polling loader, `src/new/wallet.ts:843` `getAddressAtIndex`) do not run during stream sync and would not reprocess already-synced history, so they cannot compensate for a stream-path failure.
5. **Severity calibration:** medium is correct — a test gap with a silent missing-funds failure mode on a non-default sync mode, not a demonstrated bug in the current happy path.
