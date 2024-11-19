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
import { IDataInput, IDataOutput, IDataTx, OutputValueType } from '../types';
/**
 * Extended version of the Input class with extra data
 * We need the extra data to calculate the balance of the PartialTx
 */
export declare class ProposalInput extends Input {
    token: string;
    authorities: OutputValueType;
    value: OutputValueType;
    address: string;
    constructor(hash: string, index: number, value: OutputValueType, address: string, { token, authorities, }?: {
        token?: string;
        authorities?: OutputValueType;
    });
    /**
     * Return an object with the relevant input data
     *
     * @return {IDataInput}
     * @memberof ProposalInput
     * @inner
     */
    toData(): IDataInput;
    isAuthority(): boolean;
}
/**
 * Extended version of the Output class with extra data
 * We need the extra data to calculate the token_data of the
 * output on the final transaction and to track which outputs are change.
 */
export declare class ProposalOutput extends Output {
    token: string;
    isChange: boolean;
    authorities: OutputValueType;
    constructor(value: OutputValueType, script: Buffer, { isChange, token, authorities, }?: {
        token?: string;
        isChange?: boolean;
        authorities?: OutputValueType;
    });
    /**
     * Set the value of the property tokenData
     *
     * @param {number} tokenData
     */
    setTokenData(tokenData: number): void;
    /**
     * Return an object with the relevant output data
     *
     * @param {number} tokenIndex Index of the token on the tokens array plus 1 (0 meaning HTR)
     * @param {Network} network Network used to generate addresses in
     *
     * @returns {IDataOutput}
     *
     * @throws {UnsupportedScriptError} Script must be P2SH or P2PKH
     * @memberof ProposalOutput
     * @inner
     */
    toData(tokenIndex: number, network: Network): IDataOutput;
}
export declare const PartialTxPrefix = "PartialTx";
/**
 * This class purpose is to hold and modify the state of the partial transaction.
 * It is also used to serialize and deserialize the partial transaction state.
 */
export declare class PartialTx {
    inputs: ProposalInput[];
    outputs: ProposalOutput[];
    network: Network;
    constructor(network: Network);
    /**
     * Convert the PartialTx into a complete TxData ready to be signed or serialized.
     *
     * @returns {TxData}
     *
     * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
     * @memberof PartialTx
     * @inner
     */
    getTxData(): IDataTx;
    /**
     * Create a Transaction instance from the PartialTx.
     *
     * @returns {Transaction}
     *
     * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
     * @memberof PartialTx
     * @inner
     */
    getTx(): Transaction;
    /**
     * Calculate balance for all tokens from inputs and outputs.
     *
     * @returns {Record<string, {inputs: number, outputs: number}}
     * @memberof PartialTx
     * @inner
     */
    calculateTokenBalance(): Record<string, {
        inputs: OutputValueType;
        outputs: OutputValueType;
    }>;
    /**
     * Return true if the balance of the outputs match the balance of the inputs for all tokens.
     *
     * @returns {boolean}
     * @memberof PartialTx
     * @inner
     */
    isComplete(): boolean;
    /**
     * Add an UTXO as input on the PartialTx.
     *
     * @param {string} txId The transaction id of the UTXO.
     * @param {number} index The index of the UTXO.
     * @param {OutputValueType} value Value of the UTXO.
     * @param {OutputValueType} authorities The authority information of the utxo.
     * @param {string} address base58 address
     * @param {Object} [options]
     * @param {string} [options.token='00'] The token UID.
     *
     * @memberof PartialTx
     * @inner
     */
    addInput(txId: string, index: number, value: OutputValueType, address: string, { token, authorities, }?: {
        token?: string;
        authorities?: OutputValueType;
    }): void;
    /**
     * Add an output to the PartialTx.
     *
     * @param {OutputValueType} value The amount of tokens on the output.
     * @param {Buffer} script The output script.
     * @param {OutputValueType} authorities The authority information of the output.
     * @param {Object} [options]
     * @param {string} [options.token='00'] The token UID.
     * @param {boolean|null} [options.isChange=false] isChange If this is a change output.
     *
     * @memberof PartialTx
     * @inner
     */
    addOutput(value: OutputValueType, script: Buffer, { token, authorities, isChange, }?: {
        token?: string;
        isChange?: boolean;
        authorities?: OutputValueType;
    }): void;
    /**
     * Serialize the current PartialTx into an UTF8 string.
     *
     * The serialization will join 4 parts:
     * - Fixed prefix
     * - transaction: in hex format
     * - inputs metadata: a colon-separated list of address, token, authorities and value
     * - outputs metadata: change outputs indexes
     *
     * Example: PartialTx|00010102...ce|W...vjPi,00,0,1b:W...vjPi,0000389...8c,1,d|1:2
     * Obs: ellipsis were used to abreviate long parts, there are no ellipsis on the serialized string
     *
     *
     * @returns {string}
     *
     * @throws {UnsupportedScriptError} All output scripts must be P2SH or P2PKH
     * @memberof PartialTx
     * @inner
     */
    serialize(): string;
    /**
     * Deserialize and create an instance of PartialTx
     *
     * @param {string} serialized The serialized PartialTx
     * @param {Network} network Network used when parsing the output scripts
     *
     * @returns {PartialTx}
     *
     * @throws {SyntaxError} serialized argument should be valid.
     * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
     * @memberof PartialTx
     * @static
     */
    static deserialize(serialized: string, network: Network): PartialTx;
    /**
     * Check the content of the current PartialTx with the fullnode
     *
     * @returns {Promise<boolean>}
     */
    validate(): Promise<boolean>;
}
export declare const PartialTxInputDataPrefix = "PartialTxInputData";
/**
 * This class is meant to aggregate input data for a transaction.
 *
 * The `hash` is an identifier of the transaction (usually the dataToSign in hex format)
 * this way any input data added should identify that it is from the same transaction.
 *
 * The input data is saved instead of the signature to allow collecting from MultiSig wallets
 * since for an input we can have multiple signatures.
 */
export declare class PartialTxInputData {
    data: Record<number, Buffer>;
    hash: string;
    inputsLen: number;
    constructor(hash: string, inputsLen: number);
    /**
     * Add an input data to the record.
     *
     * @param {number} index The input index this data relates to.
     * @param {Buffer} inputData Input data bytes.
     *
     * @throws {IndexOOBError} index should be inside the inputs array.
     *
     * @memberof PartialTxInputData
     * @inner
     */
    addData(index: number, inputData: Buffer): void;
    /**
     * Return true if we have an input data for each input.
     *
     * @returns {boolean}
     * @memberof PartialTxInputData
     * @inner
     */
    isComplete(): boolean;
    /**
     * Serialize the current PartialTxInputData into an UTF8 string.
     *
     * The serialization will join 3 informations:
     * - Fixed prefix
     * - hash: to identify the transaction which these signatures belong to
     * - inputs data: index and data
     *
     * Example: PartialTxInputData|000ca...fe|0:00abc|1:00123
     * Obs: ellipsis is used to abreviate, there are no ellipsis on the serialized string
     *
     * @returns {string}
     * @memberof PartialTxInputData
     * @inner
     */
    serialize(): string;
    /**
     * Deserialize the PartialTxInputData and merge with local data.
     *
     * @param {string} serialized The serialized PartialTxInputData
     *
     * @throws {SyntaxError} serialized argument should be valid.
     * @memberof PartialTxInputData
     * @static
     */
    addSignatures(serialized: string): void;
}
//# sourceMappingURL=partial_tx.d.ts.map