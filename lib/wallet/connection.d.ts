/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import BaseConnection, { ConnectionParams } from '../connection';
export interface WalletServiceConnectionParams extends ConnectionParams {
    walletId: string;
}
/**
 * This is a Connection that may be shared by one or more wallets.
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - CONNECTED: When it is connected.
 *
 * You can subscribe for the following events:
 * - state: Fired when the state of the Wallet changes.
 * - wallet-update: Fired when a new wallet message arrive from the websocket.
 * */
export default class WalletServiceConnection extends BaseConnection {
    private connectionTimeout?;
    private walletId?;
    constructor(options?: WalletServiceConnectionParams);
    /**
     * Sets the walletId for the current connection instance
     * */
    setWalletId(walletId: string): void;
    /**
     * Connect to the server and start emitting events.
     * */
    start(): void;
}
//# sourceMappingURL=connection.d.ts.map