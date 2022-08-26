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
import Address from '../../src/models/address';
import HathorWallet from '../../src/new/wallet';
import wallet from '../../src/wallet';
import {
  ProposalInput,
  ProposalOutput,
  PartialTxPrefix,
  PartialTx,
  PartialTxInputDataPrefix,
  PartialTxInputData,
} from '../../src/models/partial_tx';

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
// c84ea394b7f2b841fe6228f93be6596aa9787a922513a3a3e572813957cb0b7d
const testnet = new Network('testnet');
const createPartialTx = (inputs, outputs) => {
  const partialTx = new PartialTx(testnet);
  partialTx.inputs = inputs;
  partialTx.outputs = outputs;
  return partialTx;
};
const scriptFromAddress = base58 => {
  const p2pkh = new P2PKH(new Address(base58, { network: testnet }));
  return p2pkh.createScript();
};

test('fromPartialTx', async () => {
  const partialTx = createPartialTx([
    new ProposalInput(FAKE_TXID, 0, 10, ADDR1),
  ], [
    new ProposalOutput(5, scriptFromAddress(ADDR2)),
    new ProposalOutput(10, scriptFromAddress(ADDR3), { token: FAKE_UID, tokenData: 1 }),
  ]);

  const serialized = partialTx.serialize();
  const proposal = PartialTxProposal.fromPartialTx(serialized, testnet);

  expect(proposal.partialTx.serialize()).toEqual(serialized);

  expect(proposal.partialTx).toMatchObject({
    inputs: [expect.objectContaining({ hash: FAKE_TXID, index: 0, value: 10, address: ADDR1 })],
    outputs: [
      expect.objectContaining({ value: 5, token: '00' }),
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

  proposal.addReceive(hwallet, '00', 180, { address: ADDR2 });
  expect(spyReset).toHaveBeenCalledTimes(1);
  expect(spyOutput).toBeCalledWith(
    '00',
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
  expect(hwallet.markUtxoSelected).toBeCalledWith(FAKE_TXID, 5);
  expect(spyInput).toBeCalledWith(FAKE_TXID, 5, 999, ADDR1, { token: '00', tokenData: 0 });

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
  expect(hwallet.markUtxoSelected).not.toHaveBeenCalled();
  expect(spyInput).toBeCalledWith(FAKE_TXID, 20, 70, ADDR2, { token: FAKE_UID, tokenData: 123 });

  // Remove mocks
  spyReset.mockRestore();
  spyInput.mockRestore();
});
