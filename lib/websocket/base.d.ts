/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { EventEmitter } from 'events';
import _WebSocket from 'isomorphic-ws';
import { ILogger } from '../types';
export declare const DEFAULT_WS_OPTIONS: {
    wsURL: string;
    heartbeatInterval: number;
    connectionTimeout: number;
    retryConnectionInterval: number;
    openConnectionTimeout: number;
    logger: ILogger;
};
export type WsOptions = {
    wsURL?: string;
    heartbeatInterval?: number;
    connectionTimeout?: number;
    retryConnectionInterval?: number;
    openConnectionTimeout?: number;
    logger: ILogger;
};
/**
 * Handles websocket connections and message transmission
 *
 * @class
 * @name WS
 */
declare abstract class BaseWebSocket extends EventEmitter {
    WebSocket: _WebSocket;
    private ws;
    private wsURL;
    private started;
    private connected;
    private isOnline;
    private heartbeatInterval;
    private retryConnectionInterval;
    private openConnectionTimeout;
    private connectedDate;
    private latestSetupDate;
    private latestRTT;
    private heartbeat;
    protected latestPingDate: Date | null;
    protected timeoutTimer: ReturnType<typeof setTimeout> | null;
    protected setupTimer: ReturnType<typeof setTimeout> | null;
    protected connectionTimeout: number;
    protected logger: ILogger;
    constructor(options: WsOptions);
    /**
     * Return websocket url to connect to.
     * */
    getWSServerURL(): string;
    /**
     * Start websocket object and its methods
     */
    setup(): void;
    /**
     * Sets all event listeners to noops on the WebSocket instance
     * and close it.
     * */
    closeWs(): void;
    /**
     * Return connection uptime in seconds (or null if not connected).
     * */
    uptime(): number | null;
    onPong(): void;
    /**
     * Handle message receiving from websocket
     */
    abstract onMessage(evt: any): any;
    /**
     * Method called when websocket connection is opened
     */
    onOpen(): void;
    /**
     * Removes all listeners, ends the connection and removes the setup reconnection timer
     */
    close(): void;
    /**
     * Clears the reconnection timer if it exists
     */
    clearSetupTimer(): void;
    /**
     * Clears the pong timeout timer if it exists
     */
    clearPongTimeoutTimer(): void;
    /**
     * Method called when websocket connection is closed
     */
    onClose(): void;
    /**
     * Method called when an error happend on websocket
     */
    onError(evt: any): void;
    /**
     * Method called to send a message to the server
     */
    sendMessage(msg: string): void;
    /**
     * Should return a stringified ping message
     */
    abstract getPingMessage(): string;
    /**
     * Ping method to check if server is still alive
     */
    sendPing(): void;
    /**
     * Event received when the websocket connection is down.
     */
    onConnectionDown(): void;
    /**
     * Method called to end a websocket connection
     */
    endConnection(): void;
    /**
     * Set if websocket is online
     */
    setIsOnline(value: boolean): void;
}
export default BaseWebSocket;
//# sourceMappingURL=base.d.ts.map