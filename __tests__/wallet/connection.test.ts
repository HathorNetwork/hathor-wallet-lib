import { DummyWalletServiceConnection } from "../../src/wallet/connection";
import { ConnectionState } from "../../src/wallet/types";

class DummyConnectionUnderTest extends DummyWalletServiceConnection {
  constructor() {
    super();
  }

  public getState(): ConnectionState {
    return this.state;
  }
}

describe('DummyWalletServiceConnection', () => {

  it('should do nothing on start call', () => {
    const connection = new DummyConnectionUnderTest({ walletId: undefined });
    expect(() => connection.start()).not.toThrow();
  });

  it('should do nothing on stop call', () => {
    const connection = new DummyConnectionUnderTest();
    expect(() => connection.stop()).not.toThrow();
  });

  it('should do nothing on endConnection call', () => {
    const connection = new DummyConnectionUnderTest();
    expect(() => connection.endConnection()).not.toThrow();
  });

  it('should do nothing on setup call', () => {
    const connection = new DummyConnectionUnderTest();
    expect(() => connection.setup()).not.toThrow();
  });

  it('should do nothing on handleWalletMessage call', () => {
    const connection = new DummyConnectionUnderTest();
    expect(() => connection.handleWalletMessage(null)).not.toThrow();
  });

  it('should do nothing on onConnectionChange call', () => {
    const connection = new DummyConnectionUnderTest();
    expect(() => connection.onConnectionChange(true)).not.toThrow();
  });

  it('should change state when setState is called', () => {
    const connection = new DummyConnectionUnderTest();
    expect(() => connection.setState(ConnectionState.CONNECTED)).not.toThrow();

    expect(connection.getState()).toStrictEqual(ConnectionState.CONNECTED);
  });

  it('should return current server and network', () => {
    const connection = new DummyConnectionUnderTest({ network: 'testnet', walletId: 'walletId' });
    expect(connection.getCurrentServer()).toEqual('http://localhost:8080/');
    expect(connection.getCurrentNetwork()).toEqual('testnet');
  });

  // test setWalletId
  it('should set walletId', () => {
    const connection = new DummyConnectionUnderTest();
    expect(connection.walletId).toEqual('dummy-wallet');

    expect(() => connection.setWalletId('walletId')).not.toThrow();
    expect(connection.walletId).toEqual('walletId');
  });
});
