/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * HathorWalletServiceWallet.getShieldedUnblindingForTx: the openings of the
 * wallet's own shielded outputs and inputs of a tx, from the full tx, the
 * wallet-service's tx_outputs and the scan key in memory, in the shape (and
 * with the values) the fullnode facade gives for the same tx.
 */

import HathorWalletServiceWallet from '../../src/wallet/wallet';
import HathorWallet from '../../src/new/wallet';
import Connection from '../../src/new/connection';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src/storage';
import walletApi from '../../src/wallet/api/walletApi';
import walletUtils from '../../src/utils/wallet';
import { decryptData } from '../../src/utils/crypto';
import { ShieldedKeyError, TxNotFoundError, WalletRequestError } from '../../src/errors';
import { ErrorMessages } from '../../src/errorMessages';
import { encodeShieldedUnblindingPayload } from '../../src/shielded/unblinding';
import { IShieldedCryptoProvider, ShieldedOutputMode } from '../../src/shielded/types';
import { NATIVE_TOKEN_UID_HEX } from '../../src/constants';
import {
  getDefaultLogger,
  IHistoryShieldedOutput,
  IHistoryTx,
  IWalletAccessData,
} from '../../src/types';
import { FullNodeTxResponse, Utxo } from '../../src/wallet/types';
import {
  shieldedFixtureSeed,
  shieldedFixtureAddresses,
  legacyFixtureAddress,
  buildShieldedTxOutputEntry,
} from '../__mock_helpers__/shielded-ws.fixtures';

const network = new Network('testnet');
const PIN = '1234';
const SPEND_TX_ID = 'a1'.repeat(32);
const PARENT_TX_ID = 'b2'.repeat(32);
// A tx the wallet doesn't own an output of: the transparent input spends it
const FUNDING_TX_ID = 'c3'.repeat(32);
const CUSTOM_TOKEN = 'd4'.repeat(32);
const ASSET_COMMITMENT = '0a'.padEnd(66, 'f');
// The other on-chain fields, as the wallet-service's entries carry them
const RANGE_PROOF = 'cd'.repeat(32);
const EPHEMERAL_PUBKEY = '02'.padEnd(66, 'b');
const hex = (byte: string) => byte.repeat(32);

/** Distinct commitments, so the provider opens each output to its own data. */
const commitments = {
  parent: '08'.padEnd(66, '1'),
  other: '08'.padEnd(66, '2'),
  ownAmount: '08'.padEnd(66, '3'),
  ownFull: '08'.padEnd(66, '4'),
};

/** What rewinding each output with the wallet's scan key recovers. */
const rewound: Record<string, { value: bigint; vbf: string; abf?: string; token?: string }> = {
  [commitments.parent]: { value: 777n, vbf: hex('11') },
  [commitments.ownAmount]: { value: 250n, vbf: hex('22') },
  [commitments.ownFull]: { value: 999n, vbf: hex('33'), abf: hex('44'), token: CUSTOM_TOKEN },
};

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

function makeProvider(): IShieldedCryptoProvider {
  return {
    rewindAmountShieldedOutput: jest.fn().mockImplementation(async (_k, _e, commitment: Buffer) => {
      const data = rewound[commitment.toString('hex')];
      return { value: data.value, blindingFactor: Buffer.from(data.vbf, 'hex') };
    }),
    rewindFullShieldedOutput: jest.fn().mockImplementation(async (_k, _e, commitment: Buffer) => {
      const data = rewound[commitment.toString('hex')];
      return {
        value: data.value,
        blindingFactor: Buffer.from(data.vbf, 'hex'),
        assetBlindingFactor: Buffer.from(data.abf!, 'hex'),
        tokenUid: data.token ?? NATIVE_TOKEN_UID_HEX,
      };
    }),
    deriveTag: jest.fn().mockResolvedValue(Buffer.alloc(33, 4)),
    createAssetCommitment: jest.fn().mockResolvedValue(Buffer.from(ASSET_COMMITMENT, 'hex')),
  } as unknown as IShieldedCryptoProvider;
}

/** A tx_outputs shielded entry of this wallet, as the parsed API response delivers it. */
const ownEntry = (
  txId: string,
  index: number,
  fields: { mode: 1 | 2; value: number; commitment: string; tokenId?: string; spentBy?: string }
): Utxo =>
  ({
    ...buildShieldedTxOutputEntry({ mode: fields.mode, index, shieldedIndex: index }),
    txId,
    tokenId: fields.tokenId ?? '00',
    value: BigInt(fields.value),
    authorities: 0n,
    commitment: fields.commitment,
    spentBy: fields.spentBy ?? null,
  }) as unknown as Utxo;

// The wallet's outputs the wallet-service knows: the parent's shielded output
// (on-chain index 1, spent by the spending tx), and two of the spending tx's
// shielded outputs, an AmountShielded HTR one (3) and a FullShielded
// custom-token one (4). The spending tx's other shielded output (2) pays
// another wallet.
const serviceEntries: Utxo[] = [
  ownEntry(PARENT_TX_ID, 1, {
    mode: 1,
    value: 777,
    commitment: commitments.parent,
    spentBy: SPEND_TX_ID,
  }),
  ownEntry(SPEND_TX_ID, 3, { mode: 1, value: 250, commitment: commitments.ownAmount }),
  ownEntry(SPEND_TX_ID, 4, {
    mode: 2,
    value: 999,
    commitment: commitments.ownFull,
    tokenId: CUSTOM_TOKEN,
  }),
];

const transparentOutput = (value: bigint) => ({
  value,
  token_data: 0,
  script: '',
  decoded: { type: 'P2PKH', address: legacyFixtureAddress },
});

const fullShieldedOutput = (commitment: string, mode: 1 | 2 = 1) => ({
  mode,
  commitment,
  range_proof: Buffer.from(RANGE_PROOF, 'hex').toString('base64'),
  script: 'cc',
  ephemeral_pubkey: EPHEMERAL_PUBKEY,
  ...(mode === 1
    ? { token_data: 0 }
    : { asset_commitment: ASSET_COMMITMENT, surjection_proof: 'ff' }),
  decoded: { type: 'P2PKH', address: shieldedFixtureAddresses[9].spendBase58 },
});

const fullTx = (tx: Record<string, unknown>): FullNodeTxResponse =>
  ({
    success: true,
    tx: {
      nonce: '0',
      timestamp: 1,
      version: 1,
      weight: 1,
      parents: [],
      inputs: [],
      outputs: [],
      tokens: [],
      raw: '',
      ...tx,
    },
    meta: {
      hash: tx.hash,
      received_by: [],
      children: [],
      conflict_with: [],
      first_block: null,
      height: 10,
      voided_by: [],
      spent_outputs: [],
      twins: [],
      accumulated_weight: 1,
      score: 1,
    },
  }) as unknown as FullNodeTxResponse;

// Two transparent outputs, then three shielded ones (on-chain 2, 3, 4); the
// first input spends the parent's shielded output 1, the second is
// transparent. The shielded input's position (0) differs from the index of
// the output it spends (1), so an opening indexed by the latter shows.
const shieldedInput = {
  type: 'shielded',
  commitment: commitments.parent,
  // The fullnode serializes a spent shielded output's range proof in base64
  range_proof: Buffer.from(RANGE_PROOF, 'hex').toString('base64'),
  tx_id: PARENT_TX_ID,
  index: 1,
};
const spendTx = fullTx({
  hash: SPEND_TX_ID,
  inputs: [
    shieldedInput,
    {
      value: 10n,
      token_data: 0,
      script: '',
      decoded: { type: 'P2PKH', address: legacyFixtureAddress },
      tx_id: FUNDING_TX_ID,
      index: 0,
    },
  ],
  outputs: [transparentOutput(5n), transparentOutput(6n)],
  shielded_outputs: [
    fullShieldedOutput(commitments.other),
    fullShieldedOutput(commitments.ownAmount),
    fullShieldedOutput(commitments.ownFull, 2),
  ],
});

const notInWallet = () =>
  new WalletRequestError('Error requesting utxo.', {
    cause: { status: 403, data: { success: false, error: 'tx-output-not-in-wallet' } },
  });

async function setup({ shieldedKeys = true }: { shieldedKeys?: boolean } = {}) {
  const storage = new Storage(new MemoryStore());
  await storage.saveAccessData(accessData);
  const provider = makeProvider();
  storage.setShieldedCryptoProvider(provider);
  const wallet = new HathorWalletServiceWallet({
    requestPassword: jest.fn(),
    seed: shieldedFixtureSeed,
    network,
    storage,
  });
  wallet.setState('Ready');
  (wallet as unknown as { shieldedEnabled: boolean }).shieldedEnabled = shieldedKeys;
  // start() keeps the scan key in memory for the session
  storage.scanXPrivKey = shieldedKeys ? decryptData(accessData.scanMainKey!, PIN) : null;

  const fullTxSpy = jest.spyOn(wallet, 'getFullTxById').mockImplementation(async txId => {
    if (txId === SPEND_TX_ID) return spendTx;
    throw new TxNotFoundError('not found');
  });
  // The wallet-service looks one output up by position: an output of another
  // wallet is refused, a position with no output gives none
  const txOutputsSpy = jest
    .spyOn(walletApi, 'getTxOutputs')
    .mockImplementation(async (_w, options = {}) => {
      if (options.txId === SPEND_TX_ID && options.index === 2) throw notInWallet();
      return {
        success: true,
        txOutputs: serviceEntries.filter(e => e.txId === options.txId && e.index === options.index),
      };
    });
  return { wallet, storage, provider, fullTxSpy, txOutputsSpy };
}

const expectedOpenings = {
  outputs: [
    { index: 3, value: 250n, token: '00', vbf: hex('22') },
    { index: 4, value: 999n, token: CUSTOM_TOKEN, vbf: hex('33'), abf: hex('44') },
  ],
  inputs: [{ index: 0, value: 777n, token: '00', vbf: hex('11') }],
};

/** The tx_outputs lookup answering with `edit` applied to the wallet's entries. */
const serveEdited = (txOutputsSpy: jest.SpyInstance, edit: (entry: Utxo) => Utxo) =>
  txOutputsSpy.mockImplementation(async (_w, options = {}) => ({
    success: true,
    txOutputs: serviceEntries
      .filter(e => e.txId === options.txId && e.index === options.index)
      .map(edit),
  }));

describe('HathorWalletServiceWallet.getShieldedUnblindingForTx', () => {
  it("opens the wallet's own shielded outputs and the shielded inputs spending its outputs", async () => {
    const { wallet } = await setup();
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).resolves.toEqual(expectedOpenings);
  });

  it('looks up each shielded position, spent or not, and never a transparent one', async () => {
    const { wallet, txOutputsSpy } = await setup();
    await wallet.getShieldedUnblindingForTx(SPEND_TX_ID);
    const lookups = txOutputsSpy.mock.calls.map(([, options]) => options);
    expect(lookups).toEqual(
      [
        [SPEND_TX_ID, 2],
        [SPEND_TX_ID, 3],
        [SPEND_TX_ID, 4],
        [PARENT_TX_ID, 1],
      ].map(([txId, index]) => ({ txId, index, skipSpent: false, kind: 'shielded' }))
    );
  });

  it('leaves out a shielded output the wallet-service has not recovered', async () => {
    const { wallet, txOutputsSpy } = await setup();
    txOutputsSpy.mockImplementation(async (_w, options = {}) => ({
      success: true,
      txOutputs: serviceEntries
        .filter(e => e.txId === options.txId && e.index === options.index)
        .map(e => ({ ...e, recoveryState: 'pending' }) as unknown as Utxo),
    }));
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).resolves.toEqual({
      outputs: [],
      inputs: [],
    });
  });

  it('gives empty openings for a transparent-only tx, without looking up outputs', async () => {
    const { wallet, fullTxSpy, txOutputsSpy } = await setup();
    fullTxSpy.mockResolvedValue(
      fullTx({
        hash: SPEND_TX_ID,
        inputs: [
          {
            value: 10n,
            token_data: 0,
            script: '',
            decoded: { type: 'P2PKH', address: legacyFixtureAddress },
            tx_id: FUNDING_TX_ID,
            index: 0,
          },
        ],
        outputs: [transparentOutput(10n)],
      })
    );
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).resolves.toEqual({
      outputs: [],
      inputs: [],
    });
    expect(txOutputsSpy).not.toHaveBeenCalled();
  });

  it('gives empty openings for a tx the network does not know', async () => {
    const { wallet } = await setup();
    await expect(wallet.getShieldedUnblindingForTx('ee'.repeat(32))).resolves.toEqual({
      outputs: [],
      inputs: [],
    });
  });

  it('throws when the wallet did not register shielded keys in this session', async () => {
    const { wallet, fullTxSpy } = await setup({ shieldedKeys: false });
    const call = wallet.getShieldedUnblindingForTx(SPEND_TX_ID);
    await expect(call).rejects.toBeInstanceOf(ShieldedKeyError);
    await expect(call).rejects.toMatchObject({ errorCode: ErrorMessages.SHIELDED_NO_KEYS });
    expect(fullTxSpy).not.toHaveBeenCalled();
  });

  it('fails when an output does not open to the value the wallet-service reports', async () => {
    const { wallet, txOutputsSpy } = await setup();
    txOutputsSpy.mockImplementation(async (_w, options = {}) => ({
      success: true,
      txOutputs: serviceEntries
        .filter(e => e.txId === options.txId && e.index === options.index)
        .map(e => ({ ...e, value: e.value + 1n }) as Utxo),
    }));
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).rejects.toThrow(
      /does not open to the amount and token/
    );
  });

  it('fails when an output does not open to the token the wallet-service reports', async () => {
    const { wallet, txOutputsSpy } = await setup();
    // The FullShielded output rewinds to CUSTOM_TOKEN; the service says HTR
    serveEdited(txOutputsSpy, e =>
      e.txId === SPEND_TX_ID && e.index === 4 ? ({ ...e, tokenId: '00' } as Utxo) : e
    );
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).rejects.toThrow(
      /does not open to the amount and token/
    );
  });

  it("refuses to open another of the wallet's outputs the service maps to a position", async () => {
    const { wallet, txOutputsSpy } = await setup();
    // An indexing bug or a reorg leftover: position 3 answers with the row of
    // the wallet's FullShielded output, which opens fine on its own data and
    // would publish its amount, token and abf under this tx's index 3
    const ownFull = serviceEntries.find(e => e.txId === SPEND_TX_ID && e.index === 4)!;
    serveEdited(txOutputsSpy, e =>
      e.txId === SPEND_TX_ID && e.index === 3 ? ({ ...ownFull, index: 3 } as Utxo) : e
    );
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).rejects.toThrow(
      `${SPEND_TX_ID}:3 is not the one transaction ${SPEND_TX_ID} carries`
    );
  });

  it.each([
    ['commitment', SPEND_TX_ID, 3, { commitment: commitments.ownFull }],
    ['range proof', SPEND_TX_ID, 3, { rangeProof: 'ef'.repeat(32) }],
    ['ephemeral pubkey', SPEND_TX_ID, 3, { ephemeralPubkey: '03'.padEnd(66, 'b') }],
    ['asset commitment', SPEND_TX_ID, 4, { assetCommitment: '0b'.padEnd(66, 'f') }],
    ['mode', SPEND_TX_ID, 3, { mode: 2, assetCommitment: ASSET_COMMITMENT }],
    ['spent commitment', PARENT_TX_ID, 1, { commitment: commitments.ownAmount }],
    ['spent range proof', PARENT_TX_ID, 1, { rangeProof: 'ef'.repeat(32) }],
  ])(
    'refuses an output whose %s is not the one the tx carries',
    async (_field, txId, index, fields) => {
      const { wallet, txOutputsSpy } = await setup();
      serveEdited(txOutputsSpy, e =>
        e.txId === txId && e.index === index ? ({ ...e, ...fields } as unknown as Utxo) : e
      );
      await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).rejects.toThrow(
        `${txId}:${index} is not the one transaction ${SPEND_TX_ID} carries`
      );
    }
  );

  it('matches the on-chain fields regardless of hex case', async () => {
    const { wallet, txOutputsSpy } = await setup();
    serveEdited(
      txOutputsSpy,
      e =>
        ({
          ...e,
          commitment: (e as unknown as { commitment: string }).commitment.toUpperCase(),
        }) as unknown as Utxo
    );
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).resolves.toEqual(expectedOpenings);
  });

  it.each([
    ['a malformed request', 400, { success: false, error: 'invalid-payload' }],
    ['an auth failure', 401, { message: 'Unauthorized' }],
    ['a forbidden request', 403, { success: false, error: 'forbidden' }],
    ['a missing route', 404, { message: 'Not Found' }],
    ['throttling', 429, { message: 'Too Many Requests' }],
  ])('lets %s through instead of reading it as not ours', async (_case, status, data) => {
    const { wallet, txOutputsSpy } = await setup();
    const refusal = new WalletRequestError('Error requesting utxo.', { cause: { status, data } });
    txOutputsSpy.mockRejectedValue(refusal);
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).rejects.toBe(refusal);
  });

  it('lets a failed output lookup through', async () => {
    const { wallet, txOutputsSpy } = await setup();
    const outage = new WalletRequestError('Error requesting utxo.', {
      cause: { status: 502, data: {} },
    });
    txOutputsSpy.mockRejectedValue(outage);
    await expect(wallet.getShieldedUnblindingForTx(SPEND_TX_ID)).rejects.toBe(outage);
  });
});

// Shape, index, order and encoding parity: the fullnode side's blinding
// factors are written into its history and the mocked provider derives the
// wallet-service side's from the same constants, so this does not show that
// the two derive equal factors from the same on-chain data (both rewind with
// rewindShieldedOutput, which is what makes them equal)
describe('the wallet-service facade gives openings shaped and encoded as the fullnode facade', () => {
  // The fullnode facade reads the openings from its history, where decoding
  // wrote the owned-marker fields on the slots the wallet's scan key opened
  const shieldedSlot = (fields: Partial<IHistoryShieldedOutput> = {}): IHistoryShieldedOutput => ({
    mode: ShieldedOutputMode.AMOUNT_SHIELDED,
    commitment: '',
    range_proof: '',
    script: '',
    token_data: 0,
    decoded: {},
    spent_by: null,
    ...fields,
  });

  const historyTx = (fields: Partial<IHistoryTx> & Pick<IHistoryTx, 'tx_id'>): IHistoryTx => ({
    version: 1,
    weight: 1,
    timestamp: 1,
    is_voided: false,
    parents: [],
    inputs: [],
    outputs: [],
    ...fields,
  });

  const transparent = (value: bigint) => ({
    value,
    token_data: 0,
    token: '00',
    script: '',
    decoded: {},
    spent_by: null,
  });

  async function fullnodeWallet(): Promise<HathorWallet> {
    const store = new MemoryStore();
    await store.saveTx(
      historyTx({
        tx_id: PARENT_TX_ID,
        outputs: [transparent(10n)],
        shielded_outputs: [
          shieldedSlot({
            spent_by: SPEND_TX_ID,
            value: 777n,
            token: '00',
            blindingFactor: hex('11'),
          }),
        ],
      })
    );
    await store.saveTx(
      historyTx({
        tx_id: SPEND_TX_ID,
        timestamp: 2,
        tokens: [CUSTOM_TOKEN],
        inputs: [
          { tx_id: PARENT_TX_ID, index: 1, type: 'shielded' },
          { tx_id: FUNDING_TX_ID, index: 0 },
        ],
        outputs: [transparent(5n), transparent(6n)],
        shielded_outputs: [
          shieldedSlot(),
          shieldedSlot({ value: 250n, token: '00', blindingFactor: hex('22') }),
          shieldedSlot({
            mode: ShieldedOutputMode.FULLY_SHIELDED,
            token_data: undefined,
            value: 999n,
            token: CUSTOM_TOKEN,
            blindingFactor: hex('33'),
            assetBlindingFactor: hex('44'),
          }),
        ],
      })
    );
    const connection = new Connection({
      network: 'testnet',
      servers: ['http://localhost:8080/v1a/'],
      logger: getDefaultLogger(),
    });
    return new HathorWallet({ xpub: accessData.xpubkey, connection, storage: new Storage(store) });
  }

  it('returns the same entries and encodes the same payload for the same tx', async () => {
    const fullnode = await (await fullnodeWallet()).getShieldedUnblindingForTx(SPEND_TX_ID);
    const { wallet } = await setup();
    const walletService = await wallet.getShieldedUnblindingForTx(SPEND_TX_ID);

    expect(fullnode).toEqual(expectedOpenings);
    expect(walletService).toEqual(fullnode);
    expect(
      encodeShieldedUnblindingPayload(SPEND_TX_ID, walletService.outputs, walletService.inputs)
    ).toBe(encodeShieldedUnblindingPayload(SPEND_TX_ID, fullnode.outputs, fullnode.inputs));
  });
});
