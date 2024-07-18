import { Address as BitcoreAddress, HDPublicKey } from 'bitcore-lib';
import FullNodeConnection from '../new/connection';
import { IStorage, IHistoryTx, HistorySyncMode, isGapLimitScanPolicy } from '../types';
import Network from '../models/network';

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
  | IStreamSyncHistoryVertex
  | IStreamSyncHistoryAddress
  | IStreamSyncHistoryEnd
  | IStreamSyncHistoryError;

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
  await streamSyncHistory(
    firstIndex,
    storage,
    connection,
    shouldProcessHistory,
    HistorySyncMode.XPUB_STREAM_WS
  );
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
  await streamSyncHistory(
    firstIndex,
    storage,
    connection,
    shouldProcessHistory,
    HistorySyncMode.MANUAL_STREAM_WS
  );
}

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

  constructor(
    startIndex: number,
    xpubkey: string,
    gapLimit: number,
    storage: IStorage,
    connection: FullNodeConnection,
    mode: HistorySyncMode,
  ) {
    super();
    this.streamId = generateStreamId();
    this.storage = storage;
    this.connection = connection;
    this.xpubkey = xpubkey;
    this.gapLimit = gapLimit;
    this.network = storage.config.getNetwork().name;
    this.lastLoadedIndex = startIndex - 1;
    this.lastReceivedIndex = -1;
    this.canUpdateUI = true;
    this.mode = mode;
    this.errorMessage = null;
    this.foundAnyTx = false;

    this.executionQueue = Promise.resolve();
    this.batchQueue = Promise.resolve();
  }

  setupStream() {
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
  };

  sendStartMessage() {
    switch (this.mode) {
      case HistorySyncMode.XPUB_STREAM_WS:
        this.connection.sendStartXPubStreamingHistory(this.streamId, this.lastLoadedIndex + 1, this.xpubkey, this.gapLimit);
        break;
      case HistorySyncMode.MANUAL_STREAM_WS:
        this.connection.sendManualStreamingHistory(
          this.streamId,
          this.lastLoadedIndex + 1,
          loadAddressesCPUIntensive(this.lastLoadedIndex + 1, this.ADDRESSES_PER_MESSAGE, this.xpubkey, this.network),
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
      console.log(`Wrong stream ${JSON.stringify(wsData)}`);
      return;
    }
    // Vertex is a transaction in the history of the last address received
    if (isStreamSyncHistoryVertex(wsData)) {
      // foundAnyTx = true;
      // add to history
      manager.addTx(wsData.data);
      manager.updateUI();
    }
    if (isStreamSyncHistoryAddress(wsData)) {
      manager.addAddress(wsData.index, wsData.address);
      manager.updateUI();
      manager.generateNextBatch();
    }
    if (isStreamSyncHistoryEnd(wsData)) {
      // cleanup and stop the method.
      resolve();
    }
    // An error happened on the fullnode, we should stop the stream
    if (isStreamSyncHistoryError(wsData)) {
      console.error(`Stream error: ${wsData.errmsg}`);
      manager.abortWithError(wsData.errmsg);
    }
  };
}

/**
 * Start a stream to sync the history of the wallet on `storage`.
 * Since there is a lot of overlap between xpub and manual modes this method was created to accomodate both.
 * @param {number} startIndex Index to start loading addresses
 * @param {IStorage} storage The storage to load the addresses
 * @param {FullNodeConnection} connection Connection to the full node
 * @param {boolean} shouldProcessHistory If we should process the history after loading it.
 * @param {HistorySyncMode} mode The mode of the stream
 * @returns {Promise<void>}
 */
export async function streamSyncHistory(
  startIndex: number,
  storage: IStorage,
  connection: FullNodeConnection,
  shouldProcessHistory: boolean,
  mode: HistorySyncMode
): Promise<void> {
  if (![HistorySyncMode.MANUAL_STREAM_WS, HistorySyncMode.XPUB_STREAM_WS].includes(mode)) {
    throw new Error(`Unsupported stream mode ${mode}`);
  }

  const accessData = await storage.getAccessData();
  if (accessData === null) {
    throw new Error('No access data');
  }
  const { xpubkey } = accessData;
  // Should not throw here since we only support gapLimit wallets
  const gapLimit = await storage.getGapLimit();

  /**
   * The abort controller will be used to stop the stream.
   * The signal will be used to:
   * - Stop generating more addresses since the fullnode will not receive them.
   * - Stop updating the UI with events of new addresses and transactions.
   * - Stop processing new events from the fullnode.
   * - Once aborted the `stream` event listener will be removed from the connection.
   * - Resolve the promise when aborted.
   *
   * It will NOT be used to stop processing addresses and transactions, the `executionQueue` will not stop when abort is called.
   * This ensures the abort can be called and no received txs will be lost.
   */
  const manager = new StreamManager(
    startIndex,
    xpubkey,
    gapLimit,
    storage,
    connection,
    mode,
  );
  manager.setupStream();

  // This is a try..finally so that we can always call the signal abort function
  // This is meant to prevent memory leaks
  try {
    /**
     * The promise will resolve when
     * - The stream is done.
     * - The stream is aborted.
     * - An error happens in the fullnode.
     */
    await new Promise<void>(resolve => {

      // If the controller aborts we need to resolve and exit the promise.
      manager.signal.addEventListener('abort', () => {resolve();}, { once: true });
      // If it is already aborted for some reason, just exit
      if (manager.signal.aborted) {
        resolve();
      }

      const listener = buildListener(manager, resolve);
      connection.on('stream', listener);
      manager.signal.addEventListener(
        'abort',
        () => {
          connection.removeListener('stream', listener);
        },
        { once: true }
      );

      manager.sendStartMessage();
    });

    await manager.shutdown();

    if (manager.foundAnyTx && shouldProcessHistory) {
      await storage.processHistory();
    }
  } finally {
    // Always abort on finally to avoid memory leaks
    manager.abort();
    connection.emit('stream-end');
  }
}
