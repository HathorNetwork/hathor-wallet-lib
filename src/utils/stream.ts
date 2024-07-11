import FullnodeConnection from '../new/connection';
import {
  IStorage,
  // IAddressInfo,
  IHistoryTx,
} from '../types';

interface IStreamSyncHistoryVertex {
  type: 'stream:history-xpub:vertex',
  id: string,
  data: IHistoryTx,
}

interface IStreamSyncHistoryAddress {
  type: 'stream:history-xpub:address',
  id: string,
  address: string,
  index: number,
}

interface IStreamSyncHistoryEnd {
  type: 'stream:history-xpub:end',
  id: string,
}

type IStreamSyncHistoryData = IStreamSyncHistoryVertex | IStreamSyncHistoryAddress | IStreamSyncHistoryEnd;

function isStreamSyncHistoryVertex(data: IStreamSyncHistoryData): data is IStreamSyncHistoryVertex {
  return data.type === 'stream:history-xpub:vertex';
}

function isStreamSyncHistoryAddress(data: IStreamSyncHistoryData): data is IStreamSyncHistoryAddress {
  return data.type === 'stream:history-xpub:address';
}

function isStreamSyncHistoryEnd(data: IStreamSyncHistoryData): data is IStreamSyncHistoryEnd {
  return data.type === 'stream:history-xpub:end';
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

  await new Promise<void>(async (resolve) => {
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
      // if (wsData.id !== 'cafe') {
      //   // Check that the stream id is the same we sent
      //   return;
      // }
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
    };

    connection.on('stream', listener);

    connection.startStreamingHistory(accessData.xpubkey);
  });

  if (shouldProcessHistory) {
    await storage.processHistory();
  }
}
