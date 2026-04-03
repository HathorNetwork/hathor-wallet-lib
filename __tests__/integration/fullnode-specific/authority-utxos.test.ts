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
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from '../helpers/wallet.helper';
import { TOKEN_MINT_MASK, TOKEN_MELT_MASK } from '../../../src/constants';

describe('[Fullnode] getAuthorityUtxos — fullnode-specific', () => {
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
        authorities: TOKEN_MINT_MASK,
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

  // createAnother produces 2 authority outputs on the fullnode but the wallet-service
  // backend does not reliably return both via its API, so this stays fullnode-specific.
  it('should find many melt authority utxos after delegation with createAnother', async () => {
    const meltDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'melt',
      await hWallet.getAddressAtIndex(1),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet, meltDelegationTx.hash);

    const meltUtxos = await hWallet.getAuthorityUtxos(tokenHash, 'melt');
    expect(meltUtxos).toHaveLength(2);
    meltUtxos.forEach(utxo => {
      expect(utxo.authorities).toBe(TOKEN_MELT_MASK);
      expect(utxo.txId).toBe(meltDelegationTx.hash);
    });
  });

  it('should return single utxo with many: false when multiple exist', async () => {
    // After the previous delegation there are 2 melt authority UTXOs
    const allMelt = await hWallet.getMeltAuthority(tokenHash, { many: true });
    expect(allMelt.length).toBeGreaterThan(1);

    const singleMelt = await hWallet.getMeltAuthority(tokenHash, { many: false });
    expect(singleMelt).toHaveLength(1);
    expect(singleMelt[0].authorities).toBe(TOKEN_MELT_MASK);
  });

  it('should find delegated mint authority utxo with createAnother', async () => {
    const mintDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'mint',
      await hWallet.getAddressAtIndex(2),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet, mintDelegationTx.hash);

    const mintUtxos = await hWallet.getAuthorityUtxos(tokenHash, 'mint');
    expect(mintUtxos).toHaveLength(2);
    mintUtxos.forEach(utxo => {
      expect(utxo.authorities).toBe(TOKEN_MINT_MASK);
      expect(utxo.txId).toBe(mintDelegationTx.hash);
    });

    const singleMint = await hWallet.getMintAuthority(tokenHash, { many: false });
    expect(singleMint).toHaveLength(1);
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
