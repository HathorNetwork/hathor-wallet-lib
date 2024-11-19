/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import Network from '../models/network';
import { NanoContractArgumentType } from './types';
import { OutputValueType } from '../types';
declare class Deserializer {
    network: Network;
    constructor(network: Network);
    /**
     * Helper method to deserialize any value from its type
     * We receive these types from the full node, so we
     * use the python syntax
     *
     * @param {value} Value to deserialize
     * @param {type} Type of the value to be deserialized
     *
     * @memberof Deserializer
     * @inner
     */
    deserializeFromType(value: Buffer, type: string): NanoContractArgumentType | null;
    /**
     * Deserialize string value
     *
     * @param {value} Value to deserialize
     *
     * @memberof Deserializer
     * @inner
     */
    toString(value: Buffer): string;
    /**
     * Deserialize bytes value
     *
     * @param {value} Value to deserialize
     *
     * @memberof Deserializer
     * @inner
     */
    toBytes(value: Buffer): Buffer;
    /**
     * Deserialize int value
     *
     * @param {value} Value to deserialize
     *
     * @memberof Deserializer
     * @inner
     */
    toInt(value: Buffer): number;
    /**
     * Deserialize amount value
     *
     * @param {value} Value to deserialize
     *
     * @memberof Deserializer
     * @inner
     */
    toAmount(value: Buffer): OutputValueType;
    /**
     * Deserialize float value
     *
     * @param {value} Value to deserialize
     *
     * @memberof Deserializer
     * @inner
     */
    toFloat(value: Buffer): number;
    /**
     * Deserialize boolean value
     *
     * @param {value} Value to deserialize
     *
     * @memberof Deserializer
     * @inner
     */
    toBool(value: Buffer): boolean;
    /**
     * Deserialize an optional value
     *
     * First we check the first byte. If it's 0, then we return null.
     *
     * Otherwise, we deserialize the rest of the buffer to the type.
     *
     * @param {value} Buffer with the optional value
     * @param {type} Type of the optional without the ?
     *
     * @memberof Deserializer
     * @inner
     */
    toOptional(value: Buffer, type: string): NanoContractArgumentType | null;
    /**
     * Deserialize a signed value
     *
     * The signedData what will be deserialized is
     * [len(serializedValue)][serializedValue][inputData]
     *
     * @param {signedData} Buffer with serialized signed value
     * @param {type} Type of the signed value, with the subtype, e.g., SignedData[str]
     *
     * @memberof Deserializer
     * @inner
     */
    toSigned(signedData: Buffer, type: string): string;
    /**
     * Deserialize a value decoded in bytes to a base58 string
     *
     * @param {value} Value to deserialize
     *
     * @memberof Deserializer
     * @inner
     */
    toAddress(value: Buffer): string;
}
export default Deserializer;
//# sourceMappingURL=deserializer.d.ts.map