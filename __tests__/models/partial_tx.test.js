/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  PartialTx,
  PartialTxInputData,
  ProposalInput,
  ProposalOutput,
} from '../../src/models/partial_tx';
import Network from '../../src/models/network';
import Address from '../../src/models/address';
import dateFormatter from '../../src/utils/date';

import { UnsupportedScriptError } from '../../src/errors';
import {
  HATHOR_TOKEN_CONFIG,
  DEFAULT_TX_VERSION,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
} from '../../src/constants';
import helpers from '../../src/utils/helpers';
import txApi from '../../src/api/txApi';
import P2PKH from '../../src/models/p2pkh';
import transaction from '../../src/utils/transaction';

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
    partialTx.outputs.push(new ProposalOutput(1, customScript, { token: HATHOR_TOKEN_CONFIG.uid }));

    expect(() => partialTx.getTxData()).toThrow(UnsupportedScriptError);
  });

  it('should have all fields of a complete tx data.', () => {
    const partialTx = new PartialTx(testnet);
    const data = partialTx.getTxData();

    expect(data).toEqual(
      expect.objectContaining({
        inputs: [],
        outputs: [],
        tokens: [],
        version: DEFAULT_TX_VERSION,
      })
    );
  });

  it('should map inputs and outputs to data.', () => {
    let i = 0,
      o = 10;
    spyInput.mockImplementation(() => i++); // 0, 1, 2, 3, 4
    spyOutput.mockImplementation(() => o--); // 10, 9, 8

    const partialTx = new PartialTx(testnet);
    partialTx.inputs = Array(5).fill(new ProposalInput('hash', 1, 1, 'W...'));
    partialTx.outputs = Array(3).fill(new ProposalOutput(1, Buffer.from([])));

    const data = partialTx.getTxData();

    // Expect that toData has been called correctly for both inputs and outputs
    expect(spyInput).toHaveBeenCalledTimes(5);
    expect(spyOutput).toHaveBeenCalledTimes(3);

    expect(data).toEqual(
      expect.objectContaining({
        inputs: [0, 1, 2, 3, 4],
        outputs: [10, 9, 8],
      })
    );
  });
});

describe('PartialTx.getTx', () => {
  const testnet = new Network('testnet');
  const spyCreateTx = jest.spyOn(transaction, 'createTransactionFromData');
  const spyData = jest.spyOn(PartialTx.prototype, 'getTxData');

  afterEach(() => {
    // Reset mocks
    spyCreateTx.mockReset();
    spyData.mockReset();
  });

  afterAll(() => {
    // Clear mocks
    spyCreateTx.mockRestore();
    spyData.mockRestore();
  });

  it('should map inputs and outputs to data.', () => {
    spyCreateTx.mockImplementation(() => 'txResult');
    spyData.mockImplementation(() => 'getTxDataResult');

    const partialTx = new PartialTx(testnet);
    const tx = partialTx.getTx();

    expect(tx).toBe('txResult');
    expect(spyData).toHaveBeenCalled();
    expect(spyCreateTx).toHaveBeenCalledWith('getTxDataResult', testnet);
  });
});

describe('PartialTx.isComplete', () => {
  const testnet = new Network('testnet');

  it('should return false for incorrect token balance.', () => {
    const partialTx = new PartialTx(testnet);

    partialTx.inputs = [
      new ProposalInput('hash1', 0, 100, 'W'),
      new ProposalInput('hash2', 0, 1, 'W', { token: '1' }),
      new ProposalInput('hash3', 0, 2, 'W', { token: '2' }),
    ];
    partialTx.outputs = [
      new ProposalOutput(100, Buffer.from([])),
      new ProposalOutput(1, Buffer.from([]), { token: '1' }),
    ];

    // Missing token from outputs
    expect(partialTx.isComplete()).toBe(false);

    // Outputs have less than inputs for 1 token
    partialTx.outputs.push(new ProposalOutput(1, Buffer.from([]), { token: '1' }));
    expect(partialTx.isComplete()).toBe(false);

    // Outputs have more than inputs for 1 token
    partialTx.outputs.push(new ProposalOutput(2, Buffer.from([]), { token: '2' }));
    expect(partialTx.isComplete()).toBe(false);

    // Missing token from inputs
    partialTx.inputs = partialTx.inputs.slice(0, 2);
    expect(partialTx.isComplete()).toBe(false);
  });

  it('should return true when balance is correct for all tokens', () => {
    const partialTx = new PartialTx(testnet);

    partialTx.inputs = [
      new ProposalInput('hash1', 0, 1, 'W123', { token: '1' }),
      new ProposalInput('hash2', 0, 2, 'W123', { token: '2' }),
      new ProposalInput('hash3', 0, 3, 'W123'),
    ];
    partialTx.outputs = [
      new ProposalOutput(2, Buffer.from([])),
      new ProposalOutput(1, Buffer.from([]), { token: '2' }),
      new ProposalOutput(1, Buffer.from([]), { token: '1' }),
      new ProposalOutput(1, Buffer.from([])),
      new ProposalOutput(1, Buffer.from([]), { token: '2' }),
    ];

    expect(partialTx.isComplete()).toBe(true);
  });

  it('should ignore authority', () => {
    const partialTx = new PartialTx(testnet);

    partialTx.inputs = [
      new ProposalInput('hash1', 0, 1, 'W123', { token: '1' }),
      new ProposalInput('hash2', 0, 2, 'W123', { token: '2' }),
      new ProposalInput('hash3', 0, 3, 'W123'),
    ];
    partialTx.outputs = [
      new ProposalOutput(2, Buffer.from([])),
      new ProposalOutput(1, Buffer.from([]), { token: '2' }),
      new ProposalOutput(1, Buffer.from([]), { token: '1' }),
      new ProposalOutput(1, Buffer.from([])),
      new ProposalOutput(1, Buffer.from([]), { token: '2' }),
      // Add authority output for token 2
      new ProposalOutput(1, Buffer.from([]), { token: '2', authorities: TOKEN_MINT_MASK }),
    ];

    expect(partialTx.isComplete()).toBe(true);
  });
});

describe('PartialTx.addInput', () => {
  const testnet = new Network('testnet');

  it('should add inputs', () => {
    const partialTx = new PartialTx(testnet);
    const expected = [];

    // Passing all optional arguments
    expected.push(
      expect.objectContaining({
        hash: 'hash1',
        index: 0,
        token: '1',
        authorities: 0,
        value: 1,
        address: 'W123',
      })
    );
    partialTx.addInput('hash1', 0, 1, 'W123', { token: '1', authorities: 0 });
    expect(partialTx.inputs).toEqual(expected);

    // Default options, HTR
    expected.push(
      expect.objectContaining({
        hash: 'hash2',
        index: 1,
        token: '00',
        authorities: 0,
        value: 27,
        address: 'Wabc',
      })
    );
    partialTx.addInput('hash2', 1, 27, 'Wabc');
    expect(partialTx.inputs).toEqual(expected);

    // Authority input
    expected.push(
      expect.objectContaining({
        hash: 'hash3',
        index: 10,
        token: '1',
        authorities: TOKEN_MINT_MASK | TOKEN_MELT_MASK,
        value: 1056,
        address: 'W1b3',
      })
    );
    partialTx.addInput('hash3', 10, 1056, 'W1b3', {
      token: '1',
      authorities: TOKEN_MINT_MASK | TOKEN_MELT_MASK,
    });
    expect(partialTx.inputs).toEqual(expected);
  });
});

describe('PartialTx.addOutput', () => {
  const testnet = new Network('testnet');

  it('should add outputs', () => {
    const partialTx = new PartialTx(testnet);

    expect(partialTx.outputs).toHaveLength(0);
    const expected = [];

    expected.push(
      expect.objectContaining({
        token: '1',
        isChange: true,
        value: 27,
        script: expect.toMatchBuffer(Buffer.from([230, 148, 32])),
        authorities: TOKEN_MELT_MASK,
      })
    );
    partialTx.addOutput(27, Buffer.from([230, 148, 32]), {
      token: '1',
      authorities: TOKEN_MELT_MASK,
      isChange: true,
    });
    expect(partialTx.outputs).toEqual(expected);

    expected.push(
      expect.objectContaining({
        token: '2',
        isChange: false,
        value: 72,
        script: expect.toMatchBuffer(Buffer.from([1, 2, 3])),
        authorities: 0,
      })
    );
    partialTx.addOutput(72, Buffer.from([1, 2, 3]), { token: '2' });
    expect(partialTx.outputs).toEqual(expected);
  });
});

describe('PartialTx serialization', () => {
  const spyDate = jest.spyOn(dateFormatter, 'dateToTimestamp').mockImplementation(date => 1);
  const testnet = new Network('testnet');

  afterAll(() => {
    // Clear mocks
    spyDate.mockRestore();
  });

  const testTokenConfig = {
    name: 'Test Token',
    symbol: 'TST',
    uid: '0000389deaf5557642e5a8a26656dcf360b608160f43e7ef79b9bde8ab69a18c',
  };
  const txId1 = '00000d906babfa76b092f0088530a85f4d6bae5437304820f4c7a39540d87dd0';
  const txId2 = '0000584ed8ad32b00e79e1c5cf26b5969ca7cd4d93ae39b776e71cfecf7c8c78';
  const scriptFromAddressP2PKH = base58Addr => {
    const p2pkh = new P2PKH(new Address(base58Addr, { network: testnet }));
    return p2pkh.createScript();
  };

  it('should serialize a transaction correctly', async () => {
    const expected =
      'PartialTx|00010102030000389deaf5557642e5a8a26656dcf360b608160f43e7ef79b9bde8ab69a18c00000d906babfa76b092f0088530a85f4d6bae5437304820f4c7a39540d87dd00000000000584ed8ad32b00e79e1c5cf26b5969ca7cd4d93ae39b776e71cfecf7c8c780400000000000f00001976a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac0000000d01001976a9146861143f7dc6b2f9c8525315efe6fcda160a795c88ac0000000c00001976a914486bc4f1e70f242a737d3866147c7f8335c2995f88ac0000000000000000000000000000000000|WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi,00,0,1b:WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi,0000389deaf5557642e5a8a26656dcf360b608160f43e7ef79b9bde8ab69a18c,0,d|1:2';

    const partialTx = new PartialTx(testnet);

    const address = 'WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi';
    partialTx.inputs = [
      new ProposalInput(txId1, 0, 27, address, { token: HATHOR_TOKEN_CONFIG.uid }),
      new ProposalInput(txId2, 4, 13, address, { token: testTokenConfig.uid }),
    ];
    partialTx.outputs = [
      new ProposalOutput(15, scriptFromAddressP2PKH('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo')),
      new ProposalOutput(13, scriptFromAddressP2PKH('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp'), {
        token: testTokenConfig.uid,
        isChange: true,
      }),
      new ProposalOutput(12, scriptFromAddressP2PKH('WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi'), {
        isChange: true,
      }),
    ];

    const serialized = partialTx.serialize();
    expect(serialized).toBe(expected);
  });

  it('should deserialize a transaction correctly', () => {
    const serialized =
      'PartialTx|00010102030000389deaf5557642e5a8a26656dcf360b608160f43e7ef79b9bde8ab69a18c00000d906babfa76b092f0088530a85f4d6bae5437304820f4c7a39540d87dd00000000000584ed8ad32b00e79e1c5cf26b5969ca7cd4d93ae39b776e71cfecf7c8c780400000000000f00001976a914729181c0f3f2e3f589cc10facbb9332e0c309a7788ac0000000d01001976a9146861143f7dc6b2f9c8525315efe6fcda160a795c88ac0000000c00001976a914486bc4f1e70f242a737d3866147c7f8335c2995f88ac0000000000000000000000000000000000|WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi,00,0,1b:WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi,0000389deaf5557642e5a8a26656dcf360b608160f43e7ef79b9bde8ab69a18c,0,d|1:2';
    const partialTx = PartialTx.deserialize(serialized, testnet);
    expect(partialTx.serialize()).toBe(serialized);
  });

  it('should deserialize the serialize output', async () => {
    const address = 'WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi';
    const partialTx = new PartialTx(testnet);

    const partialEmpty = PartialTx.deserialize(partialTx.serialize(), testnet);
    expect(partialEmpty.serialize()).toEqual(partialTx.serialize());

    partialTx.inputs = [
      new ProposalInput(txId1, 0, 27, address, { token: HATHOR_TOKEN_CONFIG.uid }),
      new ProposalInput(txId2, 4, 13, address, { token: testTokenConfig.uid }),
    ];
    const partialOnlyInputs = PartialTx.deserialize(partialTx.serialize(), testnet);
    expect(partialOnlyInputs.serialize()).toEqual(partialTx.serialize());

    partialTx.inputs = [];
    partialTx.outputs = [
      new ProposalOutput(15, scriptFromAddressP2PKH('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo')),
      new ProposalOutput(13, scriptFromAddressP2PKH('WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp'), {
        token: testTokenConfig.uid,
        isChange: true,
      }),
      new ProposalOutput(12, scriptFromAddressP2PKH('WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi'), {
        isChange: true,
      }),
    ];
    const partialOnlyOutputs = PartialTx.deserialize(partialTx.serialize(), testnet);
    expect(partialOnlyOutputs.serialize()).toEqual(partialTx.serialize());

    partialTx.inputs = [
      new ProposalInput(txId1, 0, 27, address, { token: HATHOR_TOKEN_CONFIG.uid }),
      new ProposalInput(txId2, 4, 13, address, { token: testTokenConfig.uid }),
    ];
    const partialFull = PartialTx.deserialize(partialTx.serialize(), testnet);
    expect(partialFull.serialize()).toEqual(partialTx.serialize());
  });
});

describe('PartialTx.validate', () => {
  const spy = jest.spyOn(txApi, 'getTransaction');
  const testnet = new Network('testnet');
  // fixtures for txApi
  const testTokenConfig = {
    name: 'Test Token',
    symbol: 'TST',
    uid: '0000389deaf5557642e5a8a26656dcf360b608160f43e7ef79b9bde8ab69a18c',
  };
  const txId1 = '00000d906babfa76b092f0088530a85f4d6bae5437304820f4c7a39540d87dd0';
  const txId2 = '0000584ed8ad32b00e79e1c5cf26b5969ca7cd4d93ae39b776e71cfecf7c8c78';
  const addr1 = 'WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi';
  const addr2 = 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo';

  const utxos = {
    [txId1]: {
      outputs: [{ token_data: 0, value: 27, decoded: { address: addr1 } }],
    },
    [txId2]: {
      tokens: [testTokenConfig],
      outputs: [
        'fake-utxo0',
        'fake-utxo1',
        'fake-utxo2',
        'fake-utxo3',
        { token_data: 1, value: 13, decoded: { address: addr2 } },
      ],
    },
  };

  const scriptFromAddressP2PKH = base58Addr => {
    const p2pkh = new P2PKH(new Address(base58Addr, { network: testnet }));
    return p2pkh.createScript();
  };

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
        process.nextTick(() => {
          resolve({ success: true, tx: utxos[txId] });
        });
      }).then(data => {
        cb(data);
      });
    });

    const partialTx = new PartialTx(testnet);
    partialTx.inputs = [new ProposalInput(txId1, 0, 27, addr1)];
    await partialTx.validate();

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
    partialTx.inputs = [new ProposalInput(txId1, 0, 27, addr1)];
    await expect(partialTx.validate()).rejects.toEqual('txApiError');
  });

  it('should validate all inputs', async () => {
    spy.mockImplementation(async (txId, cb) => {
      return new Promise(resolve => {
        process.nextTick(() => {
          resolve({ success: true, tx: utxos[txId] });
        });
      }).then(data => {
        cb(data);
      });
    });

    const partialTx = new PartialTx(testnet);
    partialTx.inputs = [
      new ProposalInput(txId1, 0, 27, addr1),
      new ProposalInput(txId2, 4, 13, addr2, { token: testTokenConfig.uid }),
    ];
    partialTx.outputs = [
      new ProposalOutput(15, scriptFromAddressP2PKH(addr2)),
      new ProposalOutput(13, scriptFromAddressP2PKH(addr2), {
        token: testTokenConfig.uid,
        isChange: true,
      }),
      new ProposalOutput(12, scriptFromAddressP2PKH(addr1), { isChange: true }),
    ];

    await expect(partialTx.validate()).resolves.toEqual(true);
  });

  it('should return false if an address, value, token or authorities are wrong', async () => {
    spy.mockImplementation(async (txId, cb) => {
      return new Promise(resolve => {
        process.nextTick(() => {
          resolve({ success: true, tx: utxos[txId] });
        });
      }).then(data => {
        cb(data);
      });
    });

    const partialTx = new PartialTx(testnet);
    // Address of inputs[1] is wrong
    partialTx.inputs = [
      new ProposalInput(txId1, 0, 27, addr1),
      new ProposalInput(txId2, 4, 13, addr1, { token: testTokenConfig.uid }),
    ];
    partialTx.outputs = [
      new ProposalOutput(15, scriptFromAddressP2PKH(addr2)),
      new ProposalOutput(13, scriptFromAddressP2PKH(addr2), {
        token: testTokenConfig.uid,
        isChange: true,
      }),
      new ProposalOutput(12, scriptFromAddressP2PKH(addr1), { isChange: true }),
    ];

    await expect(partialTx.validate()).resolves.toEqual(false);

    // Value of inputs[0] is wrong
    partialTx.inputs = [
      new ProposalInput(txId1, 0, 28, addr1),
      new ProposalInput(txId2, 4, 13, addr2, { token: testTokenConfig.uid }),
    ];

    await expect(partialTx.validate()).resolves.toEqual(false);

    // TokenData of inputs[1] is wrong
    partialTx.inputs = [
      new ProposalInput(txId1, 0, 27, addr1),
      new ProposalInput(txId2, 4, 13, addr2, {
        token: testTokenConfig.uid,
        authorities: TOKEN_MELT_MASK,
      }),
    ];

    await expect(partialTx.validate()).resolves.toEqual(false);

    // Token of inputs[0] is wrong
    partialTx.inputs = [
      new ProposalInput(txId1, 0, 27, addr1, { token: testTokenConfig }),
      new ProposalInput(txId2, 4, 13, addr2, { token: testTokenConfig.uid }),
    ];

    await expect(partialTx.validate()).resolves.toEqual(false);
  });
});
