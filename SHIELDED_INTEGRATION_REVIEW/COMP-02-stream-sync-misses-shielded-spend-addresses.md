# COMP-02: Stream-based history sync (XPUB_STREAM_WS / MANUAL_STREAM_WS) never covers shielded-spend addresses — restored wallets miss all shielded receives

**Severity:** high - **Status:** confirmed by adversarial review

**Also reported as:** STATE-07 (stream history-sync modes never request history for shielded spend addresses) — merged here. Related test-coverage gap: TEST-05.

## Summary

The polling history-sync path was updated to include the shielded spend-derived P2PKH addresses (account `m/44'/280'/2'/0`) in the address set queried against the fullnode, but neither WebSocket streaming mode was. Both stream modes derive/send only account-0 (`m/44'/280'/0'`) addresses, so history vertices whose only wallet-relevant scripts are shielded outputs are never streamed. A wallet restored from seed using `XPUB_STREAM_WS` or `MANUAL_STREAM_WS` silently shows zero shielded balance; the stream consumer's local derivation of the shielded address pair masks the gap (addresses exist in storage, history does not).

## Location

- `src/sync/stream.ts:233-254` — `loadAddressesCPUIntensive` derives only account-0 P2PKH children ("This only contemplates P2PKH addresses for now")
- `src/sync/stream.ts:416-423` — both stream modes capture only `accessData.xpubkey` (account 0')
- `src/sync/stream.ts:467-502` — `generateNextBatch` (manual mode) sends only that batch
- `src/sync/stream.ts:661-690` — `sendStartMessage`: xpub mode sends only the account-0 xpub; manual mode sends only account-0 addresses
- `src/sync/stream.ts:566-587` — shielded address pair saved locally per streamed address, but its history is never requested
- `src/utils/storage.ts:117-131` — polling path contrast: pushes `shieldedResult.spendAddress.base58` into the queried set
- `src/utils/storage.ts:71-84` — `getSupportedSyncMode` allows both stream modes for P2PKH wallets regardless of shielded keys
- `src/new/wallet.ts:3784-3801` — `syncHistory` has no guard for shielded wallets; downgrades to polling only on missing node capability

## Details

Shielded receives are on-chain P2PKH scripts of the **spend** public key, derived on a sibling hardened account:

- `src/constants.ts:356`: `SHIELDED_SPEND_ACCT_PATH = m/44'/280'/2'`
- `src/utils/shieldedAddress.ts` (`deriveShieldedAddress`): the on-chain address is `publicKeyToP2PKH(spendKey.publicKey, network)` from the **spendXpubkey** chain (`m/44'/280'/2'/0`).

The polling sync path accounts for this. `loadAddresses` in `src/utils/storage.ts:117-131` derives the shielded pair at each BIP32 index and adds the spend-derived P2PKH to the set of addresses whose history is fetched:

```ts
// src/utils/storage.ts:117-131
const shieldedResult = await deriveShieldedAddressFromStorage(i, storage);
if (shieldedResult) {
  ...
  // Only the spend-derived P2PKH is subscribed for tx notifications.
  addresses.push(shieldedResult.spendAddress.base58);
}
```

The streaming paths do not. Both stream modes initialize from the account-0 xpub only:

```ts
// src/sync/stream.ts:416-423 (setupStream)
const { xpubkey } = accessData;
...
this.xpubkey = xpubkey;
```

The address generator used by the manual stream is explicitly account-0-only:

```ts
// src/sync/stream.ts:233-254
/**
 * Load addresses in a CPU intensive way
 * This only contemplates P2PKH addresses for now.
 */
export function loadAddressesCPUIntensive(startIndex, count, xpubkey, networkName) {
  ...
  const hdpubkey = new HDPublicKey(xpubkey);
  for (let i = startIndex; i < stopIndex; i++) {
    const key = hdpubkey.deriveChild(i);
    addresses.push([i, new BitcoreAddress(key.publicKey, network.bitcoreNetwork).toString()]);
  }
  ...
}
```

- **Manual mode** (`MANUAL_STREAM_WS`): `sendStartMessage` (`src/sync/stream.ts:671-684`) and `generateNextBatch` (`src/sync/stream.ts:482-495`) send only batches produced by `loadAddressesCPUIntensive` from `this.xpubkey`. Spend-chain addresses are never in any batch.
- **Xpub mode** (`XPUB_STREAM_WS`): `sendStartMessage` (`src/sync/stream.ts:663-669`) sends only `this.xpubkey`; the fullnode derives addresses server-side from that single xpub and can never reach the hardened sibling account 2'.

What makes this easy to miss: the stream consumer **does** derive and save the shielded address pair for every streamed address (`src/sync/stream.ts:566-587`), so after a stream sync the storage contains all the shielded/spend addresses — but no fullnode ever matched vertices against them. `streamSyncHistory` ends with `processHistory` only (no backfill), and `checkGapLimit`'s shielded branch (`src/utils/storage.ts:424-427`) keys off `shieldedLastUsedAddressIndex`, which never advances under stream sync because no shielded vertices arrive — so the gap-limit machinery cannot trigger a backfill either.

There is also no guard: `getSupportedSyncMode` (`src/utils/storage.ts:71-84`) returns both stream modes for any P2PKH wallet, with no check for `spendXpubkey` in access data, and `syncHistory` (`src/new/wallet.ts:3784-3801`) falls back to polling only when the fullnode lacks the `history-streaming` capability.

## Source of truth

- hathor-core indexes shielded receives by the address parsed from the shielded output's on-chain script — `hathor-core:hathor/transaction/base_transaction.py:508-512` (`for shielded_out in self.shielded_outputs: script_type_out = parse_address_script(shielded_out.script); addresses.add(script_type_out.address)`). So the fullnode CAN stream these vertices — but only if asked about the spend-derived addresses.
- hathor-core's xpub streamer derives strictly from the single provided xpub via non-hardened child derivation — `hathor-core:hathor/websocket/iterators.py:97-114` (`iter_xpub_addresses`: `key = xpub.subkey(idx)`). It has no knowledge of the wallet-side scan/spend account convention; core defines no shielded address format at all (`hathor-core:hathor/conf/mainnet.py:23-24` has only the standard P2PKH/multisig version bytes).
- The core WebSocket streamer matches vertices only against the addresses/xpub the client provided (`hathor-core:hathor/websocket/streamer.py:~276,300`).

Conclusion: matching shielded vertices is entirely the client's responsibility — it must include the spend-chain addresses in the stream request, exactly as the polling path already does.

## Impact

Concrete scenario: a user with shielded funds restores their wallet from seed in a consumer that configured `historySyncMode = XPUB_STREAM_WS` (e.g., the desktop wallet's streaming sync) or `MANUAL_STREAM_WS`.

1. The stream covers only account-0 addresses; every history vertex that pays **only** shielded outputs (a pure shielded receive) is never delivered.
2. The wallet completes sync "successfully" and reports zero shielded balance — silent loss of fund visibility, with no error and no warning.
3. Storage does contain the shielded addresses (saved locally at `src/sync/stream.ts:566-587`), so nothing looks misconfigured; later real-time WS events for new transactions may partially populate history, producing inconsistent/confusing balance accounting for the previously missed UTXOs (e.g., a spend of an untracked shielded UTXO appears without its funding tx).

Mitigating factors (why high rather than critical): the default `historySyncMode` is `POLLING_HTTP_API` (`src/new/wallet.ts:430`), so only consumers explicitly opting into stream modes are affected, and funds are recoverable by re-syncing with polling. The failure mode — silent zero balance after seed restore in a shipped sync mode — keeps this at high.

## Recommendation

Pick one (or layer them):

1. **Manual stream (proper fix):** interleave the spend-derived P2PKH addresses into each batch. `loadAddressesCPUIntensive` (or a wrapper) should also derive `spendXpub.deriveChild(i)` → P2PKH when access data carries `spendXpubkey`, and include those `[index, address]` pairs in the payload sent by `sendManualStreamingHistory` (`src/sync/stream.ts:482-495`, `:671-684`). The fullnode matches by address, so this works with no core changes.
2. **Xpub stream:** either run a second stream for the spend xpub (`m/44'/280'/2'/0`) after the first completes, or downgrade to `MANUAL_STREAM_WS`/`POLLING_HTTP_API` in `syncHistory` when access data contains `spendXpubkey` (core's single-xpub streamer cannot cover two accounts in one stream).
3. **Minimum safe stopgap:** make `getSupportedSyncMode` (`src/utils/storage.ts:71-84`) exclude the stream modes when access data has shielded keys, so `syncHistory` hard-fails (or auto-downgrades to polling) instead of silently missing funds.

Sketch for the stopgap:

```ts
export async function getSupportedSyncMode(storage: IStorage): Promise<HistorySyncMode[]> {
  const walletType = await storage.getWalletType();
  const accessData = await storage.getAccessData();
  const hasShieldedKeys = !!accessData?.spendXpubkey;
  if (walletType === WalletType.P2PKH) {
    return hasShieldedKeys
      ? [HistorySyncMode.POLLING_HTTP_API]
      : [HistorySyncMode.MANUAL_STREAM_WS, HistorySyncMode.POLLING_HTTP_API, HistorySyncMode.XPUB_STREAM_WS];
  }
  ...
}
```

Add a regression test: restore a wallet with shielded keys, sync via each stream mode (or assert the mode is refused), and assert shielded-receive history is present.

## Verification notes

Confirmed independently by three reviewers at every cited location; all converged:

1. **Stream coverage gap:** `loadAddressesCPUIntensive` derives only account-0 children from `accessData.xpubkey` (`src/sync/stream.ts:233-254`, `:416-423`); manual batches (`:482-495`, `:671-684`) and the xpub start message (`:663-669`) carry nothing else. Verified `SHIELDED_SPEND_ACCT_PATH = m/44'/280'/2'` (`src/constants.ts:356`) is a hardened sibling account unreachable from the account-0 xpub, and unreachable server-side since core's `iter_xpub_addresses` uses plain `xpub.subkey(idx)` (`hathor-core:hathor/websocket/iterators.py:97-114`).
2. **Core-side premise:** shielded vertices ARE indexed under the spend-derived P2PKH parsed from `shielded_out.script` (`hathor-core:hathor/transaction/base_transaction.py:508-512`), so streaming those addresses would work — the wallet just never sends them.
3. **Polling asymmetry:** `src/utils/storage.ts:117-131` pushes `shieldedResult.spendAddress.base58` into the queried set; the stream consumer only saves the pair locally (`src/sync/stream.ts:566-587`), masking the gap.
4. **No compensation anywhere:** exhaustive grep found no `spendXpub`/`spendAddress` handling in sync/connection paths; `getSupportedSyncMode` has no shielded check; `syncHistory` downgrades only on missing node capability; `streamSyncHistory` ends with `processHistory` with no backfill; `checkGapLimit`'s shielded branch cannot fire because `shieldedLastUsedAddressIndex` never advances when no shielded vertices arrive.
5. **Severity calibration:** default sync mode is `POLLING_HTTP_API` (`src/new/wallet.ts:430`) and funds are recoverable via a polling resync, so not critical; silent zero-balance on seed restore in a shipped sync mode keeps it at high.

## Evidence folded from STATE-07 (merged duplicate)

- **Real-time receives are missed too, not just historical sync.** The fullnode streamer auto-subscribes only the addresses/xpub the client streamed (hathor-core:hathor/websocket/streamer.py:61,276), and wallet-side `connection.subscribeAddresses` exists solely on the polling path (`src/utils/storage.ts:177`) — so under stream modes the wallet misses incoming shielded payments in real time as well.
- Stream modes are the ones recommended for large wallets and used by hathor-wallet-headless, so merchant/exchange deployments would silently fail to credit shielded deposits.
