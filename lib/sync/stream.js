"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.StreamManager = void 0;
exports.generateStreamId = generateStreamId;
exports.loadAddressesCPUIntensive = loadAddressesCPUIntensive;
exports.manualStreamSyncHistory = manualStreamSyncHistory;
exports.streamSyncHistory = streamSyncHistory;
exports.xpubStreamSyncHistory = xpubStreamSyncHistory;
var _bitcoreLib = require("bitcore-lib");
var _queueMicrotask = _interopRequireDefault(require("queue-microtask"));
var _types = require("../types");
var _network = _interopRequireDefault(require("../models/network"));
var _queue = _interopRequireDefault(require("../models/queue"));
var _schemas = require("../schemas");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
/* eslint max-classes-per-file: ["error", 2] */

const QUEUE_GRACEFUL_SHUTDOWN_LIMIT = 10000;
function isStreamSyncHistoryBegin(data) {
  return data.type === 'stream:history:begin';
}
function isStreamSyncHistoryVertex(data) {
  return data.type === 'stream:history:vertex';
}
function isStreamSyncHistoryAddress(data) {
  return data.type === 'stream:history:address';
}
function isStreamSyncHistoryEnd(data) {
  return data.type === 'stream:history:end';
}
function isStreamSyncHistoryError(data) {
  return data.type === 'stream:history:error';
}
function isStreamItemVertex(item) {
  return item.type === 'vertex';
}
function isStreamItemAddress(item) {
  return item.type === 'address';
}

/**
 * Stream statistics manager.
 * Will provide insight on the rates of the stream and how the client is performing.
 */
class StreamStatsManager {
  constructor(queue, logger) {
    // Counter for received events
    _defineProperty(this, "recvCounter", void 0);
    // Counter for processed events
    _defineProperty(this, "procCounter", void 0);
    // Counter for ack messages sent
    _defineProperty(this, "ackCounter", void 0);
    // Counter for the number of times the queue has been empty.
    _defineProperty(this, "emptyCounter", void 0);
    // Timer to process in_rate, which is number of received events per second.
    _defineProperty(this, "inTimer", void 0);
    // Timer to process out_rate, which is the number of processed events per second.
    _defineProperty(this, "outTimer", void 0);
    // Simple timer to log the number of events on queue.
    _defineProperty(this, "qTimer", void 0);
    // Custom logger to log in the desired format.
    _defineProperty(this, "logger", void 0);
    // Reference to the item queue we are processing.
    _defineProperty(this, "q", void 0);
    // Interval to use when calculating rates.
    _defineProperty(this, "sampleInterval", void 0);
    this.recvCounter = 0;
    this.procCounter = 0;
    this.ackCounter = 0;
    this.emptyCounter = 0;
    this.logger = logger;
    this.sampleInterval = 2000;
    this.q = queue;
    this.qTimer = setInterval(() => {
      this.logger.debug(`[*] queue_size: ${queue.size()}`);
    }, this.sampleInterval);
  }

  /**
   * Perform any cleanup necessary when the queue is done processing.
   * For instance, stop the timers processing the io rates.
   */
  clean() {
    if (this.inTimer) {
      clearTimeout(this.inTimer);
    }
    if (this.outTimer) {
      clearTimeout(this.outTimer);
    }
    if (this.qTimer) {
      clearInterval(this.qTimer);
    }
  }

  /**
   * Mark an ACK message sent to the fullnode.
   */
  ack(seq) {
    this.ackCounter += 1;
    this.logger.debug(`[*] ACKed ${seq} with queue at ${this.q.size()}. Sent ACK ${this.ackCounter} times`);
  }

  /**
   * Mark that an item has been received by the queue.
   * This also manages the inTimer, which calculates the rate of received items.
   */
  recv() {
    if (!this.inTimer) {
      this.inTimer = setTimeout(() => {
        this.logger.debug(`[+] => in_rate: ${1000 * this.recvCounter / this.sampleInterval} items/s`);
        this.inTimer = undefined;
        this.recvCounter = -1;
        this.recv();
      }, this.sampleInterval);
    }
    this.recvCounter += 1;
  }

  /**
   * Mark that an item has been processed from the queue.
   * This also manages the outTimer, which calculates the rate of processed items.
   */
  proc() {
    if (!this.outTimer) {
      this.outTimer = setTimeout(() => {
        this.logger.debug(`[+] <= out_rate: ${1000 * this.procCounter / this.sampleInterval} items/s`);
        this.outTimer = undefined;
        this.procCounter = -1;
        this.proc();
      }, this.sampleInterval);
    }
    this.procCounter += 1;
  }

  /**
   * Mark that the queue processed all items ready.
   * This will onlt log once out of every 100 calls to avoid verbosity.
   */
  queueEmpty() {
    this.emptyCounter += 1;
    if (this.emptyCounter % 100 === 0) {
      this.logger.debug(`[-] queue has been empty ${this.emptyCounter} times`);
    }
  }
}

/**
 * Load addresses in a CPU intensive way
 * This only contemplates P2PKH addresses for now.
 */
function loadAddressesCPUIntensive(startIndex, count, xpubkey, networkName) {
  const addresses = [];
  const stopIndex = startIndex + count;
  const network = new _network.default(networkName);
  const hdpubkey = new _bitcoreLib.HDPublicKey(xpubkey);
  for (let i = startIndex; i < stopIndex; i++) {
    const key = hdpubkey.deriveChild(i);
    addresses.push([i, new _bitcoreLib.Address(key.publicKey, network.bitcoreNetwork).toString()]);
  }
  return addresses;
}
function generateStreamId() {
  return Math.random().toString(36).substring(2, 15);
}
async function xpubStreamSyncHistory(startIndex, _count, storage, connection, shouldProcessHistory = false) {
  let firstIndex = startIndex;
  const scanPolicyData = await storage.getScanningPolicyData();
  if ((0, _types.isGapLimitScanPolicy)(scanPolicyData)) {
    if (startIndex !== 0) {
      const {
        lastLoadedAddressIndex
      } = await storage.getWalletData();
      firstIndex = lastLoadedAddressIndex + 1;
    }
  }
  const manager = new StreamManager(firstIndex, storage, connection, _types.HistorySyncMode.XPUB_STREAM_WS);
  await streamSyncHistory(manager, shouldProcessHistory);
}
async function manualStreamSyncHistory(startIndex, _count, storage, connection, shouldProcessHistory = false) {
  let firstIndex = startIndex;
  const scanPolicyData = await storage.getScanningPolicyData();
  if ((0, _types.isGapLimitScanPolicy)(scanPolicyData)) {
    if (startIndex !== 0) {
      const {
        lastLoadedAddressIndex
      } = await storage.getWalletData();
      firstIndex = lastLoadedAddressIndex + 1;
    }
  }
  const manager = new StreamManager(firstIndex, storage, connection, _types.HistorySyncMode.MANUAL_STREAM_WS);
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
class StreamManager extends AbortController {
  /**
   * @param {number} startIndex Index to start loading addresses
   * @param {IStorage} storage The storage to load the addresses
   * @param {FullNodeConnection} connection Connection to the full node
   * @param {HistorySyncMode} mode The mode of the stream
   */
  constructor(startIndex, storage, connection, mode) {
    super();
    _defineProperty(this, "streamId", void 0);
    _defineProperty(this, "MAX_WINDOW_SIZE", 600);
    _defineProperty(this, "ADDRESSES_PER_MESSAGE", 40);
    _defineProperty(this, "UI_UPDATE_INTERVAL", 500);
    _defineProperty(this, "storage", void 0);
    _defineProperty(this, "connection", void 0);
    _defineProperty(this, "xpubkey", void 0);
    _defineProperty(this, "gapLimit", void 0);
    _defineProperty(this, "network", void 0);
    _defineProperty(this, "lastLoadedIndex", void 0);
    _defineProperty(this, "lastReceivedIndex", void 0);
    _defineProperty(this, "canUpdateUI", void 0);
    _defineProperty(this, "foundAnyTx", void 0);
    _defineProperty(this, "mode", void 0);
    _defineProperty(this, "batchQueue", void 0);
    _defineProperty(this, "itemQueue", void 0);
    _defineProperty(this, "errorMessage", void 0);
    _defineProperty(this, "logger", void 0);
    _defineProperty(this, "isProcessingQueue", void 0);
    _defineProperty(this, "lastAcked", void 0);
    _defineProperty(this, "lastSeenSeq", void 0);
    _defineProperty(this, "lastProcSeq", void 0);
    _defineProperty(this, "hasReceivedEndStream", void 0);
    _defineProperty(this, "stats", void 0);
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
    this.lastAcked = -1;
    this.lastSeenSeq = -1;
    this.lastProcSeq = -1;
    this.hasReceivedEndStream = false;
    this.batchQueue = Promise.resolve();
    this.logger = storage.logger;
    this.itemQueue = new _queue.default();
    this.isProcessingQueue = false;
    this.stats = new StreamStatsManager(this.itemQueue, this.logger);
  }

  /**
   * Make initial preparations and lock the stream on the connection.
   */
  async setupStream() {
    if (![_types.HistorySyncMode.MANUAL_STREAM_WS, _types.HistorySyncMode.XPUB_STREAM_WS].includes(this.mode)) {
      throw new Error(`Unsupported stream mode ${this.mode}`);
    }
    const accessData = await this.storage.getAccessData();
    if (accessData === null) {
      throw new Error('No access data');
    }
    const {
      xpubkey
    } = accessData;
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
    signal.addEventListener('abort', () => {
      this.abortWithError('Stream aborted');
    }, {
      once: true,
      signal: this.signal
    });
  }

  /**
   * Abort the stream with an error.
   */
  abortWithError(error) {
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
      if (this.signal.aborted || this.hasReceivedEndStream || this.mode !== _types.HistorySyncMode.MANUAL_STREAM_WS) {
        return;
      }
      const distance = this.lastLoadedIndex - this.lastReceivedIndex;
      if (distance > this.MAX_WINDOW_SIZE - this.ADDRESSES_PER_MESSAGE) {
        return;
      }

      // This part is sync so that we block the main loop during the generation of the batch
      const batch = loadAddressesCPUIntensive(this.lastLoadedIndex + 1, this.ADDRESSES_PER_MESSAGE, this.xpubkey, this.network);
      this.lastLoadedIndex += this.ADDRESSES_PER_MESSAGE;
      this.connection.sendManualStreamingHistory(this.streamId, this.lastLoadedIndex + 1, batch, false, this.gapLimit);

      // Free main loop to run other tasks and queue next batch
      setTimeout(() => {
        this.generateNextBatch();
      }, 0);
    });
  }

  /**
   * This controls the ACK strategy.
   * @returns {boolean} if we should send an ack message to the server.
   */
  shouldACK() {
    if (!this.connection.streamWindowSize) {
      // Window size is not configured so we should not ack.
      return false;
    }
    const minSize = this.connection.streamWindowSize / 2;
    return !this.hasReceivedEndStream && !this.signal.aborted && this.lastSeenSeq - this.lastAcked > minSize && this.lastProcSeq - this.lastAcked > minSize && this.itemQueue.size() <= minSize;
  }

  /**
   * Ack the stream messages.
   */
  ack() {
    if (!this.shouldACK()) {
      return;
    }

    // Send the ACK for the end of the queue
    this.lastAcked = this.lastSeenSeq;
    this.stats.ack(this.lastSeenSeq);
    this.connection.sendStreamHistoryAck(this.streamId, this.lastSeenSeq);
  }
  isQueueDone() {
    // Must not be processing the queue and the queue must be empty
    return !(this.isProcessingQueue && this.itemQueue.size() !== 0);
  }
  async processQueue() {
    if (this.isProcessingQueue) {
      return;
    }
    this.isProcessingQueue = true;
    while (true) {
      if (this.signal.aborted) {
        // Abort processing the queue
        break;
      }
      const item = this.itemQueue.dequeue();
      this.ack();
      if (!item) {
        // Queue is empty
        this.stats.queueEmpty();
        break;
      }
      this.lastProcSeq = item.seq;
      if (isStreamItemAddress(item)) {
        const addr = item.address;
        const alreadyExists = await this.storage.isAddressMine(addr.base58);
        if (!alreadyExists) {
          await this.storage.saveAddress(addr);
        }
      } else if (isStreamItemVertex(item)) {
        await this.storage.addTx(item.vertex);
      }
      this.stats.proc();

      /**
       * This promise will resolve after the JS task queue current run.
       * This means that we will free IO tasks like receiving events from the WS
       * and other async code to run before we continue processing our event queue.
       * @see https://www.npmjs.com/package/queue-microtask
       */
      await new Promise(resolve => {
        (0, _queueMicrotask.default)(resolve);
      });
    }
    this.isProcessingQueue = false;
  }
  addTx(seq, tx) {
    this.stats.recv();
    this.foundAnyTx = true;
    this.lastSeenSeq = seq;
    this.itemQueue.enqueue({
      seq,
      vertex: tx,
      type: 'vertex'
    });
    this.processQueue();
  }
  addAddress(seq, index, address) {
    this.stats.recv();
    if (index > this.lastReceivedIndex) {
      this.lastReceivedIndex = index;
    }
    this.lastSeenSeq = seq;
    this.itemQueue.enqueue({
      seq,
      type: 'address',
      address: {
        base58: address,
        bip32AddressIndex: index
      }
    });
    this.processQueue();
  }

  /**
   * Send event to update UI.
   * This should be throttled to avoid flooding the UI with events.
   * The UI will be updated in intervals of at least `UI_UPDATE_INTERVAL`.
   */
  updateUI() {
    // Queue the UI update to run after we process the event that
    // generated this update.
    if (this.signal.aborted) {
      return;
    }
    if (this.canUpdateUI) {
      this.canUpdateUI = false;
      (async () => {
        this.connection.emit('wallet-load-partial-update', {
          addressesFound: await this.storage.store.addressCount(),
          historyLength: await this.storage.store.historyCount()
        });
      })();
      setTimeout(() => {
        this.canUpdateUI = true;
      }, this.UI_UPDATE_INTERVAL);
    }
  }
  sendStartMessage() {
    switch (this.mode) {
      case _types.HistorySyncMode.XPUB_STREAM_WS:
        this.connection.sendStartXPubStreamingHistory(this.streamId, this.lastLoadedIndex + 1, this.xpubkey, this.gapLimit);
        break;
      case _types.HistorySyncMode.MANUAL_STREAM_WS:
        this.connection.sendManualStreamingHistory(this.streamId, this.lastLoadedIndex + 1, loadAddressesCPUIntensive(this.lastLoadedIndex + 1, this.ADDRESSES_PER_MESSAGE, this.xpubkey, this.network), true, this.gapLimit);
        this.lastLoadedIndex += this.ADDRESSES_PER_MESSAGE;
        break;
      default:
        // Should never happen.
        this.abortWithError('Unknown stream mode');
        break;
    }
  }
  endStream(seq) {
    this.logger.debug('Received end-of-stream event.');
    this.hasReceivedEndStream = true;
    this.connection.sendStreamHistoryAck(this.streamId, seq);
  }
  async shutdown() {
    await this.batchQueue;
    await this.processQueue();
    if (this.isProcessingQueue) {
      let shutdownTimedout = false;
      // Limit wait period as to not wait forever
      const timer = setTimeout(() => {
        this.logger.error(`Stream shutdown reached ${QUEUE_GRACEFUL_SHUTDOWN_LIMIT}ms limit`);
        this.errorMessage = `Stream could not gracefully shutdown due to timeout.`;
        shutdownTimedout = true;
      }, QUEUE_GRACEFUL_SHUTDOWN_LIMIT);

      // Check every 0.1s
      while (this.isProcessingQueue) {
        if (shutdownTimedout) {
          break;
        }
        await new Promise(resolve => {
          setTimeout(resolve, 100);
        });
      }
      // Clear timer to avoid unnecessary error
      if (!shutdownTimedout) {
        clearTimeout(timer);
      }
    }
    this.stats.clean();
    if (this.errorMessage) {
      throw new Error(this.errorMessage);
    }
  }
}
exports.StreamManager = StreamManager;
function buildListener(manager, resolve) {
  return wsData => {
    // Early return if the stream is aborted
    // This will prevent any tx or address from being added when we want to stop the stream.
    if (manager.signal.aborted) {
      return;
    }
    // Only process the message if it is from our stream, this error should not happen.
    if (wsData.id !== manager.streamId) {
      // Check that the stream id is the same we sent
      manager.logger.error(`Received stream event for id ${wsData.id} while expecting ${manager.streamId}`);
      return;
    }
    if (isStreamSyncHistoryBegin(wsData)) {
      manager.logger.info('Begin stream event received.');
    } else if (isStreamSyncHistoryVertex(wsData)) {
      // Vertex is a transaction in the history of the last address received
      // foundAnyTx = true;
      // add to history
      const vertex = _schemas.IHistoryTxSchema.parse(wsData.data);
      manager.addTx(wsData.seq, vertex);
      manager.updateUI();
    } else if (isStreamSyncHistoryAddress(wsData)) {
      manager.addAddress(wsData.seq, wsData.index, wsData.address);
      manager.updateUI();
      manager.generateNextBatch();
    } else if (isStreamSyncHistoryEnd(wsData)) {
      // cleanup and stop the method.
      manager.endStream(wsData.seq);
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
async function streamSyncHistory(manager, shouldProcessHistory) {
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
    await new Promise(resolve => {
      // If the manager aborts we need to resolve and exit the promise.
      manager.signal.addEventListener('abort', () => {
        resolve();
      }, {
        once: true
      });
      // If it is already aborted for some reason, just exit
      if (manager.signal.aborted) {
        resolve();
      }

      // Start listening for stream events
      const listener = buildListener(manager, resolve);
      manager.connection.on('stream', listener);
      // Cleanup the listener when the manager aborts
      manager.signal.addEventListener('abort', () => {
        manager.connection.removeListener('stream', listener);
      }, {
        once: true
      });

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