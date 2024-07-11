import { Address as BitcoreAddress, HDPublicKey } from 'bitcore-lib';
import FullnodeConnection from '../new/connection';
import { IStorage, IHistoryTx, HistorySyncMode } from '../types';
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
  count: number,
  storage: IStorage,
  connection: FullnodeConnection,
  shouldProcessHistory: boolean = false
) {
  await streamSyncHistory(
    startIndex,
    count,
    storage,
    connection,
    shouldProcessHistory,
    HistorySyncMode.STREAM_XPUB
  );
}

export async function manualStreamSyncHistory(
  startIndex: number,
  count: number,
  storage: IStorage,
  connection: FullnodeConnection,
  shouldProcessHistory: boolean = false
) {
  await streamSyncHistory(
    startIndex,
    count,
    storage,
    connection,
    shouldProcessHistory,
    HistorySyncMode.STREAM_MANUAL
  );
}

/**
 * Start a stream to sync the history of the wallet on `storage`.
 * Since there is a lot of overlap between xpub and manual modes this method was created to accomodate both.
 * @param {number} startIndex Index to start loading addresses
 * @param {number} _count Number of addresses to load
 * @param {IStorage} storage The storage to load the addresses
 * @param {FullnodeConnection} connection Connection to the full node
 * @param {boolean} shouldProcessHistory If we should process the history after loading it.
 * @param {HistorySyncMode} mode The mode of the stream
 * @returns {Promise<void>}
 */
export async function streamSyncHistory(
  startIndex: number,
  _count: number,
  storage: IStorage,
  connection: FullnodeConnection,
  shouldProcessHistory: boolean,
  mode: HistorySyncMode
): Promise<void> {
  const MAX_WINDOW_SIZE = 600;
  const ADDRESSES_PER_MESSAGE = 40;
  const UI_UPDATE_INTERVAL = 500;

  if (![HistorySyncMode.STREAM_MANUAL, HistorySyncMode.STREAM_XPUB].includes(mode)) {
    throw new Error(`Unsupported stream mode ${mode}`);
  }

  // Make sure this is the only stream running on this connection
  const streamId = generateStreamId();
  if (!connection.lockStream(streamId)) {
    throw new Error('There is an on-going stream on this connection');
  }

  let batchGenerationPromise = Promise.resolve();
  let executionQueue = Promise.resolve();
  let errorMessage: string | null = null;

  // If the abort controller of the connection aborts we need to abort the stream
  const signal = connection.streamAbortController?.signal;
  if (!signal) {
    // Should not happen, but will cleanup just in case.
    connection.streamEndHandler();
    throw new Error('No abort controller on connection');
  }
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
  const abortController = new AbortController();
  signal.addEventListener(
    'abort',
    () => {
      errorMessage = 'Stream aborted';
      abortController.abort();
    },
    {
      once: true,
      signal: abortController.signal,
    }
  );

  // This is a try..finally so that we can always call the signal abort function
  // This is meant to prevent memory leaks
  try {
    const accessData = await storage.getAccessData();
    if (accessData === null) {
      throw new Error('No access data');
    }

    let foundAnyTx = false;

    /**
     * The promise will resolve when
     * - The stream is done.
     * - The stream is aborted.
     * - An error happens in the fullnode.
     */
    await new Promise<void>(resolve => {
      const { xpubkey } = accessData;
      const network = storage.config.getNetwork().name;
      let lastLoadedIndex = startIndex + ADDRESSES_PER_MESSAGE - 1;
      let lastReceivedIndex = -1;
      let canUpdateUI = true;

      // If the controller aborts we need to resolve and exit the promise.
      abortController.signal.addEventListener(
        'abort',
        () => {
          resolve();
        },
        { once: true }
      );
      // If it is already aborted for some reason, just exit
      if (abortController.signal.aborted) {
        resolve();
      }

      /**
       * Generate the next batch of addresses to send to the fullnode.
       * The batch will generate `ADDRESSES_PER_MESSAGE` addresses and send them to the fullnode.
       * It will run again until the fullnode has `MAX_WINDOW_SIZE` addresses on its end.
       * This is calculated by the distance between the highest index we sent to the fullnode minus the highest index we received from the fullnode.
       * This is only used for manual streams.
       */
      async function generateNextBatch(): Promise<void> {
        if (abortController.signal.aborted || mode !== HistorySyncMode.STREAM_MANUAL) {
          return;
        }
        const distance = lastLoadedIndex - lastReceivedIndex;
        if (distance > MAX_WINDOW_SIZE - ADDRESSES_PER_MESSAGE) {
          return;
        }

        // This part is sync so that we block the main loop during the generation of the batch
        const batch = loadAddressesCPUIntensive(
          lastLoadedIndex + 1,
          ADDRESSES_PER_MESSAGE,
          xpubkey,
          network
        );
        lastLoadedIndex += ADDRESSES_PER_MESSAGE;
        connection.sendManualStreamingHistory(streamId, batch, false);

        // Free main loop to run other tasks and queue next batch
        setTimeout(() => {
          batchGenerationPromise = batchGenerationPromise.then(async () => {
            await generateNextBatch();
          });
        }, 0);
      }

      /**
       * Send event to update UI.
       * This should be throttled to avoid flooding the UI with events.
       * The UI will be updated in intervals of at least `UI_UPDATE_INTERVAL`.
       */
      const updateUI = async () => {
        if (abortController.signal.aborted) {
          return;
        }
        if (canUpdateUI) {
          canUpdateUI = false;
          connection.emit('wallet-load-partial-update', {
            addressesFound: await storage.store.addressCount(),
            historyLength: await storage.store.historyCount(),
          });
          setTimeout(() => {
            canUpdateUI = true;
          }, UI_UPDATE_INTERVAL);
        }
      };

      // This listener will handle all the messages coming from the fullnode.
      const listener = (wsData: IStreamSyncHistoryData) => {
        // Early return if the stream is aborted
        // This will prevent any tx or address from being added when we want to stop the stream.
        if (abortController.signal.aborted) {
          return;
        }
        // Only process the message if it is from our stream, this error should not happen.
        if (wsData.id !== streamId) {
          // Check that the stream id is the same we sent
          console.log(`Wrong stream ${JSON.stringify(wsData)}`);
          return;
        }
        // Vertex is a transaction in the history of the last address received
        if (isStreamSyncHistoryVertex(wsData)) {
          foundAnyTx = true;
          // add to history
          executionQueue = executionQueue.then(async () => {
            await storage.addTx(wsData.data);
            await updateUI();
          });
        }
        if (isStreamSyncHistoryAddress(wsData)) {
          if (wsData.index > lastReceivedIndex) {
            lastReceivedIndex = wsData.index;
          }
          // Register address on storage
          // The address will be subscribed on the server side
          executionQueue = executionQueue.then(async () => {
            await storage.saveAddress({
              base58: wsData.address,
              bip32AddressIndex: wsData.index,
            });
            await updateUI();
          });
          // Generate next batch if needed
          batchGenerationPromise = batchGenerationPromise.then(async () => {
            await generateNextBatch();
          });
        }
        if (isStreamSyncHistoryEnd(wsData)) {
          // cleanup and stop the method.
          // console.log(`Stream end at ${Date.now()}`);
          // This will resolve the promise and clean the listener on the connection
          abortController.abort();
        }
        // An error happened on the fullnode, we should stop the stream
        if (isStreamSyncHistoryError(wsData)) {
          console.error(`Stream error: ${wsData.errmsg}`);
          errorMessage = wsData.errmsg;
          // This will resolve the promise and clean the listener on the connection
          abortController.abort();
        }
      };
      connection.on('stream', listener);
      abortController.signal.addEventListener(
        'abort',
        () => {
          connection.removeListener('stream', listener);
        },
        { once: true }
      );

      switch (mode) {
        case HistorySyncMode.STREAM_XPUB:
          connection.startStreamingHistory(streamId, xpubkey);
          break;
        case HistorySyncMode.STREAM_MANUAL:
          connection.sendManualStreamingHistory(
            streamId,
            loadAddressesCPUIntensive(startIndex, ADDRESSES_PER_MESSAGE, xpubkey, network),
            true
          );
          break;
        default:
          // Should never happen.
          errorMessage = 'Unknown stream mode';
          abortController.abort();
          break;
      }
    });

    // Wait for promise chains to finish.
    await executionQueue;
    await batchGenerationPromise;

    // Will not attempt to process the history since some error or abortion happened
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    if (foundAnyTx && shouldProcessHistory) {
      await storage.processHistory();
    }
  } finally {
    // Always abort on finally to avoid memory leaks
    abortController.abort();
    connection.emit('stream-end');
  }
}
