/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shielded outputs on an xpub-only wallet, such as a passkey wallet: its record
 * holds the account xpub and the shielded xpubs its root derives, an external
 * signer signs with keys derived from the root, and the scan key is given to
 * start() and kept in memory only.
 *
 * Needs a fullnode and a tx-mining service that accept shielded outputs, which
 * the default images and privnet.yml do not: point
 * `HATHOR_LIB_INTEGRATION_TESTS_FULLNODE_IMAGE` and
 * `HATHOR_LIB_INTEGRATION_TESTS_TXMINING_IMAGE` at images that do, enable
 * `ENABLE_SHIELDED_TRANSACTIONS` in privnet.yml, install
 * `@hathor/ct-crypto-node` (`npm install --no-save @hathor/ct-crypto-node`),
 * and set `HATHOR_LIB_INTEGRATION_TESTS_SHIELDED_FULLNODE=true`. The
 * experimental shielded-outputs fullnode images allow the test mode only on a
 * network named `privatenet`, so the privnet, the test constants and the
 * genesis wallet helper must then use that network name.
 */

import { HDPrivateKey } from 'bitcore-lib';
import HathorWallet from '../../../src/new/wallet';
import { MemoryStore, Storage } from '../../../src/storage';
import walletUtils from '../../../src/utils/wallet';
import transactionUtils from '../../../src/utils/transaction';
import {
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  NATIVE_TOKEN_UID,
  P2PKH_ACCT_PATH,
  SHIELDED_SPEND_ACCT_PATH,
} from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import type { IShieldedCryptoProvider } from '../../../src/shielded/types';
import { EcdsaTxSign, TxHistoryProcessingStatus } from '../../../src/types';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  waitForTxReceived,
  waitForWalletReady,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { delay, getGapLimitConfig } from '../utils/core.util';
import { NETWORK_NAME, TX_TIMEOUT_DEFAULT } from '../configuration/test-constants';
import { loggers } from '../utils/logger.util';

const describeShielded =
  process.env.HATHOR_LIB_INTEGRATION_TESTS_SHIELDED_FULLNODE === 'true' ? describe : describe.skip;

/**
 * The shielded crypto provider for the tests' runtime, from the native
 * ct-crypto bindings.
 */
function loadCryptoProvider(): IShieldedCryptoProvider {
  // eslint-disable-next-line import/no-unresolved, global-require, @typescript-eslint/no-var-requires -- optional native dependency
  const { createDefaultShieldedCryptoProvider } = require('@hathor/ct-crypto-node/provider');
  return createDefaultShieldedCryptoProvider();
}

describeShielded('[Fullnode-specific] shielded outputs on an xpub-only wallet', () => {
  const wallets: HathorWallet[] = [];

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
    await GenesisWalletHelper.clearListeners();
  });

  /** A seed wallet with a crypto provider, to pay and be paid shielded outputs. */
  async function startSeedWallet(): Promise<HathorWallet> {
    const wallet = new HathorWallet({
      seed: walletUtils.generateWalletWords(),
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      scanPolicy: getGapLimitConfig(),
    });
    wallet.setShieldedCryptoProvider(loadCryptoProvider());
    wallets.push(wallet);
    await wallet.start();
    await waitForWalletReady(wallet);
    return wallet;
  }

  /**
   * A wallet as a passkey wallet runs: the root exists only while the test
   * derives what the wallet needs from it, and in the signer.
   */
  async function startXpubWallet() {
    const root: HDPrivateKey = walletUtils.getXPrivKeyFromSeed(walletUtils.generateWalletWords(), {
      networkName: NETWORK_NAME,
    });
    const accountXpub = root.deriveNonCompliantChild(P2PKH_ACCT_PATH).xpubkey;
    const shieldedXpubs = walletUtils.deriveShieldedXpubs(root);
    const scanXPrivKey = walletUtils.deriveShieldedScanXPrivKey(root);

    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(
      walletUtils.generateAccessDataFromXpub(accountXpub, shieldedXpubs)
    );

    const chains: string[] = [];
    const signer: EcdsaTxSign = (tx, signerStorage) =>
      transactionUtils.signTxInputs(tx, signerStorage, async chain => {
        chains.push(chain);
        return chain === 'spend'
          ? root.deriveChild(SHIELDED_SPEND_ACCT_PATH).deriveChild(0)
          : root.deriveNonCompliantChild(P2PKH_ACCT_PATH).deriveNonCompliantChild(0);
      });

    const wallet = new HathorWallet({
      xpub: accountXpub,
      connection: generateConnection(),
      storage,
      scanPolicy: getGapLimitConfig(),
    });
    wallet.setShieldedCryptoProvider(loadCryptoProvider());
    wallet.setExternalTxSigningMethod(signer, { shieldedSpend: true });
    wallets.push(wallet);
    await wallet.start({ shieldedScanXPrivKey: scanXPrivKey });
    await waitForWalletReady(wallet);
    return { wallet, storage, chains, scanXPrivKey };
  }

  async function htrBalance(wallet: HathorWallet): Promise<bigint> {
    const [balance] = await wallet.getBalance(NATIVE_TOKEN_UID);
    return balance?.balance.unlocked ?? 0n;
  }

  /**
   * Wait until the wallet processed a tx that spends shielded outputs.
   * waitForTxReceived marks the spent outputs itself by their position in
   * `outputs`, which a shielded input's index is not, so the wallet's own
   * processing is awaited instead.
   */
  async function waitForShieldedSpend(wallet: HathorWallet, txId: string): Promise<void> {
    const deadline = Date.now() + TX_TIMEOUT_DEFAULT;
    while (Date.now() < deadline) {
      const tx = await wallet.getTx(txId);
      if (tx && tx.processingStatus === TxHistoryProcessingStatus.FINISHED) {
        return;
      }
      await delay(500);
    }
    throw new Error(`Timeout without receiving the tx ${txId}`);
  }

  it('receives and decodes a shielded output, spends it shielded and credits its own change', async () => {
    const sender = await startSeedWallet();
    const { wallet, storage, chains, scanXPrivKey } = await startXpubWallet();

    expect(await wallet.getShieldedCapability()).toMatchObject({
      level: 'full',
      canReceive: true,
      canSpend: true,
    });
    expect(await wallet.isReadonly()).toBe(false);

    // The sender pays one shielded output; its shielded change is the second one
    await GenesisWalletHelper.injectFunds(sender, await sender.getAddressAtIndex(0), 100n);
    const received = await sender.sendManyOutputsTransaction([
      {
        address: await wallet.getAddressAtIndex(0, { legacy: false }),
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(received!.shieldedOutputs).toHaveLength(2);
    await waitForTxReceived(wallet, received!.hash!);
    await waitUntilNextTimestamp(wallet, received!.hash!);

    expect(await htrBalance(wallet)).toBe(50n);
    expect((await wallet.getShieldedCapability()).undecoded).toMatchObject({ locked: 0 });

    // Spends the shielded utxo into a shielded output, without a PIN: the
    // external signer signs it with the spend chain only
    const spent = await wallet.sendManyOutputsTransaction([
      {
        address: await sender.getAddressAtIndex(0, { legacy: false }),
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(spent!.shieldedOutputs).toHaveLength(2);
    expect(chains).toEqual(['spend']);
    await waitForShieldedSpend(wallet, spent!.hash!);
    await waitForShieldedSpend(sender, spent!.hash!);

    // Its shielded change is decoded with the scan key in memory
    expect(await htrBalance(wallet)).toBe(50n - 20n - 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(await htrBalance(sender)).toBe(100n - 50n - 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT + 20n);
    expect((await wallet.getShieldedCapability()).undecoded).toMatchObject({ locked: 0 });

    // The scan key never reaches the record
    expect(JSON.stringify(await storage.getAccessData())).not.toContain(scanXPrivKey);
  });
});
