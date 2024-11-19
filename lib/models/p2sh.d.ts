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
declare class P2SH {
    address: Address;
    timelock: number | null;
    constructor(address: Address, options?: optionsType);
    /**
     * Get script type
     *
     * @return {string}
     * @memberof P2SH
     * @inner
     */
    getType(): 'p2sh';
    /**
     * Create a P2SH script
     *
     * @return {Buffer}
     * @memberof P2SH
     * @inner
     */
    createScript(): Buffer;
    /**
     * Identify a script as P2SH or not.
     *
     * @param {Buffer} buf Script as buffer.
     *
     * @return {Boolean}
     * @memberof P2SH
     * @inner
     */
    static identify(buf: Buffer): boolean;
}
export default P2SH;
//# sourceMappingURL=p2sh.d.ts.map