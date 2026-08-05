/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint max-classes-per-file: ["error", 2] */
import { FULLNODE_URL, WALLET_CONSTANTS } from '../configuration/test-constants';
import { getPrecalculatedShieldedForSeed } from '../configuration/precalculated-shielded-addresses';
import { mergePrecalculatedAddresses } from './wallet-precalculation.helper';
import Connection from '../../../src/new/connection';
import HathorWallet from '../../../src/new/wallet';
import { waitForTxReceived, waitForWalletReady, waitUntilNextTimestamp } from './wallet.helper';
import { loggers } from '../utils/logger.util';
import { delay, getGapLimitConfig } from '../utils/core.util';
import { OutputValueType } from '../../../src/types';
import Transaction from '../../../src/models/transaction';
import { HathorWalletServiceWallet } from '../../../src';
import { buildWalletInstance, pollForTx } from './service-facade.helper';
import { ithService, IthServiceError } from './ith-service';
import { waitPastTxTimestamp } from '../utils/fullnode.util';

interface InjectFundsOptions {
  waitTimeout?: number;
}

/**
 * What funding actually returns now that the broadcast is delegated.
 *
 * The helper's /fund answers with a txId and nothing else, so this is narrowed
 * to exactly that rather than claiming to be a full `Transaction`. A wider type
 * here would compile at every call site while returning `undefined` for
 * `.outputs`, `.inputs` or `.timestamp` — a whole class of silent failures the
 * checker can prevent for free.
 */
export type InjectedFundsTx = Pick<Transaction, 'hash'>;

let singleton: GenesisWalletHelper | null = null;
let singletonService: HathorWalletServiceWallet | null = null;

export class GenesisWalletHelper {
  /**
   * @type HathorWallet
   */
  hWallet!: HathorWallet;

  /**
   * Starts a genesis wallet. Also serves as a reference for wallet creation boilerplate.
   * Only returns when the wallet is in a _READY_ state.
   * @returns {Promise<void>}
   */
  async start(): Promise<void> {
    const { words } = WALLET_CONSTANTS.genesis;
    const pin = '123456';
    const connection = new Connection({
      network: 'testnet',
      servers: [FULLNODE_URL],
      connectionTimeout: 30000,
      logger: console, // Add required logger parameter
    });
    try {
      this.hWallet = new HathorWallet({
        seed: words,
        connection,
        password: 'password',
        pinCode: pin,
        multisig: null,
        // The genesis seed is fixed in-repo, so its shielded pairs are committed
        // fixtures — the genesis wallet starts in nearly every suite, making this
        // the single hottest derivation site in the integration run.
        preCalculatedAddresses: mergePrecalculatedAddresses(
          WALLET_CONSTANTS.genesis.addresses,
          getPrecalculatedShieldedForSeed(words)
        ),
        scanPolicy: getGapLimitConfig(),
      });
      await this.hWallet.start();

      // Only return the positive response after the wallet is ready
      await waitForWalletReady(this.hWallet);
    } catch (e) {
      loggers.test!.error(`GenesisWalletHelper: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * Internal method to send HTR to another wallet's address.
   * @param {HathorWallet} destinationWallet Wallet object that we are sending the funds to
   * @param {string} address
   * @param {OutputValueType} value
   * @param [options]
   * @param {number} [options.waitTimeout] Optional timeout for the websocket confirmation.
   *                                       Passing 0 here skips this waiting.
   * @returns {Promise<InjectedFundsTx>}
   * @private
   */
  // eslint-disable-next-line class-methods-use-this -- funding is delegated to ithService; kept as an instance method to preserve call sites
  async _injectFunds(
    destinationWallet: HathorWallet,
    address: string,
    value: OutputValueType,
    options: InjectFundsOptions = {}
  ): Promise<InjectedFundsTx> {
    // Captured outside the try so the catch can tell "the helper never funded"
    // apart from "it funded and our wallet never saw the tx".
    let fundedTxId: string | undefined;
    try {
      // Funding is delegated to the helper's race-free /fund endpoint rather
      // than broadcast from a locally-synced genesis wallet. The helper returns
      // once the tx is broadcast; we then wait until the destination wallet
      // observes it, which is the guarantee callers actually rely on.
      fundedTxId = (await ithService.fund(address, value)).txId;
      const result: InjectedFundsTx = { hash: fundedTxId };

      if (options.waitTimeout === 0) {
        return result;
      }

      await waitForTxReceived(destinationWallet, fundedTxId, options.waitTimeout);
      // Timestamps are per-second and a tx must be timestamped strictly after
      // its parent. Without this wait, a test that spends the just-funded UTXO
      // within the same second collides with the funding tx and flakes. Applied
      // via the destination wallet, which is the one that now has the tx.
      await waitUntilNextTimestamp(destinationWallet, fundedTxId);
      return result;
    } catch (e) {
      // Delegating the broadcast created a failure mode that did not exist
      // before: the helper funded successfully and our wallet never observed
      // the tx. Without txId that is indistinguishable in the log from "the
      // helper refused to fund", and there is nothing to cross-reference
      // against the helper's own logs or the fullnode.
      const cause =
        e instanceof IthServiceError
          ? `${e.code} (HTTP ${e.status}, retryable=${e.retryable}): ${e.message}`
          : (e as Error).message;
      loggers.test!.error(
        `Failed to inject funds: address=${address} value=${value} ` +
          `txId=${fundedTxId ?? 'not-broadcast'} — ${cause}`
      );
      throw e;
    }
  }

  /**
   * Preferred way to instantiate the GenesisWalletHelper
   */
  static async getSingleton(): Promise<GenesisWalletHelper> {
    if (singleton) {
      return singleton;
    }

    const hWallet = new GenesisWalletHelper();
    await hWallet.start();
    await delay(500);

    singleton = hWallet;
    return singleton;
  }

  /**
   * An easy way to send HTR to another wallet's address for testing.
   * @param {HathorWallet} destinationWallet Wallet object that we are sending the funds to
   * @param {string} address
   * @param {OutputValueType} value
   * @param [options]
   * @param {number} [options.waitTimeout] Optional timeout for the websocket confirmation.
   *                                       Passing 0 here skips this waiting.
   * @returns {Promise<InjectedFundsTx>}
   */
  static async injectFunds(
    destinationWallet: HathorWallet,
    address: string,
    value: OutputValueType,
    options: InjectFundsOptions = {}
  ) {
    const instance = await GenesisWalletHelper.getSingleton();
    return instance._injectFunds(destinationWallet, address, value, options);
  }

  /**
   * Clears all transaction listeners from the genesis wallet.
   * Useful when a test run finishes, to ensure there are no leaks.
   * @return {Promise<void>}
   */
  static async clearListeners(): Promise<void> {
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    gWallet.removeAllListeners('new-tx');
  }
}

export class GenesisWalletServiceHelper {
  static pinCode: string = '123456';

  static password: string = 'genesispass';

  static async pollForServerlessAvailable() {
    let isServerlessReady = false;
    const startTime = Date.now();

    // Poll for the serverless app to be ready.
    const delayBetweenRequests = 3000;
    const lambdaTimeout = 30000;
    while (!isServerlessReady) {
      try {
        // Executing a method that does not depend on the wallet being started,
        // but that ensures the Wallet Service Lambdas are receiving requests
        const gWallet = await GenesisWalletServiceHelper.getSingleton();
        await gWallet.getVersionData();
        isServerlessReady = true;
      } catch (e) {
        // Ignore errors, serverless app is probably not ready yet
        loggers.test!.log('Ws-Serverless not ready yet, retrying in 3 seconds...');
      }

      // Timeout after 30 seconds
      if (Date.now() - startTime > lambdaTimeout) {
        throw new Error('Ws-Serverless did not become ready in time');
      }
      if (!isServerlessReady) {
        await delay(delayBetweenRequests);
      }
    }
    loggers.test!.log(`Ws-Serverless became ready in ${(Date.now() - startTime) / 1000} seconds`);
  }

  static async getSingleton(): Promise<HathorWalletServiceWallet> {
    if (singletonService) {
      return singletonService;
    }

    const { wallet } = await buildWalletInstance({
      words: WALLET_CONSTANTS.genesis.words,
    });

    singletonService = wallet;
    return singletonService;
  }

  static async start({ enableWs = false } = {}): Promise<void> {
    if (enableWs) {
      throw new Error(`Not implemented!`);
    }
    // Wait for serverless to be available before starting the wallet
    await GenesisWalletServiceHelper.pollForServerlessAvailable();

    const gWallet = await GenesisWalletServiceHelper.getSingleton();
    await gWallet.start({
      pinCode: GenesisWalletServiceHelper.pinCode,
      password: GenesisWalletServiceHelper.password,
    });
  }

  static async injectFunds(
    address: string,
    amount: bigint,
    destinationWallet?: HathorWalletServiceWallet
  ): Promise<InjectedFundsTx> {
    // Delegated to the helper's /fund, same as the fullnode path above.
    const { txId } = await ithService.fund(address, amount);
    const fundTx: InjectedFundsTx = { hash: txId };

    if (destinationWallet) {
      // Ensure the destination wallet is also aware of the transaction.
      await pollForTx(destinationWallet, txId);
    } else {
      // No destination wallet to observe with — but returning on the helper's
      // HTTP 200 alone would only mean "broadcast to the fullnode", with
      // wallet-service ingestion still pending. Callers like
      // injectFundsBeforeStart then start a wallet and assert on its history,
      // which becomes a race against the indexer. Poll the genesis wallet
      // instead: it spends the pool UTXO, so it sees the same tx, and this is
      // the guarantee the pre-delegation code provided.
      const gWallet = await GenesisWalletServiceHelper.getSingleton();
      await pollForTx(gWallet, txId);
    }

    // Timestamps are per-second and a transaction may not share its parent's.
    // Callers routinely fund an address and immediately spend that UTXO, and the
    // fullnode rejects the pair with "full validation failed: tx=… timestamp=N,
    // spent_tx=… timestamp=N" when both land in the same second.
    //
    // The wallet service does NOT order this for us -- the fullnode enforces it.
    //
    // Read from the fullnode rather than the wallet: HathorWalletServiceWallet
    // throws `Not implemented` for getTx, so waitUntilNextTimestamp cannot be
    // used on this path.
    await waitPastTxTimestamp(txId);

    return fundTx;
  }

  static async stop() {
    const gWallet = await GenesisWalletServiceHelper.getSingleton();
    await gWallet.stop({ cleanStorage: true });
  }
}
