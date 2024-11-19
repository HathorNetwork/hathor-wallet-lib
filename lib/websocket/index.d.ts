/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import BaseWebSocket, { WsOptions } from './base';
/**
 * Handles websocket connections and message transmission
 *
 * This class extends the base websocket class and is currently used by:
 * - the default wallet (using the "old" facade) for wallets that haven't migrated to the Wallet Service yet.
 * - the Atomic Swap Service event listeners
 *
 * @class
 * @name GenericWebSocket
 */
declare class GenericWebSocket extends BaseWebSocket {
    private readonly splitMessageType;
    constructor(options: WsOptions & {
        splitMessageType?: boolean;
    });
    /**
     * Handle message receiving from websocket
     *
     * @param {Object} evt Event that has data (evt.data) sent in the websocket
     */
    onMessage(evt: any): void;
    /**
     * Returns a JSON stringified ping message
     */
    getPingMessage(): string;
    /**
     * Extend onOpen to consider online as soon as the websocket connection is open
     */
    onOpen(): void;
}
export default GenericWebSocket;
//# sourceMappingURL=index.d.ts.map