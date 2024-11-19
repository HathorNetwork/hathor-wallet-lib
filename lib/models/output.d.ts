/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import P2PKH from './p2pkh';
import P2SH from './p2sh';
import ScriptData from './script_data';
import Network from './network';
import { OutputValueType } from '../types';
type optionsType = {
    tokenData?: number | undefined;
    timelock?: number | null | undefined;
};
/**
 * Maximum length of an output script
 * @type {number}
 */
export declare const MAXIMUM_SCRIPT_LENGTH: number;
declare class Output {
    value: OutputValueType;
    tokenData: number;
    script: Buffer;
    decodedScript: P2PKH | P2SH | ScriptData | null;
    constructor(value: OutputValueType, script: Buffer, options?: optionsType);
    /**
     * Get the bytes from the output value
     * If value is above the maximum for 32 bits we get from 8 bytes, otherwise only 4 bytes
     *
     * @throws {OutputValueError} Will throw an error if output value is invalid
     *
     * @return {Buffer}
     *
     * @memberof Transaction
     * @inner
     */
    valueToBytes(): Buffer;
    /**
     * Returns if output is authority
     *
     * @return {boolean} If it's an authority output or not
     *
     * @memberof Output
     * @inner
     */
    isAuthority(): boolean;
    /**
     * Verifies if output is of mint
     *
     * @return {boolean} if output is mint
     *
     * @memberof Output
     * @inner
     */
    isMint(): boolean;
    /**
     * Verifies if output is of melt
     *
     * @return {boolean} if output is melt
     *
     * @memberof Output
     * @inner
     */
    isMelt(): boolean;
    /**
     * Get index of token list of the output.
     * It already subtracts 1 from the final result,
     * so if this returns 0, it's the first token, i.e.
     * tokenData = 1, then getTokenIndex = 0.
     * For HTR output (tokenData = 0) it will return -1.
     *
     * @return {number} Index of the token of this output
     *
     * @memberof Output
     * @inner
     */
    getTokenIndex(): number;
    /**
     * Checks if this output refers to the HTR token
     *
     * @return {boolean} True if it is HTR
     * @memberOf Output
     * @inner
     */
    isTokenHTR(): boolean;
    /**
     * Serialize an output to bytes
     *
     * @return {Buffer[]}
     * @memberof Output
     * @inner
     */
    serialize(): Buffer[];
    parseScript(network: Network): P2PKH | P2SH | ScriptData | null;
    /**
     * Create output object from bytes
     *
     * @param {Buffer} buf Buffer with bytes to get output fields
     * @param {Network} network Network to get output addresses first byte
     *
     * @return {[Output, Buffer]} Created output and rest of buffer bytes
     * @memberof Output
     * @static
     * @inner
     */
    static createFromBytes(buf: Buffer, network: Network): [Output, Buffer];
    /**
     * Checks if the script length is within the valid limits
     *
     * @returns {boolean} True if the script is within valid limits
     *
     * @memberof Output
     * @inner
     */
    hasValidLength(): boolean;
    /**
     * Returns the type of the output, according to the specified network
     *
     * @param {Network} network Network to get output addresses first byte
     * @returns {string} Output type
     *
     * @memberof Output
     * @inner
     */
    getType(network: Network): string;
}
export default Output;
//# sourceMappingURL=output.d.ts.map