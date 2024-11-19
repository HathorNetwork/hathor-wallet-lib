/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import Transaction from '../models/transaction';
import Input from '../models/input';
import Output from '../models/output';
declare class NanoContract extends Transaction {
    id: string;
    method: string;
    args: Buffer[];
    pubkey: Buffer;
    signature: Buffer | null;
    constructor(inputs: Input[], outputs: Output[], tokens: string[], id: string, method: string, args: Buffer[], pubkey: Buffer, signature?: Buffer | null);
    /**
     * Serialize funds fields
     * Add the serialized fields to the array parameter
     *
     * @param {array} Array of buffer to push the serialized fields
     * @param {addInputData} If should add input data when serializing it
     *
     * @memberof NanoContract
     * @inner
     */
    serializeFundsFields(array: Buffer[], addInputData: boolean): void;
    /**
     * Serialize tx to bytes
     *
     * @memberof NanoContract
     * @inner
     */
    toBytes(): Buffer;
}
export default NanoContract;
//# sourceMappingURL=nano_contract.d.ts.map