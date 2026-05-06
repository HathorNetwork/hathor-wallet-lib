/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Verifies that the wallet threads the network-reported
 * `min_tx_weight*` values (via
 * `transactionUtils.getWeightConstantsFromStorage`) into every
 * `Transaction.prepareToSend` invocation, instead of letting it fall
 * back to the hardcoded {@link TX_WEIGHT_CONSTANTS} mainnet defaults.
 *
 * The privnet used by the integration suite reports
 * `min_tx_weight=1, min_tx_weight_coefficient=0, min_tx_weight_k=0`
 * (see `__tests__/integration/configuration/privnet.yml`), which
 * diverges from the defaults (14 / 1.6 / 100) — so checking that
 * `getWeightConstantsFromStorage(storage)` resolves to the privnet
 * triple proves the override is well-formed.
 *
 * The post-send `tx.weight` cannot be inspected directly: the
 * miner's response weight overwrites whatever the wallet computed
 * (see `runFromMining` in `src/new/sendTransaction.ts`). We instead
 * spy on `Transaction.prototype.prepareToSend` to capture the
 * arguments it actually received during a real send.
 *
 * Both wallet facades (fullnode + wallet-service) consume the same
 * `prepareToSend` path, so this is a shared test.
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import type { IStorage } from '../../../src/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { TX_WEIGHT_CONSTANTS } from '../../../src/constants';
import transactionUtils from '../../../src/utils/transaction';
import Transaction from '../../../src/models/transaction';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] tx weight constants — $name', adapter => {
  let wallet: FuzzyWalletType;
  let storage: IStorage;
  let externalWallet: FuzzyWalletType;

  beforeAll(async () => {
    await adapter.suiteSetup();

    const created = await adapter.createWallet();
    wallet = created.wallet;
    storage = created.storage;
    const addr = await wallet.getAddressAtIndex(0);
    await adapter.injectFunds(wallet, addr!, 20n);

    externalWallet = (await adapter.createWallet()).wallet;
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('exposes the network constants via getWeightConstantsFromStorage', async () => {
    const versionData = await wallet.getVersionData();

    // Sanity: this test is only meaningful if the privnet's reported
    // values actually diverge from the hardcoded defaults.
    expect(versionData.minTxWeight).not.toBe(TX_WEIGHT_CONSTANTS.txMinWeight);
    expect(versionData.minTxWeightCoefficient).not.toBe(TX_WEIGHT_CONSTANTS.txWeightCoefficient);
    expect(versionData.minTxWeightK).not.toBe(TX_WEIGHT_CONSTANTS.txMinWeightK);

    const networkConstants = transactionUtils.getWeightConstantsFromStorage(storage);
    expect(networkConstants).toEqual({
      txMinWeight: versionData.minTxWeight,
      txWeightCoefficient: versionData.minTxWeightCoefficient,
      txMinWeightK: versionData.minTxWeightK,
    });
  });

  it('returns undefined when the storage version data is not yet populated', () => {
    // The helper must tolerate a fresh storage where the fullnode's
    // /version response hasn't landed yet — callers fall back to
    // TX_WEIGHT_CONSTANTS in that case.
    const emptyStorage = { version: null } as unknown as IStorage;
    expect(transactionUtils.getWeightConstantsFromStorage(emptyStorage)).toBeUndefined();
  });

  it('threads the network constants through prepareToSend when sending', async () => {
    // We cannot read `tx.weight` after sending: the SendTransaction
    // pipeline (`runFromMining` in src/new/sendTransaction.ts) writes
    // the miner's returned weight onto the tx, overwriting what
    // `prepareToSend` computed locally. On the privnet's test-mode
    // miner, that always lands at 1, so the post-send field tells us
    // nothing about which constants the wallet used.
    //
    // Instead, spy on Transaction.prototype.prepareToSend and check
    // what each invocation receives — that's the exact API surface
    // the override is meant to be threaded through.
    const prepareSpy = jest.spyOn(Transaction.prototype, 'prepareToSend');
    prepareSpy.mockClear();
    try {
      const externalAddr = await externalWallet.getAddressAtIndex(0);
      await adapter.sendTransaction(wallet, externalAddr!, 1n);

      expect(prepareSpy).toHaveBeenCalled();

      // Every prepareToSend call on this code path must have received
      // the network constants from storage — *not* `undefined` (which
      // would silently fall back to TX_WEIGHT_CONSTANTS).
      const networkConstants = transactionUtils.getWeightConstantsFromStorage(storage);
      expect(networkConstants).toBeDefined();

      for (const call of prepareSpy.mock.calls) {
        expect(call[0]).toEqual(networkConstants);
      }
    } finally {
      prepareSpy.mockRestore();
    }
  });
});
