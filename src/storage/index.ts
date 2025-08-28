/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Storage } from './storage';
import { MemoryStore } from './memory_store';
import { WalletServiceStorage } from './wallet_service_memory_storage';

const store = new MemoryStore();
const storage = new Storage(store);

export { Storage };
export { MemoryStore };
export { WalletServiceStorage };

export default storage;
