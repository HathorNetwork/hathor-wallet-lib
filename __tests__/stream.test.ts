import { Server, WebSocket } from 'mock-socket';
import HathorWallet from '../src/new/wallet';
import Connection from '../src/new/connection';
import { MemoryStore, Storage } from '../src/storage';
import { HistorySyncMode, WalletType, getDefaultLogger } from '../src/types';
import { JSONBigInt } from '../src/utils/bigint';
import { getGapLimitConfig } from './integration/utils/core.util';
import { StreamManager, loadP2SHAddressesCPUIntensive } from '../src/sync/stream';
import { XPubError } from '../src/errors';

const mock_tx = {
  tx_id: '00002f4c8d6516ee0c39437f30d9f20231f88652aacc263bc738f55c412cf5ee',
  signal_bits: 0,
  version: 1,
  weight: 16.8187644487092,
  timestamp: 1708302775,
  is_voided: false,
  nonce: 5406,
  inputs: [],
  outputs: [
    {
      value: 100n,
      token_data: 0,
      script: 'dqkUVTXZg887mKgf7wgS3RddNtu',
      token: '00',
      spent_by: null,
      decoded: {
        type: 'P2PKH',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        timelock: null,
        value: 100n,
        token_data: 0,
      },
    },
  ],
  parents: [
    '0000032b1e7742f147c6c8d38e71d34915a8b2367962b55cea8d7610daccec6b',
    '0002ad8d1519daaddc8e1a37b14aac0b045129c01832281fb1c02d873c7abbf9',
  ],
  tokens: [],
};

const SERVER_MOCK_TYPE = {
  /**
   * Will send 1 address and 1 tx then send an end event.
   */
  simple: 'simple',
  /**
   * Will send an address and tx then send an error.
   */
  error: 'error',
  /**
   * Will send an address and tx then not send anything.
   * This is meant to give time for the client to abort.
   */
  abort: 'abort',
  /**
   * Sends an event from the wrong stream to test how
   * the client reacts to this error.
   */
  unknownId: 'unknown_id',
};

function makeServerMock(mockServer, mockType, sendCapabilities = true) {
  function streamHistoryForSocket(streamId, socket) {
    // Begin event marks the start of a stream
    socket.send(
      JSON.stringify({
        id: streamId,
        type: 'stream:history:begin',
      })
    );
    socket.send(
      JSON.stringify({
        id: streamId,
        type: 'stream:history:address',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        index: 0,
      })
    );
    socket.send(
      JSONBigInt.stringify({
        id: streamId,
        type: 'stream:history:vertex',
        data: mock_tx,
      })
    );
    if (mockType === SERVER_MOCK_TYPE.simple) {
      socket.send(JSON.stringify({ id: streamId, type: 'stream:history:end' }));
    } else if (mockType === SERVER_MOCK_TYPE.error) {
      socket.send(JSON.stringify({ id: streamId, type: 'stream:history:error', errmsg: 'Boom!' }));
    } else if (mockType === SERVER_MOCK_TYPE.unknownId) {
      // Send an event from an unknown stream
      socket.send(
        JSON.stringify({
          id: 'unknown-stream-id',
          type: 'stream:history:address',
          address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
          index: 0,
        })
      );
      socket.send(JSON.stringify({ id: streamId, type: 'stream:history:end' }));
    }
  }

  mockServer.on('connection', socket => {
    if (sendCapabilities) {
      socket.send(JSON.stringify({ type: 'capabilities', capabilities: ['history-streaming'] }));
    }
    socket.on('message', data => {
      const jsonData = JSON.parse(data);
      if (jsonData.type === 'subscribe_address') {
        // Only for testing purposes
        socket.send(JSON.stringify({ type: 'subscribe_success', address: jsonData.address }));
      } else if (jsonData.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      } else if (jsonData.type === 'request:history:xpub') {
        // Send the addresses and history then send end of stream event
        streamHistoryForSocket(jsonData.id, socket);
      } else if (jsonData.type === 'request:history:manual') {
        // Send the addresses and history then send end of stream event
        // Only if first is true
        if (jsonData.first) {
          streamHistoryForSocket(jsonData.id, socket);
        }
      }
    });
  });
}

/**
 * Prepare a wallet for testing with a websocket server
 * @param {HistorySyncMode} mode - History sync mode for the wallet
 * @param [options] - Extra wallet options; pass `multisig` to start a P2SH (multisig) wallet
 * @returns {Promise<HathorWallet>}
 */
async function startWalletFor(
  mode,
  { multisig }: { multisig?: { pubkeys: string[]; numSignatures: number } } = {}
) {
  // Start a wallet with stream xpub history sync mode
  const seed =
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
  const store = new MemoryStore();
  const storage = new Storage(store);
  const connection = new Connection({
    connectionTimeout: 30000,
    network: 'testnet',
    servers: ['http://localhost:8080/v1a'],
    logger: getDefaultLogger(),
  });
  if (connection.websocket === null) {
    throw new Error('Invalid websocket instance');
  }
  connection.websocket.WebSocket = WebSocket;

  const walletConfig = {
    seed,
    storage,
    connection,
    password: '123',
    pinCode: '123',
    scanPolicy: getGapLimitConfig(),
    ...(multisig ? { multisig } : {}),
  };
  const hWallet = new HathorWallet(walletConfig);
  hWallet.setHistorySyncMode(mode);
  await hWallet.start();
  return hWallet;
}

describe('Websocket stream history sync', () => {
  let mockServer: Server | undefined;

  afterEach(() => {
    // Tear down the mock server after every test — even one that timed out before
    // its `finally` ran (a slow sync can trip the per-test timeout). A leaked
    // ws://…/ws/ server makes the NEXT test fail with
    // "A mock server is already listening on this url".
    mockServer?.stop();
    mockServer = undefined;
  });

  it('should stream the history with xpub stream mode', async () => {
    mockServer = new Server('ws://localhost:8080/v1a/ws/');
    makeServerMock(mockServer, SERVER_MOCK_TYPE.simple);
    const wallet = await startWalletFor(HistorySyncMode.XPUB_STREAM_WS);
    try {
      while (true) {
        if (wallet.isReady()) {
          break;
        }
        await new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      }
      // Check balance
      await expect(wallet.getBalance('00')).resolves.toEqual([
        expect.objectContaining({
          token: expect.objectContaining({ id: '00' }),
          balance: { locked: 0n, unlocked: 100n },
          transactions: 1,
        }),
      ]);
    } finally {
      // Stop wallet
      await wallet.stop({ cleanStorage: true, cleanAddresses: true });
    }
  }, 30000);

  it('should stream the history with manual stream mode', async () => {
    mockServer = new Server('ws://localhost:8080/v1a/ws/');
    makeServerMock(mockServer, SERVER_MOCK_TYPE.simple);
    const wallet = await startWalletFor(HistorySyncMode.MANUAL_STREAM_WS);
    try {
      while (true) {
        if (wallet.isReady()) {
          break;
        }
        await new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      }
      // Check balance
      await expect(wallet.getBalance('00')).resolves.toEqual([
        expect.objectContaining({
          token: expect.objectContaining({ id: '00' }),
          balance: { locked: 0n, unlocked: 100n },
          transactions: 1,
        }),
      ]);
    } finally {
      // Stop wallet
      await wallet.stop({ cleanStorage: true, cleanAddresses: true });
    }
  }, 30000);

  it('should make the wallet go in error if the stream returns an error', async () => {
    mockServer = new Server('ws://localhost:8080/v1a/ws/');
    makeServerMock(mockServer, SERVER_MOCK_TYPE.error);
    const wallet = await startWalletFor(HistorySyncMode.XPUB_STREAM_WS);
    try {
      await new Promise(resolve => {
        setTimeout(resolve, 1000);
      });
      expect(wallet.state).toBe(HathorWallet.ERROR);
    } finally {
      await wallet.stop();
    }
  }, 30000);

  it('should make the wallet go in error if the stream is aborted', async () => {
    mockServer = new Server('ws://localhost:8080/v1a/ws/');
    makeServerMock(mockServer, SERVER_MOCK_TYPE.abort);
    const wallet = await startWalletFor(HistorySyncMode.XPUB_STREAM_WS);
    try {
      // Await some time so the wallet can start the streamming.
      await new Promise(resolve => {
        setTimeout(resolve, 1000);
      });
      // Abort the stream.
      await wallet.conn.stopStream();
      // Await the stream to stop and the wallet to go into error.
      await new Promise(resolve => {
        setTimeout(resolve, 100);
      });
      expect(wallet.state).toBe(HathorWallet.ERROR);
    } finally {
      await wallet.stop();
    }
  }, 30000);

  it('should ignore unknown stream ids', async () => {
    mockServer = new Server('ws://localhost:8080/v1a/ws/');
    makeServerMock(mockServer, SERVER_MOCK_TYPE.unknownId);
    const wallet = await startWalletFor(HistorySyncMode.XPUB_STREAM_WS);
    try {
      while (true) {
        if (wallet.isReady()) {
          break;
        }
        await new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      }
      // Check balance
      await expect(wallet.getBalance('00')).resolves.toEqual([
        expect.objectContaining({
          token: expect.objectContaining({ id: '00' }),
          balance: { locked: 0n, unlocked: 100n },
          transactions: 1,
        }),
      ]);
    } finally {
      // Stop wallet
      await wallet.stop({ cleanStorage: true, cleanAddresses: true });
    }
  }, 30000);

  it('should default to POLLING_HTTP_API without capabilities', async () => {
    mockServer = new Server('ws://localhost:8080/v1a/ws/');
    makeServerMock(mockServer, SERVER_MOCK_TYPE.simple, false);
    const wallet = await startWalletFor(HistorySyncMode.MANUAL_STREAM_WS);
    wallet.conn.on('stream', data => {
      // Any stream event should fail the test
      throw new Error(`Received a stream event: ${JSON.stringify(data)}`);
    });
    wallet.on('state', state => {
      // If the sync fails, fail the test
      if (state === HathorWallet.ERROR) {
        throw new Error('Wallet reached an error state');
      }
    });
    try {
      while (true) {
        if (wallet.isReady()) {
          break;
        }
        await new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      }
    } finally {
      // Stop wallet
      await wallet.stop({ cleanStorage: true, cleanAddresses: true });
    }

    await expect(wallet.getAddressAtIndex(0)).resolves.toEqual(
      'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN'
    );
  }, 30000);
});

const MULTISIG_DATA = {
  numSignatures: 3,
  pubkeys: [
    'xpub6CvvCBtHqFfErbcW2Rv28TmZ3MqcFuWQVKGg8xDzLeAwEAHRz9LBTgSFSj7B99scSvZGbq6TxAyyATA9b6cnwsgduNs9NGKQJnEQr3PYtwK',
    'xpub6CA16g2qPwukWAWBMdJKU3p2fQEEi831W3WAs2nesuCzPhbrG29aJsoRDSEDT4Ac3smqSk51uuv6oujU3MAAL3d1Nm87q9GDwE3HRGQLjdP',
    'xpub6BwNT613Vzy7ARVHDEpoX23SMBEZQMJXdqTWYjQKvJZJVDBjEemU38exJEhc6qbFVc4MmarN68gUKHkyZ3NEgXXCbWtoXXGouHpwMEcXJLf',
    'xpub6DCyPHg4AwXsdiMh7QSTHR7afmNVwZKHBBMFUiy5aCYQNaWp68ceQXYXCGQr5fZyLAe5hiJDdXrq6w3AXzvVmjFX9F7EdM87repxJEhsmjL',
    'xpub6CgPUcCCJ9pAK7Rj52hwkxTutSRv91Fq74Hx1SjN62eg6Mp3S3YCJFPChPaDjpp9jCbCZHibBgdKnfNdq6hE9umyjyZKUCySBNF7wkoG4uK',
  ],
};

const MULTISIG_ADDRESSES = [
  'wgyUgNjqZ18uYr4YfE2ALW6tP5hd8MumH5',
  'wbe2eJdyZVimA7nJjmBQnKYJSXmpnpMKgG',
  'wQQWdSZwp2CEGKsTvvbJ7i8HfHuV2i5QVQ',
  'wfrtq9cMe1YfixVgSKXQNQ5hjsmR4hpjP6',
  'wQG7itjdtZBsNTk9TG4f1HrehyQiAEMN18',
];

describe('loadP2SHAddressesCPUIntensive', () => {
  it('derives P2SH addresses matching the polling-path fixture', () => {
    const result = loadP2SHAddressesCPUIntensive(0, 5, MULTISIG_DATA, 'testnet');
    expect(result).toEqual([
      [0, MULTISIG_ADDRESSES[0]],
      [1, MULTISIG_ADDRESSES[1]],
      [2, MULTISIG_ADDRESSES[2]],
      [3, MULTISIG_ADDRESSES[3]],
      [4, MULTISIG_ADDRESSES[4]],
    ]);
  });

  it('respects the startIndex offset and count', () => {
    const result = loadP2SHAddressesCPUIntensive(2, 2, MULTISIG_DATA, 'testnet');
    expect(result).toEqual([
      [2, MULTISIG_ADDRESSES[2]],
      [3, MULTISIG_ADDRESSES[3]],
    ]);
  });

  it('throws XPubError on invalid xpub', () => {
    expect(() =>
      loadP2SHAddressesCPUIntensive(0, 1, { pubkeys: ['not-an-xpub'], numSignatures: 1 }, 'testnet')
    ).toThrow(XPubError);
  });
});

// Multisig wallets derive P2SH per index, which is much heavier than P2PKH, so the stream uses
// a smaller batch. This must match MULTISIG_ADDRESSES_PER_MESSAGE in src/sync/stream.ts.
const MULTISIG_EXPECTED_BATCH_SIZE = 5;

describe('Websocket stream history sync for multisig', () => {
  let mockServer: Server | undefined;

  afterEach(() => {
    // See the P2PKH stream suite: afterEach guarantees teardown even when a slow
    // sync trips the per-test timeout, preventing the "already listening" cascade
    // into the next test.
    mockServer?.stop();
    mockServer = undefined;
  });

  it('should send P2SH addresses on a manual stream for a multisig wallet', async () => {
    mockServer = new Server('ws://localhost:8080/v1a/ws/');
    let capturedFirstAddress: string | undefined;
    let capturedBatchSize: number | undefined;
    mockServer.on('connection', socket => {
      socket.send(JSON.stringify({ type: 'capabilities', capabilities: ['history-streaming'] }));
      socket.on('message', data => {
        const jsonData = JSON.parse(data as string);
        if (jsonData.type === 'subscribe_address') {
          socket.send(JSON.stringify({ type: 'subscribe_success', address: jsonData.address }));
        } else if (jsonData.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        } else if (jsonData.type === 'request:history:manual' && jsonData.first) {
          // jsonData.addresses is [[index, address], ...]
          const [firstEntry] = jsonData.addresses;
          [, capturedFirstAddress] = firstEntry;
          capturedBatchSize = jsonData.addresses.length;
          const streamId = jsonData.id;
          socket.send(JSON.stringify({ id: streamId, type: 'stream:history:begin' }));
          socket.send(
            JSON.stringify({
              id: streamId,
              type: 'stream:history:address',
              address: jsonData.addresses[0][1],
              index: 0,
            })
          );
          socket.send(JSON.stringify({ id: streamId, type: 'stream:history:end' }));
        }
      });
    });

    const wallet = await startWalletFor(HistorySyncMode.MANUAL_STREAM_WS, {
      multisig: { numSignatures: 3, pubkeys: MULTISIG_DATA.pubkeys },
    });
    try {
      while (true) {
        if (wallet.isReady()) {
          break;
        }
        await new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      }
      // The first address the client derived and sent must be the multisig P2SH fixture[0].
      // (A P2SH address starts with 'w' on testnet; a P2PKH one starts with 'W'.)
      expect(capturedFirstAddress).toEqual(MULTISIG_ADDRESSES[0]);
      // The multisig stream must use the smaller P2SH batch size, not the P2PKH default of 40.
      expect(capturedBatchSize).toEqual(MULTISIG_EXPECTED_BATCH_SIZE);
      // Outcome check: the address streamed back by the fullnode must be persisted as the
      // wallet's P2SH address at index 0, matching the polling-path fixture end to end.
      await expect(wallet.getAddressAtIndex(0)).resolves.toEqual(MULTISIG_ADDRESSES[0]);
    } finally {
      await wallet.stop({ cleanStorage: true, cleanAddresses: true });
    }
  }, 30000);

  it('should reject XPUB streaming for a multisig wallet', async () => {
    const storage = new Storage(new MemoryStore());
    jest.spyOn(storage, 'getWalletType').mockResolvedValue(WalletType.MULTISIG);
    jest.spyOn(storage, 'getAccessData').mockResolvedValue({
      multisigData: { numSignatures: 3, pubkeys: MULTISIG_DATA.pubkeys },
    } as never);
    jest.spyOn(storage, 'getGapLimit').mockResolvedValue(20);

    const manager = new StreamManager(0, storage, {} as never, HistorySyncMode.XPUB_STREAM_WS);
    try {
      await expect(manager.setupStream()).rejects.toThrow(
        'XPUB streaming is not supported for multisig wallets'
      );
    } finally {
      manager.stats.clean();
    }
  });
});
