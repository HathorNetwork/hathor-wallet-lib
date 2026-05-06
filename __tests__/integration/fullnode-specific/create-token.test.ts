/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade createNewToken tests.
 *
 * Shared createNewToken tests live in `shared/create-token.test.ts` and run
 * against both facades via `describe.each(adapters)`.
 *
 * Why these tests are NOT shared:
 * The address-routing tests below verify that mint/melt authority outputs
 * land on the requested addresses by calling `parseScript` on raw `Output`
 * buffers and reading `.address.base58`. The wallet-service facade has no
 * equivalent path — it returns authority routing information through
 * `getUtxoFromId(txId, index)`, which returns `null` on the fullnode side.
 *
 * Sharing them would require a new adapter method that papers over a real
 * API asymmetry (script parsing vs. service lookup) for very few tests,
 * which is more abstraction than is justified at the current count. The
 * service-side equivalents live in `service-specific/create-token.test.ts`
 * and assert the same routing through `getUtxoFromId` directly.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import CreateTokenTransaction from '../../../src/models/create_token_transaction';
import { TokenVersion } from '../../../src/types';
import { expectAuthoritiesRoutedTo } from '../utils/authority-utxos.util';

describe('[Fullnode] createNewToken', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should create a new token on the correct addresses', async () => {
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    const destinationAddress = await hWallet.getAddressAtIndex(4);
    const changeAddress = await hWallet.getAddressAtIndex(8);
    const { hash: tokenUid } = await hWallet.createNewToken('NewToken Name', 'NTKN', 100n, {
      address: destinationAddress,
      changeAddress,
    });
    await waitForTxReceived(hWallet, tokenUid);

    const { utxos: tokenUtxos } = await hWallet.getUtxos({ token: tokenUid });
    expect(tokenUtxos).toContainEqual(
      expect.objectContaining({ address: destinationAddress, amount: 100n })
    );

    const { utxos: htrUtxos } = await hWallet.getUtxos();
    expect(htrUtxos).toContainEqual(
      expect.objectContaining({ address: changeAddress, amount: 9n })
    );

    // Defense-in-depth alongside the UTXO check above: a balance mismatch
    // would catch silent double-counting that a per-UTXO assertion can miss.
    const htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toBe(9n);
  });

  it('should create a token with mint and melt authority addresses', async () => {
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const mintAuthorityAddress = await hWallet.getAddressAtIndex(10);
    const meltAuthorityAddress = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 2n);

    const response = await hWallet.createNewToken('New Token', 'NTKN', 100n, {
      createMint: true,
      mintAuthorityAddress,
      createMelt: true,
      meltAuthorityAddress,
    });
    expect(response).toHaveProperty('hash');
    await waitForTxReceived(hWallet, response.hash);

    expectAuthoritiesRoutedTo(response.outputs, hWallet.getNetworkObject(), {
      mintAddress: mintAuthorityAddress,
      meltAddress: meltAuthorityAddress,
    });

    const tokenBalance = await hWallet.getBalance(response.hash);
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', 100n);

    // 2n injected − 1n deposit = 1n HTR remaining
    const htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toBe(1n);
  });

  it('should reject external mint/melt addresses unless explicitly allowed', async () => {
    const hWallet = await generateWalletHelper();
    const externalWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const externalMintAddr = await externalWallet.getAddressAtIndex(0);
    const externalMeltAddr = await externalWallet.getAddressAtIndex(1);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 1n);

    await expect(
      hWallet.createNewToken('New Token', 'NTKN', 100n, {
        createMint: true,
        mintAuthorityAddress: externalMintAddr,
      })
    ).rejects.toThrow('must belong to your wallet');

    await expect(
      hWallet.createNewToken('New Token', 'NTKN', 100n, {
        createMelt: true,
        meltAuthorityAddress: externalMeltAddr,
      })
    ).rejects.toThrow('must belong to your wallet');

    const response: CreateTokenTransaction = await hWallet.createNewToken(
      'New Token',
      'NTKN',
      100n,
      {
        createMint: true,
        mintAuthorityAddress: externalMintAddr,
        allowExternalMintAuthorityAddress: true,
        createMelt: true,
        meltAuthorityAddress: externalMeltAddr,
        allowExternalMeltAuthorityAddress: true,
      }
    );

    expect(response).toHaveProperty('hash');
    await waitForTxReceived(hWallet, response.hash);
    await waitForTxReceived(externalWallet, response.hash);

    expectAuthoritiesRoutedTo(response.outputs, hWallet.getNetworkObject(), {
      mintAddress: externalMintAddr,
      meltAddress: externalMeltAddr,
    });

    const tokenBalance = await hWallet.getBalance(response.hash);
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', 100n);
  });

  // FEE-token variants of the address-routing tests above. They live alongside
  // their DBT counterparts because createNewToken's address handling cannot be
  // exhaustively validated without exercising both token versions.

  it('should create a FEE token on the correct addresses', async () => {
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    const destinationAddress = await hWallet.getAddressAtIndex(4);
    const changeAddress = await hWallet.getAddressAtIndex(8);

    const { hash: tokenUid } = await hWallet.createNewToken('FeeBasedToken', 'FBT', 8582n, {
      address: destinationAddress,
      changeAddress,
      tokenVersion: TokenVersion.FEE,
    });
    await waitForTxReceived(hWallet, tokenUid);

    const { utxos: tokenUtxos } = await hWallet.getUtxos({ token: tokenUid });
    expect(tokenUtxos).toContainEqual(
      expect.objectContaining({ address: destinationAddress, amount: 8582n })
    );

    // 10n HTR injected - 1n FEE = 9n HTR change
    const { utxos: htrUtxos } = await hWallet.getUtxos();
    expect(htrUtxos).toContainEqual(
      expect.objectContaining({ address: changeAddress, amount: 9n })
    );

    const htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toBe(9n);
  });

  it('should create a FEE token with mint and melt authority addresses', async () => {
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const mintAuthorityAddress = await hWallet.getAddressAtIndex(10);
    const meltAuthorityAddress = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 2n);

    const response = await hWallet.createNewToken('New Token', 'NTKN', 8582n, {
      createMint: true,
      mintAuthorityAddress,
      createMelt: true,
      meltAuthorityAddress,
      tokenVersion: TokenVersion.FEE,
    });
    expect(response).toHaveProperty('hash');
    await waitForTxReceived(hWallet, response.hash);

    expectAuthoritiesRoutedTo(response.outputs, hWallet.getNetworkObject(), {
      mintAddress: mintAuthorityAddress,
      meltAddress: meltAuthorityAddress,
    });

    const tokenBalance = await hWallet.getBalance(response.hash);
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', 8582n);
  });
});
