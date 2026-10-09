/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The wallet-service setup helpers must ride out transient backend failures:
 * they run inside `beforeAll`, which Jest's `retryTimes` never re-runs, so one
 * unretried hiccup fails every test in the suite.
 */

import { AxiosError } from 'axios';
import { HathorWalletServiceWallet } from '../../../src';
import { TxNotFoundError, WalletRequestError } from '../../../src/errors';
import walletApi from '../../../src/wallet/api/walletApi';
import { GenesisWalletServiceHelper } from './genesis-wallet.helper';
import {
  initializeServiceGlobalConfigs,
  markServiceAnswered,
  pollForTx,
  pollUntilCondition,
  REQUEST_TIMEOUT_RETRY_BUDGET_MS,
  retryOnTransientWalletInit,
} from './service-facade.helper';

const TIMEOUT_CODES = [AxiosError.ECONNABORTED, AxiosError.ETIMEDOUT];

/** What axios throws when the wallet-service doesn't answer within the request timeout. */
function requestTimeout(code: string = AxiosError.ECONNABORTED): AxiosError {
  return new AxiosError('timeout of 10000ms exceeded', code);
}

/** What axios throws when nothing accepts the connection, e.g. the container is down. */
function connectionRefused(): AxiosError {
  return new AxiosError('connect ECONNREFUSED 127.0.0.1:3000', 'ECONNREFUSED');
}

function pollingWallet(getTxById: jest.Mock): HathorWalletServiceWallet {
  return { getTxById } as unknown as HathorWalletServiceWallet;
}

afterEach(() => {
  // The stall clock is shared across test files; never leave one running.
  markServiceAnswered();
  jest.restoreAllMocks();
});

describe('pollForTx', () => {
  it.each(TIMEOUT_CODES)('keeps polling after a request timeout (%s)', async code => {
    const tx = { success: true };
    const getTxById = jest
      .fn()
      .mockRejectedValueOnce(requestTimeout(code))
      .mockResolvedValueOnce(tx);

    await expect(pollForTx(pollingWallet(getTxById), 'tx-id')).resolves.toBe(tx);
    expect(getTxById).toHaveBeenCalledTimes(2);
  });

  it('keeps polling while the tx is not found', async () => {
    const tx = { success: true };
    const getTxById = jest
      .fn()
      .mockRejectedValueOnce(new TxNotFoundError('not found'))
      .mockResolvedValueOnce(tx);

    await expect(pollForTx(pollingWallet(getTxById), 'tx-id')).resolves.toBe(tx);
    expect(getTxById).toHaveBeenCalledTimes(2);
  });

  it('rethrows a request failure that is not a timeout', async () => {
    const getTxById = jest
      .fn()
      .mockRejectedValueOnce(connectionRefused())
      .mockResolvedValueOnce({ success: true });

    await expect(pollForTx(pollingWallet(getTxById), 'tx-id')).rejects.toThrow('ECONNREFUSED');
    expect(getTxById).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other error immediately', async () => {
    const getTxById = jest.fn().mockRejectedValue(new Error('unexpected'));

    await expect(pollForTx(pollingWallet(getTxById), 'tx-id')).rejects.toThrow('unexpected');
    expect(getTxById).toHaveBeenCalledTimes(1);
  });
});

describe('pollUntilCondition', () => {
  it.each(TIMEOUT_CODES)(
    'keeps polling after a request timeout, without spending an attempt (%s)',
    async code => {
      const predicate = jest
        .fn()
        .mockRejectedValueOnce(requestTimeout(code))
        .mockResolvedValueOnce(true);

      // One attempt is enough: the timed-out call doesn't count.
      await expect(pollUntilCondition(predicate, 'test', 1, 0)).resolves.toBe(true);
      expect(predicate).toHaveBeenCalledTimes(2);
    }
  );

  it('keeps polling while the condition is not met', async () => {
    const predicate = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce('done');

    await expect(pollUntilCondition(predicate, 'test', 3, 0)).resolves.toBe('done');
    expect(predicate).toHaveBeenCalledTimes(2);
  });

  it('rethrows a request failure that is not a timeout', async () => {
    const predicate = jest.fn().mockRejectedValueOnce(connectionRefused()).mockResolvedValue(true);

    await expect(pollUntilCondition(predicate, 'test', 3, 0)).rejects.toThrow('ECONNREFUSED');
    expect(predicate).toHaveBeenCalledTimes(1);
  });

  it('fails once the attempts run out', async () => {
    const predicate = jest.fn().mockResolvedValue(false);

    await expect(pollUntilCondition(predicate, 'test', 2, 0)).rejects.toThrow(
      'Condition "test" not met after 2 attempts'
    );
  });
});

describe('retryOnTransientWalletInit', () => {
  it.each(TIMEOUT_CODES)('retries after a request timeout (%s)', async code => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(requestTimeout(code))
      .mockResolvedValueOnce('started');

    await expect(retryOnTransientWalletInit(op, 'test')).resolves.toBe('started');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('retries after the transient wallet/init rejection', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new WalletRequestError('Error creating wallet.'))
      .mockResolvedValueOnce('started');

    await expect(retryOnTransientWalletInit(op, 'test')).resolves.toBe('started');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('rethrows a request failure that is not a timeout', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(connectionRefused())
      .mockResolvedValueOnce('started');

    await expect(retryOnTransientWalletInit(op, 'test')).rejects.toThrow('ECONNREFUSED');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other error immediately', async () => {
    const op = jest.fn().mockRejectedValue(new Error('Crash'));

    await expect(retryOnTransientWalletInit(op, 'test')).rejects.toThrow('Crash');
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe('request-timeout budget', () => {
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  /** Times out twice; the stall outlasts the budget between the two attempts. */
  function opOutlastingTheBudget(): jest.Mock {
    return jest
      .fn()
      .mockImplementationOnce(async () => {
        throw requestTimeout();
      })
      .mockImplementationOnce(async () => {
        now += REQUEST_TIMEOUT_RETRY_BUDGET_MS;
        throw requestTimeout();
      });
  }

  it('is shared: once a stall outlasts it, later calls stop retrying timeouts', async () => {
    const op = opOutlastingTheBudget();
    await expect(retryOnTransientWalletInit(op, 'test')).rejects.toThrow('timeout');
    expect(op).toHaveBeenCalledTimes(2);

    // The service still hasn't answered, so the next timeout isn't retried.
    const getTxById = jest
      .fn()
      .mockRejectedValueOnce(requestTimeout())
      .mockResolvedValueOnce({ success: true });
    await expect(pollForTx(pollingWallet(getTxById), 'tx-id')).rejects.toThrow('timeout');
    expect(getTxById).toHaveBeenCalledTimes(1);

    // pollUntilCondition shares the same budget.
    const predicate = jest.fn().mockRejectedValueOnce(requestTimeout()).mockResolvedValue(true);
    await expect(pollUntilCondition(predicate, 'test', 3, 0)).rejects.toThrow('timeout');
    expect(predicate).toHaveBeenCalledTimes(1);
  });

  it('starts over once the service answers', async () => {
    await expect(retryOnTransientWalletInit(opOutlastingTheBudget(), 'test')).rejects.toThrow(
      'timeout'
    );

    const getTxById = jest.fn().mockResolvedValueOnce({ success: true });
    await pollForTx(pollingWallet(getTxById), 'tx-id');

    const op = jest.fn().mockRejectedValueOnce(requestTimeout()).mockResolvedValueOnce('started');
    await expect(retryOnTransientWalletInit(op, 'test')).resolves.toBe('started');
    expect(op).toHaveBeenCalledTimes(2);
  });
});

describe('GenesisWalletServiceHelper.start', () => {
  beforeAll(() => {
    initializeServiceGlobalConfigs();
  });

  afterAll(async () => {
    await GenesisWalletServiceHelper.stop();
  });

  it('retries a wallet/init request that timed out', async () => {
    const createWallet = jest
      .spyOn(walletApi, 'createWallet')
      .mockRejectedValueOnce(requestTimeout());

    await GenesisWalletServiceHelper.start();

    expect(createWallet).toHaveBeenCalledTimes(2);
    const gWallet = await GenesisWalletServiceHelper.getSingleton();
    expect(gWallet.isReady()).toBe(true);
  });
});
