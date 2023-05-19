import { AtomicSwapServiceConnection } from '../../src/new/swapConnection';
import { ConnectionState } from '../../src/wallet/types';

const network = 'testnet';
const atomicSwapServiceWs = 'http://localhost:3002' // mock value

describe('start', () => {
  it('should handle a websocket failure', () => {
    const atomicConnection = new AtomicSwapServiceConnection(
      { network },
      atomicSwapServiceWs,
    );

    // Forcing an error
    // @ts-ignore
    atomicConnection.websocket = null;

    expect(() => atomicConnection.start()).toThrow('Websocket is not initialized')
  })

  it('should have the state "connecting"', () => {
    const atomicConnection = new AtomicSwapServiceConnection(
      { network },
      atomicSwapServiceWs,
    );

    // Mocking the actual connection
    const setupSpy = jest.spyOn(atomicConnection.websocket, 'setup')
      .mockImplementation(jest.fn());

    atomicConnection.start();
    expect(atomicConnection.getState()).toStrictEqual(ConnectionState.CONNECTING);
    expect(setupSpy).toHaveBeenCalled()
  })

  it('should initialize the listeners', () => {
    const atomicConnection = new AtomicSwapServiceConnection(
      { network },
      atomicSwapServiceWs,
    );

    // Mocking the actual connection
    const setupSpy = jest.spyOn(atomicConnection.websocket, 'setup')
      .mockImplementation(jest.fn());
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
  })
})
