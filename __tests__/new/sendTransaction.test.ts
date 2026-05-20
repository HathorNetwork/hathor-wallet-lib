/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { PrivateKey } from 'bitcore-lib';
import {
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
  NATIVE_TOKEN_UID,
  TOKEN_AUTHORITY_MASK,
} from '../../src/constants';
import Network from '../../src/models/network';
import SendTransaction, {
  isDataOutput,
  checkUnspentInput,
  convertHtrChangeIfRequested,
  prepareSendTokensData,
} from '../../src/new/sendTransaction';
import { ShieldedOutputMode } from '../../src/shielded/types';
import { MemoryStore, Storage } from '../../src/storage';
import { WalletType } from '../../src/types';
import { encodeShieldedAddress } from '../../src/utils/shieldedAddress';
import transaction from '../../src/utils/transaction';
import { OutputType } from '../../src/wallet/types';
import { mockGetToken } from '../__mock_helpers__/get-token.mock';

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

test('checkUnspentInput accepts the user-facing shielded form when output is on the spend-P2PKH sibling', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  jest.spyOn(storage, 'isAddressMine').mockReturnValue(Promise.resolve(true));
  jest.spyOn(storage, 'getTx').mockReturnValue(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, token: '01', decoded: { address: 'spend-p2pkh-W' } }],
    })
  );
  // Caller passed the user-facing shielded receive form. On-chain
  // the output is labelled with the spend-P2PKH sibling at the same
  // BIP32 index. The validator must resolve the two as equivalent.
  jest.spyOn(storage, 'getAddressInfo').mockImplementation(addr => {
    if (addr === 'shielded-K') {
      return Promise.resolve({ addressType: 'shielded', bip32AddressIndex: 7 });
    }
    if (addr === 'spend-p2pkh-W') {
      return Promise.resolve({ addressType: 'shielded-spend', bip32AddressIndex: 7 });
    }
    return Promise.resolve(null);
  });

  const input = { txId: 'tx-id', index: 0, address: 'shielded-K', token: '01' };
  await expect(checkUnspentInput(storage, input, '01')).resolves.toEqual({
    success: true,
    message: '',
  });
});

test('checkUnspentInput still rejects a totally unrelated address (no over-resolution regression)', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');

  jest.spyOn(storage, 'isAddressMine').mockReturnValue(Promise.resolve(true));
  jest.spyOn(storage, 'getTx').mockReturnValue(
    Promise.resolve({
      is_voided: false,
      outputs: [{ token_data: 1, token: '01', decoded: { address: 'spend-p2pkh-W' } }],
    })
  );
  // Caller's shielded address resolves to a DIFFERENT BIP32 index
  // than the output's spend-P2PKH. Must still be rejected — the
  // shielded resolution must not become an "always accept" bypass.
  jest.spyOn(storage, 'getAddressInfo').mockImplementation(addr => {
    if (addr === 'shielded-K-other-index') {
      return Promise.resolve({ addressType: 'shielded', bip32AddressIndex: 99 });
    }
    if (addr === 'spend-p2pkh-W') {
      return Promise.resolve({ addressType: 'shielded-spend', bip32AddressIndex: 7 });
    }
    return Promise.resolve(null);
  });

  const input = { txId: 'tx-id', index: 0, address: 'shielded-K-other-index', token: '01' };
  await expect(checkUnspentInput(storage, input, '01')).resolves.toEqual({
    success: false,
    message:
      'Output [0] of transaction [tx-id] does not have the same address as the provided input',
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

  const buildShieldedDef = (mode: ShieldedOutputMode) => ({
    type: OutputType.P2PKH as OutputType.P2PKH,
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

  test('H.1 — converts transparent HTR change to FS', async () => {
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
      ShieldedOutputMode.FULLY_SHIELDED,
      mockWallet(buildShieldedAddress()),
      testnetNetwork
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
    // scanPubkey is hex-encoded 33 bytes (66 hex chars).
    expect(htrChange.scanPubkey).toMatch(/^[0-9a-f]{66}$/);
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
      testnetNetwork
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
      testnetNetwork
    );

    expect(result.addedFee).toBe(0n);
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(defs).toHaveLength(2);
  });

  test('H.4 — no-op when change value <= additionalFee', async () => {
    // Edge: change exactly equals the FEE → conversion would zero-out
    // the resulting shielded value, which is strictly worse than
    // keeping the transparent change (we'd be silently destroying
    // funds via the fee).
    const partialHtrTxData = {
      inputs: [],
      outputs: [buildHtrChangeOutput(FEE_PER_FULL_SHIELDED_OUTPUT)],
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
      testnetNetwork
    );

    expect(result.addedFee).toBe(0n);
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
      testnetNetwork
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
      testnetNetwork
    );

    expect(result.addedFee).toBe(0n);
    expect(partialHtrTxData.outputs).toHaveLength(1);
    expect(defs).toHaveLength(0);
  });
});
