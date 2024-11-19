/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
/// <reference types="node" />
import EventEmitter from 'events';
import MineTransaction from '../wallet/mineTransaction';
import { OutputType } from '../wallet/types';
import { IStorage, IDataTx, IDataInput, IUtxoSelectionOptions, OutputValueType } from '../types';
import Transaction from '../models/transaction';
export interface ISendInput {
    txId: string;
    index: number;
}
export interface ISendDataOutput {
    type: OutputType.DATA;
    data: Buffer;
    value?: number;
    token?: string;
}
export declare function isDataOutput(output: ISendOutput): output is ISendDataOutput;
export interface ISendTokenOutput {
    type: OutputType.P2PKH | OutputType.P2SH;
    address: string;
    value: OutputValueType;
    token: string;
    timelock?: number | null;
}
export type ISendOutput = ISendDataOutput | ISendTokenOutput;
/**
 * This is transaction mining class responsible for:
 *
 * - Submit a job to be mined;
 * - Update mining time estimation from time to time;
 * - Get back mining response;
 * - Push tx to the network;
 *
 * It emits the following events:
 * 'job-submitted': after job was submitted;
 * 'estimation-updated': after getting the job status;
 * 'job-done': after job is finished;
 * 'send-success': after push tx succeeds;
 * 'send-error': if an error happens;
 * 'unexpected-error': if an unexpected error happens;
 * */
export default class SendTransaction extends EventEmitter {
    storage: IStorage | null;
    transaction: Transaction | null;
    outputs: ISendOutput[];
    inputs: ISendInput[];
    changeAddress: string | null;
    pin: string | null;
    fullTxData: IDataTx | null;
    mineTransaction: MineTransaction | null;
    /**
     *
     * @param {IStorage} storage Storage object
     * @param {Object} [options={}] Options to initialize the facade
     * @param {Transaction|null} [options.transaction=null] Full tx data
     * @param {ISendInput[]} [options.inputs=[]] tx inputs
     * @param {ISendOutput[]} [options.outputs=[]] tx outputs
     * @param {string|null} [options.changeAddress=null] Address to use if we need to create a change output
     * @param {string|null} [options.pin=null] Wallet pin
     * @param {IStorage|null} [options.network=null] Network object
     */
    constructor({ storage, transaction, outputs, inputs, changeAddress, pin, }?: {
        storage?: IStorage | null;
        transaction?: Transaction | null;
        inputs?: ISendInput[];
        outputs?: ISendOutput[];
        changeAddress?: string | null;
        pin?: string | null;
    });
    /**
     * Prepare transaction data from inputs and outputs
     * Fill the inputs if needed, create output change if needed
     *
     * @throws SendTxError
     *
     * @return {Object} fullTxData with tokens array, inputs and outputs
     *
     * @memberof SendTransaction
     * @inner
     */
    prepareTxData(): Promise<IDataTx>;
    /**
     * Prepare transaction data from inputs and outputs
     * Fill the inputs if needed, create output change if needed and sign inputs
     *
     * @throws SendTxError
     *
     * @return {Transaction} Transaction object prepared to be mined
     *
     * @memberof SendTransaction
     * @inner
     */
    prepareTx(): Promise<Transaction>;
    /**
     * Prepare transaction to be mined from signatures
     *
     * The full tx data should already be prepared
     * since the signatures have already been made
     *
     * @params {Array<Buffer>} Array of Buffer, each being a signature of the tx data
     * The order of the signatures must match the inputs (private key used to sign should solve the input)
     *
     * @throws SendTxError
     *
     * @return {Transaction} Transaction object prepared to be mined
     *
     * @memberof SendTransaction
     * @inner
     */
    prepareTxFrom(signatures: Buffer[]): Promise<Transaction>;
    /**
     * Mine the transaction
     * Expects this.transaction to be prepared and signed
     * Emits MineTransaction events while the process is ongoing
     *
     * @params {Object} options Optional object with {'startMiningTx', 'maxTxMiningRetries'}
     *
     * @throws WalletError
     *
     * @memberof SendTransaction
     * @inner
     */
    mineTx(options?: {}): Promise<import("../wallet/types").MineTxSuccessData>;
    /**
     * Push tx to the network
     * If success, emits 'send-tx-success' event, otherwise emits 'send-error' event.
     *
     * @memberof SendTransaction
     * @inner
     */
    handlePushTx(): Promise<Transaction>;
    /**
     * Run sendTransaction from mining, i.e. expects this.transaction to be prepared and signed
     * then it will mine and push tx
     *
     * 'until' parameter can be 'mine-tx', in order to only mine the transaction without propagating
     *
     * @memberof SendTransaction
     * @inner
     */
    runFromMining(until?: null): Promise<Transaction>;
    /**
     * Method created for compatibility reasons
     * some people might be using the old facade and this start method just calls runFromMining
     *
     * @deprecated
     *
     * @memberof SendTransaction
     * @inner
     */
    start(): void;
    /**
     * Run sendTransaction from preparing, i.e. prepare, sign, mine and push the tx
     *
     * 'until' parameter can be 'prepare-tx' (it will stop before signing the tx),
     * or 'mine-tx' (it will stop before send tx proposal, i.e. propagating the tx)
     *
     * @memberof SendTransaction
     * @inner
     */
    run(until?: null): Promise<Transaction | null>;
    /**
     * Update the outputs of the tx data in localStorage to set 'selected_as_input'
     * This will prevent the input selection algorithm to select the same input before the
     * tx arrives from the websocket and set the 'spent_by' key
     *
     * @param {boolean} selected If should set the selected parameter as true or false
     *
     * */
    updateOutputSelected(selected: boolean): Promise<void>;
}
/**
 * Check the tx data and propose inputs and outputs to complete the transaction.
 * We will only check a single token
 *
 * @param {IStorage} storage
 * @param {IDataTx} dataTx
 * @param {IUtxoSelectionOptions} options
 */
export declare function prepareSendTokensData(storage: IStorage, dataTx: IDataTx, options?: IUtxoSelectionOptions): Promise<Pick<IDataTx, 'inputs' | 'outputs'>>;
/**
 * Check that the input is unspent, valid and available.
 * Will return a user-friendly message if it is not.
 *
 * @param {IStorage} storage The storage instance
 * @param {IDataInput} input The input we are checking
 * @param {string} selectedToken The token uid we are checking
 * @returns {Promise<{success: boolean, message: string}>}
 */
export declare function checkUnspentInput(storage: IStorage, input: IDataInput, selectedToken: string): Promise<{
    success: boolean;
    message: string;
}>;
//# sourceMappingURL=sendTransaction.d.ts.map