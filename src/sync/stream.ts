import { Address as BitcoreAddress, HDPublicKey } from 'bitcore-lib';
import FullNodeConnection from '../new/connection';
import { IStorage, IHistoryTx, HistorySyncMode, isGapLimitScanPolicy, ILogger } from '../types';
import Network from '../models/network';

interface IStreamSyncHistoryBegin {
  type: 'stream:history:begin';
  id: string;
}

interface IStreamSyncHistoryVertex {
  type: 'stream:history:vertex';
  id: string;
  data: IHistoryTx;
}

interface IStreamSyncHistoryAddress {
  type: 'stream:history:address';
  id: string;
  address: string;
  index: number;
}

interface IStreamSyncHistoryEnd {
  type: 'stream:history:end';
  id: string;
}

interface IStreamSyncHistoryError {
  type: 'stream:history:error';
  id: string;
  errmsg: string;
}

type IStreamSyncHistoryData =
  | IStreamSyncHistoryBegin
  | IStreamSyncHistoryVertex
  | IStreamSyncHistoryAddress
  | IStreamSyncHistoryEnd
  | IStreamSyncHistoryError;

function isStreamSyncHistoryBegin(data: IStreamSyncHistoryData): data is IStreamSyncHistoryBegin {
  return data.type === 'stream:history:begin';
}

function isStreamSyncHistoryVertex(data: IStreamSyncHistoryData): data is IStreamSyncHistoryVertex {
  return data.type === 'stream:history:vertex';
}

function isStreamSyncHistoryAddress(
  data: IStreamSyncHistoryData
): data is IStreamSyncHistoryAddress {
  return data.type === 'stream:history:address';
}

function isStreamSyncHistoryEnd(data: IStreamSyncHistoryData): data is IStreamSyncHistoryEnd {
  return data.type === 'stream:history:end';
}

function isStreamSyncHistoryError(data: IStreamSyncHistoryData): data is IStreamSyncHistoryError {
  return data.type === 'stream:history:error';
}

/**
 * Load addresses in a CPU intensive way
 * This only contemplates P2PKH addresses for now.
 */
export function loadAddressesCPUIntensive(
  startIndex: number,
  count: number,
  xpubkey: string,
  networkName: string
): [number, string][] {
  const addresses: [number, string][] = [];
  const stopIndex = startIndex + count;
  const network = new Network(networkName);
  const hdpubkey = new HDPublicKey(xpubkey);

  for (let i = startIndex; i < stopIndex; i++) {
    const key = hdpubkey.deriveChild(i);
    addresses.push([i, new BitcoreAddress(key.publicKey, network.bitcoreNetwork).toString()]);
  }

  return addresses;
}

export function generateStreamId() {
  return Math.random().toString(36).substring(2, 15);
}

export async function xpubStreamSyncHistory(
  startIndex: number,
  _count: number,
  storage: IStorage,
  connection: FullNodeConnection,
  shouldProcessHistory: boolean = false
) {
  let firstIndex = startIndex;
  const scanPolicyData = await storage.getScanningPolicyData();
  if (isGapLimitScanPolicy(scanPolicyData)) {
    if (startIndex !== 0) {
      const { lastLoadedAddressIndex } = await storage.getWalletData();
      firstIndex = lastLoadedAddressIndex + 1;
    }
  }

  const manager = new StreamManager(
    firstIndex,
    storage,
    connection,
    HistorySyncMode.XPUB_STREAM_WS
  );
  await streamSyncHistory(manager, shouldProcessHistory);
}

export async function manualStreamSyncHistory(
  startIndex: number,
  _count: number,
  storage: IStorage,
  connection: FullNodeConnection,
  shouldProcessHistory: boolean = false
) {
  let firstIndex = startIndex;
  const scanPolicyData = await storage.getScanningPolicyData();
  if (isGapLimitScanPolicy(scanPolicyData)) {
    if (startIndex !== 0) {
      const { lastLoadedAddressIndex } = await storage.getWalletData();
      firstIndex = lastLoadedAddressIndex + 1;
    }
  }

  const manager = new StreamManager(
    firstIndex,
    storage,
    connection,
    HistorySyncMode.MANUAL_STREAM_WS
  );
  await streamSyncHistory(manager, shouldProcessHistory);
}

/**
 * The StreamManager extends the AbortController because it will be used to stop the stream.
 * The abort signal will be used to:
 * - Stop generating more addresses since the fullnode will not receive them.
 * - Stop updating the UI with events of new addresses and transactions.
 * - Stop processing new events from the fullnode.
 * - Once aborted the `stream` event listener will be removed from the connection.
 * - Resolve the promise when aborted.
 */
export class StreamManager extends AbortController {
  streamId: string;

  MAX_WINDOW_SIZE = 600;

  ADDRESSES_PER_MESSAGE = 40;

  UI_UPDATE_INTERVAL = 500;

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

  executionQueue: Promise<void>;

  batchQueue: Promise<void>;

  errorMessage: string | null;

  logger: ILogger;

  /**
   * @param {number} startIndex Index to start loading addresses
   * @param {IStorage} storage The storage to load the addresses
   * @param {FullNodeConnection} connection Connection to the full node
   * @param {HistorySyncMode} mode The mode of the stream
   */
  constructor(
    startIndex: number,
    storage: IStorage,
    connection: FullNodeConnection,
    mode: HistorySyncMode
  ) {
    super();
    this.streamId = generateStreamId();
    this.storage = storage;
    this.connection = connection;
    this.xpubkey = '';
    this.gapLimit = 0;
    this.network = '';
    this.lastLoadedIndex = startIndex - 1;
    this.lastReceivedIndex = -1;
    this.canUpdateUI = true;
    this.mode = mode;
    this.errorMessage = null;
    this.foundAnyTx = false;

    this.executionQueue = Promise.resolve();
    this.batchQueue = Promise.resolve();
    this.logger = storage.logger;
  }

  /**
   * Make initial preparations and lock the stream on the connection.
   */
  async setupStream() {
    if (![HistorySyncMode.MANUAL_STREAM_WS, HistorySyncMode.XPUB_STREAM_WS].includes(this.mode)) {
      throw new Error(`Unsupported stream mode ${this.mode}`);
    }

    const accessData = await this.storage.getAccessData();
    if (accessData === null) {
      throw new Error('No access data');
    }
    const { xpubkey } = accessData;
    // Should not throw here since we only support gapLimit wallets
    const gapLimit = await this.storage.getGapLimit();
    this.xpubkey = xpubkey;
    this.gapLimit = gapLimit;
    this.network = this.storage.config.getNetwork().name;

    // Make sure this is the only stream running on this connection
    if (!this.connection.lockStream(this.streamId)) {
      throw new Error('There is an on-going stream on this connection');
    }

    // If the abort controller of the connection aborts we need to abort the stream
    const signal = this.connection.streamController?.signal;
    if (!signal) {
      // Should not happen, but will cleanup just in case.
      this.connection.streamEndHandler();
      throw new Error('No abort controller on connection');
    }

    signal.addEventListener(
      'abort',
      () => {
        this.abortWithError('Stream aborted');
      },
      {
        once: true,
        signal: this.signal,
      }
    );
  }

  /**
   * Abort the stream with an error.
   */
  abortWithError(error: string) {
    this.errorMessage = error;
    this.abort();
  }

  /**
   * Generate the next batch of addresses to send to the fullnode.
   * The batch will generate `ADDRESSES_PER_MESSAGE` addresses and send them to the fullnode.
   * It will run again until the fullnode has `MAX_WINDOW_SIZE` addresses on its end.
   * This is calculated by the distance between the highest index we sent to the fullnode minus the highest index we received from the fullnode.
   * This is only used for manual streams.
   */
  generateNextBatch() {
    this.batchQueue = this.batchQueue.then(async () => {
      if (this.signal.aborted || this.mode !== HistorySyncMode.MANUAL_STREAM_WS) {
        return;
      }
      const distance = this.lastLoadedIndex - this.lastReceivedIndex;
      if (distance > this.MAX_WINDOW_SIZE - this.ADDRESSES_PER_MESSAGE) {
        return;
      }

      // This part is sync so that we block the main loop during the generation of the batch
      const batch = loadAddressesCPUIntensive(
        this.lastLoadedIndex + 1,
        this.ADDRESSES_PER_MESSAGE,
        this.xpubkey,
        this.network
      );
      this.lastLoadedIndex += this.ADDRESSES_PER_MESSAGE;
      this.connection.sendManualStreamingHistory(
        this.streamId,
        this.lastLoadedIndex + 1,
        batch,
        false,
        this.gapLimit
      );

      // Free main loop to run other tasks and queue next batch
      setTimeout(() => {
        this.generateNextBatch();
      }, 0);
    });
  }

  addTx(tx: IHistoryTx) {
    this.foundAnyTx = true;
    this.executionQueue = this.executionQueue.then(async () => {
      await this.storage.addTx(tx);
    });
  }

  addAddress(index: number, address: string) {
    if (index > this.lastReceivedIndex) {
      this.lastReceivedIndex = index;
    }

    this.executionQueue = this.executionQueue.then(async () => {
      const alreadyExists = await this.storage.isAddressMine(address);
      if (!alreadyExists) {
        await this.storage.saveAddress({
          base58: address,
          bip32AddressIndex: index,
        });
      }
    });
  }

  /**
   * Send event to update UI.
   * This should be throttled to avoid flooding the UI with events.
   * The UI will be updated in intervals of at least `UI_UPDATE_INTERVAL`.
   */
  updateUI() {
    // Queue the UI update to run after we process the event that
    // generated this update.
    this.executionQueue = this.executionQueue.then(async () => {
      if (this.signal.aborted) {
        return;
      }
      if (this.canUpdateUI) {
        this.canUpdateUI = false;
        this.connection.emit('wallet-load-partial-update', {
          addressesFound: await this.storage.store.addressCount(),
          historyLength: await this.storage.store.historyCount(),
        });
        setTimeout(() => {
          this.canUpdateUI = true;
        }, this.UI_UPDATE_INTERVAL);
      }
    });
  }

  sendStartMessage() {
    switch (this.mode) {
      case HistorySyncMode.XPUB_STREAM_WS:
        this.connection.sendStartXPubStreamingHistory(
          this.streamId,
          this.lastLoadedIndex + 1,
          this.xpubkey,
          this.gapLimit
        );
        break;
      case HistorySyncMode.MANUAL_STREAM_WS:
        this.connection.sendManualStreamingHistory(
          this.streamId,
          this.lastLoadedIndex + 1,
          loadAddressesCPUIntensive(
            this.lastLoadedIndex + 1,
            this.ADDRESSES_PER_MESSAGE,
            this.xpubkey,
            this.network
          ),
          true,
          this.gapLimit
        );
        this.lastLoadedIndex += this.ADDRESSES_PER_MESSAGE;
        break;
      default:
        // Should never happen.
        this.abortWithError('Unknown stream mode');
        break;
    }
  }

  async shutdown() {
    await this.executionQueue;
    await this.batchQueue;

    if (this.errorMessage) {
      throw new Error(this.errorMessage);
    }
  }
}

function buildListener(manager: StreamManager, resolve: () => void) {
  return (wsData: IStreamSyncHistoryData) => {
    // Early return if the stream is aborted
    // This will prevent any tx or address from being added when we want to stop the stream.
    if (manager.signal.aborted) {
      return;
    }
    // Only process the message if it is from our stream, this error should not happen.
    if (wsData.id !== manager.streamId) {
      // Check that the stream id is the same we sent
      manager.logger.error(
        `Received stream event for id ${wsData.id} while expecting ${manager.streamId}`
      );
      return;
    }
    if (isStreamSyncHistoryBegin(wsData)) {
      manager.logger.info('Begin stream event received.');
    } else if (isStreamSyncHistoryVertex(wsData)) {
      // Vertex is a transaction in the history of the last address received
      // foundAnyTx = true;
      // add to history
      manager.addTx(wsData.data);
      manager.updateUI();
    } else if (isStreamSyncHistoryAddress(wsData)) {
      manager.addAddress(wsData.index, wsData.address);
      manager.updateUI();
      manager.generateNextBatch();
    } else if (isStreamSyncHistoryEnd(wsData)) {
      // cleanup and stop the method.
      resolve();
    } else if (isStreamSyncHistoryError(wsData)) {
      // An error happened on the fullnode, we should stop the stream
      manager.logger.error(`Stream error: ${wsData.errmsg}`);
      manager.abortWithError(wsData.errmsg);
    } else {
      manager.logger.error(`Unknown event type ${JSON.stringify(wsData)}`);
    }
  };
}

/**
 * Start a stream to sync the history of the wallet on `storage`.
 * Since there is a lot of overlap between xpub and manual modes this method was created to accomodate both.
 * @param {StreamManager} manager stream manager instance.
 * @param {boolean} shouldProcessHistory If we should process the history after loading it.
 * @returns {Promise<void>}
 */
export async function streamSyncHistory(
  manager: StreamManager,
  shouldProcessHistory: boolean
): Promise<void> {
  await manager.setupStream();

  // This is a try..finally so that we can always call the signal abort function
  // This is meant to prevent memory leaks
  try {
    /**
     * The promise will resolve when either:
     * - The stream is done.
     * - The stream is aborted.
     * - An error happens in the fullnode.
     */
    await new Promise<void>(resolve => {
      // If the manager aborts we need to resolve and exit the promise.
      manager.signal.addEventListener(
        'abort',
        () => {
          resolve();
        },
        { once: true }
      );
      // If it is already aborted for some reason, just exit
      if (manager.signal.aborted) {
        resolve();
      }

      // Start listening for stream events
      const listener = buildListener(manager, resolve);
      manager.connection.on('stream', listener);
      // Cleanup the listener when the manager aborts
      manager.signal.addEventListener(
        'abort',
        () => {
          manager.connection.removeListener('stream', listener);
        },
        { once: true }
      );

      // Send the start message to the fullnode
      manager.sendStartMessage();
    });

    // Graceful shutdown and cleanup.
    await manager.shutdown();

    if (manager.foundAnyTx && shouldProcessHistory) {
      await manager.storage.processHistory();
    }
  } finally {
    // Always abort on finally to avoid memory leaks
    manager.abort();
    manager.connection.emit('stream-end');
  }
}
