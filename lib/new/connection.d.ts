/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import BaseConnection, { ConnectionParams } from '../connection';
import { IStorage } from '../types';
type FullnodeCapability = 'history-streaming';
/**
 * Stream abort controller that carries the streamId it is managing.
 */
declare class StreamController extends AbortController {
    streamId: string;
    constructor(streamId: string);
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
declare class WalletConnection extends BaseConnection {
    static CLOSED: number;
    static CONNECTING: number;
    static CONNECTED: number;
    streamController: StreamController | null;
    streamWindowSize: number | undefined;
    capabilities?: FullnodeCapability[];
    constructor(options: ConnectionParams & {
        streamWindowSize?: number;
    });
    /**
     * Connect to the server and start emitting events.
     * */
    start(): void;
    /**
     * Handle the capabilities event from the websocket.
     */
    handleCapabilities(data: {
        type: string;
        capabilities: FullnodeCapability[];
    }): void;
    /**
     * If the fullnode has not sent the capabilities yet wait a while.
     */
    waitCapabilities(): Promise<void>;
    /**
     * Check if the connected fullnode has the desired capability.
     * Will return false if the fullnode has not yet sent the capability list.
     */
    hasCapability(flag: FullnodeCapability): Promise<boolean>;
    startControlHandlers(storage: IStorage): void;
    subscribeAddresses(addresses: string[]): void;
    unsubscribeAddress(address: string): void;
    addMetricsHandlers(storage: IStorage): void;
    streamEndHandler(): void;
    lockStream(streamId: string): boolean;
    sendStartXPubStreamingHistory(id: string, firstIndex: number, xpubkey: string, gapLimit?: number): void;
    sendManualStreamingHistory(id: string, firstIndex: number, addresses: [number, string][], first: boolean, gapLimit?: number): void;
    /**
     * Send an ACK message to the fullnode to confirm we received all events up to
     * the event of sequence number `ack`.
     */
    sendStreamHistoryAck(id: string, ack: number): void;
    stopStream(): Promise<void>;
    /**
     * Handle cleanup in cases of wallet reloads.
     */
    onReload(): Promise<void>;
}
export default WalletConnection;
//# sourceMappingURL=connection.d.ts.map