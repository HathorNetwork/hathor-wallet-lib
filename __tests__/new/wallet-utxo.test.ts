import { HDPrivateKey } from 'bitcore-lib';
import HathorWallet from '../../src/new/wallet';
import txHistoryFixture from '../__fixtures__/tx_history';
import { MemoryStore, Storage } from '../../src/storage';
import {
  MAX_INPUTS,
  MAX_OUTPUTS,
  TOKEN_DEPOSIT_PERCENTAGE,
  TX_WEIGHT_CONSTANTS,
} from '../../src/constants';
import { encryptData } from '../../src/utils/crypto';
import { WalletType } from '../../src/types';
import walletApi from '../../src/api/wallet';

class FakeHathorWallet {
  constructor() {
    // Will bind all methods to this instance
    for (const method of Object.getOwnPropertyNames(HathorWallet.prototype)) {
      if (method === 'constructor' || !(method && HathorWallet.prototype[method])) {
        continue;
      }
      // All methods can be spied on and mocked.
      this[method] = jest.fn().mockImplementation(HathorWallet.prototype[method].bind(this));
    }

    this.sendManyOutputsSendTransaction.mockImplementation(() => ({
      run: jest.fn().mockReturnValue(Promise.resolve({ hash: '123' })),
    }));

    // Prepare storage
    const store = new MemoryStore();
    const storage = new Storage(store);
    storage.setApiVersion({
      version: 'test',
      network: 'testnet',
      min_tx_weight: TX_WEIGHT_CONSTANTS.txMinWeight,
      min_tx_weight_coefficient: TX_WEIGHT_CONSTANTS.txWeightCoefficient,
      min_tx_weight_k: TX_WEIGHT_CONSTANTS.txMinWeightK,
      token_deposit_percentage: TOKEN_DEPOSIT_PERCENTAGE,
      reward_spend_min_blocks: 0,
      max_number_inputs: MAX_INPUTS,
      max_number_outputs: MAX_OUTPUTS,
    });
    this.readyPromise = Promise.resolve().then(async () => {
      const xpriv = new HDPrivateKey();
      await storage.saveAccessData({
        xpubkey: xpriv.xpubkey,
        mainKey: encryptData(xpriv.xprivkey, '123'),
        walletType: WalletType.P2PKH,
        walletFlags: 0,
      });
      await storage.setCurrentHeight(10);
      await storage.saveAddress({
        base58: 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
        bip32AddressIndex: 0,
      });
      await storage.saveAddress({
        base58: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        bip32AddressIndex: 1,
      });
      for (const tx of txHistoryFixture) {
        await storage.addTx(tx);
      }
      const getTokenApi = jest
        .spyOn(walletApi, 'getGeneralTokenInfo')
        .mockImplementation((uid, resolve) => {
          resolve({
            success: true,
            name: 'Custom token',
            symbol: 'CTK',
          });
        });
      await storage.processHistory();
      getTokenApi.mockRestore();
    });
    this.storage = storage;
  }
}

describe('UTXO Consolidation', () => {
  let hathorWallet;
  const destinationAddress = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
  const invalidDestinationAddress = 'WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi';
  beforeAll(async () => {
    hathorWallet = new FakeHathorWallet();
    await hathorWallet.readyPromise;
  });

  test('filter only HTR utxos', async () => {
    const utxoDetails = await hathorWallet.getUtxos();
    expect(utxoDetails.utxos).toHaveLength(3);
    expect(utxoDetails.total_amount_available).toBe(2);
    expect(utxoDetails.total_utxos_available).toBe(2);
    expect(utxoDetails.total_amount_locked).toBe(1);
    expect(utxoDetails.total_utxos_locked).toBe(1);
  });

  test('filter by custom token', async () => {
    const utxoDetails = await hathorWallet.getUtxos({
      token: '01',
    });
    expect(utxoDetails.utxos).toHaveLength(1);
    expect(utxoDetails.total_amount_available).toBe(1);
    expect(utxoDetails.total_utxos_available).toBe(1);
    expect(utxoDetails.total_amount_locked).toBe(0);
    expect(utxoDetails.total_utxos_locked).toBe(0);
  });

  test('filter by max_utxos', async () => {
    const utxoDetails = await hathorWallet.getUtxos({
      max_utxos: 1,
    });
    expect(utxoDetails.utxos).toHaveLength(1);
  });

  test('filter by filter_address', async () => {
    const utxoDetails = await hathorWallet.getUtxos({
      filter_address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
    });
    expect(utxoDetails.utxos).toHaveLength(1);
    expect(utxoDetails.total_amount_available).toBe(1);
    expect(utxoDetails.total_utxos_available).toBe(1);
    expect(utxoDetails.total_amount_locked).toBe(0);
    expect(utxoDetails.total_utxos_locked).toBe(0);
  });

  test('filter by max_amount', async () => {
    const utxoDetails = await hathorWallet.getUtxos({
      max_amount: 2,
    });
    expect(utxoDetails.utxos).toHaveLength(3);
    expect(utxoDetails.total_amount_available).toBe(2);
    expect(utxoDetails.total_utxos_available).toBe(2);
    expect(utxoDetails.total_amount_locked).toBe(1);
    expect(utxoDetails.total_utxos_locked).toBe(1);
  });

  test('filter by amount_bigger_than', async () => {
    const utxoDetails = await hathorWallet.getUtxos({
      token: '02',
      amount_bigger_than: 2.5,
    });
    expect(utxoDetails.utxos).toHaveLength(1);
    expect(utxoDetails.total_amount_available).toBe(3);
    expect(utxoDetails.total_utxos_available).toBe(1);
    expect(utxoDetails.total_amount_locked).toBe(0);
    expect(utxoDetails.total_utxos_locked).toBe(0);
  });

  test('filter by amount_smaller_than', async () => {
    const utxoDetails = await hathorWallet.getUtxos({
      token: '02',
      amount_smaller_than: 1.5,
    });
    expect(utxoDetails.utxos).toHaveLength(1);
    expect(utxoDetails.total_amount_available).toBe(1);
    expect(utxoDetails.total_utxos_available).toBe(1);
    expect(utxoDetails.total_amount_locked).toBe(0);
    expect(utxoDetails.total_utxos_locked).toBe(0);
  });

  test('correctly execute consolidateUtxos', async () => {
    const result = await hathorWallet.consolidateUtxos(destinationAddress);
    expect(hathorWallet.sendManyOutputsSendTransaction).toHaveBeenCalled();
    expect(result.total_utxos_consolidated).toBe(2);
    expect(result.total_amount).toBe(2);
    expect(result.txId).toBe('123');
    expect(result.utxos).toHaveLength(2);
    expect(result.utxos.some(utxo => utxo.locked)).toBeFalsy();
    // assert single output
    expect(hathorWallet.sendManyOutputsSendTransaction.mock.calls[0][0]).toEqual([
      { address: destinationAddress, value: 2, token: '00' },
    ]);
    // assert 2 inputs only
    expect(hathorWallet.sendManyOutputsSendTransaction.mock.calls[0][1].inputs).toHaveLength(2);
  });

  test('all HTR utxos locked by height', async () => {
    hathorWallet.storage.version.reward_spend_min_blocks = 10;
    const utxoDetails = await hathorWallet.getUtxos();
    expect(utxoDetails.utxos).toHaveLength(3);
    expect(utxoDetails.total_utxos_locked).toEqual(3);
    hathorWallet.storage.version.reward_spend_min_blocks = 0;
  });

  test('throw error when there is no utxo to consolidade', async () => {
    await expect(
      hathorWallet.consolidateUtxos(destinationAddress, { token: '05' })
    ).rejects.toEqual(new Error('No available utxo to consolidate.'));
  });

  test('throw error for invalid destinationAddress', async () => {
    await expect(hathorWallet.consolidateUtxos(invalidDestinationAddress)).rejects.toEqual(
      new Error("Utxo consolidation to an address not owned by this wallet isn't allowed.")
    );
  });
});
