/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import BaseWebSocket, { WsOptions } from '../websocket/base';
export interface WalletServiceWebSocketOptions extends WsOptions {
    walletId: string;
    joinTimeout?: number;
}
/**
 * Handles websocket connections and message transmission.
 *
 * This class extends the base websocket class and is meant to be used
 * exclusively when connecting to the Hathor Wallet Service.
 *
 * @class
 * @name WalletServiceWebSocket
 */
declare class WalletServiceWebSocket extends BaseWebSocket {
    private walletId;
    private joinTimeoutTimer;
    private joinTimeout;
    constructor(options: WalletServiceWebSocketOptions);
    /**
     * Handle message receiving from websocket
     *
     * @param {Object} evt Event that has data (evt.data) sent in the websocket
     */
    onMessage(evt: any): void;
    /**
     * Method called when websocket connection is opened
     */
    onOpen(): void;
    /**
     * Clears the join timeout timer
     */
    clearJoinTimeout(): void;
    /**
     * Called when the `join-success` event is received on the websocket connection
     */
    onJoinSuccess(): void;
    /**
     * Handler for timeouts on the `join` wallet action
     */
    onJoinTimeout(): void;
    /**
     * Sends the join action to the websocket connection to start receiving updates
     * from our wallet
     */
    joinWallet(): void;
    /**
     * Returns a JSON stringified ping message
     */
    getPingMessage(): string;
}
export default WalletServiceWebSocket;
//# sourceMappingURL=websocket.d.ts.map