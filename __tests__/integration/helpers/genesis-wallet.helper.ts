/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { WALLET_CONSTANTS } from '../configuration/test-constants';
import { HathorWalletServiceWallet } from '../../../src';
import { buildWalletInstance, pollForTx } from './service-facade.helper';
import { ithService } from './ith-service';
import { loggers } from '../utils/logger.util';
import { delay } from '../utils/time.util';
import { waitPastTxTimestamp } from '../utils/fullnode.util';
import type { InjectedFundsTx } from './funding.helper';

let singletonService: HathorWalletServiceWallet | null = null;

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
