/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { Networks } from 'bitcore-lib';
type versionBytesType = {
    p2pkh: number;
    p2sh: number;
};
declare class Network {
    name: string;
    versionBytes: versionBytesType;
    bitcoreNetwork: Networks;
    constructor(name: string);
    /**
     * Validate the network name is valid
     */
    validateNetwork(): void;
    /**
     * Method created to keep compatibility with old Network class
     */
    getNetwork(): Networks;
    /**
     * Method created to keep compatibility with old Network class
     */
    getVersionBytes(): versionBytesType;
    /**
     * Method to check that a version byte is valid
     */
    isVersionByteValid(version: number): boolean;
    /**
     * Method created to keep compatibility with old Network class
     */
    setNetwork(name: string): void;
}
export default Network;
//# sourceMappingURL=network.d.ts.map