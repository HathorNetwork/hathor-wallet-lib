import AtomicSwapWebSocket from '../../src/websocket/atomic-swap';

const baseWsOptions = {
  wsURL: 'http://mock-domain'
};

beforeAll(() => {

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
})
