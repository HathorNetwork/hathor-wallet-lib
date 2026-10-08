/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * External tx-signing method on the wallet-service facade.
 *
 * Reproduces the passkey-wallet shape end to end: the wallet is registered once from its seed,
 * then runs as an xpub-only wallet started with `startReadOnly()` (read-only token). A registered
 * external signer derives the keys on demand — and, inside the same "ceremony", mints a full auth
 * token with `refreshFullAuthToken` — so sending and token creation work with NO pin.
 */

import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import HathorWalletServiceWallet from '../../../src/wallet/wallet';
import transactionUtils from '../../../src/utils/transaction';
import Network from '../../../src/models/network';
import { P2PKH_ACCT_PATH } from '../../../src/constants';
import {
  buildWalletInstance,
  initializeServiceGlobalConfigs,
  pollForTx,
} from '../helpers/service-facade.helper';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { deriveXpubFromSeed } from '../utils/core.util';

initializeServiceGlobalConfigs();

const pinCode = '123456';
const password = 'testpass';

beforeAll(async () => {
  await GenesisWalletServiceHelper.start();
});

afterAll(async () => {
  await GenesisWalletServiceHelper.stop();
});

describe('[Service] external tx-signing method on an xpub-only wallet', () => {
  let wallet: HathorWalletServiceWallet;

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  it('sends HTR and creates a token with no pin', async () => {
    const { words, addresses } = await precalculationHelpers.test!.getPrecalculatedWallet();

    // 1. Register the wallet on the wallet-service once, from the seed (wallet/init).
    const { wallet: seedWallet } = await buildWalletInstance({ words });
    await seedWallet.start({ pinCode, password });
    await seedWallet.stop({ cleanStorage: true });

    // 2. Run it as an xpub-only wallet: read-only token, no stored private key.
    ({ wallet } = await buildWalletInstance({ xpub: deriveXpubFromSeed(words) }));
    await wallet.startReadOnly();
    await expect(wallet.isReadonly()).resolves.toBe(true);

    // 3. The external signer a passkey wallet would register: derive keys on demand and, in the
    //    same ceremony, mint the full token the send needs.
    const rootXpriv = new Mnemonic(words).toHDPrivateKey('', new Network('testnet'));
    const changeXpriv = rootXpriv
      .deriveNonCompliantChild(P2PKH_ACCT_PATH)
      .deriveNonCompliantChild(0);
    const signer = jest.fn(async (tx, storage) => {
      await wallet.refreshFullAuthToken(HathorWalletServiceWallet.deriveAuthPrivateKey(rootXpriv));
      return transactionUtils.signTxInputs(tx, storage, async () => changeXpriv);
    });
    wallet.setExternalTxSigningMethod(signer);
    await expect(wallet.isReadonly()).resolves.toBe(false);

    await GenesisWalletServiceHelper.injectFunds(addresses[0], 10n, wallet);

    // 4. Send HTR — no pin, never prompting for one.
    const sendTx = await wallet.sendTransaction(addresses[1], 2n);
    expect(sendTx.hash).toBeTruthy();
    await pollForTx(wallet, sendTx.hash!);

    // 5. Create a token — no pin.
    const tokenTx = await wallet.createNewToken('External Signer Token', 'EST', 100n);
    expect(tokenTx.hash).toBeTruthy();
    await pollForTx(wallet, tokenTx.hash!);

    expect(signer).toHaveBeenCalledTimes(2);
    expect(
      (wallet as unknown as { requestPassword: jest.Mock }).requestPassword
    ).not.toHaveBeenCalled();
  });
});
