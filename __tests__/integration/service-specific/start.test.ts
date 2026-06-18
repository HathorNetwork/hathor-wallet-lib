/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade start() tests.
 *
 * Shared start() tests live in `shared/start.test.ts` and run against both
 * facades via `describe.each(adapters)`.
 *
 * Why these tests are NOT shared:
 *   1. `isWsEnabled()` is exposed only on `HathorWalletServiceWallet` — the
 *      fullnode-facade `HathorWallet` has no concept of an admin-toggled
 *      websocket, so the assertion has no shared equivalent.
 *   2. xpriv-based start, readonly (xpub) wallet rejection, and
 *      `getAccessData` error-handling all exercise paths that flow through
 *      the wallet-service auth derivation
 *      (`WALLET_SERVICE_AUTH_DERIVATION_PATH`) and the service-side
 *      `Storage` instance. The fullnode facade's start uses different
 *      derivation semantics; sharing the assertions would force adapter
 *      methods that paper over a real protocol asymmetry.
 *   3. Several tests rely on `Storage` mocking and `decryptData` /
 *      `deriveXpubFromSeed` introspection that operates on the service
 *      facade's internals — fine here, but unsuitable for a shared
 *      integration suite that should treat both facades as black boxes.
 */

import Mnemonic from 'bitcore-mnemonic';
import { HathorWalletServiceWallet, Storage } from '../../../src';
import { WALLET_SERVICE_AUTH_DERIVATION_PATH } from '../../../src/constants';
import { WalletFromXPubGuard } from '../../../src/errors';
import { decryptData } from '../../../src/utils/crypto';
import walletUtils from '../../../src/utils/wallet';
import Network from '../../../src/models/network';
import { NETWORK_NAME } from '../configuration/test-constants';
import { buildWalletInstance, emptyWallet } from '../helpers/service-facade.helper';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { deriveXpubFromSeed } from '../utils/core.util';
import { loggers } from '../utils/logger.util';

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
      } catch (e) {
        loggers.test!.warn('Failed to stop wallet during cleanup', {
          error: (e as Error).message,
        });
      }
    }
  });

  it('should have websocket disabled by default in tests', async () => {
    ({ wallet } = await buildWalletInstance({ words: emptyWallet.words }));
    await wallet.start({ pinCode, password });
    expect(wallet.isWsEnabled()).toBe(false);
  });

  // TODO: Move mock-based tests to unit tests
  it('should handle getAccessData unexpected errors', async () => {
    let storage: Storage;
    ({ wallet, storage } = await buildWalletInstance({ words: emptyWallet.words }));

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
    ({ wallet, storage } = await buildWalletInstance({ words: emptyWallet.words }));

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

  it('should complete start() on a brand-new wallet that goes through creating→ready', async () => {
    // This test exercises the full auth flow: createWallet returns 'creating',
    // then pollForWalletStatus polls until 'ready'. Auth tokens are obtained
    // on-demand by the axios interceptor during each polling call. This is
    // the exact path where the old fire-and-forget pattern raced.
    ({ wallet } = await buildWalletInstance());

    await wallet.start({ pinCode, password });

    expect(wallet.isReady()).toBe(true);
    expect(wallet.getAuthToken()).not.toBeNull();

    // Verify the wallet is functional by checking it has an address
    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.address).toBeDefined();
    expect(currentAddress.index).toBeDefined();
  });

  it('should reject write operations on a readonly (xpub) wallet', async () => {
    const walletData = await adapter.getPrecalculatedWallet();
    const xpub = deriveXpubFromSeed(walletData.words);

    const { wallet: xpubWallet } = await adapter.createWallet({
      seed: walletData.words,
      xpub,
    });
    wallet = xpubWallet as unknown as HathorWalletServiceWallet;

    // Methods requiring private key should throw WalletFromXPubGuard.
    // All calls below deliberately omit required args — the guard rejects before arg validation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = wallet as any;
    await expect(w.sendManyOutputsSendTransaction()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.getPrivateKeyFromAddress()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.signTx()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.createNanoContractTransaction()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.createNanoContractCreateTokenTransaction()).rejects.toThrow(WalletFromXPubGuard);
  });
});
