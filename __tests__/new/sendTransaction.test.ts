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
import { IShieldedCryptoProvider, ShieldedOutputMode } from '../../src/shielded/types';
import { MemoryStore, Storage } from '../../src/storage';
import {
  IDataInput,
  IStorage,
  IUtxo,
  IUtxoFilterOptions,
  TokenVersion,
  WalletType,
} from '../../src/types';
import FeeHeader from '../../src/headers/fee';
import walletHelpers from '../../src/utils/helpers';
import { encodeShieldedAddress } from '../../src/utils/shieldedAddress';
import transaction from '../../src/utils/transaction';
import { OutputType } from '../../src/wallet/types';
import { mockGetToken } from '../__mock_helpers__/get-token.mock';

test('prepareTxData rejects a shielded address in a transparent output', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  // Genuine curve points (encode/extract validate on-curve membership).
  const root = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x09), 'testnet');
  const shieldedAddress = encodeShieldedAddress(
    root.deriveChild("m/0'/0").publicKey.toBuffer(),
    root.deriveChild("m/1'/0").publicKey.toBuffer(),
    new Network('testnet')
  );

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

  // The transparent pipeline must fail loudly BEFORE any utxo selection:
  // shielded routing only lands in PR 6, and a 71-byte address has no
  // transparent output script form.
  await expect(sendTransaction.prepareTxData()).rejects.toThrow(
    /Shielded addresses cannot be used directly as output script type/
  );
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
    data: Buffer.alloc(0),
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
    data: Buffer.from('abcd', 'hex'),
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
  // caller's `filter_method` so the exclusion of already-used UTXOs is
  // exercised the same way the real storage does.
  const mockStorage = (utxos: FakeUtxo[] = []) =>
    ({
      // eslint-disable-next-line @typescript-eslint/require-await
      async *selectUtxos(options: IUtxoFilterOptions) {
        for (const utxo of utxos) {
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

  test('H.6 — no-op when shieldedOutputDefs is empty (defensive)', async () => {
    // A pure-transparent tx that somehow received `changeShieldedMode`
    // should NOT have its HTR change converted — the resulting tx
    // would have exactly one shielded output, violating the `>= 2`
    // invariant enforced later in prepareTxData.
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

    expect(result.addedFee).toBe(0n);
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(defs).toHaveLength(0);
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

  test('gating — changeShieldedMode on a transparent-only send keeps the change transparent', async () => {
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
      }
    }
    // No shielded outputs at all → no crypto provider required.
    const storage = buildStorage(selectUtxoMock, { withProvider: false });
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

    // Gate: no explicit shielded outputs → no conversion, no lone shielded
    // output, transparent change preserved (100n - 10n = 90n).
    expect(result.shieldedOutputs).toBeUndefined();
    const change = result.outputs.find(o => (o as { isChange?: boolean }).isChange);
    expect(change).toBeDefined();
    expect(change!.value).toBe(90n);
  });
});
