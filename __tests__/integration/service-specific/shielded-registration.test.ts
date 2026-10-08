/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade shielded registration and reads.
 *
 * Needs a wallet-service with shielded registration and the shielded read API
 * (wallet-service #473–#477). The published `:dev` images do not have it yet:
 * build the images from wallet-service `origin/master`, point the
 * `HATHOR_LIB_INTEGRATION_TESTS_WALLET_SERVICE_{LAMBDAS,DAEMON,MIGRATOR}_IMAGE`
 * variables at them, and set `HATHOR_LIB_INTEGRATION_TESTS_SHIELDED=true`.
 */

import { HathorWalletServiceWallet } from '../../../src';
import { WALLET_SERVICE_AUTH_DERIVATION_PATH } from '../../../src/constants';
import { deriveShieldedAddress } from '../../../src/utils/shieldedAddress';
import walletUtils from '../../../src/utils/wallet';
import { NETWORK_NAME } from '../configuration/test-constants';
import { buildWalletInstance, retryOnTransientWalletInit } from '../helpers/service-facade.helper';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { loggers } from '../utils/logger.util';

const pinCode = '123456';
const password = 'testpass';

const describeShielded =
  process.env.HATHOR_LIB_INTEGRATION_TESTS_SHIELDED === 'true' ? describe : describe.skip;

const adapter = new ServiceWalletTestAdapter();

/** The shielded address at an index, derived locally from the wallet's own keys. */
async function localShieldedAddress(wallet: HathorWalletServiceWallet, index: number) {
  const accessData = await wallet.storage.getAccessData();
  return deriveShieldedAddress(
    accessData.scanXpubkey!,
    accessData.spendXpubkey!,
    index,
    NETWORK_NAME
  );
}

describeShielded('[Service-specific] shielded registration', () => {
  const wallets: HathorWalletServiceWallet[] = [];

  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  afterEach(async () => {
    while (wallets.length > 0) {
      const wallet = wallets.pop()!;
      try {
        await wallet.stop({ cleanStorage: true });
      } catch (e) {
        loggers.test!.warn('Failed to stop wallet during cleanup', {
          error: (e as Error).message,
        });
      }
    }
  });

  it('registers a new seed wallet with its shielded keys', async () => {
    const { wallet } = await buildWalletInstance({ words: walletUtils.generateWalletWords() });
    wallets.push(wallet);
    await retryOnTransientWalletInit(() => wallet.start({ pinCode, password }), 'start');

    expect(wallet.isShieldedEnabled()).toBe(true);

    const expected = await localShieldedAddress(wallet, 0);
    const current = wallet.getCurrentAddress({}, { legacy: false });
    expect(current.address).toBe(expected.base58);
    expect(current).toMatchObject({ spendAddress: expected.spendAddress });

    const listed: string[] = [];
    for await (const row of wallet.getAllAddresses({ legacy: false })) {
      listed.push(row.address);
    }
    expect(listed[0]).toBe(expected.base58);
    await expect(wallet.getAddressAtIndex(1, { legacy: false })).resolves.toBe(
      (await localShieldedAddress(wallet, 1)).base58
    );

    await expect(wallet.isAddressMine(expected.base58)).resolves.toBe(true);
    await expect(wallet.getBalance('00', { split: true })).resolves.toEqual(expect.any(Array));
  });

  it('upgrades a legacy-only wallet when it starts from the seed', async () => {
    const words = walletUtils.generateWalletWords();

    // Register legacy-only first: an xpriv wallet has no shielded keys
    const root = walletUtils.getXPrivKeyFromSeed(words, { networkName: NETWORK_NAME });
    const { wallet: legacyWallet } = await buildWalletInstance({ words });
    const xprivWallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn().mockResolvedValue(password),
      xpriv: root.deriveNonCompliantChild("m/44'/280'/0'").xprivkey,
      authxpriv: root.deriveNonCompliantChild(WALLET_SERVICE_AUTH_DERIVATION_PATH).xprivkey,
      network: legacyWallet.network,
      storage: legacyWallet.storage,
    });
    wallets.push(xprivWallet);
    await retryOnTransientWalletInit(() => xprivWallet.start({ pinCode, password }), 'xpriv start');
    expect(xprivWallet.isShieldedEnabled()).toBe(false);
    await xprivWallet.stop({ cleanStorage: true });
    wallets.pop();

    // Same wallet id, now started from the seed: the shielded keys are attached
    const { wallet } = await buildWalletInstance({ words });
    wallets.push(wallet);
    await retryOnTransientWalletInit(() => wallet.start({ pinCode, password }), 'seed start');
    expect(wallet.walletId).toBe(xprivWallet.walletId);
    expect(wallet.isShieldedEnabled()).toBe(true);
    expect(wallet.getCurrentAddress({}, { legacy: false }).address).toBe(
      (await localShieldedAddress(wallet, 0)).base58
    );
  });
});
