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
  MAX_INPUTS,
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
  ensureShieldedOutputMinimum,
  type IShieldedMinimumContext,
  prepareSendTokensData,
} from '../../src/new/sendTransaction';
import {
  ChangeOutputMode,
  IShieldedCryptoProvider,
  OutputKind,
  ShieldedOutputMode,
} from '../../src/shielded/types';
import { MemoryStore, Storage } from '../../src/storage';
import {
  IDataInput,
  IDataTx,
  IHistoryTx,
  IStorage,
  IUtxo,
  IUtxoFilterOptions,
  TokenVersion,
  WalletType,
} from '../../src/types';
import { SendTxError, ShieldedChangeUnavailableError } from '../../src/errors';
import FeeHeader from '../../src/headers/fee';
import { Fee } from '../../src/utils/fee';
import walletHelpers from '../../src/utils/helpers';
import { encodeShieldedAddress } from '../../src/utils/shieldedAddress';
import transaction from '../../src/utils/transaction';
import txApi from '../../src/api/txApi';
import { OutputType } from '../../src/wallet/types';
import type HathorWallet from '../../src/new/wallet';
import { mockGetToken } from '../__mock_helpers__/get-token.mock';
import FakeHathorWallet from '../__mock_helpers__/fake_hathorwallet';

// The message of the error that fails a send whose change stands in for a
// missing shielded input, and so must be shielded, when the change cannot be:
// `whyNot` says why. It ends with the way to keep the change transparent, or
// with `hint` '.' where a change kept transparent cannot build the send either.
const KEEP_TRANSPARENT_HINT =
  '; pass changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.';
const standInChangeMessage = (whyNot: string, hint = KEEP_TRANSPARENT_HINT) =>
  "The change must be shielded (so the amount of its token's only shielded output cannot be " +
  `computed by subtraction), but ${whyNot}${hint}`;
const STAND_IN_CHANGE_FOR_A_MULTISIG_WALLET = standInChangeMessage(
  'a shielded change is not supported for multisig wallets'
);
const STAND_IN_CHANGE_WITHOUT_A_SHIELDED_ADDRESS = standInChangeMessage(
  'the wallet has no shielded address to receive it'
);
const STAND_IN_CHANGE_AT_THE_LIMIT = standInChangeMessage(
  `the transaction already has the maximum ${MAX_SHIELDED_OUTPUTS} shielded outputs`
);
// An HTR change too small for its own fee, with no HTR to add to it.
const HTR_CHANGE_TOO_SMALL =
  'it is too small to fund its shielded-output fee and no additional HTR is available to ' +
  'cover the difference';
const HTR_CHANGE_OF_CALLER_HTR_TOO_SMALL =
  'it is too small to fund its shielded-output fee, and HTR inputs were user-supplied so no ' +
  'additional HTR can be selected to cover the difference';
// No HTR change at all, and no HTR to make one from.
const NO_HTR_CHANGE = 'no HTR change is left and no additional HTR is available to make one';
const NO_HTR_CHANGE_OF_CALLER_HTR =
  'no HTR change is left, and HTR inputs were user-supplied so no additional HTR can be ' +
  'selected to make one';
const UNFUNDED_STAND_IN_CHANGE = standInChangeMessage(HTR_CHANGE_TOO_SMALL);
const UNFUNDED_STAND_IN_CHANGE_OF_CALLER_HTR = standInChangeMessage(
  HTR_CHANGE_OF_CALLER_HTR_TOO_SMALL
);

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
  // All HTR outputs are shielded, so the rules shield the HTR change too; it
  // goes to the wallet's current shielded address, read from storage.
  jest
    .spyOn(storage, 'getCurrentAddress')
    .mockImplementation((async (_markAsUsed?: boolean, opts?: { legacy?: boolean }) =>
      opts?.legacy === false ? buildAddr(2) : 'W-change-address') as never);
  jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

  const sendTransaction = new SendTransaction({
    storage,
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

  // The send's failure paths wait for releaseUtxos before reporting their own error (e.g.
  // handlePushTx rejects only after it), so it must never reject, even if logging fails.
  it('should never reject, even when the logger throws, and still release the rest', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    const utxoSelectSpy = jest
      .spyOn(storage, 'utxoSelectAsInput')
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);
    jest.spyOn(storage.logger, 'debug').mockImplementation(() => {
      throw new Error('logger down');
    });

    const sendTx = new SendTransaction({ storage, outputs: [], inputs: [] });
    sendTx.transaction = {
      inputs: [
        { hash: 'tx1', index: 0 },
        { hash: 'tx2', index: 1 },
      ],
    } as unknown as import('../../src/models/transaction').default;

    await expect(sendTx.releaseUtxos()).resolves.toBeUndefined();
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

  type FakeUtxo = {
    txId: string;
    index: number;
    value: bigint;
    token: string;
    address: string;
    authorities: bigint;
    shielded?: boolean;
    assetBlindingFactor?: string;
  };

  // Storage stub whose `selectUtxos` yields the given HTR UTXOs, honoring the
  // caller's `filter_method` (exclusion of already-used UTXOs), `shielded`
  // (the pool) AND `order_by_value` (value sort) the same way the real storage
  // does — so a regression in the pull-loop's pools or ordering is observable.
  const mockStorage = (
    utxos: FakeUtxo[] = [],
    shieldedAddress = buildShieldedAddress(),
    walletType = WalletType.P2PKH
  ) =>
    ({
      // eslint-disable-next-line @typescript-eslint/require-await
      async getWalletType() {
        return walletType;
      },
      // The wallet's current shielded address, where a shielded change goes.
      // eslint-disable-next-line @typescript-eslint/require-await
      async getCurrentAddress() {
        return shieldedAddress;
      },
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
          if (options.shielded === true && !utxo.shielded) continue;
          if (options.shielded === false && utxo.shielded) continue;
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
      testnetNetwork,
      mockStorage([], knownShieldedAddr)
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

  test('H.4h — change <= fee, no extra HTR, shielding not required → the change is left as it is', async () => {
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];
    // A 1n UTXO cannot clear the 2n fee either (1 + 1 is not above 2).
    const storageWithDust = mockStorage([
      {
        txId: 'dust-htr',
        index: 0,
        value: 1n,
        token: NATIVE_TOKEN_UID,
        address: 'dust-addr',
        authorities: 0n,
      },
    ]);

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.FULLY_SHIELDED,
      testnetNetwork,
      storageWithDust,
      [],
      true,
      OutputKind.TRANSPARENT,
      null,
      false // shieldingRequired
    );

    expect(result.addedFee).toBe(0n);
    // The transparent change stays, and the failed pull added no input.
    expect(partialHtrTxData.outputs).toEqual([buildHtrChangeOutput(1n)]);
    expect(partialHtrTxData.inputs).toHaveLength(0);
    expect(defs).toHaveLength(2);
  });

  test('H.4i — change <= fee, HTR user-supplied, shielding not required → left as it is, nothing pulled', async () => {
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED),
    ];
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

    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      defs,
      ShieldedOutputMode.FULLY_SHIELDED,
      testnetNetwork,
      storageWithHtr,
      [],
      false, // canSelectMoreHtr
      OutputKind.TRANSPARENT,
      null,
      false // shieldingRequired
    );

    expect(result.addedFee).toBe(0n);
    expect(partialHtrTxData.outputs).toEqual([buildHtrChangeOutput(1n)]);
    expect(partialHtrTxData.inputs).toHaveLength(0);
    expect(defs).toHaveLength(2);
  });

  test('H.4k — a change standing in for a missing shielded input that cannot fund its fee fails saying why it must be shielded', async () => {
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED)];
    const convert = (canSelectMoreHtr: boolean) =>
      convertHtrChangeIfRequested(
        partialHtrTxData,
        defs,
        ShieldedOutputMode.AMOUNT_SHIELDED,
        testnetNetwork,
        mockStorage([]), // no extra HTR available
        [],
        canSelectMoreHtr,
        OutputKind.TRANSPARENT,
        null,
        true,
        '; pass changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.',
        undefined,
        true // standsIn
      );

    await expect(convert(true)).rejects.toThrow(new SendTxError(UNFUNDED_STAND_IN_CHANGE));
    await expect(convert(false)).rejects.toThrow(
      new SendTxError(UNFUNDED_STAND_IN_CHANGE_OF_CALLER_HTR)
    );
    // Nothing mutated on the failure paths.
    expect(partialHtrTxData.outputs).toEqual([buildHtrChangeOutput(1n)]);
    expect(partialHtrTxData.inputs).toHaveLength(0);
    expect(defs).toHaveLength(1);
  });

  test('H.4l — a change standing in for the only shielded output is not told to stay transparent when the split could not be funded either', async () => {
    // Kept transparent, the 1n change would leave the lone fully shielded
    // output to be split, at a 2n fee.
    const convert = (
      defs: ReturnType<typeof buildShieldedDef>[],
      extraHtr: FakeUtxo[],
      canSelectMoreHtr = true
    ) =>
      convertHtrChangeIfRequested(
        { inputs: [] as IDataInput[], outputs: [buildHtrChangeOutput(1n)] },
        defs,
        ShieldedOutputMode.FULLY_SHIELDED,
        testnetNetwork,
        mockStorage(extraHtr),
        [],
        canSelectMoreHtr,
        OutputKind.TRANSPARENT,
        null,
        true,
        KEEP_TRANSPARENT_HINT,
        undefined,
        true // standsIn
      );
    const lone = () => [buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED)];
    const extraHtrOf = (value: bigint): FakeUtxo => ({
      txId: `extra-htr-${value}`,
      index: 0,
      value,
      token: NATIVE_TOKEN_UID,
      address: 'extra-htr-address',
      authorities: 0n,
    });

    // No HTR to add: the split's 2n fee cannot be paid either.
    await expect(convert(lone(), [])).rejects.toThrow(
      new SendTxError(standInChangeMessage(HTR_CHANGE_TOO_SMALL, '.'))
    );
    await expect(convert(lone(), [], false)).rejects.toThrow(
      new SendTxError(standInChangeMessage(HTR_CHANGE_OF_CALLER_HTR_TOO_SMALL, '.'))
    );
    // With 1n more, the change still cannot pay its own 2n fee, but kept
    // transparent it would pay the split's.
    await expect(convert(lone(), [extraHtrOf(1n)])).rejects.toThrow(
      new SendTxError(UNFUNDED_STAND_IN_CHANGE)
    );
    // Beside another shielded output, nothing is split.
    await expect(
      convert([...lone(), buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED)], [])
    ).rejects.toThrow(new SendTxError(UNFUNDED_STAND_IN_CHANGE));
    // Nor can a lone 1-unit output be split, so its change is never told to
    // stay transparent.
    await expect(
      convert(
        [{ ...buildShieldedDef(ShieldedOutputMode.FULLY_SHIELDED), value: 1n }],
        [extraHtrOf(1n)]
      )
    ).rejects.toThrow(new SendTxError(standInChangeMessage(HTR_CHANGE_TOO_SMALL, '.')));
  });

  test('H.4j — pulls from the preferred pool first, past a smaller UTXO in the other', async () => {
    const shielded: FakeUtxo = {
      txId: 'sh-htr-tx',
      index: 0,
      value: 2n,
      token: NATIVE_TOKEN_UID,
      address: 'sh-addr',
      authorities: 0n,
      shielded: true,
    };
    const transparent: FakeUtxo = {
      txId: 'pub-htr-tx',
      index: 0,
      value: 5n,
      token: NATIVE_TOKEN_UID,
      address: 'pub-addr',
      authorities: 0n,
    };
    const pulledWith = async (preference: OutputKind) => {
      const partialHtrTxData = {
        inputs: [] as IDataInput[],
        outputs: [buildHtrChangeOutput(1n)],
      };
      await convertHtrChangeIfRequested(
        partialHtrTxData,
        [
          buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
          buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
        ],
        ShieldedOutputMode.AMOUNT_SHIELDED,
        testnetNetwork,
        mockStorage([shielded, transparent]),
        [],
        true,
        preference
      );
      return partialHtrTxData.inputs.map(i => i.txId);
    };

    // The 1n change cannot pay its 1n fee, so one UTXO is pulled: from the
    // preferred pool, even though the other pool holds a smaller one.
    expect(await pulledWith(OutputKind.TRANSPARENT)).toEqual(['pub-htr-tx']);
    expect(await pulledWith(OutputKind.SHIELDED)).toEqual(['sh-htr-tx']);
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
        testnetNetwork,
        mockStorage()
      )
    ).rejects.toThrow('maximum');
    // Untouched: transparent change kept, no def appended.
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(defs).toHaveLength(MAX_SHIELDED_OUTPUTS);
  });

  test('H.8 — refuses a shielded change for a multisig wallet, even to an explicit address', async () => {
    const partialHtrTxData = {
      inputs: [],
      outputs: [buildHtrChangeOutput(100n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
    ];
    // The multisig wallet's shielded address is single-signature.
    const shieldedAddress = buildShieldedAddress();

    await expect(
      convertHtrChangeIfRequested(
        partialHtrTxData,
        defs,
        ShieldedOutputMode.AMOUNT_SHIELDED,
        testnetNetwork,
        mockStorage([], shieldedAddress, WalletType.MULTISIG),
        [],
        true,
        OutputKind.TRANSPARENT,
        shieldedAddress
      )
    ).rejects.toThrow('A shielded change is not supported for multisig wallets.');
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(defs).toHaveLength(2);
  });

  test('H.9 — assertDestination runs once the change can pay its fee, before its address is resolved', async () => {
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const defs = [
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
      buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
    ];
    const storage = mockStorage([
      {
        txId: 'extra-htr-tx',
        index: 0,
        value: 5n,
        token: NATIVE_TOKEN_UID,
        address: 'extra-htr-address',
        authorities: 0n,
      },
    ]);
    const getCurrentAddress = jest.spyOn(storage, 'getCurrentAddress');
    const pulledWhenAsserted: string[] = [];
    const assertDestination = jest.fn(async () => {
      pulledWhenAsserted.push(...partialHtrTxData.inputs.map(i => i.txId));
      throw new SendTxError('The destination cannot receive it.');
    });

    // The 1n change cannot pay its 1n fee until the 5n is pulled into it.
    await expect(
      convertHtrChangeIfRequested(
        partialHtrTxData,
        defs,
        ShieldedOutputMode.AMOUNT_SHIELDED,
        testnetNetwork,
        storage,
        [],
        true,
        OutputKind.TRANSPARENT,
        null,
        false,
        '.',
        assertDestination
      )
    ).rejects.toThrow('The destination cannot receive it.');
    expect(assertDestination).toHaveBeenCalledTimes(1);
    expect(pulledWhenAsserted).toEqual(['extra-htr-tx']);
    expect(getCurrentAddress).not.toHaveBeenCalled();
    expect(partialHtrTxData.outputs).toEqual([buildHtrChangeOutput(1n)]);
    expect(defs).toHaveLength(2);
  });

  test('H.9b — a change left as it is never reaches assertDestination', async () => {
    const partialHtrTxData = {
      inputs: [] as IDataInput[],
      outputs: [buildHtrChangeOutput(1n)],
    };
    const assertDestination = jest.fn(async () => {});

    // No HTR can be pulled, and shielding is not required.
    const result = await convertHtrChangeIfRequested(
      partialHtrTxData,
      [
        buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
        buildShieldedDef(ShieldedOutputMode.AMOUNT_SHIELDED),
      ],
      ShieldedOutputMode.AMOUNT_SHIELDED,
      testnetNetwork,
      mockStorage([]),
      [],
      true,
      OutputKind.TRANSPARENT,
      null,
      false,
      '.',
      assertDestination
    );

    expect(result.addedFee).toBe(0n);
    expect(partialHtrTxData.outputs).toEqual([buildHtrChangeOutput(1n)]);
    expect(assertDestination).not.toHaveBeenCalled();
  });
});

describe('ensureShieldedOutputMinimum', () => {
  const testnetNetwork = new Network('testnet');
  const CUSTOM_TOKEN = 'ab'.repeat(32);
  const walletShieldedAddress = encodeShieldedAddress(
    new PrivateKey().toPublicKey().toBuffer(),
    new PrivateKey().toPublicKey().toBuffer(),
    testnetNetwork
  );

  type FakeUtxo = { txId: string; value: bigint; shielded?: boolean };

  // Storage stub: the wallet's shielded and transparent change addresses, and
  // HTR UTXOs filtered by pool and by the pull's exclusion of used UTXOs.
  const mockStorage = (utxos: FakeUtxo[] = []) =>
    ({
      getWalletType: jest.fn().mockResolvedValue(WalletType.P2PKH),
      getCurrentAddress: jest.fn().mockResolvedValue(walletShieldedAddress),
      getChangeAddress: jest.fn().mockResolvedValue('transparent-change-address'),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *selectUtxos(options: IUtxoFilterOptions) {
        for (const fake of utxos) {
          const utxo = {
            index: 0,
            token: NATIVE_TOKEN_UID,
            address: `addr-${fake.txId}`,
            authorities: 0n,
            ...fake,
          } as unknown as IUtxo;
          if (options.shielded !== undefined && !!fake.shielded !== options.shielded) continue;
          if (options.filter_method && !options.filter_method(utxo)) continue;
          yield utxo;
        }
      },
    }) as unknown as IStorage;

  const recipientDef = (value: bigint, shieldedMode = ShieldedOutputMode.AMOUNT_SHIELDED) => ({
    address: 'spend-P2PKH-of-recipient',
    value,
    token: CUSTOM_TOKEN,
    scanPubkey: 'aa'.repeat(33),
    shieldedMode,
  });

  const htrChangeOutput = (value: bigint) => ({
    type: 'p2pkh' as const,
    address: 'transparent-change-address',
    value,
    token: NATIVE_TOKEN_UID,
    authorities: 0n,
    timelock: null,
    isChange: true,
  });

  // The state the pass sees after the HTR selection of a send whose HTR the
  // wallet selects, with no change mode pinned and no change address given.
  const buildContext = (
    overrides: Partial<IShieldedMinimumContext> = {}
  ): IShieldedMinimumContext => ({
    storage: mockStorage(),
    network: testnetNetwork,
    shieldedOutputDefs: [],
    partialHtrTxData: { inputs: [], outputs: [] },
    partialInputs: [],
    htrChangeMode: OutputKind.TRANSPARENT,
    htrStandsIn: false,
    changeModeOverride: null,
    htrPreference: OutputKind.TRANSPARENT,
    shouldChooseHTRInputs: true,
    changeAddress: null,
    shieldedChangeAddress: null,
    legacyChangeAddress: false,
    keepTransparentHint:
      '; pass changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.',
    walletCanHostShieldedChange: () => Promise.resolve(true),
    assertChangeAddressSupportsShieldedChange: () => Promise.resolve(),
    ...overrides,
  });

  test('leaves a transaction with two shielded outputs as it is', async () => {
    const ctx = buildContext({
      shieldedOutputDefs: [recipientDef(10n), recipientDef(10n)],
      partialHtrTxData: { inputs: [], outputs: [htrChangeOutput(5n)] },
    });

    await expect(ensureShieldedOutputMinimum(ctx)).resolves.toBe(0n);
    expect(ctx.shieldedOutputDefs.map(d => d.value)).toEqual([10n, 10n]);
    expect(ctx.partialHtrTxData.outputs[0].value).toBe(5n);
  });

  test('takes the split fee from the transparent HTR change and splits the lone output', async () => {
    const walletCanHostShieldedChange = jest.fn().mockResolvedValue(true);
    const ctx = buildContext({
      shieldedOutputDefs: [recipientDef(10n)],
      partialHtrTxData: { inputs: [], outputs: [htrChangeOutput(5n)] },
      walletCanHostShieldedChange,
    });

    await expect(ensureShieldedOutputMinimum(ctx)).resolves.toBe(FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(ctx.partialHtrTxData.outputs[0].value).toBe(5n - FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(ctx.shieldedOutputDefs.map(d => [d.token, d.value])).toEqual([
      [CUSTOM_TOKEN, 5n],
      [CUSTOM_TOKEN, 5n],
    ]);
    // No change is shielded, so hosting one is not asked about.
    expect(walletCanHostShieldedChange).not.toHaveBeenCalled();
  });

  test('shields the HTR change as the second output of a 1-unit output', async () => {
    const assertChangeAddressSupportsShieldedChange = jest.fn().mockResolvedValue(undefined);
    const ctx = buildContext({
      shieldedOutputDefs: [recipientDef(1n)],
      partialHtrTxData: { inputs: [], outputs: [htrChangeOutput(5n)] },
      assertChangeAddressSupportsShieldedChange,
    });

    // The change pays its own amount-shielded fee; the 1-unit output stays whole.
    await expect(ensureShieldedOutputMinimum(ctx)).resolves.toBe(FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(assertChangeAddressSupportsShieldedChange).toHaveBeenCalledWith(false);
    expect(ctx.partialHtrTxData.outputs).toHaveLength(0);
    expect(ctx.shieldedOutputDefs).toHaveLength(2);
    expect(ctx.shieldedOutputDefs[0].value).toBe(1n);
    expect(ctx.shieldedOutputDefs[1]).toMatchObject({
      token: NATIVE_TOKEN_UID,
      value: 5n - FEE_PER_AMOUNT_SHIELDED_OUTPUT,
      shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
      shieldedAddress: walletShieldedAddress,
      isChange: true,
    });
  });

  test('a lone shielded HTR change pays its own split fee', async () => {
    const ctx = buildContext({
      shieldedOutputDefs: [{ ...recipientDef(10n), token: NATIVE_TOKEN_UID, isChange: true }],
    });

    await expect(ensureShieldedOutputMinimum(ctx)).resolves.toBe(FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(ctx.shieldedOutputDefs.map(d => d.value)).toEqual([4n, 5n]);
    expect(ctx.partialHtrTxData.inputs).toHaveLength(0);
  });

  test('HTR pulled from the shielded pool for the split fee becomes the second output', async () => {
    const ctx = buildContext({
      storage: mockStorage([{ txId: 'htr-sh-5', value: 5n, shielded: true }]),
      shieldedOutputDefs: [recipientDef(10n)],
    });

    // Spending the shielded 5n on the 1n split fee alone would publish its
    // remainder in a transparent change, so the change is shielded instead and
    // the recipient's output stays whole.
    await expect(ensureShieldedOutputMinimum(ctx)).resolves.toBe(FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(ctx.partialHtrTxData.inputs.map(i => i.txId)).toEqual(['htr-sh-5']);
    expect(ctx.partialHtrTxData.outputs).toHaveLength(0);
    expect(ctx.shieldedOutputDefs.map(d => [d.token, d.value])).toEqual([
      [CUSTOM_TOKEN, 10n],
      [NATIVE_TOKEN_UID, 5n - FEE_PER_AMOUNT_SHIELDED_OUTPUT],
    ]);
  });

  test('fails when caller-supplied HTR leaves a change too small for the split fee', async () => {
    const ctx = buildContext({
      shieldedOutputDefs: [recipientDef(10n, ShieldedOutputMode.FULLY_SHIELDED)],
      partialHtrTxData: { inputs: [], outputs: [htrChangeOutput(1n)] },
      shouldChooseHTRInputs: false,
    });

    await expect(ensureShieldedOutputMinimum(ctx)).rejects.toThrow(
      'The HTR change cannot fund the shielded-output split the protocol requires, and HTR ' +
        'inputs were user-supplied so no additional HTR can be selected.'
    );
    expect(ctx.shieldedOutputDefs).toHaveLength(1);
    expect(ctx.partialHtrTxData.outputs[0].value).toBe(1n);
  });

  // The lone shielded HTR output of a send whose HTR change stands in for the
  // missing shielded input; the HTR selection left no change.
  const standInContext = (overrides: Partial<IShieldedMinimumContext> = {}) =>
    buildContext({
      shieldedOutputDefs: [{ ...recipientDef(11n), token: NATIVE_TOKEN_UID }],
      htrChangeMode: ShieldedOutputMode.AMOUNT_SHIELDED,
      htrStandsIn: true,
      ...overrides,
    });

  test('pulls HTR for a change standing in for a missing shielded input until it pays its own fee', async () => {
    const ctx = standInContext({
      storage: mockStorage([
        { txId: 'htr-pub-1', value: 1n },
        { txId: 'htr-pub-5', value: 5n },
      ]),
    });

    // The 1n alone would pay the split's 1n fee exactly, and the halves of the
    // 11n would add up to its amount. The change takes the 5n too and pays its
    // own fee: 1 + 5 − 1 = 5n. The 11n stays whole.
    await expect(ensureShieldedOutputMinimum(ctx)).resolves.toBe(FEE_PER_AMOUNT_SHIELDED_OUTPUT);
    expect(ctx.partialHtrTxData.inputs.map(i => i.txId)).toEqual(['htr-pub-1', 'htr-pub-5']);
    expect(ctx.partialHtrTxData.outputs).toHaveLength(0);
    expect(ctx.shieldedOutputDefs.map(d => [d.token, d.value, d.isChange])).toEqual([
      [NATIVE_TOKEN_UID, 11n, undefined],
      [NATIVE_TOKEN_UID, 5n, true],
    ]);
  });

  // Kept transparent instead, the 11n would be split at a 1n fee: the error
  // suggests that only when the HTR left would pay it.
  test.each([
    [
      'the HTR left would only pay the fee of a split',
      { storage: mockStorage([{ txId: 'htr-pub-1', value: 1n }]) },
      UNFUNDED_STAND_IN_CHANGE,
    ],
    [
      'the wallet has no HTR left',
      { storage: mockStorage([]) },
      standInChangeMessage(NO_HTR_CHANGE, '.'),
    ],
    [
      'the caller supplied the HTR inputs',
      { storage: mockStorage([{ txId: 'htr-pub-5', value: 5n }]), shouldChooseHTRInputs: false },
      standInChangeMessage(NO_HTR_CHANGE_OF_CALLER_HTR, '.'),
    ],
  ])(
    'a change standing in for a missing shielded input fails when %s',
    async (_, overrides, message) => {
      const ctx = standInContext(overrides);

      await expect(ensureShieldedOutputMinimum(ctx)).rejects.toThrow(new SendTxError(message));
      expect(ctx.shieldedOutputDefs.map(d => d.value)).toEqual([11n]);
      expect(ctx.partialHtrTxData.inputs).toHaveLength(0);
    }
  );

  test('a 1-unit output whose change stands in for a missing shielded input is funded before its change address is checked', async () => {
    const assertChangeAddressSupportsShieldedChange = jest
      .fn()
      .mockRejectedValue(new SendTxError('The change address cannot receive it.'));
    const oneUnitContext = (htr: FakeUtxo[]) =>
      standInContext({
        storage: mockStorage(htr),
        shieldedOutputDefs: [{ ...recipientDef(1n), token: NATIVE_TOKEN_UID }],
        legacyChangeAddress: true,
        assertChangeAddressSupportsShieldedChange,
      });

    // No HTR to make the change from: that fails it, whatever the address, and
    // a 1-unit output cannot be split instead, so keeping the change
    // transparent is no way out.
    await expect(ensureShieldedOutputMinimum(oneUnitContext([]))).rejects.toThrow(
      new SendTxError(standInChangeMessage(NO_HTR_CHANGE, '.'))
    );
    expect(assertChangeAddressSupportsShieldedChange).not.toHaveBeenCalled();
    // Funded, the change goes to the address check as a change standing in.
    await expect(
      ensureShieldedOutputMinimum(oneUnitContext([{ txId: 'htr-pub-5', value: 5n }]))
    ).rejects.toThrow('The change address cannot receive it.');
    expect(assertChangeAddressSupportsShieldedChange).toHaveBeenCalledWith(true);
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
  // A second DEPOSIT token, for sends that select two custom tokens.
  const OTHER_CUSTOM_TOKEN = 'ef'.repeat(32);
  // A FEE-version token: each transparent output of it costs FEE_PER_OUTPUT,
  // and spending it with no transparent output costs that once (the melt fee).
  const FEE_TOKEN = 'cd'.repeat(32);

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
    if (uid === OTHER_CUSTOM_TOKEN) {
      return { version: TokenVersion.DEPOSIT, uid, symbol: 'OTK', name: 'Other custom' };
    }
    if (uid === FEE_TOKEN) {
      return { version: TokenVersion.FEE, uid, symbol: 'FTK', name: 'Fee token' };
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
    // custom-token change built here is later converted/removed by A1. The
    // wallet has no shielded keys, so no shielded address is loaded and the
    // store throws for the shielded chain.
    jest.spyOn(storage, 'getCurrentAddress').mockImplementation((async (
      _markAsUsed?: boolean,
      opts?: { legacy?: boolean }
    ) => {
      if (opts?.legacy === false) {
        throw new Error('Current shielded address is not loaded (index=0).');
      }
      return 'W-transparent-change';
    }) as never);
    jest.spyOn(storage, 'getScanXPubKey').mockResolvedValue(undefined);
    jest.spyOn(storage, 'getSpendXPubKey').mockResolvedValue(undefined);
    jest.spyOn(storage, 'getToken').mockImplementation(getTokenImpl as never);
    if (withProvider) {
      storage.shieldedCryptoProvider = makeCryptoProvider();
    }
    return storage;
  };

  // A storage whose wallet holds `shieldedAddr` as its current shielded address.
  const withShieldedAddress = (storage: Storage, shieldedAddr: string) => {
    jest
      .spyOn(storage, 'getCurrentAddress')
      .mockImplementation((async (_markAsUsed?: boolean, opts?: { legacy?: boolean }) =>
        opts?.legacy === false ? shieldedAddr : 'W-transparent-change') as never);
    return storage;
  };

  // A storage whose wallet has both shielded keys but no shielded address in
  // its store, so the store itself refuses the shielded read.
  const withShieldedKeysOnly = (storage: Storage) => {
    jest.spyOn(storage, 'getScanXPubKey').mockResolvedValue('scan-xpub');
    jest.spyOn(storage, 'getSpendXPubKey').mockResolvedValue('spend-xpub');
    jest
      .spyOn(storage, 'getCurrentAddress')
      .mockImplementation((async (markAsUsed?: boolean, opts?: { legacy?: boolean }) =>
        opts?.legacy === false
          ? storage.store.getCurrentAddress(markAsUsed, opts)
          : 'W-transparent-change') as never);
    return storage;
  };

  // A storage whose wallet has both shielded keys and a shielded address in its
  // store, but whose shielded address cannot be read: the store fails. The
  // first `readableReads` shielded reads succeed, every later one fails.
  const SHIELDED_ADDRESS_READ_FAILURE = 'the store is unavailable';
  const withUnreadableShieldedAddress = (storage: Storage, readableReads = 0) => {
    jest.spyOn(storage, 'getScanXPubKey').mockResolvedValue('scan-xpub');
    jest.spyOn(storage, 'getSpendXPubKey').mockResolvedValue('spend-xpub');
    jest
      .spyOn(storage.store, 'addressCount')
      .mockImplementation(async opts => (opts?.legacy === false ? 1 : 0));
    let shieldedReads = 0;
    jest.spyOn(storage, 'getCurrentAddress').mockImplementation((async (
      _markAsUsed?: boolean,
      opts?: { legacy?: boolean }
    ) => {
      if (opts?.legacy === false) {
        shieldedReads += 1;
        if (shieldedReads > readableReads) {
          throw new Error(SHIELDED_ADDRESS_READ_FAILURE);
        }
        return buildShieldedAddr(0);
      }
      return 'W-transparent-change';
    }) as never);
    return storage;
  };

  const buildWallet = (storage: Storage, shieldedAddr: string) => {
    withShieldedAddress(storage, shieldedAddr);
    return {
      storage,
      getCurrentAddress: jest.fn().mockResolvedValue({
        address: shieldedAddr,
        index: 0,
        addressPath: 'm/0',
      }),
    } as unknown as import('../../src/new/wallet').default;
  };

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
      /** Not available to spend (locked, or held by another send). */
      locked?: boolean;
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
     * available-only, ordered and capped queries, so an oblivious mock would
     * hand the same UTXO to both passes.
     */
    const buildPoolStorage = (pool: PoolUtxo[]): Storage => {
      async function* selectUtxoMock(options: IUtxoFilterOptions) {
        let list = pool.filter(u => u.token === (options.token ?? NATIVE_TOKEN_UID));
        if (options.only_available_utxos) list = list.filter(u => !u.locked);
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

    test('R3b — with no shielded UTXO, two 1n shielded outputs build as they are', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 1n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 1n,
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

      // A 1n output cannot be split, and none needs to be: two outputs meet the
      // protocol minimum. Custom: 10 = 1 + 1 + 5 + 3 (change). HTR: 5 = 2 + 3.
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([1n, 1n]);
      const transparentCustom = result.outputs
        .filter(o => (o as { token?: string }).token === CUSTOM_TOKEN)
        .map(o => o.value)
        .sort((a, b) => Number(a - b));
      expect(transparentCustom).toEqual([3n, 5n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3b — with no shielded UTXO, 32 shielded outputs build at the limit', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-100', 100n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-40', 40n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const shieldedOutputs = Array.from({ length: MAX_SHIELDED_OUTPUTS }, (_, i) => ({
        address: buildShieldedAddr(1 + (i % 2)),
        value: 1n,
        token: CUSTOM_TOKEN,
        shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
      }));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          ...shieldedOutputs,
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 5n,
            token: CUSTOM_TOKEN,
          },
        ],
      }).prepareTxData();

      // Nothing is split or added at the limit. Custom: 100 = 32 + 5 + 63
      // (change). HTR: 40 = 32 (fees) + 8.
      expect(result.shieldedOutputs).toHaveLength(MAX_SHIELDED_OUTPUTS);
      const transparentCustom = result.outputs
        .filter(o => (o as { token?: string }).token === CUSTOM_TOKEN)
        .map(o => o.value)
        .sort((a, b) => Number(a - b));
      expect(transparentCustom).toEqual([5n, 63n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(32n);
    });

    // A mixed send with one shielded output from a wallet with no shielded UTXO
    // of the token: the token's change is shielded so the shielded amount cannot
    // be computed by subtraction; with no change, the structural pass adds the
    // second shielded output.
    const r3aSendFrom = (
      storage: Storage,
      token: string = CUSTOM_TOKEN,
      shieldedValue: bigint = 11n,
      transparentValue: bigint = 5n,
      shieldedMode: ShieldedOutputMode = ShieldedOutputMode.AMOUNT_SHIELDED,
      changeShieldedMode: ChangeOutputMode | null = null
    ) => {
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      return new SendTransaction({
        wallet,
        outputs: [
          { address: buildShieldedAddr(1), value: shieldedValue, token, shieldedMode },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: transparentValue,
            token,
          },
        ],
        changeShieldedMode,
      }).prepareTxData();
    };
    const r3aSend = (
      pool: ReturnType<typeof poolUtxo>[],
      token: string,
      shieldedValue: bigint,
      transparentValue: bigint,
      shieldedMode: ShieldedOutputMode = ShieldedOutputMode.AMOUNT_SHIELDED,
      changeShieldedMode: ChangeOutputMode | null = null
    ) =>
      r3aSendFrom(
        buildPoolStorage(pool),
        token,
        shieldedValue,
        transparentValue,
        shieldedMode,
        changeShieldedMode
      );
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

    test('R3a fallback — an HTR change too small for its own fee, with no HTR to add, fails the send', async () => {
      const pool = [poolUtxo('htr-pub-18', 18n, NATIVE_TOKEN_UID)];

      // The 1n change cannot pay its own 1n fee and the wallet has no more HTR.
      // Spent on the fee of a split instead, it would leave the halves of the
      // 11n adding up to 18 − 5 − 2 (fees).
      await expect(r3aSend(pool, NATIVE_TOKEN_UID, 11n, 5n)).rejects.toThrow(
        new SendTxError(UNFUNDED_STAND_IN_CHANGE)
      );
      // As suggested: pinned transparent, the change pays the split's fee and
      // the recipient's output is split: 18 = 5 + 6 + 5 + 2 (fees).
      const result = await r3aSend(
        pool,
        NATIVE_TOKEN_UID,
        11n,
        5n,
        ShieldedOutputMode.AMOUNT_SHIELDED,
        OutputKind.TRANSPARENT
      );
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      expect(result.shieldedOutputs!.every(o => o.address === recipientSpend())).toBe(true);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — an HTR change too small for its own fee beside other shielded outputs fails the send', async () => {
      // The R3a HTR send beside two shielded outputs of the custom token, which
      // its 20n pays exactly.
      const send = (changeShieldedMode: ChangeOutputMode | null) => {
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-20', 20n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID),
        ]);
        return new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 11n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              type: OutputType.P2PKH,
              address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
              value: 5n,
              token: NATIVE_TOKEN_UID,
            },
            {
              address: buildShieldedAddr(2),
              value: 10n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              address: buildShieldedAddr(3),
              value: 10n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
          ],
          changeShieldedMode,
        }).prepareTxData();
      };

      // 20 − 16 − 3 (fees) = 1n of HTR change, too small for its own 1n fee, and
      // the wallet has no more HTR. Left transparent, it would publish the 11n
      // by subtraction: 20 − 5 − 1 − 3.
      await expect(send(null)).rejects.toThrow(new SendTxError(UNFUNDED_STAND_IN_CHANGE));
      // As suggested: pinned transparent, the 1n change stays transparent.
      const result = await send(OutputKind.TRANSPARENT);
      const changes = result.outputs.filter(o => (o as { isChange?: boolean }).isChange);
      expect(changes.map(o => [(o as { token?: string }).token, o.value])).toEqual([
        [NATIVE_TOKEN_UID, 1n],
      ]);
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        10n,
        10n,
        11n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(3n);
    });

    // An R3a HTR send (11n shielded, 5n transparent) from the caller's own
    // transparent HTR input; the wallet holds a spare 50n it must not touch.
    const r3aSendFromCallerInput = (
      inputValue: bigint,
      changeShieldedMode: ChangeOutputMode | null = null,
      shieldedMode: ShieldedOutputMode = ShieldedOutputMode.AMOUNT_SHIELDED
    ) => {
      const storage = buildPoolStorage([
        poolUtxo('parent', inputValue, NATIVE_TOKEN_UID),
        poolUtxo('htr-pub-50', 50n, NATIVE_TOKEN_UID),
      ]);
      jest.spyOn(storage, 'getTx').mockResolvedValue({
        tx_id: 'parent',
        outputs: [
          {
            value: inputValue,
            token: NATIVE_TOKEN_UID,
            token_data: 0,
            script: '',
            decoded: { address: 'addr-parent' },
            spent_by: null,
          },
        ],
        shielded_outputs: [],
        inputs: [],
      } as never);
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => address === 'addr-parent');
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      return new SendTransaction({
        wallet,
        outputs: [
          { address: buildShieldedAddr(1), value: 11n, token: NATIVE_TOKEN_UID, shieldedMode },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 5n,
            token: NATIVE_TOKEN_UID,
          },
        ],
        inputs: [{ txId: 'parent', index: 0 }],
        changeShieldedMode,
      }).prepareTxData();
    };

    test('R3a fallback — with caller-supplied HTR, the change becomes the second shielded output', async () => {
      const result = await r3aSendFromCallerInput(30n);

      // 30 − 16 − 1 (the recipient's fee) = 13n of change, shielded at a 1n fee:
      // 12n. Nothing is added to the caller's input. HTR: 30 = 11 + 5 + 12 + 2.
      expect(result.inputs.map(i => i.txId)).toEqual(['parent']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([11n, 12n]);
      expect(byValue.get(12n)!.address).toBe(walletSpend());
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — with caller-supplied HTR, a change too small for its own fee fails the send', async () => {
      // The caller's 18n leaves a 1n change, too small for its own 1n fee, and
      // the wallet adds nothing to a caller's inputs (the 50n stays unspent).
      await expect(r3aSendFromCallerInput(18n)).rejects.toThrow(
        new SendTxError(UNFUNDED_STAND_IN_CHANGE_OF_CALLER_HTR)
      );
      // As suggested: pinned transparent, the change pays the split's fee
      // instead: 18 = 5 + 6 + 5 + 2 (fees).
      const result = await r3aSendFromCallerInput(18n, OutputKind.TRANSPARENT);
      expect(result.inputs.map(i => i.txId)).toEqual(['parent']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — with caller-supplied HTR that leaves no change, the send fails without suggesting a transparent change', async () => {
      // The caller's 17n pays 11 + 5 + 1 (the recipient's fee) exactly. The 11n
      // is not split, and the wallet adds nothing to a caller's inputs, so no
      // HTR can be pulled for a change in place of the missing shielded input.
      await expect(r3aSendFromCallerInput(17n)).rejects.toThrow(
        new SendTxError(standInChangeMessage(NO_HTR_CHANGE_OF_CALLER_HTR, '.'))
      );
      // Pinned transparent, the 11n would be split, but no HTR can be selected
      // for the split's fee either.
      await expect(r3aSendFromCallerInput(17n, OutputKind.TRANSPARENT)).rejects.toThrow(
        new SendTxError(
          'Splitting the lone shielded output requires extra HTR for its fee, and HTR inputs ' +
            'were user-supplied so no additional HTR can be selected.'
        )
      );
    });

    test('R3a fallback — with caller-supplied HTR, a fully shielded output whose change cannot pay the split fee either fails without suggesting a transparent change', async () => {
      const send = (inputValue: bigint, changeShieldedMode: ChangeOutputMode | null = null) =>
        r3aSendFromCallerInput(inputValue, changeShieldedMode, ShieldedOutputMode.FULLY_SHIELDED);

      // The caller's 19n leaves 19 − 16 − 2 (the recipient's fee) = 1n of change,
      // below its own 2n fee and below the 2n fee of splitting the 11n.
      await expect(send(19n)).rejects.toThrow(
        new SendTxError(standInChangeMessage(HTR_CHANGE_OF_CALLER_HTR_TOO_SMALL, '.'))
      );
      await expect(send(19n, OutputKind.TRANSPARENT)).rejects.toThrow(
        new SendTxError(
          'The HTR change cannot fund the shielded-output split the protocol requires, and HTR ' +
            'inputs were user-supplied so no additional HTR can be selected.'
        )
      );
      // The caller's 20n leaves 2n, still not above its own 2n fee, but kept
      // transparent it pays the split's: 20 = 5 + 6 + 5 + 4 (fees).
      await expect(send(20n)).rejects.toThrow(
        new SendTxError(UNFUNDED_STAND_IN_CHANGE_OF_CALLER_HTR)
      );
      const result = await send(20n, OutputKind.TRANSPARENT);
      expect(result.inputs.map(i => i.txId)).toEqual(['parent']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
    });

    // The R3a send of the custom token, built from storage alone.
    const r3aSendFromStorageAlone = (
      storage: Storage,
      changeShieldedMode: ChangeOutputMode | null = null
    ) =>
      new SendTransaction({
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
        changeShieldedMode,
      }).prepareTxData();

    test('R3a fallback — with no shielded address in the wallet, the send fails', async () => {
      const pool = [
        poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ];
      // The wallet has no shielded address, so it cannot receive a shielded change.
      const refused = r3aSendFromStorageAlone(buildPoolStorage(pool));

      // A transparent 34n change would publish the 11n by subtraction (50 − 5 − 34).
      await expect(refused).rejects.toThrow(
        new SendTxError(STAND_IN_CHANGE_WITHOUT_A_SHIELDED_ADDRESS)
      );
      await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
      // As suggested: pinned transparent, the 34n change stays transparent and
      // the 11n is split in halves at the recipient.
      const result = await r3aSendFromStorageAlone(buildPoolStorage(pool), OutputKind.TRANSPARENT);
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

    test('R3a fallback — with shielded keys but no shielded address in its store, the send fails', async () => {
      const storageWithKeysOnly = () =>
        withShieldedKeysOnly(
          buildPoolStorage([
            poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
          ])
        );
      const storage = storageWithKeysOnly();
      await expect(storage.getCurrentAddress(false, { legacy: false })).rejects.toThrow(
        'Current shielded address is not loaded'
      );

      const refused = r3aSendFromStorageAlone(storage);

      // As without shielded keys: the wallet cannot receive the shielded change.
      await expect(refused).rejects.toThrow(
        new SendTxError(STAND_IN_CHANGE_WITHOUT_A_SHIELDED_ADDRESS)
      );
      await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
      // As suggested: pinned transparent, the 34n change stays transparent and
      // the 11n is split in halves at the recipient. HTR: 9 = 7 + 2 (fees).
      const result = await r3aSendFromStorageAlone(storageWithKeysOnly(), OutputKind.TRANSPARENT);
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
      const htrChange = result.outputs.find(
        o =>
          (o as { isChange?: boolean }).isChange &&
          (o as { token?: string }).token === NATIVE_TOKEN_UID
      );
      expect(htrChange!.value).toBe(7n);
    });

    // The same send's HTR twin, 11n shielded beside 5n transparent, built
    // from storage alone.
    const r3aHtrSendFromStorageAlone = (
      storage: Storage,
      changeShieldedMode: ChangeOutputMode | null = null,
      shieldedValue = 11n
    ) =>
      new SendTransaction({
        storage,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: shieldedValue,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 5n,
            token: NATIVE_TOKEN_UID,
          },
        ],
        changeShieldedMode,
      }).prepareTxData();

    test.each([
      ['no shielded keys', (storage: Storage) => storage],
      ['shielded keys but no shielded address in its store', withShieldedKeysOnly],
    ])(
      'R3a fallback — an HTR change in a wallet with %s fails the send',
      async (_, withoutShieldedAddress) => {
        const storageOf30n = () =>
          withoutShieldedAddress(buildPoolStorage([poolUtxo('htr-pub-30', 30n, NATIVE_TOKEN_UID)]));

        // 30 − 16 − 1 (the recipient's fee) = 13n of change, which the wallet
        // cannot receive shielded.
        const refused = r3aHtrSendFromStorageAlone(storageOf30n());
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_WITHOUT_A_SHIELDED_ADDRESS)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the change pays the split's fee and
        // keeps 12n. HTR: 30 = 5 + 6 + 5 + 12 + 2 (fees).
        const result = await r3aHtrSendFromStorageAlone(storageOf30n(), OutputKind.TRANSPARENT);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          5n,
          6n,
        ]);
        const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
        expect(change!.value).toBe(12n);
      }
    );

    // Two shielded HTR outputs: all HTR outputs are shielded, so the 8n HTR
    // change must be too. HTR: 20 = 5 + 5 + 8 + 2 (fees).
    const allShieldedHtrSend = (
      storage: Storage,
      changeShieldedMode: ChangeOutputMode | null = null
    ) =>
      new SendTransaction({
        storage,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 5n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 5n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
        changeShieldedMode,
      }).prepareTxData();

    test('a change the rules must shield fails when the wallet has no shielded address', async () => {
      const refused = allShieldedHtrSend(
        buildPoolStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)])
      );

      await expect(refused).rejects.toThrow(
        new SendTxError(
          'A shielded change is required, but the wallet has no shielded address to receive ' +
            'it; pass changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.'
        )
      );
      await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
      // As suggested: the 8n change stays transparent.
      const result = await allShieldedHtrSend(
        buildPoolStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)]),
        OutputKind.TRANSPARENT
      );
      const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
      expect(change!.value).toBe(8n);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
    });

    test('a change the caller asks to shield fails plainly when the wallet has no shielded address', async () => {
      const refused = allShieldedHtrSend(
        buildPoolStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)]),
        ShieldedOutputMode.AMOUNT_SHIELDED
      );

      // The caller asked for the shielded change, so the error does not suggest
      // keeping it transparent.
      await expect(refused).rejects.toThrow(
        new SendTxError(
          'A shielded change is required, but the wallet has no shielded address to receive it.'
        )
      );
      await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
    });

    test('a send built from storage alone takes the shielded change address from storage', async () => {
      const storage = withShieldedAddress(
        buildPoolStorage([
          poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-10', 10n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: '39'.repeat(32),
          }),
        ]),
        buildShieldedAddr(0)
      );
      // No HathorWallet: the change address must come from storage.
      const result = await new SendTransaction({
        storage,
        outputs: [
          { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 8n, token: NATIVE_TOKEN_UID },
        ],
      }).prepareTxData();

      // The transparent 3n cannot pay 8n, so the shielded 10n tops it up. The
      // 5n change carries shielded value, so it must be shielded (AS, mirroring
      // the input): 5 − 1 (its fee) = 4n. As the only shielded output it pays
      // the 1n split fee and is split into 1n + 2n. HTR: 13 = 8 + 1 + 2 + 2.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-3', 'htr-sh-10']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        2n,
      ]);
      expect(result.shieldedOutputs!.every(o => o.address === walletSpend())).toBe(true);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — a send built from storage alone shields the change too', async () => {
      const storage = withShieldedAddress(
        buildPoolStorage([
          poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
        ]),
        buildShieldedAddr(0)
      );
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

      // Same as with a wallet: the 34n change is the second shielded output.
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([11n, 34n]);
      expect(byValue.get(34n)!.address).toBe(walletSpend());
    });

    const r3aSendWithChangeMode = (changeShieldedMode: ShieldedOutputMode) => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      return new SendTransaction({
        wallet,
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
        changeShieldedMode,
      }).prepareTxData();
    };

    test('R3a fallback — an amount-shielded change mode shields the HTR change as well', async () => {
      const result = await r3aSendWithChangeMode(ShieldedOutputMode.AMOUNT_SHIELDED);

      // The custom change (34n) and the HTR change are both shielded: three AS
      // outputs, fee 3n. HTR: 9 = 3 (fees) + 6.
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([6n, 11n, 34n]);
      expect(byValue.get(6n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(6n)!.address).toBe(walletSpend());
      expect(byValue.get(34n)!.token).toBe(CUSTOM_TOKEN);
      expect(byValue.get(34n)!.address).toBe(walletSpend());
      expect(
        result.shieldedOutputs!.every(o => o.shieldedMode === ShieldedOutputMode.AMOUNT_SHIELDED)
      ).toBe(true);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(3n);
    });

    test('R3a fallback — a fully shielded change mode shields both changes in that mode', async () => {
      const result = await r3aSendWithChangeMode(ShieldedOutputMode.FULLY_SHIELDED);

      // Both changes take the requested mode; the recipient's output keeps its
      // own: fee 1 + 2 + 2 = 5n. HTR: 9 = 5 (fees) + 4.
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([4n, 11n, 34n]);
      expect(byValue.get(4n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(4n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(byValue.get(34n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(byValue.get(11n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(5n);
    });

    test('a pinned shielded change too small for its fee becomes the split fee', async () => {
      const storage = buildPoolStorage([poolUtxo('htr-pub-18', 18n, NATIVE_TOKEN_UID)]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 11n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 5n,
            token: NATIVE_TOKEN_UID,
          },
        ],
        changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
      }).prepareTxData();

      // The 1n change cannot pay its own 1n fee and there is no more HTR; it
      // pays the split's fee instead: 18 = 5 + 6 + 5 + 2 (fees), no change.
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    // A lone shielded HTR output: the change takes its mode (all HTR outputs are
    // shielded), and when it equals that mode's fee, the split takes it whole.
    const loneShieldedHtrSend = (
      storage: Storage,
      shieldedMode: ShieldedOutputMode,
      inputs: { txId: string; index: number }[] = []
    ) =>
      new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          { address: buildShieldedAddr(1), value: 10n, token: NATIVE_TOKEN_UID, shieldedMode },
        ],
        inputs,
      }).prepareTxData();

    test('a lone shielded output whose change equals its fee is split, the change paying the split fee', async () => {
      const amountShielded = await loneShieldedHtrSend(
        buildPoolStorage([poolUtxo('htr-pub-12', 12n, NATIVE_TOKEN_UID)]),
        ShieldedOutputMode.AMOUNT_SHIELDED
      );
      // 12 − 10 − 1 = 1n of change, exactly its own fee: 12 = 5 + 5 + 2 (fees).
      expect(amountShielded.outputs).toHaveLength(0);
      expect(amountShielded.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const asFee = amountShielded.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(asFee.entries[0].amount).toBe(2n);

      const fullyShielded = await loneShieldedHtrSend(
        buildPoolStorage([poolUtxo('htr-pub-14', 14n, NATIVE_TOKEN_UID)]),
        ShieldedOutputMode.FULLY_SHIELDED
      );
      // 14 − 10 − 2 = 2n of change, exactly its own fee: 14 = 5 + 5 + 4 (fees).
      expect(fullyShielded.outputs).toHaveLength(0);
      expect(fullyShielded.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      const fsFee = fullyShielded.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(fsFee.entries[0].amount).toBe(4n);
    });

    test('a lone shielded output spending a shielded UTXO whose change equals its fee is split', async () => {
      const result = await loneShieldedHtrSend(
        buildPoolStorage([
          poolUtxo('htr-sh-12', 12n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: '4d'.repeat(32),
          }),
        ]),
        ShieldedOutputMode.AMOUNT_SHIELDED
      );

      expect(result.inputs.map(i => i.txId)).toEqual(['htr-sh-12']);
      expect(result.outputs).toHaveLength(0);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
    });

    test('a lone shielded output from a caller-supplied input whose change equals its fee is split', async () => {
      const storage = buildPoolStorage([
        poolUtxo('parent', 12n, NATIVE_TOKEN_UID),
        poolUtxo('htr-pub-50', 50n, NATIVE_TOKEN_UID),
      ]);
      jest.spyOn(storage, 'getTx').mockResolvedValue({
        tx_id: 'parent',
        outputs: [
          {
            value: 12n,
            token: NATIVE_TOKEN_UID,
            token_data: 0,
            script: '',
            decoded: { address: 'addr-parent' },
            spent_by: null,
          },
        ],
        shielded_outputs: [],
        inputs: [],
      } as never);
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => address === 'addr-parent');

      const result = await loneShieldedHtrSend(storage, ShieldedOutputMode.AMOUNT_SHIELDED, [
        { txId: 'parent', index: 0 },
      ]);

      // Nothing is added to the caller's input: 12 = 5 + 5 + 2 (fees).
      expect(result.inputs.map(i => i.txId)).toEqual(['parent']);
      expect(result.outputs).toHaveLength(0);
      expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
    });

    test('a pinned shielded change too small for its fee fails when the only shielded output is 1n', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-6', 6n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));

      // The 1n HTR change cannot pay its own 1n fee, and the 1n output cannot
      // be split to take it as the split's fee: the missing HTR is the cause.
      await expect(
        new SendTransaction({
          wallet,
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 1n,
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
          changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        }).prepareTxData()
      ).rejects.toThrow(
        'HTR change is too small to fund its shielded-output fee and no additional HTR is available'
      );
    });

    test('a change mirroring a shielded input, too small for its fee, becomes the split fee', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-16', 16n, CUSTOM_TOKEN),
        poolUtxo('htr-sh-2', 2n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '3a'.repeat(32),
        }),
      ]);
      const result = await r3aSendFrom(storage);

      // The only HTR is a shielded 2n. Its 1n change mirrors it, so it must be
      // shielded, but it cannot pay its own fee; it pays the split's fee and
      // nothing transparent is left. HTR: 2 = 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['custom-pub-16', 'htr-sh-2']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
    });

    test('R3a fallback — a fully shielded output whose change is below its fee still hides the amount', async () => {
      const result = await r3aSend(
        [
          poolUtxo('htr-pub-19', 19n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        ],
        NATIVE_TOKEN_UID,
        11n,
        5n,
        ShieldedOutputMode.FULLY_SHIELDED
      );

      // The 1n change cannot pay a 2n fee, so the 10n is pulled into it and it
      // becomes the second shielded output: 19 + 10 = 11 + 5 + 9 + 4 (fees).
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([9n, 11n]);
      expect(byValue.get(9n)!.address).toBe(walletSpend());
      expect(byValue.get(9n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(4n);
    });

    test('R3a fallback — a fully shielded output whose change cannot pay the split fee either fails without suggesting a transparent change', async () => {
      const send = (pool: PoolUtxo[], changeShieldedMode: ChangeOutputMode | null = null) =>
        r3aSend(
          pool,
          NATIVE_TOKEN_UID,
          11n,
          5n,
          ShieldedOutputMode.FULLY_SHIELDED,
          changeShieldedMode
        );

      // 19 − 16 − 2 (the recipient's fee) = 1n of change, below its own 2n fee,
      // and the wallet has no more HTR. Kept transparent, it could not pay the
      // 2n fee of splitting the 11n either.
      const noMoreHtr = [poolUtxo('htr-pub-19', 19n, NATIVE_TOKEN_UID)];
      await expect(send(noMoreHtr)).rejects.toThrow(
        new SendTxError(standInChangeMessage(HTR_CHANGE_TOO_SMALL, '.'))
      );
      await expect(send(noMoreHtr, OutputKind.TRANSPARENT)).rejects.toThrow(
        new SendTxError(
          'The HTR change cannot fund the shielded-output split the protocol requires, and no ' +
            'additional HTR is available.'
        )
      );
      // With 1n more, the change still cannot pay its own 2n fee, but kept
      // transparent it pays the split's: 20 = 5 + 6 + 5 + 4 (fees).
      const oneMore = [...noMoreHtr, poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID)];
      await expect(send(oneMore)).rejects.toThrow(new SendTxError(UNFUNDED_STAND_IN_CHANGE));
      const result = await send(oneMore, OutputKind.TRANSPARENT);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(4n);
    });

    test('R3a fallback — at the shielded-output limit the send fails', async () => {
      const send = (changeShieldedMode: ChangeOutputMode | null) => {
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-63', 63n, NATIVE_TOKEN_UID),
        ]);
        const wallet = buildWallet(storage, buildShieldedAddr(0));
        const htrOutputs = Array.from({ length: MAX_SHIELDED_OUTPUTS - 1 }, (_, i) => ({
          address: buildShieldedAddr(2 + (i % 2)),
          value: 1n,
          token: NATIVE_TOKEN_UID,
          shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        }));
        return new SendTransaction({
          wallet,
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
            ...htrOutputs,
          ],
          changeShieldedMode,
        }).prepareTxData();
      };

      // 32 shielded outputs already: shielding the 34n change would make 33.
      await expect(send(null)).rejects.toThrow(new SendTxError(STAND_IN_CHANGE_AT_THE_LIMIT));
      // As suggested: pinned transparent, the 34n change stays transparent.
      // HTR: 63 = 31 + 32 (fees).
      const result = await send(OutputKind.TRANSPARENT);
      expect(result.shieldedOutputs).toHaveLength(MAX_SHIELDED_OUTPUTS);
      const transparentCustom = result.outputs
        .filter(o => (o as { token?: string }).token === CUSTOM_TOKEN)
        .map(o => o.value)
        .sort((a, b) => Number(a - b));
      expect(transparentCustom).toEqual([5n, 34n]);
    });

    // The R3a HTR send (11n shielded, 5n transparent) beside 31 shielded 1n of
    // the custom token, which its 31n pays exactly: 32 shielded outputs before
    // any HTR change. HTR: 11 + 5 + 32 (fees) = 48n, from `htr`.
    const r3aHtrSendAtTheLimit = (
      htr: bigint,
      changeShieldedMode: ChangeOutputMode | null = null
    ) => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-31', 31n, CUSTOM_TOKEN),
        poolUtxo(`htr-pub-${htr}`, htr, NATIVE_TOKEN_UID),
      ]);
      const customOutputs = Array.from({ length: MAX_SHIELDED_OUTPUTS - 1 }, (_, i) => ({
        address: buildShieldedAddr(2 + (i % 2)),
        value: 1n,
        token: CUSTOM_TOKEN,
        shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
      }));
      return new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 11n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 5n,
            token: NATIVE_TOKEN_UID,
          },
          ...customOutputs,
        ],
        changeShieldedMode,
      }).prepareTxData();
    };
    const transparentHtrChanges = (result: IDataTx) =>
      result.outputs
        .filter(
          o =>
            (o as { isChange?: boolean }).isChange &&
            (o as { token?: string }).token === NATIVE_TOKEN_UID
        )
        .map(o => o.value);

    test('R3a fallback — an HTR change at the shielded-output limit fails the send', async () => {
      // 60 − 48 = 12n of HTR change, which would be a 33rd shielded output.
      await expect(r3aHtrSendAtTheLimit(60n)).rejects.toThrow(
        new SendTxError(STAND_IN_CHANGE_AT_THE_LIMIT)
      );
      // As suggested: pinned transparent, the 12n change stays transparent.
      const result = await r3aHtrSendAtTheLimit(60n, OutputKind.TRANSPARENT);
      expect(result.shieldedOutputs).toHaveLength(MAX_SHIELDED_OUTPUTS);
      expect(transparentHtrChanges(result)).toEqual([12n]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(32n);
    });

    test('R3a fallback — an HTR change too small for its own fee at the shielded-output limit fails for the limit', async () => {
      // 49 − 48 = 1n of HTR change, too small for its own 1n fee with no HTR to
      // add, and with no room for it either: the limit comes first.
      await expect(r3aHtrSendAtTheLimit(49n)).rejects.toThrow(
        new SendTxError(STAND_IN_CHANGE_AT_THE_LIMIT)
      );
      // As suggested: pinned transparent, the 1n change stays transparent.
      const result = await r3aHtrSendAtTheLimit(49n, OutputKind.TRANSPARENT);
      expect(result.shieldedOutputs).toHaveLength(MAX_SHIELDED_OUTPUTS);
      expect(transparentHtrChanges(result)).toEqual([1n]);
    });

    test('the token selection leaves room for the HTR fee within the input limit', async () => {
      const pool = [
        ...Array.from({ length: 253 }, (_, i) =>
          poolUtxo(`custom-sh-1-${i}`, 1n, CUSTOM_TOKEN, {
            shielded: true,
            blindingFactor: (i + 1).toString(16).padStart(2, '0').repeat(32),
          })
        ),
        poolUtxo('custom-pub-100a', 100n, CUSTOM_TOKEN),
        poolUtxo('custom-pub-100b', 100n, CUSTOM_TOKEN),
        poolUtxo('custom-pub-100c', 100n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 250n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 250n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      }).prepareTxData();

      // The shielded 1n UTXOs are swept first and the three 100n top them up;
      // the sweep stops short so the HTR fee input still fits: 254 inputs.
      expect(result.inputs.length).toBeLessThanOrEqual(MAX_INPUTS);
      expect(result.inputs.map(i => i.txId)).toContain('htr-pub-10');
    });

    test('a send that needs more inputs than a transaction holds fails before building outputs', async () => {
      const pool = [
        ...Array.from({ length: 300 }, (_, i) =>
          poolUtxo(`custom-sh-1-${i}`, 1n, CUSTOM_TOKEN, {
            shielded: true,
            blindingFactor: (i + 1).toString(16).padStart(4, '0').repeat(16),
          })
        ),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 140n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 140n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      });

      // 280n of 1n UTXOs cannot fit in a transaction: the send fails on the
      // token's inputs, before its HTR fee input is chosen.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        new SendTxError(
          `The transaction needs at least 280 inputs, more than the ${MAX_INPUTS} a ` +
            "transaction can hold. Consolidate the wallet's UTXOs and try again."
        )
      );
    });

    test('a send that needs 254 inputs and pays no fee builds', async () => {
      const pool = [
        ...Array.from({ length: 253 }, (_, i) => poolUtxo(`custom-pub-1-${i}`, 1n, CUSTOM_TOKEN)),
        poolUtxo('custom-sh-47', 47n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '4e'.repeat(32),
        }),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 300n,
            token: CUSTOM_TOKEN,
          },
        ],
      }).prepareTxData();

      // The 253 transparent 1n cannot pay 300n, so they are swept and the
      // shielded 47n tops them up exactly. With no fee and no shielded output,
      // nothing follows to need the inputs the selection first leaves free.
      expect(result.inputs).toHaveLength(254);
      expect(result.inputs.map(i => i.txId)).toContain('custom-sh-47');
      expect(result.inputs.map(i => i.txId)).not.toContain('htr-pub-10');
    });

    test('a send that needs every input a transaction holds builds', async () => {
      const pool = [
        ...Array.from({ length: 253 }, (_, i) =>
          poolUtxo(`custom-sh-1-${i}`, 1n, CUSTOM_TOKEN, {
            shielded: true,
            blindingFactor: (i + 1).toString(16).padStart(2, '0').repeat(32),
          })
        ),
        poolUtxo('custom-pub-47', 47n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 150n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 150n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      }).prepareTxData();

      // The 253 shielded 1n are swept and the transparent 47n tops them up
      // exactly; the HTR fee takes the last input: 253 + 1 + 1.
      expect(result.inputs).toHaveLength(MAX_INPUTS);
      expect(result.inputs.map(i => i.txId)).toContain('htr-pub-10');
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test("a second token's sweep counts the inputs the first token already took", async () => {
      const pool = [
        ...Array.from({ length: 200 }, (_, i) => poolUtxo(`custom-pub-1-${i}`, 1n, CUSTOM_TOKEN)),
        ...Array.from({ length: 100 }, (_, i) =>
          poolUtxo(`other-sh-1-${i}`, 1n, OTHER_CUSTOM_TOKEN, {
            shielded: true,
            blindingFactor: (i + 1).toString(16).padStart(2, '0').repeat(32),
          })
        ),
        poolUtxo('other-pub-100', 100n, OTHER_CUSTOM_TOKEN),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 200n,
            token: CUSTOM_TOKEN,
          },
          {
            address: buildShieldedAddr(1),
            value: 75n,
            token: OTHER_CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 75n,
            token: OTHER_CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      }).prepareTxData();

      // The CUSTOM 200n takes 200 of the 255 inputs. The other token's shielded
      // 1n cannot pay its 150n, so they are swept only as far as the 55 inputs
      // left allow, keeping room for the top-up and the HTR fee input: 52 of
      // them, topped up with its public 100n. The HTR fee input makes 254.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds.filter(id => id.startsWith('custom-pub-1-'))).toHaveLength(200);
      expect(inputIds.filter(id => id.startsWith('other-sh-1-'))).toHaveLength(52);
      expect(inputIds).toEqual(expect.arrayContaining(['other-pub-100', 'htr-pub-10']));
      expect(result.inputs).toHaveLength(254);
    });

    test('the HTR sweep counts the inputs the token selection already took', async () => {
      const pool = [
        ...Array.from({ length: 250 }, (_, i) =>
          poolUtxo(`custom-sh-1-${i}`, 1n, CUSTOM_TOKEN, {
            shielded: true,
            blindingFactor: (i + 1).toString(16).padStart(2, '0').repeat(32),
          })
        ),
        ...Array.from({ length: 20 }, (_, i) => poolUtxo(`htr-pub-1-${i}`, 1n, NATIVE_TOKEN_UID)),
        poolUtxo('htr-sh-50', 50n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 125n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 125n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 25n,
            token: NATIVE_TOKEN_UID,
          },
        ],
      }).prepareTxData();

      // The CUSTOM 250n takes 250 of the 255 inputs, and HTR keeps one of the 5
      // left free for a structural pull. The public 1n cannot pay the 27n
      // (25n + 2n of fees), so they are swept only as far as that allows,
      // keeping room for the top-up and a change-forcing UTXO: 2 of them,
      // topped up with the shielded 50n. 250 + 2 + 1 = 253.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds.filter(id => id.startsWith('custom-sh-1-'))).toHaveLength(250);
      expect(inputIds.filter(id => id.startsWith('htr-pub-1-'))).toHaveLength(2);
      expect(inputIds).toContain('htr-sh-50');
      expect(result.inputs).toHaveLength(253);
    });

    test('a transparent HTR pool that pays only with too many inputs is topped up from the shielded one', async () => {
      const pool = [
        ...Array.from({ length: 300 }, (_, i) => poolUtxo(`htr-pub-1-${i}`, 1n, NATIVE_TOKEN_UID)),
        poolUtxo('htr-sh-1000', 1000n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 280n,
            token: NATIVE_TOKEN_UID,
          },
        ],
      }).prepareTxData();

      // 280 of the public 1n would pay 280n, more inputs than a transaction
      // holds. They are swept only as far as the limit allows, keeping one
      // input free for a structural pull and one for a change-forcing UTXO:
      // 252 of them, topped up with the shielded 1000n.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds.filter(id => id.startsWith('htr-pub-1-'))).toHaveLength(252);
      expect(inputIds).toContain('htr-sh-1000');
      expect(result.inputs).toHaveLength(253);
      // The 972n change mirrors the shielded input and is split in two:
      // 1252 = 280 + 970 + 2 (fees).
      expect(result.shieldedOutputs!.reduce((sum, o) => sum + o.value, 0n)).toBe(970n);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('the forced shielded input counts against the input limit of the token selection', async () => {
      const pool = [
        ...Array.from({ length: 300 }, (_, i) => poolUtxo(`custom-pub-1-${i}`, 1n, CUSTOM_TOKEN)),
        poolUtxo('custom-sh-5', 5n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '05'.repeat(32),
        }),
        poolUtxo('custom-sh-1000', 1000n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 100n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 180n,
            token: CUSTOM_TOKEN,
          },
        ],
      }).prepareTxData();

      // The lone shielded output forces the smallest shielded UTXO (5n). The
      // public 1n would pay the other 275n only with 275 inputs, so they are
      // swept only as far as the 253 inputs the token may take while leaving
      // two free allow: 251 of them, topped up with the shielded 1000n. The
      // HTR fee input makes 254.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds.filter(id => id.startsWith('custom-pub-1-'))).toHaveLength(251);
      expect(inputIds).toEqual(
        expect.arrayContaining(['custom-sh-5', 'custom-sh-1000', 'htr-pub-10'])
      );
      expect(result.inputs).toHaveLength(254);
    });

    test('a transparent send that needs more inputs than a transaction holds fails with the count', async () => {
      const pool = Array.from({ length: 300 }, (_, i) =>
        poolUtxo(`htr-pub-1-${i}`, 1n, NATIVE_TOKEN_UID)
      );
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 280n,
            token: NATIVE_TOKEN_UID,
          },
        ],
      });

      // Only the 1n UTXOs can pay: the wallet holds enough, in too many pieces.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        new SendTxError(
          `The transaction needs at least 280 inputs, more than the ${MAX_INPUTS} a ` +
            "transaction can hold. Consolidate the wallet's UTXOs and try again."
        )
      );
    });

    test('a send both pools pay only past the input limit fails with the fewest inputs it needs', async () => {
      const pool = [
        ...Array.from({ length: 300 }, (_, i) => poolUtxo(`htr-pub-1-${i}`, 1n, NATIVE_TOKEN_UID)),
        poolUtxo('htr-sh-60', 60n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '3c'.repeat(32),
        }),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 350n,
            token: NATIVE_TOKEN_UID,
          },
        ],
      });

      // The wallet holds 360n, so this is no shortage. 350n takes the shielded
      // 60n and 290 public 1n: 291 inputs, the fewest that pay it.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        new SendTxError(
          `The transaction needs at least 291 inputs, more than the ${MAX_INPUTS} a ` +
            "transaction can hold. Consolidate the wallet's UTXOs and try again."
        )
      );
    });

    test('a send the rules cannot fit within the input limit takes the fewest UTXOs from both pools', async () => {
      const pool = [
        ...Array.from({ length: 300 }, (_, i) => poolUtxo(`htr-pub-1-${i}`, 1n, NATIVE_TOKEN_UID)),
        ...Array.from({ length: 30 }, (_, i) =>
          poolUtxo(`htr-sh-2-${i}`, 2n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: (i + 1).toString(16).padStart(2, '0').repeat(32),
          })
        ),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 280n,
            token: NATIVE_TOKEN_UID,
          },
        ],
      }).prepareTxData();

      // Sweeping the public 1n and topping up with the shielded 2n pays 280n
      // with 266 inputs. Largest-first over both pools pays it with 250, an
      // exact match: the 30 shielded 2n and 220 public 1n, spent into the
      // transparent output alone.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds.filter(id => id.startsWith('htr-sh-2-'))).toHaveLength(30);
      expect(inputIds.filter(id => id.startsWith('htr-pub-1-'))).toHaveLength(220);
      expect(result.inputs).toHaveLength(250);
      expect(result.outputs).toHaveLength(1);
      expect(result.shieldedOutputs ?? []).toHaveLength(0);
      expect(result.excessBlindingFactor).toBeDefined();
    });

    test('a transparent HTR cover that takes every input is kept instead of a shielded top-up', async () => {
      const pool = [
        ...Array.from({ length: MAX_INPUTS }, (_, i) =>
          poolUtxo(`htr-pub-1-${i}`, 1n, NATIVE_TOKEN_UID)
        ),
        poolUtxo('htr-sh-1000', 1000n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: BigInt(MAX_INPUTS),
            token: NATIVE_TOKEN_UID,
          },
        ],
      }).prepareTxData();

      // The 255 public 1n pay it with the input the selection would leave for a
      // structural pull, which this transparent send never makes.
      expect(result.inputs).toHaveLength(MAX_INPUTS);
      expect(result.inputs.map(i => i.txId)).not.toContain('htr-sh-1000');
      expect(result.outputs).toHaveLength(1);
      expect(result.shieldedOutputs ?? []).toHaveLength(0);
      expect(result.headers ?? []).toHaveLength(0);
    });

    test('a transparent HTR cover that takes every input keeps its change at a legacy changeAddress', async () => {
      const pool = [
        ...Array.from({ length: 300 }, (_, i) => poolUtxo(`htr-pub-2-${i}`, 2n, NATIVE_TOKEN_UID)),
        poolUtxo('htr-sh-1000', 1000n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
      ];
      const storage = buildPoolStorage(pool);
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => address === 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi');
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
            value: 509n,
            token: NATIVE_TOKEN_UID,
          },
        ],
        changeAddress: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
      }).prepareTxData();

      // 255 public 2n pay 509n, and the 1n change stays transparent at the
      // caller's address. A shielded input would shield it, which a legacy
      // address cannot receive.
      expect(result.inputs).toHaveLength(MAX_INPUTS);
      expect(result.inputs.map(i => i.txId)).not.toContain('htr-sh-1000');
      const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
      expect(change!.value).toBe(1n);
      expect((change as { address?: string }).address).toBe('WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi');
      expect(result.shieldedOutputs ?? []).toHaveLength(0);
    });

    test('with the change pinned transparent, a transparent HTR cover that takes every input unshields nothing', async () => {
      const pool = [
        ...Array.from({ length: 300 }, (_, i) => poolUtxo(`htr-pub-2-${i}`, 2n, NATIVE_TOKEN_UID)),
        poolUtxo('htr-sh-1000', 1000n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 510n,
            token: NATIVE_TOKEN_UID,
          },
        ],
        changeShieldedMode: OutputKind.TRANSPARENT,
      }).prepareTxData();

      // 255 public 2n pay 510n exactly. Spending the shielded 1000n into
      // transparent outputs alone would publish its value by subtraction.
      expect(result.inputs).toHaveLength(MAX_INPUTS);
      expect(result.inputs.map(i => i.txId)).not.toContain('htr-sh-1000');
      expect(result.outputs).toHaveLength(1);
      expect(result.excessBlindingFactor).toBeUndefined();
    });

    // A send of 254n of the custom token, which 254 public 1n pay, from a
    // wallet that also holds a shielded 1000n of it.
    const fullCustomCoverSend = (htrPool: PoolUtxo[]) => {
      const storage = buildPoolStorage([
        ...Array.from({ length: MAX_INPUTS - 1 }, (_, i) =>
          poolUtxo(`custom-pub-1-${i}`, 1n, CUSTOM_TOKEN)
        ),
        poolUtxo('custom-sh-1000', 1000n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
        ...htrPool,
      ]);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      return new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: BigInt(MAX_INPUTS - 1),
            token: CUSTOM_TOKEN,
          },
        ],
      }).prepareTxData();
    };

    test('a transparent token cover that takes the inputs kept for fees builds in a wallet with no HTR', async () => {
      const result = await fullCustomCoverSend([]);

      // The 254 public 1n take one of the two inputs the selection would keep
      // for an HTR fee and a structural pull, neither of which this send needs.
      // A shielded input would shield the change, whose fee the wallet has no
      // HTR to pay.
      expect(result.inputs).toHaveLength(MAX_INPUTS - 1);
      expect(result.inputs.map(i => i.txId)).not.toContain('custom-sh-1000');
      expect(result.outputs).toHaveLength(1);
      expect(result.headers ?? []).toHaveLength(0);
    });

    test('a transparent token cover that takes the inputs kept for fees pays no shielded fee', async () => {
      const result = await fullCustomCoverSend([poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID)]);

      expect(result.inputs).toHaveLength(MAX_INPUTS - 1);
      expect(result.inputs.map(i => i.txId)).not.toContain('custom-sh-1000');
      expect(result.inputs.map(i => i.txId)).not.toContain('htr-pub-10');
      expect(result.shieldedOutputs ?? []).toHaveLength(0);
      expect(result.headers ?? []).toHaveLength(0);
    });

    test('the HTR fee takes the transparent inputs left before a shielded one', async () => {
      const pool = [
        ...Array.from({ length: 253 }, (_, i) =>
          poolUtxo(`custom-sh-1-${i}`, 1n, CUSTOM_TOKEN, {
            shielded: true,
            blindingFactor: (i + 1).toString(16).padStart(2, '0').repeat(32),
          })
        ),
        poolUtxo('htr-pub-1-a', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-pub-1-b', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-50', 50n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const result = await new SendTransaction({
        wallet,
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 126n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 127n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      }).prepareTxData();

      // The token's 253 shielded 1n leave 2 inputs, and the 2 public 1n pay the
      // 2n of fees in them: 255 inputs, with no HTR change to shield.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds).toEqual(expect.arrayContaining(['htr-pub-1-a', 'htr-pub-1-b']));
      expect(inputIds).not.toContain('htr-sh-50');
      expect(result.inputs).toHaveLength(MAX_INPUTS);
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        126n,
        127n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('a FEE-token cover that takes every input leaves none for its HTR fee', async () => {
      const pool = [
        ...Array.from({ length: MAX_INPUTS }, (_, i) => poolUtxo(`fee-pub-1-${i}`, 1n, FEE_TOKEN)),
        poolUtxo('fee-sh-1000', 1000n, FEE_TOKEN, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ];
      const storage = buildPoolStorage(pool);
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: BigInt(MAX_INPUTS),
            token: FEE_TOKEN,
          },
        ],
      });

      // The 255 public 1n pay the token, so the rules take them and leave no
      // input for the 1n fee the transparent output owes. Spending the
      // shielded 1000n would make room for it, but a cover from the public
      // pool that fits is never traded for one that spends shielded funds.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        new SendTxError(
          `The transaction needs at least 256 inputs, more than the ${MAX_INPUTS} a ` +
            "transaction can hold. Consolidate the wallet's UTXOs and try again."
        )
      );
    });

    test('too many user-supplied inputs fail with the count, without advice to consolidate', async () => {
      const storage = buildPoolStorage([]);
      jest.spyOn(storage, 'getTx').mockResolvedValue({
        tx_id: 'parent',
        outputs: Array.from({ length: 300 }, () => ({
          value: 1n,
          token: NATIVE_TOKEN_UID,
          token_data: 0,
          script: '',
          decoded: { address: 'addr-parent' },
          spent_by: null,
        })),
        shielded_outputs: [],
        inputs: [],
      } as never);
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => address === 'addr-parent');
      const wallet = buildWallet(storage, buildShieldedAddr(0));
      const sendTransaction = new SendTransaction({
        wallet,
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 256n,
            token: NATIVE_TOKEN_UID,
          },
        ],
        inputs: Array.from({ length: 256 }, (_, index) => ({ txId: 'parent', index })),
      });

      // The caller chose these inputs: consolidating the wallet's UTXOs would
      // not change them.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        new SendTxError(
          `The transaction needs at least 256 inputs, more than the ${MAX_INPUTS} a ` +
            'transaction can hold.'
        )
      );
    });

    test('the advice to consolidate stays when the wallet chose the inputs past the limit', async () => {
      const storage = buildPoolStorage(
        Array.from({ length: 300 }, (_, i) => poolUtxo(`htr-pub-1-${i}`, 1n, NATIVE_TOKEN_UID))
      );
      jest.spyOn(storage, 'getTx').mockResolvedValue({
        tx_id: 'parent',
        outputs: [
          {
            value: 5n,
            token: CUSTOM_TOKEN,
            token_data: 1,
            script: '',
            decoded: { address: 'addr-parent' },
            spent_by: null,
          },
        ],
        shielded_outputs: [],
        inputs: [],
        tokens: [CUSTOM_TOKEN],
      } as never);
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => address === 'addr-parent');
      const sendTransaction = new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
            value: 280n,
            token: NATIVE_TOKEN_UID,
          },
          {
            type: OutputType.P2PKH,
            address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
            value: 5n,
            token: CUSTOM_TOKEN,
          },
        ],
        inputs: [{ txId: 'parent', index: 0 }],
      });

      // The caller supplied the custom-token input, but the wallet chose the
      // 280 HTR 1n that do not fit.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        new SendTxError(
          `The transaction needs at least 281 inputs, more than the ${MAX_INPUTS} a ` +
            "transaction can hold. Consolidate the wallet's UTXOs and try again."
        )
      );
    });

    // 520n from 300 public 2n and a shielded 5n: no selection under the rules
    // fits, and the UTXOs that pay it largest-first, 259 of them, spend the
    // shielded 5n, which makes the HTR change shielded.
    test.each([
      ['a legacy changeAddress', true],
      ['a wallet with no shielded address', false],
    ])(
      'an HTR send that cannot fit the input limit fails with its input count, not for %s',
      async (_, withLegacyChangeAddress) => {
        const storage = buildPoolStorage([
          ...Array.from({ length: 300 }, (_unused, i) =>
            poolUtxo(`htr-pub-2-${i}`, 2n, NATIVE_TOKEN_UID)
          ),
          poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: '5c'.repeat(32),
          }),
        ]);
        jest
          .spyOn(storage, 'isAddressMine')
          .mockImplementation(async address => address === 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi');
        const sendTransaction = new SendTransaction({
          // Built from storage alone, the wallet has no shielded address.
          ...(withLegacyChangeAddress
            ? {
                wallet: buildWallet(storage, buildShieldedAddr(0)),
                changeAddress: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
              }
            : { storage }),
          outputs: [
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 520n,
              token: NATIVE_TOKEN_UID,
            },
          ],
        });

        await expect(sendTransaction.prepareTxData()).rejects.toThrow(
          new SendTxError(
            `The transaction needs at least 259 inputs, more than the ${MAX_INPUTS} a ` +
              "transaction can hold. Consolidate the wallet's UTXOs and try again."
          )
        );
      }
    );

    test('a token that cannot fit the input limit fails with its input count, not for a legacy changeAddress', async () => {
      const storage = buildPoolStorage([
        ...Array.from({ length: 300 }, (_, i) => poolUtxo(`fee-pub-1-${i}`, 1n, FEE_TOKEN)),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '5d'.repeat(32),
        }),
      ]);
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => address === 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi');
      const sendTransaction = new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
            value: 280n,
            token: FEE_TOKEN,
          },
        ],
        changeAddress: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
      });

      // The token takes 280 public 1n. Its 1n fee would then take the shielded
      // 5n, the smallest HTR UTXO above it, whose change a legacy address
      // cannot receive; the send fails on the token's inputs first.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        new SendTxError(
          `The transaction needs at least 280 inputs, more than the ${MAX_INPUTS} a ` +
            "transaction can hold. Consolidate the wallet's UTXOs and try again."
        )
      );
    });

    test('a token that cannot fit the input limit fails with its input count, not for want of HTR', async () => {
      const storage = buildPoolStorage([
        ...Array.from({ length: 300 }, (_, i) => poolUtxo(`custom-pub-2-${i}`, 2n, CUSTOM_TOKEN)),
        ...['a', 'b', 'c'].map(suffix =>
          poolUtxo(`custom-sh-3${suffix}`, 3n, CUSTOM_TOKEN, {
            shielded: true,
            blindingFactor: `3${suffix}`.repeat(32),
          })
        ),
      ]);
      const sendTransaction = new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
            value: 580n,
            token: CUSTOM_TOKEN,
          },
        ],
      });

      // Largest-first, the three shielded 3n and 286 public 2n pay 580n with a
      // 1n change, which mirrors the shielded inputs and so owes an HTR fee the
      // wallet cannot pay; the send fails on the token's inputs first.
      await expect(sendTransaction.prepareTxData()).rejects.toThrow(
        new SendTxError(
          `The transaction needs at least 289 inputs, more than the ${MAX_INPUTS} a ` +
            "transaction can hold. Consolidate the wallet's UTXOs and try again."
        )
      );
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

    test('R3a fallback — with no HTR change, the HTR pulled for the second output becomes the shielded change', async () => {
      const result = await r3aSend(
        [
          poolUtxo('htr-pub-17', 17n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
        ],
        NATIVE_TOKEN_UID,
        11n,
        5n
      );

      // 17 = 11 + 5 + 1 (the recipient's fee) exactly, so no HTR change is left
      // to stand in for the missing shielded input. Split, the 11n would leave
      // halves adding up to its amount; instead the 3n is pulled for a change
      // that pays its own fee and is the second shielded output: 3 − 1 = 2n.
      // HTR: 20 = 11 + 5 + 2 + 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-17', 'htr-pub-3']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([2n, 11n]);
      expect(byValue.get(2n)!.address).toBe(walletSpend());
      expect(byValue.get(11n)!.address).toBe(recipientSpend());
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — with no HTR change, HTR that would pay the split fee exactly is pulled on for the shielded change', async () => {
      const result = await r3aSend(
        [
          poolUtxo('htr-pub-17', 17n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
        ],
        NATIVE_TOKEN_UID,
        11n,
        5n
      );

      // 17 = 11 + 5 + 1 (the recipient's fee) exactly. The 1n would pay the 1n
      // fee of a split exactly, leaving halves that add up to the 11n. As a
      // change it cannot pay its own 1n fee, so the 5n is pulled too: 1 + 5 − 1
      // = 5n, the second shielded output. HTR: 23 = 11 + 5 + 5 + 2 (fees).
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'htr-pub-1',
        'htr-pub-17',
        'htr-pub-5',
      ]);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([5n, 11n]);
      expect(byValue.get(11n)!.address).toBe(recipientSpend());
      expect(byValue.get(5n)!.address).toBe(walletSpend());
      expect(byValue.get(5n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(5n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — with no HTR change, HTR that would pay the split fee exactly, with no more to add, fails the send', async () => {
      const pool = [
        poolUtxo('htr-pub-17', 17n, NATIVE_TOKEN_UID),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
      ];

      // 17 = 11 + 5 + 1 (the recipient's fee) exactly. As a change the 1n cannot
      // pay its own 1n fee, and the wallet has no more HTR.
      await expect(r3aSend(pool, NATIVE_TOKEN_UID, 11n, 5n)).rejects.toThrow(
        new SendTxError(UNFUNDED_STAND_IN_CHANGE)
      );
      // As suggested: pinned transparent, the 1n pays the split's fee and the
      // 11n is split. HTR: 18 = 5 + 6 + 5 + 2 (fees).
      const result = await r3aSend(
        pool,
        NATIVE_TOKEN_UID,
        11n,
        5n,
        ShieldedOutputMode.AMOUNT_SHIELDED,
        OutputKind.TRANSPARENT
      );
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-1', 'htr-pub-17']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — with no HTR change and no HTR to add, the send fails without suggesting a transparent change', async () => {
      const pool = [poolUtxo('htr-pub-17', 17n, NATIVE_TOKEN_UID)];

      // 17 = 11 + 5 + 1 (the recipient's fee) exactly, and the wallet has no
      // more HTR to make a change from.
      await expect(r3aSend(pool, NATIVE_TOKEN_UID, 11n, 5n)).rejects.toThrow(
        new SendTxError(standInChangeMessage(NO_HTR_CHANGE, '.'))
      );
      // Pinned transparent, the 11n would be split, but the split's fee needs
      // HTR the wallet does not have either.
      await expect(
        r3aSend(
          pool,
          NATIVE_TOKEN_UID,
          11n,
          5n,
          ShieldedOutputMode.AMOUNT_SHIELDED,
          OutputKind.TRANSPARENT
        )
      ).rejects.toThrow(
        new SendTxError(
          'Splitting the lone shielded output requires extra HTR for its fee, and no ' +
            'additional HTR is available.'
        )
      );
    });

    test('R3a fallback — with no HTR change, a change that takes the transaction past its input limit fails the send instead of a split', async () => {
      const pool = Array.from({ length: 256 }, (_, i) =>
        poolUtxo(`htr-pub-1-${i}`, 1n, NATIVE_TOKEN_UID)
      );

      // 254 of the 1n pay 248 + 5 + 1 (the recipient's fee) exactly. A change
      // that pays its own 1n fee takes two more, where a split's fee would take
      // one, and the halves of the 248n would add up to its amount.
      await expect(r3aSend(pool, NATIVE_TOKEN_UID, 248n, 5n)).rejects.toThrow(
        new SendTxError(
          `The transaction needs 256 inputs, more than the ${MAX_INPUTS} a transaction can ` +
            "hold. Consolidate the wallet's UTXOs and try again."
        )
      );
    });

    test('R3a fallback — a 1-unit HTR output with no HTR change, and no HTR to add, fails for the fee without suggesting a transparent change', async () => {
      const pool = [poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID)];

      // 7 = 1 + 5 + 1 (the recipient's fee) exactly, and the wallet has no more
      // HTR to make a change from.
      await expect(r3aSend(pool, NATIVE_TOKEN_UID, 1n, 5n)).rejects.toThrow(
        new SendTxError(standInChangeMessage(NO_HTR_CHANGE, '.'))
      );
      // Pinned transparent, the 1-unit output cannot be split, and still needs
      // a shielded change as its second output.
      await expect(
        r3aSend(
          pool,
          NATIVE_TOKEN_UID,
          1n,
          5n,
          ShieldedOutputMode.AMOUNT_SHIELDED,
          OutputKind.TRANSPARENT
        )
      ).rejects.toThrow(
        new SendTxError(
          "The transaction's only shielded output holds 1 unit, too little to split into the " +
            'two shielded outputs the protocol requires, and changeShieldedMode: ' +
            'OutputKind.TRANSPARENT keeps the change from being shielded as the second one.'
        )
      );
      // With HTR to add, the change is made from it: 7 + 5 = 1 + 5 + 4 + 2 (fees).
      const result = await r3aSend(
        [...pool, poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID)],
        NATIVE_TOKEN_UID,
        1n,
        5n
      );
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([1n, 4n]);
      expect(byValue.get(1n)!.address).toBe(recipientSpend());
      expect(byValue.get(4n)!.address).toBe(walletSpend());
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3a fallback — a 1-unit HTR output whose change is too small for its own fee, with no HTR to add, fails for the fee without suggesting a transparent change', async () => {
      const pool = [poolUtxo('htr-pub-8', 8n, NATIVE_TOKEN_UID)];

      // 8 − 6 − 1 (the recipient's fee) = 1n of change, too small for its own
      // 1n fee, and the wallet has no more HTR.
      await expect(r3aSend(pool, NATIVE_TOKEN_UID, 1n, 5n)).rejects.toThrow(
        new SendTxError(standInChangeMessage(HTR_CHANGE_TOO_SMALL, '.'))
      );
      // Pinned transparent, the change is not the second shielded output the
      // 1-unit output needs either.
      await expect(
        r3aSend(
          pool,
          NATIVE_TOKEN_UID,
          1n,
          5n,
          ShieldedOutputMode.AMOUNT_SHIELDED,
          OutputKind.TRANSPARENT
        )
      ).rejects.toThrow(
        new SendTxError(
          "The transaction's only shielded output holds 1 unit, too little to split into the " +
            'two shielded outputs the protocol requires, and changeShieldedMode: ' +
            'OutputKind.TRANSPARENT keeps the change from being shielded as the second one.'
        )
      );
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

    test('with no shielded address in the wallet, an exact split-fee pull splits', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
        poolUtxo('htr-sh-2', 2n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '24'.repeat(32),
        }),
      ]);
      // The wallet has no shielded address, so it cannot receive a shielded change.
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

    test('with no shielded address in the wallet, a shielded split-fee pull stops at the fee', async () => {
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
      // The wallet has no shielded address, so it cannot receive a shielded change.
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

    const LEGACY_CHANGE_ADDRESS = 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi';
    const LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE =
      "The change must be shielded (all of its token's outputs are shielded, or the transaction " +
      'spends a shielded UTXO), and a legacy change address cannot receive it. Use a new-format ' +
      'change address, or changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.';
    const LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE =
      "The change must be shielded (so the amount of its token's only shielded output cannot be " +
      'computed by subtraction), and a legacy change address cannot receive it. Use a new-format ' +
      'change address, or changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.';
    // The same when the tx's only shielded output holds 1 unit: it cannot be
    // split, so a change kept transparent cannot build the send either.
    const LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE_OF_A_1_UNIT_OUTPUT =
      "The change must be shielded (so the amount of its token's only shielded output cannot be " +
      'computed by subtraction), and a legacy change address cannot receive it. Use a new-format ' +
      'change address.';
    // The caller's own legacy address, the only address these tests treat as the wallet's.
    const ownLegacyChangeAddress = (storage: Storage) =>
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => address === LEGACY_CHANGE_ADDRESS);

    test('a legacy changeAddress fails when the rules must shield the change', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-sh-40', 40n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: 'bb'.repeat(32),
        }),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      ownLegacyChangeAddress(storage);
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
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE)
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
      expect(storage.getCurrentAddress).not.toHaveBeenCalledWith(false, { legacy: false });
    });

    test('a send built from storage alone shields the change to a new-format changeAddress', async () => {
      // No shielded address is loaded in storage, so the caller's changeAddress
      // is the only place the shielded change can go.
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      const changeAddress = buildShieldedAddr(7);
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => address === changeAddress);
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
        changeAddress,
      }).prepareTxData();

      // The 34n custom change stands in for the missing shielded input and goes
      // to the changeAddress.
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([11n, 34n]);
      expect(byValue.get(34n)!.address).toBe(
        new Address(changeAddress, { network: testnetNetwork }).getSpendAddress().base58
      );
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
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE)
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
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE)
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

    test('a legacy changeAddress takes the change of a shielded send whose change mode is transparent', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      ownLegacyChangeAddress(storage);
      const result = await new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
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
        changeAddress: LEGACY_CHANGE_ADDRESS,
        changeShieldedMode: OutputKind.TRANSPARENT,
      }).prepareTxData();

      // Both changes stay transparent at the caller's address: custom 50 − 20 = 30,
      // HTR 9 − 2 (fees) = 7.
      const changes = result.outputs.filter(o => (o as { isChange?: boolean }).isChange);
      expect(changes.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([7n, 30n]);
      expect(
        changes.every(o => (o as { address?: string }).address === LEGACY_CHANGE_ADDRESS)
      ).toBe(true);
      expect(result.shieldedOutputs).toHaveLength(2);
    });

    test('a legacy changeAddress takes the HTR change of a shielded send with no token change', async () => {
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-20', 20n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ]);
      ownLegacyChangeAddress(storage);
      const result = await new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
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
        changeAddress: LEGACY_CHANGE_ADDRESS,
      }).prepareTxData();

      // The custom token is spent exactly, so there is no change to shield; the
      // HTR change stays transparent at the caller's address: 9 − 2 (fees) = 7.
      const changes = result.outputs.filter(o => (o as { isChange?: boolean }).isChange);
      expect(changes.map(o => o.value)).toEqual([7n]);
      expect((changes[0] as { address?: string }).address).toBe(LEGACY_CHANGE_ADDRESS);
    });

    // The R3a send of `token` (11n shielded beside 5n transparent) from `pool`,
    // with the caller's own legacy changeAddress.
    const r3aSendWithLegacyChange = (
      pool: PoolUtxo[],
      token: string,
      {
        shieldedValue = 11n,
        shieldedMode = ShieldedOutputMode.AMOUNT_SHIELDED,
        changeShieldedMode = null,
      }: {
        shieldedValue?: bigint;
        shieldedMode?: ShieldedOutputMode;
        changeShieldedMode?: ChangeOutputMode | null;
      } = {}
    ) => {
      const storage = buildPoolStorage(pool);
      ownLegacyChangeAddress(storage);
      return new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          { address: buildShieldedAddr(1), value: shieldedValue, token, shieldedMode },
          {
            type: OutputType.P2PKH,
            address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
            value: 5n,
            token,
          },
        ],
        changeAddress: LEGACY_CHANGE_ADDRESS,
        changeShieldedMode,
      }).prepareTxData();
    };

    test('a legacy changeAddress fails when the change is shielded in place of a missing shielded input', async () => {
      const pool = [
        poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
      ];

      // No shielded custom UTXO is spent, so a transparent 34n change would
      // publish the 11n by subtraction (50 − 5 − 34).
      await expect(r3aSendWithLegacyChange(pool, CUSTOM_TOKEN)).rejects.toThrow(
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE)
      );
      // As suggested: pinned transparent, the 34n stays at the caller's address
      // and the 11n is split at the recipient.
      const result = await r3aSendWithLegacyChange(pool, CUSTOM_TOKEN, {
        changeShieldedMode: OutputKind.TRANSPARENT,
      });
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const customChange = result.outputs.find(
        o =>
          (o as { isChange?: boolean }).isChange && (o as { token?: string }).token === CUSTOM_TOKEN
      );
      expect(customChange!.value).toBe(34n);
      expect((customChange as { address?: string }).address).toBe(LEGACY_CHANGE_ADDRESS);
    });

    test('a legacy changeAddress fails with a shielded change mode', async () => {
      const storage = buildPoolStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)]);
      ownLegacyChangeAddress(storage);

      await expect(
        new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 8n, token: NATIVE_TOKEN_UID },
          ],
          changeAddress: LEGACY_CHANGE_ADDRESS,
          changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        }).prepareTxData()
      ).rejects.toThrow(
        new SendTxError(
          'A legacy change address cannot receive the shielded change that changeShieldedMode ' +
            'requests — use a new-format change address.'
        )
      );
    });

    test('a legacy changeAddress fails when HTR pulled for the second shielded output must be shielded', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-pub-12', 12n, NATIVE_TOKEN_UID),
        poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
      ]);
      ownLegacyChangeAddress(storage);

      // 12 pays 11 + 1 (fee) exactly. The second shielded output's fee comes from
      // the 5n, whose surplus must be a shielded change because all HTR outputs
      // are shielded; a legacy change address cannot receive it.
      await expect(
        new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 11n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
          ],
          changeAddress: LEGACY_CHANGE_ADDRESS,
        }).prepareTxData()
      ).rejects.toThrow(new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE));
    });

    // The split fee of a lone shielded custom output, pulled from these pools,
    // spends shielded HTR that the public fee alone would reveal by
    // subtraction, so with no change address the pull ends in a shielded HTR
    // change instead (the same pools as the structural tests above).
    test.each([
      [
        'spending a shielded 1n on the split fee alone',
        ShieldedOutputMode.AMOUNT_SHIELDED,
        [
          poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'b1'.repeat(32),
          }),
          poolUtxo('htr-sh-7', 7n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'b2'.repeat(32),
          }),
        ],
      ],
      [
        'landing exactly on the split fee with shielded HTR',
        ShieldedOutputMode.FULLY_SHIELDED,
        [
          poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-2', 2n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'b3'.repeat(32),
          }),
        ],
      ],
      [
        'spending a small HTR change and a shielded top-up on the split fee',
        ShieldedOutputMode.FULLY_SHIELDED,
        [
          poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'b4'.repeat(32),
          }),
        ],
      ],
    ])('a legacy changeAddress fails instead of %s', async (_, shieldedMode, htrPool) => {
      const send = (changeShieldedMode: ChangeOutputMode | null) => {
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
          ...htrPool,
        ]);
        ownLegacyChangeAddress(storage);
        return new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            { address: buildShieldedAddr(1), value: 10n, token: CUSTOM_TOKEN, shieldedMode },
          ],
          changeAddress: LEGACY_CHANGE_ADDRESS,
          changeShieldedMode,
        }).prepareTxData();
      };

      await expect(send(null)).rejects.toThrow(
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE)
      );
      // As suggested: pinned transparent, the pull stops at the split fee and
      // the output is split.
      const pinned = await send(OutputKind.TRANSPARENT);
      expect(pinned.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(pinned.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
    });

    test('a legacy changeAddress takes an exact transparent split-fee pull, which hides nothing', async () => {
      // The custom token takes 250 inputs. Its 2n fee and the 11n HTR output
      // leave HTR 5 inputs: its transparent 12n cannot pay the 13n, so the two
      // 5n are topped up with the shielded 2n and 1n exactly, which makes the
      // HTR change amount-shielded, and the 2n is left for the split's 2n fee.
      const send = (changeAddress?: string) => {
        const storage = buildPoolStorage([
          ...Array.from({ length: 250 }, (_, i) => poolUtxo(`custom-pub-1-${i}`, 1n, CUSTOM_TOKEN)),
          poolUtxo('htr-pub-5a', 5n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-5b', 5n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-2', 2n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'b5'.repeat(32),
          }),
          poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'b6'.repeat(32),
          }),
        ]);
        ownLegacyChangeAddress(storage);
        return new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 250n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 11n,
              token: NATIVE_TOKEN_UID,
            },
          ],
          ...(changeAddress ? { changeAddress } : {}),
        }).prepareTxData();
      };

      // With no change address the pulled 2n becomes an amount-shielded change,
      // whose 1n fee is less than the split's 2n: the last of 255 inputs.
      const unpinned = await send();
      expect(unpinned.inputs).toHaveLength(MAX_INPUTS);
      expect(unpinned.inputs.map(i => i.txId)).toContain('htr-pub-2');
      expect(unpinned.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        250n,
      ]);
      // A legacy change address cannot receive that change, and the pull spent
      // no shielded HTR, so the 2n pays the split's fee instead.
      const legacy = await send(LEGACY_CHANGE_ADDRESS);
      expect(legacy.inputs).toHaveLength(MAX_INPUTS);
      expect(legacy.inputs.map(i => i.txId)).toContain('htr-pub-2');
      expect(legacy.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(legacy.shieldedOutputs!.map(o => o.value)).toEqual([125n, 125n]);
      const feeHeader = legacy.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(4n);
    });

    // The wallet owns `addresses` and no other.
    const ownAddresses = (storage: Storage, addresses: string[]) =>
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => addresses.includes(address));
    const spendOf = (shieldedAddress: string) =>
      new Address(shieldedAddress, { network: testnetNetwork }).getSpendAddress().base58;
    type ChangeOptions = { changeAddress?: string; changeShieldedMode?: ChangeOutputMode };

    test('a legacy changeAddress fails when an exact match from one shielded input forces a change', async () => {
      const walletAddress = buildShieldedAddr(0);
      const newFormatChange = buildShieldedAddr(7);
      // 10 + 5 pays the 15n exactly from one shielded input, so the 7n is added
      // for a change, and spending it makes the change shielded.
      const send = (options: ChangeOptions) => {
        const storage = buildPoolStorage([
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'a1'.repeat(32),
          }),
          poolUtxo('htr-sh-7', 7n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'a2'.repeat(32),
          }),
        ]);
        ownAddresses(storage, [LEGACY_CHANGE_ADDRESS, newFormatChange]);
        return new SendTransaction({
          wallet: buildWallet(storage, walletAddress),
          outputs: [
            { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 15n, token: NATIVE_TOKEN_UID },
          ],
          ...options,
        }).prepareTxData();
      };

      await expect(send({ changeAddress: LEGACY_CHANGE_ADDRESS })).rejects.toThrow(
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE)
      );
      // Without a changeAddress, or with a new-format one, the 7n change is
      // shielded there: 7 − 1 (its fee) − 1 (the split fee) = 5n, split into
      // 2n + 3n. HTR: 22 = 15 + 2 + 3 + 2 (fees).
      const expectChangeShieldedAt = (result: IDataTx, changeAt: string) => {
        expect(result.inputs.map(i => i.txId).sort()).toEqual([
          'htr-pub-10',
          'htr-sh-5',
          'htr-sh-7',
        ]);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          2n,
          3n,
        ]);
        expect(result.shieldedOutputs!.every(o => o.address === spendOf(changeAt))).toBe(true);
      };
      expectChangeShieldedAt(await send({}), walletAddress);
      expectChangeShieldedAt(await send({ changeAddress: newFormatChange }), newFormatChange);
      // Pinned transparent, a change would hide nothing, so none is forced: 10 +
      // 5 pays the 15n and the shielded 5n is unshielded.
      const pinned = await send({
        changeAddress: LEGACY_CHANGE_ADDRESS,
        changeShieldedMode: OutputKind.TRANSPARENT,
      });
      expect(pinned.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-10', 'htr-sh-5']);
      expect(pinned.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(pinned.shieldedOutputs ?? []).toHaveLength(0);
      expect(pinned.excessBlindingFactor).toBeDefined();
    });

    // The custom pool of the sends below: a shielded 3n the rules force in, the
    // 50n that pays the rest, and HTR for the fees.
    const forcedInputPool = () => [
      poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
      poolUtxo('custom-sh-3', 3n, CUSTOM_TOKEN, {
        shielded: true,
        blindingFactor: 'a3'.repeat(32),
      }),
      poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
    ];

    test('a legacy changeAddress fails when a lone shielded output forces a shielded input', async () => {
      const walletAddress = buildShieldedAddr(0);
      const recipient = buildShieldedAddr(1);
      const newFormatChange = buildShieldedAddr(7);
      // The 11n beside a transparent 5n forces the shielded 3n in, and spending
      // it makes the 50 + 3 − 16 = 37n change shielded.
      const send = (options: ChangeOptions) => {
        const storage = buildPoolStorage(forcedInputPool());
        ownAddresses(storage, [LEGACY_CHANGE_ADDRESS, newFormatChange]);
        return new SendTransaction({
          wallet: buildWallet(storage, walletAddress),
          outputs: [
            {
              address: recipient,
              value: 11n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 5n,
              token: CUSTOM_TOKEN,
            },
          ],
          ...options,
        }).prepareTxData();
      };

      await expect(send({ changeAddress: LEGACY_CHANGE_ADDRESS })).rejects.toThrow(
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE)
      );
      // Without a changeAddress, or with a new-format one, the 37n change is
      // shielded there as the second shielded output. HTR: 9 = 2 (fees) + 7.
      const expectChangeShieldedAt = (result: IDataTx, changeAt: string) => {
        expect(result.inputs.map(i => i.txId).sort()).toEqual([
          'custom-pub-50',
          'custom-sh-3',
          'htr-pub-9',
        ]);
        const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
        expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([11n, 37n]);
        expect(byValue.get(11n)!.address).toBe(spendOf(recipient));
        expect(byValue.get(37n)!.address).toBe(spendOf(changeAt));
        const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
        expect(feeHeader.entries[0].amount).toBe(2n);
      };
      expectChangeShieldedAt(await send({}), walletAddress);
      expectChangeShieldedAt(await send({ changeAddress: newFormatChange }), newFormatChange);
      // Pinned transparent, the 37n stays at the caller's address and the 11n,
      // the only shielded output, is split. HTR: 9 = 2 (fees) + 7.
      const pinned = await send({
        changeAddress: LEGACY_CHANGE_ADDRESS,
        changeShieldedMode: OutputKind.TRANSPARENT,
      });
      expect(pinned.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-50',
        'custom-sh-3',
        'htr-pub-9',
      ]);
      expect(pinned.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const changes = pinned.outputs.filter(o => (o as { isChange?: boolean }).isChange);
      expect(changes.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([7n, 37n]);
      expect(
        changes.every(o => (o as { address?: string }).address === LEGACY_CHANGE_ADDRESS)
      ).toBe(true);
    });

    test('a legacy changeAddress fails when an external shielded output forces a shielded input', async () => {
      const walletAddress = buildShieldedAddr(0);
      const recipient = buildShieldedAddr(1);
      const newFormatChange = buildShieldedAddr(7);
      // Two 10n shielded outputs, one of them to the wallet itself, beside a
      // transparent 5n: the external one forces the shielded 3n in, and spending
      // it makes the 50 + 3 − 25 = 28n change shielded.
      const send = (options: ChangeOptions) => {
        const storage = buildPoolStorage(forcedInputPool());
        ownAddresses(storage, [LEGACY_CHANGE_ADDRESS, walletAddress, newFormatChange]);
        return new SendTransaction({
          wallet: buildWallet(storage, walletAddress),
          outputs: [
            {
              address: walletAddress,
              value: 10n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              address: recipient,
              value: 10n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 5n,
              token: CUSTOM_TOKEN,
            },
          ],
          ...options,
        }).prepareTxData();
      };

      await expect(send({ changeAddress: LEGACY_CHANGE_ADDRESS })).rejects.toThrow(
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_SHIELDED_CHANGE)
      );
      // Without a changeAddress, or with a new-format one, the 28n change is
      // shielded there. HTR: 9 = 3 (fees) + 6.
      const expectChangeShieldedAt = (result: IDataTx, changeAt: string) => {
        expect(result.inputs.map(i => i.txId).sort()).toEqual([
          'custom-pub-50',
          'custom-sh-3',
          'htr-pub-9',
        ]);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          10n,
          10n,
          28n,
        ]);
        expect(result.shieldedOutputs!.find(o => o.value === 28n)!.address).toBe(spendOf(changeAt));
        const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
        expect(feeHeader.entries[0].amount).toBe(3n);
      };
      expectChangeShieldedAt(await send({}), walletAddress);
      expectChangeShieldedAt(await send({ changeAddress: newFormatChange }), newFormatChange);
      // Pinned transparent, the 28n stays at the caller's address beside the two
      // shielded outputs. HTR: 9 = 2 (fees) + 7.
      const pinned = await send({
        changeAddress: LEGACY_CHANGE_ADDRESS,
        changeShieldedMode: OutputKind.TRANSPARENT,
      });
      expect(pinned.inputs.map(i => i.txId).sort()).toEqual([
        'custom-pub-50',
        'custom-sh-3',
        'htr-pub-9',
      ]);
      expect(pinned.shieldedOutputs!.map(o => o.value)).toEqual([10n, 10n]);
      const changes = pinned.outputs.filter(o => (o as { isChange?: boolean }).isChange);
      expect(changes.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([7n, 28n]);
      expect(
        changes.every(o => (o as { address?: string }).address === LEGACY_CHANGE_ADDRESS)
      ).toBe(true);
    });

    test('a legacy changeAddress fails when the HTR change is shielded in place of a missing shielded input', async () => {
      const pool = [poolUtxo('htr-pub-30', 30n, NATIVE_TOKEN_UID)];

      // No shielded HTR is spent, and the 30 − 16 − 1 (the recipient's fee) = 13n
      // change pays its own fee, so it is shielded to hide the 11n.
      await expect(r3aSendWithLegacyChange(pool, NATIVE_TOKEN_UID)).rejects.toThrow(
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE)
      );
      // Pinned transparent, it pays the split fee instead and stays at the
      // caller's address: 13 − 1 = 12n. HTR: 30 = 5 + 5 + 6 + 12 + 2 (fees).
      const result = await r3aSendWithLegacyChange(pool, NATIVE_TOKEN_UID, {
        changeShieldedMode: OutputKind.TRANSPARENT,
      });
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
      expect(change!.value).toBe(12n);
      expect((change as { address?: string }).address).toBe(LEGACY_CHANGE_ADDRESS);
    });

    test('a legacy changeAddress fails when HTR added to a change too small for its own fee lets it be shielded in place of a missing shielded input', async () => {
      // 19 pays 11 + 5 + 2 (the recipient's fee) and leaves 1n, below its own 2n
      // fee; the 10n added to it lets it be shielded.
      await expect(
        r3aSendWithLegacyChange(
          [
            poolUtxo('htr-pub-19', 19n, NATIVE_TOKEN_UID),
            poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
          ],
          NATIVE_TOKEN_UID,
          { shieldedMode: ShieldedOutputMode.FULLY_SHIELDED }
        )
      ).rejects.toThrow(new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE));
    });

    test('a legacy changeAddress fails when HTR pulled for the second shielded output is shielded in place of a missing shielded input', async () => {
      // 17 = 11 + 5 + 1 (the recipient's fee) exactly. The 3n pulled for the
      // second output's fee leaves a change that is shielded to hide the 11n.
      await expect(
        r3aSendWithLegacyChange(
          [
            poolUtxo('htr-pub-17', 17n, NATIVE_TOKEN_UID),
            poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
          ],
          NATIVE_TOKEN_UID
        )
      ).rejects.toThrow(new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE));
    });

    test('a legacy changeAddress fails when HTR that would pay the split fee exactly is pulled on for a change shielded in place of a missing shielded input', async () => {
      const pool = [
        poolUtxo('htr-pub-17', 17n, NATIVE_TOKEN_UID),
        poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
        poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
      ];

      // 17 = 11 + 5 + 1 (the recipient's fee) exactly. The 1n would pay a
      // split's fee exactly, but the halves of the 11n would add up to its
      // amount, so the 5n is pulled too, for a change that pays its own fee.
      await expect(r3aSendWithLegacyChange(pool, NATIVE_TOKEN_UID)).rejects.toThrow(
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE)
      );
      // As suggested: pinned transparent, the 1n pays the split's fee and
      // nothing is left for the caller's address. 18 = 5 + 6 + 5 + 2 (fees).
      const result = await r3aSendWithLegacyChange(pool, NATIVE_TOKEN_UID, {
        changeShieldedMode: OutputKind.TRANSPARENT,
      });
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-1', 'htr-pub-17']);
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('with a legacy changeAddress, a 1-unit HTR output with no HTR to make a change from fails for the fee, not the address', async () => {
      // 7 = 1 + 5 + 1 (the recipient's fee) exactly, and the wallet has no more
      // HTR: a new-format change address would not fund the change.
      await expect(
        r3aSendWithLegacyChange([poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID)], NATIVE_TOKEN_UID, {
          shieldedValue: 1n,
        })
      ).rejects.toThrow(new SendTxError(standInChangeMessage(NO_HTR_CHANGE, '.')));
    });

    test('with a legacy changeAddress, a 1-unit HTR output whose change is funded fails for the address, the only way out', async () => {
      // The 5n is pulled for a change that pays its own fee, which the legacy
      // address cannot receive. Kept transparent, the change could not be the
      // 1-unit output's second shielded output, so that is not suggested.
      await expect(
        r3aSendWithLegacyChange(
          [
            poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID),
            poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
          ],
          NATIVE_TOKEN_UID,
          { shieldedValue: 1n }
        )
      ).rejects.toThrow(
        new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE_OF_A_1_UNIT_OUTPUT)
      );
    });

    test('with a legacy changeAddress, an HTR change too small for its own fee, with no HTR to add, fails for the fee, not the address', async () => {
      const pool = [poolUtxo('htr-pub-18', 18n, NATIVE_TOKEN_UID)];

      // As without a changeAddress, the 1n change cannot pay its own fee, which
      // a new-format change address would not change.
      await expect(r3aSendWithLegacyChange(pool, NATIVE_TOKEN_UID)).rejects.toThrow(
        new SendTxError(UNFUNDED_STAND_IN_CHANGE)
      );
      // As suggested: pinned transparent, the change pays the split's fee, and
      // nothing is left for the caller's address. 18 = 5 + 6 + 5 + 2 (fees).
      const result = await r3aSendWithLegacyChange(pool, NATIVE_TOKEN_UID, {
        changeShieldedMode: OutputKind.TRANSPARENT,
      });
      expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        5n,
        6n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('with a legacy changeAddress, a change at the shielded-output limit fails for the limit, not the address', async () => {
      const send = (changeShieldedMode: ChangeOutputMode | null) => {
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-63', 63n, NATIVE_TOKEN_UID),
        ]);
        ownLegacyChangeAddress(storage);
        const htrRecipients = [buildShieldedAddr(2), buildShieldedAddr(3)];
        const htrOutputs = Array.from({ length: MAX_SHIELDED_OUTPUTS - 1 }, (_, i) => ({
          address: htrRecipients[i % 2],
          value: 1n,
          token: NATIVE_TOKEN_UID,
          shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        }));
        return new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 11n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 5n,
              token: CUSTOM_TOKEN,
            },
            ...htrOutputs,
          ],
          changeAddress: LEGACY_CHANGE_ADDRESS,
          changeShieldedMode,
        }).prepareTxData();
      };

      // 32 shielded outputs already: shielding the 34n change would make 33,
      // which a new-format change address would not change.
      await expect(send(null)).rejects.toThrow(new SendTxError(STAND_IN_CHANGE_AT_THE_LIMIT));
      // As suggested: pinned transparent, the 34n change stays transparent, at
      // the caller's address. HTR: 63 = 31 + 32 (fees).
      const result = await send(OutputKind.TRANSPARENT);
      expect(result.shieldedOutputs).toHaveLength(MAX_SHIELDED_OUTPUTS);
      const customChange = result.outputs.find(
        o =>
          (o as { isChange?: boolean }).isChange && (o as { token?: string }).token === CUSTOM_TOKEN
      );
      expect(customChange!.value).toBe(34n);
      expect((customChange as { address?: string }).address).toBe(LEGACY_CHANGE_ADDRESS);
    });

    test.each([
      ['no shielded keys', (storage: Storage) => storage],
      ['shielded keys but no shielded address in its store', withShieldedKeysOnly],
    ])(
      'with a legacy changeAddress, a wallet with %s fails for the wallet, not the address',
      async (_, withoutShieldedAddress) => {
        const send = (changeShieldedMode: ChangeOutputMode | null) => {
          const storage = withoutShieldedAddress(
            buildPoolStorage([
              poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
              poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
            ])
          );
          ownLegacyChangeAddress(storage);
          return new SendTransaction({
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
                address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
                value: 5n,
                token: CUSTOM_TOKEN,
              },
            ],
            changeAddress: LEGACY_CHANGE_ADDRESS,
            changeShieldedMode,
          }).prepareTxData();
        };

        // The wallet cannot receive a shielded change, which a new-format change
        // address would not change.
        const refused = send(null);
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_WITHOUT_A_SHIELDED_ADDRESS)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the 34n stays transparent at the
        // caller's address and the 11n is split at the recipient.
        const result = await send(OutputKind.TRANSPARENT);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          5n,
          6n,
        ]);
        expect(result.shieldedOutputs!.every(o => o.address === recipientSpend())).toBe(true);
        const customChange = result.outputs.find(
          o =>
            (o as { isChange?: boolean }).isChange &&
            (o as { token?: string }).token === CUSTOM_TOKEN
        );
        expect(customChange!.value).toBe(34n);
        expect((customChange as { address?: string }).address).toBe(LEGACY_CHANGE_ADDRESS);
      }
    );

    test.each([
      ['no shielded keys', (storage: Storage) => storage],
      ['shielded keys but no shielded address in its store', withShieldedKeysOnly],
    ])(
      'with a legacy changeAddress, a wallet with %s is told it cannot receive a change that must be shielded',
      async (_, withoutShieldedAddress) => {
        const storage = withoutShieldedAddress(
          buildPoolStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)])
        );
        ownLegacyChangeAddress(storage);
        const refused = new SendTransaction({
          storage,
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 5n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              address: buildShieldedAddr(2),
              value: 5n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
          ],
          changeAddress: LEGACY_CHANGE_ADDRESS,
        }).prepareTxData();

        // All HTR outputs are shielded, so the 8n change must be. A new-format
        // change address is no way out for this wallet, so it gets the error
        // it gets with no change address.
        await expect(refused).rejects.toThrow(
          new SendTxError(
            'A shielded change is required, but the wallet has no shielded address to receive ' +
              'it; pass changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.'
          )
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
      }
    );

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

    test('a wallet without HTR is told the shielded change needs its fee', async () => {
      // Shielded custom-token funds only, no HTR: spending them shields the
      // change, whose fee is paid in HTR.
      const pool = [
        poolUtxo('custom-sh-50', 50n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '5a'.repeat(32),
        }),
      ];
      const send = (changeShieldedMode: ChangeOutputMode | null) =>
        new SendTransaction({
          wallet: buildWallet(buildPoolStorage(pool), buildShieldedAddr(0)),
          outputs: [
            {
              type: OutputType.P2PKH,
              address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
              value: 40n,
              token: CUSTOM_TOKEN,
            },
          ],
          changeShieldedMode,
        }).prepareTxData();

      await expect(send(null)).rejects.toThrow(
        new SendTxError(
          `Token: ${NATIVE_TOKEN_UID}. Insufficient amount of tokens to fill the amount. The ` +
            'amount includes the fee to shield the change; pass changeShieldedMode: ' +
            'OutputKind.TRANSPARENT to keep the change transparent.'
        )
      );
      // A pinned shielded change gets no suggestion to drop it.
      await expect(send(ShieldedOutputMode.AMOUNT_SHIELDED)).rejects.toThrow(
        new SendTxError(
          `Token: ${NATIVE_TOKEN_UID}. Insufficient amount of tokens to fill the amount. The ` +
            'amount includes the fee to shield the change.'
        )
      );
      // As suggested: the 10n change stays transparent and no HTR is needed.
      const result = await send(OutputKind.TRANSPARENT);
      const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
      expect(change!.value).toBe(10n);
    });

    test('a 1-unit change that is the only shielded output takes the HTR change as the second one', async () => {
      // An exact match from the shielded 10n forces the 1n in for a change to
      // hide behind; that 1n change cannot be split into two outputs.
      const result = await new SendTransaction({
        wallet: buildWallet(
          buildPoolStorage([
            poolUtxo('custom-sh-10', 10n, CUSTOM_TOKEN, {
              shielded: true,
              blindingFactor: '5b'.repeat(32),
            }),
            poolUtxo('custom-sh-1', 1n, CUSTOM_TOKEN, {
              shielded: true,
              blindingFactor: '5c'.repeat(32),
            }),
            poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
          ]),
          buildShieldedAddr(0)
        ),
        outputs: [
          {
            type: OutputType.P2PKH,
            address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
            value: 10n,
            token: CUSTOM_TOKEN,
          },
        ],
      }).prepareTxData();

      // The HTR change, 5 − 1 (the custom change's fee) = 4n, is shielded as the
      // second output instead: 4 − 1 = 3n. Fee 2n.
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'custom-sh-1',
        'custom-sh-10',
        'htr-pub-5',
      ]);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([1n, 3n]);
      expect(byValue.get(1n)!.token).toBe(CUSTOM_TOKEN);
      expect(byValue.get(3n)!.token).toBe(NATIVE_TOKEN_UID);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    // Make caller-supplied inputs resolvable: each UTXO is output 0 of its own
    // tx, at an address the wallet owns.
    const supplyCallerInputs = (storage: Storage, utxos: PoolUtxo[]) => {
      jest.spyOn(storage, 'getTx').mockImplementation((async (txId: string) => {
        const utxo = utxos.find(u => u.txId === txId);
        if (!utxo) {
          return null;
        }
        const decoded = { address: utxo.address };
        if (utxo.shielded) {
          return {
            tx_id: txId,
            outputs: [],
            shielded_outputs: [
              {
                mode: 1,
                commitment: '',
                range_proof: '',
                script: '',
                ephemeral_pubkey: '',
                decoded,
                value: utxo.value,
                token: utxo.token,
                blindingFactor: utxo.blindingFactor,
              },
            ],
            inputs: [],
          };
        }
        return {
          tx_id: txId,
          outputs: [
            {
              value: utxo.value,
              token: utxo.token,
              token_data: 0,
              script: '',
              decoded,
              spent_by: null,
            },
          ],
          shielded_outputs: [],
          inputs: [],
        };
      }) as never);
      const own = new Set(utxos.map(u => u.address));
      jest.spyOn(storage, 'isAddressMine').mockImplementation(async address => own.has(address));
    };

    // The wallet holds a spare 50n HTR in each of these: adding it would build
    // the tx, but caller-supplied HTR inputs are never added to.
    test('a shielded HTR change of caller inputs too small to split is not topped up', async () => {
      const callerInput = poolUtxo('caller-sh-11', 11n, NATIVE_TOKEN_UID, {
        shielded: true,
        blindingFactor: '6a'.repeat(32),
      });
      const storage = buildPoolStorage([
        callerInput,
        poolUtxo('htr-pub-50', 50n, NATIVE_TOKEN_UID),
      ]);
      supplyCallerInputs(storage, [callerInput]);

      // 11 − 8 = 3n of change mirrors the shielded input: 3 − 1 (its fee) = 2n,
      // which cannot pay the split's 1n fee and leave two halves of 1n.
      await expect(
        new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 8n, token: NATIVE_TOKEN_UID },
          ],
          inputs: [{ txId: 'caller-sh-11', index: 0 }],
        }).prepareTxData()
      ).rejects.toThrow(
        'The shielded HTR change is too small to split into the two shielded outputs the ' +
          'protocol requires, and HTR inputs were user-supplied so no additional HTR can be selected.'
      );
    });

    const fullyShieldedTokenSend = (callerHtr: bigint) => {
      const callerInput = poolUtxo(`caller-pub-${callerHtr}`, callerHtr, NATIVE_TOKEN_UID);
      const storage = buildPoolStorage([
        callerInput,
        poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-50', 50n, NATIVE_TOKEN_UID),
      ]);
      supplyCallerInputs(storage, [callerInput]);
      return new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
          },
        ],
        inputs: [{ txId: callerInput.txId, index: 0 }],
      }).prepareTxData();
    };

    test('the split fee is not drawn beyond a caller-supplied HTR change', async () => {
      // The caller's 3n pays the output's 2n fee, leaving 1n of change for a
      // 2n split fee.
      await expect(fullyShieldedTokenSend(3n)).rejects.toThrow(
        'The HTR change cannot fund the shielded-output split the protocol requires, and HTR ' +
          'inputs were user-supplied so no additional HTR can be selected.'
      );
    });

    test('the split fee is not drawn from the wallet when caller HTR leaves no change', async () => {
      // The caller's 2n pays the output's 2n fee exactly; the split needs 2n more.
      await expect(fullyShieldedTokenSend(2n)).rejects.toThrow(
        'Splitting the lone shielded output requires extra HTR for its fee, and HTR inputs were ' +
          'user-supplied so no additional HTR can be selected.'
      );
    });

    // The same three sends with the wallet choosing the HTR, when it holds no
    // more HTR than it spends: each fails, saying no more HTR is available.
    test('a shielded HTR change too small to split fails when the wallet has no more HTR', async () => {
      const storage = buildPoolStorage([
        poolUtxo('htr-sh-11', 11n, NATIVE_TOKEN_UID, {
          shielded: true,
          blindingFactor: '6b'.repeat(32),
        }),
      ]);

      // 11 − 8 = 3n of change mirrors the shielded input: 3 − 1 (its fee) = 2n,
      // which cannot pay the split's 1n fee and leave two halves of 1n.
      await expect(
        new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 8n, token: NATIVE_TOKEN_UID },
          ],
        }).prepareTxData()
      ).rejects.toThrow(
        'The shielded HTR change is too small to split into the two shielded outputs the ' +
          'protocol requires, and no additional HTR is available.'
      );
    });

    const fullyShieldedTokenSendFromWallet = (htr: bigint) =>
      new SendTransaction({
        wallet: buildWallet(
          buildPoolStorage([
            poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
            poolUtxo(`htr-pub-${htr}`, htr, NATIVE_TOKEN_UID),
          ]),
          buildShieldedAddr(0)
        ),
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
          },
        ],
      }).prepareTxData();

    test('the split fee fails when the HTR change cannot pay it and the wallet has no more HTR', async () => {
      // The 3n pays the output's 2n fee, leaving 1n of change for a 2n split fee.
      await expect(fullyShieldedTokenSendFromWallet(3n)).rejects.toThrow(
        'The HTR change cannot fund the shielded-output split the protocol requires, and no ' +
          'additional HTR is available.'
      );
    });

    test('splitting the lone output fails when no HTR change is left and the wallet has no more HTR', async () => {
      // The 2n pays the output's 2n fee exactly; the split needs 2n more.
      await expect(fullyShieldedTokenSendFromWallet(2n)).rejects.toThrow(
        'Splitting the lone shielded output requires extra HTR for its fee, and no additional ' +
          'HTR is available.'
      );
    });

    test('HTR pulled for the second shielded output is never a UTXO that is not available', async () => {
      const result = await r3aSend(
        [
          poolUtxo('htr-pub-17', 17n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-1-locked', 1n, NATIVE_TOKEN_UID, { locked: true }),
          poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
        ],
        NATIVE_TOKEN_UID,
        11n,
        5n
      );

      // 17 pays 11 + 5 + 1 exactly. The pull for the second output skips the
      // locked 1n, the smallest, and takes the 3n.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-17', 'htr-pub-3']);
    });

    test('a FEE token spent only from shielded UTXOs pays no melt fee', async () => {
      const storage = buildPoolStorage([
        poolUtxo('fee-sh-20', 20n, FEE_TOKEN, { shielded: true, blindingFactor: '6b'.repeat(32) }),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ]);
      const result = await new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: FEE_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 10n,
            token: FEE_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
      }).prepareTxData();

      // The node cannot see a shielded input's token, so it charges no melt fee
      // for it, and the token has no transparent output: the fee is just the
      // two shielded outputs'. HTR: 10 = 2 + 8.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['fee-sh-20', 'htr-pub-10']);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('a FEE token spent only from a caller-supplied shielded input pays no melt fee', async () => {
      const callerInput = poolUtxo('caller-fee-sh-20', 20n, FEE_TOKEN, {
        shielded: true,
        blindingFactor: '6d'.repeat(32),
      });
      const storage = buildPoolStorage([
        callerInput,
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ]);
      supplyCallerInputs(storage, [callerInput]);
      const result = await new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token: FEE_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: buildShieldedAddr(2),
            value: 10n,
            token: FEE_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
        inputs: [{ txId: 'caller-fee-sh-20', index: 0 }],
      }).prepareTxData();

      // As with a selected one, the caller's shielded input pays no melt fee:
      // the fee is just the two shielded outputs'. HTR: 10 = 2 + 8.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['caller-fee-sh-20', 'htr-pub-10']);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('R3b — shielded outputs that all pay the wallet force no shielded input', async () => {
      const own = [buildShieldedAddr(0), buildShieldedAddr(2)];
      const storage = buildPoolStorage([
        poolUtxo('custom-pub-100', 100n, CUSTOM_TOKEN),
        poolUtxo('custom-sh-40', 40n, CUSTOM_TOKEN, {
          shielded: true,
          blindingFactor: '6c'.repeat(32),
        }),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ]);
      jest
        .spyOn(storage, 'isAddressMine')
        .mockImplementation(async address => own.includes(address));
      const result = await new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [
          {
            address: own[0],
            value: 10n,
            token: CUSTOM_TOKEN,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
          {
            address: own[1],
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
      }).prepareTxData();

      // Shielded outputs that all pay the wallet take no shielded input, so
      // their total is published, which the rules accept when the wallet pays
      // itself: the transparent 100n pays, the 40n stays.
      const inputIds = result.inputs.map(i => i.txId);
      expect(inputIds).toContain('custom-pub-100');
      expect(inputIds).not.toContain('custom-sh-40');
    });

    // One unit of a token (an NFT) sent shielded to one recipient: the output
    // cannot be split, so the HTR change becomes the second shielded output.
    const sendOneNft = (
      storage: Storage,
      shieldedMode: ShieldedOutputMode = ShieldedOutputMode.AMOUNT_SHIELDED,
      options: {
        changeShieldedMode?: ChangeOutputMode | null;
        changeAddress?: string;
        inputs?: { txId: string; index: number }[];
      } = {}
    ) =>
      new SendTransaction({
        wallet: buildWallet(storage, buildShieldedAddr(0)),
        outputs: [{ address: buildShieldedAddr(1), value: 1n, token: CUSTOM_TOKEN, shieldedMode }],
        ...options,
      }).prepareTxData();
    const unsplittableOutput = (reason: string) =>
      "The transaction's only shielded output holds 1 unit, too little to split into the two " +
      `shielded outputs the protocol requires, and ${reason}.`;

    test('one NFT sent shielded to one recipient takes the HTR change as the second output', async () => {
      const result = await sendOneNft(
        buildPoolStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        ])
      );

      // The HTR change, 10 − 1 (the NFT's fee) = 9n, is shielded as the second
      // output: 9 − 1 (its fee) = 8n. Fee 2n, nothing transparent.
      expect(result.outputs).toHaveLength(0);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([1n, 8n]);
      expect(byValue.get(1n)!.address).toBe(recipientSpend());
      expect(byValue.get(8n)!.token).toBe(NATIVE_TOKEN_UID);
      expect(byValue.get(8n)!.address).toBe(walletSpend());
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('a fully shielded NFT takes an amount-shielded HTR change as the second output', async () => {
      const result = await sendOneNft(
        buildPoolStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        ]),
        ShieldedOutputMode.FULLY_SHIELDED
      );

      // 10 − 2 (the NFT's fee) = 8n of HTR change, shielded at the amount-shielded
      // fee: 8 − 1 = 7n. Fee 3n.
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([1n, 7n]);
      expect(byValue.get(1n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(byValue.get(7n)!.shieldedMode).toBe(ShieldedOutputMode.AMOUNT_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(3n);
    });

    test('an HTR change too small for its own fee takes more HTR to be the second output', async () => {
      const result = await sendOneNft(
        buildPoolStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
        ])
      );

      // The 2n pays the NFT's 1n fee, leaving a 1n change that cannot pay its own
      // 1n fee, so the 5n is pulled into it: 1 + 5 − 1 = 5n. Fee 2n.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-2', 'htr-pub-5', 'nft-1']);
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        5n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    test('with no HTR change, HTR is pulled for one to be the second output', async () => {
      const result = await sendOneNft(
        buildPoolStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-4', 4n, NATIVE_TOKEN_UID),
        ])
      );

      // The 1n pays the NFT's fee exactly; the 4n is pulled for a change:
      // 4 − 1 = 3n. Fee 2n.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-pub-1', 'htr-pub-4', 'nft-1']);
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        3n,
      ]);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(2n);
    });

    const fsHtr = (txId: string, value: bigint) =>
      poolUtxo(txId, value, NATIVE_TOKEN_UID, {
        shielded: true,
        blindingFactor: '7a'.repeat(32),
        assetBlindingFactor: '7b'.repeat(32),
      });

    test('a too-small HTR change topped up from a fully shielded UTXO becomes fully shielded', async () => {
      const result = await sendOneNft(
        buildPoolStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
          fsHtr('htr-fs-5', 5n),
        ]),
        ShieldedOutputMode.FULLY_SHIELDED
      );

      // The 3n pays the NFT's 2n fee, leaving 1n. Only the fully shielded 5n is
      // left to pull, so the change mirrors it: 1 + 5 − 2 = 4n. Fee 4n.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-fs-5', 'htr-pub-3', 'nft-1']);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([1n, 4n]);
      expect(byValue.get(4n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(4n);
    });

    test('a too-small HTR change pulls until it can pay the fully shielded fee', async () => {
      const result = await sendOneNft(
        buildPoolStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
          fsHtr('htr-fs-1a', 1n),
          fsHtr('htr-fs-1b', 1n),
        ]),
        ShieldedOutputMode.FULLY_SHIELDED
      );

      // After the first fully shielded 1n the change is fully shielded and
      // needs more than 2n, so the second is pulled too: 1 + 1 + 1 − 2 = 1n.
      expect(result.inputs.map(i => i.txId).sort()).toEqual([
        'htr-fs-1a',
        'htr-fs-1b',
        'htr-pub-3',
        'nft-1',
      ]);
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect(byValue.get(1n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      expect(result.shieldedOutputs).toHaveLength(2);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(4n);
    });

    test('with no HTR change, HTR pulled from a fully shielded UTXO makes a fully shielded change', async () => {
      const result = await sendOneNft(
        buildPoolStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
          fsHtr('htr-fs-5', 5n),
        ])
      );

      // The 1n pays the NFT's fee exactly; the change comes from the fully
      // shielded 5n and mirrors it: 5 − 2 = 3n. Fee 1 + 2 = 3n.
      const byValue = new Map(result.shieldedOutputs!.map(o => [o.value, o]));
      expect([...byValue.keys()].sort((a, b) => Number(a - b))).toEqual([1n, 3n]);
      expect(byValue.get(3n)!.shieldedMode).toBe(ShieldedOutputMode.FULLY_SHIELDED);
      const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
      expect(feeHeader.entries[0].amount).toBe(3n);
    });

    test('a 1-unit output takes the change of caller-supplied HTR as the second output', async () => {
      const callerHtr = poolUtxo('caller-pub-10', 10n, NATIVE_TOKEN_UID);
      const storage = buildPoolStorage([
        callerHtr,
        poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID),
      ]);
      supplyCallerInputs(storage, [callerHtr]);

      const result = await sendOneNft(storage, ShieldedOutputMode.AMOUNT_SHIELDED, {
        inputs: [{ txId: 'caller-pub-10', index: 0 }],
      });

      // The caller's 10n leaves 9n of change, shielded at its 1n fee: 8n.
      // Nothing is added to the caller's input.
      expect(result.inputs.map(i => i.txId).sort()).toEqual(['caller-pub-10', 'nft-1']);
      expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
        1n,
        8n,
      ]);
    });

    test('a 1-unit output fails when caller-supplied HTR leaves a change too small for its fee', async () => {
      const callerHtr = poolUtxo('caller-pub-2', 2n, NATIVE_TOKEN_UID);
      const storage = buildPoolStorage([
        callerHtr,
        poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID),
      ]);
      supplyCallerInputs(storage, [callerHtr]);

      await expect(
        sendOneNft(storage, ShieldedOutputMode.AMOUNT_SHIELDED, {
          inputs: [{ txId: 'caller-pub-2', index: 0 }],
        })
      ).rejects.toThrow(
        new SendTxError(
          unsplittableOutput(
            'the HTR inputs were user-supplied, so no HTR can be selected for a shielded change'
          )
        )
      );
    });

    test('a 1-unit output fails when no HTR can be added to a change too small for its fee', async () => {
      await expect(
        sendOneNft(
          buildPoolStorage([
            poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
          ])
        )
      ).rejects.toThrow(
        new SendTxError(unsplittableOutput('no HTR is available for a shielded change'))
      );
    });

    test('a 1-unit output with caller-supplied HTR and no HTR change fails', async () => {
      const callerHtr = poolUtxo('caller-pub-1', 1n, NATIVE_TOKEN_UID);
      const storage = buildPoolStorage([
        callerHtr,
        poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ]);
      supplyCallerInputs(storage, [callerHtr]);

      await expect(
        sendOneNft(storage, ShieldedOutputMode.AMOUNT_SHIELDED, {
          inputs: [{ txId: 'caller-pub-1', index: 0 }],
        })
      ).rejects.toThrow(
        new SendTxError(
          unsplittableOutput(
            'the HTR inputs were user-supplied, so no HTR can be selected for a shielded change'
          )
        )
      );
    });

    test('a 1-unit output fails when the change is pinned transparent', async () => {
      const storage = buildPoolStorage([
        poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ]);

      await expect(
        sendOneNft(storage, ShieldedOutputMode.AMOUNT_SHIELDED, {
          changeShieldedMode: OutputKind.TRANSPARENT,
        })
      ).rejects.toThrow(
        new SendTxError(
          unsplittableOutput(
            'changeShieldedMode: OutputKind.TRANSPARENT keeps the change from being shielded as ' +
              'the second one'
          )
        )
      );
    });

    test('a 1-unit output fails when the wallet has no shielded address', async () => {
      // Built from storage alone, with no shielded chain loaded.
      const storage = buildPoolStorage([
        poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ]);

      await expect(
        new SendTransaction({
          storage,
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 1n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
          ],
        }).prepareTxData()
      ).rejects.toThrow(
        new SendTxError(
          unsplittableOutput('the wallet cannot receive a shielded change as the second one')
        )
      );
    });

    test('a 1-unit output fails with a legacy changeAddress', async () => {
      const storage = buildPoolStorage([
        poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
        poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
      ]);
      ownLegacyChangeAddress(storage);

      await expect(
        sendOneNft(storage, ShieldedOutputMode.AMOUNT_SHIELDED, {
          changeAddress: LEGACY_CHANGE_ADDRESS,
        })
      ).rejects.toThrow(
        new SendTxError(
          unsplittableOutput(
            'a legacy change address cannot receive a shielded change as the second one'
          )
        )
      );
    });

    // A JS or HTTP caller can pass anything; none of these may pass for a mode.
    test.each([['TRANSPARENT'], [OutputKind.SHIELDED], [3], [true], [0], [false], ['']])(
      'an unknown changeShieldedMode %p is rejected',
      async changeShieldedMode => {
        const storage = buildPoolStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)]);
        const wallet = buildWallet(storage, buildShieldedAddr(0));

        await expect(
          new SendTransaction({
            wallet,
            outputs: [
              { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 8n, token: NATIVE_TOKEN_UID },
            ],
            changeShieldedMode: changeShieldedMode as unknown as ShieldedOutputMode,
          }).prepareTxData()
        ).rejects.toThrow(
          new SendTxError(
            `Invalid changeShieldedMode '${String(changeShieldedMode)}': expected ` +
              'OutputKind.TRANSPARENT, AMOUNT_SHIELDED or FULLY_SHIELDED.'
          )
        );
      }
    );

    describe('shielded UTXOs spent in the mode that keeps their token private', () => {
      const amountShielded = (byte: string): Partial<PoolUtxo> => ({
        shielded: true,
        blindingFactor: byte.repeat(32),
      });
      const fullyShielded = (byte: string, assetByte: string): Partial<PoolUtxo> => ({
        shielded: true,
        blindingFactor: byte.repeat(32),
        assetBlindingFactor: assetByte.repeat(32),
      });
      const customTo = (i: number, value: bigint, shieldedMode: ShieldedOutputMode) => ({
        address: buildShieldedAddr(i),
        value,
        token: CUSTOM_TOKEN,
        shieldedMode,
      });
      const transparentCustom = (value: bigint) => ({
        type: OutputType.P2PKH,
        address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
        value,
        token: CUSTOM_TOKEN,
      });
      const inputIdsOf = (tx: IDataTx) => tx.inputs.map(i => i.txId).sort();
      const modesOf = (tx: IDataTx) => (tx.shieldedOutputs ?? []).map(o => o.shieldedMode);

      test('an amount-shielded send spends an amount-shielded UTXO before a smaller fully shielded one', async () => {
        const storage = buildPoolStorage([
          poolUtxo('custom-fs-30', 30n, CUSTOM_TOKEN, fullyShielded('43', '44')),
          poolUtxo('custom-as-40', 40n, CUSTOM_TOKEN, amountShielded('45')),
          poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
        ]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [customTo(1, 10n, ShieldedOutputMode.AMOUNT_SHIELDED)],
        }).prepareTxData();

        // The amount-shielded output makes the token public; spending the fully
        // shielded 30n would reveal that it held that token.
        expect(inputIdsOf(result)).toEqual(['custom-as-40', 'htr-pub-5']);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          10n,
          30n,
        ]);
        expect(modesOf(result)).toEqual([
          ShieldedOutputMode.AMOUNT_SHIELDED,
          ShieldedOutputMode.AMOUNT_SHIELDED,
        ]);
      });

      test('the forced shielded input of a mixed send is the smallest amount-shielded UTXO', async () => {
        const storage = buildPoolStorage([
          poolUtxo('custom-fs-3', 3n, CUSTOM_TOKEN, fullyShielded('46', '47')),
          poolUtxo('custom-as-30', 30n, CUSTOM_TOKEN, amountShielded('48')),
          poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
        ]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [customTo(1, 11n, ShieldedOutputMode.AMOUNT_SHIELDED), transparentCustom(5n)],
        }).prepareTxData();

        // The fully shielded 3n is the smallest shielded UTXO. The forced
        // amount-shielded 30n pays the 16n alone, leaving a 14n change.
        expect(inputIdsOf(result)).toEqual(['custom-as-30', 'htr-pub-9']);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          11n,
          14n,
        ]);
        expect(modesOf(result)).toEqual([
          ShieldedOutputMode.AMOUNT_SHIELDED,
          ShieldedOutputMode.AMOUNT_SHIELDED,
        ]);
      });

      test('a transparent send short of transparent UTXOs tops up with an amount-shielded UTXO', async () => {
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-40', 40n, CUSTOM_TOKEN),
          poolUtxo('custom-fs-20', 20n, CUSTOM_TOKEN, fullyShielded('4a', '4b')),
          poolUtxo('custom-as-30', 30n, CUSTOM_TOKEN, amountShielded('4c')),
          poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
        ]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [transparentCustom(50n)],
        }).prepareTxData();

        // The transparent 40n falls 10n short of the transparent output, which
        // the fully shielded 20n would pay by value alone.
        expect(inputIdsOf(result)).toEqual(['custom-as-30', 'custom-pub-40', 'htr-pub-9']);
        expect(modesOf(result).every(m => m === ShieldedOutputMode.AMOUNT_SHIELDED)).toBe(true);
      });

      test('a token whose outputs are all fully shielded spends a fully shielded UTXO before a smaller amount-shielded one', async () => {
        const send = (changeShieldedMode?: ChangeOutputMode) =>
          new SendTransaction({
            wallet: buildWallet(
              buildPoolStorage([
                poolUtxo('custom-as-30', 30n, CUSTOM_TOKEN, amountShielded('4d')),
                poolUtxo('custom-fs-40', 40n, CUSTOM_TOKEN, fullyShielded('4e', '4f')),
                poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
              ]),
              buildShieldedAddr(0)
            ),
            outputs: [
              customTo(1, 10n, ShieldedOutputMode.FULLY_SHIELDED),
              customTo(2, 10n, ShieldedOutputMode.FULLY_SHIELDED),
            ],
            changeShieldedMode,
          }).prepareTxData();

        // Spending the amount-shielded 30n would reveal the token, which every
        // output of it hides.
        const byRules = await send();
        expect(inputIdsOf(byRules)).toEqual(['custom-fs-40', 'htr-pub-10']);
        expect(modesOf(byRules)).toEqual([
          ShieldedOutputMode.FULLY_SHIELDED,
          ShieldedOutputMode.FULLY_SHIELDED,
          ShieldedOutputMode.FULLY_SHIELDED,
        ]);
        expect(byRules.tokens).toEqual([]);

        // An explicit change mode does not change the order.
        for (const mode of [ShieldedOutputMode.AMOUNT_SHIELDED, OutputKind.TRANSPARENT]) {
          expect(inputIdsOf(await send(mode))).toEqual(['custom-fs-40', 'htr-pub-10']);
        }
      });

      test('a send whose amount-shielded UTXOs leave no input for the HTR fee takes shielded UTXOs by value', async () => {
        const storage = buildPoolStorage([
          ...Array.from({ length: MAX_INPUTS }, (_, i) =>
            poolUtxo(`custom-as-1-${i}`, 1n, CUSTOM_TOKEN, amountShielded('52'))
          ),
          poolUtxo('custom-fs-1000', 1000n, CUSTOM_TOKEN, fullyShielded('53', '54')),
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        ]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [customTo(1, BigInt(MAX_INPUTS), ShieldedOutputMode.AMOUNT_SHIELDED)],
        }).prepareTxData();

        // The 255 amount-shielded 1n pay the output with every input a
        // transaction holds, leaving none for the HTR fee. By value, the fully
        // shielded 1000n pays it alone.
        expect(inputIdsOf(result)).toEqual(['custom-fs-1000', 'htr-pub-10']);
      });

      test("a send whose amount-shielded UTXOs leave too few inputs for another token's takes shielded UTXOs by value", async () => {
        const storage = buildPoolStorage([
          ...Array.from({ length: 200 }, (_, i) =>
            poolUtxo(`custom-as-1-${i}`, 1n, CUSTOM_TOKEN, amountShielded('55'))
          ),
          poolUtxo('custom-fs-1000', 1000n, CUSTOM_TOKEN, fullyShielded('56', '57')),
          ...Array.from({ length: 100 }, (_, i) =>
            poolUtxo(`other-pub-1-${i}`, 1n, OTHER_CUSTOM_TOKEN)
          ),
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        ]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            customTo(1, 200n, ShieldedOutputMode.AMOUNT_SHIELDED),
            {
              type: OutputType.P2PKH,
              address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
              value: 100n,
              token: OTHER_CUSTOM_TOKEN,
            },
          ],
        }).prepareTxData();

        // The 200 amount-shielded 1n pay the first token within the inputs left
        // to it, but leave 55 for the other token's 100 public 1n. By value, the
        // fully shielded 1000n pays the first token alone.
        const inputIds = result.inputs.map(i => i.txId);
        expect(inputIds).toContain('custom-fs-1000');
        expect(inputIds.filter(id => id.startsWith('custom-as-1-'))).toHaveLength(0);
        expect(inputIds.filter(id => id.startsWith('other-pub-1-'))).toHaveLength(100);
        expect(inputIds).toContain('htr-pub-10');
        expect(result.inputs).toHaveLength(102);
      });
    });

    describe('a wallet whose shielded address cannot be read', () => {
      const READ_FAILURE_ERROR = new SendTxError(
        `The wallet's shielded change address could not be resolved: ${SHIELDED_ADDRESS_READ_FAILURE}`
      );
      const sendLoneShielded = (
        storage: Storage,
        token: string,
        shieldedMode: ShieldedOutputMode = ShieldedOutputMode.AMOUNT_SHIELDED,
        inputs: { txId: string; index: number }[] = []
      ) =>
        new SendTransaction({
          storage,
          outputs: [{ address: buildShieldedAddr(1), value: 10n, token, shieldedMode }],
          inputs,
        }).prepareTxData();
      const htrChangeValues = (result: { outputs: unknown[] }) =>
        result.outputs
          .filter(
            o =>
              (o as { isChange?: boolean }).isChange &&
              (o as { token?: string }).token === NATIVE_TOKEN_UID
          )
          .map(o => (o as { value: bigint }).value);

      test('R3a fallback — the failure fails the send, not as a wallet that cannot receive the change', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
          ])
        );

        // The wallet has a shielded address, so failing to read it is reported
        // as the failure it is.
        await expect(r3aSendFromStorageAlone(storage)).rejects.toThrow(READ_FAILURE_ERROR);
      });

      test('R3a fallback — a change pinned transparent sends without reading the address', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
          ])
        );

        const result = await r3aSendFromStorageAlone(storage, OutputKind.TRANSPARENT);

        // A transparent change needs no shielded address: the 34n change stays
        // transparent and the 11n is split.
        expect(storage.getCurrentAddress).not.toHaveBeenCalledWith(false, { legacy: false });
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          5n,
          6n,
        ]);
        const transparentCustom = result.outputs
          .filter(o => (o as { token?: string }).token === CUSTOM_TOKEN)
          .map(o => o.value)
          .sort((a, b) => Number(a - b));
        expect(transparentCustom).toEqual([5n, 34n]);
      });

      test('a 1-unit output fails with the failure, not as a wallet that cannot receive a shielded change', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
          ])
        );

        await expect(
          new SendTransaction({
            storage,
            outputs: [
              {
                address: buildShieldedAddr(1),
                value: 1n,
                token: CUSTOM_TOKEN,
                shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
              },
            ],
          }).prepareTxData()
        ).rejects.toThrow(READ_FAILURE_ERROR);
      });

      test('a failure looking up the shielded keys keeps the failure reading the address', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)])
        );
        jest
          .spyOn(storage, 'getSpendXPubKey')
          .mockRejectedValue(new Error('the access data is unavailable'));

        await expect(allShieldedHtrSend(storage)).rejects.toThrow(READ_FAILURE_ERROR);
      });

      test('a failure counting the shielded addresses keeps the failure reading the address', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)])
        );
        jest
          .spyOn(storage.store, 'addressCount')
          .mockRejectedValue(new Error('the address count is unavailable'));

        await expect(allShieldedHtrSend(storage)).rejects.toThrow(READ_FAILURE_ERROR);
      });

      test('an exact HTR match beside other shielded outputs fails with the failure, as its change stands in for a shielded input', async () => {
        const storage = () =>
          withUnreadableShieldedAddress(
            buildPoolStorage([
              poolUtxo('htr-pub-18', 18n, NATIVE_TOKEN_UID),
              poolUtxo('custom-pub-20', 20n, CUSTOM_TOKEN),
            ])
          );
        const send = (sendStorage: Storage, changeShieldedMode: ChangeOutputMode | null) =>
          new SendTransaction({
            storage: sendStorage,
            outputs: [
              {
                address: buildShieldedAddr(1),
                value: 10n,
                token: NATIVE_TOKEN_UID,
                shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
              },
              {
                type: OutputType.P2PKH,
                address: 'WgKrTAfyjtNK5aQzx9YeQda686y7nm3DLi',
                value: 5n,
                token: NATIVE_TOKEN_UID,
              },
              {
                address: buildShieldedAddr(2),
                value: 10n,
                token: CUSTOM_TOKEN,
                shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
              },
              {
                address: buildShieldedAddr(3),
                value: 10n,
                token: CUSTOM_TOKEN,
                shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
              },
            ],
            changeShieldedMode,
          }).prepareTxData();

        // The lone shielded HTR output beside a transparent one, with no
        // shielded HTR in the wallet, has its change shielded instead. The HTR
        // selection matches exactly, so HTR is pulled for that change, which
        // asks whether the wallet can receive it.
        await expect(send(storage(), null)).rejects.toThrow(READ_FAILURE_ERROR);
        // Pinned transparent, no change stands in and the address is not read.
        // HTR: 18 = 10 + 5 + 3 (fees); custom: 20 = 10 + 10. No change at all.
        const pinnedStorage = storage();
        const result = await send(pinnedStorage, OutputKind.TRANSPARENT);
        expect(pinnedStorage.getCurrentAddress).not.toHaveBeenCalledWith(false, { legacy: false });
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([10n, 10n, 10n]);
        expect(result.outputs.filter(o => (o as { isChange?: boolean }).isChange)).toEqual([]);
        const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
        expect(feeHeader.entries[0].amount).toBe(3n);
      });

      test('a failure reading the wallet type fails the send as a failure to resolve the address', async () => {
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
        ]);
        // The custom change's output type is read first; resolving the shielded
        // change address reads the wallet type again, and that read fails.
        jest
          .spyOn(storage, 'getWalletType')
          .mockResolvedValueOnce(WalletType.P2PKH)
          .mockRejectedValue(new Error('the access data is unavailable'));

        const send = r3aSendFromStorageAlone(storage);
        await expect(send).rejects.toThrow(
          new SendTxError(
            "The wallet's shielded change address could not be resolved: the access data is " +
              'unavailable'
          )
        );
        await expect(send).rejects.toBeInstanceOf(SendTxError);
      });

      // In the sends below nothing depends on whether a shielded change can be
      // hosted, so the address is not read to find out.

      test('a lone output whose HTR change is larger than the split fee pays it from that change', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
          ])
        );

        const result = await sendLoneShielded(storage, CUSTOM_TOKEN);

        // The custom input matches exactly, so there is no custom change. The 9n
        // HTR change pays the 1n split fee and keeps 8n. HTR: 10 = 8 + 2 (fees).
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
        expect(result.shieldedOutputs!.every(o => o.address === recipientSpend())).toBe(true);
        expect(htrChangeValues(result)).toEqual([8n]);
        const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
        expect(feeHeader.entries[0].amount).toBe(2n);
      });

      test('a lone FEE-token output pays the split fee from the HTR change', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('fee-pub-10', 10n, FEE_TOKEN),
            poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
          ])
        );

        const result = await sendLoneShielded(storage, FEE_TOKEN);

        // The melt fee, the output's fee and the split's fee, 1n each.
        // HTR: 10 = 7 + 3 (fees).
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
        expect(htrChangeValues(result)).toEqual([7n]);
        const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
        expect(feeHeader.entries[0].amount).toBe(3n);
      });

      test('a lone output pays the split fee from the change of caller-supplied HTR', async () => {
        const callerCustom = poolUtxo('caller-custom-10', 10n, CUSTOM_TOKEN);
        const callerHtr = poolUtxo('caller-htr-10', 10n, NATIVE_TOKEN_UID);
        const storage = withUnreadableShieldedAddress(buildPoolStorage([callerCustom, callerHtr]));
        supplyCallerInputs(storage, [callerCustom, callerHtr]);

        const result = await sendLoneShielded(
          storage,
          CUSTOM_TOKEN,
          ShieldedOutputMode.AMOUNT_SHIELDED,
          [
            { txId: 'caller-custom-10', index: 0 },
            { txId: 'caller-htr-10', index: 0 },
          ]
        );

        // The caller's custom input matches exactly, and its HTR leaves a 9n
        // change that pays the 1n split fee. HTR: 10 = 8 + 2 (fees).
        expect(result.inputs.map(i => i.txId).sort()).toEqual([
          'caller-custom-10',
          'caller-htr-10',
        ]);
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
        expect(htrChangeValues(result)).toEqual([8n]);
      });

      test('a lone output spends an HTR change equal to the split fee on it', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
          ])
        );

        const result = await sendLoneShielded(storage, CUSTOM_TOKEN);

        // HTR: 2 = 1 (the output's fee) + 1 (the split's fee); no change is left.
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
        expect(htrChangeValues(result)).toEqual([]);
        const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
        expect(feeHeader.entries[0].amount).toBe(2n);
      });

      test('with the change pinned transparent, a split-fee pull from shielded HTR leaves its surplus transparent', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
            poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
              shielded: true,
              blindingFactor: '8e'.repeat(32),
            }),
          ])
        );

        const result = await new SendTransaction({
          storage,
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 10n,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
          ],
          changeShieldedMode: OutputKind.TRANSPARENT,
        }).prepareTxData();

        // The 1n pays the output's fee exactly, and only the shielded 5n is left
        // for the split's 1n fee: the pinned change keeps 4n transparent.
        // HTR: 1 + 5 = 4 + 2 (fees).
        expect(result.inputs.map(i => i.txId).sort()).toEqual([
          'custom-pub-10',
          'htr-pub-1',
          'htr-sh-5',
        ]);
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
        expect(htrChangeValues(result)).toEqual([4n]);
        const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
        expect(feeHeader.entries[0].amount).toBe(2n);
      });

      test('a lone output whose split fee no HTR left can cover fails for want of HTR', async () => {
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
            poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
              shielded: true,
              blindingFactor: '8c'.repeat(32),
            }),
          ])
        );

        // The 2n pays the output's fee exactly, and the shielded 1n is all that
        // is left for the split's 2n fee.
        await expect(
          sendLoneShielded(storage, CUSTOM_TOKEN, ShieldedOutputMode.FULLY_SHIELDED)
        ).rejects.toThrow(
          new SendTxError(
            'Splitting the lone shielded output requires extra HTR for its fee, and no ' +
              'additional HTR is available.'
          )
        );
      });

      test('a lone shielded HTR change is split without reading the address again', async () => {
        // The first shielded read, which places the change, succeeds.
        const storage = withUnreadableShieldedAddress(
          buildPoolStorage([
            poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
            poolUtxo('htr-sh-10', 10n, NATIVE_TOKEN_UID, {
              shielded: true,
              blindingFactor: '8d'.repeat(32),
            }),
          ]),
          1
        );

        const result = await new SendTransaction({
          storage,
          outputs: [
            { address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo', value: 8n, token: NATIVE_TOKEN_UID },
          ],
        }).prepareTxData();

        // The 5n change mirrors the shielded 10n: 5 − 1 (its fee) = 4n, which
        // pays the 1n split fee and is split into 1n + 2n. HTR: 13 = 8 + 1 + 2 + 2.
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          1n,
          2n,
        ]);
        expect(result.shieldedOutputs!.every(o => o.address === walletSpend())).toBe(true);
        const feeHeader = result.headers!.find(h => h instanceof FeeHeader) as FeeHeader;
        expect(feeHeader.entries[0].amount).toBe(2n);
      });
    });

    // A mixed HTR send with one shielded HTR output, from a wallet with no
    // shielded HTR, beside shielded outputs of the custom token: the HTR change
    // stands in for the missing shielded input. Unless a test says otherwise,
    // the custom 20n pays the custom outputs exactly, and the HTR 18n pays
    // 10 + 5 + 3 (the shielded outputs' fees) exactly, so the HTR selection
    // leaves no change.
    describe('a change forced on an exact match', () => {
      // The wallet holds a shielded 30 and one shielded dust UTXO, and the send
      // pays exactly 30 to a transparent address. Spent alone, the 30 would
      // publish its value, so the rules add the dust for a change to hide it.
      const shieldedPool = (token: string, dust: bigint, fullyShielded = false) =>
        (
          [
            ['sh-30', 30n],
            ['sh-dust', dust],
          ] as const
        ).map(([id, value]) =>
          poolUtxo(id, value, token, {
            shielded: true,
            blindingFactor: 'd1'.repeat(32),
            ...(fullyShielded ? { assetBlindingFactor: 'a1'.repeat(32) } : {}),
          })
        );
      const send = (pool: PoolUtxo[], token: string, options = {}) =>
        new SendTransaction({
          wallet: buildWallet(buildPoolStorage(pool), buildShieldedAddr(0)),
          outputs: [
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 30n,
              token,
            },
          ],
          ...options,
        }).prepareTxData();
      const forcedChangeMessage = (whyNot: string) =>
        'The change must be shielded (so the value of the shielded UTXO spent exactly cannot ' +
        `be computed by subtraction), but ${whyNot}${KEEP_TRANSPARENT_HINT}`;
      const CANNOT_PAY_ITS_FEE =
        'it is too small to fund its shielded-output fee and no additional HTR is available ' +
        'to cover the difference';
      const CANNOT_BE_SPLIT =
        'it is too small to split into the two shielded outputs the protocol requires, and no ' +
        'additional HTR is available';
      // As the error suggests: pinned transparent, nothing is forced, and the
      // 30 is spent exactly, publishing its value.
      const expectSentPinnedTransparent = async (pool: PoolUtxo[], token: string) => {
        const pinned = await send(pool, token, { changeShieldedMode: OutputKind.TRANSPARENT });
        expect(pinned.inputs.map(i => i.txId)).toEqual(['sh-30']);
        expect(pinned.shieldedOutputs ?? []).toEqual([]);
        expect(pinned.outputs.filter(o => (o as { isChange?: boolean }).isChange)).toEqual([]);
      };

      test('a forced HTR change too small for its own fee fails the send, saying why', async () => {
        const pool = shieldedPool(NATIVE_TOKEN_UID, 1n);
        await expect(send(pool, NATIVE_TOKEN_UID)).rejects.toThrow(
          new SendTxError(forcedChangeMessage(CANNOT_PAY_ITS_FEE))
        );
        await expectSentPinnedTransparent(pool, NATIVE_TOKEN_UID);
      });

      test('a forced fully shielded HTR change too small for its own fee fails the send, saying why', async () => {
        // A fully shielded change pays 2n, so a dust of 2n cannot.
        const pool = shieldedPool(NATIVE_TOKEN_UID, 2n, true);
        await expect(send(pool, NATIVE_TOKEN_UID)).rejects.toThrow(
          new SendTxError(forcedChangeMessage(CANNOT_PAY_ITS_FEE))
        );
        await expectSentPinnedTransparent(pool, NATIVE_TOKEN_UID);
      });

      test.each([2n, 3n])(
        'a forced HTR change of %p too small to split fails the send, saying why',
        async dust => {
          // The change pays its own 1n fee, but it is then the only shielded
          // output, and what is left cannot be split in two.
          const pool = shieldedPool(NATIVE_TOKEN_UID, dust);
          await expect(send(pool, NATIVE_TOKEN_UID)).rejects.toThrow(
            new SendTxError(forcedChangeMessage(CANNOT_BE_SPLIT))
          );
          await expectSentPinnedTransparent(pool, NATIVE_TOKEN_UID);
        }
      );

      test('a forced HTR change that pays its fee and the split still hides the value', async () => {
        // 4n: its own 1n fee leaves 3n, the split's 1n fee leaves two 1n halves.
        const result = await send(shieldedPool(NATIVE_TOKEN_UID, 4n), NATIVE_TOKEN_UID);
        expect(result.inputs.map(i => i.txId).sort()).toEqual(['sh-30', 'sh-dust']);
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([1n, 1n]);
      });

      test('a forced custom-token change whose fee the wallet cannot pay fails the send, saying so', async () => {
        // The wallet holds no HTR to pay the shielded change's fee.
        const pool = shieldedPool(CUSTOM_TOKEN, 1n);
        await expect(send(pool, CUSTOM_TOKEN)).rejects.toThrow(
          `The amount includes the fee to shield the change${KEEP_TRANSPARENT_HINT}`
        );
        await expectSentPinnedTransparent(pool, CUSTOM_TOKEN);
      });

      test('with an explicit shielded change mode, the error keeps its plain wording', async () => {
        await expect(
          send(shieldedPool(NATIVE_TOKEN_UID, 1n), NATIVE_TOKEN_UID, {
            changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          })
        ).rejects.toThrow(
          new SendTxError(
            'HTR change is too small to fund its shielded-output fee and no additional HTR is ' +
              'available to cover the difference.'
          )
        );
      });
    });

    describe('an HTR change standing in beside other shielded outputs', () => {
      const exactPool = () => [
        poolUtxo('htr-pub-18', 18n, NATIVE_TOKEN_UID),
        poolUtxo('custom-pub-20', 20n, CUSTOM_TOKEN),
      ];
      const sendBesideOthers = (
        source: { wallet: ReturnType<typeof buildWallet> } | { storage: Storage },
        {
          htrMode = ShieldedOutputMode.AMOUNT_SHIELDED,
          customValues = [10n, 10n],
          ...options
        }: {
          htrMode?: ShieldedOutputMode;
          customValues?: bigint[];
          changeShieldedMode?: ChangeOutputMode | null;
          changeAddress?: string;
          inputs?: { txId: string; index: number }[];
        } = {}
      ) => {
        const customAddresses = [buildShieldedAddr(2), buildShieldedAddr(3)];
        return new SendTransaction({
          ...source,
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 10n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: htrMode,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 5n,
              token: NATIVE_TOKEN_UID,
            },
            ...customValues.map((value, i) => ({
              address: customAddresses[i % 2],
              value,
              token: CUSTOM_TOKEN,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            })),
          ],
          ...options,
        }).prepareTxData();
      };
      const fromWallet = (pool: PoolUtxo[]) => ({
        wallet: buildWallet(buildPoolStorage(pool), buildShieldedAddr(0)),
      });
      const feeOf = (result: IDataTx) =>
        (result.headers!.find(h => h instanceof FeeHeader) as FeeHeader).entries[0].amount;
      const changesOf = (result: IDataTx) =>
        result.outputs.filter(o => (o as { isChange?: boolean }).isChange);
      const htrShieldedOutputsOf = (result: IDataTx) =>
        result
          .shieldedOutputs!.filter(o => o.token === NATIVE_TOKEN_UID)
          .sort((a, b) => Number(a.value - b.value));

      test('HTR is pulled, smallest-first, for a change that pays its own shielded-output fee', async () => {
        const pool = [
          poolUtxo('htr-pub-19', 19n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID),
          poolUtxo('custom-sh-25', 25n, CUSTOM_TOKEN, {
            shielded: true,
            blindingFactor: 'd1'.repeat(32),
          }),
        ];

        const result = await sendBesideOthers(fromWallet(pool));

        // The shielded custom 25n leaves a 5n change, shielded. The HTR 19n pays
        // 10 + 5 + 4 (fees) exactly, so the 7n is pulled for a change, which
        // pays its own 1n fee: 7 − 1 = 6n. HTR: 26 = 10 + 5 + 6 + 5 (fees).
        expect(result.inputs.map(i => i.txId).sort()).toEqual([
          'custom-sh-25',
          'htr-pub-19',
          'htr-pub-7',
        ]);
        expect(changesOf(result)).toEqual([]);
        const [htrChange, htrRecipient] = htrShieldedOutputsOf(result);
        expect(htrChange).toMatchObject({
          value: 6n,
          address: walletSpend(),
          shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
        });
        expect(htrRecipient).toMatchObject({ value: 10n, address: recipientSpend() });
        expect(
          result
            .shieldedOutputs!.filter(o => o.token === CUSTOM_TOKEN)
            .map(o => o.value)
            .sort((a, b) => Number(a - b))
        ).toEqual([5n, 10n, 10n]);
        expect(feeOf(result)).toBe(4n + FEE_PER_AMOUNT_SHIELDED_OUTPUT);
        // Pinned transparent, both changes stay transparent and no HTR is
        // pulled. HTR: 19 = 10 + 5 + 1 + 3 (fees).
        const pinned = await sendBesideOthers(fromWallet(pool), {
          changeShieldedMode: OutputKind.TRANSPARENT,
        });
        expect(pinned.inputs.map(i => i.txId).sort()).toEqual(['custom-sh-25', 'htr-pub-19']);
        expect(changesOf(pinned).map(o => [(o as { token?: string }).token, o.value])).toEqual(
          expect.arrayContaining([
            [NATIVE_TOKEN_UID, 1n],
            [CUSTOM_TOKEN, 5n],
          ])
        );
        expect(changesOf(pinned)).toHaveLength(2);
        expect(htrShieldedOutputsOf(pinned).map(o => o.value)).toEqual([10n]);
        expect(feeOf(pinned)).toBe(3n);
      });

      test('a fully shielded HTR output takes a fully shielded change that pays its own fee', async () => {
        const pool = [
          poolUtxo('htr-pub-19', 19n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-2', 2n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
          poolUtxo('custom-pub-20', 20n, CUSTOM_TOKEN),
        ];

        const result = await sendBesideOthers(fromWallet(pool), {
          htrMode: ShieldedOutputMode.FULLY_SHIELDED,
        });

        // 19 = 10 + 5 + 4 (fees) exactly. The 2n alone cannot pay the change's
        // own 2n fee, so the 5n is pulled too: 2 + 5 − 2 = 5n.
        // HTR: 26 = 10 + 5 + 5 + 6 (fees).
        expect(result.inputs.map(i => i.txId).sort()).toEqual([
          'custom-pub-20',
          'htr-pub-19',
          'htr-pub-2',
          'htr-pub-5',
        ]);
        expect(changesOf(result)).toEqual([]);
        expect(htrShieldedOutputsOf(result).map(o => [o.value, o.address, o.shieldedMode])).toEqual(
          [
            [5n, walletSpend(), ShieldedOutputMode.FULLY_SHIELDED],
            [10n, recipientSpend(), ShieldedOutputMode.FULLY_SHIELDED],
          ]
        );
        expect(feeOf(result)).toBe(4n + FEE_PER_FULL_SHIELDED_OUTPUT);
      });

      test('with no HTR left to make the change from, the send fails', async () => {
        await expect(sendBesideOthers(fromWallet(exactPool()))).rejects.toThrow(
          new SendTxError(standInChangeMessage(NO_HTR_CHANGE))
        );
        // As suggested: pinned transparent, the send builds with no change.
        const result = await sendBesideOthers(fromWallet(exactPool()), {
          changeShieldedMode: OutputKind.TRANSPARENT,
        });
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([10n, 10n, 10n]);
        expect(changesOf(result)).toEqual([]);
        expect(feeOf(result)).toBe(3n);
      });

      // A shielded 15n of `token` pays a transparent 10n, so its 5n change is
      // the only other shielded output.
      const sendBesideAChange = (
        token: string,
        htr: bigint,
        htrMode: ShieldedOutputMode,
        changeShieldedMode: ChangeOutputMode | null = null
      ) =>
        new SendTransaction({
          ...fromWallet([
            poolUtxo('htr-pub', htr, NATIVE_TOKEN_UID),
            poolUtxo('token-sh-15', 15n, token, {
              shielded: true,
              blindingFactor: 'd1'.repeat(32),
            }),
          ]),
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 10n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: htrMode,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 5n,
              token: NATIVE_TOKEN_UID,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 10n,
              token,
            },
          ],
          changeShieldedMode,
        }).prepareTxData();

      test('with no HTR left, the error does not suggest a transparent change that cannot pay for the split either', async () => {
        // HTR: 18 = 10 + 5 + 3 (fees) exactly.
        await expect(
          sendBesideAChange(CUSTOM_TOKEN, 18n, ShieldedOutputMode.FULLY_SHIELDED)
        ).rejects.toThrow(new SendTxError(standInChangeMessage(NO_HTR_CHANGE, '.')));
        // Pinned transparent, the custom change no longer pays its 1n fee, but
        // splitting the fully shielded output costs 2n.
        await expect(
          sendBesideAChange(
            CUSTOM_TOKEN,
            18n,
            ShieldedOutputMode.FULLY_SHIELDED,
            OutputKind.TRANSPARENT
          )
        ).rejects.toThrow('cannot fund the shielded-output split');
      });

      test('with no HTR left, the error suggests a transparent change when the fee it frees pays for the split', async () => {
        // HTR: 17 = 10 + 5 + 2 (fees) exactly.
        await expect(
          sendBesideAChange(CUSTOM_TOKEN, 17n, ShieldedOutputMode.AMOUNT_SHIELDED)
        ).rejects.toThrow(new SendTxError(standInChangeMessage(NO_HTR_CHANGE)));
        // As suggested: pinned transparent, the custom change's freed 1n fee
        // pays for splitting the amount-shielded output.
        const pinned = await sendBesideAChange(
          CUSTOM_TOKEN,
          17n,
          ShieldedOutputMode.AMOUNT_SHIELDED,
          OutputKind.TRANSPARENT
        );
        expect(htrShieldedOutputsOf(pinned).map(o => o.value)).toEqual([5n, 5n]);
        expect(feeOf(pinned)).toBe(2n);
      });

      test("with no HTR left, the error does not suggest a transparent change whose FEE token's change owes a fee instead", async () => {
        // The FEE token's transparent output owes 1n. HTR: 18 = 10 + 5 + 3
        // (fees) exactly.
        await expect(
          sendBesideAChange(FEE_TOKEN, 18n, ShieldedOutputMode.AMOUNT_SHIELDED)
        ).rejects.toThrow(new SendTxError(standInChangeMessage(NO_HTR_CHANGE, '.')));
        // Pinned transparent, the FEE token's change owes 1n as a transparent
        // output in place of its 1n shielded-output fee, so nothing pays the 1n
        // of splitting the amount-shielded output.
        await expect(
          sendBesideAChange(
            FEE_TOKEN,
            18n,
            ShieldedOutputMode.AMOUNT_SHIELDED,
            OutputKind.TRANSPARENT
          )
        ).rejects.toThrow('Splitting the lone shielded output requires extra HTR for its fee');
      });

      test('with caller-supplied HTR, the send fails rather than add HTR to it', async () => {
        const callerHtr = poolUtxo('caller-htr-18', 18n, NATIVE_TOKEN_UID);
        const source = () => {
          const storage = buildPoolStorage([
            callerHtr,
            poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID),
            poolUtxo('custom-pub-20', 20n, CUSTOM_TOKEN),
          ]);
          supplyCallerInputs(storage, [callerHtr]);
          return { wallet: buildWallet(storage, buildShieldedAddr(0)) };
        };
        const inputs = [{ txId: 'caller-htr-18', index: 0 }];

        // The caller's 18n pays 10 + 5 + 3 (fees) exactly, and the wallet's 7n
        // is not added to a caller's inputs.
        await expect(sendBesideOthers(source(), { inputs })).rejects.toThrow(
          new SendTxError(standInChangeMessage(NO_HTR_CHANGE_OF_CALLER_HTR))
        );
        // As suggested: pinned transparent, the send builds with no change.
        const result = await sendBesideOthers(source(), {
          inputs,
          changeShieldedMode: OutputKind.TRANSPARENT,
        });
        expect(result.inputs.map(i => i.txId).sort()).toEqual(['caller-htr-18', 'custom-pub-20']);
        expect(changesOf(result)).toEqual([]);
        expect(feeOf(result)).toBe(3n);
      });

      test('a multisig wallet is refused before any HTR is pulled', async () => {
        const multisig = () => {
          const storage = withShieldedAddress(
            buildPoolStorage([...exactPool(), poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID)]),
            buildShieldedAddr(0)
          );
          jest.spyOn(storage, 'getWalletType').mockResolvedValue(WalletType.MULTISIG);
          return { storage };
        };

        const refused = sendBesideOthers(multisig());
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_FOR_A_MULTISIG_WALLET)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the send builds with no change.
        const result = await sendBesideOthers(multisig(), {
          changeShieldedMode: OutputKind.TRANSPARENT,
        });
        expect(result.inputs.map(i => i.txId).sort()).toEqual(['custom-pub-20', 'htr-pub-18']);
        expect(changesOf(result)).toEqual([]);
      });

      test('a wallet with no shielded address is refused before any HTR is pulled', async () => {
        // Built from storage alone, the wallet has no shielded address.
        const fromStorageAlone = () => ({
          storage: buildPoolStorage([...exactPool(), poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID)]),
        });

        const refused = sendBesideOthers(fromStorageAlone());
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_WITHOUT_A_SHIELDED_ADDRESS)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the send builds with no change.
        const result = await sendBesideOthers(fromStorageAlone(), {
          changeShieldedMode: OutputKind.TRANSPARENT,
        });
        expect(result.inputs.map(i => i.txId).sort()).toEqual(['custom-pub-20', 'htr-pub-18']);
        expect(changesOf(result)).toEqual([]);
      });

      test('at the shielded-output limit, the send is refused', async () => {
        // 32 shielded outputs: the HTR 10n and 31 custom 1n, which the custom
        // 31n pays exactly. The HTR 47n pays 10 + 5 + 32 (fees) exactly.
        const pool = [
          poolUtxo('htr-pub-47', 47n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID),
          poolUtxo('custom-pub-31', 31n, CUSTOM_TOKEN),
        ];
        const customValues = Array.from({ length: MAX_SHIELDED_OUTPUTS - 1 }, () => 1n);

        await expect(sendBesideOthers(fromWallet(pool), { customValues })).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_AT_THE_LIMIT)
        );
        // As suggested: pinned transparent, the send builds with no change.
        const result = await sendBesideOthers(fromWallet(pool), {
          customValues,
          changeShieldedMode: OutputKind.TRANSPARENT,
        });
        expect(result.shieldedOutputs).toHaveLength(MAX_SHIELDED_OUTPUTS);
        expect(changesOf(result)).toEqual([]);
        expect(feeOf(result)).toBe(32n);
      });

      test('a legacy changeAddress fails the send once HTR is pulled for the change', async () => {
        const toLegacyChange = (pool: PoolUtxo[], changeShieldedMode: ChangeOutputMode | null) => {
          const storage = buildPoolStorage(pool);
          ownLegacyChangeAddress(storage);
          return sendBesideOthers(
            { wallet: buildWallet(storage, buildShieldedAddr(0)) },
            { changeAddress: LEGACY_CHANGE_ADDRESS, changeShieldedMode }
          );
        };
        const withSpareHtr = [...exactPool(), poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID)];

        // With no HTR to make the change from, that fails the send first.
        await expect(toLegacyChange(exactPool(), null)).rejects.toThrow(
          new SendTxError(standInChangeMessage(NO_HTR_CHANGE))
        );
        // With the 7n pulled for it, the change cannot go to the legacy address.
        await expect(toLegacyChange(withSpareHtr, null)).rejects.toThrow(
          new SendTxError(LEGACY_CHANGE_ADDRESS_FOR_STAND_IN_CHANGE)
        );
        // As suggested: pinned transparent, the send builds with no change.
        const result = await toLegacyChange(withSpareHtr, OutputKind.TRANSPARENT);
        expect(result.inputs.map(i => i.txId).sort()).toEqual(['custom-pub-20', 'htr-pub-18']);
        expect(changesOf(result)).toEqual([]);
      });
    });

    // Each test pins a value prepareTxData hands ensureShieldedOutputMinimum,
    // through what the pass does with it in a send.
    describe('the structural pass within a send', () => {
      const loneCustomOutput = (shieldedMode: ShieldedOutputMode, value = 10n) => ({
        address: buildShieldedAddr(1),
        value,
        token: CUSTOM_TOKEN,
        shieldedMode,
      });

      test("the caller's changeAddress receives the transparent HTR change the pass creates", async () => {
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
        ]);
        ownLegacyChangeAddress(storage);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [loneCustomOutput(ShieldedOutputMode.AMOUNT_SHIELDED)],
          changeAddress: LEGACY_CHANGE_ADDRESS,
        }).prepareTxData();

        // The 1n pays the output's fee exactly; the pass pulls the 5n for the
        // split's 1n fee and keeps the other 4n as a transparent change.
        const changes = result.outputs.filter(o => (o as { isChange?: boolean }).isChange);
        expect(changes.map(o => o.value)).toEqual([4n]);
        expect((changes[0] as { address?: string }).address).toBe(LEGACY_CHANGE_ADDRESS);
      });

      test.each([
        [
          'the surplus of a split-fee pull',
          [
            poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
            poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
          ],
          [loneCustomOutput(ShieldedOutputMode.AMOUNT_SHIELDED)],
        ],
        [
          'a change standing in for a missing shielded input',
          [
            poolUtxo('htr-pub-17', 17n, NATIVE_TOKEN_UID),
            poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
            poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
          ],
          [
            {
              address: buildShieldedAddr(1),
              value: 11n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 5n,
              token: NATIVE_TOKEN_UID,
            },
          ],
        ],
      ])(
        'a changeAddress the wallet does not own fails the send when the pass makes %s',
        async (_, pool, outputs) => {
          // No output of the selection is a change, so the address is first
          // resolved for the change the pass makes from pulled HTR.
          const refused = new SendTransaction({
            wallet: buildWallet(buildPoolStorage(pool), buildShieldedAddr(0)),
            outputs,
            changeAddress: LEGACY_CHANGE_ADDRESS,
          }).prepareTxData();

          await expect(refused).rejects.toThrow(
            new SendTxError('Change address is not from the wallet')
          );
          await expect(refused).rejects.toBeInstanceOf(SendTxError);
        }
      );

      test("the caller's new-format changeAddress receives the shielded HTR change the pass adds", async () => {
        const newFormatChange = buildShieldedAddr(7);
        const storage = buildPoolStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        ]);
        ownAddresses(storage, [newFormatChange]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [loneCustomOutput(ShieldedOutputMode.AMOUNT_SHIELDED, 1n)],
          changeAddress: newFormatChange,
        }).prepareTxData();

        // The 1-unit output cannot be split, so the 9n HTR change is shielded
        // beside it at the caller's address: 9 − 1 (its fee) = 8n.
        const htrChange = result.shieldedOutputs!.find(o => o.token === NATIVE_TOKEN_UID);
        expect(htrChange!.value).toBe(8n);
        expect(htrChange!.address).toBe(spendOf(newFormatChange));
      });

      test('a wallet with no shielded address is told how to keep the change the pass shields transparent', async () => {
        // Built from storage alone, the wallet has no shielded address.
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'c1'.repeat(32),
          }),
        ]);

        // The 1n pays the output's fee exactly and the split's fee comes from
        // the shielded 5n, whose 4n surplus must be a shielded change.
        await expect(
          new SendTransaction({
            storage,
            outputs: [loneCustomOutput(ShieldedOutputMode.AMOUNT_SHIELDED)],
          }).prepareTxData()
        ).rejects.toThrow(
          new SendTxError(
            'A shielded change is required, but the wallet has no shielded address to receive ' +
              'it; pass changeShieldedMode: OutputKind.TRANSPARENT to keep the change transparent.'
          )
        );
      });

      test("a custom token's split fee is pulled from the transparent pool first", async () => {
        const storage = buildPoolStorage([
          poolUtxo('custom-pub-10', 10n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-1', 1n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-1', 1n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'c2'.repeat(32),
          }),
        ]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [loneCustomOutput(ShieldedOutputMode.FULLY_SHIELDED)],
        }).prepareTxData();

        // The 3n pays the output's 2n fee and leaves 1n, 1n short of the
        // split's 2n fee: the transparent 1n pays it, not the shielded one.
        expect(result.inputs.map(i => i.txId).sort()).toEqual([
          'custom-pub-10',
          'htr-pub-1',
          'htr-pub-3',
        ]);
        expect(result.shieldedOutputs!.map(o => o.value)).toEqual([5n, 5n]);
      });

      test('the split fee of an HTR send with only shielded outputs is pulled from the shielded pool first', async () => {
        const storage = buildPoolStorage([
          poolUtxo('htr-sh-11', 11n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'c3'.repeat(32),
          }),
          poolUtxo('htr-pub-5', 5n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-5', 5n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: 'c4'.repeat(32),
          }),
        ]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 10n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
          ],
        }).prepareTxData();

        // The shielded 11n pays the output and its 1n fee exactly. The split's
        // fee comes from the shielded 5n, not the transparent one, and the 4n
        // left is the second shielded output.
        expect(result.inputs.map(i => i.txId).sort()).toEqual(['htr-sh-11', 'htr-sh-5']);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          4n,
          10n,
        ]);
      });

      test('the pass and the HTR change decision read the shielded change address once', async () => {
        const storage = buildPoolStorage([
          poolUtxo('htr-pub-7', 7n, NATIVE_TOKEN_UID),
          poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID),
        ]);

        const result = await new SendTransaction({
          wallet: buildWallet(storage, buildShieldedAddr(0)),
          outputs: [
            {
              address: buildShieldedAddr(1),
              value: 1n,
              token: NATIVE_TOKEN_UID,
              shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
            },
            {
              type: OutputType.P2PKH,
              address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
              value: 5n,
              token: NATIVE_TOKEN_UID,
            },
          ],
        }).prepareTxData();

        // The 7n pays 1 + 5 + 1 (the fee) exactly. Both the HTR change decision
        // and the pass, for the 1-unit output, ask whether the wallet can
        // receive a shielded change; the pass then pulls the 20n for that
        // change. One read answers both, and one more places the change.
        expect(result.inputs.map(i => i.txId)).toEqual(['htr-pub-7', 'htr-pub-20']);
        expect(result.shieldedOutputs).toHaveLength(2);
        const shieldedReads = (storage.getCurrentAddress as jest.Mock).mock.calls.filter(
          call => (call[1] as { legacy?: boolean } | undefined)?.legacy === false
        );
        expect(shieldedReads).toHaveLength(2);
      });
    });

    describe('multisig wallets', () => {
      // A multisig wallet built from a seed also derives a shielded chain, but
      // its spend key belongs to this participant alone. Built from storage
      // alone, as multisig tx proposals are.
      const multisigStorage = (pool: ReturnType<typeof poolUtxo>[]) => {
        const storage = withShieldedAddress(buildPoolStorage(pool), buildShieldedAddr(0));
        jest.spyOn(storage, 'getWalletType').mockResolvedValue(WalletType.MULTISIG);
        return storage;
      };
      const htrPayment = {
        address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
        value: 8n,
        token: NATIVE_TOKEN_UID,
      };

      test('a plain transparent send keeps its transparent change', async () => {
        const storage = multisigStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)]);

        const result = await new SendTransaction({
          storage,
          outputs: [htrPayment],
        }).prepareTxData();

        const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
        expect(change!.value).toBe(12n);
        expect(result.shieldedOutputs ?? []).toHaveLength(0);
      });

      test('a change standing in for a missing shielded input is refused', async () => {
        const multisigWallet = () =>
          multisigStorage([
            poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
          ]);

        // A transparent 34n change would publish the 11n by subtraction, and the
        // wallet cannot receive it shielded.
        const refused = r3aSendFromStorageAlone(multisigWallet());
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_FOR_A_MULTISIG_WALLET)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the 34n change stays transparent and
        // the 11n is split at the recipient.
        const result = await r3aSendFromStorageAlone(multisigWallet(), OutputKind.TRANSPARENT);
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

      test('an HTR change standing in for a missing shielded input is refused', async () => {
        const multisigWallet = () =>
          multisigStorage([poolUtxo('htr-pub-30', 30n, NATIVE_TOKEN_UID)]);

        // 30 − 16 − 1 (the recipient's fee) = 13n of change, which the wallet
        // cannot receive shielded.
        const refused = r3aHtrSendFromStorageAlone(multisigWallet());
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_FOR_A_MULTISIG_WALLET)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the change pays the split's fee and
        // keeps 12n. HTR: 30 = 5 + 6 + 5 + 12 + 2 (fees).
        const result = await r3aHtrSendFromStorageAlone(multisigWallet(), OutputKind.TRANSPARENT);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          5n,
          6n,
        ]);
        const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
        expect(change!.value).toBe(12n);
      });

      test('an HTR change standing in for a missing shielded input is refused for the wallet before its fee', async () => {
        const multisigWallet = () =>
          multisigStorage([poolUtxo('htr-pub-18', 18n, NATIVE_TOKEN_UID)]);

        // 18 − 16 − 1 (the recipient's fee) = 1n of change, too small for its
        // own fee, but more HTR would not let the wallet receive it shielded.
        const refused = r3aHtrSendFromStorageAlone(multisigWallet());
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_FOR_A_MULTISIG_WALLET)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the change pays the split's fee.
        // HTR: 18 = 5 + 6 + 5 + 2 (fees).
        const result = await r3aHtrSendFromStorageAlone(multisigWallet(), OutputKind.TRANSPARENT);
        expect(result.outputs.find(o => (o as { isChange?: boolean }).isChange)).toBeUndefined();
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          5n,
          6n,
        ]);
      });

      test('a 1-unit HTR output whose change stands in for a missing shielded input is refused without suggesting a transparent change', async () => {
        const multisigWallet = () =>
          multisigStorage([poolUtxo('htr-pub-30', 30n, NATIVE_TOKEN_UID)]);

        const refused = r3aHtrSendFromStorageAlone(multisigWallet(), null, 1n);
        await expect(refused).rejects.toThrow(
          new SendTxError(
            standInChangeMessage('a shielded change is not supported for multisig wallets', '.')
          )
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // Pinned transparent, the 1-unit output cannot be split, and still needs
        // a shielded change as its second output.
        await expect(
          r3aHtrSendFromStorageAlone(multisigWallet(), OutputKind.TRANSPARENT, 1n)
        ).rejects.toThrow(
          new SendTxError(
            unsplittableOutput(
              'changeShieldedMode: OutputKind.TRANSPARENT keeps the change from being shielded ' +
                'as the second one'
            )
          )
        );
      });

      test('at the shielded-output limit, a change standing in for a missing shielded input is refused for the wallet, not the limit', async () => {
        const send = (changeShieldedMode: ChangeOutputMode | null) => {
          const htrOutputs = Array.from({ length: MAX_SHIELDED_OUTPUTS - 1 }, (_, i) => ({
            address: buildShieldedAddr(2 + (i % 2)),
            value: 1n,
            token: NATIVE_TOKEN_UID,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          }));
          return new SendTransaction({
            storage: multisigStorage([
              poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
              poolUtxo('htr-pub-63', 63n, NATIVE_TOKEN_UID),
            ]),
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
              ...htrOutputs,
            ],
            changeShieldedMode,
          }).prepareTxData();
        };

        // 32 shielded outputs already, and the 34n change could not be shielded
        // in a multisig wallet even with room for it.
        const refused = send(null);
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_FOR_A_MULTISIG_WALLET)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the 34n change stays transparent.
        // HTR: 63 = 31 + 32 (fees).
        const result = await send(OutputKind.TRANSPARENT);
        expect(result.shieldedOutputs).toHaveLength(MAX_SHIELDED_OUTPUTS);
        const transparentCustom = result.outputs
          .filter(o => (o as { token?: string }).token === CUSTOM_TOKEN)
          .map(o => o.value)
          .sort((a, b) => Number(a - b));
        expect(transparentCustom).toEqual([5n, 34n]);
      });

      test('with its legacy change address, a change standing in for a missing shielded input is refused for the wallet, not the address', async () => {
        const send = (changeShieldedMode: ChangeOutputMode | null) => {
          const storage = multisigStorage([
            poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
          ]);
          ownLegacyChangeAddress(storage);
          return new SendTransaction({
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
                address: 'WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo',
                value: 5n,
                token: CUSTOM_TOKEN,
              },
            ],
            changeAddress: LEGACY_CHANGE_ADDRESS,
            changeShieldedMode,
          }).prepareTxData();
        };

        // A new-format change address is no way out for a multisig wallet.
        const refused = send(null);
        await expect(refused).rejects.toThrow(
          new SendTxError(STAND_IN_CHANGE_FOR_A_MULTISIG_WALLET)
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: pinned transparent, the 34n stays transparent at the
        // caller's address and the 11n is split at the recipient.
        const result = await send(OutputKind.TRANSPARENT);
        expect(result.shieldedOutputs!.map(o => o.value).sort((a, b) => Number(a - b))).toEqual([
          5n,
          6n,
        ]);
        expect(result.shieldedOutputs!.every(o => o.address === recipientSpend())).toBe(true);
        const customChange = result.outputs.find(
          o =>
            (o as { isChange?: boolean }).isChange &&
            (o as { token?: string }).token === CUSTOM_TOKEN
        );
        expect(customChange!.value).toBe(34n);
        expect((customChange as { address?: string }).address).toBe(LEGACY_CHANGE_ADDRESS);
      });

      test('a 1-unit output fails: the change cannot be the second shielded output', async () => {
        const storage = multisigStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        ]);

        await expect(
          new SendTransaction({
            storage,
            outputs: [
              {
                address: buildShieldedAddr(1),
                value: 1n,
                token: CUSTOM_TOKEN,
                shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
              },
            ],
          }).prepareTxData()
        ).rejects.toThrow(
          new SendTxError(
            unsplittableOutput('the wallet cannot receive a shielded change as the second one')
          )
        );
      });

      test('with its legacy change address, a 1-unit output fails for the wallet, not the address', async () => {
        const storage = multisigStorage([
          poolUtxo('nft-1', 1n, CUSTOM_TOKEN),
          poolUtxo('htr-pub-10', 10n, NATIVE_TOKEN_UID),
        ]);
        ownLegacyChangeAddress(storage);

        // A new-format change address is no way out for a multisig wallet.
        await expect(
          new SendTransaction({
            storage,
            outputs: [
              {
                address: buildShieldedAddr(1),
                value: 1n,
                token: CUSTOM_TOKEN,
                shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
              },
            ],
            changeAddress: LEGACY_CHANGE_ADDRESS,
          }).prepareTxData()
        ).rejects.toThrow(
          new SendTxError(
            unsplittableOutput('the wallet cannot receive a shielded change as the second one')
          )
        );
      });

      test('a shielded change mode is rejected', async () => {
        const storage = multisigStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)]);

        await expect(
          new SendTransaction({
            storage,
            outputs: [htrPayment],
            changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          }).prepareTxData()
        ).rejects.toThrow('A shielded change is not supported for multisig wallets.');
      });

      test('a change the rules must shield is rejected: all outputs shielded', async () => {
        const storage = multisigStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)]);

        await expect(
          new SendTransaction({
            storage,
            outputs: [
              {
                address: buildShieldedAddr(1),
                value: 5n,
                token: NATIVE_TOKEN_UID,
                shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
              },
              {
                address: buildShieldedAddr(2),
                value: 5n,
                token: NATIVE_TOKEN_UID,
                shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
              },
            ],
          }).prepareTxData()
        ).rejects.toThrow('A shielded change is not supported for multisig wallets.');
      });

      test('a change the rules must shield is rejected: a shielded UTXO was spent', async () => {
        const storage = multisigStorage([
          poolUtxo('htr-pub-3', 3n, NATIVE_TOKEN_UID),
          poolUtxo('htr-sh-10', 10n, NATIVE_TOKEN_UID, {
            shielded: true,
            blindingFactor: '4c'.repeat(32),
          }),
        ]);

        await expect(
          new SendTransaction({ storage, outputs: [htrPayment] }).prepareTxData()
        ).rejects.toThrow('A shielded change is not supported for multisig wallets.');
      });

      test('with its legacy change address, a change that must be shielded is refused for multisig', async () => {
        const send = (changeShieldedMode: ChangeOutputMode | null) => {
          const storage = multisigStorage([
            poolUtxo('custom-pub-50', 50n, CUSTOM_TOKEN),
            poolUtxo('htr-pub-9', 9n, NATIVE_TOKEN_UID),
          ]);
          ownLegacyChangeAddress(storage);
          return new SendTransaction({
            storage,
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
            changeAddress: LEGACY_CHANGE_ADDRESS,
            changeShieldedMode,
          }).prepareTxData();
        };

        // All custom outputs are shielded, so its change must be; a new-format
        // address is no way out for a multisig wallet.
        const refused = send(null);
        await expect(refused).rejects.toThrow(
          new SendTxError(
            'A shielded change is not supported for multisig wallets. Pass changeShieldedMode: ' +
              'OutputKind.TRANSPARENT to keep the change transparent.'
          )
        );
        await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
        // As suggested: the 30n change stays at the multisig change address.
        const result = await send(OutputKind.TRANSPARENT);
        const customChange = result.outputs.find(
          o =>
            (o as { isChange?: boolean }).isChange &&
            (o as { token?: string }).token === CUSTOM_TOKEN
        );
        expect(customChange!.value).toBe(30n);
        expect((customChange as { address?: string }).address).toBe(LEGACY_CHANGE_ADDRESS);
      });

      test('a new-format change address is rejected', async () => {
        const storage = multisigStorage([poolUtxo('htr-pub-20', 20n, NATIVE_TOKEN_UID)]);
        jest.spyOn(storage, 'isAddressMine').mockResolvedValue(true);

        // Even a transparent change there would pay the single-signature spend key.
        await expect(
          new SendTransaction({
            storage,
            outputs: [htrPayment],
            changeAddress: buildShieldedAddr(0),
          }).prepareTxData()
        ).rejects.toThrow('A multisig wallet cannot use a new-format change address.');
      });
    });
  });

  /**
   * A multisig wallet has no shielded address to receive a shielded change: the
   * change resolver refuses one from the wallet type, before it reads an
   * address. The tests above, whose wallet gives out a shielded address, are
   * the control.
   */
  describe('a multisig wallet', () => {
    async function* selectUtxoMock(options: IUtxoFilterOptions) {
      if (options.token === NATIVE_TOKEN_UID) {
        yield {
          txId: 'htr-tx',
          index: 0,
          value: 100n,
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

    async function multisigWallet(): Promise<HathorWallet> {
      const storage = buildStorage(selectUtxoMock);
      jest.spyOn(storage, 'getWalletType').mockResolvedValue(WalletType.MULTISIG);
      const legacy = new HDPrivateKey();
      await storage.saveAccessData({
        xpubkey: legacy.xpubkey,
        walletType: WalletType.MULTISIG,
        walletFlags: 0,
        multisigData: {
          pubkey: legacy.publicKey.toString('hex'),
          pubkeys: [legacy.xpubkey, new HDPrivateKey().xpubkey],
          numSignatures: 2,
        },
      });
      const wallet = new FakeHathorWallet() as unknown as HathorWallet;
      wallet.storage = storage;
      return wallet;
    }

    it.each([
      // Converted before the fee is calculated.
      { change: 'custom-token change', token: CUSTOM_TOKEN },
      // Converted after the HTR selection.
      { change: 'HTR change', token: NATIVE_TOKEN_UID },
    ])('refuses to shield the $change', async ({ token }) => {
      const sendTransaction = new SendTransaction({
        wallet: await multisigWallet(),
        outputs: [
          {
            address: buildShieldedAddr(1),
            value: 10n,
            token,
            shieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
        changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED,
      });

      const refused = sendTransaction.prepareTxData();
      await expect(refused).rejects.toThrow(
        'A shielded change is not supported for multisig wallets.'
      );
      await expect(refused).rejects.toBeInstanceOf(ShieldedChangeUnavailableError);
    });
  });
});

// A failed send must release its inputs BEFORE it reports the failure (error event, rejected
// promise), so a caller that retries right away finds its UTXOs free. The release is held open
// here to check that nothing is reported while it's pending.
describe('failed sends release their inputs before reporting', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(res => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const flush = () =>
    new Promise<void>(resolve => {
      setImmediate(resolve);
    });

  const setup = () => {
    const storage = new Storage(new MemoryStore());
    const release = deferred();
    jest.spyOn(storage, 'utxoSelectAsInput').mockImplementation(async (_utxo, markAs) => {
      if (!markAs) {
        await release.promise;
      }
    });
    const sendTx = new SendTransaction({ storage, outputs: [], inputs: [] });
    sendTx.transaction = {
      inputs: [{ hash: 'tx1', index: 0 }],
      toHex: () => 'aa',
      updateHash: () => {},
    } as unknown as import('../../src/models/transaction').default;
    const sendError = jest.fn();
    sendTx.on('send-error', sendError);
    return { storage, release, sendTx, sendError };
  };

  /** Track a promise without letting its rejection go unhandled. */
  const track = (promise: Promise<unknown>) => {
    const state = { settled: false, error: undefined as unknown };
    const done = promise.then(
      () => {
        state.settled = true;
      },
      err => {
        state.settled = true;
        state.error = err;
      }
    );
    return { state, done };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('mining failure: send-error and the mineTx rejection wait for the release', async () => {
    const { release, sendTx, sendError } = setup();
    const mining = track(sendTx.mineTx({ startMiningTx: false }));
    await flush(); // the inputs are marked and the MineTransaction exists

    sendTx.mineTransaction!.emit('error', 'mining failed');
    await flush();
    expect(sendError).not.toHaveBeenCalled();
    expect(mining.state.settled).toBe(false);

    release.resolve();
    await mining.done;
    expect(sendError).toHaveBeenCalledWith('mining failed');
    expect(mining.state.error).toBeDefined();
  });

  it('unexpected mining error: unexpected-error and the mineTx rejection wait for the release', async () => {
    const { release, sendTx } = setup();
    const unexpectedError = jest.fn();
    sendTx.on('unexpected-error', unexpectedError);
    const mining = track(sendTx.mineTx({ startMiningTx: false }));
    await flush(); // the inputs are marked and the MineTransaction exists

    sendTx.mineTransaction!.emit('unexpected-error', 'mining service down');
    await flush();
    expect(unexpectedError).not.toHaveBeenCalled();
    expect(mining.state.settled).toBe(false);

    release.resolve();
    await mining.done;
    expect(unexpectedError).toHaveBeenCalledWith('mining service down');
    expect(mining.state.error).toBeDefined();
  });

  it('push request failure: send-error and the rejection wait for the release', async () => {
    const { release, sendTx, sendError } = setup();
    const failure = new Error('network down');
    jest.spyOn(txApi, 'pushTx').mockRejectedValue(failure);
    const push = track(sendTx.handlePushTx());
    await flush();
    expect(sendError).not.toHaveBeenCalled();
    expect(push.state.settled).toBe(false);

    release.resolve();
    await push.done;
    expect(sendError).toHaveBeenCalledWith('network down');
    expect(push.state.error).toBe(failure);
  });

  it('tx rejected by the fullnode: the rejection waits for the release', async () => {
    const { release, sendTx } = setup();
    jest.spyOn(txApi, 'pushTx').mockImplementation(async (_hex, _force, callback) => {
      callback({ success: false, message: 'invalid tx' });
    });
    const push = track(sendTx.handlePushTx());
    await flush();
    expect(push.state.settled).toBe(false);

    release.resolve();
    await push.done;
    expect((push.state.error as Error).message).toBe('invalid tx');
  });

  // The listeners above run where nothing awaits them, so a consumer's throwing handler must be
  // logged, not become an unhandled rejection, and must not keep the send from settling.
  it("a throwing send-error handler is logged and doesn't keep the push from settling", async () => {
    const { storage, release, sendTx } = setup();
    const logError = jest.spyOn(storage.logger, 'error').mockImplementation(() => {});
    const handlerBug = new Error('handler bug');
    sendTx.on('send-error', () => {
      throw handlerBug;
    });
    const failure = new Error('network down');
    jest.spyOn(txApi, 'pushTx').mockRejectedValue(failure);

    release.resolve();
    await expect(sendTx.handlePushTx()).rejects.toBe(failure);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('send-error'), handlerBug);
  });

  it('a throwing mining error handler is logged, and mineTx still rejects', async () => {
    const { storage, release, sendTx } = setup();
    const logError = jest.spyOn(storage.logger, 'error').mockImplementation(() => {});
    const handlerBug = new Error('handler bug');
    sendTx.on('send-error', () => {
      throw handlerBug;
    });
    release.resolve();
    const mining = track(sendTx.mineTx({ startMiningTx: false }));
    await flush();

    sendTx.mineTransaction!.emit('error', 'mining failed');
    await mining.done;
    await flush();
    expect(mining.state.error).toBeDefined();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('send-error'), handlerBug);
  });
});
