import { isEmpty } from 'lodash';
import { loggers } from '../utils/logger.util';
import { delay } from '../utils/core.util';
import { HathorWalletServiceWallet, MemoryStore, Storage, walletUtils } from '../../../src';
import Network from '../../../src/models/network';
import { FULLNODE_URL, NETWORK_NAME } from '../configuration/test-constants';
import { TxNotFoundError, WalletRequestError } from '../../../src/errors';
import { precalculationHelpers } from './wallet-precalculation.helper';
import config from '../../../src/config';
import ncApi from '../../../src/api/nano';

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
 * Builds a HathorWalletServiceWallet instance.
 *
 * Accepts either `words` (seed) or `xpub` — they are mutually exclusive.
 * If neither is provided, a precalculated wallet is used for faster tests.
 *
 * @param enableWs - Whether to enable websocket connection (default: false)
 * @param words - The 24 words to use for the wallet (default: random wallet)
 * @param xpub - An xpub key for creating a readonly wallet (mutually exclusive with words)
 * @param passwordForRequests - The password that will be returned by the mocked requestPassword function (default: 'test-password')
 * @returns The wallet instance along with its store and storage for eventual mocking/spying
 */
export async function buildWalletInstance({
  enableWs = false,
  words = '',
  xpub = '',
  passwordForRequests = 'test-password',
  singleAddressMode = false,
} = {}) {
  let addresses: string[] = [];

  // If neither identity is provided, use a precalculated wallet
  if (!words && !xpub) {
    if (!precalculationHelpers.test) {
      throw new Error('Precalculation helper not initialized');
    }
    const preFetchedWallet = await precalculationHelpers.test.getPrecalculatedWallet();
    // eslint-disable-next-line no-param-reassign -- Simple way of setting a default value
    words = preFetchedWallet.words;
    addresses = preFetchedWallet.addresses;
  }

  const network = new Network(NETWORK_NAME);
  const requestPassword = jest.fn().mockResolvedValue(passwordForRequests);

  const store = new MemoryStore();
  const storage = new Storage(store);

  // xpub and seed are mutually exclusive in the constructor
  const newWallet = new HathorWalletServiceWallet({
    requestPassword,
    ...(xpub ? { xpub } : { seed: words }),
    network,
    storage,
    enableWs,
    singleAddressMode,
  });

  return { wallet: newWallet, store, storage, words, addresses };
}

/**
 * Polls until a predicate returns a truthy value, with retries and delay.
 *
 * Use this when you need to wait for a wallet-service side-effect that lags behind
 * tx visibility (e.g. UTXO index updates after a delegation).
 *
 * @param predicate - Async function that returns a truthy value when the condition is met.
 * @param label - Human-readable description for log/error messages.
 * @param maxAttempts - Maximum number of polling attempts (default: 10).
 * @param delayMs - Delay between attempts in milliseconds (default: 500).
 * @returns The truthy value returned by the predicate.
 */
export async function pollUntilCondition<T>(
  predicate: () => Promise<T>,
  label: string,
  maxAttempts = 10,
  delayMs = 500
): Promise<T> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = await predicate();
    if (result) {
      loggers.test!.log(`Condition "${label}" met after ${attempts + 1} attempts`);
      return result;
    }
    attempts++;
    await delay(delayMs);
  }
  throw new Error(`Condition "${label}" not met after ${maxAttempts} attempts`);
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
 * Polls the wallet-service until its UTXO index fully reflects `tx`: the UTXOs
 * `tx` spends are no longer offered as available, AND `tx`'s own (wallet-owned)
 * output has become available.
 *
 * `pollForTx` only confirms a tx is INDEXED; the service updates its UTXO index
 * in a separate, non-atomic step. Issuing the next send before that catch-up
 * makes input selection either pick an already-spent UTXO — rejected as the
 * generic `Error sending tx proposal` — or find nothing yet — `No UTXOs
 * available for the token ...`. Both are the same lag, and both are `beforeAll`
 * failures that jest.retryTimes cannot recover.
 *
 * Requires `tx` to have at least one wallet-owned output (e.g. a change output),
 * which holds for the change-producing sends this guards.
 *
 * @param wallet Service wallet to poll
 * @param tx The just-sent transaction whose effects must be reflected
 */
export async function pollForUtxoConsistency(
  wallet: HathorWalletServiceWallet,
  tx: { hash?: string | null; inputs: { hash: string; index: number }[] }
): Promise<void> {
  const spent = new Set(tx.inputs.map(input => `${input.hash}:${input.index}`));
  await pollUntilCondition(
    async () => {
      const { utxos } = await wallet.getUtxos();
      const noStaleInput = utxos.every(utxo => !spent.has(`${utxo.tx_id}:${utxo.index}`));
      const ownOutputAvailable = tx.hash != null && utxos.some(utxo => utxo.tx_id === tx.hash);
      return noStaleInput && ownOutputAvailable;
    },
    'wallet-service UTXO index reflects sent tx',
    20,
    500
  );
}

/**
 * Backoff sequence between retry attempts on a transient `wallet/init` failure.
 * 4 total attempts (initial + 3 backoffs), ~3.5s worst-case added latency.
 */
const TRANSIENT_WALLET_INIT_BACKOFFS_MS = [500, 1000, 2000];

/**
 * The exact error message thrown by `walletApi.createWallet` at `walletApi.ts:123`
 * when `POST wallet/init` returns an unexpected status/body. Matching this exact
 * string keeps the retry surface minimal — see `retryOnTransientWalletInit`.
 */
const TRANSIENT_WALLET_INIT_ERROR_MESSAGE = 'Error creating wallet.';

/**
 * Retries a wallet-init operation on transient `wallet/init` HTTP failures.
 *
 * The wallet-service backend can briefly reject `POST wallet/init` while a freshly-spawned
 * docker stack is still settling. Jest's `retryTimes(2)` cannot help, because the failure
 * typically happens inside `beforeAll` — and Jest only retries `it()` bodies.
 *
 * Retry surface is intentionally narrow: only `WalletRequestError` with message
 * `"Error creating wallet."` is treated as transient. Test-injected mocks (e.g.
 * `new Error('Crash')`) and other errors propagate immediately on the first attempt.
 */
export async function retryOnTransientWalletInit<T>(
  op: () => Promise<T>,
  label: string
): Promise<T> {
  const maxAttempts = TRANSIENT_WALLET_INIT_BACKOFFS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await op();
      if (attempt > 1) {
        loggers.test!.log(`${label} succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (err) {
      const isTransient =
        err instanceof WalletRequestError && err.message === TRANSIENT_WALLET_INIT_ERROR_MESSAGE;
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      const backoffMs = TRANSIENT_WALLET_INIT_BACKOFFS_MS[attempt - 1];
      loggers.test!.warn(
        `${label} hit transient wallet/init flake on attempt ${attempt}, retrying in ${backoffMs}ms`,
        { error: (err as Error).message }
      );
      await delay(backoffMs);
    }
  }
  // Unreachable: the loop above either returns or throws on the final attempt.
  throw new Error(`retryOnTransientWalletInit: unreachable for ${label}`);
}

/**
 * [Debugging Method] Generates a new wallet with random words and retrieves the first 10 addresses.
 * @returns An object containing the generated words and the corresponding addresses.
 */
export async function generateNewWalletAddress() {
  const newWords = walletUtils.generateWalletWords();
  const { wallet: newWallet } = await buildWalletInstance({ words: newWords });
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

/**
 * Poll for nano contract state with retries.
 * The fullnode may not have indexed the contract immediately after wallet-service confirms the tx.
 * @param ncId - Nano contract ID
 * @param fields - Fields to retrieve
 * @param requiredField - Optional field that must have a non-null value
 * @param maxAttempts - Maximum polling attempts
 * @param delayMs - Delay between attempts
 */
export async function pollForNcState(
  ncId: string,
  fields: string[],
  requiredField?: string,
  maxAttempts = 10,
  delayMs = 1000
): Promise<unknown> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const state = await ncApi.getNanoContractState(ncId, fields, [], []);
      // If a required field is specified, check that it has a value
      if (requiredField) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fieldValue = (state.fields as any)[requiredField]?.value;
        if (fieldValue == null) {
          if (attempt === maxAttempts - 1) {
            throw new Error(`Required field ${requiredField} not found in contract state`);
          }
          await delay(delayMs);
          continue;
        }
      }
      return state;
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      await delay(delayMs);
    }
  }
  throw new Error(`Failed to get nano contract state after ${maxAttempts} attempts`);
}

/**
 * Poll for token details with retries.
 * The wallet-service may not have indexed the token immediately after creation.
 */
export async function pollForTokenDetails(
  wallet: HathorWalletServiceWallet,
  tokenId: string,
  maxAttempts = 20,
  delayMs = 2000
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await wallet.getTokenDetails(tokenId);
      return;
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      await delay(delayMs);
    }
  }
}

/**
 * Check that a transaction is valid (not voided).
 * Uses the wallet-service proxy API via getFullTxById.
 */
export async function checkTxNotVoided(
  wallet: HathorWalletServiceWallet,
  txId: string
): Promise<void> {
  const txData = await wallet.getFullTxById(txId);
  expect(txData.success).toBe(true);
  expect(isEmpty(txData.meta.voided_by)).toBe(true);
}
