/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey } from 'bitcore-lib';
import { MemoryStore, Storage } from '../../src/storage';
import walletUtils from '../../src/utils/wallet';
import { computeShieldedCapability, shieldedAddressRefusal } from '../../src/shielded/capability';
import { ShieldedViewCause } from '../../src/shielded/view';
import {
  IShieldedCapability,
  IShieldedCryptoProvider,
  ShieldedCapabilityReason,
} from '../../src/shielded/types';
import { ShieldedKeyError } from '../../src/errors';
import {
  EcdsaTxSign,
  HistorySyncMode,
  IWalletAccessData,
  WALLET_FLAGS,
  WalletType,
} from '../../src/types';

const SEED =
  'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

// The capability only checks that a provider is registered.
const provider = { id: 'mock' } as unknown as IShieldedCryptoProvider;

const signer: EcdsaTxSign = async () => ({ inputSignatures: [], ncCallerSignature: null });

const full = walletUtils.generateAccessDataFromSeed(SEED, {
  pin: '123',
  password: '456',
  networkName: 'testnet',
});

/** The seed record before the shielded keys were added to it. */
function preShielded(): IWalletAccessData {
  const {
    scanXpubkey: _scanXpubkey,
    scanMainKey: _scanMainKey,
    spendXpubkey: _spendXpubkey,
    spendMainKey: _spendMainKey,
    ...record
  } = full;
  return record;
}

/** A read-only record that holds the shielded xpubs and no key, as a passkey wallet's does. */
function readOnlyWithXpubs(): IWalletAccessData {
  return {
    xpubkey: full.xpubkey,
    walletType: WalletType.P2PKH,
    walletFlags: WALLET_FLAGS.READONLY,
    scanXpubkey: full.scanXpubkey,
    spendXpubkey: full.spendXpubkey,
  };
}

/** A scan key to keep in memory: the capability does not check it against the record. */
function scanKey(): string {
  return new HDPrivateKey().xprivkey;
}

/**
 * A storage holding `record`, with a provider unless `withProvider` is false,
 * and the shielded view of a started wallet that synced by polling.
 */
async function startedStorage(
  record: IWalletAccessData,
  { withProvider = true }: { withProvider?: boolean } = {}
) {
  const storage = new Storage(new MemoryStore());
  await storage.saveAccessData(record);
  if (withProvider) {
    storage.setShieldedCryptoProvider(provider);
  }
  const view = storage.shieldedView;
  view.started = true;
  view.syncMode = HistorySyncMode.POLLING_HTTP_API;
  return { storage, view };
}

/** The level, reason and cause of a capability. */
function verdict({ level, reason, cause }: IShieldedCapability) {
  return { level, reason, cause };
}

describe('computeShieldedCapability', () => {
  it('reports none, not-started, before start and after stop', async () => {
    const storage = new Storage(new MemoryStore());
    await storage.saveAccessData(full);
    storage.setShieldedCryptoProvider(provider);

    expect(verdict(await computeShieldedCapability(storage))).toEqual({
      level: 'none',
      reason: 'not-started',
      cause: null,
    });

    storage.shieldedView.started = true;
    storage.scanXPrivKey = scanKey();
    await storage.handleStop();
    const capability = await computeShieldedCapability(storage);
    expect(verdict(capability)).toEqual({ level: 'none', reason: 'not-started', cause: null });
    expect(capability.canReceive).toBe(false);
    expect(capability.historyComplete).toBe(false);
  });

  it('reports none, multisig, for a multisig wallet, whatever key it holds', async () => {
    const { storage } = await startedStorage({
      ...full,
      walletType: WalletType.MULTISIG,
    });
    storage.scanXPrivKey = scanKey();

    expect(verdict(await computeShieldedCapability(storage))).toEqual({
      level: 'none',
      reason: 'multisig',
      cause: null,
    });
  });

  it('reports none, integrity, with its cause, when the record keys disagree', async () => {
    const { storage, view } = await startedStorage(full);
    view.integrity = 'key-mismatch';

    expect(verdict(await computeShieldedCapability(storage))).toEqual({
      level: 'none',
      reason: 'integrity',
      cause: 'key-mismatch',
    });
  });

  it.each([
    { cause: 'wrong-password' as const },
    { cause: 'wrong-pin' as const },
    { cause: 'passphrase-mismatch' as const },
    { cause: null },
  ])(
    'reports none, needs-password, with the cause $cause, for a seed record without shielded keys',
    async ({ cause }) => {
      const { storage, view } = await startedStorage(preShielded());
      view.cause = cause;

      expect(verdict(await computeShieldedCapability(storage))).toEqual({
        level: 'none',
        reason: 'needs-password',
        cause,
      });
    }
  );

  it('reports needs-password without a cause when the view holds a cause of a locked key', async () => {
    const { storage, view } = await startedStorage(preShielded());
    view.cause = 'not-supplied';

    expect(verdict(await computeShieldedCapability(storage))).toEqual({
      level: 'none',
      reason: 'needs-password',
      cause: null,
    });
  });

  it.each([
    { shape: 'only the scan xpub', scan: true, spend: false },
    { shape: 'only the spend xpub', scan: false, spend: true },
  ])('reports needs-password for a seed record with $shape', async ({ scan, spend }) => {
    const { storage } = await startedStorage({
      ...preShielded(),
      ...(scan ? { scanXpubkey: full.scanXpubkey } : {}),
      ...(spend ? { spendXpubkey: full.spendXpubkey } : {}),
    });

    expect((await computeShieldedCapability(storage)).reason).toBe('needs-password');
  });

  it('reports none, hardware, for a hardware wallet record', async () => {
    const { storage } = await startedStorage({
      xpubkey: full.xpubkey,
      walletType: WalletType.P2PKH,
      walletFlags: WALLET_FLAGS.READONLY | WALLET_FLAGS.HARDWARE,
    });

    expect(verdict(await computeShieldedCapability(storage))).toEqual({
      level: 'none',
      reason: 'hardware',
      cause: null,
    });
  });

  it('reports none, no-shielded-keys, for a read-only record without shielded xpubs', async () => {
    const { storage } = await startedStorage({
      xpubkey: full.xpubkey,
      walletType: WalletType.P2PKH,
      walletFlags: WALLET_FLAGS.READONLY,
    });

    expect(verdict(await computeShieldedCapability(storage))).toEqual({
      level: 'none',
      reason: 'no-shielded-keys',
      cause: null,
    });
  });

  it('reports none, no-provider, without a crypto provider, even with a key', async () => {
    const { storage } = await startedStorage(full, { withProvider: false });
    storage.scanXPrivKey = scanKey();

    const capability = await computeShieldedCapability(storage);
    expect(verdict(capability)).toEqual({ level: 'none', reason: 'no-provider', cause: null });
    expect(capability.canReceive).toBe(false);
    expect(capability.historyComplete).toBe(false);
  });

  it.each([
    { cause: 'not-supplied' as const },
    { cause: 'wrong-pin' as const },
    { cause: 'corrupt-key' as const },
    { cause: 'error' as const },
  ])(
    'reports watch, locked, with the cause $cause, while the key is not unlocked',
    async ({ cause }) => {
      const { storage, view } = await startedStorage(full);
      view.cause = cause;

      const capability = await computeShieldedCapability(storage);
      expect(verdict(capability)).toEqual({ level: 'watch', reason: 'locked', cause });
      // It cannot decode what it receives, but its loaded history is complete.
      expect(capability.canReceive).toBe(false);
      expect(capability.historyComplete).toBe(true);
    }
  );

  it.each([
    { cause: null, record: 'a record whose key was never unlocked' },
    {
      cause: 'wrong-password' as const,
      record: 'a record that got its keys after a failed migration',
    },
  ])('reports the cause not-supplied for $record', async ({ cause }) => {
    const { storage, view } = await startedStorage(full);
    view.cause = cause as ShieldedViewCause | null;

    expect(verdict(await computeShieldedCapability(storage))).toEqual({
      level: 'watch',
      reason: 'locked',
      cause: 'not-supplied',
    });
  });

  it('reports view, no-spend-authority, with an external signer that did not declare shielded spends', async () => {
    const { storage } = await startedStorage(full);
    storage.scanXPrivKey = scanKey();
    storage.setTxSignatureMethod(signer);

    const capability = await computeShieldedCapability(storage);
    expect(verdict(capability)).toEqual({
      level: 'view',
      reason: 'no-spend-authority',
      cause: null,
    });
    expect(capability.canSpend).toBe(false);
    expect(capability.canReceive).toBe(true);
  });

  it('reports view for a record without the spend key and no external signer', async () => {
    const { storage } = await startedStorage(readOnlyWithXpubs());
    storage.scanXPrivKey = scanKey();

    expect(verdict(await computeShieldedCapability(storage))).toEqual({
      level: 'view',
      reason: 'no-spend-authority',
      cause: null,
    });
  });

  it('reports full with the record spend key, or with a signer that declared shielded spends', async () => {
    const { storage } = await startedStorage(full);
    storage.scanXPrivKey = scanKey();

    const capability = await computeShieldedCapability(storage);
    expect(capability).toEqual({
      level: 'full',
      reason: null,
      cause: null,
      canReceive: true,
      canSpend: true,
      historyComplete: true,
      undecoded: { txIds: [], locked: 0, unreadable: 0, error: 0 },
    });

    const readOnly = await startedStorage(readOnlyWithXpubs());
    readOnly.storage.scanXPrivKey = scanKey();
    readOnly.storage.setTxSignatureMethod(signer);
    readOnly.view.spendSigner = true;
    expect(verdict(await computeShieldedCapability(readOnly.storage))).toEqual({
      level: 'full',
      reason: null,
      cause: null,
    });
  });

  it('forgets a signer declaration when the signing method is set again on the storage', async () => {
    const { storage, view } = await startedStorage(readOnlyWithXpubs());
    storage.scanXPrivKey = scanKey();
    storage.setTxSignatureMethod(signer);
    view.spendSigner = true;

    storage.setTxSignatureMethod(async () => ({ inputSignatures: [], ncCallerSignature: null }));

    expect((await computeShieldedCapability(storage)).canSpend).toBe(false);
  });

  it.each([HistorySyncMode.MANUAL_STREAM_WS, HistorySyncMode.XPUB_STREAM_WS])(
    'keeps the level, and reports neither receive nor a complete history, under %s',
    async mode => {
      const { storage, view } = await startedStorage(full);
      storage.scanXPrivKey = scanKey();
      view.syncMode = mode;

      const streaming = await computeShieldedCapability(storage);
      expect(streaming.level).toBe('full');
      expect(streaming.canReceive).toBe(false);
      expect(streaming.historyComplete).toBe(false);

      view.syncMode = HistorySyncMode.POLLING_HTTP_API;
      const polling = await computeShieldedCapability(storage);
      expect(polling.canReceive).toBe(true);
      expect(polling.historyComplete).toBe(true);
    }
  );

  it('reports an incomplete history after an address discovery that hit its round limit', async () => {
    const { storage, view } = await startedStorage(full);
    storage.scanXPrivKey = scanKey();
    view.discoveryCapped = true;

    const capability = await computeShieldedCapability(storage);
    expect(capability.level).toBe('full');
    expect(capability.historyComplete).toBe(false);
  });

  it('carries the undecoded outputs the view recorded', async () => {
    const { storage, view } = await startedStorage(full);
    view.recordUndecoded('bb'.repeat(32), { locked: 2, unreadable: 0, error: 1 });
    view.recordUndecoded('aa'.repeat(32), { locked: 1, unreadable: 1, error: 0 });

    expect((await computeShieldedCapability(storage)).undecoded).toEqual({
      txIds: ['aa'.repeat(32), 'bb'.repeat(32)],
      locked: 3,
      unreadable: 1,
      error: 1,
    });
  });

  it('holds no key material', async () => {
    const { storage } = await startedStorage(full);
    const xpriv = scanKey();
    const key = new HDPrivateKey(xpriv);
    const privateKeyHex = key.privateKey.toString();
    const chainCodeHex = key.toObject().chainCode;
    storage.scanXPrivKey = xpriv;

    const capability = await computeShieldedCapability(storage);
    const seen = JSON.stringify(capability);
    expect(Object.keys(capability).sort()).toEqual([
      'canReceive',
      'canSpend',
      'cause',
      'historyComplete',
      'level',
      'reason',
      'undecoded',
    ]);
    for (const secret of [privateKeyHex, chainCodeHex, 'htpr', 'tnpr', 'xprv']) {
      expect(seen).not.toContain(secret);
    }
  });
});

describe('shieldedAddressRefusal', () => {
  function capabilityWith(
    level: IShieldedCapability['level'],
    reason: ShieldedCapabilityReason | null
  ): IShieldedCapability {
    return {
      level,
      reason,
      cause: null,
      canReceive: false,
      canSpend: false,
      historyComplete: false,
      undecoded: { txIds: [], locked: 0, unreadable: 0, error: 0 },
    };
  }

  it.each([
    { reason: 'not-started' as const, code: 'shielded-not-started' },
    { reason: 'multisig' as const, code: 'shielded-multisig' },
    { reason: 'integrity' as const, code: 'shielded-integrity' },
    { reason: 'needs-password' as const, code: 'shielded-no-keys' },
    { reason: 'hardware' as const, code: 'shielded-no-keys' },
    { reason: 'no-shielded-keys' as const, code: 'shielded-no-keys' },
    { reason: 'no-provider' as const, code: 'shielded-no-provider' },
  ])('refuses a shielded address at none, $reason, with $code', ({ reason, code }) => {
    const refusal = shieldedAddressRefusal(capabilityWith('none', reason));

    expect(refusal).toBeInstanceOf(ShieldedKeyError);
    expect(refusal!.errorCode).toBe(code);
  });

  it('refuses a shielded address at watch with shielded-locked', () => {
    expect(shieldedAddressRefusal(capabilityWith('watch', 'locked'))!.errorCode).toBe(
      'shielded-locked'
    );
  });

  it('gives a shielded address out at view and full', () => {
    expect(shieldedAddressRefusal(capabilityWith('view', 'no-spend-authority'))).toBeNull();
    expect(shieldedAddressRefusal(capabilityWith('full', null))).toBeNull();
  });
});
