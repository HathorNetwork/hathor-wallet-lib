/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade sendTransaction tests.
 *
 * Tests that rely on fullnode-only APIs: multisig.
 *
 * Shared sendTransaction tests live in `shared/send-transaction.test.ts`.
 * Shared token tests live in `shared/send-transaction-tokens.test.ts`.
 * Shared address tracking tests live in `shared/send-transaction-address-tracking.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  DEFAULT_PIN_CODE,
  generateMultisigWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import SendTransaction from '../../../src/new/sendTransaction';
import transaction from '../../../src/utils/transaction';

describe('[Fullnode] sendTransaction — multisig', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should send a multisig transaction', async () => {
    const mhWallet1 = await generateMultisigWalletHelper({ walletIndex: 0 });
    const mhWallet2 = await generateMultisigWalletHelper({ walletIndex: 1 });
    const mhWallet3 = await generateMultisigWalletHelper({ walletIndex: 2 });
    await GenesisWalletHelper.injectFunds(mhWallet1, await mhWallet1.getAddressAtIndex(0), 10n);

    const { tx_id: inputTxId, index: inputIndex } = (await mhWallet1.getUtxos()).utxos[0];
    const network = mhWallet1.getNetworkObject();
    const sendTransaction = new SendTransaction({
      storage: mhWallet1.storage,
      inputs: [{ txId: inputTxId, index: inputIndex }],
      outputs: [
        {
          address: await mhWallet1.getAddressAtIndex(1),
          value: 10n,
          token: NATIVE_TOKEN_UID,
        },
      ],
    });
    const tx = transaction.createTransactionFromData(
      { version: 1, ...(await sendTransaction.prepareTxData()) },
      network
    );
    const txHex = tx.toHex();

    const sig1 = await mhWallet1.getAllSignatures(txHex, DEFAULT_PIN_CODE);
    const sig2 = await mhWallet2.getAllSignatures(txHex, DEFAULT_PIN_CODE);
    const sig3 = await mhWallet3.getAllSignatures(txHex, DEFAULT_PIN_CODE);

    await waitUntilNextTimestamp(mhWallet1, inputTxId);

    const partiallyAssembledTx = await mhWallet1.assemblePartialTransaction(txHex, [
      sig1,
      sig2,
      sig3,
    ]);
    partiallyAssembledTx.prepareToSend();
    const finalTx = new SendTransaction({
      storage: mhWallet1.storage,
      transaction: partiallyAssembledTx,
    });

    const sentTx = await finalTx.runFromMining();
    expect(sentTx).toHaveProperty('hash');
    await waitForTxReceived(mhWallet1, sentTx.hash, 10000);

    const historyTx = await mhWallet1.getTx(sentTx.hash);
    expect(historyTx).toMatchObject({
      tx_id: partiallyAssembledTx.hash,
      inputs: [expect.objectContaining({ tx_id: inputTxId, value: 10n })],
    });
  });
});
