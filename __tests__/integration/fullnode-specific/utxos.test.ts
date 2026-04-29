/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade UTXO query tests.
 *
 * Tests for fullnode-only behavior: the `authorities` filter on
 * `getAvailableUtxos()` and the async-generator surface itself.
 *
 * Shared UTXO tests live in `shared/utxos.test.ts`.
 *
 * `getUtxosForAmount` and `consolidateUtxos` are exclusively fullnode APIs and
 * still live in `hathorwallet_others.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { createTokenHelper, generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../../src/constants';

describe('[Fullnode] getAvailableUtxos', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should yield results via the async generator surface', async () => {
    const hWallet = await generateWalletHelper();

    // Empty wallet — generator should be done immediately
    let generator = hWallet.getAvailableUtxos();
    expect(await generator.next()).toStrictEqual({ done: true, value: undefined });

    const tx = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    // After funding, the generator yields the funding UTXO
    generator = hWallet.getAvailableUtxos();
    const first = await generator.next();
    expect(first).toMatchObject({
      done: false,
      value: {
        txId: tx.hash,
        index: expect.any(Number),
        tokenId: NATIVE_TOKEN_UID,
        address: await hWallet.getAddressAtIndex(0),
        value: 10n,
        authorities: 0n,
        timelock: null,
        heightlock: null,
        locked: false,
        addressPath: expect.stringMatching(/\/0$/),
      },
    });
    expect(await generator.next()).toStrictEqual({ value: undefined, done: true });
  });

  it('should list authority UTXOs when filtering by authorities mask', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'AuthoritiesUtxosToken',
      'AUT',
      100n
    );

    // Default token is HTR — change UTXO surfaces here
    let generator = hWallet.getAvailableUtxos();
    const htrChange = await generator.next();
    expect(htrChange.value).toMatchObject({
      txId: tokenUid,
      tokenId: NATIVE_TOKEN_UID,
      value: 9n,
    });
    expect(await generator.next()).toStrictEqual({ value: undefined, done: true });

    // authorities=3n includes mint and melt authority outputs for the token.
    // The fullnode storage layer accepts the option even though it is not on the
    // GetAvailableUtxosOptions surface — pass through `as unknown` to bypass.
    generator = hWallet.getAvailableUtxos({
      token: tokenUid,
      authorities: 3n,
    } as unknown as Parameters<typeof hWallet.getAvailableUtxos>[0]);
    const authorityUtxos: unknown[] = [];
    for await (const utxo of generator) {
      authorityUtxos.push(utxo);
    }
    expect(authorityUtxos).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          txId: tokenUid,
          tokenId: tokenUid,
          value: TOKEN_MINT_MASK,
          authorities: TOKEN_MINT_MASK,
        }),
        expect.objectContaining({
          txId: tokenUid,
          tokenId: tokenUid,
          value: TOKEN_MELT_MASK,
          authorities: TOKEN_MELT_MASK,
        }),
      ])
    );
  });
});
