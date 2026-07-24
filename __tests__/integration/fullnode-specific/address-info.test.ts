/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade address-info tests: getAddressInfo, getTxAddresses, and the
 * malformed-input case of checkAddressesMine.
 *
 * These stay fullnode-specific because of concrete wallet-service divergences:
 * - `getAddressInfo()` throws `Not implemented` on HathorWalletServiceWallet
 *   (src/wallet/wallet.ts).
 * - `getTxAddresses()` does not exist on HathorWalletServiceWallet at all, and
 *   its test builds the `IHistoryTx` argument via `getTx()`, which also throws
 *   `Not implemented` on the wallet-service facade.
 * - `checkAddressesMine()` itself is shared (see shared/addresses.test.ts),
 *   but the malformed-address-string case is fullnode-only: the wallet-service
 *   client response schema (`z.record(AddressSchema, z.boolean())` in
 *   src/wallet/api/schemas/walletApi.ts) only admits base58 keys, so a
 *   non-base58 string cannot round-trip through that facade.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { WALLET_CONSTANTS } from '../configuration/test-constants';
import dateFormatter from '../../../src/utils/date';
import { AddressError } from '../../../src/errors';

describe('[Fullnode] getAddressInfo', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should display correct values for HTR transactions with no change', async () => {
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr1 = await hWallet.getAddressAtIndex(1);

    // Validating empty address information
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 0n,
      total_amount_sent: 0n,
      total_amount_available: 0n,
      total_amount_locked: 0n, // Validating this field only once to check it's returned
      token: NATIVE_TOKEN_UID, // Validating this field only once to ensure it's correct
      index: 0,
    });

    // Validating address after 1 transaction
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 0n,
      total_amount_available: 10n,
    });

    // Validating the results for two transactions
    let tx = await hWallet.sendTransaction(addr1, 10n);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 10n,
      total_amount_available: 0n,
      index: 0, // Ensuring the index is correct
    });
    await expect(hWallet.getAddressInfo(addr1)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 0n,
      total_amount_available: 10n,
      index: 1, // Ensuring the index is correct
    });

    // Validating the results for the funds returning to previously used address
    await waitUntilNextTimestamp(hWallet, tx.hash);
    tx = await hWallet.sendTransaction(addr0, 10n);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 20n,
      total_amount_sent: 10n,
      total_amount_available: 10n,
    });
    await expect(hWallet.getAddressInfo(addr1)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 10n,
      total_amount_available: 0n,
    });
  });

  it('should throw for an address outside the wallet', async () => {
    const hWallet = await generateWalletHelper();
    await expect(hWallet.getAddressInfo(WALLET_CONSTANTS.genesis.addresses[0])).rejects.toThrow(
      AddressError
    );
  });

  it('should display correct values for transactions with change', async () => {
    const hWallet = await generateWalletHelper();
    const addr2 = await hWallet.getAddressAtIndex(2);
    const addr3 = await hWallet.getAddressAtIndex(3);

    // Ensure both start as empty addresses
    expect((await hWallet.getAddressInfo(addr2)).total_amount_received).toStrictEqual(0n);
    expect((await hWallet.getAddressInfo(addr3)).total_amount_received).toStrictEqual(0n);

    // Fund addr2 with all the amounts the assertions below track. injectFunds
    // already waits past the funding tx's timestamp before returning, so the
    // spend below needs no extra wait.
    await GenesisWalletHelper.injectFunds(hWallet, addr2, 10n);
    await expect(hWallet.getAddressInfo(addr2)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 0n,
      total_amount_available: 10n,
    });

    // Move only a part of the funds to addr3, the change is returned to addr2
    const tx = await hWallet.sendTransaction(addr3, 4n, { changeAddress: addr2 });
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr2)).resolves.toMatchObject({
      total_amount_received: 16n, // 10 from the fund injection, 6 from the transaction change
      total_amount_sent: 10n, // All the funds were sent
      total_amount_available: 6n, // Only the change remains available
    });
    await expect(hWallet.getAddressInfo(addr3)).resolves.toMatchObject({
      total_amount_received: 4n,
      total_amount_sent: 0n,
      total_amount_available: 4n,
    });
  });

  it('should return correct values for locked utxos', async () => {
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const timelock1 = Date.now().valueOf() + 5000; // 5 seconds of locked resources
    const timelockTimestamp = dateFormatter.dateToTimestamp(new Date(timelock1));

    // injectFunds already waits past the funding tx's timestamp before
    // returning, so the spend below needs no extra wait.
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);
    const rawTimelockTx = await hWallet.sendManyOutputsTransaction([
      {
        address: addr0,
        value: 7n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: addr0,
        value: 3n,
        token: NATIVE_TOKEN_UID,
        timelock: timelockTimestamp,
      },
    ]);
    await waitForTxReceived(hWallet, rawTimelockTx.hash);

    // Validating locked balance
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_available: 7n,
      total_amount_locked: 3n,
    });
  });

  it('should test custom token transactions', async () => {
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr1 = await hWallet.getAddressAtIndex(1);

    // Creating custom token
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 1n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getAddressInfo Token',
      'GAIT',
      100n,
      { address: addr0 }
    );

    // Validating address information both in HTR and in custom token
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 1n,
      total_amount_sent: 1n, // Custom token mint consumed this balance
      total_amount_available: 0n,
      total_amount_locked: 0n,
      token: NATIVE_TOKEN_UID,
      index: 0,
    });
    await expect(hWallet.getAddressInfo(addr0, { token: tokenUid })).resolves.toMatchObject({
      total_amount_received: 100n,
      total_amount_sent: 0n,
      total_amount_available: 100n,
      total_amount_locked: 0n,
      token: tokenUid,
      index: 0,
    });

    // Validating address after 1 transaction
    const tx = await hWallet.sendTransaction(addr1, 40n, { token: tokenUid });
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr0, { token: tokenUid })).resolves.toMatchObject({
      total_amount_received: 100n,
      total_amount_sent: 100n,
      total_amount_available: 0n,
      token: tokenUid,
      index: 0,
    });
    await expect(hWallet.getAddressInfo(addr1, { token: tokenUid })).resolves.toMatchObject({
      total_amount_received: 40n,
      total_amount_sent: 0n,
      total_amount_available: 40n,
      token: tokenUid,
      index: 1,
    });
  });
});

describe('[Fullnode] getTxAddresses', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('should identify transaction addresses correctly', async () => {
    const hWallet = await generateWalletHelper();
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();

    // Generating a transaction with outputs to multiple addresses
    const tx = await gWallet.sendManyOutputsTransaction(
      [
        { address: await hWallet.getAddressAtIndex(1), value: 1n, token: NATIVE_TOKEN_UID },
        { address: await hWallet.getAddressAtIndex(3), value: 3n, token: NATIVE_TOKEN_UID },
        { address: await hWallet.getAddressAtIndex(5), value: 5n, token: NATIVE_TOKEN_UID },
      ],
      {
        changeAddress: WALLET_CONSTANTS.genesis.addresses[0],
      }
    );
    await waitForTxReceived(hWallet, tx.hash);
    await waitForTxReceived(gWallet, tx.hash);

    // Validating the method results
    const decodedTx = await hWallet.getTx(tx.hash);
    await expect(hWallet.getTxAddresses(decodedTx)).resolves.toStrictEqual(
      new Set([
        await hWallet.getAddressAtIndex(1),
        await hWallet.getAddressAtIndex(3),
        await hWallet.getAddressAtIndex(5),
      ])
    );

    // By convention, only the address 0 of the genesis wallet is used on the integration tests
    await expect(gWallet.getTxAddresses(decodedTx)).resolves.toStrictEqual(
      new Set([WALLET_CONSTANTS.genesis.addresses[0]])
    );
  });
});

describe('[Fullnode] checkAddressesMine', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  // The general (well-formed addresses) behavior is covered for both facades in
  // shared/addresses.test.ts. Only the fullnode facade accepts an arbitrary
  // string here: it resolves ownership from local storage, while the
  // wallet-service response schema only admits base58 keys.
  it('should map a malformed address string to false', async () => {
    const hWallet = await generateWalletHelper();

    const address1 = await hWallet.getAddressAtIndex(1);

    expect(await hWallet.checkAddressesMine([address1, 'invalid-address'])).toStrictEqual({
      [address1]: true,
      'invalid-address': false,
    });
  });
});
