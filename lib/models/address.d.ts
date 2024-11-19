/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import Network from './network';
declare class Address {
    base58: string;
    network: Network;
    constructor(base58: string, options?: {
        network: Network;
    });
    /**
     * Check if address is a valid string
     *
     * @return {boolean} If address is valid
     * @memberof Address
     * @inner
     */
    isValid(): boolean;
    /**
     * Decode address in base58 to bytes
     *
     * @return {Buffer} address in bytes
     * @memberof Address
     * @inner
     */
    decode(): Buffer;
    /**
     * Validate address
     *
     * 1. Address must have 25 bytes
     * 2. Address checksum must be valid
     * 3. Address first byte must match one of the options for P2PKH or P2SH
     *
     * @throws {AddressError} Will throw an error if address is not valid
     *
     * @return {boolean}
     * @memberof Address
     * @inner
     */
    validateAddress(): boolean;
    /**
     * Get address type
     *
     * Will check the version byte of the address against the network's version bytes.
     * Valid types are p2pkh and p2sh.
     *
     * @throws {AddressError} Will throw an error if address is not valid
     *
     * @return {string}
     * @memberof Address
     * @inner
     */
    getType(): 'p2pkh' | 'p2sh';
    /**
     * Get address script
     *
     * Will get the type of the address (p2pkh or p2sh)
     * then create the script
     *
     * @throws {AddressError} Will throw an error if address is not valid
     *
     * @return {Buffer}
     * @memberof Address
     * @inner
     */
    getScript(): Buffer;
}
export default Address;
//# sourceMappingURL=address.d.ts.map