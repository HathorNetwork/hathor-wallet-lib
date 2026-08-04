import type HathorWalletServiceWallet from '../../src/wallet/wallet';
import {
  buildWalletInstance,
  initializeServiceGlobalConfigs,
} from './helpers/service-facade.helper';
import { WalletAddressMode } from '../../src/types';
import { GenesisWalletServiceHelper } from './helpers/genesis-wallet.helper';

// Set base URL for the wallet service API inside the privatenet test container
initializeServiceGlobalConfigs();

/** Default pin to simplify the tests */
const pinCode = '123456';
/** Default password to simplify the tests */
const password = 'testpass';

beforeAll(async () => {
  await GenesisWalletServiceHelper.start();
});

afterAll(async () => {
  await GenesisWalletServiceHelper.stop();
});

// empty wallet address method tests moved to shared/addresses.test.ts and service-specific/addresses.test.ts

describe.skip('websocket events', () => {});

// balances tests moved to shared/get-balance.test.ts and service-specific/get-balance.test.ts

// address management method tests moved to shared/addresses.test.ts and service-specific/addresses.test.ts

/**
 * Every test here acquires its own freshly generated wallet through
 * `buildWalletInstance()` (which pulls from the precalculated wallet provider
 * when no seed is given). Do NOT reintroduce module-level hardcoded seeds.
 *
 * These assertions are about which addresses a wallet has *ever* received a tx
 * on, and funding is on-chain and therefore irreversible: once a seed has a tx
 * on index 1, it has it forever. Combined with `jest.retryTimes(2)` in
 * `setupTests-integration.js`, a shared seed is a guaranteed false failure —
 * jest-circus defers a failed test's retries until *every sibling test in the
 * block has run* (see the `deferredRetryTests` loop in jest-circus' `run.js`),
 * so a retry observes the end-state of the whole describe, not the state its
 * own first attempt left behind. That is exactly how a one-off `wallet/init`
 * flake in "only has tx on index 0" turned permanently red: the siblings below
 * had meanwhile funded index 1 of the seed it shared with them.
 */
describe('single-address mode', () => {
  /** Wallet under test — reassigned by each test, stopped in `afterEach`. */
  let wallet: HathorWalletServiceWallet;

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  it('should enable single-address mode and keep index 0 as current address after receiving tx', async () => {
    let addresses: string[];
    ({ wallet, addresses } = await buildWalletInstance());
    await wallet.start({ pinCode, password });

    await wallet.enableSingleAddressMode();

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(addresses[0]);

    await GenesisWalletServiceHelper.injectFunds(addresses[0], 10n, wallet);

    const currentAddressAfterTx = wallet.getCurrentAddress();
    expect(currentAddressAfterTx.index).toBe(0);
    expect(currentAddressAfterTx.address).toBe(addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(addresses[0]);
  });

  it('should succeed enabling single-address mode when wallet only has tx on index 0', async () => {
    let addresses: string[];
    ({ wallet, addresses } = await buildWalletInstance());
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(addresses[0], 5n, wallet);

    await wallet.enableSingleAddressMode();

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(addresses[0]);
  });

  it('should fail to enable single-address mode when wallet has tx on index > 0', async () => {
    let addresses: string[];
    ({ wallet, addresses } = await buildWalletInstance());
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(addresses[1], 10n, wallet);

    await expect(wallet.enableSingleAddressMode()).rejects.toThrow(
      'Cannot enable single-address policy'
    );
  });

  it('should fallback to start in multi-address mode via constructor when wallet has tx on index > 0', async () => {
    // First, start wallet normally and fund index 1
    let words: string;
    let addresses: string[];
    ({ wallet, words, addresses } = await buildWalletInstance());
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(addresses[1], 10n, wallet);

    await wallet.stop({ cleanStorage: true });

    // Now re-start the *same* seed with singleAddressMode: true via constructor
    ({ wallet } = await buildWalletInstance({ words, singleAddressMode: true }));

    await wallet.start({ pinCode, password });

    await expect(wallet.getAddressMode()).resolves.toBe(WalletAddressMode.MULTI);
  });

  it('should start in single-address mode via constructor', async () => {
    let addresses: string[];
    ({ wallet, addresses } = await buildWalletInstance({ singleAddressMode: true }));

    await wallet.start({ pinCode, password });

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(addresses[0]);
  });
});
