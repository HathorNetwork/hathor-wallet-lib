import { AtomicSwapServiceConnection } from '../../src/swapService/swapConnection';
import { ConnectionState } from '../../src/wallet/types';
import GenericWebSocket from '../../src/websocket/index';

const atomicSwapServiceWs = 'http://localhost:3002' // mock value

let sendMessageSpy, setupSpy;

beforeAll(() => {
  sendMessageSpy = jest.spyOn(GenericWebSocket.prototype, 'sendMessage')
    .mockImplementation(jest.fn());

  setupSpy = jest.spyOn(GenericWebSocket.prototype, 'setup')
    .mockImplementation(jest.fn());
})

afterEach(() => {
  sendMessageSpy.mockClear();
  setupSpy.mockClear();
})

afterAll(() => {
  sendMessageSpy.mockRestore();
  setupSpy.mockRestore();
})

describe('start', () => {
  it('should handle a websocket failure', () => {
    const atomicConnection = new AtomicSwapServiceConnection(
      { wsURL: atomicSwapServiceWs },
    );

    // Forcing an error
    // @ts-ignore
    atomicConnection.websocket = null;

    expect(() => atomicConnection.start()).toThrow('Websocket is not initialized')
  })

  it('should have the state "connecting"', () => {
    const atomicConnection = new AtomicSwapServiceConnection(
      {
        wsURL: atomicSwapServiceWs,
        connectionTimeout: 10000,
      },
    );

    atomicConnection.start();
    expect(atomicConnection.getState()).toStrictEqual(ConnectionState.CONNECTING);
    expect(setupSpy).toHaveBeenCalled()
  })

  it('should initialize the listeners', () => {
    const atomicConnection = new AtomicSwapServiceConnection(
      { wsURL: atomicSwapServiceWs },
    );
    atomicConnection.start();

    // Testing listeners
    const proposalUpdateListener = jest.fn();
    atomicConnection.on('update-atomic-swap-proposal', proposalUpdateListener)
    atomicConnection.websocket.emit('proposal_updated', { content: 'received' });
    expect(proposalUpdateListener).toHaveBeenCalledWith({ content: 'received' });

    const pongListener = jest.fn();
    atomicConnection.on('pong', pongListener)
    atomicConnection.websocket.emit('pong', { message: 'pong' });
    expect(pongListener).toHaveBeenCalledWith({ message: 'pong' });

    const onlineListener = jest.spyOn(atomicConnection, 'onConnectionChange')
      .mockImplementation(jest.fn());
    atomicConnection.websocket.emit('is_online', { some: 'data' });
    expect(onlineListener).toHaveBeenCalledWith({ some: 'data' });

    // Although this test does not assert anything, it increases coverage
    atomicConnection.websocket.emit('connection_error', { error: 'content' });
  })
})

describe('proposal handling', () => {
  it('should send a subscribe proposal message', () => {
    const atomicConnection = new AtomicSwapServiceConnection(
      { wsURL: atomicSwapServiceWs },
    );

    atomicConnection.subscribeProposal(['abc', '123']);
    expect(sendMessageSpy).toHaveBeenCalledWith(JSON.stringify({
      type: 'subscribe_proposal',
      proposalId: 'abc'
    }));
    expect(sendMessageSpy).toHaveBeenCalledWith(JSON.stringify({
      type: 'subscribe_proposal',
      proposalId: '123'
    }));
  })

  it('should send a unsubscribe proposal message', () => {
    const atomicConnection = new AtomicSwapServiceConnection(
      { wsURL: atomicSwapServiceWs },
    );

    atomicConnection.unsubscribeProposal('123');
    expect(sendMessageSpy).toHaveBeenCalledWith(JSON.stringify({
      type: 'unsubscribe_proposal',
      proposalId: '123'
    }));
  })
})
