import FullnodeConnection from '../new/connection';
import {
  IStorage,
  // IAddressInfo,
  // IHistoryTx,
} from '../types';

export async function streamSyncHistory(
  startIndex: number,
  count: number,
  storage: IStorage,
  connection: FullnodeConnection
  shouldProcessHistory: boolean = false
): Promise<void> {
  await new Promise(async (resolve) => {
    let canUpdateUI = true;

    /**
   * Send event to update UI.
   * This should be throttled to avoid flooding the UI with events.
   * The UI will be updated in intervals of at least 1 second.
   */
    const updateUI = () => {
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

    const listener = (wsData: Record<string, unknown>) => {
      if (wsData.type === 'stream:history-xpub:vertex') {
        // add to history
        await storage.addTx(wsData.vertex);
        updateUI();
      }
      if (wsData.type === 'stream:history-xpub:address') {
        // Register address on storage
        // The address will be subscribed on the server side
        await storage.saveAddress({
          base58: wsData.address,
          bip32AddressIndex: parseInt(wsData.path.split('/').pop(), 10),
        });
        updateUI();
      }
      if (wsData.type === 'stream:history-xpub:end') {
        // cleanup and stop the method.
        connection.removeListener('stream', listener);
        resolve();
      }
    };

    connection.on('stream', listener);
    const accessData = await storage.getAccessData();
    connection.startStreamingHistory(accessData.xpubkey);
  });

  if (shouldProcessHistory) {
    await storage.processHistory();
  }
}
