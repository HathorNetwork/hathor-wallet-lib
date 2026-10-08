/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPrivateKey, PublicKey, crypto as bitcoreCrypto } from 'bitcore-lib';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import SendTransactionWalletService from '../../src/wallet/sendTransactionWalletService';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src/storage';
import walletApi from '../../src/wallet/api/walletApi';
import walletUtils from '../../src/utils/wallet';
import { decryptData } from '../../src/utils/crypto';
import { encodeShieldedAddress } from '../../src/utils/shieldedAddress';
import {
  ShieldedChangeUnavailableError,
  ShieldedNotEnabledError,
  SendTxError,
  WalletRequestError,
} from '../../src/errors';
import { IWalletAccessData } from '../../src/types';
import { OutputKind, ShieldedOutputMode } from '../../src/shielded/types';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import { FeeHeader } from '../../src/headers';
import ShieldedOutputsHeader from '../../src/headers/shielded_outputs';
import { Utxo } from '../../src/wallet/types';
import Transaction from '../../src/models/transaction';
import {
  shieldedFixtureSeed,
  shieldedFixtureAddresses,
  legacyFixtureAddress,
  buildShieldedNewAddressesResponse,
  buildShieldedTxOutputEntry,
  buildTransparentTxOutputEntry,
} from '../__mock_helpers__/shielded-ws.fixtures';
import { makeStructuralShieldedProvider } from '../__mock_helpers__/shielded-provider.mock';

const network = new Network('testnet');
const PIN = '1234';

// An external recipient (another wallet's keys)
const otherRoot = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x2b), 'testnet');
const externalShieldedAddress = encodeShieldedAddress(
  otherRoot.deriveChild("m/0'/0").publicKey.toBuffer(),
  otherRoot.deriveChild("m/1'/0").publicKey.toBuffer(),
  network
);
const externalAddress = 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc';

let accessData: IWalletAccessData;

beforeAll(() => {
  accessData = walletUtils.generateAccessDataFromSeed(shieldedFixtureSeed, {
    networkName: 'testnet',
    password: 'password',
    pin: PIN,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const parsed = (entry: Record<string, unknown>): Utxo =>
  ({ ...entry, value: BigInt(entry.value as number), authorities: 0n }) as unknown as Utxo;

const ownedOnChain = new Set([
  legacyFixtureAddress,
  ...shieldedFixtureAddresses.map(a => a.spendBase58),
]);

async function setup({
  transparent = [] as Utxo[],
  shielded = [] as Utxo[],
  shieldedKeys = true,
  unusedShieldedIndexes = [0, 1, 2],
} = {}) {
  const storage = new Storage(new MemoryStore());
  await storage.saveAccessData(accessData);
  storage.setShieldedCryptoProvider(makeStructuralShieldedProvider());
  const wallet = new HathorWalletServiceWallet({
    requestPassword: jest.fn().mockResolvedValue(PIN),
    seed: shieldedFixtureSeed,
    network,
    storage,
  });
  wallet.setState('Ready');
  (wallet as unknown as { shieldedEnabled: boolean }).shieldedEnabled = shieldedKeys;
  jest
    .spyOn(walletApi, 'getShieldedNewAddresses')
    .mockResolvedValue(buildShieldedNewAddressesResponse(unusedShieldedIndexes));
  jest.spyOn(walletApi, 'getNewAddresses').mockResolvedValue({
    success: true,
    addresses: [{ address: legacyFixtureAddress, index: 5, addressPath: "m/44'/280'/0'/0/5" }],
  });
  await (wallet as unknown as { getNewAddresses: () => Promise<void> }).getNewAddresses();

  jest.spyOn(walletApi, 'getTxOutputs').mockImplementation(async (_w, options = {}) => {
    const all = [...transparent, ...shielded];
    if (options.txId !== undefined) {
      return {
        success: true,
        txOutputs: all.filter(u => u.txId === options.txId && u.index === options.index),
      };
    }
    const pool = options.kind === 'shielded' ? shielded : transparent;
    return { success: true, txOutputs: pool.filter(u => u.tokenId === options.tokenId) };
  });
  jest.spyOn(walletApi, 'checkAddressesMine').mockImplementation(async (_w, addresses) => ({
    success: true,
    addresses: Object.fromEntries(addresses.map(a => [a, ownedOnChain.has(a)])),
  }));
  const legacySelection = jest.spyOn(wallet, 'getUtxosForAmount');
  return { wallet, storage, legacySelection };
}

const htrUtxo = (index: number, value: number) =>
  parsed({ ...buildTransparentTxOutputEntry(), index, value });

const shieldedHtrUtxo = (index: number, shieldedIndex: number) =>
  parsed(buildShieldedTxOutputEntry({ mode: 1, index, shieldedIndex, value: 150 }));

describe('sends from a wallet with shielded keys go through the shared engine', () => {
  it('builds a transparent send from the wallet-service utxo pools', async () => {
    const { wallet, legacySelection } = await setup({ transparent: [htrUtxo(0, 100)] });
    const sendTx = await wallet.sendManyOutputsSendTransaction(
      [{ address: externalAddress, value: 30n, token: NATIVE_TOKEN_UID }],
      { pinCode: PIN }
    );
    const tx = await sendTx.prepareTx();
    expect(legacySelection).not.toHaveBeenCalled();
    expect(tx.inputs).toHaveLength(1);
    expect(tx.outputs.map(o => o.value).sort()).toEqual([30n, 70n]);
    expect(sendTx.utxosAddressPath).toEqual(["m/44'/280'/0'/0/5"]);
  });

  it('builds shielded outputs with their header and fee', async () => {
    const { wallet } = await setup({ transparent: [htrUtxo(0, 1000)] });
    const sendTx = await wallet.sendManyOutputsSendTransaction(
      [
        {
          address: externalShieldedAddress,
          value: 50n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ],
      { pinCode: PIN }
    );
    const tx = await sendTx.prepareTx();
    expect(tx.headers.some(h => h instanceof ShieldedOutputsHeader)).toBe(true);
    // A lone shielded output always gets a second one
    expect(tx.shieldedOutputs.length).toBeGreaterThanOrEqual(2);
    const fee = tx.headers.find(h => h instanceof FeeHeader) as FeeHeader;
    expect(fee.entries[0].amount).toBeGreaterThan(0n);
  });

  it('accepts every change mode, including the shielded ones', async () => {
    const { wallet } = await setup({ transparent: [htrUtxo(0, 1000)] });
    for (const changeShieldedMode of [
      OutputKind.TRANSPARENT,
      ShieldedOutputMode.AMOUNT_SHIELDED,
      ShieldedOutputMode.FULLY_SHIELDED,
      null,
    ]) {
      await expect(
        wallet.sendManyOutputsSendTransaction(
          [{ address: externalAddress, value: 30n, token: NATIVE_TOKEN_UID }],
          { pinCode: PIN, changeShieldedMode }
        )
      ).resolves.toBeInstanceOf(SendTransactionWalletService);
    }
  });

  it('rejects an unknown change mode', async () => {
    const { wallet } = await setup({ transparent: [htrUtxo(0, 1000)] });
    const sendTx = await wallet.sendManyOutputsSendTransaction(
      [{ address: externalAddress, value: 30n, token: NATIVE_TOKEN_UID }],
      { pinCode: PIN, changeShieldedMode: 'bogus' as never }
    );
    await expect(sendTx.prepareTx()).rejects.toThrow(/changeShieldedMode/);
  });

  it('spends a shielded utxo and signs it with the spend key of its index', async () => {
    const { wallet } = await setup({ shielded: [shieldedHtrUtxo(5, 1)] });
    const sendTx = await wallet.sendManyOutputsSendTransaction(
      [{ address: externalAddress, value: 100n, token: NATIVE_TOKEN_UID }],
      { pinCode: PIN, changeShieldedMode: OutputKind.TRANSPARENT }
    );
    const tx = await sendTx.prepareTx();
    expect(sendTx.utxosAddressPath).toEqual(["m/44'/280'/2'/0/1"]);

    await sendTx.signTx(PIN);
    const spendRoot = new HDPrivateKey(decryptData(accessData.spendMainKey!, PIN));
    const expectedPubkey = spendRoot.deriveChild(1).publicKey;
    const { data } = tx.inputs[0];
    // input data = push(signature) + push(pubkey)
    const sigLength = data![0];
    const pubkey = data!.subarray(1 + sigLength + 1);
    expect(new PublicKey(pubkey).toString()).toBe(expectedPubkey.toString());
    const signature = bitcoreCrypto.Signature.fromDER(data!.subarray(1, 1 + sigLength));
    expect(bitcoreCrypto.ECDSA.verify(tx.getDataToSignHash(), signature, expectedPubkey)).toBe(
      true
    );
  });

  it('signs legacy and shielded inputs of one transaction with their own chains', async () => {
    const { wallet } = await setup({
      transparent: [htrUtxo(0, 100)],
      shielded: [shieldedHtrUtxo(5, 2)],
    });
    const sendTx = await wallet.sendManyOutputsSendTransaction(
      [{ address: externalAddress, value: 200n, token: NATIVE_TOKEN_UID }],
      { pinCode: PIN, changeShieldedMode: OutputKind.TRANSPARENT }
    );
    const tx = await sendTx.prepareTx();
    await sendTx.signTx(PIN);
    const legacyRoot = new HDPrivateKey(await wallet.storage.getMainXPrivKey(PIN));
    const spendRoot = new HDPrivateKey(decryptData(accessData.spendMainKey!, PIN));
    const pubkeyOf = (i: number) => {
      const data = tx.inputs[i].data!;
      return new PublicKey(data.subarray(1 + data[0] + 1)).toString();
    };
    tx.inputs.forEach((_input, i) => {
      const path = sendTx.utxosAddressPath[i];
      const index = HathorWalletServiceWallet.getAddressIndexFromFullPath(path);
      const expected = path.startsWith("m/44'/280'/2'")
        ? spendRoot.deriveChild(index).publicKey
        : legacyRoot.deriveNonCompliantChild(index).publicKey;
      expect(pubkeyOf(i)).toBe(expected.toString());
    });
    expect(sendTx.utxosAddressPath.sort()).toEqual(["m/44'/280'/0'/0/5", "m/44'/280'/2'/0/2"]);
  });
});

describe('shielded change the wallet cannot host', () => {
  it('fails with ShieldedChangeUnavailableError when there is no unused shielded address', async () => {
    // One shielded output and no shielded utxo: the change must stand in for
    // the missing shielded input, and the wallet has no address to receive it
    const { wallet } = await setup({
      transparent: [htrUtxo(0, 1000)],
      unusedShieldedIndexes: [],
    });
    const sendTx = await wallet.sendManyOutputsSendTransaction(
      [
        { address: externalAddress, value: 10n, token: NATIVE_TOKEN_UID },
        {
          address: externalShieldedAddress,
          value: 20n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ],
      { pinCode: PIN }
    );
    await expect(sendTx.prepareTx()).rejects.toThrow(ShieldedChangeUnavailableError);
  });
});

describe('wallets without shielded keys', () => {
  it('refuse shielded outputs', async () => {
    const { wallet } = await setup({ shieldedKeys: false });
    await expect(
      wallet.sendManyOutputsSendTransaction(
        [
          {
            address: externalShieldedAddress,
            value: 50n,
            token: NATIVE_TOKEN_UID,
            shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
          },
        ],
        { pinCode: PIN }
      )
    ).rejects.toThrow(ShieldedNotEnabledError);
  });

  it('refuse a shielded change mode', async () => {
    const { wallet } = await setup({ shieldedKeys: false });
    await expect(
      wallet.sendManyOutputsSendTransaction(
        [{ address: externalAddress, value: 30n, token: NATIVE_TOKEN_UID }],
        { pinCode: PIN, changeShieldedMode: ShieldedOutputMode.AMOUNT_SHIELDED }
      )
    ).rejects.toThrow(ShieldedNotEnabledError);
  });

  it('keep the legacy send path', async () => {
    const { wallet, legacySelection } = await setup({
      shieldedKeys: false,
      transparent: [htrUtxo(0, 100)],
    });
    jest.spyOn(walletApi, 'getTokenDetails');
    legacySelection.mockResolvedValue({
      utxos: [htrUtxo(0, 100)],
      changeAmount: 70n,
    });
    const sendTx = await wallet.sendManyOutputsSendTransaction(
      [{ address: externalAddress, value: 30n, token: NATIVE_TOKEN_UID }],
      { pinCode: PIN, changeShieldedMode: OutputKind.TRANSPARENT }
    );
    await sendTx.prepareTx();
    expect(legacySelection).toHaveBeenCalled();
  });
});

describe('tx proposal errors', () => {
  const proposalError = (status: number, error: string) =>
    new WalletRequestError('Error creating tx proposal.', {
      cause: { status, data: { success: false, error } },
    });

  it.each([
    ['inputs-shielded-unsupported', /does not accept shielded inputs/],
    ['inputs-already-used', /already used by another transaction proposal/],
    ['inputs-not-found', /not unspent outputs of this wallet/],
    ['inputs-not-in-wallet', /do not belong to this wallet/],
  ])('names the %s failure', async (code, message) => {
    const { wallet } = await setup();
    const sendTx = new SendTransactionWalletService(wallet, {
      transaction: new Transaction([], []),
    });
    const created = proposalError(400, code);
    jest.spyOn(walletApi, 'createTxProposal').mockRejectedValue(created);
    const err = await sendTx.handleSendTxProposal().catch(e => e);
    expect(err).toBeInstanceOf(SendTxError);
    expect(err.message).toMatch(message);
    expect(err.cause).toBe(created);
  });

  it('keeps the generic message for other failures', async () => {
    const { wallet } = await setup();
    const sendTx = new SendTransactionWalletService(wallet, {
      transaction: new Transaction([], []),
    });
    jest.spyOn(walletApi, 'createTxProposal').mockRejectedValue(proposalError(500, 'other'));
    await expect(sendTx.handleSendTxProposal()).rejects.toThrow('Error sending tx proposal.');
  });
});
