/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import Network from './models/network';
/**
 * Extend the network to be able to set config when setNetwork is called on the singleton
 */
declare class ExtendedNetwork extends Network {
    setNetwork(name: any, skipConfig?: boolean): void;
}
declare const instance: ExtendedNetwork;
export default instance;
//# sourceMappingURL=network.d.ts.map