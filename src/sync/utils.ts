/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IHistoryTx, IStorage } from "../types";

/**
 * Currently we only need to check that a transaction has been voided or un-voided.
 */
export async function checkTxMetadataChanged(tx: IHistoryTx, storage: IStorage): Promise<boolean> {
  const txId = tx.tx_id;
  const storageTx = await storage.getTx(txId);
  if (!storageTx) {
    // This is a new tx
    return false;
  }

  return tx.is_voided !== storageTx.is_voided;
}
