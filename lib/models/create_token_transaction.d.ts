/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import Input from './input';
import Output from './output';
import Transaction from './transaction';
import Network from './network';
type optionsType = {
    signalBits?: number;
    weight?: number;
    nonce?: number;
    timestamp?: number | null;
    parents?: string[];
    tokens?: string[];
    hash?: string | null;
};
declare class CreateTokenTransaction extends Transaction {
    name: string;
    symbol: string;
    constructor(name: string, symbol: string, inputs: Input[], outputs: Output[], options?: optionsType);
    /**
     * Serialize funds fields
     * signal bits, version, len inputs, len outputs, inputs, outputs and token info
     *
     * @param {Buffer[]} array Array of buffer to push the serialized fields
     * @param {boolean} addInputData If should add input data when serializing it
     *
     * @memberof Transaction
     * @inner
     */
    serializeFundsFields(array: Buffer[], addInputData: boolean): void;
    /**
     * Serialize create token tx info to bytes
     *
     * @param {Buffer[]} array of bytes
     * @memberof Transaction
     * @inner
     */
    serializeTokenInfo(array: Buffer[]): void;
    getTokenInfoFromBytes(srcBuf: Buffer): Buffer;
    /**
     * Gets funds fields (signalBits, version, inputs, outputs) from bytes
     * and saves them in `this`
     *
     * @param srcBuf Buffer with bytes to get fields
     * @param network Network to get output addresses first byte
     *
     * @return Rest of buffer after getting the fields
     * @memberof CreateTokenTransaction
     * @inner
     */
    getFundsFieldsFromBytes(srcBuf: Buffer, network: Network): Buffer;
    /**
     * Create transaction object from bytes
     *
     * @param {Buffer} buf Buffer with bytes to get transaction fields
     * @param {Network} network Network to get output addresses first byte
     *
     * @return {CreateTokenTransaction} Transaction object
     * @memberof CreateTokenTransaction
     * @static
     * @inner
     */
    static createFromBytes(buf: Buffer, network: Network): CreateTokenTransaction;
    /**
     * Checks if this transaction is the creation of an NFT following the NFT Standard Creation.
     * @see https://github.com/HathorNetwork/rfcs/blob/master/text/0032-nft-standard.md#transaction-standard
     * @throws {NftValidationError} Will throw an error if the NFT is not valid
     *
     * @param {Network} network Network to get output addresses first byte
     * @returns {void} If this function does not throw, the NFT is valid
     */
    validateNft(network: Network): void;
}
export default CreateTokenTransaction;
//# sourceMappingURL=create_token_transaction.d.ts.map