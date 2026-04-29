/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade address-method tests.
 *
 * Tests that rely on fullnode-only behavior: privkey access via
 * {@link HathorWallet.getAddressPrivKey}, message signing, multisig address
 * derivation, and runtime address derivation past the gap limit.
 *
 * Shared address tests live in `shared/addresses.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  DEFAULT_PIN_CODE,
  generateMultisigWalletHelper,
  generateWalletHelper,
  stopAllWallets,
} from '../helpers/wallet.helper';
import { WALLET_CONSTANTS } from '../configuration/test-constants';
import { verifyMessage } from '../../../src/utils/crypto';

describe('[Fullnode] addresses methods', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should advance current address when funds arrive on it', async () => {
    const hWallet = await generateWalletHelper();

    const currentAddress = await hWallet.getCurrentAddress();
    await GenesisWalletHelper.injectFunds(hWallet, currentAddress.address, 1n);

    const currentAfterTx = await hWallet.getCurrentAddress();
    expect(currentAfterTx).toMatchObject({
      index: currentAddress.index! + 1,
      address: await hWallet.getAddressAtIndex(currentAddress.index! + 1),
    });
  });

  it('should get address privkeys correctly', async () => {
    const hWallet = await generateWalletHelper();
    for (let i = 0; i < 20; i++) {
      const addressHDPrivKey = await hWallet.getAddressPrivKey(DEFAULT_PIN_CODE, i);
      expect(
        addressHDPrivKey.privateKey.toAddress(hWallet.getNetworkObject().bitcoreNetwork).toString()
      ).toStrictEqual(await hWallet.getAddressAtIndex(i));
    }
  });

  it('should sign messages with an address privkey', async () => {
    const hWallet = await generateWalletHelper();
    for (let i = 0; i < 20; i++) {
      const messageToSign = 'sign-me';
      const address = await hWallet.getAddressAtIndex(i);
      const signedMessage = await hWallet.signMessageWithAddress(
        messageToSign,
        i,
        DEFAULT_PIN_CODE
      );

      expect(verifyMessage(messageToSign, signedMessage, address)).toStrictEqual(true);
    }
  });

  it('should get correct addresses for a multisig wallet', async () => {
    const mshWallet = await generateMultisigWalletHelper({ walletIndex: 0 });

    expect((await mshWallet.getCurrentAddress()).address).toStrictEqual(
      WALLET_CONSTANTS.multisig.addresses[0]
    );

    for (let i = 0; i < 21; ++i) {
      expect(await mshWallet.getAddressAtIndex(i)).toStrictEqual(
        WALLET_CONSTANTS.multisig.addresses[i]
      );
    }
  });

  it('should derive an address if it has not been generated yet', async () => {
    const hWallet = await generateWalletHelper();
    await expect(hWallet.getAddressAtIndex(50)).resolves.toBeDefined();

    const mshWallet = await generateMultisigWalletHelper({ walletIndex: 0 });
    await expect(mshWallet.getAddressAtIndex(50)).resolves.toBeDefined();
  });
});
