/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade start() tests.
 *
 * Defines service-specific tests that rely on {@link HathorWalletServiceWallet}-only
 * APIs (e.g. `isWsEnabled()`) or use mocks that don't belong in integration-level
 * shared tests.
 *
 * Shared start() tests live in `shared/start.test.ts` and run via `describe.each`.
 */

import Mnemonic from 'bitcore-mnemonic';
import { HathorWalletServiceWallet, Storage } from '../../../src';
import { WALLET_SERVICE_AUTH_DERIVATION_PATH } from '../../../src/constants';
import { decryptData } from '../../../src/utils/crypto';
import walletUtils from '../../../src/utils/wallet';
import Network from '../../../src/models/network';
import { NETWORK_NAME } from '../configuration/test-constants';
import { buildWalletInstance, emptyWallet } from '../helpers/service-facade.helper';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const pinCode = '123456';
const password = 'testpass';

const adapter = new ServiceWalletTestAdapter();

// --- Suite lifecycle ---
beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

// --- Service-specific tests ---
describe('[Service-specific] start', () => {
  let wallet: HathorWalletServiceWallet;

  afterEach(async () => {
    if (wallet) {
      try {
        await wallet.stop({ cleanStorage: true });
      } catch {
        // Ignore
      }
    }
  });

  it('should have websocket disabled by default in tests', async () => {
    ({ wallet } = buildWalletInstance({ words: emptyWallet.words }));
    await wallet.start({ pinCode, password });
    expect(wallet.isWsEnabled()).toBe(false);
  });

  // TODO: Move mock-based tests to unit tests
  it('should handle getAccessData unexpected errors', async () => {
    let storage: Storage;
    ({ wallet, storage } = buildWalletInstance({ words: emptyWallet.words }));

    // Exercise the event-emission path during a failed start
    const events: string[] = [];
    wallet.on('state', (state: string) => {
      events.push(`state:${state}`);
    });

    jest.spyOn(storage, 'getAccessData').mockRejectedValueOnce(new Error('Crash'));

    await expect(() => wallet.start({ pinCode, password })).rejects.toThrow('Crash');

    expect(wallet.isReady()).toBe(false);
  });

  // TODO: Move mock-based tests to unit tests
  it('should create wallet with xpriv', async () => {
    let storage: Storage;
    ({ wallet, storage } = buildWalletInstance({ words: emptyWallet.words }));

    const seed = emptyWallet.words;
    const accessData = walletUtils.generateAccessDataFromSeed(seed, {
      networkName: 'testnet',
      password: '1234',
      pin: '1234',
    });

    const code = new Mnemonic(seed);
    const xpriv = code.toHDPrivateKey('', new Network('testnet'));
    const authxpriv = xpriv.deriveChild(WALLET_SERVICE_AUTH_DERIVATION_PATH).xprivkey;
    // '1234' is the pin/password used to encrypt the access data above (generateAccessDataFromSeed),
    // not the wallet start credentials (pinCode/password defined in outer scope).
    expect(accessData.acctPathKey).toBeDefined();
    const acctKey = decryptData(accessData.acctPathKey!, '1234');

    const network = new Network(NETWORK_NAME);
    const requestPassword = jest.fn().mockResolvedValue('test-password');
    wallet = new HathorWalletServiceWallet({
      requestPassword,
      xpriv: acctKey,
      authxpriv,
      network,
      storage,
      enableWs: false,
    });

    await wallet.start({ pinCode, password });

    expect(wallet.isReady()).toBe(true);

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBeDefined();
    expect(currentAddress.address).toEqual(emptyWallet.addresses[currentAddress.index]);
  });
});
