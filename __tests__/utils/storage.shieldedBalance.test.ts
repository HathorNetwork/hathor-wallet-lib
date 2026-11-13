/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IHistoryTx, IStorage, ITokenBalance } from '../../src/types';
import { MemoryStore, Storage } from '../../src/storage';
import { processHistory, processNewTx, processUtxoUnlock } from '../../src/utils/storage';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import { ShieldedOutputMode } from '../../src/shielded/types';
import HathorWallet from '../../src/new/wallet';
import { splitBalanceSchema } from '../../src/wallet/api/schemas/walletApi';
import { ConnectionState } from '../../src/wallet/types';

// The shielded part of each token's balance, kept in the token metadata.
describe('shielded bucket of the token balance', () => {
  const LEGACY_ADDR = 'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN';
  const SPEND_ADDR = 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX';
  const TOKEN = '00'.repeat(31).concat('01');
  const RECEIVE_TX = 'aa'.repeat(32);
  const SPEND_TX = 'bb'.repeat(32);
  // processHistory reads the clock itself, so the timelock is in the real future.
  const NOW = Math.floor(Date.now() / 1000);
  const LATER = NOW + 3600;

  const transparentOutput = (value: bigint, address: string, timelock: number | null = null) => ({
    value,
    token: NATIVE_TOKEN_UID,
    token_data: 0,
    script: '',
    decoded: { address, timelock },
    spent_by: null,
  });

  // A shielded output the wallet already decoded: what decodeShieldedOutputs
  // writes in place.
  const shieldedOutput = ({
    value,
    token = NATIVE_TOKEN_UID,
    mode = ShieldedOutputMode.AMOUNT_SHIELDED,
    timelock = null,
  }: {
    value: bigint;
    token?: string;
    mode?: ShieldedOutputMode;
    timelock?: number | null;
  }) => ({
    mode,
    commitment: 'cc'.repeat(33),
    range_proof: '',
    script: '',
    token_data: 0,
    ephemeral_pubkey: '',
    ...(mode === ShieldedOutputMode.FULLY_SHIELDED ? { asset_commitment: 'dd'.repeat(33) } : {}),
    decoded: { address: SPEND_ADDR, timelock },
    spent_by: null,
    value,
    token,
    blindingFactor: 'ee'.repeat(32),
  });

  const buildTx = (txId: string, timestamp: number, fields: Partial<IHistoryTx>): IHistoryTx =>
    ({
      tx_id: txId,
      version: 1,
      timestamp,
      is_voided: false,
      nonce: 0,
      weight: 1,
      parents: [],
      inputs: [],
      outputs: [],
      shielded_outputs: [],
      height: 100,
      tokens: [],
      ...fields,
    }) as unknown as IHistoryTx;

  // Outputs 0-1 are transparent, 2-3 shielded:
  //   0: 10 transparent at a legacy address
  //   1: 5 transparent paid to the shielded address's spend P2PKH
  //   2: 50 shielded
  //   3: 20 shielded, timelocked until LATER
  const receiveTx = () =>
    buildTx(RECEIVE_TX, 1, {
      outputs: [transparentOutput(10n, LEGACY_ADDR), transparentOutput(5n, SPEND_ADDR)],
      shielded_outputs: [
        shieldedOutput({ value: 50n }),
        shieldedOutput({ value: 20n, timelock: LATER }),
      ],
    } as Partial<IHistoryTx>);

  // Spends the 50 shielded (a bare input, as the reload path feeds it) and the
  // 5 transparent at the spend P2PKH, to an address that is not the wallet's.
  const spendTx = () =>
    buildTx(SPEND_TX, 2, {
      inputs: [
        { tx_id: RECEIVE_TX, index: 2, type: 'shielded' },
        {
          tx_id: RECEIVE_TX,
          index: 1,
          ...transparentOutput(5n, SPEND_ADDR),
        },
      ],
      outputs: [transparentOutput(55n, 'not-mine')],
    } as unknown as Partial<IHistoryTx>);

  const seedStorage = async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    await store.saveAddress({
      base58: LEGACY_ADDR,
      bip32AddressIndex: 0,
      publicKey: '02'.repeat(33),
      addressType: 'p2pkh',
    });
    await store.saveAddress({
      base58: SPEND_ADDR,
      bip32AddressIndex: 0,
      publicKey: '03'.repeat(33),
      addressType: 'shielded-spend',
    });
    await storage.addToken({ uid: NATIVE_TOKEN_UID, name: 'Hathor', symbol: 'HTR' });
    return { store, storage };
  };

  const zero = (): ITokenBalance => ({ unlocked: 0n, locked: 0n });

  async function balanceOf(storage: IStorage, token = NATIVE_TOKEN_UID) {
    const meta = await storage.store.getTokenMeta(token);
    const tokens = meta?.balance.tokens ?? zero();
    const shielded = meta?.balance.shielded ?? zero();
    return {
      tokens,
      shielded,
      transparent: {
        unlocked: tokens.unlocked - shielded.unlocked,
        locked: tokens.locked - shielded.locked,
      },
    };
  }

  /** The split a walk over every UTXO of the wallet computes. */
  async function walkUtxos(storage: IStorage, token = NATIVE_TOKEN_UID) {
    const locked = new Set<string>();
    for await (const { tx, index } of storage.store.iterateLockedUtxos()) {
      locked.add(`${tx.tx_id}:${index}`);
    }
    const shielded = zero();
    const transparent = zero();
    for await (const utxo of storage.getAllUtxos()) {
      if (utxo.token !== token || utxo.authorities > 0n) continue;
      const bucket = utxo.shielded ? shielded : transparent;
      bucket[locked.has(`${utxo.txId}:${utxo.index}`) ? 'locked' : 'unlocked'] += utxo.value;
    }
    return { shielded, transparent };
  }

  async function processInOrder(storage: Storage, txs: IHistoryTx[]) {
    for (const tx of txs) {
      await storage.addTx(tx);
      await processNewTx(storage, tx, { nowTs: NOW, currentHeight: 200 });
    }
  }

  it('credits shielded outputs to the shielded bucket, locked and unlocked', async () => {
    const { storage } = await seedStorage();
    await processInOrder(storage, [receiveTx()]);

    expect(await balanceOf(storage)).toEqual({
      tokens: { unlocked: 65n, locked: 20n },
      shielded: { unlocked: 50n, locked: 20n },
      transparent: { unlocked: 15n, locked: 0n },
    });
  });

  it('keeps a transparent output paid to the spend P2PKH in the transparent bucket', async () => {
    const { storage } = await seedStorage();
    const tx = buildTx(RECEIVE_TX, 1, { outputs: [transparentOutput(5n, SPEND_ADDR)] });
    await processInOrder(storage, [tx]);

    expect(await balanceOf(storage)).toEqual({
      tokens: { unlocked: 5n, locked: 0n },
      shielded: zero(),
      transparent: { unlocked: 5n, locked: 0n },
    });
  });

  it('debits a shielded input from the shielded bucket and a transparent one from the transparent bucket', async () => {
    const { storage } = await seedStorage();
    await processInOrder(storage, [receiveTx(), spendTx()]);

    // Left: the 10 at the legacy address and the timelocked 20 shielded.
    expect(await balanceOf(storage)).toEqual({
      tokens: { unlocked: 10n, locked: 20n },
      shielded: { unlocked: 0n, locked: 20n },
      transparent: { unlocked: 10n, locked: 0n },
    });
  });

  it('moves a timelocked shielded output to the unlocked shielded bucket when it unlocks', async () => {
    const { store, storage } = await seedStorage();
    await processInOrder(storage, [receiveTx()]);

    for await (const lockedUtxo of store.iterateLockedUtxos()) {
      await processUtxoUnlock(storage, lockedUtxo, { nowTs: LATER + 1, currentHeight: 200 });
    }

    expect(await balanceOf(storage)).toEqual({
      tokens: { unlocked: 85n, locked: 0n },
      shielded: { unlocked: 70n, locked: 0n },
      transparent: { unlocked: 15n, locked: 0n },
    });
  });

  it('credits a FullShielded output of a custom token to that token’s shielded bucket', async () => {
    const { storage } = await seedStorage();
    const tx = buildTx(RECEIVE_TX, 1, {
      outputs: [transparentOutput(3n, LEGACY_ADDR)],
      shielded_outputs: [
        shieldedOutput({ value: 40n, token: TOKEN, mode: ShieldedOutputMode.FULLY_SHIELDED }),
      ],
    } as Partial<IHistoryTx>);
    await processInOrder(storage, [tx]);

    expect(await balanceOf(storage, TOKEN)).toEqual({
      tokens: { unlocked: 40n, locked: 0n },
      shielded: { unlocked: 40n, locked: 0n },
      transparent: zero(),
    });
    expect(await balanceOf(storage)).toEqual({
      tokens: { unlocked: 3n, locked: 0n },
      shielded: zero(),
      transparent: { unlocked: 3n, locked: 0n },
    });
  });

  it('rebuilds the bucket on processHistory, matching a walk over every UTXO', async () => {
    const { storage } = await seedStorage();
    const spent = receiveTx();
    // The fullnode stamps the spends on the outputs.
    spent.outputs[1].spent_by = SPEND_TX;
    spent.shielded_outputs![0].spent_by = SPEND_TX;
    await storage.addTx(spent);
    await storage.addTx(spendTx());
    // Metadata left over from an earlier walk is dropped.
    await storage.store.editTokenMeta(NATIVE_TOKEN_UID, {
      numTransactions: 9,
      balance: {
        tokens: { unlocked: 999n, locked: 0n },
        shielded: { unlocked: 999n, locked: 0n },
        authorities: { mint: zero(), melt: zero() },
      },
    });

    await processHistory(storage);

    const balance = await balanceOf(storage);
    expect(balance.shielded).toEqual({ unlocked: 0n, locked: 20n });
    expect(balance.transparent).toEqual({ unlocked: 10n, locked: 0n });
    expect(await walkUtxos(storage)).toEqual({
      shielded: balance.shielded,
      transparent: balance.transparent,
    });
  });

  it('leaves a token record saved without the bucket alone, read as all transparent', async () => {
    const { store, storage } = await seedStorage();
    await store.editTokenMeta(NATIVE_TOKEN_UID, {
      numTransactions: 1,
      balance: {
        tokens: { unlocked: 7n, locked: 0n },
        authorities: { mint: zero(), melt: zero() },
      },
    });
    await processInOrder(storage, [receiveTx()]);

    const meta = await store.getTokenMeta(NATIVE_TOKEN_UID);
    expect(meta?.balance.shielded).toBeUndefined();
    expect(meta?.balance.tokens).toEqual({ unlocked: 72n, locked: 20n });
  });

  describe('HathorWallet.getBalance(token, { split: true })', () => {
    const SEED =
      'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';

    function walletOn(storage: Storage): HathorWallet {
      return new HathorWallet({
        seed: SEED,
        connection: {
          getState: () => ConnectionState.CLOSED,
          getCurrentNetwork: () => 'testnet',
          startControlHandlers: jest.fn(),
          on: jest.fn(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        storage,
        password: '123',
        pinCode: '123',
      });
    }

    it('splits each amount into its transparent and shielded parts', async () => {
      const { storage } = await seedStorage();
      await processInOrder(storage, [receiveTx()]);
      const wallet = walletOn(storage);

      const [split] = await wallet.getBalance(NATIVE_TOKEN_UID, { split: true });
      expect(split.balance).toEqual({
        unlocked: { transparent: 15n, shielded: 50n, total: 65n },
        locked: { transparent: 0n, shielded: 20n, total: 20n },
      });

      // Everything else is what the plain balance returns.
      const [plain] = await wallet.getBalance(NATIVE_TOKEN_UID);
      expect(plain.balance).toEqual({ unlocked: 65n, locked: 20n });
      const { balance: _split, ...splitRest } = split;
      const { balance: _plain, ...plainRest } = plain;
      expect(splitRest).toEqual(plainRest);
    });

    it('reads a missing bucket, or a token the wallet never saw, as zero shielded', async () => {
      const { store, storage } = await seedStorage();
      await store.editTokenMeta(NATIVE_TOKEN_UID, {
        numTransactions: 1,
        balance: {
          tokens: { unlocked: 7n, locked: 2n },
          authorities: { mint: zero(), melt: zero() },
        },
      });
      const wallet = walletOn(storage);

      const [old] = await wallet.getBalance(NATIVE_TOKEN_UID, { split: true });
      expect(old.balance).toEqual({
        unlocked: { transparent: 7n, shielded: 0n, total: 7n },
        locked: { transparent: 2n, shielded: 0n, total: 2n },
      });
      const [unknown] = await wallet.getBalance(TOKEN, { split: true });
      expect(unknown.balance).toEqual({
        unlocked: { transparent: 0n, shielded: 0n, total: 0n },
        locked: { transparent: 0n, shielded: 0n, total: 0n },
      });
    });

    it('returns the balance in the shape the wallet-service facade does', async () => {
      const { storage } = await seedStorage();
      await processInOrder(storage, [receiveTx()]);
      const [fullnode] = await walletOn(storage).getBalance(NATIVE_TOKEN_UID, { split: true });

      // The wallet-service facade parses its split balance with this schema,
      // which drops any key it doesn't know.
      expect(splitBalanceSchema.parse(fullnode.balance)).toEqual(fullnode.balance);
    });
  });
});
