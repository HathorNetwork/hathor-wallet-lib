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
 * (token, value, height, timelock, type), and
 * getMintAuthority/getMeltAuthority with markUtxoSelected.
 *
 * Shared authority UTXO tests live in `shared/authority-utxos.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { createTokenHelper, generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import { TOKEN_MELT_MASK } from '../../../src/constants';

describe('[Fullnode] getAuthorityUtxos — fullnode-specific fields', () => {
  /** @type HathorWallet */
  let hWallet;
  /** @type string */
  let tokenHash;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getAuthorityUtxos Token',
      'GAUT',
      100n
    );
    tokenHash = tokenUid;
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should return fullnode-specific fields on authority utxos', async () => {
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

  it('should throw on invalid authority type', async () => {
    await expect(hWallet.getAuthorityUtxos(tokenHash, 'invalid')).rejects.toThrow(
      'This should never happen.'
    );
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
