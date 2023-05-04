import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import {
  DEFAULT_PIN_CODE,
  DEFAULT_PASSWORD,
  generateConnection,
  stopAllWallets,
  waitForWalletReady,
  waitForTxReceived,
} from '../helpers/wallet.helper';
import HathorWallet from '../../../src/new/wallet';
import { loggers } from '../utils/logger.util';
import { delay } from '../utils/core.util';
import SendTransaction from '../../../src/new/sendTransaction';
import { LevelDBStore, MemoryStore, Storage } from '../../../src/storage';
import walletUtils from '../../../src/utils/wallet';
import { HATHOR_TOKEN_CONFIG } from '../../../src/constants';
import { crypto } from "bitcore-lib";

const startedWallets = [];

/**
 * Helper to stop wallets started manually in this test file.
 */
async function stopWallets() {
  let hWallet;
  while (hWallet = startedWallets.pop()) {
    try {
      await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
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
   **/
  async function testUnlockWhenSpent(storage, walletData) {
    const hwallet = await startWallet(storage, walletData);
    const address = await hwallet.getAddressAtIndex(0);
    const tx = await GenesisWalletHelper.injectFunds(address, 1);
    await waitForTxReceived(hwallet, tx.hash);
    await delay(500);

    const sendTx = new SendTransaction({
      storage: hwallet.storage,
      outputs: [{
        type: 'p2pkh',
        address: await hwallet.getAddressAtIndex(1),
        value: 1,
        token: HATHOR_TOKEN_CONFIG.uid,
      }],
      pin: DEFAULT_PIN_CODE,
    });
    await sendTx.prepareTx();
    await sendTx.updateOutputSelected(true);
    // This shouldn't fail since if we did not have tokens the prepareTx should have failed
    const input = sendTx.transaction.inputs[0];
    const utxoId = { txId: input.hash, index: input.index };
    await expect(hwallet.storage.isUtxoSelectedAsInput(utxoId)).resolves.toBe(true);
    // Send a transaction spending the only utxo on the wallet.
    const tx1 = await sendTx.runFromMining();
    await waitForTxReceived(hwallet, tx1.hash);
    await delay(500);
    await expect(hwallet.storage.isUtxoSelectedAsInput(utxoId)).resolves.toBe(false);
  }

  it('should unselect as input when spent', async () => {

    // memory store
    const walletDataMem = precalculationHelpers.test.getPrecalculatedWallet();
    const storeMem = new MemoryStore();
    const storageMem = new Storage(storeMem);
    await testUnlockWhenSpent(storageMem, walletDataMem);

    // LevelDB test
    const DATA_DIR = './testdata.leveldb';
    const walletDataLDB = precalculationHelpers.test.getPrecalculatedWallet();
    const xpubkeyLDB = walletUtils.getXPubKeyFromSeed(walletDataLDB.words, { accountDerivationIndex: '0\'/0' });
    const walletId = crypto.Hash.sha256(xpubkeyLDB).toString('hex');
    const storeLDB = new LevelDBStore(walletId, DATA_DIR);
    const storageLDB = new Storage(storeLDB);
    await testUnlockWhenSpent(storageLDB, walletDataLDB);
  })
});
