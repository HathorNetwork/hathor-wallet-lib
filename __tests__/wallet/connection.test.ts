import { DummyWalletServiceConnection } from "../../src/wallet/connection";
import { ConnectionState } from "../../src/wallet/types";

class DummyConnectionUnderTest extends DummyWalletServiceConnection {
  constructor(options?: any) {
    super(options);
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

  it('should do nothing on setState call', () => {
    const connection = new DummyConnectionUnderTest();
    expect(() => connection.setState(ConnectionState.CONNECTED)).not.toThrow();

    expect(connection.getState()).toStrictEqual(ConnectionState.CLOSED);
  });

  it('should return dummy current server and network', () => {
    const connection = new DummyConnectionUnderTest({ network: 'testnet', walletId: 'walletId' });
    expect(connection.getCurrentServer()).toEqual('dummy-server');
    expect(connection.getCurrentNetwork()).toEqual('dummy-network');
  });

  // test setWalletId
  it('should do nothing on setWalletId call', () => {
    const connection = new DummyConnectionUnderTest();
    expect(connection.walletId).toEqual('dummy-wallet');

    expect(() => connection.setWalletId('walletId')).not.toThrow();
    expect(connection.walletId).toEqual('dummy-wallet');
  });
});
