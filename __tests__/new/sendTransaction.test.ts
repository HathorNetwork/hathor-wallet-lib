/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey, PrivateKey } from 'bitcore-lib';
import {
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
  FEE_PER_OUTPUT,
  MAX_SHIELDED_OUTPUTS,
  NATIVE_TOKEN_UID,
  TOKEN_AUTHORITY_MASK,
} from '../../src/constants';
import Network from '../../src/models/network';
import Address from '../../src/models/address';
import SendTransaction, {
  isDataOutput,
  checkUnspentInput,
  convertHtrChangeIfRequested,
  prepareSendTokensData,
} from '../../src/new/sendTransaction';
import { IShieldedCryptoProvider, OutputKind, ShieldedOutputMode } from '../../src/shielded/types';
import { MemoryStore, Storage } from '../../src/storage';
import {
  IDataInput,
  IHistoryTx,
  IStorage,
  IUtxo,
  IUtxoFilterOptions,
  TokenVersion,
  WalletType,
} from '../../src/types';
import FeeHeader from '../../src/headers/fee';
import { Fee } from '../../src/utils/fee';
import walletHelpers from '../../src/utils/helpers';
import { encodeShieldedAddress } from '../../src/utils/shieldedAddress';
import transaction from '../../src/utils/transaction';
import { OutputType } from '../../src/wallet/types';
import { mockGetToken } from '../__mock_helpers__/get-token.mock';

test('prepareTxData pays a transparent output at a new-format address via its spend P2PKH', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  // Genuine curve points (encode/extract validate on-curve membership).
  const root = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x09), 'testnet');
  const network = new Network('testnet');
  const shieldedAddress = encodeShieldedAddress(
    root.deriveChild("m/0'/0").publicKey.toBuffer(),
    root.deriveChild("m/1'/0").publicKey.toBuffer(),
    network
  );

  async function* selectUtxoMock() {
    yield {
      txId: 'htr-tx',
      index: 0,
      value: 10n,
      token: NATIVE_TOKEN_UID,
      address: 'htr-addr',
      authorities: 0n,
    };
  }
  jest.spyOn(storage, 'getWalletType').mockResolvedValue(WalletType.P2PKH);
  jest.spyOn(storage, 'selectUtxos').mockImplementation(selectUtxoMock as never);

  const sendTransaction = new SendTransaction({
    storage,
    outputs: [
      {
        type: OutputType.P2PKH,
        address: shieldedAddress,
        value: 10n,
        token: NATIVE_TOKEN_UID,
      },
    ],
  });

  const result = await sendTransaction.prepareTxData();

  // The new address format serves transparent outputs too: the output is paid
  // to the address's embedded spend-derived P2PKH.
  const expected = new Address(shieldedAddress, { network }).getSpendAddress().base58;
  expect(result.outputs).toHaveLength(1);
  expect(result.outputs[0].address).toBe(expected);
  expect(result.shieldedOutputs).toBeUndefined();
});

test('prepareTxData rejects a shieldedMode output with a non-shielded address', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  const sendTransaction = new SendTransaction({
    storage,
    outputs: [
      {
        // A transparent P2PKH address cannot carry a shielded output.
        address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ],
  });

  await expect(sendTransaction.prepareTxData()).rejects.toThrow(
    /Shielded output requires a shielded address/
  );
});

test('prepareTxData rejects an invalid shieldedMode value', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  // A genuine shielded address, so the rejection is on the mode, not the address.
  const root = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x0b), 'testnet');
  const shieldedAddress = encodeShieldedAddress(
    root.deriveChild("m/0'/0").publicKey.toBuffer(),
    root.deriveChild("m/1'/0").publicKey.toBuffer(),
    new Network('testnet')
  );

  const sendTransaction = new SendTransaction({
    storage,
    outputs: [
      {
        address: shieldedAddress,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        // Passes isShieldedOutput (the field exists) but is not an accepted
        // mode — must be rejected up front, not deep in the crypto layer.
        shieldedMode: 999 as unknown as ShieldedOutputMode,
      },
    ],
  });

  await expect(sendTransaction.prepareTxData()).rejects.toThrow(/Invalid shieldedMode/);
});

test('prepareTxData resolves 71-byte shielded addresses internally', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  // Two genuine shielded addresses (on-curve scan/spend pubkeys) passed RAW —
  // the pipeline must extract the spend-derived P2PKH + scan pubkey itself.
  const root = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x0a), 'testnet');
  const buildAddr = (i: number) =>
    encodeShieldedAddress(
      root.deriveChild(`m/0'/${i}`).publicKey.toBuffer(),
      root.deriveChild(`m/1'/${i}`).publicKey.toBuffer(),
      new Network('testnet')
    );

  async function* selectUtxoMock(options) {
    if (options.token === NATIVE_TOKEN_UID) {
      yield {
        txId: 'htr-funding-tx',
        index: 0,
        value: 100n,
        token: NATIVE_TOKEN_UID,
        address: 'htr-funding-address',
        authorities: 0n,
      };
    }
  }
  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest.spyOn(storage, 'selectUtxos').mockImplementation(selectUtxoMock);
  jest.spyOn(storage, 'getCurrentAddress').mockReturnValue(Promise.resolve('W-change-address'));
  jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

  // All HTR outputs are shielded, so the rules shield the HTR change too —
  // which needs a wallet to derive the change address from.
  const wallet = {
    storage,
    getCurrentAddress: jest.fn().mockResolvedValue({ address: buildAddr(2) }),
  } as unknown as import('../../src/new/wallet').default;

  const sendTransaction = new SendTransaction({
    storage,
    wallet,
    outputs: [
      {
        address: buildAddr(0),
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: buildAddr(1),
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ],
  });

  // Both raw 71-byte addresses must be accepted and resolved (spend P2PKH
  // phantom outputs + scan pubkeys), carrying the pipeline all the way to the
  // crypto boundary — which is the first thing this provider-less storage
  // cannot satisfy. Reaching THIS error proves the resolution worked; the old
  // API would have failed the address up front instead.
  await expect(sendTransaction.prepareTxData()).rejects.toThrow(
    /Shielded crypto provider is not set/
  );
});

test('prepareTxData does not charge FEE_PER_OUTPUT for a shielded FEE-token output', async () => {
  // Regression: the phantom pushed for UTXO selection must not reach
  // Fee.calculate — the node charges a shielded output only the shielded fee.
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  // A genuine shielded address (on-curve scan/spend pubkeys).
  const root = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x0b), 'testnet');
  const shieldedAddress = encodeShieldedAddress(
    root.deriveChild("m/0'/0").publicKey.toBuffer(),
    root.deriveChild("m/1'/0").publicKey.toBuffer(),
    new Network('testnet')
  );

  // Token '02' is a FEE-version token (mockGetToken). Fund the '02' outputs
  // exactly (20n, so there is no '02' change) and HTR for the fee.
  async function* selectUtxoMock(options) {
    if (options.token === '02') {
      yield {
        txId: 'fbt-funding-tx',
        index: 0,
        value: 20n,
        token: '02',
        address: 'fbt-funding-address',
        authorities: 0n,
      };
    } else if (options.token === NATIVE_TOKEN_UID) {
      yield {
        txId: 'htr-funding-tx',
        index: 0,
        value: 100n,
        token: NATIVE_TOKEN_UID,
        address: 'htr-funding-address',
        authorities: 0n,
      };
    }
  }
  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest.spyOn(storage, 'selectUtxos').mockImplementation(selectUtxoMock);
  jest.spyOn(storage, 'getCurrentAddress').mockReturnValue(Promise.resolve('W-change-address'));
  jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

  const sendTransaction = new SendTransaction({
    storage,
    outputs: [
      // A real TRANSPARENT FEE-token output → exactly one chargeable output.
      {
        type: OutputType.P2PKH,
        address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
        value: 10n,
        token: '02',
      },
      {
        address: shieldedAddress,
        value: 10n,
        token: '02',
        shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ],
  });

  const calcSpy = jest.spyOn(Fee, 'calculate');

  // prepareTxData reaches the fee calc, then rejects at the crypto boundary
  // (no provider) — which is enough to inspect what Fee.calculate received.
  await expect(sendTransaction.prepareTxData()).rejects.toThrow(
    /Shielded crypto provider is not set/
  );

  expect(calcSpy).toHaveBeenCalledTimes(1);
  const feeOutputs = calcSpy.mock.calls[0][1] as { token: string; address: string }[];
  // Assert WHICH output survived, not just the count: the phantom also carries
  // token '02', so a count alone passes even with the filter inverted.
  const fee02 = feeOutputs.filter(out => out.token === '02');
  expect(fee02).toHaveLength(1);
  expect(fee02[0].address).toBe('WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi');

  calcSpy.mockRestore();
});

test('prepareTxData charges the flat melt fee once when a FEE token goes entirely to shielded outputs', async () => {
  // Exercises the branch the companion test can't reach: with no transparent
  // '02' output, outputCount hits 0 and Fee.calculate falls through to the flat
  // melt fee. TWO shielded outputs deliberately — with one, the melt fee equals
  // the single FEE_PER_OUTPUT being removed, so the fee is 1n before and after.
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  const root = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x0c), 'testnet');
  const shieldedAddress = encodeShieldedAddress(
    root.deriveChild("m/0'/0").publicKey.toBuffer(),
    root.deriveChild("m/1'/0").publicKey.toBuffer(),
    new Network('testnet')
  );

  // Fund '02' exactly (20n for two 10n outputs, so there is no '02' change)
  // and HTR for the fee.
  async function* selectUtxoMock(options) {
    if (options.token === '02') {
      yield {
        txId: 'fbt-funding-tx',
        index: 0,
        value: 20n,
        token: '02',
        address: 'fbt-funding-address',
        authorities: 0n,
      };
    } else if (options.token === NATIVE_TOKEN_UID) {
      yield {
        txId: 'htr-funding-tx',
        index: 0,
        value: 100n,
        token: NATIVE_TOKEN_UID,
        address: 'htr-funding-address',
        authorities: 0n,
      };
    }
  }
  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest.spyOn(storage, 'selectUtxos').mockImplementation(selectUtxoMock);
  jest.spyOn(storage, 'getCurrentAddress').mockReturnValue(Promise.resolve('W-change-address'));
  jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

  const sendTransaction = new SendTransaction({
    storage,
    outputs: [
      {
        address: shieldedAddress,
        value: 10n,
        token: '02',
        shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddress,
        value: 10n,
        token: '02',
        shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ],
  });

  const calcSpy = jest.spyOn(Fee, 'calculate');

  await expect(sendTransaction.prepareTxData()).rejects.toThrow(
    /Shielded crypto provider is not set/
  );

  expect(calcSpy).toHaveBeenCalledTimes(1);
  const feeOutputs = calcSpy.mock.calls[0][1] as { token: string }[];
  // No transparent '02' output survives: both phantoms are filtered out.
  expect(feeOutputs.filter(out => out.token === '02')).toHaveLength(0);

  // So '02' has inputs but zero outputs -> the flat melt fee, charged ONCE.
  // Without the fix the two phantoms would be counted and this would be 2n.
  await expect(calcSpy.mock.results[0].value).resolves.toBe(FEE_PER_OUTPUT);

  calcSpy.mockRestore();
});

test('type methods', () => {
  // The ISendInput and ISendOutput were created to satisfy the old facade methods while using typescript

  /**
   * @type {ISendDataOutput}
   */
  const addrOutput = {
    type: OutputType.P2PKH,
    address: 'H-valid-address',
    value: 10n,
    token: NATIVE_TOKEN_UID,
  };

  /**
   * @type {ISendDataOutput}
   */
  const dataOutput = {
    type: OutputType.DATA,
    data: '',
  };

  expect(isDataOutput(dataOutput)).toBeTruthy();
  expect(isDataOutput(addrOutput)).toBeFalsy();
});

test('prepareTxData', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  async function* selectUtxoMock(options) {
    if (options.token === '00') {
      yield {
        txId: 'another-spent-tx-id',
        index: 0,
        value: 2n,
        token: '00',
        address: 'another-spent-utxo-address',
        authorities: 0n,
      };
    }
  }

  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest.spyOn(storage, 'selectUtxos').mockImplementation(selectUtxoMock);
  jest.spyOn(storage, 'getCurrentAddress').mockReturnValue(Promise.resolve('W-change-address'));
  jest.spyOn(storage, 'getTx').mockReturnValue(
    Promise.resolve({
      outputs: [
        {
          value: 11n,
          token: '01',
          decoded: {
            address: 'spent-utxo-address',
          },
          token_data: 1,
        },
      ],
    })
  );
  jest.spyOn(storage, 'isAddressMine').mockReturnValue(true);
  const spyGetToken = jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);
  const preparedTx = {
    validate: jest.fn(),
  };
  const prepareSpy = jest
    .spyOn(transaction, 'prepareTransaction')
    .mockReturnValue(Promise.resolve(preparedTx));

  /**
   * @type {ISendDataOutput}
   */
  const addrOutput = {
    type: OutputType.P2PKH,
    address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
    value: 10n,
    token: '01',
  };

  /**
   * @type {ISendDataOutput}
   */
  const dataOutput = {
    type: OutputType.DATA,
    data: 'abcd',
  };
  const inputs = [{ txId: 'spent-tx-id', index: 0 }];
  const outputs = [addrOutput, dataOutput];
  const sendTransaction = new SendTransaction({
    storage,
    outputs,
    inputs,
  });
  await expect(sendTransaction.prepareTxData()).resolves.toMatchObject({
    inputs: [
      {
        txId: 'spent-tx-id',
        index: 0,
        value: 11n,
        token: '01',
        address: 'spent-utxo-address',
        authorities: 0n,
      },
      {
        address: 'another-spent-utxo-address',
        authorities: 0n,
        index: 0,
        token: '00',
        txId: 'another-spent-tx-id',
        value: 2n,
      },
    ],
    // We use array containing because the order of the outputs is not guaranteed
    // If there is a change output we will shuffle the outputs
    outputs: expect.arrayContaining([
      {
        address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
        value: 10n,
        timelock: null,
        token: '01',
        authorities: 0n,
        type: 'p2pkh',
      },
      {
        type: 'data',
        data: 'abcd',
        value: 1n,
        authorities: 0n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: 'W-change-address',
        authorities: 0n,
        isChange: true,
        timelock: null,
        token: '00',
        type: 'p2pkh',
        value: 1n,
      },
      {
        address: 'W-change-address',
        authorities: 0n,
        isChange: true,
        timelock: null,
        token: '01',
        type: 'p2pkh',
        value: 1n,
      },
    ]),
    tokens: ['01'],
  });

  // prepareTx does not require a PIN (creates unsigned transaction)
  await expect(sendTransaction.prepareTx()).resolves.toBe(preparedTx);

  // signTx requires a PIN
  await expect(sendTransaction.signTx()).rejects.toThrow('Pin is not set.');
  sendTransaction.pin = '000000';

  prepareSpy.mockRestore();
  spyGetToken.mockRestore();
});

test('prepareTxData keeps the data output payload bytes in the output script', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  async function* selectUtxoMock() {
    yield {
      txId: 'spent-tx-id',
      index: 0,
      value: 1n,
      token: NATIVE_TOKEN_UID,
      address: 'spent-utxo-address',
      authorities: 0n,
    };
  }

  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest.spyOn(storage, 'selectUtxos').mockImplementation(selectUtxoMock);

  const sendTransaction = new SendTransaction({
    storage,
    outputs: [{ type: OutputType.DATA, data: 'my message' }],
  });
  const txData = await sendTransaction.prepareTxData();

  expect(txData.outputs).toHaveLength(1);
  const script = transaction.createOutputScript(txData.outputs[0], new Network('testnet'));
  // Push of the 10 utf8 bytes of the payload, then OP_CHECKSIG.
  expect(script.toString('hex')).toEqual(`0a${Buffer.from('my message').toString('hex')}ac`);
});

test('invalid method calls', async () => {
  const sendTransaction = new SendTransaction();

  // Methods that require storage should throw an error
  await expect(sendTransaction.prepareTxData()).rejects.toThrow('Storage is not set.');
  await expect(sendTransaction.prepareTx()).rejects.toThrow('Storage is not set.');
  await expect(sendTransaction.prepareTxFrom([])).rejects.toThrow('Storage is not set.');
  await expect(sendTransaction.run()).rejects.toThrow('Storage is not set.');

  // updateOutputSelected without storage will be a no-op
  const sendTransaction2 = new SendTransaction({ transaction: 'a-transaction-instance' });
  await expect(sendTransaction2.updateOutputSelected(true)).resolves.toBeUndefined();
});

test('checkUnspentInput', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  const addressSpy = jest.spyOn(storage, 'isAddressMine').mockReturnValue(Promise.resolve(true));
  const txSpy = jest.spyOn(storage, 'getTx');
  const input0 = { txId: 'tx-id', index: 0, address: 'addr0', token: '01' };
  const input1 = { txId: 'tx-id', index: 1, address: 'addr1', token: '01' };
  txSpy.mockReturnValueOnce(Promise.resolve(null));
  await expect(checkUnspentInput(storage, input1, '01')).resolves.toEqual({
    success: false,
    message: 'Transaction [tx-id] does not exist in the wallet',
  });

  txSpy.mockReturnValueOnce(Promise.resolve({ is_voided: true }));
  await expect(checkUnspentInput(storage, input1, '01')).resolves.toEqual({
    success: false,
    message: 'Transaction [tx-id] is voided',
  });

  txSpy.mockReturnValueOnce(Promise.resolve({ is_voided: false, outputs: ['only-output'] }));
  await expect(checkUnspentInput(storage, input1, '01')).resolves.toEqual({
    success: false,
    message: 'Transaction [tx-id] does not have this output [index=1]',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({ is_voided: false, outputs: [{ token_data: TOKEN_AUTHORITY_MASK | 1 }] })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is an authority output',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, decoded: { address: 'different-addr' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message:
      'Output [0] of transaction [tx-id] does not have the same address as the provided input',
  });

  addressSpy.mockReturnValueOnce(Promise.resolve(false));
  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, decoded: { address: 'addr0' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is not from the wallet',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, decoded: {} }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message:
      'Output [0] of transaction [tx-id] cannot be spent since it does not belong to an address',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, decoded: { address: 'addr0', token: '02' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '02')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is not from selected token [02]',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, token: '01', decoded: { address: 'addr0' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '02')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is not from selected token [02]',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [
        { token_data: 1, token: '01', spent_by: 'another-tx', decoded: { address: 'addr0' } },
      ],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: false,
    message: 'Output [0] of transaction [tx-id] is already spent',
  });

  txSpy.mockReturnValueOnce(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, token: '01', decoded: { address: 'addr0' } }],
    })
  );
  await expect(checkUnspentInput(storage, input0, '01')).resolves.toEqual({
    success: true,
    message: '',
  });
});

test('prepareSendTokensData', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  jest.spyOn(storage, 'getWalletType').mockReturnValue(Promise.resolve(WalletType.P2PKH));
  jest
    .spyOn(storage, 'getChangeAddress')
    .mockImplementation(({ changeAddress }) => Promise.resolve(changeAddress));
  jest.spyOn(transaction, 'canUseUtxo').mockReturnValue(Promise.resolve(true));

  const tx = {
    inputs: [
      { txId: 'tx-id', index: 0, address: 'addr0', token: '01' },
      { txId: 'tx-id', index: 1, address: 'addr1', token: '01' },
    ],
    outputs: [
      { address: 'addr2', value: 1n, token: '00' },
      { address: 'addr3', value: 2n, token: '01' },
      { type: 'mint', address: 'addr4', value: 2n, token: '01' }, // will be ignored
    ],
  };

  const utxoSelection = jest.fn().mockReturnValue(
    Promise.resolve({
      utxos: [],
      amount: 0n,
    })
  );

  await expect(
    prepareSendTokensData(storage, tx, {
      chooseInputs: true,
      utxoSelectionMethod: utxoSelection,
    })
  ).rejects.toThrow('Insufficient amount of tokens');

  utxoSelection.mockReturnValue(
    Promise.resolve({
      utxos: [
        {
          txId: 'tx-id',
          index: 0,
          address: 'addr-utxo',
          value: 3n,
          authorities: 0n,
          token: '01',
        },
      ],
      amount: 3n,
    })
  );
  await expect(
    prepareSendTokensData(storage, tx, {
      token: '01',
      chooseInputs: true,
      utxoSelectionMethod: utxoSelection,
      changeAddress: 'addr-change',
    })
  ).resolves.toMatchObject({
    inputs: [
      { txId: 'tx-id', index: 0, address: 'addr-utxo', token: '01', value: 3n, authorities: 0n },
    ],
    outputs: [
      {
        type: 'p2pkh',
        address: 'addr-change',
        value: 1n,
        token: '01',
        authorities: 0n,
        timelock: null,
        isChange: true,
      },
    ],
  });

  const prepareSpy = jest.spyOn(transaction, 'canUseUtxo').mockReturnValue(Promise.resolve(true));
  jest.spyOn(storage, 'isAddressMine').mockReturnValue(Promise.resolve(true));
  jest.spyOn(storage, 'getTx').mockReturnValue(
    Promise.resolve({
      is_voided: false,
      outputs: [
        { token_data: 1, value: 1n, token: '01', decoded: { address: 'addr0', token: '01' } },
        { token_data: 1, value: 2n, token: '01', decoded: { address: 'addr1', token: '01' } },
        // Since the last output is skipped we do not need it on the tx
        // { token_data:0, value: 1, decoded: { address: 'addr2', token: '00' } },
      ],
    })
  );
  const tx1 = {
    inputs: [
      { txId: 'tx-id', index: 0, value: 1n, address: 'addr0', token: '01' },
      { txId: 'tx-id', index: 1, value: 2n, address: 'addr1', token: '01' },
      { txId: 'tx-id', index: 2, value: 1n, address: 'addr2', token: '00' }, // Should be skipped
    ],
    outputs: [
      { address: 'addr2', value: 1n, token: '00' },
      { address: 'addr3', value: 2n, token: '01' },
      { type: 'mint', address: 'addr4', value: 2n, token: '01' }, // will be ignored
    ],
  };

  await expect(
    prepareSendTokensData(storage, tx1, {
      token: '01',
      chooseInputs: false,
      changeAddress: 'addr-change',
    })
  ).resolves.toMatchObject({
    // No new inputs since we do not choose inputs
    inputs: [],
    // We add a change since the inputs had more tokens than the outputs
    outputs: [
      {
        type: 'p2pkh',
        address: 'addr-change',
        value: 1n,
        token: '01',
        authorities: 0n,
        timelock: null,
        isChange: true,
      },
    ],
  });
  // Reset mocks
  prepareSpy.mockRestore();
});

describe('releaseUtxos', () => {
  it('should unmark all transaction inputs as selected', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const utxoSelectSpy = jest.spyOn(storage, 'utxoSelectAsInput');

    const sendTx = new SendTransaction({ storage, outputs: [], inputs: [] });

    const mockTx = {
      inputs: [
        { hash: 'tx1', index: 0 },
        { hash: 'tx2', index: 1 },
      ],
    } as unknown as import('../../src/models/transaction').default;
    sendTx.transaction = mockTx;

    await sendTx.releaseUtxos();

    expect(utxoSelectSpy).toHaveBeenCalledTimes(2);
    expect(utxoSelectSpy).toHaveBeenCalledWith({ txId: 'tx1', index: 0 }, false);
    expect(utxoSelectSpy).toHaveBeenCalledWith({ txId: 'tx2', index: 1 }, false);
  });

  it('should no-op when transaction is null', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const utxoSelectSpy = jest.spyOn(storage, 'utxoSelectAsInput');

    const sendTx = new SendTransaction({ storage, outputs: [], inputs: [] });

    await sendTx.releaseUtxos();

    expect(utxoSelectSpy).not.toHaveBeenCalled();
  });

  it('should no-op when storage is not set', async () => {
    const sendTx = new SendTransaction({ outputs: [], inputs: [] });

    const mockTx = {
      inputs: [{ hash: 'tx1', index: 0 }],
    } as unknown as import('../../src/models/transaction').default;
    sendTx.transaction = mockTx;

    // Should resolve without throwing
    await expect(sendTx.releaseUtxos()).resolves.toBeUndefined();
  });

  it('should continue releasing remaining UTXOs if one fails', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const utxoSelectSpy = jest
      .spyOn(storage, 'utxoSelectAsInput')
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const sendTx = new SendTransaction({ storage, outputs: [], inputs: [] });
    const mockTx = {
      inputs: [
        { hash: 'tx1', index: 0 },
        { hash: 'tx2', index: 1 },
      ],
    } as unknown as import('../../src/models/transaction').default;
    sendTx.transaction = mockTx;

    await sendTx.releaseUtxos(); // should not throw

    expect(utxoSelectSpy).toHaveBeenCalledTimes(2);
  });
});

describe('convertHtrChangeIfRequested', () => {
  // Build a fresh real shielded testnet address per test so the helper
  // can extract scanPubkey + spend P2PKH the same way the production
  // `sendManyOutputsSendTransaction` does. Reusing the same network
  // across tests is fine — the helper doesn't cache anything.
  const testnetNetwork = new Network('testnet');

  // Real EC pubkeys (compressed, 33 bytes) so the helper's
  // `getSpendAddress()` call can derive a valid P2PKH instead of
  // throwing on a malformed point. We don't need deterministic keys
  // here — only that they parse.
  const buildShieldedAddress = (): string => {
    const scanPubkey = new PrivateKey().toPublicKey().toBuffer();
    const spendPubkey = new PrivateKey().toPublicKey().toBuffer();
    return encodeShieldedAddress(scanPubkey, spendPubkey, testnetNetwork);
  };

  const buildHtrChangeOutput = (value: bigint) => ({
    type: 'p2pkh' as const,
    address: 'transparent-change-address',
    value,
    token: NATIVE_TOKEN_UID,
    authorities: 0n,
    timelock: null,
    isChange: true,
  });

  // Resolved defs (spend P2PKH + scanPubkey), the shape the pipeline hands
  // to convertHtrChangeIfRequested after resolving the 71-byte addresses.
  const buildShieldedDef = (mode: ShieldedOutputMode) => ({
    address: 'spend-P2PKH-of-recipient',
    value: 10n,
    token: '01',
    scanPubkey: 'aa'.repeat(33),
    shieldedMode: mode,
  });

  const mockWallet = (shieldedAddress: string) =>
    ({
      getCurrentAddress: jest.fn().mockResolvedValue({
        address: shieldedAddress,
        index: 0,
        addressPath: 'm/0',
      }),
    }) as unknown as import('../../src/new/wallet').default;

  type FakeUtxo = {
    txId: string;
    index: number;
    value: bigint;
    token: string;
    address: string;
    authorities: bigint;
  };

  // Storage stub whose `selectUtxos` yields the given HTR UTXOs, honoring the
  // caller's `filter_method` (exclusion of already-used UTXOs) AND
  // `order_by_value` (value sort) the same way the real storage does — so a
  // regression in the pull-loop's ordering is observable.
  const mockStorage = (utxos: FakeUtxo[] = []) =>
    ({
      // eslint-disable-next-line @typescript-eslint/require-await
      async *selectUtxos(options: IUtxoFilterOptions) {
        let ordered = utxos;
        if (options.order_by_value) {
          const dir = options.order_by_value === 'asc' ? 1 : -1;
          ordered = [...utxos].sort((a, b) => {
            if (a.value === b.value) return 0;
            return a.value < b.value ? -dir : dir;
          });
        }
        for (const utxo of ordered) {
          if (options.filter_method && !options.filter_method(utxo as unknown as IUtxo)) continue;
          yield utxo;
        }
      },
    }) as unknown as IStorage;

  test('H.1 — converts transparent HTR change to FS', async () => {
    const partialHtrTxData = {
      inputs: [],
      outputs: [buildHtrChangeOutput(100n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];

    // Known scan/spend keys so the emitted def can be bound to them. Both keys
    // are 33-byte compressed pubkeys and the spend address is a valid P2PKH, so
    // a scan<->spend swap in the conversion would pass a shape-only check while
    // making the change output undetectable (and unrecoverable) by the receiver.
    const knownScanPubkey = new PrivateKey().toPublicKey().toBuffer();
    const knownSpendPubkey = new PrivateKey().toPublicKey().toBuffer();
    const knownShieldedAddr = encodeShieldedAddress(
      knownScanPubkey,
      knownSpendPubkey,
      testnetNetwork
    );

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.FULLY_SHIELDED,
      mockWallet(knownShieldedAddr),
      testnetNetwork,
      mockStorage()
    );

    expect(result.addedFee).toBe(FEE_PER_FULL_SHIELDED_OUTPUT);
    // Transparent change removed.
    expect(partialHtrTxData.outputs).toHaveLength(0);
    // Shielded HTR change appended.
    expect(defs).toHaveLength(3);
    const htrChange = defs[2];
    expect(htrChange.token).toBe(NATIVE_TOKEN_UID);
    expect(htrChange.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
    expect(htrChange.value).toBe(100n - FEE_PER_FULL_SHIELDED_OUTPUT);
    // Bind the emitted keys to the known address: scanPubkey must be the scan
    // key (the ECDH key the receiver scans with) and address must be the
    // spend-derived P2PKH — not swapped. This is what makes the change output
    // recoverable, so assert identity, not just shape.
    expect(htrChange.scanPubkey).toBe(knownScanPubkey.toString('hex'));
    expect(htrChange.address).toBe(
      new Address(knownShieldedAddr, { network: testnetNetwork }).getSpendAddress().base58
    );
  });

  test('H.2 — converts transparent HTR change to AS', async () => {
    const partialHtrTxData = {
      inputs: [],
      outputs: [buildHtrChangeOutput(100n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
    ];

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.AMOUNT_SHIELDED,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      mockStorage()
    );

    expect(result.addedFee).toBe(FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(partialHtrTxData.outputs).toHaveLength(0);
    expect(defs).toHaveLength(3);
    expect(defs[2].shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
    expect(defs[2].value).toBe(100n - FEE_PER_AMOUNT_SHIELDED_OUTPUT);
  });

  test('H.3 — no-op when mode is null', async () => {
    const partialHtrTxData = {
      inputs: [],
      outputs: [buildHtrChangeOutput(100n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      null,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      mockStorage()
    );

    expect(result.addedFee).toBe(0n);
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(defs).toHaveLength(2);
  });

  test('H.4 — change == fee: pulls an extra HTR UTXO and converts', async () => {
    // Change exactly equals the fee → it can't fund its own shielded-output
    // fee. Instead of silently keeping a transparent change, we pull an extra
    // HTR UTXO and fold its value into the change so it clears the fee.
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(FEE_PER_FULL_SHIELDED_OUTPUT)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];
    const extraUtxo: FakeUtxo = {
      txId: 'extra-htr-tx',
      index: 0,
      value: 5n,
      token: NATIVE_TOKEN_UID,
      address: 'extra-htr-address',
      authorities: 0n,
    };

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.FULLY_SHIELDED,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      mockStorage([extraUtxo])
    );

    expect(result.addedFee).toBe(FEE_PER_FULL_SHIELDED_OUTPUT);
    // Extra UTXO pulled in as an input.
    expect(partialHtrTxData.inputs).toHaveLength(1);
    expect(partialHtrTxData.inputs[0].txId).toBe('extra-htr-tx');
    // Transparent change removed, shielded change appended.
    expect(partialHtrTxData.outputs).toHaveLength(0);
    expect(defs).toHaveLength(3);
    // newChange = change (2) + pulled (5) = 7; shielded value = 7 - fee (2) = 5.
    expect(defs[2].value).toBe(5n);
    // Balance: pulled input value + original change - fee == shielded value.
    expect(extraUtxo.value + FEE_PER_FULL_SHIELDED_OUTPUT - FEE_PER_FULL_SHIELDED_OUTPUT).toBe(
      defs[2].value
    );
  });

  test('H.4b — change < fee: pulls enough HTR, excluding already-used UTXOs', async () => {
    // deficit = fee(2) - change(1) = 1 → must pull strictly more than 1.
    const usedInExisting: FakeUtxo = {
      txId: 'used-existing-tx',
      index: 0,
      value: 100n,
      token: NATIVE_TOKEN_UID,
      address: 'used-existing-address',
      authorities: 0n,
    };
    const usedInHtrPass: FakeUtxo = {
      txId: 'used-htrpass-tx',
      index: 1,
      value: 50n,
      token: NATIVE_TOKEN_UID,
      address: 'used-htrpass-address',
      authorities: 0n,
    };
    const freeUtxo: FakeUtxo = {
      txId: 'free-htr-tx',
      index: 0,
      value: 3n,
      token: NATIVE_TOKEN_UID,
      address: 'free-htr-address',
      authorities: 0n,
    };
    const partialHtrTxData = {
      // A pre-existing HTR-pass input that must be excluded from the pull.
      inputs: [walletHelpers.getDataInputFromUtxo(usedInHtrPass as unknown as IUtxo)],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.FULLY_SHIELDED,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      // Storage still offers the already-used UTXOs; the helper's filter must
      // skip both the existingInputs one and the HTR-pass one, pulling `free`.
      mockStorage([usedInExisting, usedInHtrPass, freeUtxo]),
      [walletHelpers.getDataInputFromUtxo(usedInExisting as unknown as IUtxo)]
    );

    expect(result.addedFee).toBe(FEE_PER_FULL_SHIELDED_OUTPUT);
    // Only the free UTXO was pulled (used ones excluded); it joins the
    // pre-existing HTR-pass input.
    expect(partialHtrTxData.inputs).toHaveLength(2);
    expect(partialHtrTxData.inputs.map(i => i.txId)).toEqual(['used-htrpass-tx', 'free-htr-tx']);
    // newChange = change (1) + pulled (3) = 4; shielded value = 4 - fee (2) = 2.
    expect(defs[2].value).toBe(2n);
  });

  test('H.4f — pulls a fully shielded HTR UTXO only when nothing else covers', async () => {
    // deficit = fee(1) - change(1) = 0 → any UTXO clears it. Spent into this
    // amount-shielded change, the fully shielded 3n would reveal its token, so
    // the amount-shielded 3n is pulled instead.
    const fullyShielded = {
      txId: 'fs-htr-tx',
      index: 0,
      value: 3n,
      token: NATIVE_TOKEN_UID,
      address: 'fs-htr-address',
      authorities: 0n,
      shielded: true,
      assetBlindingFactor: '33'.repeat(32),
    };
    const amountShielded = {
      txId: 'as-htr-tx',
      index: 0,
      value: 3n,
      token: NATIVE_TOKEN_UID,
      address: 'as-htr-address',
      authorities: 0n,
      shielded: true,
    };
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
    ];

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.AMOUNT_SHIELDED,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      mockStorage([fullyShielded, amountShielded])
    );

    expect(result.addedFee).toBe(FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(partialHtrTxData.inputs.map(i => i.txId)).toEqual(['as-htr-tx']);
    // newChange = change (1) + pulled (3) = 4; shielded value = 4 - fee (1) = 3.
    expect(defs[2].value).toBe(3n);
  });

  test('H.4e — pulls the SMALLEST sufficient HTR UTXO (order_by_value asc), not the largest', async () => {
    // deficit = fee(2) - change(1) = 1 → any single UTXO > 1 suffices. With
    // several pullable UTXOs of different values, the asc ordering must pick the
    // smallest sufficient one so a trivial change doesn't sweep the wallet's
    // largest HTR UTXO into the shielded change. A regression to 'desc' would
    // pull the 100n UTXO and this test would fail.
    const big: FakeUtxo = {
      txId: 'big-htr-tx',
      index: 0,
      value: 100n,
      token: NATIVE_TOKEN_UID,
      address: 'big-addr',
      authorities: 0n,
    };
    const mid: FakeUtxo = {
      txId: 'mid-htr-tx',
      index: 0,
      value: 5n,
      token: NATIVE_TOKEN_UID,
      address: 'mid-addr',
      authorities: 0n,
    };
    const small: FakeUtxo = {
      txId: 'small-htr-tx',
      index: 0,
      value: 3n,
      token: NATIVE_TOKEN_UID,
      address: 'small-addr',
      authorities: 0n,
    };
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.FULLY_SHIELDED,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      // Offered out of ascending order to prove the helper sorts, not luck.
      mockStorage([big, mid, small])
    );

    expect(result.addedFee).toBe(FEE_PER_FULL_SHIELDED_OUTPUT);
    // Only the smallest sufficient UTXO (3n) was pulled — not 5n and not 100n.
    expect(partialHtrTxData.inputs).toHaveLength(1);
    expect(partialHtrTxData.inputs[0].txId).toBe('small-htr-tx');
    // shielded change = change(1) + pulled(3) - fee(2) = 2. Under 'desc' it would
    // be 1 + 100 - 2 = 99.
    expect(defs[2].value).toBe(2n);
  });

  test('H.4c — change <= fee and no extra HTR available → throws', async () => {
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];

    await expect(
      convertHtrChangeIfRequested(
        partialHtrTxData,
        defs,
        ShieldedOutputMode.FULLY_SHIELDED,
        mockWallet(buildShieldedAddress()),
        testnetNetwork,
        mockStorage([]) // no extra HTR available
      )
    ).rejects.toThrow(/HTR change is too small to fund its shielded-output fee/);

    // Nothing mutated on the failure path.
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(defs).toHaveLength(2);
  });

  test('H.4d — change <= fee but HTR user-supplied (canSelectMoreHtr=false) → throws without pulling', async () => {
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];
    // A spare HTR UTXO IS available — but because HTR inputs were user-supplied
    // we must NOT pull it: the wallet respects the "user supplies inputs ->
    // choose nothing more" contract and fails instead of selecting.
    const storageWithHtr = mockStorage([
      {
        txId: 'spare-htr',
        index: 0,
        value: 100n,
        token: NATIVE_TOKEN_UID,
        address: 'spare-addr',
        authorities: 0n,
      },
    ]);

    await expect(
      convertHtrChangeIfRequested(
        partialHtrTxData,
        defs,
        ShieldedOutputMode.FULLY_SHIELDED,
        mockWallet(buildShieldedAddress()),
        testnetNetwork,
        storageWithHtr,
        [], // existingInputs
        false // canSelectMoreHtr → throw rather than pull the spare UTXO
      )
    ).rejects.toThrow(/user-supplied so no additional HTR can be selected/);

    // Nothing mutated, and the available UTXO was NOT pulled.
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(partialHtrTxData.inputs).toHaveLength(0);
    expect(defs).toHaveLength(2);
  });

  test('H.5 — no-op when no HTR change output present', async () => {
    // All HTR was consumed exactly by the fee — `prepareSendTokensData`
    // would have emitted no `isChange: true` HTR entry, so there's
    // nothing for us to convert.
    const partialHtrTxData = {
      inputs: [],
      outputs: [],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.FULLY_SHIELDED,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      mockStorage()
    );

    expect(result.addedFee).toBe(0n);
    expect(defs).toHaveLength(2);
  });

  test('H.5b — no-op when the change mode is transparent', async () => {
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(5n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
    ];

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      OutputKind.TRANSPARENT,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      mockStorage()
    );

    // The transparent change stays as it is: nothing converted, no fee added.
    expect(result.addedFee).toBe(0n);
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(partialHtrTxData.outputs[0].value).toBe(5n);
    expect(defs).toHaveLength(2);
  });

  test('H.6 — converts even when no shielded defs exist yet', async () => {
    // A forced mode on a pure-transparent tx converts the change; the lone
    // shielded output this creates is resolved by prepareTxData's structural
    // pass, which splits it into the two outputs the protocol requires.
    const partialHtrTxData = {
      inputs: [],
      outputs: [buildHtrChangeOutput(100n)],
    };
    const defs: ReturnType<typeof buildShieldedDef>[] = [];

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.FULLY_SHIELDED,
      mockWallet(buildShieldedAddress()),
      testnetNetwork,
      mockStorage()
    );

    expect(result.addedFee).toBe(FEE_PER_FULL_SHIELDED_OUTPUT);
    expect(partialHtrTxData.outputs).toHaveLength(0);
    expect(defs).toHaveLength(1);
    expect(defs[0].value).toBe(100n - FEE_PER_FULL_SHIELDED_OUTPUT);
    expect(defs[0].isChange).toBe(true);
  });

  test('H.7 — throws when the shielded-output cap is already reached', async () => {
    const partialHtrTxData = {
      inputs: [],
      outputs: [buildHtrChangeOutput(100n)],
    };
    // Already at MAX_SHIELDED_OUTPUTS explicit shielded outputs: shielding the
    // HTR change would push past the cap, so the helper must throw a clear
    // error before pulling any HTR or deriving an address.
    const defs = Array.from({ length: MAX_SHIELDED_OUTPUTS }, () =>
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED)
    );

    await expect(
      convertHtrChangeIfRequested(
        partialHtrTxData,
        defs,
        ShieldedOutputMode.FULLY_SHIELDED,
        mockWallet(buildShieldedAddress()),
        testnetNetwork,
        mockStorage()
      )
    ).rejects.toThrow('maximum');
    // Untouched: transparent change kept, no def appended.
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(defs).toHaveLength(MAX_SHIELDED_OUTPUTS);
  });
});

test('prepareTxData rejects a caller input that spends an undecoded shielded slot', async () => {
  const storage = new Storage(new MemoryStore());
  storage.config.setNetwork('testnet');
  // Parent tx: no transparent outputs and a single shielded slot at on-chain
  // index 0 that this wallet does not own / has not decoded (value === undefined).
  // A caller-provided input can point at any slot; without decoded value/address
  // there is nothing to sign with, so the send must be rejected — not silently
  // recovered from a stored UTXO.
  jest.spyOn(storage, 'getTx').mockResolvedValue({
    tx_id: 'parent',
    outputs: [],
    shielded_outputs: [
      { mode: 1, commitment: '', range_proof: '', script: '', ephemeral_pubkey: '', decoded: {} },
    ],
    inputs: [],
  } as never);

  const sendTransaction = new SendTransaction({
    storage,
    outputs: [],
    inputs: [{ txId: 'parent', index: 0 }],
  });

  await expect(sendTransaction.prepareTxData()).rejects.toThrow('invalid-input');
});

describe('changeShieldedMode applies to all change outputs (prepareTxData)', () => {
  const testnetNetwork = new Network('testnet');
  const root = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x1a), 'testnet');
  // A genuine 32-byte custom token UID — createShieldedOutputs requires the
  // token UID to be exactly 32 bytes (a real on-chain token hash).
  const CUSTOM_TOKEN = 'ab'.repeat(32);

  const buildShieldedAddr = (i: number): string =>
    encodeShieldedAddress(
      root.deriveChild(`m/0'/${i}`).publicKey.toBuffer(),
      root.deriveChild(`m/1'/${i}`).publicKey.toBuffer(),
      testnetNetwork
    );

  // A structural (non-cryptographic) provider: fixed-size buffers so the
  // creation pipeline runs to completion. We assert on the pipeline's
  // fee/def/removal bookkeeping, not on crypto correctness.
  const makeCryptoProvider = (): IShieldedCryptoProvider =>
    ({
      generateRandomBlindingFactor: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x01)),
      createAmountShieldedOutput: jest.fn().mockResolvedValue({
        ephemeralPubkey: Buffer.alloc(33, 0x02),
        commitment: Buffer.alloc(33, 0x03),
        rangeProof: Buffer.alloc(10, 0x04),
        blindingFactor: Buffer.alloc(32, 0x05),
      }),
      createShieldedOutputWithBothBlindings: jest.fn().mockResolvedValue({
        ephemeralPubkey: Buffer.alloc(33, 0x02),
        commitment: Buffer.alloc(33, 0x03),
        rangeProof: Buffer.alloc(10, 0x04),
        blindingFactor: Buffer.alloc(32, 0x05),
        assetCommitment: Buffer.alloc(33, 0x06),
        assetBlindingFactor: Buffer.alloc(32, 0x07),
      }),
      rewindAmountShieldedOutput: jest.fn(),
      rewindFullShieldedOutput: jest.fn(),
      computeBalancingBlindingFactor: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x08)),
      deriveTag: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x09)),
      createAssetCommitment: jest.fn().mockResolvedValue(Buffer.alloc(33, 0x0a)),
      createSurjectionProof: jest.fn().mockResolvedValue(Buffer.alloc(20, 0x0b)),
      deriveEcdhSharedSecret: jest.fn(),
    }) as unknown as IShieldedCryptoProvider;

  const getTokenImpl = async (uid: string) => {
    if (uid === NATIVE_TOKEN_UID) {
      return { version: TokenVersion.NATIVE, uid, symbol: 'HTR', name: 'Hathor' };
    }
    if (uid === CUSTOM_TOKEN) {
      // DEPOSIT (not FEE) → no transparent per-output fee, isolating the
      // shielded fee arithmetic.
      return { version: TokenVersion.DEPOSIT, uid, symbol: 'CTK', name: 'Custom' };
    }
    return undefined;
  };

  const buildStorage = (
    selectUtxoMock: (options: IUtxoFilterOptions) => AsyncGenerator<unknown>,
    { withProvider = true }: { withProvider?: boolean } = {}
  ): Storage => {
    const storage = new Storage(new MemoryStore());
    storage.config.setNetwork('testnet');
    jest.spyOn(storage, 'getWalletType').mockResolvedValue(WalletType.P2PKH);
    jest.spyOn(storage, 'selectUtxos').mockImplementation(selectUtxoMock as never);
    // Transparent change address returned by the storage-level resolver; the
    // custom-token change built here is later converted/removed by A1.
    jest.spyOn(storage, 'getCurrentAddress').mockResolvedValue('W-transparent-change' as never);
    jest.spyOn(storage, 'getToken').mockImplementation(getTokenImpl as never);
    if (withProvider) {
      storage.shieldedCryptoProvider = makeCryptoProvider();
    }
    return storage;
  };

  const buildWallet = (storage: Storage, shieldedAddr: string) =>
    ({
      storage,
      getCurrentAddress: jest.fn().mockResolvedValue({
        address: shieldedAddr,
        index: 0,
        addressPath: 'm/0',
      }),
    }) as unknown as import('../../src/new/wallet').default;

  test('A1 — custom-token change becomes a shielded output with full value', async () => {
    async function* selectUtxoMock(options: IUtxoFilterOptions) {
      if (options.token === NATIVE_TOKEN_UID) {
        // Exactly covers the two per-output shielded fees (2n) → no HTR change.
        yield {
          txId: 'htr-tx',
          index: 0,
          value: 2n,
          token: NATIVE_TOKEN_UID,
          address: 'htr-addr',
          authorities: 0n,
        };
      } else if (options.token === CUSTOM_TOKEN) {
        yield {
          txId: 'custom-tx',
          index: 0,
          value: 30n,
          token: CUSTOM_TOKEN,
          address: 'custom-addr',
          authorities: 0n,
        };
      }
    }
    const storage = buildStorage(selectUtxoMock);
    const wallet = buildWallet(storage, buildShieldedAddr(0));
    const sendTransaction = new SendTransaction({
      wallet,
      outputs: [
        {
          address: buildShieldedAddr(1),
          value: 10n,
          token: CUSTOM_TOKEN,
          shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ],
      changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
    });

    const result = await sendTransaction.prepareTxData();

    // Two shielded outputs: the explicit recipient (10n) + the converted
    // custom-token change (20n = 30n selected - 10n sent, FULL value, no fee
    // subtracted since the fee is HTR).
    expect(result.shieldedOutputs).toHaveLength(2);
    const values = result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b));
    expect(values).toEqual([10n, 20n]);
    expect(result.shieldedOutputs!.every(o => o.token === CUSTOM_TOKEN)).toBe(true);
    // Bind the converted change output (20n) to the wallet's known change-address
    // keys: scanPubkey must be the scan key and address the spend-derived P2PKH.
    // A scan<->spend swap in the custom-token conversion (sendTransaction.ts
    // ~459/462) would pass the value/count checks above while making the change
    // undetectable/unrecoverable by the receiver.
    const changeOutput = result.shieldedOutputs!.find(o => o.value === 20n)!;
    expect(changeOutput.scanPubkey).toBe(
      root.deriveChild("m/0'/0").publicKey.toBuffer().toString('hex')
    );
    expect(changeOutput.address).toBe(
      new Address(buildShieldedAddr(0), { network: testnetNetwork }).getSpendAddress().base58
    );
    // No transparent change survives.
    expect(result.outputs).toHaveLength(0);
    // Fee header carries both per-output shielded fees (AMOUNT = 1n each).
    const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
    expect(feeHeader.entries[0].amount).toBe(2n);
    // HTR selection funded the shielded fee; custom UTXO funded the sends.
    expect(result.inputs).toHaveLength(2);
    expect(result.inputs.map(i => i.txId).sort()).toEqual(['custom-tx', 'htr-tx']);
  });

  test('A1b — shielded outputs are shuffled (change not at a predictable index)', async () => {
    async function* selectUtxoMock(options: IUtxoFilterOptions) {
      if (options.token === NATIVE_TOKEN_UID) {
        yield {
          txId: 'htr-tx',
          index: 0,
          value: 2n,
          token: NATIVE_TOKEN_UID,
          address: 'htr-addr',
          authorities: 0n,
        };
      } else if (options.token === CUSTOM_TOKEN) {
        yield {
          txId: 'custom-tx',
          index: 0,
          value: 30n,
          token: CUSTOM_TOKEN,
          address: 'custom-addr',
          authorities: 0n,
        };
      }
    }
    const storage = buildStorage(selectUtxoMock);
    const wallet = buildWallet(storage, buildShieldedAddr(0));
    const sendTransaction = new SendTransaction({
      wallet,
      outputs: [
        {
          address: buildShieldedAddr(1),
          value: 10n,
          token: CUSTOM_TOKEN,
          shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ],
      changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
    });

    // Force shuffle to reverse so its effect is observable: the defs are built
    // [recipient(10n), change(20n)], so a reversing shuffle must flip the
    // on-chain shielded-output order — proving the shuffle result is used, not
    // discarded. (A no-op shuffle would leave [10n, 20n].)
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const lodash = require('lodash');
    const shuffleSpy = jest
      .spyOn(lodash, 'shuffle')
      .mockImplementation((arr: unknown) => [...(arr as unknown[])].reverse());
    try {
      const result = await sendTransaction.prepareTxData();
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([20n, 10n]);
    } finally {
      shuffleSpy.mockRestore();
    }
  });

  test('R2 — a shielded send rejects a user-supplied input not owned by the wallet', async () => {
    // r4mmer's question: for a shielded tx all inputs must be wallet-owned. They
    // are — a foreign user-supplied input is rejected UPSTREAM (checkUnspentInput
    // via isAddressMine), before the shielded input-collection loop ever runs.
    // This test documents that the shielded path benefits from that guard.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, require-yield
    async function* selectUtxoMock(_options: IUtxoFilterOptions) {
      // yields nothing
    }
    const storage = buildStorage(selectUtxoMock);
    // A tx the wallet knows (getTx succeeds, resolveSpentOutput resolves output
    // 0) but whose output 0 is paid to another address — not isAddressMine.
    await storage.store.saveTx({
      tx_id: 'known-but-unowned-tx',
      version: 1,
      timestamp: 1,
      is_voided: false,
      nonce: 0,
      weight: 1,
      parents: [],
      inputs: [],
      height: 1,
      tokens: [],
      outputs: [
        {
          value: 100n,
          token_data: 0,
          token: NATIVE_TOKEN_UID,
          decoded: { address: 'W-someone-else', timelock: null },
          script: '',
          spent_by: null,
        },
      ],
      shielded_outputs: [],
    } as unknown as IHistoryTx);

    const wallet = buildWallet(storage, buildShieldedAddr(0));
    const sendTransaction = new SendTransaction({
      wallet,
      inputs: [{ txId: 'known-but-unowned-tx', index: 0 }],
      outputs: [
        {
          address: buildShieldedAddr(1),
          value: 10n,
          token: NATIVE_TOKEN_UID,
          shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
        {
          address: buildShieldedAddr(2),
          value: 10n,
          token: NATIVE_TOKEN_UID,
          shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ],
    });

    await expect(sendTransaction.prepareTxData()).rejects.toThrow(/is not from the wallet/);
  });

  test('A2 — HTR change <= fee pulls an extra HTR UTXO; tx stays balanced', async () => {
    async function* selectUtxoMock(options: IUtxoFilterOptions) {
      if (options.token === NATIVE_TOKEN_UID) {
        const htrUtxos = [
          {
            txId: 'htr-a',
            index: 0,
            value: 2n,
            token: NATIVE_TOKEN_UID,
            address: 'htr-a-addr',
            authorities: 0n,
          },
          {
            txId: 'htr-b',
            index: 0,
            value: 5n,
            token: NATIVE_TOKEN_UID,
            address: 'htr-b-addr',
            authorities: 0n,
          },
        ];
        for (const utxo of htrUtxos) {
          if (options.filter_method && !options.filter_method(utxo as unknown as IUtxo)) continue;
          yield utxo;
        }
      } else if (options.token === CUSTOM_TOKEN) {
        // Exactly covers the sent amount → no custom-token change (isolates A2).
        yield {
          txId: 'custom-tx',
          index: 0,
          value: 10n,
          token: CUSTOM_TOKEN,
          address: 'custom-addr',
          authorities: 0n,
        };
      }
    }
    const storage = buildStorage(selectUtxoMock);
    const wallet = buildWallet(storage, buildShieldedAddr(0));
    const sendTransaction = new SendTransaction({
      wallet,
      outputs: [
        {
          address: buildShieldedAddr(1),
          value: 10n,
          token: CUSTOM_TOKEN,
          shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ],
      changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
    });

    const result = await sendTransaction.prepareTxData();

    // shieldedFee for the single explicit output = 1n → HTR pass selects the
    // 2n UTXO, producing 1n change (== fee). Too small: the pull folds in the
    // 5n UTXO → HTR change becomes 6n - 1n = 5n (shielded).
    expect(result.shieldedOutputs).toHaveLength(2);
    const htrChange = result.shieldedOutputs!.find(o => o.token === NATIVE_TOKEN_UID);
    expect(htrChange).toBeDefined();
    expect(htrChange!.value).toBe(5n);
    const customOut = result.shieldedOutputs!.find(o => o.token === CUSTOM_TOKEN);
    expect(customOut!.value).toBe(10n);
    // totalFee = explicit shielded fee (1n) + HTR-change shielded fee (1n).
    const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
    expect(feeHeader.entries[0].amount).toBe(2n);
    // The pulled HTR UTXO (htr-b) joined the inputs alongside htr-a + custom.
    expect(result.inputs).toHaveLength(3);
    expect(result.inputs.map(i => i.txId).sort()).toEqual(['custom-tx', 'htr-a', 'htr-b']);
    // No transparent HTR change survives.
    expect(result.outputs).toHaveLength(0);
    // Balance check (HTR): inputs (2 + 5) == shielded HTR change (5) + fee (2).
    expect(2n + 5n).toBe(htrChange!.value + feeHeader.entries[0].amount);
  });

  test('an explicit shielded mode on a transparent-only send is honored via a split change', async () => {
    async function* selectUtxoMock(options: IUtxoFilterOptions) {
      if (options.token === NATIVE_TOKEN_UID && options.shielded !== true) {
        yield {
          txId: 'htr-tx',
          index: 0,
          value: 100n,
          token: NATIVE_TOKEN_UID,
          address: 'htr-addr',
          authorities: 0n,
        };
      }
    }
    const storage = buildStorage(selectUtxoMock);
    const wallet = buildWallet(storage, buildShieldedAddr(0));
    const sendTransaction = new SendTransaction({
      wallet,
      outputs: [
        // A purely transparent HTR send.
        { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 10n, token: NATIVE_TOKEN_UID },
      ],
      changeShieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
    });

    const result = await sendTransaction.prepareTxData();

    // The user's mode is respected: the 90n change is converted (−2n fee) and
    // then split in halves by the structural pass (−2n more), so the tx meets
    // the two-shielded-outputs minimum. 100 = 10 + 43 + 43 + 4.
    expect(result.shieldedOutputs).toHaveLength(2);
    const values = result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b));
    expect(values).toEqual([43n, 43n]);
    const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
    expect(feeHeader.entries[0].amount).toBe(4n);
    // No transparent change survives.
    expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
  });

  test('without a mode, a transparent-only send keeps its change transparent (auto rules)', async () => {
    async function* selectUtxoMock(options: IUtxoFilterOptions) {
      if (options.token === NATIVE_TOKEN_UID && options.shielded !== true) {
        yield {
          txId: 'htr-tx',
          index: 0,
          value: 100n,
          token: NATIVE_TOKEN_UID,
          address: 'htr-addr',
          authorities: 0n,
        };
      }
    }
    // No shielded element anywhere → no crypto provider required.
    const storage = buildStorage(selectUtxoMock, { withProvider: false });
    const wallet = buildWallet(storage, buildShieldedAddr(0));
    const sendTransaction = new SendTransaction({
      wallet,
      outputs: [
        { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 10n, token: NATIVE_TOKEN_UID },
      ],
    });

    const result = await sendTransaction.prepareTxData();

    // All outputs public, no shielded inputs spent → the rules keep the
    // change transparent (100n - 10n = 90n).
    expect(result.shieldedOutputs).toBeUndefined();
    const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
    expect(change).toBeDefined();
    expect(change!.value).toBe(90n);
  });

  describe('automatic selection rules', () => {
    interface PoolUtxo {
      txId: string;
      index: number;
      value: bigint;
      token: string;
      address: string;
      authorities: bigint;
      shielded?: boolean;
      blindingFactor?: string;
      assetBlindingFactor?: string;
    }

    const poolUtxo = (
      txId: string,
      value: bigint,
      token: string,
      extra: Partial<PoolUtxo> = {}
    ): PoolUtxo => ({
      txId,
      index: 0,
      value,
      token,
      address: `addr-${txId}`,
      authorities: 0n,
      ...extra,
    });

    /**
     * A selectUtxos mock faithful to the store's filter semantics — the rules
     * engine issues pool-filtered (`shielded`), excluded (`filter_method`),
     * ordered and capped queries, so an oblivious mock would hand the same
     * UTXO to both passes.
     */
    const buildPoolStorage = (pool: PoolUtxo[]): Storage => {
      async function* selectUtxoMock(options: IUtxoFilterOptions) {
        let list = pool.filter(u => u.token === (options.token ?? NATIVE_TOKEN_UID));
        if (options.shielded === true) list = list.filter(u => u.shielded);
        if (options.shielded === false) list = list.filter(u => !u.shielded);
        if (options.filter_method) list = list.filter(u => options.filter_method!(u as never));
        if (options.order_by_value === 'asc') {
          list = [...list].sort((a, b) => Number(a.value - b.value));
        } else if (options.order_by_value === 'desc') {
          list = [...list].sort((a, b) => Number(b.value - a.value));
        }
        if (options.max_utxos !== undefined) list = list.slice(0, options.max_utxos);
        yield* list as never;
      }
      const storage = buildStorage(selectUtxoMock);
      jest
        .spyOn(storage, 'getUtxo')
        .mockImplementation(
          async ({ txId, index }) => pool.find(u => u.txId === txId && u.index === index) as never
        );
      return storage;
    };

    test('R1 — an all-shielded send draws from the shielded pool first', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-100', 100n, CUSTOM_TOKEN),
        poolUtxo('custom-sh-40', 40n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '11'.repeat(32),
        }),
        poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The shielded 40n covers the 20n send; the transparent 100n must be untouched.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds).toContain('custom-sh-40');
      expect(inputIds).not.toContain('custom-pub-100');
    });

    test('R3b — an external shielded output forces the smallest shielded input', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
        poolUtxo('custom-sh-3', 3n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '22'.repeat(32),
        }),
        poolUtxo('custom-sh-30', 30n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '33'.repeat(32),
        }),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          // Two shielded outputs to addresses the wallet does not own + one
          // transparent output: rule 3b with an external recipient.
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 5n,
            token: CUSTOM_TOKEN,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The smallest shielded UTXO (3n) is force-included even though the
      // transparent 50n covers the 25n total on its own; the remainder is transparent.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds).toContain('custom-sh-3');
      expect(inputIds).toContain('custom-pub-50');
      expect(inputIds).not.toContain('custom-sh-30');
      // No duplicates: the exclusion filter kept the passes disjoint.
      expect(new Set(inputIds).size).toBe(inputIds.length);
    });

    test('R3b — with no shielded UTXO, two shielded outputs are left whole', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-100', 100n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 20n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 5n,
            token: CUSTOM_TOKEN,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // Two shielded outputs already meet the protocol minimum, and with only
      // transparent inputs the shielded total is public either way, so
      // splitting one would only add a fee. HTR: 9 = 2 (fees) + 7.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['custom-pub-100', 'htr-pub-9']);
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        10n,
        20n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    // A mixed send with one shielded output from a wallet with no shielded UTXO
    // of the token: the token's change is shielded so the shielded amount cannot
    // be computed by subtraction; with no change, the lone output is split.
    const r3aSend = (
      pool: ReturnType<typeof poolUtxo>[],
      token: string,
      shieldedValue: bigint,
      transparentValue: bigint
    ) => {
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      return new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: shieldedValue,
            token,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: transparentValue,
            token,
          },
        ],
      }).prepareTxData();
    };
    const recipientSpend = () =>
      new Address(buildShieldedAddr(1), { network: testnetNetwork }).getSpendAddress().base58;
    const walletSpend = () =>
      new Address(buildShieldedAddr(0), { network: testnetNetwork }).getSpendAddress().base58;

    test('R3a fallback — with no shielded UTXO, the change becomes the second shielded output', async () => {
      const result = await r3aSend(
        [poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN), poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID)],
        CUSTOM_TOKEN,
        11n,
        5n
      );

      // 50 − 5 − 11 = 34n of change. Left transparent it would publish the 11n
      // by subtraction (50 − 5 − 34); shielded, the recipient and the change are
      // two unknowns. Two AS outputs either way: fee 2n. HTR: 9 = 2 + 7.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['custom-pub-50', 'htr-pub-9']);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([11n, 34n]);
      expect(byValue.get(11n)!.address).toBe(recipientSpend());
      expect(byValue.get(34n)!.address).toBe(walletSpend());
      expect(byValue.get(34n)!.token).toBe(CUSTOM_TOKEN);
      expect(byValue.get(34n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const transparentCustom = result.outputs.filter(
        o => (o as { token?: string }).token === CUSTOM_TOKEN
      );
      expect(transparentCustom.map(o => o.value)).toEqual([5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — an HTR change becomes the second shielded output', async () => {
      const result = await r3aSend(
        [poolUtxo('htr-pub-30', 30n, NATIVE_TOKEN_UID)],
        NATIVE_TOKEN_UID,
        11n,
        5n
      );

      // 30 − 16 − 1 (the recipient's fee) = 13n of change, shielded at a 1n
      // fee: the change keeps 12n. HTR: 30 = 11 + 5 + 12 + 2 (fees).
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([11n, 12n]);
      expect(byValue.get(11n)!.address).toBe(recipientSpend());
      expect(byValue.get(12n)!.address).toBe(walletSpend());
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — an HTR change too small for its own fee stays transparent and the output is split', async () => {
      const result = await r3aSend(
        [poolUtxo('htr-pub-18', 18n, NATIVE_TOKEN_UID)],
        NATIVE_TOKEN_UID,
        11n,
        5n
      );

      // The 1n change cannot pay a 1n shielded fee. It pays the split's fee
      // instead and the recipient's output is split: 18 = 5 + 6 + 5 + 2 (fees).
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      expect(result.shieldedOutputs!.every(o => o.address === recipientSpend())).toBe(true);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — with no address for a shielded change, the lone output is split', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      // Built from storage alone: no wallet to derive a change address from.
      const result = await new SendTransaction({
        storage,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 11n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 5n,
            token: CUSTOM_TOKEN,
          },
        ],
      }).prepareTxData();

      // The 34n change cannot be shielded without an address, so it stays
      // transparent and the 11n is split in halves at the recipient.
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      expect(result.shieldedOutputs!.every(o => o.address === recipientSpend())).toBe(true);
      const transparentCustom = result.outputs
        .filter(o => (o as { token?: string }).token === CUSTOM_TOKEN)
        .map(o => o.value)
        .sort((a, b) => Number(a - b));
      expect(transparentCustom).toEqual([5n, 34n]);
    });

    test('R3a fallback — with no change, the lone shielded output is split', async () => {
      const result = await r3aSend(
        [poolUtxo('custom-pub-16', 16n, CUSTOM_TOKEN), poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID)],
        CUSTOM_TOKEN,
        11n,
        5n
      );

      // 16 = 11 + 5 exactly: no custom change to shield, so the 11n is split in
      // halves at the recipient. HTR: 9 = 2 (fees) + 7.
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      expect(result.shieldedOutputs!.every(o => o.address === recipientSpend())).toBe(true);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('HTR entering only to pay fees stays in the transparent pool', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-sh-40', 40n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '44'.repeat(32),
        }),
        poolUtxo('htr-sh-20', 20n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '55'.repeat(32),
        }),
        poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds).toContain('htr-pub-20');
      expect(inputIds).not.toContain('htr-sh-20');
    });

    test('R2 — a shielded top-up shields the HTR change mirroring the FS input, split when lone', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-pub-8', 8n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-10', 10n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '66'.repeat(32),
          assetBlindingFactor: '77'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          // All-transparent HTR send that transparent funds alone cannot cover.
          { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 12n, token: NATIVE_TOKEN_UID },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // Transparent exhausted (8n) + shielded top-up (10n) = 18n. The 6n change is
      // shielded, mirroring the fully-shielded input, and — being the tx's
      // only shielded output — split: 6n − 2n (conversion fee) − 2n (split
      // fee) = 2n → halves 1n/1n. 18 = 12 + 1 + 1 + 4.
      const inputIds = result.inputs.map(i => i.txId).sort();
      expect(inputIds).toEqual(['htr-pub-8', 'htr-sh-10']);
      expect(result.shieldedOutputs).toHaveLength(2);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([1n, 1n]);
      expect(
        result.shieldedOutputs!.every(o => o.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED)
      ).toBe(true);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(4n);
      // No transparent change, no unshield header (shielded outputs exist).
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.excessBlindingFactor).toBeUndefined();
    });

    test('R2 — an exact match from a single shielded input forces a change end to end', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-sh-10', 10n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '88'.repeat(32),
        }),
        poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '99'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 10n, token: NATIVE_TOKEN_UID },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The 10n shielded UTXO matched the send exactly; spending it alone
      // would reveal its value by subtraction, so the smallest extra UTXO is
      // pulled in and the resulting change is shielded (AS — no FS input).
      // 15 = 10 + 1 + 2 + 2(fees).
      const inputIds = result.inputs.map(i => i.txId).sort();
      expect(inputIds).toEqual(['htr-sh-10', 'htr-sh-5']);
      expect(result.shieldedOutputs).toHaveLength(2);
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        2n,
      ]);
      expect(
        result.shieldedOutputs!.every(o => o.shieldedMode === ShieldedOutputMode.AMOUNT_SHIELDED)
      ).toBe(true);
    });

    test('R1 — an exact match keeps the split-fee surplus shielded instead of publishing it', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-sh-11', 11n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '12'.repeat(32),
        }),
        poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '13'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The 11n UTXO matches 10n + 1n exactly, so there is no change and the
      // lone output needs a second shielded output. The 5n shielded UTXO pulled
      // for that fee must not surface as a transparent 4n change (that would
      // publish its value): it becomes the shielded HTR change instead, and the
      // recipient's output is not split. 16 = 10 + 4 + 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-sh-11', 'htr-sh-5']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        4n,
        10n,
      ]);
      const change = result.shieldedOutputs!.find(o => o.value === 4n)!;
      expect(change.token).toBe(NATIVE_TOKEN_UID);
      expect(change.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      expect(change.address).toBe(
        new Address(buildShieldedAddr(0), { network: testnetNetwork }).getSpendAddress().base58
      );
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('fee-only HTR topped up from the shielded pool shields the surplus as HTR change', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-7', 7n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '14'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // Both tokens match exactly, so the split fee is pulled. No transparent HTR is
      // left, so the pull falls back to the shielded 7n; its 6n remainder is an
      // HTR change (not the custom token), shielded and mirroring the AS input,
      // and it is the second shielded output. HTR: 1 + 7 = 2 (fees) + 6.
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-1',
        'htr-sh-7',
      ]);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs).toHaveLength(2);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect(byValue.get(10n)!.token).toBe(CUSTOM_TOKEN);
      expect(byValue.get(6n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(6n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('a small transparent HTR change topped up from the shielded pool becomes shielded change', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '15'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The transparent 3n pays the 2n FS fee, leaving a transparent 1n change that
      // cannot fund the 2n split fee. The top-up comes from the shielded 5n, so
      // the change (1n + 5n) is shielded (AS, mirroring the input) and becomes
      // the second shielded output: 6n − 1n = 5n. HTR: 3 + 5 = 3 (fees) + 5.
      expect(result.inputs.map(i => i.txId)).toContain('htr-sh-5');
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs).toHaveLength(2);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect(byValue.get(10n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(byValue.get(5n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(5n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(3n);
    });

    test('a shielded split-fee pull that would land exactly on the fee pulls on for a change', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '1a'.repeat(32),
        }),
        poolUtxo('htr-sh-7', 7n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '1b'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // Spending only the shielded 1n on the 1n split fee would reveal it by
      // subtraction (every other HTR amount here is transparent), so the pull goes
      // on to the 7n and the remainder becomes the shielded HTR change.
      // HTR: 1 + 1 + 7 = 2 (fees) + 7.
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-1',
        'htr-sh-1',
        'htr-sh-7',
      ]);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect(result.shieldedOutputs).toHaveLength(2);
      expect(byValue.get(10n)!.token).toBe(CUSTOM_TOKEN);
      expect(byValue.get(7n)!.token).toBe(NATIVE_TOKEN_UID);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('with nothing more to pull, an exact shielded split-fee pull still splits', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '1c'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The wallet has no other HTR, so the send goes ahead with the exact
      // pull, as the main selection does when it cannot force a change.
      expect(result.inputs.map(i => i.txId)).toContain('htr-sh-1');
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('when no pull can fund a shielded change, the split fee is paid exactly', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '1d'.repeat(32),
        }),
        poolUtxo('htr-fs-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '1e'.repeat(32),
          assetBlindingFactor: '1f'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // Both shielded 1n together make a 2n change, but the fully shielded one
      // makes it fully shielded, and its 2n fee would leave nothing. No pull
      // funds a shielded change, so the 1n split fee is paid exactly, as when
      // nothing more can be pulled. HTR: 1 + 1 = 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-1',
        'htr-sh-1',
      ]);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('a fully shielded split-fee pull too small for its own change throws', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-fs-2', 2n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '20'.repeat(32),
          assetBlindingFactor: '21'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      // The 2n covers the 1n split fee with 1n over, which must not become a
      // transparent change (it is shielded value). As a fully shielded change,
      // mirroring the input, the 2n would pay a 2n fee and keep nothing, and
      // the change is not downgraded to amount-shielded.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        /HTR change is too small to fund its shielded-output fee and no additional HTR is available/
      );
    });

    test('an exact split-fee pull becomes a shielded change when that costs less', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-2', 2n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '22'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The shielded 2n would pay the 2n split fee exactly and be revealed by
      // subtraction. As an amount-shielded change it pays a 1n fee and keeps
      // 1n, so it is the second shielded output and the recipient's output is
      // not split. HTR: 2 + 2 = 3 (fees) + 1.
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-2',
        'htr-sh-2',
      ]);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        10n,
      ]);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect(byValue.get(10n)!.token).toBe(CUSTOM_TOKEN);
      expect(byValue.get(10n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(byValue.get(1n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(1n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(3n);
    });

    test('a small transparent HTR change with an exact top-up becomes a cheaper shielded change', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '23'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The transparent 3n pays the 2n FS fee and leaves a 1n change; the shielded
      // 1n would top it up to the 2n split fee exactly and be revealed by
      // subtraction. Together they make a 2n amount-shielded change that pays
      // a 1n fee and keeps 1n. HTR: 3 + 1 = 3 (fees) + 1.
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-3',
        'htr-sh-1',
      ]);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        10n,
      ]);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect(byValue.get(10n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(byValue.get(1n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(1n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(3n);
    });

    test('a pinned amount-shielded change replaces an exact split when it costs less', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-pub-12', 12n, NATIVE_TOKEN_UID),
        poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
          },
        ],
        changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
      });

      const result = await sendTransaction.prepareTxData();

      // The 12n pays 10n and the 2n FS fee exactly; the pulled 2n would pay
      // the 2n split fee exactly. As the pinned amount-shielded change it pays
      // a 1n fee and keeps 1n, and the recipient's output is not split.
      // HTR: 12 + 2 = 10 + 3 (fees) + 1.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-12', 'htr-pub-2']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        10n,
      ]);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect(byValue.get(10n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(byValue.get(1n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(3n);
    });

    test('with no address for a shielded change, an exact split-fee pull splits', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-2', 2n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '24'.repeat(32),
        }),
      ]);
      // Built from storage alone: no wallet to derive a change address from.
      const sendTransaction = new SendTransaction({
        storage,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // A cheaper shielded change would need an address, so the shielded 2n
      // pays the 2n split fee and the recipient's output is split.
      // HTR: 2 + 2 = 4 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-2',
        'htr-sh-2',
      ]);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(4n);
    });

    test('with no address for a shielded change, a shielded split-fee pull stops at the fee', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '25'.repeat(32),
        }),
        poolUtxo('htr-sh-7', 7n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '26'.repeat(32),
        }),
      ]);
      // Built from storage alone: no wallet to derive a change address from.
      const sendTransaction = new SendTransaction({
        storage,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // Pulling on past the shielded 1n would only make a change that must be
      // shielded and cannot be, so the 1n split fee is paid exactly.
      // HTR: 1 + 1 = 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-1',
        'htr-sh-1',
      ]);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('an exact split-fee landing spends an amount-shielded UTXO before a fully shielded one', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-fs-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '27'.repeat(32),
          assetBlindingFactor: '28'.repeat(32),
        }),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '29'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // No pull funds a shielded change, so the 1n split fee is paid exactly.
      // Paid with the fully shielded 1n it would also reveal that UTXO is HTR;
      // the amount-shielded 1n reveals only its amount. HTR: 1 + 1 = 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-1',
        'htr-sh-1',
      ]);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('a split-fee pull funds an amount-shielded change without a fully shielded UTXO', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '2a'.repeat(32),
        }),
        poolUtxo('htr-fs-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '2b'.repeat(32),
          assetBlindingFactor: '2c'.repeat(32),
        }),
        poolUtxo('htr-sh-1b', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '2d'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The two amount-shielded 1n fund a 2n amount-shielded change (1n fee,
      // 1n kept). Taking the fully shielded 1n as well would make the change
      // fully shielded, at a 2n fee. HTR: 1 + 1 + 1 = 2 (fees) + 1.
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-10',
        'htr-pub-1',
        'htr-sh-1',
        'htr-sh-1b',
      ]);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        10n,
      ]);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect(byValue.get(1n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(1n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('an amount-shielded HTR output takes its split fee from transparent HTR before a fully shielded UTXO', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-sh-11', 11n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '2e'.repeat(32),
        }),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-fs-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '2f'.repeat(32),
          assetBlindingFactor: '30'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The 11n pays 10n and the 1n fee exactly; the 1n split fee comes from
      // the transparent 1n. The fully shielded 1n, spent on amount-shielded HTR
      // outputs, would reveal that it is HTR. HTR: 11 + 1 = 5 + 5 + 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-1', 'htr-sh-11']);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('topping up a lone amount-shielded HTR change skips a fully shielded UTXO when it can', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-sh-12', 12n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '34'.repeat(32),
        }),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '35'.repeat(32),
        }),
        poolUtxo('htr-fs-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '36'.repeat(32),
          assetBlindingFactor: '37'.repeat(32),
        }),
        poolUtxo('htr-sh-1b', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '38'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 10n, token: NATIVE_TOKEN_UID },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The 12n leaves a 2n change, shielded (mirroring the input) as a lone 1n
      // after its fee. Splitting it needs 2n more: the two amount-shielded 1n,
      // not the fully shielded 1n, which would reveal that it is HTR.
      // HTR: 12 + 1 + 1 = 10 + 1 + 1 + 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-sh-1', 'htr-sh-12', 'htr-sh-1b']);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([1n, 1n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('the transparent override pulls transparent HTR first for the split fee', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-sh-11', 11n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '16'.repeat(32),
        }),
        poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '17'.repeat(32),
        }),
        poolUtxo('htr-pub-4', 4n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
        changeShieldedMode: OutputKind.TRANSPARENT,
      });

      const result = await sendTransaction.prepareTxData();

      // The caller pinned the change transparent, so the split fee's surplus
      // stays transparent, but it comes from the transparent 4n rather than unshielding
      // the 5n. 15 = 10 + 3 + 2 (fees).
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds).toContain('htr-pub-4');
      expect(inputIds).not.toContain('htr-sh-5');
      const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange)!;
      expect(change.value).toBe(3n);
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        5n,
      ]);
    });

    test('a split-fee pull that lands exactly on the fee still splits, with no change', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-sh-11', 11n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '18'.repeat(32),
        }),
        poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '19'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      const result = await sendTransaction.prepareTxData();

      // The pulled 1n pays the split fee exactly, so nothing is left to put in
      // a change: the lone output is split. 12 = 5 + 5 + 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-sh-1', 'htr-sh-11']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('the transparent override keeps the change transparent and unshields', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-sh-10', 10n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: 'aa'.repeat(32),
        }),
        poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 10n,
            token: CUSTOM_TOKEN,
          },
        ],
        changeShieldedMode: OutputKind.TRANSPARENT,
      });

      const result = await sendTransaction.prepareTxData();

      // The whole shielded balance is spent into a transparent output with the
      // change pinned transparent: a full unshield. No shielded outputs, the
      // excess blinding factor is computed, and no fee is owed (deposit token,
      // no shielded outputs) so no HTR is touched.
      expect(result.inputs.map(i => i.txId)).toEqual(['custom-sh-10']);
      expect(result.shieldedOutputs ?? []).toHaveLength(0);
      expect(result.excessBlindingFactor).toBeDefined();
      expect(result.headers ?? []).toHaveLength(0);
    });

    test('a legacy changeAddress on a shielded send fails loudly', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-sh-40', 40n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: 'bb'.repeat(32),
        }),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
        changeAddress: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
      });

      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        /legacy change address cannot be used/
      );
    });

    test('a new-format changeAddress hosts the shielded change itself', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-sh-40', 40n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: 'cc'.repeat(32),
        }),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const changeAddress = buildShieldedAddr(7);
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
        changeAddress,
      });

      const result = await sendTransaction.prepareTxData();

      // The 20n custom change is shielded (all custom outputs are shielded)
      // and goes to the caller's new-format changeAddress, not the wallet's
      // own shielded address.
      const expectedSpend = new Address(changeAddress, {
        network: testnetNetwork,
      }).getSpendAddress().base58;
      const change = result.shieldedOutputs!.find(o => o.value === 20n)!;
      expect(change.address).toBe(expectedSpend);
      expect(wallet.getCurrentAddress).not.toHaveBeenCalled();
    });

    test('a new-format changeAddress that is not ours is rejected', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-sh-40', 40n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: 'ee'.repeat(32),
        }),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
        changeAddress: buildShieldedAddr(7),
      });

      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        'Change address is not from the wallet'
      );
    });

    test('a legacy changeAddress fails when the RULES shield the change (R2 top-up)', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-pub-8', 8n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-10', 10n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '12'.repeat(32),
        }),
      ]);
      jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          // All-transparent send that transparent funds cannot cover: the shielded
          // top-up makes the rules decide on a shielded change AFTER the
          // static pre-selection guard has already passed.
          { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 12n, token: NATIVE_TOKEN_UID },
        ],
        changeAddress: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
      });

      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        /legacy change address cannot be used/
      );
    });

    test('a legacy changeAddress fails when a user-supplied shielded input shields the change', async () => {
      const storage = buildPoolStorage([poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID)]);
      jest.spyOn(storage, 'getTx').mockResolvedValue({
        tx_id: 'parent',
        outputs: [],
        shielded_outputs: [
          {
            mode: 1,
            commitment: '',
            range_proof: '',
            script: '',
            ephemeral_pubkey: '',
            decoded: { address: 'W-shielded-spend-addr' },
            value: 30n,
            token: CUSTOM_TOKEN,
            blindingFactor: '34'.repeat(32),
          },
        ],
        inputs: [],
      } as never);
      jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
      jest.spyOn(storage, 'getUtxo').mockResolvedValue(
        poolUtxo('parent', 30n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '34'.repeat(32),
        }) as never
      );
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 10n,
            token: CUSTOM_TOKEN,
          },
        ],
        inputs: [{ txId: 'parent', index: 0 }],
        changeAddress: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
      });

      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        /legacy change address cannot be used/
      );
    });

    test('a legacy changeAddress is accepted when a shielded HTR input leaves no change', async () => {
      const storage = buildPoolStorage([]);
      // The caller spends an owned shielded HTR slot that exactly funds the
      // payment: the rules decide on a shielded mode (a shielded input was
      // spent), but no change output exists, so the change address is never
      // used and must not cause a rejection.
      jest.spyOn(storage, 'getTx').mockResolvedValue({
        tx_id: 'parent',
        outputs: [],
        shielded_outputs: [
          {
            mode: 1,
            commitment: '',
            range_proof: '',
            script: '',
            ephemeral_pubkey: '',
            decoded: { address: 'W-shielded-spend-addr' },
            value: 10n,
            token: NATIVE_TOKEN_UID,
            blindingFactor: '56'.repeat(32),
          },
        ],
        inputs: [],
      } as never);
      jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
      jest.spyOn(storage, 'getUtxo').mockResolvedValue(
        poolUtxo('parent', 10n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '56'.repeat(32),
        }) as never
      );
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 10n, token: NATIVE_TOKEN_UID },
        ],
        inputs: [{ txId: 'parent', index: 0 }],
        changeAddress: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
      });

      const result = await sendTransaction.prepareTxData();

      // Exact match: no change of any kind, no shielded outputs, and the
      // shielded input is fully unshielded into the transparent payment.
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs ?? []).toHaveLength(0);
      expect(result.excessBlindingFactor).toBeDefined();
    });

    test('a legacy changeAddress still works when the change stays transparent', async () => {
      const storage = buildPoolStorage([poolUtxo('htr-pub-100', 100n, NATIVE_TOKEN_UID)]);
      jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 10n, token: NATIVE_TOKEN_UID },
        ],
        changeAddress: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
      });

      const result = await sendTransaction.prepareTxData();

      const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
      expect(change).toBeDefined();
      expect((change as { address?: string }).address).toBe('WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi');
      expect(result.shieldedOutputs ?? []).toHaveLength(0);
    });

    test('a user-supplied shielded input shields the change of its token', async () => {
      const pool = [poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID)];
      const storage = buildPoolStorage(pool);
      // The user-supplied input spends an owned shielded slot of the custom
      // token; the wallet must not select anything for that token, but the
      // change rules still see the shielded spend.
      jest.spyOn(storage, 'getTx').mockResolvedValue({
        tx_id: 'parent',
        outputs: [],
        shielded_outputs: [
          {
            mode: 1,
            commitment: '',
            range_proof: '',
            script: '',
            ephemeral_pubkey: '',
            decoded: { address: 'W-shielded-spend-addr' },
            value: 30n,
            token: CUSTOM_TOKEN,
            blindingFactor: 'dd'.repeat(32),
          },
        ],
        inputs: [],
      } as never);
      jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);
      jest.spyOn(storage, 'getUtxo').mockResolvedValue(
        poolUtxo('parent', 30n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: 'dd'.repeat(32),
        }) as never
      );
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 10n,
            token: CUSTOM_TOKEN,
          },
        ],
        inputs: [{ txId: 'parent', index: 0 }],
      });

      const result = await sendTransaction.prepareTxData();

      // The 20n custom change is shielded (AS — the spent input carried no
      // asset blinding factor) and split by the structural pass, its split fee
      // shaved from the transparent HTR change. Nothing extra was selected for
      // the custom token.
      expect(result.inputs.filter(i => i.token === CUSTOM_TOKEN)).toHaveLength(1);
      expect(result.shieldedOutputs).toHaveLength(2);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([10n, 10n]);
      expect(
        result.shieldedOutputs!.every(
          o => o.token === CUSTOM_TOKEN && o.shieldedMode === ShieldedOutputMode.AMOUNT_SHIELDED
        )
      ).toBe(true);
    });
  });
});
