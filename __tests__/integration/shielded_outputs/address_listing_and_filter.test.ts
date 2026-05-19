/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group Q — two related cross-chain plumbing fixes:
 *
 *   Q.1  `Storage.getAllAddresses({ legacy })` enumerates either the
 *        legacy chain or the user-facing shielded receive chain. The
 *        previous iterator hardcoded "skip shielded entries" and gave
 *        no way to ask for them.
 *
 *   Q.2  `selectUtxos({ filter_address })` accepts the user-facing
 *        shielded address (the 71-byte encoded form) and matches
 *        shielded UTXOs against it — previously the filter compared
 *        directly against `utxo.address` (the spend-derived P2PKH
 *        that labels the on-chain output), so passing the shielded
 *        receive form filtered every shielded UTXO out.
 */

import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import * as constants from '../../../src/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(constants as any).TIMEOUT = 30000;

describe('shielded outputs — Group Q: address listing + UTXO filter cross-chain plumbing', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('Q.1 — getAllAddresses({ legacy: false }) lists the loaded shielded chain in BIP32-index order', async () => {
    const wallet: HathorWallet = await generateWalletHelper();

    // Force the shielded chain to populate by deriving a few indexes.
    // getAddressAtIndex({ legacy: false }) saves both the shielded
    // receive entry AND the matching spend-P2PKH at the same index.
    const triggered = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      triggered.push(await wallet.getAddressAtIndex(i, { legacy: false }));
    }

    // legacy=true (default) returns the legacy chain — NONE of the
    // shielded receive addresses appear here.
    const legacyList: string[] = [];
    for await (const entry of wallet.getAllAddresses()) {
      legacyList.push(entry.address);
    }
    for (const shielded of triggered) {
      expect(legacyList).not.toContain(shielded);
    }

    // legacy=false returns the shielded chain. The wallet-lib's
    // startup gap-limit derivation may have pre-populated more
    // shielded indices than my explicit triggers, so we don't assert
    // equality on the full list — just that my triggered addresses
    // are present, in their original BIP32-index order, and that
    // every entry is shielded-shaped.
    const shieldedList: string[] = [];
    for await (const entry of wallet.getAllAddresses({ legacy: false })) {
      shieldedList.push(entry.address);
    }
    for (const a of triggered) {
      expect(shieldedList).toContain(a);
    }
    // BIP32-index order preserved across the triggered subset.
    const positions = triggered.map(t => shieldedList.indexOf(t));
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    // None of them are legacy-shaped (legacy P2PKH ~34 chars, shielded
    // 71-byte encoded ~97-99 chars).
    for (const a of shieldedList) {
      expect(a.length).toBeGreaterThanOrEqual(50);
    }
  });

  it('Q.1 — shielded-spend (internal) entries are NOT exposed on either chain', async () => {
    // The shielded-spend P2PKH is what utxo.address actually carries
    // for an on-chain shielded output, but it's an INTERNAL artifact —
    // users should never see it in the wallet's address listings on
    // either chain. Surfacing it under legacy would leak an internal
    // identifier; surfacing it under shielded would let a caller try
    // to share it as a shielded receive target (it isn't).
    const wallet: HathorWallet = await generateWalletHelper();
    const shielded0 = await wallet.getAddressAtIndex(0, { legacy: false });

    // Identify the spend P2PKH for shielded index 0 — it's the
    // sibling entry in storage at the same BIP32 index with
    // addressType 'shielded-spend'.
    let spendP2pkh: string | null = null;
    for await (const info of wallet.storage.store.addressIter()) {
      if (info.bip32AddressIndex === 0) {
        // Won't trigger since this iter is legacy-only — but we keep
        // the loop body symmetric so any future iter change still
        // gives us a deterministic test.
        spendP2pkh = spendP2pkh ?? null;
      }
    }
    // Pull it directly from the per-address map instead.
    for (const info of (
      wallet.storage.store as {
        addresses: Map<string, { addressType?: string; bip32AddressIndex: number; base58: string }>;
      }
    ).addresses.values()) {
      if (info.addressType === 'shielded-spend' && info.bip32AddressIndex === 0) {
        spendP2pkh = info.base58;
        break;
      }
    }
    expect(spendP2pkh).not.toBeNull();
    expect(spendP2pkh).not.toBe(shielded0);

    const legacyList: string[] = [];
    for await (const entry of wallet.getAllAddresses()) legacyList.push(entry.address);
    const shieldedList: string[] = [];
    for await (const entry of wallet.getAllAddresses({ legacy: false })) {
      shieldedList.push(entry.address);
    }

    expect(legacyList).not.toContain(spendP2pkh);
    expect(shieldedList).not.toContain(spendP2pkh);
  });

  it('Q.2 — selectUtxos filter_address accepts the user-facing shielded address', async () => {
    // The bug: a caller passing the user-facing shielded address as
    // `filter_address` would see zero matching UTXOs because the
    // storage compared it directly against utxo.address (the spend
    // P2PKH). After the fix, the storage resolves the shielded form
    // to its sibling spend P2PKH at the same index and matches.

    const wallet: HathorWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(wallet, await wallet.getAddressAtIndex(0), 200n);

    // Self-receive two shielded UTXOs at distinct indices so we can
    // tell the filter is actually picking the right one (not just
    // returning everything by accident).
    const shieldedAddr10 = await wallet.getAddressAtIndex(10, { legacy: false });
    const shieldedAddr11 = await wallet.getAddressAtIndex(11, { legacy: false });
    const tx = await wallet.sendManyOutputsTransaction([
      {
        address: shieldedAddr10,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddr11,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(wallet, tx!.hash!);

    // Filter by the user-facing shielded address at index 10 — should
    // return exactly the one UTXO at that address (value 30).
    const at10: Array<{ value: bigint; address: string }> = [];
    for await (const utxo of wallet.storage.selectUtxos({ filter_address: shieldedAddr10 })) {
      at10.push({ value: utxo.value, address: utxo.address });
    }
    expect(at10).toHaveLength(1);
    expect(at10[0].value).toBe(30n);
    // The returned utxo.address is the spend P2PKH (that's what's
    // on-chain) — the filter resolved the shielded form internally.
    expect(at10[0].address).not.toBe(shieldedAddr10);

    // Filter by the user-facing shielded address at index 11 — should
    // return the 20n UTXO and nothing else.
    const at11: Array<{ value: bigint }> = [];
    for await (const utxo of wallet.storage.selectUtxos({ filter_address: shieldedAddr11 })) {
      at11.push({ value: utxo.value });
    }
    expect(at11).toHaveLength(1);
    expect(at11[0].value).toBe(20n);
  });

  it('Q.2 — selectUtxos filter_address still works for legacy P2PKH (no regression)', async () => {
    // The shielded-resolution fix runs unconditionally — it must not
    // break the existing legacy-address filter behaviour.
    const wallet: HathorWallet = await generateWalletHelper();
    const legacyAddr = await wallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(wallet, legacyAddr, 50n);

    const matches: Array<{ value: bigint; address: string }> = [];
    for await (const utxo of wallet.storage.selectUtxos({ filter_address: legacyAddr })) {
      matches.push({ value: utxo.value, address: utxo.address });
    }
    expect(matches.length).toBeGreaterThanOrEqual(1);
    for (const m of matches) {
      // Legacy filter: utxo.address must equal the passed legacy
      // address exactly (no shielded translation since the entry
      // isn't of addressType 'shielded').
      expect(m.address).toBe(legacyAddr);
    }
  });
});
