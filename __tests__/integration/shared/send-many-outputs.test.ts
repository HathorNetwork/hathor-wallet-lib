/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared sendManyOutputsTransaction tests.
 *
 * Validates multi-output transaction behavior that is common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades.
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import dateFormatter from '../../../src/utils/date';
import { delay } from '../utils/core.util';
import { loggers } from '../utils/logger.util';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

describe.each(adapters)('[Shared] sendManyOutputsTransaction — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should send simple HTR transactions', async () => {
    const { wallet } = await adapter.createWallet();
    await adapter.injectFunds(wallet, (await wallet.getAddressAtIndex(0))!, 100n);

    // Single input and single output
    const { transaction: tx1 } = await adapter.sendManyOutputsTransaction(wallet, [
      {
        address: (await wallet.getAddressAtIndex(2))!,
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ]);
    const decoded1 = await adapter.getTx(wallet, tx1.hash);
    expect(decoded1.inputs).toHaveLength(1);
    expect(decoded1.outputs).toHaveLength(1);

    // Single input and two outputs
    const { transaction: tx2 } = await adapter.sendManyOutputsTransaction(wallet, [
      {
        address: (await wallet.getAddressAtIndex(5))!,
        value: 60n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: (await wallet.getAddressAtIndex(6))!,
        value: 40n,
        token: NATIVE_TOKEN_UID,
      },
    ]);
    const decoded2 = await adapter.getTx(wallet, tx2.hash);
    expect(decoded2.inputs).toHaveLength(1);
    expect(decoded2.outputs).toHaveLength(2);
    const largerOutputIndex = decoded2.outputs.findIndex(o => o.value === 60n);

    // Explicit input and three outputs (5 + 35 + 20 change)
    const { transaction: tx3 } = await adapter.sendManyOutputsTransaction(
      wallet,
      [
        {
          address: (await wallet.getAddressAtIndex(1))!,
          value: 5n,
          token: NATIVE_TOKEN_UID,
        },
        {
          address: (await wallet.getAddressAtIndex(2))!,
          value: 35n,
          token: NATIVE_TOKEN_UID,
        },
      ],
      {
        inputs: [
          {
            txId: decoded2.tx_id,
            token: NATIVE_TOKEN_UID,
            index: largerOutputIndex,
          },
        ],
      }
    );
    const decoded3 = await adapter.getTx(wallet, tx3.hash);
    expect(decoded3.inputs).toHaveLength(1);
    expect(decoded3.outputs).toHaveLength(3);

    expect(decoded3.outputs).toContainEqual(expect.objectContaining({ value: 5n }));
    expect(decoded3.outputs).toContainEqual(expect.objectContaining({ value: 35n }));
    expect(decoded3.outputs).toContainEqual(expect.objectContaining({ value: 20n }));
  });

  it('should send transactions with multiple tokens', async () => {
    const { wallet } = await adapter.createWallet();
    await adapter.injectFunds(wallet, (await wallet.getAddressAtIndex(0))!, 10n);
    const { hash: tokenUid } = await adapter.createToken(
      wallet,
      'Multiple Tokens Tk',
      'MTTK',
      200n
    );

    const { transaction: tx } = await adapter.sendManyOutputsTransaction(wallet, [
      {
        token: tokenUid,
        value: 110n,
        address: (await wallet.getAddressAtIndex(1))!,
      },
      {
        token: NATIVE_TOKEN_UID,
        value: 5n,
        address: (await wallet.getAddressAtIndex(2))!,
      },
    ]);

    const sendTx = await adapter.getTx(wallet, tx.hash);
    expect(sendTx.inputs).toHaveLength(2);
    expect(sendTx.outputs).toHaveLength(4);

    // Validate output values
    expect(sendTx.outputs).toContainEqual(
      expect.objectContaining({ value: 3n, token: NATIVE_TOKEN_UID })
    );
    expect(sendTx.outputs).toContainEqual(
      expect.objectContaining({ value: 5n, token: NATIVE_TOKEN_UID })
    );
    expect(sendTx.outputs).toContainEqual(expect.objectContaining({ value: 90n, token: tokenUid }));
    expect(sendTx.outputs).toContainEqual(
      expect.objectContaining({ value: 110n, token: tokenUid })
    );

    // Validate input values
    expect(sendTx.inputs).toContainEqual(
      expect.objectContaining({ value: 8n, token: NATIVE_TOKEN_UID })
    );
    expect(sendTx.inputs).toContainEqual(expect.objectContaining({ value: 200n, token: tokenUid }));
  });

  it('should respect timelocks', async () => {
    const { wallet } = await adapter.createWallet();
    await adapter.injectFunds(wallet, (await wallet.getAddressAtIndex(0))!, 10n);

    const startTime = Date.now().valueOf();
    const timelock1 = startTime + 5000;
    const timelock2 = startTime + 8000;
    const timelock1Timestamp = dateFormatter.dateToTimestamp(new Date(timelock1));
    const timelock2Timestamp = dateFormatter.dateToTimestamp(new Date(timelock2));

    const { transaction: tx } = await adapter.sendManyOutputsTransaction(wallet, [
      {
        address: (await wallet.getAddressAtIndex(1))!,
        value: 7n,
        token: NATIVE_TOKEN_UID,
        timelock: timelock1Timestamp,
      },
      {
        address: (await wallet.getAddressAtIndex(1))!,
        value: 3n,
        token: NATIVE_TOKEN_UID,
        timelock: timelock2Timestamp,
      },
    ]);

    // Validate timelocks on outputs
    const timelockTx = await adapter.getTx(wallet, tx.hash);
    expect(timelockTx.outputs.find(o => o.decoded.timelock === timelock1Timestamp)).toBeDefined();
    expect(timelockTx.outputs.find(o => o.decoded.timelock === timelock2Timestamp)).toBeDefined();

    // Moment 0: all funds locked
    let htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance).toStrictEqual({ locked: 10n, unlocked: 0n });

    // Wait for first timelock to expire
    const waitFor1 = timelock1 - Date.now().valueOf() + 1000;
    loggers.test.log(`Will wait for ${waitFor1}ms for timelock1 to expire`);
    await delay(waitFor1);

    // Force balance recalculation
    await wallet.storage.processHistory();

    // Moment 1: 7n unlocked, 3n still locked
    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance).toEqual({ locked: 3n, unlocked: 7n });

    // Confirm that locked balance is unavailable
    await expect(
      adapter.sendTransaction(wallet, (await wallet.getAddressAtIndex(3))!, 8n)
    ).rejects.toThrow('Insufficient');

    // Wait for second timelock to expire
    const waitFor2 = timelock2 - Date.now().valueOf() + 1000;
    loggers.test.log(`Will wait for ${waitFor2}ms for timelock2 to expire`);
    await delay(waitFor2);

    await wallet.storage.processHistory();

    // Moment 2: all funds unlocked
    htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance).toStrictEqual({ locked: 0n, unlocked: 10n });

    // Confirm balance is now available
    const { hash } = await adapter.sendTransaction(
      wallet,
      (await wallet.getAddressAtIndex(4))!,
      8n
    );
    expect(hash).toBeDefined();
  });
});
