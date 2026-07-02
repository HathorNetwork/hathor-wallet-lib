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
import { GAP_LIMIT } from '../../../src/constants';

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

    // The fullnode facade derives every index locally (no gap-limit window), so
    // we verify the whole precalculated multisig set. The bound is the length of
    // that precalculated list, not a magic number.
    const expected = WALLET_CONSTANTS.multisig.addresses;
    for (let i = 0; i < expected.length; i++) {
      expect(await mshWallet.getAddressAtIndex(i)).toStrictEqual(expected[i]);
    }
  });

  it('should derive an address if it has not been generated yet', async () => {
    // The fullnode facade derives addresses on demand and is NOT bounded by
    // GAP_LIMIT (unlike the wallet-service facade, which only loads a GAP_LIMIT
    // window from its backend). Use an index comfortably past GAP_LIMIT to prove
    // derivation is uncapped — a fresh wallet has only ~GAP_LIMIT addresses
    // loaded, yet this index still resolves.
    const farIndex = GAP_LIMIT + 30; // 50 with the current GAP_LIMIT of 20
    const hWallet = await generateWalletHelper();
    await expect(hWallet.getAddressAtIndex(farIndex)).resolves.toBeDefined();

    const mshWallet = await generateMultisigWalletHelper({ walletIndex: 0 });
    await expect(mshWallet.getAddressAtIndex(farIndex)).resolves.toBeDefined();
  });
});
