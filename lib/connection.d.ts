/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { EventEmitter } from 'events';
import GenericWebSocket from './websocket';
import WalletServiceWebSocket from './wallet/websocket';
import { ConnectionState } from './wallet/types';
import { ILogger } from './types';
export declare const DEFAULT_PARAMS: {
    network: string;
    servers: never[];
    connectionTimeout: number;
    logger: ILogger;
};
export type ConnectionParams = {
    network?: string;
    servers?: string[];
    connectionTimeout?: number;
    logger: ILogger;
};
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
declare abstract class Connection extends EventEmitter {
    protected network: string;
    websocket: GenericWebSocket | WalletServiceWebSocket | null;
    protected currentServer: string;
    protected state: ConnectionState;
    protected logger: ILogger;
    constructor(options: ConnectionParams);
    /**
     * Called when the connection to the websocket changes.
     * It is also called if the network is down.
     * */
    onConnectionChange(value: boolean): void;
    /**
     * Called when a new wallet message arrives from websocket.
     *
     * @param {Object} wsData Websocket message data
     * */
    handleWalletMessage(wsData: any): void;
    handleStreamMessage(wsData: any): void;
    /**
     * Update class state
     *
     * @param {Number} state New state
     */
    setState(state: any): void;
    /**
     * Connect to the server and start emitting events.
     * */
    abstract start(): void;
    /**
     * Close the connections and stop emitting events.
     * */
    stop(): void;
    /**
     * Call websocket endConnection
     * Needed for compatibility with old src/wallet code
     * */
    endConnection(): void;
    /**
     * Call websocket setup
     * Needed for compatibility with old src/wallet code
     * */
    setup(): void;
    /**
     * Gets current server
     */
    getCurrentServer(): string;
    /**
     * Gets current network
     */
    getCurrentNetwork(): string;
    startControlHandlers(options?: unknown): void;
    removeMetricsHandlers(): void;
    sendMessageWS(msg: string): void;
}
export default Connection;
//# sourceMappingURL=connection.d.ts.map