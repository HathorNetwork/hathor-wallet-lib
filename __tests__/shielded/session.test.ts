/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';
import { execFileSync } from 'child_process';
import { crypto, HDPrivateKey } from 'bitcore-lib';
import Mnemonic from 'bitcore-mnemonic';
import { MemoryStore, Storage } from '../../src/storage';
import {
  deriveScanChildKey,
  IScanKeyMaterial,
  SessionClosedError,
  ShieldedSession,
  shieldedSessionOf,
} from '../../src/shielded/session';
import { ShieldedKeyError } from '../../src/errors';
import { HistorySyncMode } from '../../src/types';

const SEED =
  'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

let scanParentKey: HDPrivateKey | null = null;

/** The scan chain key (m/44'/280'/1'/0) of the test seed, as bitcore derives it. */
function scanParent(): HDPrivateKey {
  if (!scanParentKey) {
    scanParentKey = new Mnemonic(SEED)
      .toHDPrivateKey('', 'testnet')
      .deriveChild("m/44'/280'/1'")
      .deriveChild(0);
  }
  return scanParentKey!;
}

/** A depth-4 extended private key with the given private key and chain code. */
function parentWith(privateKey: Buffer, chainCode: Buffer): HDPrivateKey {
  return new HDPrivateKey({
    network: 'testnet',
    depth: 4,
    parentFingerPrint: 0,
    childIndex: 0,
    chainCode,
    privateKey,
  });
}

function materialOf(key: HDPrivateKey): IScanKeyMaterial {
  return {
    privateKey: key.privateKey.toBuffer(),
    chainCode: Buffer.from(key.toObject().chainCode, 'hex'),
    publicKey: key.publicKey.toBuffer(),
  };
}

/** The order of the secp256k1 group, as 32 bytes. */
const CURVE_ORDER: Buffer = crypto.Point.getN().toBuffer({ size: 32 });

/** `CURVE_ORDER - k`, for a 32-byte k. */
function orderMinus(k: Buffer): Buffer {
  return new crypto.BN(CURVE_ORDER).sub(new crypto.BN(k)).toBuffer({ size: 32 });
}

/**
 * The child private keys bitcore's HDPrivateKey.deriveChild gives for each
 * parent and index, computed in a separate node process. Inside jest's VM,
 * bitcore's elliptic-curve code runs about 75 times slower than in node, which
 * makes thousands of derivations too slow to run here.
 *
 * The child reads the requests from a file. Given on its stdin, they can leave
 * it blocked on the read for good, and execFileSync blocks the test's own
 * timeout too; the call has a timeout of its own, below the tests'.
 */
function bitcoreChildKeys(requests: Array<{ xpriv: string; indexes: number[] }>): string[][] {
  const script = `
    const { HDPrivateKey } = require('bitcore-lib');
    const requests = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    const keys = requests.map(({ xpriv, indexes }) => {
      const parent = new HDPrivateKey(xpriv);
      return indexes.map(index => parent.deriveChild(index).privateKey.toBuffer().toString('hex'));
    });
    process.stdout.write(JSON.stringify(keys));
  `;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcore-child-keys-'));
  const requestsFile = path.join(dir, 'requests.json');
  try {
    fs.writeFileSync(requestsFile, JSON.stringify(requests));
    const output = execFileSync(process.execPath, ['-e', script, requestsFile], {
      cwd: path.resolve(__dirname, '../..'),
      maxBuffer: 64 * 1024 * 1024,
      timeout: 90000,
    });
    return JSON.parse(output.toString());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => start + i);
}

describe('deriveScanChildKey', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Indexes of the test seed's scan chain where bitcore's I_L, or the child
  // private key, starts with one or two zero bytes. Found by search; the
  // tests below check that each still has that property.
  const IL_ONE_ZERO_BYTE = [494, 749, 2345, 2661, 3185];
  const IL_TWO_ZERO_BYTES = [89757, 132241, 175651, 254047];
  const CHILD_ONE_ZERO_BYTE = [116, 192, 315, 555, 652];
  const CHILD_TWO_ZERO_BYTES = [32414, 153508, 180287, 197359, 204283, 285754];

  function leftHalfOfHmac(parent: HDPrivateKey, index: number): Buffer {
    const data = Buffer.alloc(37);
    parent.publicKey.toBuffer().copy(data);
    data.writeUInt32BE(index, 33);
    return crypto.Hash.sha512hmac(data, Buffer.from(parent.toObject().chainCode, 'hex')).subarray(
      0,
      32
    );
  }

  it('equals bitcore deriveChild over 10,000 indexes and the leading-zero cases', () => {
    const parent = scanParent();
    const material = materialOf(parent);
    // These indexes still give what they are listed for.
    for (const index of IL_ONE_ZERO_BYTE) {
      expect(leftHalfOfHmac(parent, index)[0]).toBe(0);
    }
    for (const index of IL_TWO_ZERO_BYTES) {
      expect(leftHalfOfHmac(parent, index).subarray(0, 2)).toEqual(Buffer.alloc(2));
    }

    const indexes = [
      ...range(0, 10000),
      ...IL_TWO_ZERO_BYTES,
      ...CHILD_TWO_ZERO_BYTES,
      // The top of the non-hardened range.
      0x7ffffffe,
      0x7fffffff,
    ];
    const [expected] = bitcoreChildKeys([{ xpriv: parent.xprivkey, indexes }]);

    const mismatches: number[] = [];
    indexes.forEach((index, n) => {
      const child = deriveScanChildKey(material, index);
      expect(child).toHaveLength(32);
      if (child.toString('hex') !== expected[n]) {
        mismatches.push(index);
      }
    });
    expect(mismatches).toEqual([]);
    for (const index of [...CHILD_ONE_ZERO_BYTE, ...CHILD_TWO_ZERO_BYTES]) {
      expect(deriveScanChildKey(material, index)[0]).toBe(0);
    }
    for (const index of CHILD_TWO_ZERO_BYTES) {
      expect(deriveScanChildKey(material, index)[1]).toBe(0);
    }
  }, 120000);

  it('equals bitcore deriveChild for parent keys at the edges of the key range', () => {
    const one = Buffer.alloc(32);
    one[31] = 1;
    const leadingZeros = Buffer.from(`0000${'7c'.repeat(30)}`, 'hex');
    const zeroChainCode = Buffer.from(`0000${'31'.repeat(30)}`, 'hex');
    const parents = [
      parentWith(one, Buffer.alloc(32, 0x42)),
      parentWith(orderMinus(one), Buffer.alloc(32, 0x42)),
      parentWith(leadingZeros, Buffer.alloc(32, 0x42)),
      parentWith(Buffer.alloc(32, 0x5a), zeroChainCode),
    ];
    const indexes = range(0, 1000);
    const expected = bitcoreChildKeys(parents.map(parent => ({ xpriv: parent.xprivkey, indexes })));

    parents.forEach((parent, p) => {
      const material = materialOf(parent);
      const derived = indexes.map(index => deriveScanChildKey(material, index).toString('hex'));
      expect(derived).toEqual(expected[p]);
    });
  }, 120000);

  it('equals bitcore deriveChild in this process for the wallet index range', () => {
    const parent = scanParent();
    const material = materialOf(parent);
    for (const index of [0, 1, 2, 19, 20, ...IL_ONE_ZERO_BYTE.slice(0, 2), 116]) {
      expect(deriveScanChildKey(material, index)).toEqual(
        parent.deriveChild(index).privateKey.toBuffer()
      );
    }
  }, 60000);

  it('moves to the next index when the child key would be zero, as bitcore does', () => {
    const parent = scanParent();
    const material = materialOf(parent);
    const index = 7;
    // I_L = n - k makes (I_L + k) mod n zero, an invalid key.
    const crafted = Buffer.concat([orderMinus(material.privateKey), Buffer.alloc(32, 0x11)]);
    const realHmac = crypto.Hash.sha512hmac;
    jest
      .spyOn(crypto.Hash, 'sha512hmac')
      .mockImplementation((data: Buffer, key: Buffer) =>
        data.readUInt32BE(33) === index ? Buffer.from(crafted) : realHmac(data, key)
      );

    const child = deriveScanChildKey(material, index);

    expect(child).toEqual(parent.deriveChild(index).privateKey.toBuffer());
    jest.restoreAllMocks();
    expect(child).toEqual(parent.deriveChild(index + 1).privateKey.toBuffer());
  }, 60000);

  // Sums that real HMAC outputs practically never give: n is within 2^129 of
  // 2^256, so I_L + k lands in [n, 2^256) with a probability near 2^-128.
  const one = Buffer.alloc(32);
  one[31] = 1;
  it.each([
    {
      reduction: 'a sum between the curve order and 2^256, with no carry',
      parent: () => scanParent(),
      // I_L = n - k + 1, so the sum is n + 1.
      leftHalf: (k: Buffer) =>
        new crypto.BN(orderMinus(k)).add(new crypto.BN(one)).toBuffer({ size: 32 }),
    },
    {
      reduction: 'a sum with a carry out of 256 bits',
      parent: () => scanParent(),
      leftHalf: () => Buffer.alloc(32, 0xff),
    },
    {
      reduction: 'a sum of at least twice the curve order',
      parent: () => parentWith(orderMinus(one), Buffer.alloc(32, 0x42)),
      // I_L = 2^256 - 1 and k = n - 1 sum to more than 2n.
      leftHalf: () => Buffer.alloc(32, 0xff),
    },
  ])(
    'matches bitcore for $reduction',
    ({ parent: makeParent, leftHalf }) => {
      const parent = makeParent();
      const material = materialOf(parent);
      const index = 3;
      const crafted = Buffer.concat([leftHalf(material.privateKey), Buffer.alloc(32, 0x22)]);
      const realHmac = crypto.Hash.sha512hmac;
      jest
        .spyOn(crypto.Hash, 'sha512hmac')
        .mockImplementation((data: Buffer, key: Buffer) =>
          data.readUInt32BE(33) === index ? Buffer.from(crafted) : realHmac(data, key)
        );

      expect(deriveScanChildKey(material, index)).toEqual(
        parent.deriveChild(index).privateKey.toBuffer()
      );
    },
    60000
  );

  it('zeroes the HMAC output it computes', () => {
    const material = materialOf(scanParent());
    const outputs: Buffer[] = [];
    const realHmac = crypto.Hash.sha512hmac;
    jest.spyOn(crypto.Hash, 'sha512hmac').mockImplementation((data: Buffer, key: Buffer) => {
      const output = realHmac(data, key);
      outputs.push(output);
      return output;
    });

    deriveScanChildKey(material, 5);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual(Buffer.alloc(64));
    jest.restoreAllMocks();
  });

  it('refuses hardened and invalid indexes', () => {
    const material = materialOf(scanParent());
    for (const index of [-1, 0x80000000, 1.5, Number.NaN]) {
      expect(() => deriveScanChildKey(material, index)).toThrow('Invalid non-hardened index');
    }
  });

  it('leaves the material unchanged', () => {
    const material = materialOf(scanParent());
    const copy = {
      privateKey: Buffer.from(material.privateKey),
      chainCode: Buffer.from(material.chainCode),
      publicKey: Buffer.from(material.publicKey),
    };
    deriveScanChildKey(material, 9);
    expect(material).toEqual(copy);
  });
});

describe('ShieldedSession', () => {
  function filledSession(): { session: ShieldedSession; material: IScanKeyMaterial } {
    const session = new ShieldedSession();
    session.open();
    const material = materialOf(scanParent());
    session.fill(material, session.epoch);
    return { session, material };
  }

  it('starts closed and empty', () => {
    const session = new ShieldedSession();
    expect(session.active).toBe(false);
    expect(session.hasKey).toBe(false);
    expect(session.source()).toBeNull();
    expect(session.cause).toBeNull();
    expect(session.integrity).toBeNull();
    expect(session.undecodedSummary()).toEqual({ txIds: [], locked: 0, unreadable: 0, error: 0 });
  });

  it('derives with the key it holds', () => {
    const { session } = filledSession();
    const source = session.source();
    expect(source).not.toBeNull();
    expect(source!.derive(4)).toEqual(scanParent().deriveChild(4).privateKey.toBuffer());
  }, 30000);

  it('open() and close() move the epoch', () => {
    const session = new ShieldedSession();
    const epochs = [session.epoch];
    session.open();
    epochs.push(session.epoch);
    session.close();
    epochs.push(session.epoch);
    session.open();
    epochs.push(session.epoch);
    expect(new Set(epochs).size).toBe(4);
  });

  it('close() zeroes the key buffers and empties the session', () => {
    const { session, material } = filledSession();
    session.close();
    expect(material.privateKey).toEqual(Buffer.alloc(32));
    expect(material.chainCode).toEqual(Buffer.alloc(32));
    expect(material.publicKey).toEqual(Buffer.alloc(33));
    expect(session.hasKey).toBe(false);
    expect(session.active).toBe(false);
    expect(session.source()).toBeNull();
  });

  it('open() zeroes the key of the previous start', () => {
    const { session, material } = filledSession();
    session.open();
    expect(material.privateKey).toEqual(Buffer.alloc(32));
    expect(session.hasKey).toBe(false);
    expect(session.active).toBe(true);
  });

  it('fill() replaces the key it held and zeroes it', () => {
    const { session, material } = filledSession();
    const next = materialOf(scanParent());
    session.fill(next, session.epoch);
    expect(material.privateKey).toEqual(Buffer.alloc(32));
    expect(next.privateKey).not.toEqual(Buffer.alloc(32));
  });

  it('holdsKey() compares a key with the one the session holds', () => {
    const { session } = filledSession();
    expect(session.holdsKey(materialOf(scanParent()))).toBe(true);
    expect(session.holdsKey(materialOf(new HDPrivateKey()))).toBe(false);
    // The same private key with another chain code is another extended key.
    const sameKey = materialOf(scanParent());
    expect(session.holdsKey({ ...sameKey, chainCode: Buffer.alloc(32, 1) })).toBe(false);

    session.close();
    expect(session.holdsKey(materialOf(scanParent()))).toBe(false);
  });

  it('fill() after close() zeroes the material and throws shielded-not-started', () => {
    const session = new ShieldedSession();
    session.open();
    const { epoch } = session;
    session.close();
    const material = materialOf(scanParent());

    let error: unknown;
    try {
      session.fill(material, epoch);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ShieldedKeyError);
    expect(error).toMatchObject({ errorCode: 'shielded-not-started' });
    expect(material.privateKey).toEqual(Buffer.alloc(32));
    expect(session.hasKey).toBe(false);
  });

  it('fill() for an earlier start throws shielded-not-started', () => {
    const session = new ShieldedSession();
    session.open();
    const { epoch } = session;
    // stop() and start() ran while the caller unlocked the key.
    session.close();
    session.open();
    const material = materialOf(scanParent());

    expect(() => session.fill(material, epoch)).toThrow(
      expect.objectContaining({ errorCode: 'shielded-not-started' })
    );
    expect(material.privateKey).toEqual(Buffer.alloc(32));
    expect(session.hasKey).toBe(false);
  });

  it('fill() before open() throws shielded-not-started', () => {
    const session = new ShieldedSession();
    expect(() => session.fill(materialOf(scanParent()), session.epoch)).toThrow(
      expect.objectContaining({ errorCode: 'shielded-not-started' })
    );
  });

  it('a source stops deriving once the session is closed or opened again', () => {
    const { session } = filledSession();
    const beforeClose = session.source()!;
    session.close();
    expect(() => beforeClose.derive(0)).toThrow(SessionClosedError);

    const { session: other } = filledSession();
    const beforeOpen = other.source()!;
    other.open();
    other.fill(materialOf(scanParent()), other.epoch);
    expect(() => beforeOpen.derive(0)).toThrow(SessionClosedError);
    expect(other.source()!.derive(0)).toHaveLength(32);
  }, 30000);

  it('fill() clears the causes', () => {
    const session = new ShieldedSession();
    session.open();
    session.setCause('wrong-pin');
    session.setIntegrity('key-mismatch');
    session.fill(materialOf(scanParent()), session.epoch);
    expect(session.cause).toBeNull();
    expect(session.integrity).toBeNull();
  });

  it('open() and close() reset everything but the signer declaration', () => {
    const session = new ShieldedSession();
    session.open();
    session.setCause('wrong-pin');
    session.setIntegrity('key-mismatch');
    session.setSyncMode(HistorySyncMode.POLLING_HTTP_API);
    session.setDiscoveryCapped(true);
    session.setSpendSigner(true);
    session.recordUndecoded('tx1', { locked: 1, unreadable: 0, error: 0 });

    for (const reset of [() => session.close(), () => session.open()]) {
      reset();
      expect(session.cause).toBeNull();
      expect(session.integrity).toBeNull();
      expect(session.syncMode).toBeNull();
      expect(session.discoveryCapped).toBe(false);
      expect(session.undecodedSummary().txIds).toEqual([]);
      expect(session.spendSigner).toBe(true);
      session.setCause('wrong-pin');
      session.setSyncMode(HistorySyncMode.POLLING_HTTP_API);
      session.recordUndecoded('tx1', { locked: 1, unreadable: 0, error: 0 });
    }
  });

  it('sums the undecoded outputs of each tx', () => {
    const session = new ShieldedSession();
    session.recordUndecoded('tx-b', { locked: 2, unreadable: 0, error: 0 });
    session.recordUndecoded('tx-a', { locked: 0, unreadable: 1, error: 1 });
    session.recordUndecoded('tx-c', { locked: 0, unreadable: 0, error: 0 });
    expect(session.undecodedSummary()).toEqual({
      txIds: ['tx-a', 'tx-b'],
      locked: 2,
      unreadable: 1,
      error: 1,
    });

    // A tx's entry is replaced by its last pass, and removed when it has none.
    session.recordUndecoded('tx-b', { locked: 1, unreadable: 0, error: 0 });
    session.recordUndecoded('tx-a', { locked: 0, unreadable: 0, error: 0 });
    expect(session.undecodedSummary()).toEqual({
      txIds: ['tx-b'],
      locked: 1,
      unreadable: 0,
      error: 0,
    });

    session.resetUndecoded();
    expect(session.undecodedSummary()).toEqual({ txIds: [], locked: 0, unreadable: 0, error: 0 });
  });

  it('cannot be read through JSON, structuredClone or util.inspect', () => {
    const { session, material } = filledSession();
    const secrets = [
      material.privateKey.toString('hex'),
      scanParent().xprivkey,
      'htpr',
      'tnpr',
      'xprv',
    ];
    const views = [
      JSON.stringify(session),
      JSON.stringify(structuredClone(session)),
      util.inspect(session, { showHidden: true, depth: Infinity }),
      util.inspect(session.source(), { showHidden: true, depth: Infinity }),
    ];
    for (const view of views) {
      for (const secret of secrets) {
        expect(view).not.toContain(secret);
      }
    }
  });
});

describe('shieldedSessionOf', () => {
  it('keeps one session per storage, outside the storage object', () => {
    const storage = new Storage(new MemoryStore());
    const other = new Storage(new MemoryStore());
    const keysBefore = Reflect.ownKeys(storage);

    const session = shieldedSessionOf(storage);
    expect(shieldedSessionOf(storage)).toBe(session);
    expect(shieldedSessionOf(other)).not.toBe(session);
    expect(Reflect.ownKeys(storage)).toEqual(keysBefore);

    session.open();
    const material = materialOf(scanParent());
    session.fill(material, session.epoch);
    const view = util.inspect(storage, { showHidden: true, depth: Infinity });
    expect(view).not.toContain(material.privateKey.toString('hex'));
  });
});
