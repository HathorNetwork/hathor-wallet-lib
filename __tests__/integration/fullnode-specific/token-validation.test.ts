/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * tokensUtils.validateTokenToAddByConfigurationString() against a real fullnode.
 *
 * The validation queries the fullnode for the token info. A failed request
 * (network error, HTTP error) must reject the validation instead of leaving the
 * returned promise pending forever.
 */

import config from '../../../src/config';
import tokensUtils from '../../../src/utils/tokens';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { FULLNODE_URL } from '../configuration/test-constants';

// Nothing listens on port 1, so requests fail immediately with ECONNREFUSED.
const UNREACHABLE_SERVER_URL = 'http://127.0.0.1:1/v1a/';
const HANG_TIMEOUT_MS = 15_000;

const adapter = new FullnodeWalletTestAdapter();

/**
 * Settles with the given promise, or rejects if it is still pending after `ms`.
 */
function failIfPending<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Promise still pending after ${ms}ms: the request failure was swallowed`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Fullnode] tokensUtils.validateTokenToAddByConfigurationString', () => {
  let originalServerUrl: string;

  beforeEach(() => {
    originalServerUrl = config.getServerUrl();
    config.setServerUrl(FULLNODE_URL);
  });

  afterEach(() => {
    config.setServerUrl(originalServerUrl);
  });

  it('validates a token that exists on the fullnode', async () => {
    const { wallet } = await adapter.createWallet();
    const addr0 = (await wallet.getAddressAtIndex(0))!;
    await adapter.injectFunds(wallet, addr0, 10n);
    const token = await adapter.createToken(wallet, 'Validation Token', 'VLDT', 100n);

    const configString = tokensUtils.getConfigurationString(token.hash, 'Validation Token', 'VLDT');
    await expect(
      failIfPending(
        tokensUtils.validateTokenToAddByConfigurationString(configString),
        HANG_TIMEOUT_MS
      )
    ).resolves.toMatchObject({ uid: token.hash, name: 'Validation Token', symbol: 'VLDT' });

    // A name mismatch is reported by the fullnode response, not the request.
    const wrongName = tokensUtils.getConfigurationString(token.hash, 'Wrong Name', 'VLDT');
    await expect(
      failIfPending(tokensUtils.validateTokenToAddByConfigurationString(wrongName), HANG_TIMEOUT_MS)
    ).rejects.toThrow('Token name does not match');
  });

  it('rejects instead of hanging when the token info request fails', async () => {
    config.setServerUrl(UNREACHABLE_SERVER_URL);

    const configString = tokensUtils.getConfigurationString(
      '00000000000000000000000000000000000000000000000000000000000000ff',
      'Any Token',
      'ANY'
    );
    const validation = failIfPending(
      tokensUtils.validateTokenToAddByConfigurationString(configString),
      HANG_TIMEOUT_MS
    );

    await expect(validation).rejects.toThrow();
    await expect(validation).rejects.not.toThrow(/still pending/);
  });
});
