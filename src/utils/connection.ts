/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IStorage } from "../types";

export function handleWsDashboard(storage: IStorage) {
  return (data: any) => {
    // update network height
    storage.setCurrentHeight(data.best_block_height as number);
  }
}

export function handleSubscribeAddress() {
  return (data: any) => {
    if (data.success === false) {
      // If an address subscription fails we stop the service
      throw new Error(data.message);
    }
  }
}