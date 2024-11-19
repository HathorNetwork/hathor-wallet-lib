import FullNodeConnection from '../new/connection';
import { IStorage, IHistoryTx, HistorySyncMode, IAddressInfo, ILogger } from '../types';
import Queue from '../models/queue';
interface IStreamItemVertex {
    seq: number;
    type: 'vertex';
    vertex: IHistoryTx;
}
interface IStreamItemAddress {
    seq: number;
    type: 'address';
    address: IAddressInfo;
}
type IStreamItem = IStreamItemAddress | IStreamItemVertex;
/**
 * Stream statistics manager.
 * Will provide insight on the rates of the stream and how the client is performing.
 */
declare class StreamStatsManager {
    recvCounter: number;
    procCounter: number;
    ackCounter: number;
    emptyCounter: number;
    inTimer?: ReturnType<typeof setTimeout>;
    outTimer?: ReturnType<typeof setTimeout>;
    qTimer?: ReturnType<typeof setTimeout>;
    logger: ILogger;
    q: Queue;
    sampleInterval: number;
    constructor(queue: Queue, logger: ILogger);
    /**
     * Perform any cleanup necessary when the queue is done processing.
     * For instance, stop the timers processing the io rates.
     */
    clean(): void;
    /**
     * Mark an ACK message sent to the fullnode.
     */
    ack(seq: number): void;
    /**
     * Mark that an item has been received by the queue.
     * This also manages the inTimer, which calculates the rate of received items.
     */
    recv(): void;
    /**
     * Mark that an item has been processed from the queue.
     * This also manages the outTimer, which calculates the rate of processed items.
     */
    proc(): void;
    /**
     * Mark that the queue processed all items ready.
     * This will onlt log once out of every 100 calls to avoid verbosity.
     */
    queueEmpty(): void;
}
/**
 * Load addresses in a CPU intensive way
 * This only contemplates P2PKH addresses for now.
 */
export declare function loadAddressesCPUIntensive(startIndex: number, count: number, xpubkey: string, networkName: string): [number, string][];
export declare function generateStreamId(): string;
export declare function xpubStreamSyncHistory(startIndex: number, _count: number, storage: IStorage, connection: FullNodeConnection, shouldProcessHistory?: boolean): Promise<void>;
export declare function manualStreamSyncHistory(startIndex: number, _count: number, storage: IStorage, connection: FullNodeConnection, shouldProcessHistory?: boolean): Promise<void>;
/**
 * The StreamManager extends the AbortController because it will be used to stop the stream.
 * The abort signal will be used to:
 * - Stop generating more addresses since the fullnode will not receive them.
 * - Stop updating the UI with events of new addresses and transactions.
 * - Stop processing new events from the fullnode.
 * - Once aborted the `stream` event listener will be removed from the connection.
 * - Resolve the promise when aborted.
 */
export declare class StreamManager extends AbortController {
    streamId: string;
    MAX_WINDOW_SIZE: number;
    ADDRESSES_PER_MESSAGE: number;
    UI_UPDATE_INTERVAL: number;
    storage: IStorage;
    connection: FullNodeConnection;
    xpubkey: string;
    gapLimit: number;
    network: string;
    lastLoadedIndex: number;
    lastReceivedIndex: number;
    canUpdateUI: boolean;
    foundAnyTx: boolean;
    mode: HistorySyncMode;
    batchQueue: Promise<void>;
    itemQueue: Queue<IStreamItem>;
    errorMessage: string | null;
    logger: ILogger;
    isProcessingQueue: boolean;
    lastAcked: number;
    lastSeenSeq: number;
    lastProcSeq: number;
    hasReceivedEndStream: boolean;
    stats: StreamStatsManager;
    /**
     * @param {number} startIndex Index to start loading addresses
     * @param {IStorage} storage The storage to load the addresses
     * @param {FullNodeConnection} connection Connection to the full node
     * @param {HistorySyncMode} mode The mode of the stream
     */
    constructor(startIndex: number, storage: IStorage, connection: FullNodeConnection, mode: HistorySyncMode);
    /**
     * Make initial preparations and lock the stream on the connection.
     */
    setupStream(): Promise<void>;
    /**
     * Abort the stream with an error.
     */
    abortWithError(error: string): void;
    /**
     * Generate the next batch of addresses to send to the fullnode.
     * The batch will generate `ADDRESSES_PER_MESSAGE` addresses and send them to the fullnode.
     * It will run again until the fullnode has `MAX_WINDOW_SIZE` addresses on its end.
     * This is calculated by the distance between the highest index we sent to the fullnode minus the highest index we received from the fullnode.
     * This is only used for manual streams.
     */
    generateNextBatch(): void;
    /**
     * This controls the ACK strategy.
     * @returns {boolean} if we should send an ack message to the server.
     */
    shouldACK(): boolean;
    /**
     * Ack the stream messages.
     */
    ack(): void;
    isQueueDone(): boolean;
    processQueue(): Promise<void>;
    addTx(seq: number, tx: IHistoryTx): void;
    addAddress(seq: number, index: number, address: string): void;
    /**
     * Send event to update UI.
     * This should be throttled to avoid flooding the UI with events.
     * The UI will be updated in intervals of at least `UI_UPDATE_INTERVAL`.
     */
    updateUI(): void;
    sendStartMessage(): void;
    endStream(seq: number): void;
    shutdown(): Promise<void>;
}
/**
 * Start a stream to sync the history of the wallet on `storage`.
 * Since there is a lot of overlap between xpub and manual modes this method was created to accomodate both.
 * @param {StreamManager} manager stream manager instance.
 * @param {boolean} shouldProcessHistory If we should process the history after loading it.
 * @returns {Promise<void>}
 */
export declare function streamSyncHistory(manager: StreamManager, shouldProcessHistory: boolean): Promise<void>;
export {};
//# sourceMappingURL=stream.d.ts.map