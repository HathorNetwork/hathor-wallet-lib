/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade address-method tests.
 *
 * Tests for service-only behavior: REST-API-backed methods such as
 * `getAddressDetails`, `isAddressMine`, `checkAddressesMine`,
 * `getPrivateKeyFromAddress`, and the GAP_LIMIT_REACHED signal returned by
 * `getNextAddress`.
 *
 * Shared address tests live in `shared/addresses.test.ts`.
 */

import type { HathorWalletServiceWallet } from '../../../src';
import { WALLET_CONSTANTS } from '../configuration/test-constants';
import { WalletRequestError } from '../../../src/errors';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapter = new ServiceWalletTestAdapter();

/**
 * Gap limit of the Wallet Service in the integration test environment.
 *
 * This intentionally does NOT use the lib's GAP_LIMIT constant (20). The
 * integration private-net Wallet Service is configured with a smaller gap limit
 * to make boundary testing cheaper — see the `MAX_ADDRESS_GAP: 10` env var on
 * the wallet-service containers in
 * `__tests__/integration/configuration/docker-compose.yml` (commented there as
 * "Different from default 20 to facilitate tests").
 *
 * Because of this, a fresh wallet-service wallet only knows the addresses at
 * indices [0, SERVICE_GAP_LIMIT - 1]; asking the backend for any index at or
 * beyond SERVICE_GAP_LIMIT is rejected as "not mine". These tests therefore
 * bound their assertions to SERVICE_GAP_LIMIT, NOT to the full precalculated
 * address list. If the docker-compose value ever changes, update this constant
 * to match (a mismatch will fail loudly here, not silently pass).
 */
const SERVICE_GAP_LIMIT = 10;

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] addresses methods', () => {
  let wallet: HathorWalletServiceWallet;
  /** Full precalculated address list (more entries than the service gap limit). */
  let allPrecalculated: string[];
  /** Addresses the wallet-service wallet actually knows: the first SERVICE_GAP_LIMIT. */
  let knownAddresses: string[];
  const unknownAddress = WALLET_CONSTANTS.miner.addresses[0];

  beforeEach(async () => {
    const created = await adapter.createWallet();
    wallet = created.wallet as unknown as HathorWalletServiceWallet;
    if (!created.addresses) {
      throw new Error('Precalculated wallet has no addresses');
    }
    // The precalculated wallet exposes more addresses (currently 22) than the
    // wallet-service backend loads for a fresh wallet. Keep the full list for
    // the boundary tests (which need indices just past the limit), and restrict
    // the "known" set to the first SERVICE_GAP_LIMIT addresses — the only ones
    // the backend recognizes (see SERVICE_GAP_LIMIT docstring).
    allPrecalculated = created.addresses;
    knownAddresses = created.addresses.slice(0, SERVICE_GAP_LIMIT);
  });

  afterEach(async () => {
    if (wallet) {
      try {
        await wallet.stop({ cleanStorage: true });
      } catch {
        // Wallet may already be stopped
      }
    }
  });

  it('getAddressPathForIndex returns the BIP32 path for known indices', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const path = await wallet.getAddressPathForIndex(i);
      expect(path.endsWith(`/${i}`)).toBe(true);
      expect(path).toMatch(/^m\/44'\/280'\/0'\/0\/[0-9]+$/);
    }
  });

  it('getAddressPrivKey returns an HDPrivateKey for known indices', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const privKey = await wallet.getAddressPrivKey(adapter.defaultPinCode, i);
      expect(privKey.constructor.name).toBe('HDPrivateKey');
      expect(privKey.publicKey).toBeDefined();
      expect(privKey.privateKey).toBeDefined();
    }
  });

  it('isAddressMine returns true for known addresses', async () => {
    for (const address of knownAddresses) {
      const result = await wallet.isAddressMine(address);
      expect(result).toBe(true);
    }
  });

  it('isAddressMine returns false for an unknown address', async () => {
    const result = await wallet.isAddressMine(unknownAddress);
    expect(result).toBe(false);
  });

  it('checkAddressesMine maps known addresses to true and unknown to false', async () => {
    const addresses = [...knownAddresses, unknownAddress];
    const result = await wallet.checkAddressesMine(addresses);
    for (const known of knownAddresses) {
      expect(result[known]).toBe(true);
    }
    expect(result[unknownAddress]).toBe(false);
  });

  it('getPrivateKeyFromAddress returns a PrivateKey for known addresses', async () => {
    for (const address of knownAddresses) {
      const privKey = await wallet.getPrivateKeyFromAddress(address, {
        pinCode: adapter.defaultPinCode,
      });
      expect(privKey.constructor.name).toBe('PrivateKey');
      expect(privKey.toString()).toMatch(/[A-Fa-f0-9]{64}/);
    }
  });

  it('getPrivateKeyFromAddress throws for an unknown address', async () => {
    await expect(
      wallet.getPrivateKeyFromAddress(unknownAddress, { pinCode: adapter.defaultPinCode })
    ).rejects.toThrow(/does not belong to this wallet/);
  });

  it('getAllAddresses returns the same sequence on repeated calls', async () => {
    const firstCall = [];
    for await (const entry of wallet.getAllAddresses()) {
      firstCall.push(entry);
    }
    const secondCall = [];
    for await (const entry of wallet.getAllAddresses()) {
      secondCall.push(entry);
    }

    expect(firstCall.length).toBe(secondCall.length);
    expect(firstCall).toEqual(secondCall);
  });

  it('getNextAddress signals GAP_LIMIT_REACHED at the boundary', () => {
    // The wallet knows exactly SERVICE_GAP_LIMIT addresses (see beforeEach).
    // Advance the pointer to one short of the last, then the final call must
    // land on the last known address (index SERVICE_GAP_LIMIT - 1) and report
    // GAP_LIMIT_REACHED. If the Wallet Service's MAX_ADDRESS_GAP ever stops
    // matching SERVICE_GAP_LIMIT, last.index won't equal SERVICE_GAP_LIMIT - 1
    // and this fails loudly.
    for (let i = 0; i < SERVICE_GAP_LIMIT - 1; i++) {
      wallet.getNextAddress();
    }

    const last = wallet.getNextAddress();
    expect(last.index).toBe(SERVICE_GAP_LIMIT - 1);
    expect(last.address).toBe(knownAddresses[SERVICE_GAP_LIMIT - 1]);
    expect(last.info).toBe('GAP_LIMIT_REACHED');
  });

  it('getAddressDetails returns details for known addresses', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const details = await wallet.getAddressDetails(knownAddresses[i]);
      expect(details).toEqual(
        expect.objectContaining({
          address: knownAddresses[i],
          index: i,
          transactions: 0,
          seqnum: 0,
        })
      );
    }
  });

  it('getAddressDetails throws for an unknown address', async () => {
    await expect(wallet.getAddressDetails(unknownAddress)).rejects.toThrow(WalletRequestError);
  });

  /**
   * Gap-limit boundary checks for the wallet-service facade.
   *
   * A fresh wallet-service wallet knows exactly the addresses at indices
   * [0, SERVICE_GAP_LIMIT - 1]. These tests probe the three indices around that
   * edge using the FULL precalculated list (allPrecalculated), since the
   * addresses at and beyond the limit are deliberately outside knownAddresses:
   *
   *   - SERVICE_GAP_LIMIT - 1 : last index inside the window  -> recognized
   *   - SERVICE_GAP_LIMIT     : the precise cutoff (first one excluded) -> not mine
   *   - SERVICE_GAP_LIMIT + 1 : clearly past the window       -> "not my address"
   */
  describe('gap-limit boundary', () => {
    it('recognizes the address one short of the gap limit', async () => {
      // Index SERVICE_GAP_LIMIT - 1 is the last address inside the window.
      const insideAddress = allPrecalculated[SERVICE_GAP_LIMIT - 1];
      expect(await wallet.isAddressMine(insideAddress)).toBe(true);
    });

    it('does not recognize the address exactly at the gap limit', async () => {
      // Index SERVICE_GAP_LIMIT is the first address the backend does not load,
      // so it is already "not mine" — this pins down the precise cutoff.
      const atLimitAddress = allPrecalculated[SERVICE_GAP_LIMIT];
      expect(await wallet.isAddressMine(atLimitAddress)).toBe(false);
    });

    it('rejects the address one past the gap limit as not belonging to the wallet', async () => {
      // Index SERVICE_GAP_LIMIT + 1 is clearly outside the window: isAddressMine
      // is false and key derivation reports the "not my address" validation
      // response.
      const outsideAddress = allPrecalculated[SERVICE_GAP_LIMIT + 1];
      expect(await wallet.isAddressMine(outsideAddress)).toBe(false);
      await expect(
        wallet.getPrivateKeyFromAddress(outsideAddress, { pinCode: adapter.defaultPinCode })
      ).rejects.toThrow(/does not belong to this wallet/);
    });
  });
});
