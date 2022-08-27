/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import PartialTxProposal from '../../src/wallet/partialTxProposal';
import { UtxoExtended } from '../../src/wallet/partialTxProposal';
import Network from '../../src/models/network';
import P2PKH from '../../src/models/p2pkh';
import P2SH from '../../src/models/p2sh';
import Transaction from '../../src/models/transaction';
import Address from '../../src/models/address';
import HathorWallet from '../../src/new/wallet';
import wallet from '../../src/wallet';
import dateFormatter from '../../src/date';
import transaction from '../../src/transaction';
import {
  ProposalInput,
  ProposalOutput,
  PartialTxPrefix,
  PartialTx,
  PartialTxInputDataPrefix,
  PartialTxInputData,
} from '../../src/models/partial_tx';
import {
  HATHOR_TOKEN_CONFIG,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
  MAX_INPUTS,
  MAX_OUTPUTS,
  TX_WEIGHT_CONSTANTS,
} from '../../src/constants';

beforeAll(() => {
  transaction.updateMaxInputsConstant(MAX_INPUTS);
  transaction.updateMaxOutputsConstant(MAX_OUTPUTS);
  transaction.updateTransactionWeightConstants(
    TX_WEIGHT_CONSTANTS.txMinWeight,
    TX_WEIGHT_CONSTANTS.txWeightCoefficient,
    TX_WEIGHT_CONSTANTS.txMinWeightK,
  );
});

const fakeHathorWallet = fakeMethods => {
  const hWallet = {};
  for (const m of Object.keys(fakeMethods)) {
    hWallet[m] = fakeMethods[m];
  }
  return hWallet as HathorWallet;
};

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
const scriptFromAddressP2PKH = (base58, timelock = null) => {
  const p2pkh = new P2PKH(new Address(base58, { network: testnet }), { timelock });
  return p2pkh.createScript();
};
const scriptFromAddressP2SH = base58 => {
  const p2sh = new P2SH(new Address(base58, { network: testnet }));
  return p2sh.createScript();
};

test('fromPartialTx', async () => {
  const partialTx = createPartialTx([
    new ProposalInput(FAKE_TXID, 0, 10, ADDR1),
  ], [
    new ProposalOutput(5, scriptFromAddressP2PKH(ADDR2)),
    new ProposalOutput(10, scriptFromAddressP2PKH(ADDR3), { token: FAKE_UID, tokenData: 1 }),
  ]);

  const serialized = partialTx.serialize();
  const proposal = PartialTxProposal.fromPartialTx(serialized, testnet);

  expect(proposal.partialTx.serialize()).toEqual(serialized);

  expect(proposal.partialTx).toMatchObject({
    inputs: [expect.objectContaining({ hash: FAKE_TXID, index: 0, value: 10, address: ADDR1 })],
    outputs: [
      expect.objectContaining({ value: 5, token: HATHOR_TOKEN_CONFIG.uid }),
      expect.objectContaining({ value: 10, token: FAKE_UID }),
    ],
  });

  expect(proposal.network).toBe(testnet);
  expect(proposal.signatures).toBe(null);
});

test('getWalletUtxos', async () => {
  const utxo = {
    txId: FAKE_TXID,
    index: 1,
    addressPath: 'm/address/path',
    address: ADDR1,
    timelock: 100,
    tokenId: FAKE_UID,
    value: 99,
    authorities: 0,
    heightlock: null,
    locked: false,
  };
  function* getUtxos() {
    yield utxo;
  }

  const hwallet = fakeHathorWallet({
    getFullHistory: jest.fn(() => ({
      [FAKE_TXID]: {
        outputs: [null, { token_data: 27 }, null],
      },
    })),
    getAllUtxos: jest.fn(getUtxos),
  });

  const utxos = PartialTxProposal.getWalletUtxos(hwallet, FAKE_UID);

  // check wallet mocks
  expect(hwallet.getFullHistory).toHaveBeenCalledTimes(1);
  expect(hwallet.getAllUtxos).toHaveBeenCalledTimes(1);
  expect(hwallet.getAllUtxos).toBeCalledWith({ token: FAKE_UID });

  // Check token data is added to utxo
  expect(utxos).toEqual([{ ...utxo, tokenData: 27 }]);
});

test('addSend', async () => {
  const utxos: UtxoExtended[] = [{
    txId: FAKE_TXID,
    index: 1,
    addressPath: 'm/address/path',
    address: ADDR1,
    timelock: 100,
    tokenId: FAKE_UID,
    value: 10,
    authorities: 0,
    heightlock: null,
    locked: false,
    tokenData: 1,
  }];
  const spyReset = jest.spyOn(PartialTxProposal.prototype, 'resetSignatures');
  const spyInput = jest.spyOn(PartialTxProposal.prototype, 'addInput')
    .mockImplementation(() => {});
  const spyOutput = jest.spyOn(PartialTxProposal.prototype, 'addOutput')
    .mockImplementation(() => {});
  const spyUtxos = jest.spyOn(PartialTxProposal, 'getWalletUtxos')
    .mockReturnValue(utxos);

  const hwallet = fakeHathorWallet({
    getCurrentAddress: jest.fn(() => ({
      address: ADDR2,
    })),
  });

  const proposal = new PartialTxProposal(testnet);

  /**
   * Add 1 input without change
   */
  proposal.addSend(hwallet, FAKE_UID, 10);
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyUtxos).toBeCalledWith(hwallet, FAKE_UID);
  expect(spyInput).toBeCalledWith(
    hwallet,
    FAKE_TXID,
    1,
    10,
    ADDR1,
    { token: FAKE_UID, tokenData: 1, markAsSelected: true },
  );
  expect(spyOutput).not.toHaveBeenCalled();
  expect(hwallet.getCurrentAddress).not.toHaveBeenCalled();

  // Mock cleanup
  spyReset.mockClear();
  spyInput.mockClear();
  spyOutput.mockClear();
  spyUtxos.mockClear();
  hwallet.getCurrentAddress.mockClear();

  /**
   * Add 1 input with change passing utxos and address
   */
  proposal.addSend(hwallet, FAKE_UID, 4, { utxos, changeAddress: ADDR3 });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyUtxos).not.toHaveBeenCalled();
  expect(spyInput).toBeCalledWith(
    hwallet,
    FAKE_TXID,
    1,
    10,
    ADDR1,
    { token: FAKE_UID, tokenData: 1, markAsSelected: true },
  );
  expect(spyOutput).toBeCalledWith(
    FAKE_UID,
    6, // change 10 - 4 = 6
    ADDR3,
    { isChange: true },
  );
  expect(hwallet.getCurrentAddress).not.toHaveBeenCalled();

  // Mock cleanup
  spyReset.mockClear();
  spyInput.mockClear();
  spyOutput.mockClear();
  spyUtxos.mockClear();
  hwallet.getCurrentAddress.mockClear();

  /**
   * Add 1 input with change without address and markAsSelected false
   */
  proposal.addSend(hwallet, FAKE_UID, 8, { markAsSelected: false });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyUtxos).toBeCalledWith(hwallet, FAKE_UID);
  expect(spyInput).toBeCalledWith(
    hwallet,
    FAKE_TXID,
    1,
    10,
    ADDR1,
    { token: FAKE_UID, tokenData: 1, markAsSelected: false },
  );
  expect(spyOutput).toBeCalledWith(
    FAKE_UID,
    2, // change 10 - 8 = 2
    ADDR2,
    { isChange: true },
  );
  expect(hwallet.getCurrentAddress).toHaveBeenCalled();

  // Remove mocks
  spyReset.mockRestore();
  spyInput.mockRestore();
  spyOutput.mockRestore();
  spyUtxos.mockRestore();
});

test('addReceive', async () => {
  const spyReset = jest.spyOn(PartialTxProposal.prototype, 'resetSignatures');
  const spyOutput = jest.spyOn(PartialTxProposal.prototype, 'addOutput')
    .mockImplementation(() => {});

  const hwallet = fakeHathorWallet({
    getCurrentAddress: jest.fn(() => ({
      address: ADDR1,
    })),
  });

  const proposal = new PartialTxProposal(testnet);

  proposal.addReceive(hwallet, FAKE_UID, 99);
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toBeCalledWith(
    FAKE_UID,
    99,
    ADDR1,
    { timelock: null },
  );
  expect(hwallet.getCurrentAddress).toHaveBeenCalled();

  // Mock cleanup
  spyReset.mockClear();
  spyOutput.mockClear();
  hwallet.getCurrentAddress.mockClear();

  proposal.addReceive(hwallet, HATHOR_TOKEN_CONFIG.uid, 180, { address: ADDR2 });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toBeCalledWith(
    HATHOR_TOKEN_CONFIG.uid,
    180,
    ADDR2,
    { timelock: null },
  );
  expect(hwallet.getCurrentAddress).not.toHaveBeenCalled();

  // Remove mocks
  spyReset.mockRestore();
  spyOutput.mockRestore();
});

test('addInput', async () => {
  const spyReset = jest.spyOn(PartialTxProposal.prototype, 'resetSignatures');
  const spyInput = jest.spyOn(PartialTx.prototype, 'addInput');

  const hwallet = fakeHathorWallet({
    markUtxoSelected: jest.fn((hash, index) => {}),
  });

  const proposal = new PartialTxProposal(testnet);

  proposal.addInput(hwallet, FAKE_TXID, 5, 999, ADDR1);
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(hwallet.markUtxoSelected).toBeCalledWith(FAKE_TXID, 5);
  expect(spyInput).toBeCalledWith(FAKE_TXID, 5, 999, ADDR1, { token: HATHOR_TOKEN_CONFIG.uid, tokenData: 0 });

  // Mock cleanup
  spyReset.mockClear();
  spyInput.mockClear();
  hwallet.markUtxoSelected.mockClear();

  proposal.addInput(
    hwallet,
    FAKE_TXID,
    20,
    70,
    ADDR2,
    { token: FAKE_UID, tokenData: 123, markAsSelected: false},
  );
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(hwallet.markUtxoSelected).not.toHaveBeenCalled();
  expect(spyInput).toBeCalledWith(FAKE_TXID, 20, 70, ADDR2, { token: FAKE_UID, tokenData: 123 });

  // Remove mocks
  spyReset.mockRestore();
  spyInput.mockRestore();
});

test('addOutput', async () => {
  const spyReset = jest.spyOn(PartialTxProposal.prototype, 'resetSignatures');
  const spyOutput = jest.spyOn(PartialTx.prototype, 'addOutput');

  const proposal = new PartialTxProposal(testnet);

  proposal.addOutput(FAKE_UID, 999, ADDR1, { tokenData: 2 });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toBeCalledWith(
    999,
    scriptFromAddressP2PKH(ADDR1),
    { token: FAKE_UID, tokenData: 2, isChange: false },
  );

  // Mock cleanup
  spyReset.mockClear();
  spyOutput.mockClear();

  // P2SH
  proposal.addOutput(HATHOR_TOKEN_CONFIG.uid, 456, ADDR4, { isChange: true });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toBeCalledWith(
    456,
    scriptFromAddressP2SH(ADDR4),
    { token: HATHOR_TOKEN_CONFIG.uid, tokenData: 0, isChange: true },
  );

  // Remove mocks
  spyReset.mockRestore();
  spyOutput.mockRestore();
});

test('resetSignatures', async () => {
  const proposal = new PartialTxProposal(testnet);
  proposal.signatures = new PartialTxInputData('a-hash', 1);
  proposal.transaction = new Transaction();

  proposal.resetSignatures();
  expect(proposal.signatures).toEqual(null);
  expect(proposal.transaction).toEqual(null);
});

test('prepareTx', async () => {
  let proposal = new PartialTxProposal(testnet);
  proposal.signatures = new PartialTxInputData('a-hash', 0);

  // Returns a transaction instance
  expect(proposal.prepareTx()).toBeInstanceOf(Transaction);

  proposal = new PartialTxProposal(testnet);
  proposal.signatures = new PartialTxInputData('another-hash', 0);
  // If the transaction already exists, it will return it
  const transaction = new Transaction();
  proposal.transaction = transaction;
  expect(proposal.prepareTx()).toBe(transaction);
});

test('calculateBalance', async () => {
  const ADDR_OTHER = 'wca2xk9S2MVn2UrKh78UScdwXz3xrTp8Ky';
  const fakeUid2 = 'c84ea394b7f2b841fe6228f93be6596aa9787a922513a3a3e572813957cb0b7d';
  const fakeUid3 = 'b4254615622c1add9fdbc3ac661463ce2e42ca8feec2b5e3651cccea7c117e9c';
  const fakeUid4 = 'a75c2c1a3cfe724fd3ca8a6542ac0a03b857139b3962a2fce5d79040e21b2930';
  const timelock = dateFormatter.dateToTimestamp(new Date()) + 9999;
  const partialTx = createPartialTx([
    new ProposalInput(FAKE_TXID, 0, 2, ADDR1, { token: FAKE_UID }),
    new ProposalInput(FAKE_TXID, 1, 4, ADDR2, { token: fakeUid3 }),
    new ProposalInput(FAKE_TXID, 2, 7, ADDR3),
    new ProposalInput(FAKE_TXID, 3, 3, ADDR1),
    // Authority
    new ProposalInput(FAKE_TXID, 4, TOKEN_MELT_MASK, ADDR2, { token: fakeUid3, tokenData: 1 | TOKEN_AUTHORITY_MASK }),
    new ProposalInput(FAKE_TXID, 5, TOKEN_MELT_MASK, ADDR3, { token: fakeUid3, tokenData: 1 | TOKEN_AUTHORITY_MASK }),
    // Not from the wallet
    new ProposalInput(FAKE_TXID, 6, 4, ADDR_OTHER, { token: fakeUid3 }),
    new ProposalInput(FAKE_TXID, 7, 999, ADDR_OTHER, { token: fakeUid4 }),
    new ProposalInput(FAKE_TXID, 8, TOKEN_MINT_MASK, ADDR_OTHER, { token: fakeUid3, tokenData: 1 | TOKEN_AUTHORITY_MASK }),
  ], [
    new ProposalOutput(5, scriptFromAddressP2PKH(ADDR1), { token: FAKE_UID }),
    new ProposalOutput(8, scriptFromAddressP2PKH(ADDR2), { token: fakeUid2 }),
    new ProposalOutput(7, scriptFromAddressP2PKH(ADDR3), { token: fakeUid2 }),
    // Locked
    new ProposalOutput(1, scriptFromAddressP2PKH(ADDR1, timelock)),
    new ProposalOutput(1, scriptFromAddressP2PKH(ADDR2, timelock)),
    new ProposalOutput(3, scriptFromAddressP2PKH(ADDR3, timelock), { token: FAKE_UID }),
    new ProposalOutput(4, scriptFromAddressP2PKH(ADDR1, timelock), { token: fakeUid2 }),
    // Authority
    new ProposalOutput(TOKEN_MINT_MASK, scriptFromAddressP2PKH(ADDR2), { token: FAKE_UID, tokenData: 1 | TOKEN_AUTHORITY_MASK }),
    // Authority locked
    new ProposalOutput(TOKEN_MELT_MASK, scriptFromAddressP2PKH(ADDR3, timelock), { token: fakeUid2, tokenData: 1 | TOKEN_AUTHORITY_MASK }),
    new ProposalOutput(TOKEN_MINT_MASK, scriptFromAddressP2PKH(ADDR1, timelock), { token: fakeUid3, tokenData: 1 | TOKEN_AUTHORITY_MASK }),
    // Not from the wallet
    new ProposalOutput(10, scriptFromAddressP2PKH(ADDR_OTHER)),
    new ProposalOutput(TOKEN_MELT_MASK, scriptFromAddressP2PKH(ADDR_OTHER), { token: fakeUid2, tokenData: 1 | TOKEN_AUTHORITY_MASK }),
  ]);
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
    [HATHOR_TOKEN_CONFIG.uid]: {
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

  const hwallet = fakeHathorWallet({
    isAddressMine: jest.fn(base58 => {
      switch (base58) {
        case ADDR1:
        case ADDR2:
        case ADDR3:
          return true;
        default:
          return false;
      }
    }),
  });

  const proposal = new PartialTxProposal(testnet);
  proposal.partialTx = partialTx;
  expect(proposal.calculateBalance(hwallet)).toEqual(expected);
});
