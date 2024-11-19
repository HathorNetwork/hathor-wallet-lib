/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { PartialTx, PartialTxInputData } from '../models/partial_tx';
import Transaction from '../models/transaction';
import { Utxo } from './types';
import { Balance } from '../models/types';
import { IStorage, OutputValueType } from '../types';
declare class PartialTxProposal {
    partialTx: PartialTx;
    signatures: PartialTxInputData | null;
    transaction: Transaction | null;
    storage: IStorage;
    /**
     * @param {Network} network
     */
    constructor(storage: IStorage);
    /**
     * Create a PartialTxProposal instance from the serialized string.
     *
     * @param {string} serialized Serialized PartialTx data
     * @param {Network} network network
     *
     * @throws {SyntaxError} serialized argument should be a valid PartialTx.
     * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
     *
     * @returns {PartialTxProposal}
     */
    static fromPartialTx(serialized: string, storage: IStorage): PartialTxProposal;
    /**
     * Add inputs sending the amount of tokens specified, may add a change output.
     *
     * @param {string} token UID of token that is being sent
     * @param {OutputValueType} value Quantity of tokens being sent
     * @param {Object} [options]
     * @param {Utxo[]|null} [options.utxos=[]] utxos to add to the partial transaction.
     * @param {string|null} [options.changeAddress=null] If we add change, use this address instead of getting a new one from the wallet.
     * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
     */
    addSend(token: string, value: OutputValueType, { utxos, changeAddress, markAsSelected, }?: {
        utxos?: Utxo[] | null;
        changeAddress?: string | null;
        markAsSelected?: boolean;
    }): Promise<void>;
    /**
     * Add outputs receiving the amount of tokens specified.
     *
     * @param {string} token UID of token that is being sent
     * @param {OutputValueType} value Quantity of tokens being sent
     * @param {Object} [options]
     * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
     * @param {string|null} [options.address=null] Output address to receive the tokens.
     *
     */
    addReceive(token: string, value: OutputValueType, { timelock, address }?: {
        timelock?: number | null;
        address?: string | null;
    }): Promise<void>;
    /**
     * Add an UTXO as input on the partial data.
     *
     * @param {string} hash Transaction hash
     * @param {number} index UTXO index on the outputs of the transaction.
     * @param {OutputValueType} value UTXO value.
     * @param {Object} [options]
     * @param {string} [options.token='00'] Token UID in hex format.
     * @param {OutputValueType} [options.authorities=0] Authority information of the UTXO.
     * @param {string|null} [options.address=null] Address that owns the UTXO.
     * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
     */
    addInput(hash: string, index: number, value: OutputValueType, address: string, { token, authorities, markAsSelected, }?: {
        token?: string;
        authorities?: OutputValueType;
        markAsSelected?: boolean;
    }): void;
    /**
     * Add an output to the partial data.
     *
     * @param {string} token UID of token that is being sent.
     * @param {OutputValueType} value Quantity of tokens being sent.
     * @param {string} address Create the output script for this address.
     * @param {Object} [options]
     * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
     * @param {boolean} [options.isChange=false] If the output should be considered as change.
     * @param {OutputValueType} [options.authorities=0] Authority information of the Output.
     *
     * @throws AddressError
     */
    addOutput(token: string, value: OutputValueType, address: string, { timelock, isChange, authorities, }?: {
        timelock?: number | null;
        isChange?: boolean;
        authorities?: OutputValueType;
    }): void;
    /**
     * Calculate the token balance of the partial tx for a specific wallet.
     *
     * @returns {Record<string, Balance>}
     */
    calculateBalance(): Promise<Record<string, Balance>>;
    /**
     * Reset any data calculated from the partial tx.
     */
    resetSignatures(): void;
    /**
     * Unmark all inputs currently on the partial tx as not `selected_as_input`.
     *
     * @param {HathorWallet} wallet Wallet of the UTXOs.
     */
    unmarkAsSelected(): void;
    /**
     * Returns true if the transaction funds are balanced and the signatures match all inputs.
     *
     * @returns {boolean}
     */
    isComplete(): boolean;
    /**
     * Create the data to sign from the current transaction signing the loaded wallet inputs.
     *
     * @param {string} pin The loaded wallet's pin to sign the transaction.
     * @param {boolean} validate If we should validate the data with the fullnode before signing.
     *
     * @throws {InvalidPartialTxError} Inputs and outputs balance should match before signing.
     * @throws {UnsupportedScriptError} When we have an unsupported output script.
     * @throws {IndexOOBError} input index should be inside the inputs array.
     */
    signData(pin: string, validate?: boolean): Promise<void>;
    /**
     * Overwrites the proposal's signatures with the serialized contents in the parameters
     * @param serializedSignatures
     *
     * @throws {InvalidPartialTxError} Inputs and outputs balance should match before the signatures can be added.
     */
    setSignatures(serializedSignatures: string): void;
    /**
     * Create and return the Transaction instance if we have all signatures.
     *
     * @throws InvalidPartialTxError
     *
     * @returns {Transaction}
     */
    prepareTx(): Transaction;
}
export default PartialTxProposal;
//# sourceMappingURL=partialTxProposal.d.ts.map