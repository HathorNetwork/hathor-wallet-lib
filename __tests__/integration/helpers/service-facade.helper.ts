import { loggers } from '../utils/logger.util';
import { delay } from '../utils/core.util';
import { HathorWalletServiceWallet, MemoryStore, Storage, walletUtils } from '../../../src';
import Network from '../../../src/models/network';
import { FULLNODE_URL, NETWORK_NAME } from '../configuration/test-constants';
import { TxNotFoundError } from '../../../src/errors';
import { precalculationHelpers } from './wallet-precalculation.helper';
import config from '../../../src/config';

/** Default pin to simplify the tests */
const pinCode = '123456';
/** Default password to simplify the tests */
const password = 'testpass';

export const emptyWallet = {
  words:
    'buddy kingdom scorpion device uncover donate sense false few leaf oval illegal assume talent express glide above brain end believe abstract will marine crunch',
  addresses: [
    'WkHNZyrKNusTtu3EHfvozEqcBdK7RoEMR7',
    'WivGyxDjWxijcns3hpGvEJKhjR9HMgFzZ5',
    'WXQSeMcNt67hVpmgwYqmYLsddgXeGYP4mq',
    'WTMH3NQs8YXyNguqwLyqoTKDFTfkJLxMzX',
    'WTUiHeiajtt1MXd1Jb3TEeWUysfNJfig35',
    'WgzZ4MNcuX3sBgLC5Fa6dTTQaoy4ccLdv5',
    'WU6UQCnknGLh1WP392Gq6S69JmheS5kzZ2',
    'WX7cKt38FfgKFWFxSa2YzCWeCPgMbRR98h',
    'WZ1ABXsuwHHfLzeAWMX7RYs5919LPBaYpp',
    'WUJjQGb4SGSLh44m2JdgAR4kui8mTPb8bK',
  ],
};

export function initializeServiceGlobalConfigs() {
  // Set base URL for the wallet service API inside the privatenet test container
  config.setServerUrl(FULLNODE_URL);
  config.setWalletServiceBaseUrl('http://localhost:3000/dev/');
  config.setWalletServiceBaseWsUrl('ws://localhost:3001/');
}

/**
 * Builds a HathorWalletServiceWallet instance with a wallet seed words
 * If no words are provided, it will use a precalculated wallet for faster tests and return its addresses.
 * @param enableWs - Whether to enable websocket connection (default: false)
 * @param words - The 24 words to use for the wallet (default: random wallet)
 * @param passwordForRequests - The password that will be returned by the mocked requestPassword function (default: 'test-password')
 * @returns The wallet instance along with its store and storage for eventual mocking/spying
 */
export function buildWalletInstance({
  enableWs = false,
  words = '',
  passwordForRequests = 'test-password',
} = {}) {
  let addresses: string[] = [];

  // If no words are provided, use an empty precalculated wallet
  if (!words) {
    if (!precalculationHelpers.test) {
      throw new Error('Precalculation helper not initialized');
    }
    const preFetchedWallet = precalculationHelpers.test.getPrecalculatedWallet();
    // eslint-disable-next-line no-param-reassign -- Simple way of setting a default value
    words = preFetchedWallet.words;
    addresses = preFetchedWallet.addresses;
  }

  // Builds the wallet parameters
  const walletData = { words };
  const network = new Network(NETWORK_NAME);
  const requestPassword = jest.fn().mockResolvedValue(passwordForRequests);

  const store = new MemoryStore();
  const storage = new Storage(store);
  const newWallet = new HathorWalletServiceWallet({
    requestPassword,
    seed: walletData.words,
    network,
    storage,
    enableWs, // Disable websocket for integration tests by default
  });

  return { wallet: newWallet, store, storage, words, addresses };
}

/**
 * Polls the wallet for a transaction by its ID until found or max attempts reached
 * @param walletForPolling - The wallet instance to poll
 * @param txId - The transaction ID to look for
 * @returns The transaction object if found
 * @throws Error if the transaction is not found after max attempts
 */
export async function pollForTx(walletForPolling: HathorWalletServiceWallet, txId: string) {
  const maxAttempts = 10;
  const delayMs = 1000; // 1 second
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const tx = await walletForPolling.getTxById(txId);
      if (tx) {
        loggers.test!.log(`Polling for ${txId} took ${attempts + 1} attempts`);
        return tx;
      }
    } catch (error) {
      // If the error is of type TxNotFoundError, we continue polling
      if (!(error instanceof TxNotFoundError)) {
        throw error; // Re-throw unexpected errors
      }
    }
    attempts++;
    await delay(delayMs);
  }
  throw new Error(`Transaction ${txId} not found after ${maxAttempts} attempts`);
}

/**
 * [Debugging Method] Generates a new wallet with random words and retrieves the first 10 addresses.
 * @returns An object containing the generated words and the corresponding addresses.
 */
export async function generateNewWalletAddress() {
  const newWords = walletUtils.generateWalletWords();
  const { wallet: newWallet } = buildWalletInstance({ words: newWords });
  await newWallet.start({ pinCode, password });

  const addresses: string[] = [];
  for (let i = 0; i < 10; i++) {
    addresses.push((await newWallet.getAddressAtIndex(i))!);
  }

  return {
    words: newWords,
    addresses,
  };
}
