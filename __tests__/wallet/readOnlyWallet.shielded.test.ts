/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { WalletServiceSendStorage } from '../../src/wallet/walletServiceSendStorage';
import { WalletServiceStorageProxy } from '../../src/wallet/walletServiceStorageProxy';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src/storage';
import walletApi from '../../src/wallet/api/walletApi';
import walletUtils from '../../src/utils/wallet';
import helpers from '../../src/utils/helpers';
import { P2PKH_ACCT_PATH } from '../../src/constants';
import { WalletRequestError } from '../../src/errors';
import { IShieldedCryptoProvider } from '../../src/shielded/types';
import { Utxo } from '../../src/wallet/types';
import {
  shieldedFixtureSeed,
  shieldedFixtureAddresses,
  buildShieldedNewAddressesResponse,
  buildShieldedAddressRow,
  buildShieldedTxOutputEntry,
} from '../__mock_helpers__/shielded-ws.fixtures';

const network = new Network('testnet');
const root = walletUtils.getXPrivKeyFromSeed(shieldedFixtureSeed, { networkName: 'testnet' });
// The account-level xpub an xpub-only wallet starts from
const xpub = root.deriveNonCompliantChild(P2PKH_ACCT_PATH).xpubkey;
const shieldedXpubs = walletUtils.deriveShieldedXpubs(root);
const scanXPrivKey = walletUtils.deriveShieldedScanXPrivKey(root);

function walletStatus(shieldedStatus: string | undefined, legacyStatus = 'ready') {
  return {
    success: true,
    status: {
      walletId: HathorWalletServiceWallet.getWalletIdFromXPub(xpub),
      xpubkey: xpub,
      status:
        shieldedStatus === 'error' || shieldedStatus === 'creating' ? shieldedStatus : 'ready',
      maxGap: 20,
      createdAt: 0,
      readyAt: 0,
      ...(shieldedStatus === undefined ? {} : { legacyStatus, shieldedStatus }),
    },
  };
}

function makeProvider(): IShieldedCryptoProvider {
  return {
    rewindAmountShieldedOutput: jest
      .fn()
      .mockResolvedValue({ value: 150n, blindingFactor: Buffer.alloc(32, 1) }),
  } as unknown as IShieldedCryptoProvider;
}

/**
 * An xpub-only wallet, like a passkey wallet, whose wallet-service answers
 * `wallet/status` with `statuses`, one per request (the last one repeats),
 * and has `registeredRow` as its shielded address at index 0.
 */
function setup({
  statuses = [walletStatus('ready')] as unknown[],
  registeredRow = buildShieldedAddressRow(0) as unknown,
} = {}) {
  const storage = new Storage(new MemoryStore());
  const wallet = new HathorWalletServiceWallet({
    requestPassword: jest.fn(),
    xpub,
    network,
    storage,
  });
  // @ts-expect-error - Accessing private method for testing
  jest.spyOn(wallet, 'isWsEnabled').mockReturnValue(false);
  jest.spyOn(helpers, 'sleep').mockResolvedValue(undefined);
  jest
    .spyOn(walletApi, 'createReadOnlyAuthToken')
    .mockResolvedValue({ success: true, token: 'ro-token' } as never);
  const statusSpy = jest.spyOn(walletApi, 'getWalletStatus');
  statuses.forEach((status, i) => {
    const answer = async () => {
      if (status instanceof Error) {
        throw status;
      }
      return status as never;
    };
    if (i === statuses.length - 1) {
      statusSpy.mockImplementation(answer);
    } else {
      statusSpy.mockImplementationOnce(answer);
    }
  });
  const newAddressesSpy = jest
    .spyOn(walletApi, 'getNewAddresses')
    .mockImplementation(async (_w, options) =>
      options?.legacy === false
        ? (buildShieldedNewAddressesResponse() as never)
        : ({
            success: true,
            addresses: [{ address: 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx', index: 0 }],
          } as never)
    );
  const addressesSpy = jest.spyOn(walletApi, 'getAddresses').mockImplementation(async () => {
    if (registeredRow instanceof Error) {
      throw registeredRow;
    }
    return { success: true, addresses: registeredRow ? [registeredRow] : [] } as never;
  });
  const warn = jest.spyOn(storage.logger, 'warn').mockImplementation(() => {});
  return { wallet, storage, statusSpy, newAddressesSpy, addressesSpy, warn };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('startReadOnly with the shielded xpubs', () => {
  it('keeps the xpubs on the record and enables the shielded side the service has ready', async () => {
    const { wallet, storage, newAddressesSpy, addressesSpy } = setup();

    await wallet.startReadOnly({ shieldedXpubs });

    expect(addressesSpy).toHaveBeenCalledWith(wallet, 0, { legacy: false });

    expect(wallet.isReady()).toBe(true);
    expect(wallet.isShieldedEnabled()).toBe(true);
    const accessData = await storage.getAccessData();
    expect(accessData).toMatchObject({
      scanXpubkey: shieldedXpubs.scanXpubkey,
      spendXpubkey: shieldedXpubs.spendXpubkey,
    });
    // Public data only
    expect(accessData?.scanMainKey).toBeUndefined();
    expect(accessData?.spendMainKey).toBeUndefined();
    expect(newAddressesSpy).toHaveBeenCalledWith(wallet, { legacy: false });
    expect(wallet.getCurrentAddress({}, { legacy: false }).address).toBe(
      shieldedFixtureAddresses[0].shieldedBase58
    );
  });

  it('waits while the service still loads the shielded side', async () => {
    const { wallet, statusSpy } = setup({
      statuses: [
        walletStatus('creating'),
        new WalletRequestError('transient'),
        walletStatus('ready'),
      ],
    });

    await wallet.startReadOnly({ shieldedXpubs });

    expect(statusSpy).toHaveBeenCalledTimes(3);
    expect(wallet.isShieldedEnabled()).toBe(true);
  });

  it('runs legacy-only when the shielded load failed, dropping any scan key', async () => {
    const { wallet, storage, newAddressesSpy, warn } = setup({
      statuses: [walletStatus('error')],
    });
    storage.scanXPrivKey = scanXPrivKey;

    await wallet.startReadOnly({ shieldedXpubs });

    expect(wallet.isReady()).toBe(true);
    expect(wallet.isShieldedEnabled()).toBe(false);
    expect(storage.scanXPrivKey).toBeNull();
    expect(newAddressesSpy).toHaveBeenCalledWith(wallet);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/failed to load the shielded side/));
    expect(() => wallet.getCurrentAddress({}, { legacy: false })).toThrow(
      expect.objectContaining({ errorCode: 'shielded-no-keys' })
    );
  });

  it.each([
    ['without shielded keys', walletStatus('none')],
    ['from a service that does not report the shielded side', walletStatus(undefined)],
  ])('runs legacy-only for a wallet registered %s', async (_case, status) => {
    const { wallet, statusSpy, warn } = setup({ statuses: [status] });

    await wallet.startReadOnly({ shieldedXpubs });

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(wallet.isShieldedEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no ready shielded side/));
  });

  it.each([
    [
      'other shielded keys',
      { ...buildShieldedAddressRow(1), index: 0 },
      /are not the given shielded xpubs/,
    ],
    [
      'the given scan key with another spend key',
      { ...buildShieldedAddressRow(0), spendAddress: shieldedFixtureAddresses[1].spendBase58 },
      /are not the given shielded xpubs/,
    ],
    ['no shielded address', null, /could not be checked/],
    ['a failing address request', new WalletRequestError('no'), /could not be checked/],
  ])(
    'runs legacy-only when the service has %s at index 0',
    async (_case, registeredRow, message) => {
      const { wallet, newAddressesSpy, warn } = setup({ registeredRow });

      await wallet.startReadOnly({ shieldedXpubs });

      expect(wallet.isReady()).toBe(true);
      expect(wallet.isShieldedEnabled()).toBe(false);
      expect(newAddressesSpy).toHaveBeenCalledWith(wallet);
      expect(newAddressesSpy).not.toHaveBeenCalledWith(wallet, { legacy: false });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(message));
    }
  );

  it('fails the start on an error that is not a request error from the address check', async () => {
    const { wallet } = setup({ registeredRow: new TypeError('broken') });

    await expect(wallet.startReadOnly({ shieldedXpubs })).rejects.toThrow('broken');
  });

  it('gives up after a few failed status requests, without waiting for the poll limit', async () => {
    const { wallet, statusSpy, addressesSpy, warn } = setup({
      statuses: [new WalletRequestError('down')],
    });

    await wallet.startReadOnly({ shieldedXpubs });

    expect(statusSpy).toHaveBeenCalledTimes(3);
    expect(addressesSpy).not.toHaveBeenCalled();
    expect(wallet.isShieldedEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/shielded status: unknown/));
  });

  it('keeps waiting through failed status requests that are not in a row', async () => {
    const { wallet, statusSpy } = setup({
      statuses: [
        new WalletRequestError('transient'),
        walletStatus('creating'),
        new WalletRequestError('transient'),
        walletStatus('creating'),
        new WalletRequestError('transient'),
        walletStatus('ready'),
      ],
    });

    await wallet.startReadOnly({ shieldedXpubs });

    expect(statusSpy).toHaveBeenCalledTimes(6);
    expect(wallet.isShieldedEnabled()).toBe(true);
  });

  it('fails the start on a status error that is not a request error, without polling', async () => {
    const { wallet, statusSpy } = setup({ statuses: [new TypeError('network down')] });

    await expect(wallet.startReadOnly({ shieldedXpubs })).rejects.toThrow('network down');
    expect(statusSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['without the xpubs', undefined, walletStatus('ready')],
    ['with a shielded side the service does not have', shieldedXpubs, walletStatus('none')],
  ])(
    'drops the shielded side of an earlier session when restarted %s',
    async (_case, nextXpubs, nextStatus) => {
      const { wallet, statusSpy, newAddressesSpy } = setup();
      await wallet.startReadOnly({ shieldedXpubs });
      expect(wallet.isShieldedEnabled()).toBe(true);
      await wallet.stop({ cleanStorage: true });
      statusSpy.mockResolvedValue(nextStatus as never);
      newAddressesSpy.mockClear();

      await wallet.startReadOnly(nextXpubs ? { shieldedXpubs: nextXpubs } : undefined);

      expect(wallet.isShieldedEnabled()).toBe(false);
      expect(newAddressesSpy).toHaveBeenCalledWith(wallet);
      expect(newAddressesSpy).not.toHaveBeenCalledWith(wallet, { legacy: false });
    }
  );

  it('runs legacy-only when the status never settles', async () => {
    const { wallet, statusSpy } = setup({ statuses: [walletStatus('creating')] });

    await wallet.startReadOnly({ shieldedXpubs });

    expect(statusSpy.mock.calls.length).toBeGreaterThan(1);
    expect(wallet.isShieldedEnabled()).toBe(false);
  });

  it('starts as before without the xpubs: no status request and no shielded chain', async () => {
    const { wallet, storage, statusSpy, newAddressesSpy } = setup();

    await wallet.startReadOnly();

    expect(statusSpy).not.toHaveBeenCalled();
    expect(wallet.isShieldedEnabled()).toBe(false);
    expect(newAddressesSpy).toHaveBeenCalledWith(wallet);
    const accessData = await storage.getAccessData();
    expect(accessData?.scanXpubkey).toBeUndefined();
    expect(accessData?.spendXpubkey).toBeUndefined();
  });

  it('refuses only one of the two xpubs before changing anything', async () => {
    const { wallet, storage } = setup();
    const saveSpy = jest.spyOn(storage, 'saveAccessData');
    const stateBefore = wallet.state;

    await expect(
      wallet.startReadOnly({
        shieldedXpubs: { scanXpubkey: shieldedXpubs.scanXpubkey, spendXpubkey: '' },
      })
    ).rejects.toThrow('The shielded scan and spend xpubs must be given together.');

    expect(wallet.state).toBe(stateBefore);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(walletApi.createReadOnlyAuthToken).not.toHaveBeenCalled();
  });

  it('marks the inputs on the spend chain shielded-spend, for the external signer', async () => {
    const { wallet, storage } = setup();
    await wallet.startReadOnly({ shieldedXpubs });
    jest.spyOn(wallet, 'getAddressDetails').mockResolvedValue({
      address: shieldedFixtureAddresses[1].spendBase58,
      index: 1,
      transactions: 1,
      seqnum: 0,
    });
    const proxy = new WalletServiceStorageProxy(wallet, storage).createProxy();

    await expect(
      proxy.getAddressInfo(shieldedFixtureAddresses[1].spendBase58)
    ).resolves.toMatchObject({ bip32AddressIndex: 1, addressType: 'shielded-spend' });
  });

  it('selects and opens its shielded utxos with the scan key set for the session', async () => {
    const { wallet, storage } = setup();
    const provider = makeProvider();
    wallet.setShieldedCryptoProvider(provider);
    await wallet.startReadOnly({ shieldedXpubs });
    await wallet.setShieldedScanKey(scanXPrivKey);
    const entry = {
      ...buildShieldedTxOutputEntry({ mode: 1, index: 5, shieldedIndex: 1 }),
      tokenId: '00',
      address: shieldedFixtureAddresses[1].spendBase58,
      value: 150n,
      authorities: 0n,
      timelock: null,
      heightlock: null,
      locked: false,
      addressPath: "m/44'/280'/2'/0/1",
      shieldedIndex: 1,
      recoveryState: 'recovered',
      commitment: '08'.repeat(33),
      rangeProof: 'cc'.repeat(10),
      ephemeralPubkey: '02'.repeat(33),
    } as unknown as Utxo;
    jest.spyOn(walletApi, 'getTxOutputs').mockImplementation(async (_w, options = {}) => ({
      success: true,
      txOutputs: options.kind === 'shielded' ? [entry] : [],
    }));
    const proxy = new WalletServiceSendStorage(wallet).createProxy();

    const utxos = [];
    for await (const utxo of proxy.selectUtxos({ shielded: true })) {
      utxos.push(utxo);
    }

    expect(utxos).toHaveLength(1);
    expect(utxos[0]).toMatchObject({ shielded: true, value: 150n });
    expect(provider.rewindAmountShieldedOutput).toHaveBeenCalledTimes(1);
    expect(storage.scanXPrivKey).toBe(scanXPrivKey);
  });
});

describe('setShieldedScanKey', () => {
  async function started() {
    const ctx = setup();
    await ctx.wallet.startReadOnly({ shieldedXpubs });
    return ctx;
  }

  it('keeps the scan key of the record in memory, and null drops it', async () => {
    const { wallet, storage } = await started();

    await wallet.setShieldedScanKey(scanXPrivKey);
    expect(storage.scanXPrivKey).toBe(scanXPrivKey);
    // Never persisted
    expect(JSON.stringify(await storage.getAccessData())).not.toContain(scanXPrivKey);

    await wallet.setShieldedScanKey(null);
    expect(storage.scanXPrivKey).toBeNull();
  });

  it('refuses a key that is not the key of the record scan xpub, keeping the one in memory', async () => {
    const { wallet, storage } = await started();
    await wallet.setShieldedScanKey(scanXPrivKey);
    const otherRoot = walletUtils.getXPrivKeyFromSeed(walletUtils.generateWalletWords(), {
      networkName: 'testnet',
    });

    await expect(
      wallet.setShieldedScanKey(walletUtils.deriveShieldedScanXPrivKey(otherRoot))
    ).rejects.toMatchObject({ name: 'ShieldedKeyError', errorCode: 'shielded-key-mismatch' });
    await expect(wallet.setShieldedScanKey(shieldedXpubs.scanXpubkey)).rejects.toMatchObject({
      errorCode: 'shielded-corrupt-key',
    });
    expect(storage.scanXPrivKey).toBe(scanXPrivKey);
  });

  it('refuses a key on a record without the shielded xpubs', async () => {
    const { wallet, storage } = setup();
    await wallet.startReadOnly();

    await expect(wallet.setShieldedScanKey(scanXPrivKey)).rejects.toMatchObject({
      errorCode: 'shielded-no-keys',
    });
    expect(storage.scanXPrivKey).toBeNull();
  });

  it('refuses a key before start, and one set while stop() runs', async () => {
    const fresh = setup();
    await expect(fresh.wallet.setShieldedScanKey(scanXPrivKey)).rejects.toMatchObject({
      errorCode: 'shielded-not-started',
    });
    expect(fresh.storage.scanXPrivKey).toBeNull();

    const { wallet, storage } = await started();
    const getAccessData = storage.getAccessData.bind(storage);
    let stopping: Promise<void> | undefined;
    jest.spyOn(storage, 'getAccessData').mockImplementationOnce(async () => {
      const accessData = await getAccessData();
      stopping = wallet.stop({ cleanStorage: false });
      await stopping;
      return accessData;
    });

    await expect(wallet.setShieldedScanKey(scanXPrivKey)).rejects.toMatchObject({
      errorCode: 'shielded-not-started',
    });
    await stopping;
    expect(storage.scanXPrivKey).toBeNull();
  });

  it('is dropped by stop()', async () => {
    const { wallet, storage } = await started();
    await wallet.setShieldedScanKey(scanXPrivKey);

    await wallet.stop({ cleanStorage: true });

    expect(storage.scanXPrivKey).toBeNull();
  });
});

describe('setExternalTxSigningMethod', () => {
  it('takes the shieldedSpend option as the fullnode facade does', async () => {
    const { wallet, storage } = setup();
    await wallet.startReadOnly({ shieldedXpubs });
    const signer = jest.fn();

    wallet.setExternalTxSigningMethod(signer, { shieldedSpend: true });
    expect(storage.hasTxSignatureMethod()).toBe(true);
    expect(await wallet.isReadonly()).toBe(false);

    wallet.setExternalTxSigningMethod(null);
    expect(storage.hasTxSignatureMethod()).toBe(false);
  });
});
