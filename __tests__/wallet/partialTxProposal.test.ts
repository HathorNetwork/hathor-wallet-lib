/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import PartialTxProposal from '../../src/wallet/partialTxProposal';
import { Utxo } from '../../src/wallet/types';
import Network from '../../src/models/network';
import P2PKH from '../../src/models/p2pkh';
import P2SH from '../../src/models/p2sh';
import Transaction from '../../src/models/transaction';
import Address from '../../src/models/address';
import dateFormatter from '../../src/utils/date';
import {
  ProposalInput,
  ProposalOutput,
  PartialTx,
  PartialTxInputData,
} from '../../src/models/partial_tx';
import {
  NATIVE_TOKEN_UID,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
  DEFAULT_TX_VERSION,
} from '../../src/constants';

import { MemoryStore, Storage } from '../../src/storage';
import { IUtxo } from '../../src/types';

// beforeAll(() => {
//   transaction.updateMaxInputsConstant(MAX_INPUTS);
//   transaction.updateMaxOutputsConstant(MAX_OUTPUTS);
//   transaction.updateTransactionWeightConstants(
//     TX_WEIGHT_CONSTANTS.txMinWeight,
//     TX_WEIGHT_CONSTANTS.txWeightCoefficient,
//     TX_WEIGHT_CONSTANTS.txMinWeightK,
//   );
// });

const FAKE_TXID = '3df2d6824ca849c9d3fb17090f1fb269b2ef1075c0e2abda246a59ea4b075515';
const FAKE_UID = '5342ca1fe63ea9211e425166060f0c6e36193507eb1ca1a091a9a25b90f3b32c';
const ADDR1 = 'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN';
const ADDR2 = 'WmtWgtk5GxdcDKwjNwmXXn74nQWTPWhKfx';
const ADDR3 = 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc';
const ADDR4 = 'wcUZ6J7t2B1s8bqRYiyuZAftcdCGRSiiau'; // P2SH
const testnet = new Network('testnet');
const createPartialTx = (inputs, outputs) => {
  const partialTx = new PartialTx(testnet);
  partialTx.inputs = inputs;
  partialTx.outputs = outputs;
  return partialTx;
};
const scriptFromAddressP2PKH = (base58: string, timelock: number | null = null) => {
  const p2pkh = new P2PKH(new Address(base58, { network: testnet }), { timelock });
  return p2pkh.createScript();
};
const scriptFromAddressP2SH = base58 => {
  const p2sh = new P2SH(new Address(base58, { network: testnet }));
  return p2sh.createScript();
};

test('fromPartialTx', async () => {
  const partialTx = createPartialTx(
    [new ProposalInput(FAKE_TXID, 0, 10, ADDR1)],
    [
      new ProposalOutput(5, scriptFromAddressP2PKH(ADDR2)),
      new ProposalOutput(10, scriptFromAddressP2PKH(ADDR3), { token: FAKE_UID }),
    ]
  );

  const serialized = partialTx.serialize();
  const store = new MemoryStore();
  const testStorage = new Storage(store);

  const proposal = PartialTxProposal.fromPartialTx(serialized, testStorage);

  expect(proposal.partialTx.serialize()).toEqual(serialized);

  expect(proposal.partialTx).toMatchObject({
    inputs: [expect.objectContaining({ hash: FAKE_TXID, index: 0, value: 10, address: ADDR1 })],
    outputs: [
      expect.objectContaining({ value: 5, token: NATIVE_TOKEN_UID }),
      expect.objectContaining({ value: 10, token: FAKE_UID }),
    ],
  });

  expect(proposal.signatures).toBe(null);
});

test('addSend', async () => {
  const utxos: IUtxo[] = [
    {
      txId: FAKE_TXID,
      index: 1,
      token: FAKE_UID,
      address: ADDR1,
      value: 10,
      authorities: 0,
      timelock: 100,
      type: DEFAULT_TX_VERSION,
      height: null,
    },
  ];
  const utxosOld: Utxo[] = [
    {
      txId: FAKE_TXID,
      index: 1,
      addressPath: '',
      address: ADDR1,
      timelock: 100,
      tokenId: FAKE_UID,
      value: 10,
      authorities: 0,
      heightlock: null,
      locked: false,
    },
  ];

  const store = new MemoryStore();
  const testStorage = new Storage(store);
  testStorage.config.setNetwork('testnet');

  const spyReset = jest.spyOn(PartialTxProposal.prototype, 'resetSignatures');
  const spyInput = jest.spyOn(PartialTxProposal.prototype, 'addInput').mockImplementation(() => {});
  const spyOutput = jest
    .spyOn(PartialTxProposal.prototype, 'addOutput')
    .mockImplementation(() => {});

  async function* utxoMock(options?: Parameters<typeof testStorage.selectUtxos>[0]) {
    for (const u of utxos) {
      yield u;
    }
  }

  const spyUtxos = jest.spyOn(testStorage, 'selectUtxos').mockImplementation(utxoMock);
  const spyAddr = jest
    .spyOn(testStorage, 'getCurrentAddress')
    .mockImplementation(() => Promise.resolve(ADDR2));

  const proposal = new PartialTxProposal(testStorage);

  /**
   * Add 1 input without change
   */
  await proposal.addSend(FAKE_UID, 10);
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyInput).toHaveBeenCalledWith(FAKE_TXID, 1, 10, ADDR1, {
    token: FAKE_UID,
    authorities: 0,
    markAsSelected: true,
  });
  expect(spyOutput).not.toHaveBeenCalled();
  expect(spyUtxos).toHaveBeenCalledWith({ token: FAKE_UID, authorities: 0 });
  expect(spyAddr).not.toHaveBeenCalled();

  // Mock cleanup
  spyReset.mockClear();
  spyInput.mockClear();
  spyOutput.mockClear();
  spyUtxos.mockClear();
  spyAddr.mockClear();

  /**
   * Add 1 input with change passing utxos and address
   */
  await proposal.addSend(FAKE_UID, 4, { utxos: utxosOld, changeAddress: ADDR3 });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyInput).toHaveBeenCalledWith(FAKE_TXID, 1, 10, ADDR1, {
    token: FAKE_UID,
    authorities: 0,
    markAsSelected: true,
  });
  expect(spyOutput).toHaveBeenCalledWith(
    FAKE_UID,
    6, // change 10 - 4 = 6
    ADDR3,
    { isChange: true }
  );
  expect(spyAddr).not.toHaveBeenCalled();
  expect(spyUtxos).not.toHaveBeenCalled();

  // Mock cleanup
  spyReset.mockClear();
  spyInput.mockClear();
  spyOutput.mockClear();
  spyUtxos.mockClear();
  spyAddr.mockClear();

  /**
   * Add 1 input with change without address and markAsSelected false
   */
  await proposal.addSend(FAKE_UID, 8, { markAsSelected: false });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyUtxos).toHaveBeenCalledWith({ token: FAKE_UID, authorities: 0 });
  expect(spyInput).toHaveBeenCalledWith(FAKE_TXID, 1, 10, ADDR1, {
    token: FAKE_UID,
    authorities: 0,
    markAsSelected: false,
  });
  expect(spyOutput).toHaveBeenCalledWith(
    FAKE_UID,
    2, // change 10 - 8 = 2
    ADDR2,
    { isChange: true }
  );
  expect(spyAddr).toHaveBeenCalled();

  // Remove mocks
  spyReset.mockRestore();
  spyInput.mockRestore();
  spyOutput.mockRestore();
  spyUtxos.mockRestore();
  spyAddr.mockRestore();
});

test('addReceive', async () => {
  const spyReset = jest.spyOn(PartialTxProposal.prototype, 'resetSignatures');
  const spyOutput = jest
    .spyOn(PartialTxProposal.prototype, 'addOutput')
    .mockImplementation(() => {});

  const store = new MemoryStore();
  const testStorage = new Storage(store);
  testStorage.config.setNetwork('testnet');
  const proposal = new PartialTxProposal(testStorage);
  const spyAddr = jest
    .spyOn(testStorage, 'getCurrentAddress')
    .mockImplementation(() => Promise.resolve(ADDR1));

  /**
   * Add 1 output of a custom token, get address from wallet
   */
  await proposal.addReceive(FAKE_UID, 99);
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toHaveBeenCalledWith(FAKE_UID, 99, ADDR1, { timelock: null });
  expect(spyAddr).toHaveBeenCalled();

  // Mock cleanup
  spyReset.mockClear();
  spyOutput.mockClear();
  spyAddr.mockClear();

  /**
   * Add 1 HTR output, giving the destination address
   */
  await proposal.addReceive(NATIVE_TOKEN_UID, 180, { address: ADDR2 });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toHaveBeenCalledWith(NATIVE_TOKEN_UID, 180, ADDR2, { timelock: null });
  expect(spyAddr).not.toHaveBeenCalled();

  // Remove mocks
  spyReset.mockRestore();
  spyOutput.mockRestore();
});

test('addInput', async () => {
  const spyReset = jest.spyOn(PartialTxProposal.prototype, 'resetSignatures');
  const spyInput = jest.spyOn(PartialTx.prototype, 'addInput');

  const store = new MemoryStore();
  const testStorage = new Storage(store);
  testStorage.config.setNetwork('testnet');
  const spyMark = jest.spyOn(testStorage, 'utxoSelectAsInput').mockImplementation(jest.fn());

  const proposal = new PartialTxProposal(testStorage);

  /**
   * Add 1 HTR input
   */
  proposal.addInput(FAKE_TXID, 5, 999, ADDR1);
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyMark).toHaveBeenCalledWith({ txId: FAKE_TXID, index: 5 }, true);
  expect(spyInput).toHaveBeenCalledWith(FAKE_TXID, 5, 999, ADDR1, {
    token: NATIVE_TOKEN_UID,
    authorities: 0,
  });

  // Mock cleanup
  spyReset.mockClear();
  spyInput.mockClear();
  spyMark.mockClear();

  /**
   * Add 1 custom token authority input
   */
  proposal.addInput(FAKE_TXID, 20, 70, ADDR2, {
    token: FAKE_UID,
    authorities: TOKEN_MINT_MASK,
    markAsSelected: false,
  });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyMark).not.toHaveBeenCalled();
  expect(spyInput).toHaveBeenCalledWith(FAKE_TXID, 20, 70, ADDR2, {
    token: FAKE_UID,
    authorities: TOKEN_MINT_MASK,
  });

  // Remove mocks
  spyReset.mockRestore();
  spyInput.mockRestore();
  spyMark.mockRestore();
});

test('addOutput', async () => {
  const spyReset = jest.spyOn(PartialTxProposal.prototype, 'resetSignatures');
  const spyOutput = jest.spyOn(PartialTx.prototype, 'addOutput').mockImplementation(() => {});

  const store = new MemoryStore();
  const testStorage = new Storage(store);
  testStorage.config.setNetwork('testnet');
  const proposal = new PartialTxProposal(testStorage);

  /**
   * Add 1 custom token output
   */
  proposal.addOutput(FAKE_UID, 999, ADDR1);
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toHaveBeenCalledWith(999, scriptFromAddressP2PKH(ADDR1), {
    token: FAKE_UID,
    authorities: 0,
    isChange: false,
  });

  // Mock cleanup
  spyReset.mockClear();
  spyOutput.mockClear();

  /**
   * Add 1 HTR output to a MultiSig address
   */
  proposal.addOutput(NATIVE_TOKEN_UID, 456, ADDR4, { isChange: true });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toHaveBeenCalledWith(456, scriptFromAddressP2SH(ADDR4), {
    token: NATIVE_TOKEN_UID,
    authorities: 0,
    isChange: true,
  });

  // Remove mocks
  spyReset.mockRestore();
  spyOutput.mockRestore();
});

test('resetSignatures', async () => {
  const store = new MemoryStore();
  const testStorage = new Storage(store);
  testStorage.config.setNetwork('testnet');
  const proposal = new PartialTxProposal(testStorage);
  proposal.signatures = new PartialTxInputData('a-hash', 1);
  proposal.transaction = new Transaction([], []);

  proposal.resetSignatures();
  expect(proposal.signatures).toEqual(null);
  expect(proposal.transaction).toEqual(null);
});

test('setSignatures', async () => {
  const store = new MemoryStore();
  const testStorage = new Storage(store);
  testStorage.config.setNetwork('testnet');

  const proposal = new PartialTxProposal(testStorage);
  // @ts-expect-error -- Testing invalid inputs
  const spyProposalTx = jest.spyOn(proposal.partialTx, 'getTx').mockImplementation(() => ({
    getDataToSign: () => 'hexHash',
    inputs: { length: 2 },
    hash: 'hexHash',
  }));
  let serializedSignatures = 'PartialTxInputData|wrongHash|0:cafe00|1:cafe01'; // Incorrect hash on serialized sig
  const spyAdd = jest
    .spyOn(PartialTxInputData.prototype, 'addSignatures')
    .mockImplementation(() => {});

  // Ensure it throws on an incomplete partialTx
  const spyComplete = jest
    .spyOn(proposal.partialTx, 'isComplete')
    .mockImplementationOnce(() => false);
  expect(() => proposal.setSignatures(serializedSignatures)).toThrow('Cannot sign incomplete data');

  // Ensure it doesn't allow adding signatures for the wrong tx hash
  spyComplete.mockImplementationOnce(() => true);
  expect(() => proposal.setSignatures(serializedSignatures)).toThrow(
    'Signatures do not match tx hash'
  );

  // Adds the serialized signatures on a complete partialTx for the correct tx
  serializedSignatures = serializedSignatures.replace('wrongHash', 'hexHash');
  proposal.setSignatures(serializedSignatures);
  expect(proposal.signatures).toBeInstanceOf(PartialTxInputData); // A full signatures object is available on proposal
  expect(spyAdd).toHaveBeenCalledTimes(1); // Only a single pass is executed
  expect(spyAdd).toHaveBeenCalledWith(serializedSignatures); // The signatures added are from the parameters

  spyProposalTx.mockRestore();
  spyAdd.mockRestore();
  spyComplete.mockRestore();
});

test('prepareTx', async () => {
  const store = new MemoryStore();
  const testStorage = new Storage(store);
  testStorage.config.setNetwork('testnet');
  let proposal = new PartialTxProposal(testStorage);
  proposal.signatures = new PartialTxInputData('a-hash', 0);

  // Returns a transaction instance
  expect(proposal.prepareTx()).toBeInstanceOf(Transaction);

  proposal = new PartialTxProposal(testStorage);
  proposal.signatures = new PartialTxInputData('another-hash', 0);
  // If the transaction already exists, it will return it
  const tx = new Transaction([], []);
  proposal.transaction = tx;
  expect(proposal.prepareTx()).toBe(tx);
});

test('calculateBalance', async () => {
  const ADDR_OTHER = 'wca2xk9S2MVn2UrKh78UScdwXz3xrTp8Ky';
  const fakeUid2 = 'c84ea394b7f2b841fe6228f93be6596aa9787a922513a3a3e572813957cb0b7d';
  const fakeUid3 = 'b4254615622c1add9fdbc3ac661463ce2e42ca8feec2b5e3651cccea7c117e9c';
  const fakeUid4 = 'a75c2c1a3cfe724fd3ca8a6542ac0a03b857139b3962a2fce5d79040e21b2930';
  const timelock = dateFormatter.dateToTimestamp(new Date()) + 9999;
  const partialTx = createPartialTx(
    [
      new ProposalInput(FAKE_TXID, 0, 2, ADDR1, { token: FAKE_UID }),
      new ProposalInput(FAKE_TXID, 1, 4, ADDR2, { token: fakeUid3 }),
      new ProposalInput(FAKE_TXID, 2, 7, ADDR3),
      new ProposalInput(FAKE_TXID, 3, 3, ADDR1),
      // Authority
      new ProposalInput(FAKE_TXID, 4, TOKEN_MELT_MASK, ADDR2, {
        token: fakeUid3,
        authorities: TOKEN_MELT_MASK,
      }),
      new ProposalInput(FAKE_TXID, 5, TOKEN_MELT_MASK, ADDR3, {
        token: fakeUid3,
        authorities: TOKEN_MELT_MASK,
      }),
      // Not from the wallet
      new ProposalInput(FAKE_TXID, 6, 4, ADDR_OTHER, { token: fakeUid3 }),
      new ProposalInput(FAKE_TXID, 7, 999, ADDR_OTHER, { token: fakeUid4 }),
      new ProposalInput(FAKE_TXID, 8, TOKEN_MINT_MASK, ADDR_OTHER, {
        token: fakeUid3,
        authorities: TOKEN_MINT_MASK,
      }),
    ],
    [
      new ProposalOutput(5, scriptFromAddressP2PKH(ADDR1), { token: FAKE_UID }),
      new ProposalOutput(8, scriptFromAddressP2PKH(ADDR2), { token: fakeUid2 }),
      new ProposalOutput(7, scriptFromAddressP2PKH(ADDR3), { token: fakeUid2 }),
      // Locked
      new ProposalOutput(1, scriptFromAddressP2PKH(ADDR1, timelock)),
      new ProposalOutput(1, scriptFromAddressP2PKH(ADDR2, timelock)),
      new ProposalOutput(3, scriptFromAddressP2PKH(ADDR3, timelock), { token: FAKE_UID }),
      new ProposalOutput(4, scriptFromAddressP2PKH(ADDR1, timelock), { token: fakeUid2 }),
      // Authority
      new ProposalOutput(TOKEN_MINT_MASK, scriptFromAddressP2PKH(ADDR2), {
        token: FAKE_UID,
        authorities: TOKEN_MINT_MASK,
      }),
      // Authority locked
      new ProposalOutput(TOKEN_MELT_MASK, scriptFromAddressP2PKH(ADDR3, timelock), {
        token: fakeUid2,
        authorities: TOKEN_MELT_MASK,
      }),
      new ProposalOutput(TOKEN_MINT_MASK, scriptFromAddressP2PKH(ADDR1, timelock), {
        token: fakeUid3,
        authorities: TOKEN_MINT_MASK,
      }),
      // Not from the wallet
      new ProposalOutput(10, scriptFromAddressP2PKH(ADDR_OTHER)),
      new ProposalOutput(TOKEN_MELT_MASK, scriptFromAddressP2PKH(ADDR_OTHER), {
        token: fakeUid2,
        authorities: TOKEN_MELT_MASK,
      }),
    ]
  );
  /**
   * Summary of the test fixture
   *
   * // Unlocked token balances
   *          inputs | outputs
   *          ----------------
   * FAKE_UID: -2    | +5
   * fakeUid2:       | +8,+7
   * fakeUid3: -4    |
   * HTR     : -7,-3 |
   *
   * // Locked token balances (only outputs can be locked)
   *           outputs
   *          --------
   * HTR     : +1+1
   * FAKE_UID: +3
   * fakeUid2: +4
   *
   * // Token authorities:
   *          locked(mint) | unlocked(mint) | locked(melt) | unlocked(melt)
   *          -------------------------------------------------------------
   * FAKE_UID:      0      |      +1       |       0      |      0
   * fakeUid2:      0      |       0       |      +1      |      0
   * fakeUid3:     +1      |       0       |       0      |     -2
   *
   * // Not from the wallet (ADDR_OTHER)
   * +10 HTR, -999 fakeUid4, -mint (fakeUid3), +melt (fakeUid2)
   *
   */
  const expected = {
    [NATIVE_TOKEN_UID]: {
      balance: { unlocked: -10, locked: 2 },
      authority: {
        unlocked: { mint: 0, melt: 0 },
        locked: { mint: 0, melt: 0 },
      },
    },
    [FAKE_UID]: {
      balance: { unlocked: 3, locked: 3 },
      authority: {
        unlocked: { mint: 1, melt: 0 },
        locked: { mint: 0, melt: 0 },
      },
    },
    [fakeUid2]: {
      balance: { unlocked: 15, locked: 4 },
      authority: {
        unlocked: { mint: 0, melt: 0 },
        locked: { mint: 0, melt: 1 },
      },
    },
    [fakeUid3]: {
      balance: { unlocked: -4, locked: 0 },
      authority: {
        unlocked: { mint: 0, melt: -2 },
        locked: { mint: 1, melt: 0 },
      },
    },
  };

  const store = new MemoryStore();
  const testStorage = new Storage(store);
  testStorage.config.setNetwork('testnet');
  jest.spyOn(testStorage, 'isAddressMine').mockImplementation(async (base58: string) => {
    switch (base58) {
      case ADDR1:
      case ADDR2:
      case ADDR3:
        return true;
      default:
        return false;
    }
  });

  const proposal = new PartialTxProposal(testStorage);
  proposal.partialTx = partialTx;
  expect(await proposal.calculateBalance()).toEqual(expected);
});
