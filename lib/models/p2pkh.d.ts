/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import Address from './address';
type optionsType = {
    timelock?: number | null | undefined;
};
declare class P2PKH {
    address: Address;
    timelock: number | null;
    constructor(address: Address, options?: optionsType);
    /**
     * Get script type
     *
     * @return {string}
     * @memberof P2PKH
     * @inner
     */
    getType(): 'p2pkh';
    /**
     * Create a P2PKH script
     *
     * @return {Buffer}
     * @memberof P2PKH
     * @inner
     */
    createScript(): Buffer;
    /**
     * Identify a script as P2PKH or not.
     *
     * @param {Buffer} buf Script as buffer.
     *
     * @return {Boolean}
     * @memberof P2PKH
     * @inner
     */
    static identify(buf: Buffer): boolean;
}
export default P2PKH;
//# sourceMappingURL=p2pkh.d.ts.map