import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay } from './utils/core.util';
import {
  createTokenHelper,
  generateWalletHelper,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import { WALLET_CONSTANTS } from './configuration/test-constants';
import dateFormatter from '../../src/utils/date';
import { AddressError } from '../../src/errors';
import { precalculationHelpers } from './helpers/wallet-precalculation.helper';

describe('getAddressInfo', () => {
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should display correct values for HTR transactions with no change', async () => {
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
    await expect(hWallet.getAddressInfo(WALLET_CONSTANTS.genesis.addresses[0])).rejects.toThrow(
      AddressError
    );
  });

  it('should display correct values for transactions with change', async () => {
    const addr2 = await hWallet.getAddressAtIndex(2);
    const addr3 = await hWallet.getAddressAtIndex(3);

    // Ensure both are empty addresses
    expect((await hWallet.getAddressInfo(addr2)).total_amount_received).toStrictEqual(0n);
    expect((await hWallet.getAddressInfo(addr3)).total_amount_received).toStrictEqual(0n);

    await delay(500);
    // Move all the wallet's funds to addr2
    let tx = await hWallet.sendTransaction(addr2, 10n);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr2)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 0n,
      total_amount_available: 10n,
    });

    // Move only a part of the funds to addr3, the change is returned to addr2
    tx = await hWallet.sendTransaction(addr3, 4n, { changeAddress: addr2 });
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr2)).resolves.toMatchObject({
      total_amount_received: 16n, // 10 from one transaction, 6 from the transaction change
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
    const timelock1 = Date.now().valueOf() + 5000; // 5 seconds of locked resources
    const timelockTimestamp = dateFormatter.dateToTimestamp(new Date(timelock1));
    const rawTimelockTx = await hWallet.sendManyOutputsTransaction([
      {
        address: await hWallet.getAddressAtIndex(0),
        value: 7n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: await hWallet.getAddressAtIndex(0),
        value: 3n,
        token: NATIVE_TOKEN_UID,
        timelock: timelockTimestamp,
      },
    ]);
    await waitForTxReceived(hWallet, rawTimelockTx.hash);

    // Validating locked balance
    await expect(hWallet.getAddressInfo(await hWallet.getAddressAtIndex(0))).resolves.toMatchObject(
      {
        total_amount_available: 7n,
        total_amount_locked: 3n,
      }
    );
  });

  it('should test custom token transactions', async () => {
    // Generating a new wallet to avoid conflict with HTR wallet
    const hWalletCustom = await generateWalletHelper();
    const addr0Custom = await hWalletCustom.getAddressAtIndex(0);
    const addr1Custom = await hWalletCustom.getAddressAtIndex(1);

    // Creating custom token
    await GenesisWalletHelper.injectFunds(hWalletCustom, addr0Custom, 1n);
    const { hash: tokenUid } = await createTokenHelper(
      hWalletCustom,
      'getAddressInfo Token',
      'GAIT',
      100n,
      { address: addr0Custom }
    );

    // Validating address information both in HTR and in custom token
    await expect(hWalletCustom.getAddressInfo(addr0Custom)).resolves.toMatchObject({
      total_amount_received: 1n,
      total_amount_sent: 1n, // Custom token mint consumed this balance
      total_amount_available: 0n,
      total_amount_locked: 0n,
      token: NATIVE_TOKEN_UID,
      index: 0,
    });
    await expect(
      hWalletCustom.getAddressInfo(addr0Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 100n,
      total_amount_sent: 0n,
      total_amount_available: 100n,
      total_amount_locked: 0n,
      token: tokenUid,
      index: 0,
    });

    // Validating address after 1 transaction
    const tx = await hWalletCustom.sendTransaction(addr1Custom, 40n, { token: tokenUid });
    await waitForTxReceived(hWalletCustom, tx.hash);
    await expect(
      hWalletCustom.getAddressInfo(addr0Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 100n,
      total_amount_sent: 100n,
      total_amount_available: 0n,
      token: tokenUid,
      index: 0,
    });
    await expect(
      hWalletCustom.getAddressInfo(addr1Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 40n,
      total_amount_sent: 0n,
      total_amount_available: 40n,
      token: tokenUid,
      index: 1,
    });
  });
});

describe('getTxAddresses', () => {
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

describe('checkAddressesMine', () => {
  it('should', async () => {
    const hWallet = await generateWalletHelper();

    const address1 = await hWallet.getAddressAtIndex(1);
    const address2 = await hWallet.getAddressAtIndex(2);
    const address3 = await hWallet.getAddressAtIndex(3);

    expect(
      await hWallet.checkAddressesMine([address1, address2, address3, 'invalid-address'])
    ).toStrictEqual({
      [address1]: true,
      [address2]: true,
      [address3]: true,
      'invalid-address': false,
    });
  });
});

// getAuthorityUtxos tests moved to shared/authority-utxos.test.ts and fullnode-specific/authority-utxos.test.ts

describe('index-limit address scanning policy', () => {
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    const walletData = await precalculationHelpers.test.getPrecalculatedWallet();
    hWallet = await generateWalletHelper({
      seed: walletData.words,
      addresses: walletData.addresses,
      scanPolicy: {
        policy: 'index-limit',
        startIndex: 0,
        endIndex: 9,
      },
    });
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should start a wallet configured to index-limit', async () => {
    // 0-9 addresses = 10
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(10);

    // 0-14 addresses = 15
    await hWallet.indexLimitLoadMore(5);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(15);

    // 0-24 addresses = 25
    await hWallet.indexLimitSetEndIndex(24);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(25);

    // Setting below current loaded index will be a no-op
    await hWallet.indexLimitSetEndIndex(5);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(25);
  });
});
