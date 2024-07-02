import GenericWebSocket from '../../src/websocket/index';

let sendMessageSpy;
const baseWsOptions = {
  wsURL: 'http://mock-domain',
};

beforeAll(() => {
  sendMessageSpy = jest
    .spyOn(GenericWebSocket.prototype, 'sendMessage')
    .mockImplementation(jest.fn());
});

afterAll(() => {
  sendMessageSpy.mockRestore();
});

describe('getPingMessage', () => {
  it('should return the ping message', () => {
    const atomicSwapWebsocket = new GenericWebSocket(baseWsOptions);
    expect(atomicSwapWebsocket.getPingMessage()).toStrictEqual(JSON.stringify({ type: 'ping' }));
  });
});

describe('onOpen', () => {
  it('should set the websocket as online', () => {
    const atomicSwapWebsocket = new GenericWebSocket(baseWsOptions);
    const onlineListener = jest.fn();

    atomicSwapWebsocket.on('is_online', onlineListener);
    expect(onlineListener).not.toHaveBeenCalled();

    atomicSwapWebsocket.onOpen();
    expect(onlineListener).toHaveBeenCalledWith(true);
  });
});

describe('onMessage', () => {
  it('should call onPong for a pong response', () => {
    const wsInstance = new GenericWebSocket(baseWsOptions);
    const pongSpy = jest.spyOn(wsInstance, 'onPong').mockImplementation(jest.fn());

    wsInstance.onMessage({ data: JSON.stringify({ type: 'pong' }) });
    expect(pongSpy).toHaveBeenCalled();
  });

  it('should receive messages after initializing the timeoutTimer', () => {
    const wsInstance = new GenericWebSocket(baseWsOptions);

    wsInstance.sendPing();
    wsInstance.onMessage({ data: JSON.stringify({ type: 'other' }) });
  });

  it('should re-emit messages with their same type', () => {
    const wsInstance = new GenericWebSocket(baseWsOptions);
    const arbitraryListener = jest.fn();

    wsInstance.on('arbitrary', arbitraryListener);
    wsInstance.onMessage({
      data: JSON.stringify({
        type: 'arbitrary',
        other: 'content',
      }),
    });
    expect(arbitraryListener).toHaveBeenCalledWith({
      type: 'arbitrary',
      other: 'content',
    });
  });

  it('should split message types by default', () => {
    const wsInstance = new GenericWebSocket({
      ...baseWsOptions,
    });
    const arbitraryListener = jest.fn();

    wsInstance.on('arbitrary', arbitraryListener);
    wsInstance.onMessage({
      data: JSON.stringify({
        type: 'arbitrary:separated',
        other: 'content',
      }),
    });
    expect(arbitraryListener).toHaveBeenCalledWith({
      type: 'arbitrary:separated',
      other: 'content',
    });
  });

  it('should split message types when splitMessageType is true', () => {
    const wsInstance = new GenericWebSocket({
      ...baseWsOptions,
      splitMessageType: true,
    });
    const arbitraryListener = jest.fn();

    wsInstance.on('arbitrary', arbitraryListener);
    wsInstance.onMessage({
      data: JSON.stringify({
        type: 'arbitrary:separated',
        other: 'content',
      }),
    });
    expect(arbitraryListener).toHaveBeenCalledWith({
      type: 'arbitrary:separated',
      other: 'content',
    });
  });

  it('should NOT split message types when splitMessageType is false', () => {
    const wsInstance = new GenericWebSocket({
      ...baseWsOptions,
      splitMessageType: false,
    });
    const arbitraryListener = jest.fn();
    const separatedArbitraryListener = jest.fn();

    wsInstance.on('arbitrary', arbitraryListener);
    wsInstance.on('arbitrary:separated', separatedArbitraryListener);
    wsInstance.onMessage({
      data: JSON.stringify({
        type: 'arbitrary:separated',
        other: 'content',
      }),
    });
    expect(arbitraryListener).not.toHaveBeenCalled();
    expect(separatedArbitraryListener).toHaveBeenCalledWith({
      type: 'arbitrary:separated',
      other: 'content',
    });
  });
});
