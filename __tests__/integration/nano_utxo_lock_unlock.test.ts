/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isEmpty } from 'lodash';
import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitTxConfirmed,
} from './helpers/wallet.helper';
import HathorWallet from '../../src/new/wallet';
import { NATIVE_TOKEN_UID, NANO_CONTRACTS_INITIALIZE_METHOD } from '../../src/constants';
import { NanoContractTransactionError } from '../../src/errors';
import { SendTransaction } from '../../src';

describe('Nano contract UTXO lock/unlock lifecycle', () => {
  let hWallet: HathorWallet;
  let contractId: string;

  const checkTxValid = async (wallet: HathorWallet, tx: { hash?: string | null }) => {
    const txId = tx.hash!;
    expect(txId).toBeDefined();
    await waitForTxReceived(wallet, txId);
    await waitTxConfirmed(wallet, txId, null);
    const txAfterExecution = await wallet.getFullTxById(txId);
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(txAfterExecution.meta.first_block).not.toBeNull();
  };

  beforeAll(async () => {
    hWallet = await generateWalletHelper(null);
    const address = await hWallet.getAddressAtIndex(0);

    await GenesisWalletHelper.injectFunds(hWallet, address, 10000n, {});

    const initTx = await hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address,
      {
        blueprintId: global.FEE_BLUEPRINT_ID,
        args: [],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 1000n,
            changeAddress: address,
          },
        ],
      }
    );
    await checkTxValid(hWallet, initTx);
    contractId = initTx.hash!;
  });

  afterAll(async () => {
    await hWallet.stop();
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should lock UTXOs on prepare and unlock with releaseUtxos()', async () => {
    const address = await hWallet.getAddressAtIndex(0);

    // Use full balance to ensure all UTXOs are consumed
    const balanceMap = await hWallet.getBalance(NATIVE_TOKEN_UID);
    const availableBalance = balanceMap[0]?.balance?.unlocked ?? 0n;
    expect(availableBalance).toBeGreaterThan(0n);
    const depositAmount = availableBalance;

    let activeSendTx: SendTransaction | null = null;
    try {
      // Step 1: Prepare tx (UTXOs get locked)
      const sendTx1: SendTransaction = await hWallet.createNanoContractTransaction(
        'noop',
        address,
        {
          ncId: contractId,
          args: [],
          actions: [
            {
              type: 'deposit',
              token: NATIVE_TOKEN_UID,
              amount: depositAmount,
              changeAddress: address,
            },
          ],
        },
        { signTx: false }
      );
      activeSendTx = sendTx1;

      expect(sendTx1.transaction).not.toBeNull();
      expect(sendTx1.transaction!.inputs.length).toBeGreaterThan(0);

      // Step 2: Second prepare should fail (UTXOs still locked)
      await expect(
        hWallet.createNanoContractTransaction(
          'noop',
          address,
          {
            ncId: contractId,
            args: [],
            actions: [
              {
                type: 'deposit',
                token: NATIVE_TOKEN_UID,
                amount: depositAmount,
                changeAddress: address,
              },
            ],
          },
          { signTx: false }
        )
      ).rejects.toThrow(NanoContractTransactionError);

      // Step 3: Release locked UTXOs
      await sendTx1.releaseUtxos();
      activeSendTx = null;

      // Step 4: Prepare again (should succeed after unlock)
      const sendTx3: SendTransaction = await hWallet.createNanoContractTransaction(
        'noop',
        address,
        {
          ncId: contractId,
          args: [],
          actions: [
            {
              type: 'deposit',
              token: NATIVE_TOKEN_UID,
              amount: depositAmount,
              changeAddress: address,
            },
          ],
        },
        { signTx: false }
      );
      activeSendTx = sendTx3;

      expect(sendTx3.transaction).not.toBeNull();
      expect(sendTx3.transaction!.inputs.length).toBeGreaterThan(0);

      await sendTx3.releaseUtxos();
      activeSendTx = null;
    } finally {
      await activeSendTx?.releaseUtxos();
    }
  });
});
