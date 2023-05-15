/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { LevelDBStore, MemoryStore, Storage } from "../../src/storage";
import { HDPrivateKey } from "bitcore-lib";
import { TOKEN_AUTHORITY_MASK, TOKEN_MINT_MASK } from "../../src/constants";
import { crypto } from "bitcore-lib";

const DATA_DIR = './testdata.leveldb';

describe("locked utxo methods", () => {
  const spyDate = jest.spyOn(Date, "now");
  const tsFromDate = (date) => Math.floor(date.getTime() / 1000);
  const tsBefore = new Date("2023-03-21T11:00:00");
  const tsCurrent = new Date("2023-03-21T12:00:00");
  const tsAfter = new Date("2023-03-21T13:00:00");

  beforeAll(async () => {
    spyDate.mockImplementation(() => tsCurrent);
  });

  afterAll(async () => {
    spyDate.mockRestore();
  });

  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await testLockedUtxoMethods(store);
  });

  it('should work with leveldb store', async () => {
    const xpriv = new HDPrivateKey();
    const walletId = crypto.Hash.sha256(Buffer.from(xpriv.xpubkey)).toString('hex');
    const store = new LevelDBStore(walletId, DATA_DIR);
    await testLockedUtxoMethods(store);
  });

  // helper functions

  async function countUtxos(store) {
    let utxoCount = 0;
    let lutxoCount = 0;
    for await (const _ of store.utxoIter()) {
      utxoCount++;
    }
    for await (const _ of store.iterateLockedUtxos()) {
      lutxoCount++;
    }
    return {
      utxo: utxoCount,
      lockedUtxo: lutxoCount,
    };
  }

  function getLockedUtxo(txId, address, timelock, height, value, token, token_data) {
    return {
      index: 0,
      tx: {
        tx_id: txId,
        height,
        version: 1,
        timestamp: tsFromDate(tsBefore),
        is_voided: false,
        inputs: [],
        outputs: [
          {
            value,
            token_data,
            token,
            spent_by: null,
            decoded: { type: "P2PKH", address, timelock },
          },
        ],
      },
    };
  }

  function getUtxoFromLocked(lutxo) {
    const { tx, index } = lutxo;
    const { outputs } = tx;
    const output = outputs[index];
    const { decoded } = output;
    const { address, timelock } = decoded;
    return {
      txId: tx.tx_id,
      index,
      token: output.token,
      address,
      value: output.value,
      authorities: 0,
      timelock,
      type: tx.version,
      height: tx.height,
    };
  }

  // actual test body

  async function testLockedUtxoMethods(store) {
    const lockedUtxos = [
      // utxo to be unlocked by time
      getLockedUtxo(
        "tx01",
        "WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ",
        tsFromDate(tsBefore),
        null,
        100, // value
        "00", // token
        0 // token_data
      ),
      // timelocked
      getLockedUtxo(
        "tx02",
        "WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ",
        tsFromDate(tsAfter),
        null,
        100, // value
        "00", // token
        0 // token_data
      ),
      // utxo to be unlocked by height
      getLockedUtxo(
        "tx03",
        "WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp",
        tsFromDate(tsBefore),
        null,
        100, // value
        "01", // token
        0 // token_data
      ),
      // heightlocked
      getLockedUtxo(
        "tx04",
        "WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp",
        tsFromDate(tsBefore),
        null,
        TOKEN_MINT_MASK, // value, mint
        "01", // token
        TOKEN_AUTHORITY_MASK | 1 // token_data
      ),
    ];
    for (const lutxo of lockedUtxos) {
      await store.saveUtxo(getUtxoFromLocked(lutxo));
      await store.saveLockedUtxo(lutxo);
    }
    await expect(countUtxos(store)).resolves.toMatchObject({
      utxo: 4,
      lockedUtxo: 4,
    });

    // iteration on locked utxos yields all locked utxos
    const buf = [];
    for await (const u of store.iterateLockedUtxos()) {
      buf.push(u);
    }
    expect(buf).toHaveLength(4);
    expect(buf).toEqual(lockedUtxos);

    // Unlocking only affects locked utxos
    await store.unlockUtxo(lockedUtxos[0]);
    await expect(countUtxos(store)).resolves.toMatchObject({
      utxo: 4,
      lockedUtxo: 3,
    });
  }
});

describe('registered tokens', () => {
  it('should work with memory store', async () => {
    const store = new MemoryStore();
    await testRegisteredTokens(store);
  });

  it('should work with leveldb store', async () => {
    const xpriv = new HDPrivateKey();
    const walletId = crypto.Hash.sha256(Buffer.from(xpriv.xpubkey)).toString('hex');
    const store = new LevelDBStore(walletId, DATA_DIR);
    await testRegisteredTokens(store);
  });

  async function testRegisteredTokens(store) {
    const storage = new Storage(store);
    await storage.registerToken({ uid: 'abc1', name: 'test token 1', symbol: 'TST1' });
    await expect(storage.isTokenRegistered('abc1')).resolves.toEqual(true);
    await expect(storage.isTokenRegistered('abc2')).resolves.toEqual(false);
  }
});
