/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
/// <reference types="node" />
import crypto from 'crypto';
import Input from './input';
import Output from './output';
import Network from './network';
import { OutputValueType } from '../types';
type optionsType = {
    signalBits?: number;
    version?: number;
    weight?: number;
    nonce?: number;
    timestamp?: number | null;
    parents?: string[];
    tokens?: string[];
    hash?: string | null;
};
/**
 * Representation of a transaction with helper methods.
 *
 * Besides the class `constructor`, there are some helper methods are available to build instances of this class
 * according to context:
 * - `Transaction.createFromBytes`: creates a transaction from a buffer and a network
 * - `helpers.createTxFromData`: creates from a standard lib data object
 * - `helpers.createTxFromHistoryObject`: creates from a tx populated by the HathorWallet history methods
 */
declare class Transaction {
    inputs: Input[];
    outputs: Output[];
    signalBits: number;
    version: number;
    weight: number;
    nonce: number;
    timestamp: number | null;
    parents: string[];
    tokens: string[];
    hash: string | null;
    protected _dataToSignCache: Buffer | null;
    constructor(inputs: Input[], outputs: Output[], options?: optionsType);
    /**
     * Returns a string with the short version of the tx hash
     * Returns {first12Chars}...{last12Chars}
     *
     * @return {string}
     * @memberof Transaction
     * @inner
     *
     */
    getShortHash(): string;
    /**
     * Return transaction data to sign in inputs
     *
     * @return {Buffer}
     * @memberof Transaction
     * @inner
     */
    getDataToSign(): Buffer;
    /**
     * Serialize funds fields
     * signal bits, version, len tokens, len inputs, len outputs, tokens array, inputs and outputs
     *
     * @param {Buffer[]} array Array of buffer to push the serialized fields
     * @param {boolean} addInputData If should add input data when serializing it
     *
     * @memberof Transaction
     * @inner
     */
    serializeFundsFields(array: Buffer[], addInputData: boolean): void;
    /**
     * Add to buffer array the serialization of the tokens array
     *
     * @memberof Transaction
     * @inner
     */
    serializeTokensArray(array: Buffer[]): void;
    /**
     * Add to buffer array the serialization of funds fields len (len of inputs and outputs)
     *
     * @memberof Transaction
     * @inner
     */
    serializeFundsFieldsLen(array: Buffer[]): void;
    /**
     * Add to buffer array the serialization of funds fields (inputs and outputs)
     *
     * @memberof Transaction
     * @inner
     */
    serializeInputsOutputs(array: Buffer[], addInputData: boolean): void;
    /**
     * Add to buffer array the serialization of graph fields and other serialization fields (weight, timestamp, parents and nonce)
     *
     * @memberof Transaction
     * @inner
     */
    serializeGraphFields(array: Buffer[]): void;
    /**
     * Serializes nonce
     *
     * @param {Buffer[]} array Array of buffer to push serialized nonce
     *
     * @memberof Transaction
     * @inner
     */
    serializeNonce(array: Buffer[]): void;
    getDataToSignHash(): Buffer;
    /**
     * Calculate the minimum tx weight
     *
     * @throws {ConstantNotSet} If the weight constants are not set yet
     *
     * @return {number} Minimum weight calculated (float)
     * @memberof Transaction
     * @inner
     */
    calculateWeight(): number;
    /**
     * Calculate the sum of outputs. Authority outputs are ignored.
     *
     * @return {number} Sum of outputs
     * @memberof Transaction
     * @inner
     */
    getOutputsSum(): OutputValueType;
    /**
     * Serialize tx to bytes
     *
     * @return {Buffer}
     * @memberof Transaction
     * @inner
     */
    toBytes(): Buffer;
    /**
     * Validate transaction information.
     * For now, we only verify the maximum number of inputs and outputs.
     *
     * @throws {MaximumNumberInputsError} If the tx has more inputs than the maximum allowed
     * @throws {MaximumNumberOutputsError} If the tx has more outputs than the maximum allowed
     *
     * @memberof Transaction
     * @inner
     */
    validate(): void;
    /**
     * Get tx data and return it in hexadecimal
     *
     * @return {String} Hexadecimal of a serialized tx
     * @memberof Transaction
     * @inner
     */
    toHex(): string;
    /**
     * Get object type (Transaction or Block)
     *
     * @return {string} Type of the object
     *
     * @memberof Transaction
     * @inner
     */
    getType(): string;
    /**
     * Check if object is a block or a transaction
     *
     * @return {boolean} true if object is a block, false otherwise
     *
     * @memberof Transaction
     * @inner
     */
    isBlock(): boolean;
    /**
     * Set tx timestamp and weight
     *
     * @memberof Transaction
     * @inner
     */
    prepareToSend(): void;
    /**
     * Update transaction timestamp
     * If timestamp parameter is not sent, we use now
     *
     * @memberof Transaction
     * @inner
     */
    updateTimestamp(timestamp?: number | null): void;
    /**
     * Gets funds fields (signalBits, version, tokens, inputs, outputs) from bytes
     * and saves them in `this`
     *
     * @param srcBuf Buffer with bytes to get fields
     * @param network Network to get output addresses first byte
     *
     * @return Rest of buffer after getting the fields
     * @memberof Transaction
     * @inner
     */
    getFundsFieldsFromBytes(srcBuf: Buffer, network: Network): Buffer;
    /**
     * Gets graph fields (weight, timestamp, parents, nonce) from bytes
     * and saves them in `this`
     *
     * @param srcBuf Buffer with bytes to get fields
     *
     * @return Rest of buffer after getting the fields
     * @memberof Transaction
     * @inner
     */
    getGraphFieldsFromBytes(srcBuf: Buffer): Buffer;
    /**
     * Create transaction object from bytes
     *
     * @param {Buffer} buf Buffer with bytes to get transaction fields
     * @param {Network} network Network to get output addresses first byte
     *
     * @return {Transaction} Transaction object
     * @memberof Transaction
     * @static
     * @inner
     */
    static createFromBytes(buf: Buffer, network: Network): Transaction;
    /**
     * Calculate first part of transaction hash
     *
     * @return {object} Sha256 hash object of part1
     *
     * @memberof Transaction
     * @inner
     */
    calculateHashPart1(): crypto.Hash;
    /**
     * Calculate transaction hash from part1
     *
     * @return {Buffer} Transaction hash in bytes
     *
     * @memberof Transaction
     * @inner
     */
    calculateHashPart2(part1: crypto.Hash): Buffer;
    /**
     * Calculate transaction hash and return it
     *
     * @return {string} Transaction hash in hexadecimal
     *
     * @memberof Transaction
     * @inner
     */
    calculateHash(): string;
    /**
     * Update transaction hash
     *
     * @memberof Transaction
     * @inner
     */
    updateHash(): void;
}
export default Transaction;
//# sourceMappingURL=transaction.d.ts.map