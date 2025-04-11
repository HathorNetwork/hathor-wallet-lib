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
      tx_id: '00003eeb2ce22e80e0fa72d8afb0b8b01f8919faac94cb3a3b4900782d0f399f',
      nonce: 123,
      timestamp: Date.now(),
      version: 1,
      weight: 1,
      parents: ['parent1', 'parent2'],
      inputs: [
        {
          address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
          timelock: null,
          type: 'P2PKH',
        },
      ],
      outputs: [
        {
          address: 'HH5As5aLtzFkcbmbXZmE65wSd22GqPWq2T',
          timelock: null,
          type: 'P2PKH',
        },
      ],
      height: 100,
      token_name: 'Test Token',
      token_symbol: 'TST',
      signal_bits: 1,
      voided: false,
    };

    const invalidTransaction = {
      // Missing required fields
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
