import HathorWallet from '../src/new/wallet';
import Connection from '../src/new/connection';
import { MemoryStore, Storage } from '../src/storage';
import { HistorySyncMode } from '../src/types';
import { Server, WebSocket } from 'mock-socket';

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
      value: 100,
      token_data: 0,
      script: 'dqkUVTXZg887mKgf7wgS3RddNtu',
      token: '00',
      spent_by: null,
      decoded: {
        type: 'P2PKH',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        timelock: null,
        value: 100,
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
};

function makeServerMock(mockServer, mockType) {
  function streamHistoryForSocket(streamId, socket) {
    socket.send(
      JSON.stringify({
        id: streamId,
        type: 'stream:history:address',
        address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
        index: 0,
      })
    );
    socket.send(
      JSON.stringify({
        id: streamId,
        type: 'stream:history:vertex',
        data: mock_tx,
      })
    );
    if (mockType === 'simple') {
      socket.send(JSON.stringify({ id: streamId, type: 'stream:history:end' }));
    } else if (mockType === 'error') {
      socket.send(JSON.stringify({ id: streamId, type: 'stream:history:error', errmsg: 'Boom!' }));
    }
  }

  mockServer.on('connection', socket => {
    socket.on('message', data => {
      let jsonData = JSON.parse(data);
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
  storage.setHistorySyncMode(mode);
  const connection = new Connection({
    connectionTimeout: 30000,
    network: 'testnet',
    servers: ['http://localhost:8080/v1a'],
  });
  connection.websocket.WebSocket = WebSocket;

  const walletConfig = {
    seed,
    storage,
    connection,
    password: '123',
    pinCode: '123',
  };
  const hWallet = new HathorWallet(walletConfig);
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
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // Check balance
      expect(wallet.getBalance('00')).resolves.toEqual([
        expect.objectContaining({
          token: expect.objectContaining({ id: '00' }),
          balance: { locked: 0, unlocked: 100 },
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
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // Check balance
      expect(wallet.getBalance('00')).resolves.toEqual([
        expect.objectContaining({
          token: expect.objectContaining({ id: '00' }),
          balance: { locked: 0, unlocked: 100 },
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
      await new Promise(resolve => setTimeout(resolve, 1000));
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
      await new Promise(resolve => setTimeout(resolve, 1000));
      await wallet.conn.stopStream();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(wallet.state).toBe(HathorWallet.ERROR);
    } finally {
      await wallet.stop();
      mockServer.stop();
    }
  }, 10000);
});
