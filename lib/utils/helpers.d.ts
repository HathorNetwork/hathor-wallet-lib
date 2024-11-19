/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import buffer from 'buffer';
import { AxiosInstance, AxiosRequestConfig } from 'axios';
import Transaction from '../models/transaction';
import { HistoryTransaction, HistoryTransactionOutput } from '../models/types';
import CreateTokenTransaction from '../models/create_token_transaction';
import Output from '../models/output';
import Network from '../models/network';
import Address from '../models/address';
import { IDataInput, IUtxo } from '../types';
/**
 * Helper methods
 *
 * @namespace Helpers
 */
declare const helpers: {
    /**
     * Round float to closest int
     *
     * @param {number} n Number to be rounded
     *
     * @return {number} Closest integer to n passed
     *
     * @memberof Helpers
     * @inner
     */
    roundFloat(n: number): number;
    /**
     * Validate if the passed version is valid, comparing with the minVersion
     *
     * @param {string} version Version to check if is valid
     * @param {string} minVersion Minimum allowed version
     *
     * @return {boolean}
     *
     * @memberof Helpers
     * @inner
     */
    isVersionAllowed(version: string, minVersion: string): boolean;
    /**
     * Get the version numbers separated by dot
     * For example: if you haver version 0.3.1-beta you will get ['0', '3', '1']
     *
     * @param {string} version
     *
     * @return {Array} Array of numbers with each version number
     *
     * @memberof Helpers
     * @inner
     */
    getCleanVersionArray(version: string): string[];
    /**
     * Push data to the stack checking if need to add the OP_PUSHDATA1 opcode
     * We push the length of data and the data
     * In case the data has length > 75, we need to push the OP_PUSHDATA1 before the length
     * We always push bytes
     *
     * We update the array of Buffer sent as parameter, so we don't return a new one
     *
     * @param {Array} stack Stack of bytes from the script
     * @param {Buffer} data Data to be pushed to stack
     *
     * @memberof Helpers
     * @inner
     */
    pushDataToStack(stack: Buffer[], data: Buffer): void;
    /**
     * Push an integer to the stack
     * We always push an opcode representing the number from 0 to 16 (or OP_0 to OP_16)
     *
     * We update the array of Buffer sent as parameter, so we don't return a new one
     *
     * @param {Array} stack Stack of bytes from the script
     * @param {number} value number to be pushed on stack
     *
     * @memberof Helpers
     * @inner
     */
    pushIntToStack(stack: Buffer[], value: number): void;
    /**
     * Return the checksum of the bytes passed
     * Checksum is calculated as the 4 first bytes of the double sha256
     *
     * @param {Buffer} bytes Data from where the checksum is calculated
     *
     * @return {Buffer}
     * @memberof Helpers
     * @inner
     */
    getChecksum(bytes: Buffer): Buffer;
    /**
     * Get encoded address object from address hash (20 bytes) and network
     * We complete the address bytes with the network byte and checksum
     * then we encode to base 58 and create the address object
     *
     * @param {Buffer} addressHash 20 bytes of the address hash in the output script
     * @param {Network} network Network to get the address first byte parameter
     *
     * @return {Address}
     * @memberof Helpers
     * @inner
     */
    encodeAddress(addressHash: Buffer, network: Network): Address;
    /**
     * Get encoded address object from script hash (20 bytes) and network.
     * We use bitcore's Address module to build the address from the hash.
     *
     * @param {Buffer} scriptHash 20 bytes of the script hash in the output script
     * @param {Network} network Network to get the address first byte parameter
     *
     * @return {Address}
     * @memberof Helpers
     * @inner
     */
    encodeAddressP2SH(scriptHash: Buffer, network: Network): Address;
    /**
     * Create a transaction from bytes
     * First we get the version value from the bytes to discover the
     * transaction type. We currently support only regular transactions and
     * create token transactions.
     *
     * @param {Buffer} bytes Transaction in bytes
     * @param {Network} network Network to get the address first byte parameter
     *
     * @throws ParseError if sequence of bytes is invalid or network is undefined/null
     *
     * @return {Transaction | CreateTokenTransaction}
     * @memberof Helpers
     * @inner
     */
    createTxFromBytes(bytes: Buffer, network: Network): Transaction | CreateTokenTransaction;
    /**
     * Create a transaction from hex
     * We transform the hex in bytes and call the function to get transaction from bytes
     *
     * @param {string} hex Transaction in hexadecimal
     * @param {Network} network Network to get the address first byte parameter
     *
     * @return {Transaction | CreateTokenTransaction}
     * @memberof Helpers
     * @inner
     */
    createTxFromHex(hex: string, network: Network): Transaction | CreateTokenTransaction;
    /**
     * Asyncronous sleep
     * Creates a promise that will be resolved after sleep time
     *
     * @param {number} milliseconds Sleep time in milliseconds
     *
     * @return {Promise}
     * @memberof Helpers
     * @inner
     */
    sleep(milliseconds: number): Promise<void>;
    /**
     * Create a transaction from object data
     * We used to work only with data object to handle transactions in the past inside the lib
     * This method was created to transform those objects into Transaction class instances
     *
     * @param {Object} 'data': {'version', 'weight', 'timestamp', 'tokens', 'inputs': [{'tx_id', 'index'}], 'outputs': [{'address', 'value', 'tokenData', 'timelock'}]}
     *
     * if it's a create token transaction, then it expects 'name' and 'symbol' as well.
     *
     * @param {Network} network Network to get the address first byte parameter
     *
     * @throws {AddressError} If the address used in the P2PKH outputs is invalid
     *
     * @memberof Helpers
     * @inner
     */
    createTxFromData(data: any, network: Network): Transaction | CreateTokenTransaction;
    /**
     * Creates a Transaction instance from a populated object from the wallet's history methods.
     *
     * _Note_: This helper does not need a _Network_ parameter, since all the output scripts were already decoded.
     * @param {HistoryTransaction} historyTx A transaction formatted as an instance of a wallet history
     *
     * @memberof Helpers
     * @inner
     *
     * @example
     * const historyTx = myHathorWallet.getTx(myTxHash);
     * const txInstance = helpers.createTxFromHistoryObject(historyTx);
     */
    createTxFromHistoryObject(historyTx: HistoryTransaction): Transaction | CreateTokenTransaction;
    /**
     * Creates an Output from an object extracted from the wallet's history.
     * @param {HistoryTransactionOutput} historyOutput An output from a tx populated and formatted by the wallet's
     *                                                 history methods
     *
     * @memberof Helpers
     * @inner
     *
     * @example
     * const historyTx = myHathorWallet.getTx(myTxHash);
     * const outputInstance = heleprs.createOutputFromHistoryObject(historyTx.outputs[0]);
     */
    createOutputFromHistoryObject(historyOutput: HistoryTransactionOutput): Output;
    /**
     * Create NFT output from data string
     *
     * @memberof Helpers
     * @inner
     */
    createNFTOutput(data: string): Output;
    /**
     * Create an output with data script
     *
     * @memberof Helpers
     * @inner
     */
    createDataScriptOutput(data: string): Output;
    /**
     * From the base58 of an address we get the type of it, i.e. 'p2pkh' or 'p2sh'
     *
     * @memberof Helpers
     * @inner
     */
    getOutputTypeFromAddress(address: string, network: Network): string;
    /**
     * Get the URL to connect to the websocket from the server URL of the wallet
     *
     * @return {string} Websocket URL
     *
     * @memberof Helpers
     * @inner
     */
    getWSServerURL(url?: string | null): string;
    /**
     * Handle error for method transaction.prepareData
     * Check if error is one of the expected and return the message
     * Otherwise, throws the unexpected error
     *
     * @param {unknown} e Error thrown
     *
     * @return {string} Error message
     * @memberof Helpers
     * @inner
     */
    handlePrepareDataError(e: unknown): string;
    /**
     * Cleans a string for comparison. Remove multiple spaces, and spaces at the beginning and end, and transform to lowercase.
     *
     * @param {string} s String to be cleaned
     * @return {string} String after clean
     * @memberof Helpers
     */
    cleanupString(s: string): string;
    /**
     * Axios fails merging this configuration to the default configuration because it has an issue
     * with circular structures: https://github.com/mzabriskie/axios/issues/370
     * Got this code from https://github.com/softonic/axios-retry/blob/master/es/index.mjs#L203
     *
     * Warning: This function mutates the `config` parameter
     *
     * @param {AxiosInstance} axios Axios instance
     * @param {AxiosRequestConfig} configObj New axios config
     *
     * @memberof Helpers
     * @inner
     */
    fixAxiosConfig(axios: AxiosInstance, configObj: AxiosRequestConfig): void;
    /**
     * Returns a string with the short version of the id of a transaction
     * Returns {first12Chars}...{last12Chars}
     *
     * @param {string} hash Transaction ID to be shortened
     *
     * @return {string}
     * @memberof Helpers
     * @inner
     *
     */
    getShortHash(hash: string): string;
    /**
     * Returns IDataInput formatted from an IUtxo object
     *
     * @param {IUtxo} utxo Utxo to get IDataInput from
     *
     * @return {IDataInput}
     * @memberof Helpers
     * @inner
     *
     */
    getDataInputFromUtxo(utxo: IUtxo): IDataInput;
    /**
     * The library network must be 'mainnet', 'testnet', or 'privatenet'
     * The full node has 'mainnet', 'testnet-bravo', 'nano-testnet-alpha' and
     * we must translate it into library networks.
     *
     * @param {string} fullNodeNetwork The network from full node API
     *
     * @memberof Helpers
     * @inner
     *
     */
    getNetworkFromFullNodeNetwork(fullNodeNetwork: string): string;
};
export default helpers;
//# sourceMappingURL=helpers.d.ts.map