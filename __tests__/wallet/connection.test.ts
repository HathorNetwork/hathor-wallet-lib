import { DummyWalletServiceConnection } from "../../src/wallet/connection";

describe('DummyWalletServiceConnection', () => {

  it('should throw error when call start and walletId is not set', () => {
    const connection = new DummyWalletServiceConnection({ walletId: undefined });
    expect(() => connection.start()).toThrowError('Wallet id should be set before connection start.');
  });

  it('should stop connection even if was not started', () => {
    const connection = new DummyWalletServiceConnection();
    expect(() => connection.stop()).not.toThrow();
    expect(connection.isStateClosed()).toBeTruthy();
  });

  it('should change state on onConnectionChange', () => {
    const connection = new DummyWalletServiceConnection();
    expect(() => connection.onConnectionChange(true)).not.toThrow();
    expect(connection.isStateConnected()).toBeTruthy();

    expect(() => connection.onConnectionChange(false)).not.toThrow();
    expect(connection.isStateConnecting()).toBeTruthy();
  });

  it('should return current server and network', () => {
    const connection = new DummyWalletServiceConnection();
    expect(connection.getCurrentServer()).toEqual('http://localhost:8080/');
    expect(connection.getCurrentNetwork()).toEqual('testnet');
  });

  // test setWalletId
  it('should set walletId', () => {
    const connection = new DummyWalletServiceConnection();
    expect(connection.walletId).toEqual('dummy-wallet');

    expect(() => connection.setWalletId('walletId')).not.toThrow();
    expect(connection.walletId).toEqual('walletId');
  });
});
