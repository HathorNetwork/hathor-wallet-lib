/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group C — shielded coverage for wallet APIs the existing suite never asserts.
 *
 * The rest of the shielded suite asserts wallet-wide getBalance / history /
 * spendability, and ALWAYS pre-derives the destination via getAddressAtIndex
 * before a receive. That left whole surfaces unexercised — per-address info,
 * tx-address attribution, the transparent/shielded split in getUtxos, and
 * auto-discovery of a receive on a not-pre-derived address. These tests pin
 * those, and would have caught the corresponding code gaps.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import Address from '../../../src/models/address';
import { deriveShieldedAddress } from '../../../src/utils/shieldedAddress';
import { IHistoryTx } from '../../../src/types';

describe('shielded outputs — Group C: API completeness for shielded receives', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  // Spend-derived P2PKH (on-chain form) for a user-facing 71-byte shielded addr.
  const spendOf = (wallet, shieldedAddr) =>
    new Address(shieldedAddr, { network: wallet.getNetworkObject() }).getSpendAddress().base58;

  it('C.1 — getTxAddresses returns the shielded-spend P2PKHs of a shielded-only receive', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);

    const stored = await walletB.getTx(tx!.hash!);
    const addrs = await walletB.getTxAddresses(stored!);

    // The owned shielded receives are attributed by their on-chain spend P2PKH.
    expect(addrs.has(spendOf(walletB, sb0))).toBe(true);
    expect(addrs.has(spendOf(walletB, sb1))).toBe(true);
    // The 71-byte shielded addresses are NOT on-chain and must never appear.
    expect(addrs.has(sb0)).toBe(false);
    expect(addrs.has(sb1)).toBe(false);
  });

  it('C.2 — getAddressInfo reflects a shielded receive on the spend P2PKH', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // A shielded send needs >= 2 shielded outputs (anti trivial-commitment-match);
    // only sb0's 40n should land on sb0's per-address totals.
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);

    const info = await walletB.getAddressInfo(spendOf(walletB, sb0));
    expect(info.total_amount_received).toBe(40n);
    expect(info.total_amount_available).toBe(40n);
    expect(info.total_amount_sent).toBe(0n);
  });

  it('C.3 — getUtxos excludes shielded UTXOs by default; { shielded: true } includes them', async () => {
    const walletB = await generateWalletHelper();
    const addrB = await walletB.getAddressAtIndex(0, { legacy: true });
    await GenesisWalletHelper.injectFunds(walletB, addrB, 100n);

    // Self-shield 50n total (>= 2 shielded outputs required) -> walletB owns
    // 50n of shielded UTXOs + 50n transparent change.
    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const shieldTx = await walletB.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, shieldTx!.hash!);

    // Total balance = transparent change + shielded (minus the tx fee). Assert
    // the PARTITION rather than a hardcoded change amount (fee-robust).
    const totalBalance = (await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    // Opt-in surfaces exactly the 50n we shielded.
    const shieldedOnly = await walletB.getUtxos({ shielded: true });
    expect(shieldedOnly.total_amount_available).toBe(50n);

    // Default = transparent-only (this list feeds consolidation, which spends
    // its results as transparent inputs — shielded UTXOs must not leak in), so
    // it excludes the shielded 50n.
    const transparentOnly = await walletB.getUtxos();
    expect(transparentOnly.total_amount_available).toBe(totalBalance - 50n);

    // The two views partition the balance — no shielded double-count, no omission.
    expect(transparentOnly.total_amount_available + shieldedOnly.total_amount_available).toBe(
      totalBalance
    );
  });

  it('C.4 — a shielded receive on a NOT-pre-derived address is auto-discovered + credited', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Derive walletB's shielded address at an index it has NOT explicitly
    // requested, straight from its xpubs — exactly what every other test skips
    // by calling getAddressAtIndex first. walletB must auto-discover the receive.
    const scanXpub = await walletB.storage.getScanXPubKey();
    const spendXpub = await walletB.storage.getSpendXPubKey();
    const network = walletB.getNetworkObject();
    // Two not-pre-derived indices (>= 2 shielded outputs required).
    const derived12 = deriveShieldedAddress(scanXpub!, spendXpub!, 12, network.name);
    const derived13 = deriveShieldedAddress(scanXpub!, spendXpub!, 13, network.name);

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: derived12.base58,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: derived13.base58,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);

    // walletB auto-discovered both addresses (never explicitly requested them).
    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(40n);
    const info = await walletB.getAddressInfo(derived12.spendAddress);
    expect(info.total_amount_received).toBe(25n);
  });

  it('C.5 — new-tx event payload carries shielded_outputs for a shielded receive', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sb0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const sb1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const seen: IHistoryTx[] = [];
    walletB.on('new-tx', (t: IHistoryTx) => seen.push(t));

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: sb0,
        value: 35n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sb1,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    await waitForTxReceived(walletB, tx!.hash!);

    const evt = seen.find(t => t?.tx_id === tx!.hash);
    expect(evt).toBeDefined();
    expect((evt.shielded_outputs ?? []).length).toBeGreaterThan(0);
  });
});
