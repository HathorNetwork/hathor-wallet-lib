/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade authority UTXO tests.
 *
 * Tests that rely on fullnode-only APIs: detailed return shape with extra fields
 * (token, value, height, timelock, type), delegateAuthority, and
 * getMintAuthority/getMeltAuthority with markUtxoSelected.
 *
 * Shared authority UTXO tests live in `shared/authority-utxos.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from '../helpers/wallet.helper';
import { TOKEN_MINT_MASK, TOKEN_MELT_MASK } from '../../../src/constants';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('[Fullnode] getAuthorityUtxos', () => {
  /** @type HathorWallet */
  let hWallet;
  /** @type string */
  let tokenHash;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should work on an empty wallet', async () => {
    expect(await hWallet.getAuthorityUtxos(fakeTokenUid, 'mint')).toStrictEqual([]);
    expect(await hWallet.getAuthorityUtxos(fakeTokenUid, 'melt')).toStrictEqual([]);
    await expect(hWallet.getAuthorityUtxos(fakeTokenUid, 'invalid')).rejects.toThrow(
      'This should never happen.'
    ); // TODO: Improve this error message
  });

  it('should return fullnode-specific fields on authority utxos', async () => {
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getAuthorityUtxos Token',
      'GAUT',
      100n
    );
    tokenHash = tokenUid;

    expect(await hWallet.getAuthorityUtxos(tokenHash, 'mint')).toStrictEqual([
      {
        txId: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        token: tokenHash,
        authorities: 1n,
        value: 1n,
        height: null,
        timelock: null,
        type: expect.any(Number),
      },
    ]);
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'melt')).toStrictEqual([
      {
        txId: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        token: tokenHash,
        timelock: null,
        height: null,
        authorities: TOKEN_MELT_MASK,
        value: 2n,
        type: expect.any(Number),
      },
    ]);
  });

  it('should find delegated mint authority utxo', async () => {
    const mintDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'mint',
      await hWallet.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet, mintDelegationTx.hash);

    expect(await hWallet.getAuthorityUtxos(tokenHash, 'mint')).toMatchObject([
      {
        txId: mintDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      },
    ]);
  });

  it('should find many "melt" authority utxos after delegation', async () => {
    const meltDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'melt',
      await hWallet.getAddressAtIndex(1),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet, meltDelegationTx.hash);

    const expectedMeltAuthUtxos = [
      {
        txId: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
        height: null,
        timelock: null,
        token: tokenHash,
        type: expect.any(Number),
        value: TOKEN_MELT_MASK,
      },
      {
        txId: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
        height: null,
        timelock: null,
        token: tokenHash,
        type: expect.any(Number),
        value: TOKEN_MELT_MASK,
      },
    ];
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'melt')).toStrictEqual(expectedMeltAuthUtxos);
  });
});

describe('[Fullnode] authority utxo selection', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('getMintAuthority', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to test', 'ATST', 100n);

    // Mark mint authority as selected_as_input
    const [mintInput] = await hWallet.getMintAuthority(tokenUid, { many: false });
    await hWallet.markUtxoSelected(mintInput.txId, mintInput.index, true);

    // getMintAuthority should return even if the utxo is already selected_as_input
    await expect(hWallet.getMintAuthority(tokenUid, { many: false })).resolves.toStrictEqual([
      mintInput,
    ]);
    await expect(
      hWallet.getMintAuthority(tokenUid, { many: false, only_available_utxos: false })
    ).resolves.toStrictEqual([mintInput]);

    // getMintAuthority should not return selected_as_input utxos if only_available_utxos is true
    await expect(
      hWallet.getMintAuthority(tokenUid, { many: false, only_available_utxos: true })
    ).resolves.toStrictEqual([]);
  });

  it('getMeltAuthority', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to test', 'ATST', 100n);

    // Mark melt authority as selected_as_input
    const [meltInput] = await hWallet.getMeltAuthority(tokenUid, { many: false });
    await hWallet.markUtxoSelected(meltInput.txId, meltInput.index, true);

    // getMeltAuthority should return even if the utxo is already selected_as_input
    await expect(hWallet.getMeltAuthority(tokenUid, { many: false })).resolves.toStrictEqual([
      meltInput,
    ]);
    await expect(
      hWallet.getMeltAuthority(tokenUid, { many: false, only_available_utxos: false })
    ).resolves.toStrictEqual([meltInput]);

    // getMeltAuthority should not return selected_as_input utxos if only_available_utxos is true
    await expect(
      hWallet.getMeltAuthority(tokenUid, { many: false, only_available_utxos: true })
    ).resolves.toStrictEqual([]);
  });
});
