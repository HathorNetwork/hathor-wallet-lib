import { Server, WebSocket } from 'mock-socket';
import HathorWallet from '../src/new/wallet';
import Connection from '../src/new/connection';
import { MemoryStore, Storage } from '../src/storage';
import { HistorySyncMode, getDefaultLogger } from '../src/types';
import { JSONBigInt } from '../src/utils/bigint';

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
 * @returns {Promise<HathorWallet>}
 */
async function startWalletFor(mode) {
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
  };
  const hWallet = new HathorWallet(walletConfig);
  hWallet.setHistorySyncMode(mode);
  await hWallet.start();
  return hWallet;
}

describe('Websocket stream history sync', () => {
  it('should stream the history with xpub stream mode', async () => {
    const mockServer = new Server('ws://localhost:8080/v1a/ws/');
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
      mockServer.stop();
    }
  }, 10000);

  it('should stream the history with manual stream mode', async () => {
    const mockServer = new Server('ws://localhost:8080/v1a/ws/');
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
      mockServer.stop();
    }
  }, 30000);

  it('should make the wallet go in error if the stream returns an error', async () => {
    const mockServer = new Server('ws://localhost:8080/v1a/ws/');
    makeServerMock(mockServer, SERVER_MOCK_TYPE.error);
    const wallet = await startWalletFor(HistorySyncMode.XPUB_STREAM_WS);
    try {
      await new Promise(resolve => {
        setTimeout(resolve, 1000);
      });
      expect(wallet.state).toBe(HathorWallet.ERROR);
    } finally {
      await wallet.stop();
      mockServer.stop();
    }
  }, 10000);

  it('should make the wallet go in error if the stream is aborted', async () => {
    const mockServer = new Server('ws://localhost:8080/v1a/ws/');
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
      mockServer.stop();
    }
  }, 10000);

  it('should ignore unknown stream ids', async () => {
    const mockServer = new Server('ws://localhost:8080/v1a/ws/');
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
      mockServer.stop();
    }
  }, 10000);

  it('should default to POLLING_HTTP_API without capabilities', async () => {
    const mockServer = new Server('ws://localhost:8080/v1a/ws/');
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
      mockServer.stop();
    }

    await expect(wallet.getAddressAtIndex(0)).resolves.toEqual(
      'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN'
    );
  }, 10000);
});
