/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { PartialTx, PartialTxInputData, ProposalInput, ProposalOutput } from '../../src/models/partial_tx';
import Network from '../../src/models/network';
import Address from '../../src/models/address';
import dateFormatter from '../../src/date';


import { UnsupportedScriptError } from '../../src/errors';
import { HATHOR_TOKEN_CONFIG, DEFAULT_TX_VERSION } from '../../src/constants';
import helpers from '../../src/utils/helpers';
import txApi from '../../src/api/txApi';
import P2PKH from '../../src/models/p2pkh';


describe('PartialTx.getTxData', () => {
  const testnet = new Network('testnet');
  const spyInput = jest.spyOn(ProposalInput.prototype, 'toData');
  const spyOutput = jest.spyOn(ProposalOutput.prototype, 'toData');

  afterEach(() => {
    // Reset mocks
    spyInput.mockReset();
    spyOutput.mockReset();
  });

  afterAll(() => {
    // Clear mocks
    spyInput.mockRestore();
    spyOutput.mockRestore();
  });

  it('should support only P2SH and P2PKH', () => {
    const customScript = Buffer.from('data output script');
    const partialTx = new PartialTx(testnet);
    partialTx.outputs.push(new ProposalOutput(1, customScript, HATHOR_TOKEN_CONFIG.uid, false));

    expect(() => partialTx.getTxData()).toThrow(UnsupportedScriptError);
  });

  it('should have all fields of a complete tx data.', () => {
    const partialTx = new PartialTx(testnet);
    const data = partialTx.getTxData();

    expect(data.inputs).toBeDefined();
    expect(data.inputs).toHaveLength(0);
    expect(data.outputs).toBeDefined();
    expect(data.outputs).toHaveLength(0);
    expect(data.tokens).toBeDefined();
    expect(data.timestamp).toBeDefined();
    expect(data.weight).toBe(0);
    expect(data.nonce).toBe(0);
    expect(data.version).toBe(DEFAULT_TX_VERSION);
  });

  it('should map inputs and outputs to data.', () => {
    let i = 0, o = 10;
    spyInput.mockImplementation(() => i++); // 0, 1, 2, 3, 4
    spyOutput.mockImplementation(() => o--); // 10, 9, 8

    const partialTx = new PartialTx(testnet);
    partialTx.inputs = Array(5).fill(new ProposalInput('hash', 1, '00', 1, 'W...'));
    partialTx.outputs = Array(3).fill(new ProposalOutput(1, Buffer.from([]), '00', false));

    const data = partialTx.getTxData();

    // Expect that toData has been called correctly for both inputs and outputs
    expect(spyInput).toHaveBeenCalledTimes(5);
    expect(spyOutput).toHaveBeenCalledTimes(3);
    expect(data.inputs).toEqual([0, 1, 2, 3, 4]);
    expect(data.outputs).toEqual([10, 9, 8]);
  });
});


describe('PartialTx.getTx', () => {
  const testnet = new Network('testnet');
  const spyHelper = jest.spyOn(helpers, 'createTxFromData');
  const spyData = jest.spyOn(PartialTx.prototype, 'getTxData');

  afterEach(() => {
    // Reset mocks
    spyHelper.mockReset();
    spyData.mockReset();
  });

  afterAll(() => {
    // Clear mocks
    spyHelper.mockRestore();
    spyData.mockRestore();
  });

  it('should map inputs and outputs to data.', () => {
    spyHelper.mockImplementation(() => 'txResult');
    spyData.mockImplementation(() => 'getTxDataResult');

    const partialTx = new PartialTx(testnet);
    const tx = partialTx.getTx();

    expect(tx).toBe('txResult');
    expect(spyData).toHaveBeenCalled();
    expect(spyHelper).toHaveBeenCalledWith('getTxDataResult', testnet);
  });
});


describe('PartialTx.isComplete', () => {
  const testnet = new Network('testnet');

  it('should return false for incorrect token balance.', () => {
    const partialTx = new PartialTx(testnet);

    partialTx.inputs = [
      new ProposalInput('hash1', 0, '00', 100, 'W...'),
      new ProposalInput('hash2', 0, '1', 1, 'W...'),
      new ProposalInput('hash3', 0, '2', 2, 'W...'),
    ]
    partialTx.outputs = [
      new ProposalOutput(100, Buffer.from([]), '00', false),
      new ProposalOutput(1, Buffer.from([]), '1', false),
    ]

    // Missing token from outputs
    expect(partialTx.isComplete()).toBe(false);

    // Outputs have less than inputs for 1 token
    partialTx.outputs.push(new ProposalOutput(1, Buffer.from([]), '2', false));
    expect(partialTx.isComplete()).toBe(false);

    // Outputs have more than inputs for 1 token
    partialTx.outputs.push(new ProposalOutput(2, Buffer.from([]), '2', false));
    expect(partialTx.isComplete()).toBe(false);

    // Missing token from inputs
    partialTx.inputs = partialTx.inputs.slice(0, 2);
    expect(partialTx.isComplete()).toBe(false);
  });

  it('should return true when balance is correct for all tokens', () => {
    const partialTx = new PartialTx(testnet);

    partialTx.inputs = [
      new ProposalInput('hash2', 0, '1', 1, 'W...'),
      new ProposalInput('hash3', 0, '2', 2, 'W...'),
      new ProposalInput('hash1', 0, '00', 3, 'W...'),
    ];
    partialTx.outputs = [
      new ProposalOutput(2, Buffer.from([]), '00', false),
      new ProposalOutput(1, Buffer.from([]), '2', false),
      new ProposalOutput(1, Buffer.from([]), '1', false),
      new ProposalOutput(1, Buffer.from([]), '00', false),
      new ProposalOutput(1, Buffer.from([]), '2', false),
    ];

    expect(partialTx.isComplete()).toBe(true);
  });
});

describe('PartialTx.addInput', () => {
  const spy = jest.spyOn(txApi, 'getTransaction');
  const testnet = new Network('testnet');

  afterEach(() => {
    // Reset mocks
    spy.mockReset();
  });

  afterAll(() => {
    // Clear mocks
    spy.mockRestore();
  });

  it('should call the getTransaction txApi', async () => {
    spy.mockImplementation(async (txId, cb) => {
      return new Promise(resolve => {
        process.nextTick(() => { resolve(); });
      });
    });

    const partialTx = new PartialTx(testnet);
    await partialTx.addInput('1', 1);

    expect(spy).toHaveBeenCalled();
  });

  it('should reject if txApi fails', async () => {
    spy.mockImplementation(async (txId, cb) => {
      return new Promise((resolve, reject) => {
        process.nextTick(() => {
          reject('txApiError');
        });
      });
    });

    const partialTx = new PartialTx(testnet);
    await expect(partialTx.addInput('1', 1)).rejects.toEqual('txApiError');
  });

  it('should add inputs', async () => {
    // fixture for txApi
    const addr = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', {network: testnet});
    const tx1 = {
      hash: '1',
      tokens: [ {uid: '1'} ],
      outputs: [
        {value: 1, token_data: 1, decoded: {address: addr.base58}},
        {value: 2, token_data: 0, decoded: {address: addr.base58}},
      ],
    };
    const tx2 = {
      hash: '2',
      tokens: [ {uid: '2'} ],
      outputs: [
        {value: 3, token_data: 0, decoded: {address: addr.base58}},
        {value: 4, token_data: 1, decoded: {address: addr.base58}},
      ],
    };
    const txs = {'1': tx1, '2': tx2};

    spy.mockImplementation(async (txId, cb) => {
      return new Promise(resolve => {
        process.nextTick(() => {
          resolve({ success: true, tx: txs[txId] });
        });
      }).then(data => { cb(data); });
    });

    const partialTx = new PartialTx(testnet);

    await partialTx.addInput('1', 0);
    expect(partialTx.inputs).toHaveLength(1);
    expect(partialTx.inputs[0].hash).toBe('1');
    expect(partialTx.inputs[0].token).toBe('1');
    expect(partialTx.inputs[0].value).toBe(1);

    await partialTx.addInput('2', 1);
    expect(partialTx.inputs).toHaveLength(2);
    expect(partialTx.inputs[1].hash).toBe('2');
    expect(partialTx.inputs[1].token).toBe('2');
    expect(partialTx.inputs[1].value).toBe(4);

    await partialTx.addInput('1', 1);
    expect(partialTx.inputs).toHaveLength(3);
    expect(partialTx.inputs[2].hash).toBe('1');
    expect(partialTx.inputs[2].token).toBe(HATHOR_TOKEN_CONFIG.uid);
    expect(partialTx.inputs[2].value).toBe(2);

    await partialTx.addInput('2', 0);
    expect(partialTx.inputs).toHaveLength(4);
    expect(partialTx.inputs[3].hash).toBe('2');
    expect(partialTx.inputs[3].token).toBe(HATHOR_TOKEN_CONFIG.uid);
    expect(partialTx.inputs[3].value).toBe(3);
  });
});


describe('PartialTx.addOutput', () => {
  const testnet = new Network('testnet');

  it('should add outputs', () => {
    const partialTx = new PartialTx(testnet);

    expect(partialTx.outputs).toHaveLength(0);

    partialTx.addOutput(27, Buffer.from([230, 148, 32]), '1', true);
    expect(partialTx.outputs).toHaveLength(1);
    expect(partialTx.outputs[0].token).toBe('1');
    expect(partialTx.outputs[0].isChange).toBe(true);
    expect(partialTx.outputs[0].value).toBe(27);
    expect(partialTx.outputs[0].script.toString('hex')).toBe(Buffer.from([230, 148, 32]).toString('hex'));
    // Since the tokens array has not been formed, the default value 0 is kept
    expect(partialTx.outputs[0].tokenData).toBe(0);

    partialTx.addOutput(72, Buffer.from([1, 2, 3]), '2', false);
    expect(partialTx.outputs).toHaveLength(2);
    expect(partialTx.outputs[1].token).toBe('2');
    expect(partialTx.outputs[1].isChange).toBe(false);
    expect(partialTx.outputs[1].value).toBe(72);
    expect(partialTx.outputs[1].script.toString('hex')).toBe(Buffer.from([1, 2, 3]).toString('hex'));
    expect(partialTx.outputs[0].tokenData).toBe(0);
  });
});

describe('PartialTx serialization', () => {
  const spyDate = jest.spyOn(dateFormatter, 'dateToTimestamp').mockImplementation((date) => 1);
  const testnet = new Network('testnet');

  afterAll(() => {
    // Clear mocks
    spyDate.mockRestore();
  });

  const testTokenConfig = {name: 'Test Token', symbol: 'TST', uid: '0000389deaf5557642e5a8a26656dcf360b608160f43e7ef79b9bde8ab69a18c'};
  const txData = {
    hash: '0000e0f6b20a6578eb41d7846ed9aaeab82a405a7dc9106c2954551fa777568f',
    tokens: [ testTokenConfig.uid ],
    inputs: [
      {index: 0, tx_id: '00000d906babfa76b092f0088530a85f4d6bae5437304820f4c7a39540d87dd0'},
      {index: 4, tx_id: '0000584ed8ad32b00e79e1c5cf26b5969ca7cd4d93ae39b776e71cfecf7c8c78'},
    ],
    outputs: [
      {type: 'p2pkh', value: 15, tokenData: 0, address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'},
      {type: 'p2pkh', value: 13, tokenData: 1, address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp'},
      {type: 'p2pkh', value: 12, tokenData: 0, address: 'WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi'},
    ],
    version: DEFAULT_TX_VERSION,
    weight: 0,
    timestamp: dateFormatter.dateToTimestamp(new Date()),
  };
  const scriptFromAddressP2PKH = (base58Addr) => {
    const p2pkh = new P2PKH(new Address(base58Addr, { network: testnet }));
    return p2pkh.createScript();
  };

  it('should serialize a transaction correctly', async () => {

    const expected = 'PartialTx|00010102030000389deaf5557642e5a8a26656dcf360b608160f43e7ef79b9bde8ab69a18c00000d906babfa76b092f0088530a85f4d6bae5437304820f4c7a39540d87dd00000000000584ed8ad32b00e79e1c5cf26b5969ca7cd4d93ae39b776e71cfecf7c8c780400000000000f00001976a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac0000000d01001976a9146861143f7dc6b2f9c8525315efe6fcda160a795c88ac0000000c00001976a914486bc4f1e70f242a737d3866147c7f8335c2995f88ac0000000000000000000000010000000000|1|2';

    const tx = helpers.createTxFromData(txData, testnet);

    const partialTx = new PartialTx(testnet);
    partialTx.inputs = [
      new ProposalInput('00000d906babfa76b092f0088530a85f4d6bae5437304820f4c7a39540d87dd0', 0, HATHOR_TOKEN_CONFIG.uid, 27, 'WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi'),
      new ProposalInput('0000584ed8ad32b00e79e1c5cf26b5969ca7cd4d93ae39b776e71cfecf7c8c78', 4, testTokenConfig.uid, 13, 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'),
    ]
    partialTx.outputs = [
      new ProposalOutput(15, scriptFromAddressP2PKH('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo'), HATHOR_TOKEN_CONFIG.uid, false),
      new ProposalOutput(13, scriptFromAddressP2PKH('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp'), testTokenConfig.uid, true),
      new ProposalOutput(12, scriptFromAddressP2PKH('WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi'), HATHOR_TOKEN_CONFIG.uid, true),
    ];

    const serialized = partialTx.serialize();
    expect(serialized).toBe(expected);
    const parts = serialized.split('|');
    expect(parts[0]).toBe('PartialTx');
    expect(parts[1]).toBe(tx.toHex());
  });
});
