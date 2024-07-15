import FullnodeConnection from '../new/connection';
import {
  IStorage,
  // IAddressInfo,
  IHistoryTx,
} from '../types';
import {
  Address as BitcoreAddress,
  HDPublicKey,
} from 'bitcore-lib';
import Network from '../models/network';

interface IStreamSyncHistoryVertex {
  type: 'stream:history:vertex',
  id: string,
  data: IHistoryTx,
}

interface IStreamSyncHistoryAddress {
  type: 'stream:history:address',
  id: string,
  address: string,
  index: number,
}

interface IStreamSyncHistoryEnd {
  type: 'stream:history:end',
  id: string,
}

interface IStreamSyncHistoryError {
  type: 'stream:history:error',
  id: string,
  errmsg: string,
}

type IStreamSyncHistoryData = IStreamSyncHistoryVertex | IStreamSyncHistoryAddress | IStreamSyncHistoryEnd | IStreamSyncHistoryError;

function isStreamSyncHistoryVertex(data: IStreamSyncHistoryData): data is IStreamSyncHistoryVertex {
  return data.type === 'stream:history:vertex';
}

function isStreamSyncHistoryAddress(data: IStreamSyncHistoryData): data is IStreamSyncHistoryAddress {
  return data.type === 'stream:history:address';
}

function isStreamSyncHistoryEnd(data: IStreamSyncHistoryData): data is IStreamSyncHistoryEnd {
  return data.type === 'stream:history:end';
}

function isStreamSyncHistoryError(data: IStreamSyncHistoryData): data is IStreamSyncHistoryError {
  return data.type === 'stream:history:error';
}

export async function streamSyncHistory(
  _startIndex: number,
  _count: number,
  storage: IStorage,
  connection: FullnodeConnection,
  shouldProcessHistory: boolean = false,
): Promise<void> {
  const accessData = await storage.getAccessData();
  if (accessData === null) {
    throw new Error('No access data');
  }

  await new Promise<void>(async (resolve, reject) => {
    let canUpdateUI = true;

    /**
     * Send event to update UI.
     * This should be throttled to avoid flooding the UI with events.
     * The UI will be updated in intervals of at least 1 second.
     */
    const updateUI = async () => {
      if (canUpdateUI) {
        canUpdateUI = false;
        connection.emit('wallet-load-partial-update', {
          addressesFound: await storage.store.addressCount(),
          historyLength: await storage.store.historyCount(),
        });
        setTimeout(() => {
          canUpdateUI = true;
        }, 1000);
      }
    };

    const listener = async (wsData: IStreamSyncHistoryData) => {
      if (wsData.id !== 'cafe') {
        // Check that the stream id is the same we sent
        return;
      }
      if (isStreamSyncHistoryVertex(wsData)) {
        // add to history
        await storage.addTx(wsData.data);
        await updateUI();
      }
      if (isStreamSyncHistoryAddress(wsData)) {
        // Register address on storage
        // The address will be subscribed on the server side
        await storage.saveAddress({
          base58: wsData.address,
          bip32AddressIndex: wsData.index,
        });
        await updateUI();
      }
      if (isStreamSyncHistoryEnd(wsData)) {
        // cleanup and stop the method.
        // console.log(`Stopping stream ${Date.now()}`);
        connection.removeListener('stream', listener);
        resolve();
      }
      if (isStreamSyncHistoryError(wsData)) {
        console.error(`Stream error: ${wsData.errmsg}`);
        connection.removeListener('stream', listener);
        reject(wsData.errmsg);
      }
    };

    connection.on('stream', listener);

    connection.startStreamingHistory('cafe', accessData.xpubkey);
  });

  if (shouldProcessHistory) {
    await storage.processHistory();
  }
}

/**
 * Load addresses in a CPU intensive way
 * This only contemplates P2PKH addresses for now.
 */
export function loadAddressesCPUIntensive(
  startIndex: number,
  count: number,
  xpubkey: string,
  networkName: string,
): string[] {
  const addresses: string[] = [];
  const stopIndex = startIndex + count;
  const network = new Network(networkName);
  const hdpubkey = new HDPublicKey(xpubkey);

  for (let i = startIndex; i < stopIndex; i++) {
    const key = hdpubkey.deriveChild(i);
    addresses.push(new BitcoreAddress(key.publicKey, network.bitcoreNetwork).toString());
  }

  return addresses;
}

export generateStreamId = () => {
  Math.random().toString(36).substring(2, 15);
};


export async function streamManualSyncHistory(
  startIndex: number,
  count: number,
  storage: IStorage,
  connection: FullnodeConnection,
  shouldProcessHistory: boolean = false,
): Promise<void> {
  const MAX_WINDOW_SIZE = 600;
  const ADDRESSES_PER_MESSAGE = 40;

  const streamId = generateStreamId();
  if (connection.lockStream(streamId)) {
    throw new Error('There is an on-going stream on this connection');
  }

  const accessData = await storage.getAccessData();
  if (accessData === null) {
    throw new Error('No access data');
  }

  const xpubkey = accessData.xpubkey;
  const network = storage.config.getNetwork().name;
  let foundAnyTx = false;
  const addresses = loadAddressesCPUIntensive(startIndex, ADDRESSES_PER_MESSAGE, xpubkey, network);
  let lastLoadedIndex = startIndex + ADDRESSES_PER_MESSAGE - 1;
  let lastReceivedIndex = -1;
  let wasAborted = false;
  let errorMessage: string | null = null;

  let batchGenerationPromise = Promise.resolve();

  async function generateNextBatch(): Promise<void> {
    if (wasAborted) {
      return;
    }
    const distance = lastLoadedIndex - lastReceivedIndex;
    if (distance > (MAX_WINDOW_SIZE - ADDRESSES_PER_MESSAGE)) {
      return;
    }

    const batch = loadAddressesCPUIntensive(lastLoadedIndex + 1, ADDRESSES_PER_MESSAGE, xpubkey, network);
    lastLoadedIndex += ADDRESSES_PER_MESSAGE;
    connection.startManualStreamingHistory(streamId, batch, false);

    // Clear main loop and queue next batch
    setTimeout(() => {
      batchGenerationPromise = batchGenerationPromise.then(async () => {
        await generateNextBatch();
      })
    }, 0);
  }

  await new Promise<void>(resolve => {
    let canUpdateUI = true;

    let executionQueue = Promise.resolve();

    /**
     * Send event to update UI.
     * This should be throttled to avoid flooding the UI with events.
     * The UI will be updated in intervals of at least 1 second.
     */
    const updateUI = async () => {
      if (wasAborted) {
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
        }, 500);
      }
    };

    const handleEnd = (abort = false) => {
      wasAborted = abort;
      connection.removeListener('stream', listener);
      connection.removeListener('stream-abort', abortListener);
      resolve();
    };

    const listener = (wsData: IStreamSyncHistoryData) => {
      if (wasAborted) {
        return;
      }
      if (wsData.id !== streamId) {
        console.log(`Wrong stream ${JSON.stringify(wsData)}`);
        // Check that the stream id is the same we sent
        return;
      }
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
        batchGenerationPromise = batchGenerationPromise.then(async () => {
          await generateNextBatch();
        });
      }
      if (isStreamSyncHistoryEnd(wsData)) {
        // cleanup and stop the method.
        // console.log(`Stream end at ${Date.now()}`);
        handleEnd();
      }
      if (isStreamSyncHistoryError(wsData)) {
        console.error(`Stream error: ${wsData.errmsg}`);
        errorMessage = wsData.errmsg;
        handleEnd(true);
      }
    };
    connection.on('stream', listener);

    const abortListener = async () => {
      console.log('Aborting stream');
      handleEnd(true);
    };
    connection.on('stream-abort', abortListener);

    connection.startManualStreamingHistory(streamId, addresses, true);
  });

  // Wait for promise chains to finish
  await executionQueue;
  await batchGenerationPromise;

  if (wasAborted) {
    // Cleanup the connection before exiting.
    // Will not attempt to process the history since some error or abortion happened
    connection.emit('stream-end');
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return;
  }

  if (foundAnyTx && shouldProcessHistory) {
    await storage.processHistory();
  }
  connection.emit('stream-end');
}
