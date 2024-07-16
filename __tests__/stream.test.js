import HathorWallet from '../src/new/wallet';
import Connection from '../src/new/connection';
import { MemoryStore, Storage } from '../src/storage';
import { HistorySyncMode } from '../src/types';
import { Server, WebSocket } from 'mock-socket';

const mock_tx = {
  "tx_id": "00002f4c8d6516ee0c39437f30d9f20231f88652aacc263bc738f55c412cf5ee",
  "signal_bits": 0, // ???
  "version": 1,
  "weight": 16.8187644487092,
  "timestamp": 1708302775,
  "is_voided": false,
  "nonce": 5406, // was string?
  "inputs": [],
  "outputs": [
    {
      "value": 100,
      "token_data": 0,
      "script": "dqkUVTXZg887mKgf7wgS3RddNtu",
      "token": "00",
      "spent_by": null,
      "decoded": {
        "type": "P2PKH",
        "address": "WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp",
        "timelock": null,
        "value": 100,
        "token_data": 0
      }
    }
  ],
  "parents": [
    '0000032b1e7742f147c6c8d38e71d34915a8b2367962b55cea8d7610daccec6b',
    '0002ad8d1519daaddc8e1a37b14aac0b045129c01832281fb1c02d873c7abbf9',
  ],
  "tokens": [],
};

function streamHistoryForSocket(streamId, socket) {
  socket.send(JSON.stringify({
    id: streamId,
    type: 'stream:history:address',
    address: 'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
    index: 0,
  }));
  socket.send(JSON.stringify({
    id: streamId,
    type: 'stream:history:vertex',
    data: mock_tx,
  }));
  // End
  socket.send(JSON.stringify({ id: streamId, type: 'stream:history:end' }));
}

function prepareMockServer(mockServer) {
  mockServer.on('connection', socket => {
    socket.on('message', data => {
      let jsonData = JSON.parse(data);
      if (jsonData.type === 'subscribe_address') {
        // Only for testing purposes
        socket.send(JSON.stringify({'type': 'subscribe_success', 'address': jsonData.address}));
      } else if (jsonData.type === 'ping') {
        socket.send(JSON.stringify({'type': 'pong'}));
      } else if (jsonData.type === 'request:history:xpub') {
        // Send the addresses and history then send end of stream event
        streamHistoryForSocket(jsonData.id, socket);
      } else if (jsonData.type === 'request:history:manual') {
        console.log(`history:manual event ${data}`);
        // Send the addresses and history then send end of stream event
        // Only if first is true
        if (jsonData.first) {
          streamHistoryForSocket(jsonData.id, socket);
        }
      }
    });
  });
}

async function testHistorySyncStream(mode) {
  const mockServer = new Server('ws://localhost:8080/v1a/ws/');
  prepareMockServer(mockServer);
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
  while (true) {
    if (hWallet.isReady()) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Check balance
  expect(hWallet.getBalance('00')).resolves.toEqual([expect.objectContaining({
    token: expect.objectContaining({ id: '00' }),
    balance: { locked: 0, unlocked: 100 },
    transactions: 1,
  })]);
  // Stop wallet
  await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  mockServer.stop();
}

test('xpub stream history sync', async () => {
  await testHistorySyncStream(HistorySyncMode.STREAM_XPUB);
});

test('manual stream history sync', async () => {
  await testHistorySyncStream(HistorySyncMode.STREAM_MANUAL);
});
