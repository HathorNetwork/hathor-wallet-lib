/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade createNewToken tests.
 *
 * Tests for behavior that depends on fullnode-only APIs (UTXO inspection,
 * `parseScript` on output buffers, multi-wallet propagation guarantees).
 *
 * Shared createNewToken tests live in `shared/create-token.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets, waitForTxReceived } from '../helpers/wallet.helper';
import { TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../../src/constants';
import transaction from '../../../src/utils/transaction';
import CreateTokenTransaction from '../../../src/models/create_token_transaction';
import { TokenVersion } from '../../../src/types';

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

    const authorityOutputs = response.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(2);

    const [mintOutput] = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);
    const mintP2pkh = mintOutput.parseScript(hWallet.getNetworkObject());
    expect(mintP2pkh.address.base58).toEqual(mintAuthorityAddress);

    const [meltOutput] = authorityOutputs.filter(o => o.value === TOKEN_MELT_MASK);
    const meltP2pkh = meltOutput.parseScript(hWallet.getNetworkObject());
    expect(meltP2pkh.address.base58).toEqual(meltAuthorityAddress);

    const tokenBalance = await hWallet.getBalance(response.hash);
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', 100n);
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

    const authorityOutputs = response.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(2);

    const [mintOutput] = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);
    const mintP2pkh = mintOutput.parseScript(hWallet.getNetworkObject());
    expect(mintP2pkh.address.base58).toEqual(externalMintAddr);

    const [meltOutput] = authorityOutputs.filter(o => o.value === TOKEN_MELT_MASK);
    const meltP2pkh = meltOutput.parseScript(hWallet.getNetworkObject());
    expect(meltP2pkh.address.base58).toEqual(externalMeltAddr);

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

    const authorityOutputs = response.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(2);

    const [mintOutput] = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);
    const mintP2pkh = mintOutput.parseScript(hWallet.getNetworkObject());
    expect(mintP2pkh.address.base58).toEqual(mintAuthorityAddress);

    const [meltOutput] = authorityOutputs.filter(o => o.value === TOKEN_MELT_MASK);
    const meltP2pkh = meltOutput.parseScript(hWallet.getNetworkObject());
    expect(meltP2pkh.address.base58).toEqual(meltAuthorityAddress);

    const tokenBalance = await hWallet.getBalance(response.hash);
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', 8582n);
  });
});
