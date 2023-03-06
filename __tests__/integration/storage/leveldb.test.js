import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  generateMultisigWalletHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
  waitUntilNextTimestamp
} from '../helpers/wallet.helper';
import { delay } from '../utils/core.util';

import { LevelDBStore, Storage } from '../../../src/storage';
import walletUtils from '../../../src/utils/wallet';
import HathorWallet from '../../../src/new/wallet';
import { loggers } from '../utils/logger.util';

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

describe("LevelDB persistent store", () => {
  afterEach(async () => {
    await stopWallets();
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should receive and send tokens', async () => {
    const DATA_DIR = './testdata.leveldb';
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const xpubkey = walletUtils.getXPubKeyFromSeed(walletData.words, { accountDerivationIndex: '0\'/0' });

    const store = new LevelDBStore(DATA_DIR, xpubkey);
    const storage = new Storage(store);

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

    // Expect to have an empty list for the full history
    expect(Object.keys(hWallet.getFullHistory())).toHaveLength(0);

    // Injecting some funds on this wallet
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(1), 10);

    await delay(100);
    // Validating the full history increased in one
    expect(Object.keys(await hWallet.getFullHistory())).toHaveLength(1);

    const tx1 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(3), 5);
    await waitForTxReceived(hWallet, tx1.hash);
    expect(Object.keys(await hWallet.getFullHistory())).toHaveLength(2);

    await expect(store.getTx(tx1.hash)).resolves.not.toBeNull();
  });
});
