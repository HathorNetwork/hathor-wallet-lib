/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * External private-key provider (setExternalPrivateKeyMethod) on the fullnode facade.
 *
 * Reproduces the passkey-wallet shape end to end: an xpub-only (readonly) wallet whose address
 * private keys come from an external provider instead of a stored, PIN-encrypted key. Covers the
 * real entry points — message signing, getPrivateKeyFromAddress and oracle-data signing — and the
 * provider-integrity check that rejects a key for the wrong address.
 */

import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import { PrivateKey } from 'bitcore-lib';
import HathorWallet from '../../../src/new/wallet';
import { P2PKH_ACCT_PATH } from '../../../src/constants';
import Network from '../../../src/models/network';
import { verifyMessage } from '../../../src/utils/crypto';
import { getOracleBuffer, unsafeGetOracleInputData } from '../../../src/nano_contracts/utils';
import { DEFAULT_PIN_CODE, generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { deriveXpubFromSeed } from '../utils/core.util';
import { WalletError } from '../../../src/errors';

/**
 * Build the provider a passkey signer would register: derive the address key on demand from the
 * seed, the same path the wallet uses for its stored key (m/44'/280'/0'/0/<index>).
 * `indexOffset` lets a test simulate a buggy provider that returns the key of another address.
 */
function makeProvider(words: string, indexOffset = 0) {
  const rootXpriv = new Mnemonic(words).toHDPrivateKey('', new Network('testnet'));
  const changeXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH).deriveNonCompliantChild(0);
  return async (addressIndex: number) =>
    changeXpriv.deriveNonCompliantChild(addressIndex + indexOffset).privateKey;
}

async function startExternalKeyWallet(indexOffset = 0) {
  const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
  const hWallet: HathorWallet = await generateWalletHelper({
    xpub: deriveXpubFromSeed(walletData.words),
    preCalculatedAddresses: walletData.addresses,
  });
  hWallet.setExternalPrivateKeyMethod(makeProvider(walletData.words, indexOffset));
  return { hWallet, walletData };
}

describe('[Fullnode] external private-key provider', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('signs messages on an xpub-only wallet through the provider, with no pin', async () => {
    const { hWallet } = await startExternalKeyWallet();
    // The wallet holds no private key at all; only the provider can sign.
    await expect(hWallet.storage.isReadonly()).resolves.toBe(true);

    for (let i = 0; i < 5; i++) {
      const message = `sign-me-${i}`;
      const signed = await hWallet.signMessageWithAddress(message, i);
      expect(verifyMessage(message, signed, await hWallet.getAddressAtIndex(i))).toBe(true);
    }
  });

  it('getPrivateKeyFromAddress returns the key of the requested address', async () => {
    const { hWallet } = await startExternalKeyWallet();
    const network = hWallet.getNetworkObject().bitcoreNetwork;

    for (let i = 0; i < 5; i++) {
      const address = await hWallet.getAddressAtIndex(i);
      const key = (await hWallet.getPrivateKeyFromAddress(address)) as PrivateKey;
      expect(key).toBeInstanceOf(PrivateKey);
      expect(key.toAddress(network).toString()).toBe(address);
    }
  });

  it('signs oracle data with the provider key, identical to the stored-key (pin) wallet', async () => {
    const { hWallet, walletData } = await startExternalKeyWallet();
    // Same seed, regular wallet: its stored key is the ground truth for the oracle signature.
    const pinWallet: HathorWallet = await generateWalletHelper({
      seed: walletData.words,
      preCalculatedAddresses: walletData.addresses,
    });

    const network = hWallet.getNetworkObject();
    const oracleData = getOracleBuffer(await hWallet.getAddressAtIndex(1), network);
    const result = Buffer.from('oracle-result');

    const viaProvider = await unsafeGetOracleInputData(oracleData, result, hWallet);
    const viaPin = await unsafeGetOracleInputData(oracleData, result, pinWallet, {
      pinCode: DEFAULT_PIN_CODE,
    });
    expect(viaProvider.toString('hex')).toBe(viaPin.toString('hex'));
  });

  it('rejects a provider key that does not belong to the requested address', async () => {
    // A buggy provider returning the key of the NEXT address must never be used to sign.
    const { hWallet } = await startExternalKeyWallet(1);
    const address = await hWallet.getAddressAtIndex(0);

    await expect(hWallet.getPrivateKeyFromAddress(address)).rejects.toThrow(
      'External private key provider returned a key for the wrong address.'
    );
    await expect(hWallet.signMessageWithAddress('sign-me', 0)).rejects.toThrow(
      'External private key provider returned a key for the wrong address.'
    );
  });

  it('rejects a provider that does not return a bitcore PrivateKey', async () => {
    const { hWallet } = await startExternalKeyWallet();
    hWallet.setExternalPrivateKeyMethod(async () => ({ not: 'a key' }));

    await expect(
      hWallet.getPrivateKeyFromAddress(await hWallet.getAddressAtIndex(0))
    ).rejects.toThrow(WalletError);
  });
});
