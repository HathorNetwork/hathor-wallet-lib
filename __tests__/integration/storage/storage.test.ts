import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import {
  DEFAULT_PIN_CODE,
  DEFAULT_PASSWORD,
  generateConnection,
  generateWalletHelper,
  stopAllWallets,
  waitForWalletReady,
  waitForTxReceived,
} from '../helpers/wallet.helper';
import { InvalidPasswdError, SendTxError } from '../../../src/errors';
import HathorWallet from '../../../src/new/wallet';
import { loggers } from '../utils/logger.util';
import SendTransaction from '../../../src/new/sendTransaction';
import { MemoryStore, Storage } from '../../../src/storage';
import transactionUtils from '../../../src/utils/transaction';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { IHathorWallet } from '../../../src/wallet/types';
import { IGapLimitAddressScanPolicy, SCANNING_POLICY } from '../../../src/types';

const startedWallets = [];

/**
 * Helper to stop wallets started manually in this test file.
 */
async function stopWallets() {
  while (startedWallets.length > 0) {
    const hWallet = startedWallets.pop() as unknown as IHathorWallet;
    try {
      if (hWallet) {
        await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
      }
    } catch (e) {
      loggers.test.error(e.stack);
    }
  }
}

async function startWallet(storage, walletData) {
  // Start the wallet
  const walletConfig = {
    seed: walletData.words,
    connection: generateConnection(),
    password: DEFAULT_PASSWORD,
    pinCode: DEFAULT_PIN_CODE,
    preCalculatedAddresses: walletData.addresses,
    storage,
    scanPolicy: { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 20 } as IGapLimitAddressScanPolicy,
  };
  const hWallet = new HathorWallet(walletConfig);
  await hWallet.start();
  startedWallets.push(hWallet);
  await waitForWalletReady(hWallet);
  return hWallet;
}

describe('locked utxos', () => {
  afterEach(async () => {
    await stopWallets();
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  /**
   * Test marking an utxo as selected_as_input
   * then we should spend the utxo and check it has been "unselected"
   * @param {IStorage} storage The storage instance
   * @param {Object} walletData the pre-calculated wallet data to start a wallet
   * */
  async function testUnlockWhenSpent(storage, walletData) {
    const hwallet = await startWallet(storage, walletData);
    const address = await hwallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hwallet, address, 1n);

    const sendTx = new SendTransaction({
      storage: hwallet.storage,
      outputs: [
        {
          type: 'p2pkh',
          address: await hwallet.getAddressAtIndex(1),
          value: 1n,
          token: NATIVE_TOKEN_UID,
        },
      ],
      pin: 'xxx', // instance with wrong pin to validate pin as parameter
    });
    // prepareTx creates an unsigned transaction (pin is not validated here)
    await sendTx.prepareTx();
    // signTx with the wrong pin should fail
    await expect(sendTx.signTx()).rejects.toThrow(InvalidPasswdError);
    // Will work with the correct PIN as parameter
    await sendTx.signTx(DEFAULT_PIN_CODE);
    await sendTx.updateOutputSelected(true);
    // This shouldn't fail since if we did not have tokens the prepareTx should have failed
    const input = sendTx.transaction!.inputs[0];
    const utxoId = { txId: input.hash, index: input.index };
    await expect(hwallet.storage.isUtxoSelectedAsInput(utxoId)).resolves.toBe(true);
    // Send a transaction spending the only utxo on the wallet.
    const tx1 = await sendTx.runFromMining();
    await waitForTxReceived(hwallet, tx1.hash);
    await expect(hwallet.storage.isUtxoSelectedAsInput(utxoId)).resolves.toBe(false);
  }

  it('should unselect as input when spent', async () => {
    // memory store
    const walletDataMem = precalculationHelpers.test.getPrecalculatedWallet();
    const storeMem = new MemoryStore();
    const storageMem = new Storage(storeMem);
    await testUnlockWhenSpent(storageMem, walletDataMem);
  });

  it('should wrap prepareTx errors into SendTxError', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hwallet = await startWallet(storage, walletData);
    const address = await hwallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hwallet, address, 1n);

    const sendTx = new SendTransaction({
      storage: hwallet.storage,
      outputs: [
        {
          type: 'p2pkh',
          address: await hwallet.getAddressAtIndex(1),
          // Sending more than available should cause prepareTx to fail
          value: 9999n,
          token: NATIVE_TOKEN_UID,
        },
      ],
    });

    await expect(sendTx.prepareTx()).rejects.toThrow(SendTxError);
  });
});

describe('run(until) state machine', () => {
  afterEach(async () => {
    await stopWallets();
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should stop at prepare-tx and resume to completion', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hwallet = await startWallet(storage, walletData);
    const address = await hwallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hwallet, address, 2n);

    const sendTx = new SendTransaction({
      storage: hwallet.storage,
      pin: DEFAULT_PIN_CODE,
      outputs: [
        {
          type: 'p2pkh',
          address: await hwallet.getAddressAtIndex(1),
          value: 1n,
          token: NATIVE_TOKEN_UID,
        },
      ],
    });

    // Stop after prepare — transaction should exist but be unsigned (no input data)
    const preparedTx = await sendTx.run('prepare-tx');
    expect(preparedTx).toBeDefined();
    expect(preparedTx.inputs.length).toBeGreaterThan(0);
    for (const input of preparedTx.inputs) {
      expect(input.data).toBeNull();
    }

    // Resume from where we left off — should sign, mine and push
    const finalTx = await sendTx.run(null);
    expect(finalTx.hash).toBeDefined();
    await waitForTxReceived(hwallet, finalTx.hash);
  });

  it('should stop at sign-tx and resume to completion', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hwallet = await startWallet(storage, walletData);
    const address = await hwallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hwallet, address, 2n);

    const sendTx = new SendTransaction({
      storage: hwallet.storage,
      pin: DEFAULT_PIN_CODE,
      outputs: [
        {
          type: 'p2pkh',
          address: await hwallet.getAddressAtIndex(1),
          value: 1n,
          token: NATIVE_TOKEN_UID,
        },
      ],
    });

    // Stop after sign — transaction should be signed (input data populated)
    const signedTx = await sendTx.run('sign-tx');
    expect(signedTx).toBeDefined();
    for (const input of signedTx.inputs) {
      expect(input.data).not.toBeNull();
    }

    // Resume — should mine and push
    const finalTx = await sendTx.run(null);
    expect(finalTx.hash).toBeDefined();
    await waitForTxReceived(hwallet, finalTx.hash);
  });

  it('should complete the full flow with run(null)', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const store = new MemoryStore();
    const storage = new Storage(store);
    const hwallet = await startWallet(storage, walletData);
    const address = await hwallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hwallet, address, 2n);

    const sendTx = new SendTransaction({
      storage: hwallet.storage,
      pin: DEFAULT_PIN_CODE,
      outputs: [
        {
          type: 'p2pkh',
          address: await hwallet.getAddressAtIndex(1),
          value: 1n,
          token: NATIVE_TOKEN_UID,
        },
      ],
    });

    // Full flow in one call
    const tx = await sendTx.run(null);
    expect(tx.hash).toBeDefined();
    await waitForTxReceived(hwallet, tx.hash);
  });
});

describe('custom signature method', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should check that we have an external signature method', async () => {
    const hwallet = await generateWalletHelper();
    const address = await hwallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hwallet, address, 10n);

    expect(hwallet.storage.hasTxSignatureMethod()).toEqual(false);
    const customSignFunc = jest
      .fn()
      .mockImplementation(transactionUtils.getSignatureForTx.bind(transactionUtils));
    hwallet.storage.setTxSignatureMethod(customSignFunc);
    expect(hwallet.storage.hasTxSignatureMethod()).toEqual(true);
  });

  it('should sign transactions with custom signature method', async () => {
    const hwallet = await generateWalletHelper();
    const address = await hwallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hwallet, address, 10n);

    const customSignFunc = jest
      .fn()
      .mockImplementation(transactionUtils.getSignatureForTx.bind(transactionUtils));
    expect(hwallet.storage.hasTxSignatureMethod()).toEqual(false);
    hwallet.storage.setTxSignatureMethod(customSignFunc);
    expect(hwallet.storage.hasTxSignatureMethod()).toEqual(true);
    const address2 = await hwallet.getAddressAtIndex(2);
    await hwallet.sendTransaction(address2, 10n);

    expect(customSignFunc).toHaveBeenCalled();
  });
});
