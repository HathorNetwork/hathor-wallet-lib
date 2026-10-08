/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { crypto, encoding, HDPrivateKey } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import { MemoryStore, Storage } from '../../src/storage';
import {
  classifyExtendedKey,
  decryptScanKeyWithPin,
  keyMaterialFromExtendedKey,
  unlockScanKeyWithPin,
} from '../../src/shielded/keys';
import Network from '../../src/models/network';
import walletUtils from '../../src/utils/wallet';
import { encryptData } from '../../src/utils/crypto';
import { DecryptionError, InvalidPasswdError, ShieldedKeyError } from '../../src/errors';
import { IWalletAccessData } from '../../src/types';

const SEED =
  'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
const OTHER_SEED =
  'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
const PIN = '123';
const PASSWORD = '456';

/** The scan chain key (m/44'/280'/1'/0) of a seed, serialized for a bitcore network. */
function scanKeyOf(seed: string, network: unknown): HDPrivateKey {
  return new Mnemonic(seed).toHDPrivateKey('', network).deriveChild("m/44'/280'/1'").deriveChild(0);
}

const keys: Record<string, HDPrivateKey> = {};
function scanKey(name: 'htpr' | 'tnpr' | 'xprv' | 'tprv' | 'other'): HDPrivateKey {
  if (!keys[name]) {
    const networks = {
      htpr: new Network('mainnet').bitcoreNetwork,
      tnpr: new Network('testnet').bitcoreNetwork,
      xprv: 'livenet',
      tprv: 'testnet',
      other: new Network('testnet').bitcoreNetwork,
    };
    keys[name] = scanKeyOf(name === 'other' ? OTHER_SEED : SEED, networks[name]);
  }
  return keys[name];
}

/** A 78-byte extended key serialization with the given parts. */
function serialize(version: number, keyData: Buffer, chainCode = Buffer.alloc(32, 0x42)): string {
  const payload = Buffer.alloc(78);
  payload.writeUInt32BE(version, 0);
  payload[4] = 4;
  chainCode.copy(payload, 13);
  keyData.copy(payload, 45);
  return encoding.Base58Check.encode(payload);
}

const CURVE_ORDER: Buffer = crypto.Point.getN().toBuffer({ size: 32 });

let accessDataCache: IWalletAccessData | null = null;
function accessData(): IWalletAccessData {
  if (!accessDataCache) {
    accessDataCache = walletUtils.generateAccessDataFromSeed(SEED, {
      pin: PIN,
      password: PASSWORD,
      networkName: 'testnet',
    });
  }
  return JSON.parse(JSON.stringify(accessDataCache));
}

async function storageWith(data: IWalletAccessData): Promise<Storage> {
  const storage = new Storage(new MemoryStore());
  await storage.saveAccessData(data);
  return storage;
}

/** Every string a failure exposes: its message, its cause and its own fields. */
function exposedText(error: unknown): string {
  const e = error as Error & { cause?: unknown };
  return [
    String(e),
    e.message,
    e.stack ?? '',
    JSON.stringify(e),
    e.cause instanceof Error ? `${e.cause.message} ${e.cause.stack}` : String(e.cause),
  ].join('\n');
}

const KEY_TEXT = /htpr|tnpr|xprv|tprv/;

describe('classifyExtendedKey', () => {
  it.each(['htpr', 'tnpr', 'xprv', 'tprv'] as const)(
    'classifies %s strings as private keys',
    name => {
      const key = scanKey(name);
      expect(key.xprivkey.startsWith(name)).toBe(true);
      const classified = classifyExtendedKey(key.xprivkey);
      expect(classified).toEqual({
        type: 'private',
        depth: 4,
        chainCode: Buffer.from(key.toObject().chainCode, 'hex'),
        privateKey: key.privateKey.toBuffer(),
      });
    }
  );

  it('classifies an HDPrivateKey by its serialization', () => {
    const key = scanKey('tnpr');
    expect(classifyExtendedKey(key)).toEqual(classifyExtendedKey(key.xprivkey));
  });

  it.each([
    ['xpub', () => scanKey('tnpr').xpubkey],
    ['tpub', () => scanKey('tprv').xpubkey],
  ])('classifies %s strings as public keys', (prefix, makeXpub) => {
    const xpub = makeXpub();
    expect(xpub.startsWith(prefix)).toBe(true);
    const key = scanKey('tnpr');
    expect(classifyExtendedKey(xpub)).toEqual({
      type: 'public',
      depth: 4,
      chainCode: Buffer.from(key.toObject().chainCode, 'hex'),
      publicKey: key.publicKey.toBuffer(),
    });
  });

  it.each([
    ['an empty string', () => ''],
    ['garbage', () => 'not an extended key'],
    ['an xpub with whitespace around it', () => ` ${scanKey('tnpr').xpubkey} `],
    ['an xpriv with a newline after it', () => `${scanKey('tnpr').xprivkey}\n`],
    [
      'a broken checksum',
      () => {
        const xpub = scanKey('tnpr').xpubkey;
        const last = xpub[xpub.length - 1] === 'a' ? 'b' : 'a';
        return `${xpub.slice(0, -1)}${last}`;
      },
    ],
    ['a 77-byte payload', () => encoding.Base58Check.encode(Buffer.alloc(77, 1))],
    [
      'an unknown version',
      () => serialize(0x01020304, Buffer.concat([Buffer.alloc(1), Buffer.alloc(32, 1)])),
    ],
    ['a private key of zero', () => serialize(0x0434c8c4, Buffer.alloc(33))],
    [
      'a private key equal to the curve order',
      () => serialize(0x0434c8c4, Buffer.concat([Buffer.alloc(1), CURVE_ORDER])),
    ],
    [
      'a private version with a public key byte',
      () => serialize(0x0434c8c4, Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 1)])),
    ],
    [
      'a public version with a private key byte',
      () => serialize(0x0488b21e, Buffer.concat([Buffer.alloc(1), Buffer.alloc(32, 1)])),
    ],
    [
      'an uncompressed public key byte',
      () => serialize(0x0488b21e, Buffer.concat([Buffer.from([4]), Buffer.alloc(32, 1)])),
    ],
    ['an HDPublicKey object', () => scanKey('tnpr').hdPublicKey],
    ['a Buffer', () => Buffer.from(scanKey('tnpr').xprivkey)],
    ['a number', () => 42],
    ['null', () => null],
    ['undefined', () => undefined],
  ])('refuses %s', (_name, makeInput) => {
    expect(classifyExtendedKey(makeInput())).toEqual({ type: 'invalid' });
  });

  it('accepts the largest valid private key', () => {
    const largest = new crypto.BN(CURVE_ORDER).subn(1).toBuffer({ size: 32 });
    const classified = classifyExtendedKey(
      serialize(0x0434c8c4, Buffer.concat([Buffer.alloc(1), largest]))
    );
    expect(classified).toMatchObject({ type: 'private', privateKey: largest });
  });
});

describe('keyMaterialFromExtendedKey', () => {
  it('computes the public key from the private key', () => {
    const key = scanKey('htpr');
    for (const input of [key.xprivkey, key]) {
      expect(keyMaterialFromExtendedKey(input)).toEqual({
        privateKey: key.privateKey.toBuffer(),
        chainCode: Buffer.from(key.toObject().chainCode, 'hex'),
        publicKey: key.publicKey.toBuffer(),
      });
    }
  });

  it.each([
    ['an xpub', () => scanKey('tnpr').xpubkey],
    ['garbage', () => 'garbage'],
    ['an HDPublicKey', () => scanKey('tnpr').hdPublicKey],
  ])('refuses %s as shielded-invalid-key', (_name, makeInput) => {
    let error: unknown;
    try {
      keyMaterialFromExtendedKey(makeInput());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ShieldedKeyError);
    expect(error).toMatchObject({ errorCode: 'shielded-invalid-key' });
    expect(exposedText(error)).not.toMatch(KEY_TEXT);
  });
});

describe('unlockScanKeyWithPin', () => {
  async function failure(promise: Promise<unknown>): Promise<ShieldedKeyError> {
    let error: unknown;
    try {
      await promise;
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ShieldedKeyError);
    expect(exposedText(error)).not.toMatch(KEY_TEXT);
    return error as ShieldedKeyError;
  }

  it('unlocks the key of the record with its PIN', async () => {
    const storage = await storageWith(accessData());
    const key = scanKey('tnpr');
    await expect(unlockScanKeyWithPin(storage, PIN)).resolves.toEqual({
      privateKey: key.privateKey.toBuffer(),
      chainCode: Buffer.from(key.toObject().chainCode, 'hex'),
      publicKey: key.publicKey.toBuffer(),
    });
  }, 30000);

  it('identifies the key by its bytes, not by the version of the stored xpub', async () => {
    const data = accessData();
    // The same key, serialized with Bitcoin testnet version bytes.
    data.scanXpubkey = scanKey('tprv').xpubkey;
    expect(data.scanXpubkey.startsWith('tpub')).toBe(true);
    const storage = await storageWith(data);
    await expect(unlockScanKeyWithPin(storage, PIN)).resolves.toMatchObject({
      publicKey: scanKey('tnpr').publicKey.toBuffer(),
    });
  }, 30000);

  it('throws shielded-wrong-pin for a PIN that does not decrypt the key', async () => {
    const storage = await storageWith(accessData());
    const error = await failure(unlockScanKeyWithPin(storage, '999'));
    expect(error.errorCode).toBe('shielded-wrong-pin');
    expect(error.cause).toBeInstanceOf(InvalidPasswdError);
  }, 30000);

  it.each(['scanMainKey', 'scanXpubkey'] as const)(
    'throws shielded-no-keys for a record without %s',
    async field => {
      const data = accessData();
      delete data[field];
      const storage = await storageWith(data);
      const error = await failure(unlockScanKeyWithPin(storage, PIN));
      expect(error.errorCode).toBe('shielded-no-keys');
    },
    30000
  );

  it('throws shielded-corrupt-key, not a mismatch, when the PIN decrypts an xpub', async () => {
    const data = accessData();
    data.scanMainKey = encryptData(scanKey('tnpr').xpubkey, PIN);
    const storage = await storageWith(data);
    const error = await failure(unlockScanKeyWithPin(storage, PIN));
    expect(error.errorCode).toBe('shielded-corrupt-key');
  }, 30000);

  it('throws shielded-corrupt-key when the PIN decrypts no key at all', async () => {
    const data = accessData();
    data.scanMainKey = encryptData('not a key', PIN);
    const storage = await storageWith(data);
    const error = await failure(unlockScanKeyWithPin(storage, PIN));
    expect(error.errorCode).toBe('shielded-corrupt-key');
  }, 30000);

  it('throws shielded-corrupt-key when the encrypted data is damaged', async () => {
    const data = accessData();
    // The PIN check passes, but the ciphertext does not decrypt.
    data.scanMainKey = { ...data.scanMainKey!, data: 'AAAA' };
    const storage = await storageWith(data);
    const error = await failure(unlockScanKeyWithPin(storage, PIN));
    expect(error.errorCode).toBe('shielded-corrupt-key');
    expect(error.cause).toBeInstanceOf(DecryptionError);
  }, 30000);

  it('throws shielded-key-mismatch for the key of another wallet', async () => {
    const data = accessData();
    data.scanMainKey = encryptData(scanKey('other').xprivkey, PIN);
    const storage = await storageWith(data);
    const error = await failure(unlockScanKeyWithPin(storage, PIN));
    expect(error.errorCode).toBe('shielded-key-mismatch');
  }, 30000);

  it('throws shielded-key-mismatch when the stored scan xpub is not a public key', async () => {
    const data = accessData();
    data.scanXpubkey = 'not an xpub';
    const storage = await storageWith(data);
    const error = await failure(unlockScanKeyWithPin(storage, PIN));
    expect(error.errorCode).toBe('shielded-key-mismatch');
  }, 30000);

  it('rethrows a failure to read the store as it is', async () => {
    const storage = await storageWith(accessData());
    const readError = new Error('IndexedDB read failed');
    jest.spyOn(storage, 'getAccessData').mockRejectedValueOnce(readError);
    await expect(unlockScanKeyWithPin(storage, PIN)).rejects.toBe(readError);

    const otherError = new Error('scan key read failed');
    jest.spyOn(storage, 'getScanXPrivKey').mockRejectedValueOnce(otherError);
    await expect(unlockScanKeyWithPin(storage, PIN)).rejects.toBe(otherError);
  }, 30000);
});

describe('decryptScanKeyWithPin', () => {
  it('returns the key the PIN decrypts without checking it against the record', async () => {
    const data = accessData();
    data.scanMainKey = encryptData(scanKey('other').xprivkey, PIN);
    const storage = await storageWith(data);
    await expect(decryptScanKeyWithPin(storage, PIN)).resolves.toMatchObject({
      publicKey: scanKey('other').publicKey.toBuffer(),
    });
  }, 30000);

  it('maps a wrong PIN and an undecryptable key to typed errors', async () => {
    const storage = await storageWith(accessData());
    await expect(decryptScanKeyWithPin(storage, '999')).rejects.toMatchObject({
      errorCode: 'shielded-wrong-pin',
    });

    const data = accessData();
    data.scanMainKey = encryptData(scanKey('tnpr').xpubkey, PIN);
    await expect(decryptScanKeyWithPin(await storageWith(data), PIN)).rejects.toMatchObject({
      errorCode: 'shielded-corrupt-key',
    });
  }, 30000);
});
