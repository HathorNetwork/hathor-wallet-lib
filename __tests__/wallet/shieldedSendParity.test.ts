/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The wallet-service facade builds sends with the fullnode facade's engine
 * over a storage adapter. These tests run the same sends through both — the
 * engine over a fullnode MemoryStore, and the wallet-service facade over
 * mocked API responses holding the same utxos — and assert they build the
 * same transaction: same inputs, transparent outputs, shielded outputs and
 * fee. Selection and change rules therefore cannot drift between facades.
 */

import { HDPrivateKey } from 'bitcore-lib';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { WalletServiceSendStorage } from '../../src/wallet/walletServiceSendStorage';
import SendTransaction, { ISendOutput } from '../../src/new/sendTransaction';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src/storage';
import walletApi from '../../src/wallet/api/walletApi';
import walletUtils from '../../src/utils/wallet';
import { encodeShieldedAddress } from '../../src/utils/shieldedAddress';
import { IDataTx, IUtxo, IWalletAccessData, TokenVersion } from '../../src/types';
import {
  ChangeOutputMode,
  IShieldedCryptoProvider,
  OutputKind,
  ShieldedOutputMode,
} from '../../src/shielded/types';
import { DEFAULT_TX_VERSION, NATIVE_TOKEN_UID, NATIVE_TOKEN_UID_HEX } from '../../src/constants';
import { OutputRequestObj, Utxo } from '../../src/wallet/types';
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
const ABF = Buffer.alloc(32, 0x13);
const FS_ASSET_COMMITMENT = Buffer.from('0a'.padEnd(66, 'f'), 'hex');

const otherRoot = HDPrivateKey.fromSeed(Buffer.alloc(32, 0x2b), 'testnet');
const externalShieldedAt = (i: number) =>
  encodeShieldedAddress(
    otherRoot.deriveChild(`m/0'/${i}`).publicKey.toBuffer(),
    otherRoot.deriveChild(`m/1'/${i}`).publicKey.toBuffer(),
    network
  );
const externalShielded = externalShieldedAt(0);
const externalAddress = 'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc';
const ownChange = legacyFixtureAddress;
const ownShieldedChange = shieldedFixtureAddresses[0].shieldedBase58;

const owned = new Set([
  legacyFixtureAddress,
  ...shieldedFixtureAddresses.flatMap(a => [a.spendBase58, a.shieldedBase58]),
]);

/** A utxo of the scenario, in the shape both sides are built from. */
interface ScenarioUtxo {
  index: number;
  value: number;
  mode?: 1 | 2; // shielded mode; absent for transparent
  token?: string; // default HTR
}

const FEE_TOKEN = 'cd'.repeat(32);
const DEPOSIT_TOKEN = 'ab'.repeat(32);

const tokenData = (uid: string) => {
  if (uid === FEE_TOKEN) return { uid, name: 'Fee', symbol: 'FEE', version: TokenVersion.FEE };
  if (uid === DEPOSIT_TOKEN) {
    return { uid, name: 'Deposit', symbol: 'DEP', version: TokenVersion.DEPOSIT };
  }
  return { uid, name: 'Hathor', symbol: 'HTR', version: TokenVersion.NATIVE };
};

interface Scenario {
  name: string;
  utxos: ScenarioUtxo[];
  outputs: OutputRequestObj[];
  changeShieldedMode?: ChangeOutputMode | null;
}

const transparentTx = buildTransparentTxOutputEntry().txId;
const shieldedTx = buildShieldedTxOutputEntry().txId;
// Distinct commitments, so the provider opens each shielded utxo to its value
const commitmentOf = (index: number) => index.toString(16).padStart(2, '0').padEnd(66, 'a');

const scenarios: Scenario[] = [
  {
    name: 'all-transparent send covered by transparent utxos',
    utxos: [
      { index: 0, value: 100 },
      { index: 1, value: 50 },
      { index: 2, value: 150, mode: 1 },
    ],
    outputs: [{ address: externalAddress, value: 30n, token: NATIVE_TOKEN_UID }],
  },
  {
    name: 'all-transparent send falling back to a shielded utxo',
    utxos: [
      { index: 0, value: 20 },
      { index: 1, value: 150, mode: 1 },
    ],
    outputs: [{ address: externalAddress, value: 100n, token: NATIVE_TOKEN_UID }],
  },
  {
    name: 'all-transparent send falling back to a fully shielded utxo',
    utxos: [
      { index: 0, value: 20 },
      { index: 1, value: 150, mode: 2 },
    ],
    outputs: [{ address: externalAddress, value: 100n, token: NATIVE_TOKEN_UID }],
  },
  {
    name: 'all-shielded send',
    utxos: [
      { index: 0, value: 1000 },
      { index: 1, value: 150, mode: 1 },
      { index: 2, value: 160, mode: 1 },
    ],
    outputs: [
      {
        address: externalShielded,
        value: 100n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ],
  },
  {
    name: 'mixed send with one shielded output and a shielded utxo',
    utxos: [
      { index: 0, value: 1000 },
      { index: 1, value: 150, mode: 1 },
    ],
    outputs: [
      { address: externalAddress, value: 10n, token: NATIVE_TOKEN_UID },
      {
        address: externalShielded,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ],
  },
  {
    name: 'mixed send with one shielded output and no shielded utxo',
    utxos: [{ index: 0, value: 1000 }],
    outputs: [
      { address: externalAddress, value: 10n, token: NATIVE_TOKEN_UID },
      {
        address: externalShielded,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ],
  },
  {
    name: 'lone 1-unit shielded output',
    utxos: [{ index: 0, value: 1000 }],
    outputs: [
      {
        address: externalShielded,
        value: 1n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ],
  },
  {
    name: 'explicit fully shielded change',
    utxos: [{ index: 0, value: 1000 }],
    outputs: [{ address: externalAddress, value: 30n, token: NATIVE_TOKEN_UID }],
    changeShieldedMode: ShieldedOutputMode.FULLY_SHIELDED,
  },
  {
    name: 'fee-token send spending a shielded fee-token utxo',
    utxos: [
      { index: 0, value: 1000 },
      { index: 1, value: 150, mode: 1, token: FEE_TOKEN },
    ],
    outputs: [{ address: externalAddress, value: 100n, token: FEE_TOKEN }],
  },
  {
    name: 'amount-shielded send with both shielded modes in the pool',
    utxos: [
      { index: 0, value: 1000 },
      { index: 1, value: 150, mode: 1 },
      { index: 2, value: 160, mode: 2 },
    ],
    outputs: [
      {
        address: externalShielded,
        value: 100n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ],
  },
  {
    name: 'fully shielded send with both shielded modes in the pool',
    utxos: [
      { index: 0, value: 1000 },
      { index: 1, value: 150, mode: 1 },
      { index: 2, value: 160, mode: 2 },
    ],
    outputs: [
      {
        address: externalShielded,
        value: 100n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ],
  },
  {
    name: 'HTR change standing in beside other shielded outputs',
    utxos: [
      { index: 0, value: 19 },
      { index: 1, value: 9 },
      { index: 2, value: 7 },
      { index: 3, value: 25, mode: 1, token: DEPOSIT_TOKEN },
    ],
    outputs: [
      {
        address: externalShieldedAt(1),
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      { address: externalAddress, value: 5n, token: NATIVE_TOKEN_UID },
      {
        address: externalShieldedAt(2),
        value: 10n,
        token: DEPOSIT_TOKEN,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: externalShieldedAt(3),
        value: 10n,
        token: DEPOSIT_TOKEN,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ],
  },
  {
    name: 'exact match below more than 255 larger utxos',
    utxos: [
      ...Array.from({ length: 300 }, (_v, i) => ({ index: i, value: 1000 - i })),
      { index: 300, value: 5 },
    ],
    outputs: [{ address: externalAddress, value: 5n, token: NATIVE_TOKEN_UID }],
  },
  {
    name: 'explicit transparent change',
    utxos: [
      { index: 0, value: 20 },
      { index: 1, value: 150, mode: 1 },
    ],
    outputs: [{ address: externalAddress, value: 100n, token: NATIVE_TOKEN_UID }],
    changeShieldedMode: OutputKind.TRANSPARENT,
  },
];

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

function makeProvider(scenario: Scenario): IShieldedCryptoProvider {
  const valueByCommitment = new Map(
    scenario.utxos.filter(u => u.mode).map(u => [commitmentOf(u.index), BigInt(u.value)])
  );
  const provider = makeStructuralShieldedProvider();
  (provider.rewindAmountShieldedOutput as jest.Mock).mockImplementation(
    async (_key: Buffer, _eph: Buffer, commitment: Buffer) => ({
      value: valueByCommitment.get(commitment.toString('hex')),
      blindingFactor: Buffer.alloc(32, 0x11),
    })
  );
  (provider.rewindFullShieldedOutput as jest.Mock).mockImplementation(
    async (_key: Buffer, _eph: Buffer, commitment: Buffer) => ({
      value: valueByCommitment.get(commitment.toString('hex')),
      blindingFactor: Buffer.alloc(32, 0x12),
      assetBlindingFactor: ABF,
      tokenUid: NATIVE_TOKEN_UID_HEX,
    })
  );
  (provider.createAssetCommitment as jest.Mock).mockResolvedValue(FS_ASSET_COMMITMENT);
  return provider;
}

/** The scenario utxos as the wallet-service returns them, largest first. */
function serviceEntries(scenario: Scenario): Utxo[] {
  return [...scenario.utxos]
    .sort((a, b) => b.value - a.value)
    .map(u => {
      const tokenId = u.token ?? NATIVE_TOKEN_UID;
      const entry = u.mode
        ? {
            ...buildShieldedTxOutputEntry({ mode: u.mode, index: u.index, shieldedIndex: u.index }),
            txId: shieldedTx,
            tokenId,
            commitment: commitmentOf(u.index),
            ...(u.mode === 2 ? { assetCommitment: FS_ASSET_COMMITMENT.toString('hex') } : {}),
          }
        : { ...buildTransparentTxOutputEntry(), txId: transparentTx, index: u.index, tokenId };
      return { ...entry, value: BigInt(u.value), authorities: 0n } as unknown as Utxo;
    });
}

/** The scenario utxos as a fullnode wallet holds them after decoding. */
function storeUtxos(scenario: Scenario): IUtxo[] {
  return scenario.utxos.map(u => ({
    txId: u.mode ? shieldedTx : transparentTx,
    index: u.index,
    token: u.token ?? NATIVE_TOKEN_UID,
    address: u.mode ? shieldedFixtureAddresses[u.index].spendBase58 : legacyFixtureAddress,
    value: BigInt(u.value),
    authorities: 0n,
    timelock: null,
    type: DEFAULT_TX_VERSION,
    height: null,
    ...(u.mode
      ? {
          shielded: true,
          blindingFactor: Buffer.alloc(32, u.mode === 2 ? 0x12 : 0x11).toString('hex'),
          ...(u.mode === 2 ? { assetBlindingFactor: ABF.toString('hex') } : {}),
        }
      : {}),
  }));
}

const engineOutputs = (outputs: OutputRequestObj[]): ISendOutput[] =>
  outputs.map(o => ({
    address: o.address,
    value: o.value,
    token: o.token,
    ...(o.shielded ? { shieldedMode: o.shielded } : {}),
  }));

async function buildWithFullnodeStorage(scenario: Scenario): Promise<IDataTx> {
  const storage = new Storage(new MemoryStore());
  await storage.saveAccessData(accessData);
  storage.setShieldedCryptoProvider(makeProvider(scenario));
  for (const utxo of storeUtxos(scenario)) {
    await storage.store.saveUtxo(utxo);
  }
  jest.spyOn(storage.config, 'getNetwork').mockReturnValue(network);
  jest
    .spyOn(storage, 'getCurrentAddress')
    .mockImplementation(async (_markAsUsed, opts) =>
      opts?.legacy === false ? ownShieldedChange : ownChange
    );
  jest.spyOn(storage, 'isAddressMine').mockImplementation(async address => owned.has(address));
  jest.spyOn(storage, 'getToken').mockImplementation(async uid => tokenData(uid));
  const sendTransaction = new SendTransaction({
    storage,
    outputs: engineOutputs(scenario.outputs),
    changeShieldedMode: scenario.changeShieldedMode ?? null,
    pin: PIN,
  });
  return sendTransaction.prepareTxData();
}

async function buildWithWalletService(
  scenario: Scenario
): Promise<{ txData: IDataTx; members: string[] }> {
  const storage = new Storage(new MemoryStore());
  await storage.saveAccessData(accessData);
  storage.setShieldedCryptoProvider(makeProvider(scenario));
  const wallet = new HathorWalletServiceWallet({
    requestPassword: jest.fn(),
    seed: shieldedFixtureSeed,
    network,
    storage,
  });
  wallet.setState('Ready');
  (wallet as unknown as { shieldedEnabled: boolean }).shieldedEnabled = true;
  jest.spyOn(walletApi, 'getShieldedNewAddresses').mockResolvedValue({
    ...buildShieldedNewAddressesResponse([0, 1, 2]),
    legacyAddresses: [{ address: ownChange, index: 5, addressPath: "m/44'/280'/0'/0/5" }],
  });
  await (wallet as unknown as { getNewAddresses: () => Promise<void> }).getNewAddresses();

  const entries = serviceEntries(scenario);
  jest.spyOn(walletApi, 'getTxOutputs').mockImplementation(async (_w, options = {}) => {
    if (options.txId !== undefined) {
      return {
        success: true,
        txOutputs: entries.filter(e => e.txId === options.txId && e.index === options.index),
      };
    }
    // The wallet-service query: value < smallerThan, largest first, limited
    const smallerThan = options.smallerThan === undefined ? undefined : BigInt(options.smallerThan);
    return {
      success: true,
      txOutputs: entries
        .filter(
          e =>
            (e.kind ?? 'transparent') === options.kind &&
            e.tokenId === options.tokenId &&
            (smallerThan === undefined || e.value < smallerThan)
        )
        .slice(0, options.maxOutputs),
    };
  });
  jest.spyOn(walletApi, 'checkAddressesMine').mockImplementation(async (_w, addresses) => ({
    success: true,
    addresses: Object.fromEntries(addresses.map(a => [a, owned.has(a)])),
  }));
  jest.spyOn(walletApi, 'getTokenDetails').mockImplementation(async (_w, uid) => ({
    success: true,
    details: {
      tokenInfo: { ...tokenData(uid), id: uid },
      totalSupply: 0n,
      totalTransactions: 0,
      authorities: { mint: false, melt: false },
    },
  }));

  const adapter = new WalletServiceSendStorage(wallet, PIN);
  const sendTransaction = new SendTransaction({
    storage: adapter.createProxy(),
    outputs: engineOutputs(scenario.outputs),
    changeShieldedMode: scenario.changeShieldedMode ?? null,
    pin: PIN,
  });
  const txData = await sendTransaction.prepareTxData();
  return { txData, members: adapter.accessedMembers() };
}

/** The parts of a built send that must match between the two facades. */
function summary(txData: IDataTx) {
  const fee = txData.headers?.find(h => 'entries' in h) as
    | { entries: { amount: bigint }[] }
    | undefined;
  return {
    inputs: txData.inputs.map(i => `${i.txId}:${i.index}`).sort(),
    outputs: txData.outputs
      .map(o => `${'address' in o ? o.address : 'data'}:${o.value}:${o.token}`)
      .sort(),
    shieldedOutputs: (txData.shieldedOutputs ?? [])
      .map(o => `${o.address}:${o.value}:${o.token}:${o.shieldedMode}`)
      .sort(),
    fee: fee?.entries.map(e => e.amount) ?? [],
  };
}

const membersUsed = new Set<string>();

describe('the wallet-service facade builds the same sends as the fullnode facade', () => {
  it.each(scenarios.map(s => [s.name, s] as const))('%s', async (_name, scenario) => {
    const fullnode = summary(await buildWithFullnodeStorage(scenario));
    const { txData, members } = await buildWithWalletService(scenario);
    members.forEach(m => membersUsed.add(m));
    expect(summary(txData)).toEqual(fullnode);
  });

  it('reads storage only through the members the adapter was reviewed for', () => {
    // An unsupported member would have thrown during the builds above. This
    // pins the exact set, so an engine change that reads storage differently
    // is noticed here and the adapter reviewed for it.
    expect(Array.from(membersUsed).sort()).toEqual([
      'config',
      'getChangeAddress',
      'getCurrentAddress',
      'getToken',
      'getUtxo',
      'getWalletType',
      'isAddressMine',
      'selectUtxos',
      'shieldedCryptoProvider',
    ]);
  });
});
