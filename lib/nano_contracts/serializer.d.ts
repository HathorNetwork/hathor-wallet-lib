/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { NanoContractArgumentType } from './types';
import { OutputValueType } from '../types';
declare class Serializer {
    /**
     * Push an integer to buffer as the len of serialized element
     * Use SERIALIZATION_SIZE_LEN as the quantity of bytes to serialize
     * the integer
     *
     * @param {buf} Array of buffer to push the serialized integer
     * @param {len} Integer to serialize
     *
     * @memberof Serializer
     * @inner
     */
    pushLenValue(buf: Buffer[], len: number): void;
    /**
     * Helper method to serialize any value from its type
     * We receive these type from the full node, so we
     * use the python syntax
     *
     * @param {value} Value to serialize
     * @param {type} Type of the value to be serialized
     *
     * @memberof Serializer
     * @inner
     */
    serializeFromType(value: NanoContractArgumentType, type: string): Buffer;
    /**
     * Serialize string value
     *
     * @param {value} Value to serialize
     *
     * @memberof Serializer
     * @inner
     */
    fromString(value: string): Buffer;
    /**
     * Serialize bytes value
     *
     * @param {value} Value to serialize
     *
     * @memberof Serializer
     * @inner
     */
    fromBytes(value: Buffer): Buffer;
    /**
     * Serialize integer value
     *
     * @param {value} Value to serialize
     *
     * @memberof Serializer
     * @inner
     */
    fromInt(value: number): Buffer;
    /**
     * Serialize amount value
     *
     * @param {value} Value to serialize
     *
     * @memberof Serializer
     * @inner
     */
    fromAmount(value: OutputValueType): Buffer;
    /**
     * Serialize float value
     *
     * @param {value} Value to serialize
     *
     * @memberof Serializer
     * @inner
     */
    fromFloat(value: number): Buffer;
    /**
     * Serialize boolean value
     *
     * @param {value} Value to serialize
     *
     * @memberof Serializer
     * @inner
     */
    fromBool(value: boolean): Buffer;
    /**
     * Serialize a list of values
     *
     * @param {value} List of values to serialize
     * @param {type} Type of the elements on the list
     *
     * @memberof Serializer
     * @inner
     */
    fromList(value: NanoContractArgumentType[], type: string): Buffer;
    /**
     * Serialize an optional value
     *
     * If value is null, then it's a buffer with 0 only. If it's not null,
     * we create a buffer with 1 in the first byte and the serialized value
     * in the sequence.
     *
     * @param {value} Value to serialize. If not, the optional is empty
     * @param {type} Type of the value to serialize
     *
     * @memberof Serializer
     * @inner
     */
    fromOptional(value: NanoContractArgumentType, type: string): Buffer;
    /**
     * Serialize a signed value
     * We expect the value as a string separated by comma (,)
     * with 3 elements (inputData, value, type)
     *
     * The serialization will be
     * [len(serializedValue)][serializedValue][inputData]
     *
     * @param {signedValue} String value with inputData, value, and type separated by comma
     *
     * @memberof Serializer
     * @inner
     */
    fromSigned(signedValue: string): Buffer;
}
export default Serializer;
//# sourceMappingURL=serializer.d.ts.map