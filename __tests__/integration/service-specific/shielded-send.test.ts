/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade shielded sends.
 *
 * Needs a wallet-service with shielded registration, the shielded read API
 * and tx proposals that accept shielded inputs, plus a shielded crypto
 * provider. Run with HATHOR_LIB_INTEGRATION_TESTS_SHIELDED_SEND=true against
 * images built from a wallet-service that has them (see
 * shielded-registration.test.ts for the image variables).
 */

import { HathorWalletServiceWallet } from '../../../src';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import walletUtils from '../../../src/utils/wallet';
import {
  buildWalletInstance,
  pollForTx,
  pollUntilCondition,
  retryOnTransientWalletInit,
} from '../helpers/service-facade.helper';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { loggers } from '../utils/logger.util';

const pinCode = '123456';
const password = 'testpass';

const describeShieldedSend =
  process.env.HATHOR_LIB_INTEGRATION_TESTS_SHIELDED_SEND === 'true' ? describe : describe.skip;

const adapter = new ServiceWalletTestAdapter();

/**
 * The shielded crypto provider for the tests' runtime, from the native
 * ct-crypto bindings.
 */
async function loadCryptoProvider() {
  // eslint-disable-next-line import/no-unresolved, global-require, @typescript-eslint/no-var-requires -- optional native dependency
  const { createDefaultShieldedCryptoProvider } = require('@hathor/ct-crypto-node');
  return createDefaultShieldedCryptoProvider();
}

describeShieldedSend('[Service-specific] shielded sends', () => {
  const wallets: HathorWalletServiceWallet[] = [];

  async function startWallet() {
    const { wallet } = await buildWalletInstance({ words: walletUtils.generateWalletWords() });
    wallets.push(wallet);
    wallet.setShieldedCryptoProvider(await loadCryptoProvider());
    await retryOnTransientWalletInit(() => wallet.start({ pinCode, password }), 'start');
    return wallet;
  }

  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  afterEach(async () => {
    while (wallets.length > 0) {
      try {
        await wallets.pop()!.stop({ cleanStorage: true });
      } catch (e) {
        loggers.test!.warn('Failed to stop wallet during cleanup', {
          error: (e as Error).message,
        });
      }
    }
  });

  it('sends to a shielded address, then spends and unshields the received utxo', async () => {
    const sender = await startWallet();
    const receiver = await startWallet();
    await GenesisWalletServiceHelper.injectFunds(sender.getCurrentAddress().address, 100n, sender);

    const receiving = receiver.getCurrentAddress({}, { legacy: false }).address;
    const shieldedTx = await sender.sendManyOutputsTransaction(
      [
        {
          address: receiving,
          value: 30n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ],
      { pinCode }
    );
    await pollForTx(receiver, shieldedTx.hash!);
    // The tx is visible before the wallet-service indexes its utxos: wait for
    // the received shielded utxo before spending it
    await pollUntilCondition(
      async () => (await receiver.getUtxos({ shielded: true })).utxos.length > 0,
      'received shielded utxo indexed'
    );

    const [received] = await receiver.getBalance(NATIVE_TOKEN_UID, { split: true });
    expect(received.balance.unlocked.shielded).toBe(30n);

    // Spending the shielded utxo back to a transparent address unshields it
    const unshieldTx = await receiver.sendManyOutputsTransaction(
      [{ address: sender.getCurrentAddress().address, value: 10n, token: NATIVE_TOKEN_UID }],
      { pinCode }
    );
    await pollForTx(sender, unshieldTx.hash!);
    const [after] = await receiver.getBalance(NATIVE_TOKEN_UID, { split: true });
    expect(after.balance.unlocked.total).toBeLessThan(30n);
  });
});
