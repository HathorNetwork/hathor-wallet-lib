/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unit tests for the integration-test-helper client.
 *
 * The module lives under `__tests__/integration/helpers/`, which
 * `jest.config.js` excludes from *discovery* — but not from `require()`. So the
 * test file sits here instead, where it runs in the fast unit suite rather than
 * only inside the multi-hour docker suite. Same arrangement as
 * `mergePrecalculatedAddresses.test.ts`.
 *
 * Retry, backoff and error classification are the parts of this module with
 * real logic and no integration coverage: a failure there degrades silently
 * into "the helper was flaky" rather than surfacing as an obvious bug.
 */
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Set before the require below: test.config reads process.env at module-load
// time. A tiny backoff keeps the retry tests off real seconds of sleeping.
process.env.ITH_MAX_RETRIES = '2';
process.env.ITH_RETRY_BASE_DELAY_MS = '1';
process.env.ITH_TIMEOUT_MS = '45000';

// Required rather than imported so the env above is in place first, and loaded
// exactly once — re-requiring a module graph under jest.resetModules() risks
// tripping bitcore's duplicate-instance guard, which is why the config tests
// below reset around test.config only.
// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const { ithService, IthServiceError } = require('../integration/helpers/ith-service');

/**
 * Re-load only `test.config` under a given env. Safe to reset around, unlike
 * the client module, because test.config has no heavyweight imports.
 */
function loadConfigWith(env: Record<string, string>): () => unknown {
  return () => {
    jest.resetModules();
    const saved = { ...process.env };
    Object.keys(process.env)
      .filter(key => key.startsWith('ITH_'))
      .forEach(key => delete process.env[key]);
    Object.assign(process.env, env);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      return require('../integration/configuration/test.config');
    } finally {
      process.env = saved;
    }
  };
}

/**
 * Stand in for the logger the integration setup installs, exposing exactly the
 * methods `LoggerUtil` really has — `log`, `warn`, `error`, and no `info`.
 *
 * This matters more than it looks. `loggers.test` is nullish outside the
 * integration environment, so `loggers.test?.anything()` short-circuits and
 * every logging line in the retry path becomes unreachable. A retry test
 * written without this passes even when the logging call is wrong, which is
 * precisely how a `?.info(...)` typo survived into the branch: it throws
 * `TypeError` only once the object exists. Installing the stub is what gives
 * these tests the ability to fail.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const { loggers } = require('../integration/utils/logger.util');

beforeAll(() => {
  loggers.test = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

afterAll(() => {
  loggers.test = null;
});

const ok = (data: unknown) => ({ status: 200, data });
const err = (status: number, data: unknown) => ({ status, data });

const RETRYABLE_BODY = { error: 'SERVICE_NOT_READY', message: 'warming up', retryable: true };
const FATAL_BODY = { error: 'INVALID_REQUEST', message: 'bad address', retryable: false };

const VALID_WALLET = { words: 'a b c', addresses: ['addr0'] };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ithService retry behaviour', () => {
  it('retries a retryable failure up to maxRetries and then throws', async () => {
    mockedAxios.request.mockResolvedValue(err(503, RETRYABLE_BODY));

    await expect(ithService.getSimpleWallet()).rejects.toThrow('warming up');

    // maxRetries=2 means three attempts total. Before the `.warn` fix this was
    // 1, because the retry log threw a TypeError outside the try block.
    expect(mockedAxios.request).toHaveBeenCalledTimes(3);
  });

  it('does not retry a failure the helper declared non-retryable', async () => {
    mockedAxios.request.mockResolvedValue(err(400, FATAL_BODY));

    await expect(ithService.getSimpleWallet()).rejects.toThrow('bad address');
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });

  it('recovers when a retryable failure is followed by success', async () => {
    mockedAxios.request
      .mockResolvedValueOnce(err(503, RETRYABLE_BODY))
      .mockResolvedValueOnce(ok(VALID_WALLET));

    await expect(ithService.getSimpleWallet()).resolves.toMatchObject({ words: 'a b c' });
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });

  it('preserves the typed error contract through the retry path', async () => {
    mockedAxios.request.mockResolvedValue(err(503, RETRYABLE_BODY));

    await expect(ithService.getSimpleWallet()).rejects.toMatchObject({
      name: 'IthServiceError',
      code: 'SERVICE_NOT_READY',
      retryable: true,
      status: 503,
    });
    expect(IthServiceError).toBeDefined();
  });
});

describe('ithService idempotency', () => {
  it('retries a transport failure on the idempotent GET', async () => {
    mockedAxios.request.mockRejectedValue(new Error('timeout of 45000ms exceeded'));

    await expect(ithService.getSimpleWallet()).rejects.toThrow('timeout');
    expect(mockedAxios.request).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a transport failure on the non-idempotent POST /fund', async () => {
    mockedAxios.request.mockRejectedValue(new Error('timeout of 45000ms exceeded'));

    await expect(ithService.fund('addr', 10n)).rejects.toThrow('timeout');

    // Count only the funding calls: a failed fund also fires a best-effort
    // GET /status diagnostic, which is a separate request and must not be
    // mistaken for a retry.
    const fundCalls = mockedAxios.request.mock.calls.filter(([cfg]) =>
      String(cfg?.url).endsWith('/fund')
    );
    // A timed-out fund may already have reserved a UTXO and broadcast; replaying
    // it would double-fund the address.
    expect(fundCalls).toHaveLength(1);
  });

  it('still honours a helper-declared retryable failure on POST /fund', async () => {
    mockedAxios.request
      .mockResolvedValueOnce(err(503, RETRYABLE_BODY))
      .mockResolvedValueOnce(ok({ txId: 'deadbeef', amount: '1000', utxoSource: 'test' }));

    await expect(ithService.fund('addr', 10n)).resolves.toMatchObject({ txId: 'deadbeef' });
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });
});

describe('ithService response validation', () => {
  it('rejects a 2xx fund response with no txId', async () => {
    mockedAxios.request.mockResolvedValue(ok('<html>oops</html>'));

    await expect(ithService.fund('addr', 10n)).rejects.toThrow('no txId');
  });

  it('rejects a 2xx simpleWallet response of the wrong shape', async () => {
    mockedAxios.request.mockResolvedValue(ok({ words: 'a b c' }));

    await expect(ithService.getSimpleWallet()).rejects.toThrow('unexpected shape');
  });

  it('sends bigint amounts as digit-strings, not numbers', async () => {
    mockedAxios.request.mockResolvedValue(ok({ txId: 'x', amount: '1', utxoSource: 'test' }));

    await ithService.fund('addr', 9007199254740993n);

    expect(mockedAxios.request).toHaveBeenCalledWith(
      expect.objectContaining({ data: { address: 'addr', amount: '9007199254740993' } })
    );
  });

  it('keeps a non-conforming error body in the message', async () => {
    mockedAxios.request.mockResolvedValue(err(404, '<html>no such route</html>'));

    await expect(ithService.getSimpleWallet()).rejects.toThrow('no such route');
  });
});

describe('ithService configuration validation', () => {
  it('refuses a non-numeric retry count instead of silently skipping retries', () => {
    expect(loadConfigWith({ ITH_MAX_RETRIES: 'abc' })).toThrow('ITH_MAX_RETRIES');
  });

  it('refuses a zero timeout, which axios would read as no timeout at all', () => {
    expect(loadConfigWith({ ITH_TIMEOUT_MS: '0' })).toThrow('ITH_TIMEOUT_MS');
  });

  it('falls back to defaults when nothing is set', () => {
    const config = loadConfigWith({})() as { ithTimeoutMs: number; ithMaxRetries: number };
    // Must exceed the helper's 30s FUND_TIMEOUT_MS so the client does not abort first.
    expect(config.ithTimeoutMs).toBeGreaterThan(30000);
    expect(config.ithMaxRetries).toBeGreaterThan(0);
  });
});
