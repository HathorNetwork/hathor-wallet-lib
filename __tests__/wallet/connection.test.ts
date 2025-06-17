import { EventEmitter } from 'events';
import WalletConnection from '../../src/wallet/connection';
import { getDefaultLogger } from '../../src/types';

// Mock the logger to prevent console output during tests
jest.mock('../../src/types', () => {
  const mockLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
  return {
    getDefaultLogger: () => mockLogger,
  };
});

// Mock config.getWalletServiceBaseWsUrl
jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    getWalletServiceBaseWsUrl: () => 'ws://localhost:8080',
    getServerUrl: () => 'http://localhost:8080',
  },
}));

describe('WalletConnection', () => {
  let connection: WalletConnection;
  let mockWebSocket: EventEmitter & { close?: () => void };

  beforeEach(() => {
    // Create a mock websocket using EventEmitter
    mockWebSocket = new EventEmitter();
    mockWebSocket.close = jest.fn();
    // Create a new connection instance with the mock websocket
    connection = new WalletConnection({
      walletId: 'test-wallet',
      logger: getDefaultLogger(),
    });
    // @ts-expect-error - EventEmitter is not a complete WebSocket implementation
    connection.websocket = mockWebSocket;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('websocket transaction events', () => {
    const validTransaction = {
      tx_id: '00000e0e193894909fc85dad8a778a8e7904de30362f53b4839e93cc315648e6',
      nonce: 16488190,
      timestamp: 1745940424,
      version: 2,
      voided: false,
      weight: 17.43270481128759,
      parents: [
        '000000003a90c27be4093663ef1e1eb1564aa5462f282d86fc062add717b059a',
        '0000762414270482d75b7c759d1b8bc7341a884084004042fb70eafe11a01eb6',
      ],
      inputs: [
        {
          tx_id: '0000762414270482d75b7c759d1b8bc7341a884084004042fb70eafe11a01eb6',
          index: 0,
          value: 1n,
          token_data: 0,
          script: {
            type: 'Buffer' as const,
            data: [
              118, 169, 20, 107, 97, 132, 123, 120, 0, 1, 243, 13, 222, 197, 107, 73, 138, 22, 138,
              241, 2, 209, 72, 136, 172,
            ],
          },
          token: '00',
          decoded: {
            type: 'P2PKH',
            address: 'HGJuWWGgRQ2roCfcmt5MCBJZx3yMYRz8dq',
            timelock: null,
          },
        },
      ],
      outputs: [
        {
          value: 100n,
          token_data: 1,
          script: {
            type: 'Buffer' as const,
            data: [
              118, 169, 20, 69, 227, 122, 171, 130, 223, 106, 158, 121, 173, 64, 26, 133, 156, 27,
              199, 10, 82, 191, 81, 136, 172,
            ],
          },
          decodedScript: null,
          token: '00000e0e193894909fc85dad8a778a8e7904de30362f53b4839e93cc315648e6',
          locked: false,
          index: 0,
          decoded: {
            type: 'P2PKH',
            address: 'HCtfX7Pz98ihXjPKCEugFHduVeuHgSXRcy',
            timelock: null,
          },
        },
      ],
      height: 0,
      token_name: 'Test',
      token_symbol: 'TST',
      signal_bits: 0,
    };

    const invalidTransaction = {
      // Missing required fields, this remains a simple invalid object
      tx_id: '00003eeb2ce22e80e0fa72d8afb0b8b01f8919faac94cb3a3b4900782d0f399f',
    };

    test('should continue working after receiving invalid data', async () => {
      const spy = jest.fn();

      connection.on('new-tx', tx => {
        spy(tx);
        expect(tx).toEqual(validTransaction);
      });

      // Start the connection before emitting events
      connection.start(); // Ensure start is async and awaited if it returns a Promise

      // Send invalid data first
      connection.websocket?.emit('new-tx', { data: invalidTransaction });
      // Then send valid data
      connection.websocket?.emit('new-tx', { data: validTransaction });

      // Wait for events to be processed (adjust timing if needed)
      await new Promise(resolve => {
        setTimeout(resolve, 100);
      });

      // Only valid transaction should trigger the spy
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(validTransaction);
    }, 2000);
  });
});
