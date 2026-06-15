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

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] addresses methods', () => {
  let wallet: HathorWalletServiceWallet;
  let knownAddresses: string[];
  const unknownAddress = WALLET_CONSTANTS.miner.addresses[0];

  beforeEach(async () => {
    const created = await adapter.createWallet();
    wallet = created.wallet as unknown as HathorWalletServiceWallet;
    if (!created.addresses) {
      throw new Error('Precalculated wallet has no addresses');
    }
    knownAddresses = created.addresses;
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
    // Advance the pointer until we are one short of the last known address
    for (let i = 0; i < knownAddresses.length - 1; i++) {
      wallet.getNextAddress();
    }

    const last = wallet.getNextAddress();
    expect(last.index).toBe(knownAddresses.length - 1);
    expect(last.address).toBe(knownAddresses[knownAddresses.length - 1]);
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
});
