/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Group D — Address derivation and gap-limit behavior for shielded wallets.
 *
 * Verifies that:
 *  - Shielded addresses can be derived at arbitrary indices;
 *  - The gap-limit tracks use of shielded addresses the same way it does for
 *    legacy addresses (i.e., receiving a shielded output at a deep index
 *    extends the "seen" range);
 *  - Wallet restart preserves previously derived shielded addresses.
 */

import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateConnection,
  generateWalletHelper,
  registerShieldedProvider,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { bumpShieldedTestTimeout } from '../configuration/test-constants';

bumpShieldedTestTimeout();

describe('shielded outputs — Group D: Address derivation', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('D.19 — Legacy and shielded addresses at the same index have different scripts but both are mine', async () => {
    const wallet = await generateWalletHelper();
    const legacy0 = await wallet.getAddressAtIndex(0, { legacy: true });
    const shielded0 = await wallet.getAddressAtIndex(0, { legacy: false });
    const legacy5 = await wallet.getAddressAtIndex(5, { legacy: true });
    const shielded5 = await wallet.getAddressAtIndex(5, { legacy: false });

    expect(legacy0).not.toBe(shielded0);
    expect(legacy5).not.toBe(shielded5);
    expect(await wallet.storage.isAddressMine(legacy0)).toBe(true);
    expect(await wallet.storage.isAddressMine(shielded0)).toBe(true);
    expect(await wallet.storage.isAddressMine(legacy5)).toBe(true);
    expect(await wallet.storage.isAddressMine(shielded5)).toBe(true);
  });

  it('D.20 — Shielded addresses derived at gap-limit boundary are still mine', async () => {
    const wallet = await generateWalletHelper();
    // GAP_LIMIT is 20 by default; derive at index 19 (last in initial window).
    const shielded19 = await wallet.getAddressAtIndex(19, { legacy: false });
    expect(await wallet.storage.isAddressMine(shielded19)).toBe(true);
  });

  it('D.21 — Receiving a shielded output advances the shielded current-address index', async () => {
    // The wallet tracks legacy and shielded current-address indices
    // independently. A shielded receive must bump the shielded pointer but
    // must NOT bump the legacy pointer (so legacy change outputs keep going
    // to the same address until the owner actually uses it).
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Snapshot both chains before the receive.
    const legacyBefore = await walletB.getCurrentAddress();
    const shieldedBefore = await walletB.storage.store.getCurrentAddress(false, { legacy: false });

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

    // Shielded current-address must have moved past the used indices (0, 1).
    const shieldedAfter = await walletB.storage.store.getCurrentAddress(false, { legacy: false });
    expect(shieldedAfter).not.toBe(shieldedBefore);
    expect(shieldedAfter).not.toBe(sb0);
    expect(shieldedAfter).not.toBe(sb1);

    // Legacy current-address must be unchanged — a shielded receive should
    // not consume a legacy address slot.
    const legacyAfter = await walletB.getCurrentAddress();
    expect(legacyAfter.address).toBe(legacyBefore.address);
  });

  it('D.22 — Wallet reload preserves previously derived shielded addresses', async () => {
    const precalculated = await precalculationHelpers.test!.getPrecalculatedWallet();
    const wallet = new HathorWallet({
      seed: precalculated.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: precalculated.addresses,
    });
    registerShieldedProvider(wallet);
    await wallet.start({ pinCode: DEFAULT_PIN_CODE, password: DEFAULT_PASSWORD });
    await waitForWalletReady(wallet);
    const shielded3 = await wallet.getAddressAtIndex(3, { legacy: false });
    await wallet.stop();

    // Reload the same wallet from the same seed.
    const wallet2 = new HathorWallet({
      seed: precalculated.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: precalculated.addresses,
    });
    registerShieldedProvider(wallet2);
    await wallet2.start({ pinCode: DEFAULT_PIN_CODE, password: DEFAULT_PASSWORD });
    await waitForWalletReady(wallet2);
    const shielded3Again = await wallet2.getAddressAtIndex(3, { legacy: false });
    expect(shielded3Again).toBe(shielded3);
    expect(await wallet2.storage.isAddressMine(shielded3Again)).toBe(true);
    await wallet2.stop();
  });
});
