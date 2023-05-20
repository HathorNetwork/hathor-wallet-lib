import AtomicSwapWebSocket from '../../src/websocket/atomic-swap';

let sendMessageSpy;
const baseWsOptions = {
  wsURL: 'http://mock-domain'
};

beforeAll(() => {
  sendMessageSpy = jest.spyOn(AtomicSwapWebSocket.prototype, 'sendMessage')
    .mockImplementation(jest.fn());
})

afterAll(() => {
  sendMessageSpy.mockRestore();
})

describe('getPingMessage', () => {
  it('should return the ping message', () => {
    const atomicSwapWebsocket = new AtomicSwapWebSocket(baseWsOptions);
    expect(atomicSwapWebsocket.getPingMessage())
      .toStrictEqual(JSON.stringify({ type: 'ping' }));
  })
})

describe('onOpen', () => {
  it('should set the websocket as online', () => {
    const atomicSwapWebsocket = new AtomicSwapWebSocket(baseWsOptions);
    const onlineListener = jest.fn();

    atomicSwapWebsocket.on('is_online', onlineListener);
    expect(onlineListener).not.toHaveBeenCalled();

    atomicSwapWebsocket.onOpen()
    expect(onlineListener).toHaveBeenCalledWith(true)
  })
})

describe('onMessage', () => {
  it('should call onPong for a pong response', () => {
    const wsInstance = new AtomicSwapWebSocket(baseWsOptions);
    const pongSpy = jest.spyOn(wsInstance, 'onPong')
      .mockImplementation(jest.fn());

    wsInstance.onMessage({ data: JSON.stringify({ type: 'pong' }) });
    expect(pongSpy).toHaveBeenCalled();
  })

  it('should receive messages after initializing the timeoutTimer', () => {
    const wsInstance = new AtomicSwapWebSocket(baseWsOptions);

    wsInstance.sendPing();
    wsInstance.onMessage({ data: JSON.stringify({ type: 'other' }) });
  })

  it('should re-emit messages with their same type', () => {
    const wsInstance = new AtomicSwapWebSocket(baseWsOptions);
    const arbitraryListener = jest.fn();

    wsInstance.on('arbitrary', arbitraryListener);
    wsInstance.onMessage({ data: JSON.stringify({
        type: 'arbitrary',
        other: 'content',
    })});
    expect(arbitraryListener).toHaveBeenCalledWith({
      type: 'arbitrary',
      other: 'content',
    })
  })
})
