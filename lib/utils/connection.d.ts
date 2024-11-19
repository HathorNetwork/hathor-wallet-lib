/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { IStorage } from '../types';
export declare function handleWsDashboard(storage: IStorage): (data: {
    best_block_height: number;
}) => void;
export declare function handleSubscribeAddress(): (data: {
    success?: boolean;
    message?: string;
}) => void;
//# sourceMappingURL=connection.d.ts.map