/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { EventEmitter } from 'events';
import { ConnectionState } from '../wallet/types';
import GenericWebSocket from '../websocket';
import { ILogger } from '../types';
/**
 * This is a Websocket Connection with the Atomic Swap Service
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - CONNECTED: When it is connected.
 *
 * You can subscribe for the following events:
 * - update-atomic-swap-proposal: Fired when the state of a listened proposal changes
 * - state: Fired when the websocket connection state changes
 * - pong: Internal or debug use only. Fired when the health check is received from the backend
 * */
export declare class AtomicSwapServiceConnection extends EventEmitter {
    websocket: GenericWebSocket;
    protected state: ConnectionState;
    protected logger: ILogger;
    constructor(options: {
        wsURL: string;
        connectionTimeout?: number;
        logger?: ILogger;
    });
    /**
     * Connect to the server and start emitting events.
     * */
    start(): void;
    /**
     * Called when the connection to the websocket changes.
     * It is also called if the network is down.
     * */
    onConnectionChange(value: boolean): void;
    /**
     * Update class state
     *
     * @param {Number} state New state
     */
    private setState;
    getState(): ConnectionState;
    subscribeProposal(proposalsIds: string[]): void;
    unsubscribeProposal(proposalId: string): void;
}
//# sourceMappingURL=swapConnection.d.ts.map