/// <reference types="node" />
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import ScriptData from '../models/script_data';
import Network from '../models/network';
/**
 * Parse P2PKH output script
 *
 * @param {Buffer} buff Output script
 * @param {Network} network Network to get the address first byte parameter
 *
 * @return {P2PKH} P2PKH object
 */
export declare const parseP2PKH: (buff: Buffer, network: Network) => P2PKH;
/**
 * Parse P2SH output script
 *
 * @param {Buffer} buff Output script
 * @param {Network} network Network to get the address first byte parameter
 *
 * @return {P2SH} P2PKH object
 */
export declare const parseP2SH: (buff: Buffer, network: Network) => P2SH;
/**
 * Parse Data output script
 *
 * @param {Buffer} buff Output script
 *
 * @return {ScriptData} ScriptData object
 */
export declare const parseScriptData: (buff: Buffer) => ScriptData;
/**
 * Parse buffer to data decoding pushdata opcodes
 *
 * @param {Buffer} buff Buffer to get pushdata
 *
 * @return {Buffer} Data extracted from buffer
 */
export declare const getPushData: (buff: Buffer) => Buffer;
/**
 * Create a P2SH MultiSig redeem script
 *
 * @param {string[]} xpubs The list of xpubkeys involved in this MultiSig
 * @param {number} numSignatures Minimum number of signatures to send a
 * transaction with this MultiSig
 * @param {number} index Index to derive the xpubs
 *
 * @return {Buffer} A buffer with the redeemScript
 * @throws {XPubError} In case any of the given xpubs are invalid
 */
export declare function createP2SHRedeemScript(xpubs: string[], numSignatures: number, index: number): Buffer;
/**
 * Parse script to get an object corresponding to the script data
 *
 * @param {Buffer} script Output script to parse
 * @param {Network} network Network to get the address first byte parameter
 *
 * @return {P2PKH | P2SH | ScriptData | null} Parsed script object
 */
export declare const parseScript: (script: Buffer, network: Network) => P2PKH | P2SH | ScriptData | null;
//# sourceMappingURL=scripts.d.ts.map