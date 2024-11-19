/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { EventEmitter } from 'events';
import HathorWalletServiceWallet from './wallet';
import Transaction from '../models/transaction';
import Output from '../models/output';
import Input from '../models/input';
import { OutputSendTransaction, InputRequestObj, TokenAmountMap, ISendTransaction, MineTxSuccessData } from './types';
type optionsType = {
    outputs?: OutputSendTransaction[];
    inputs?: InputRequestObj[];
    changeAddress?: string | null;
    transaction?: Transaction | null;
    pin?: string | null;
};
declare class SendTransactionWalletService extends EventEmitter implements ISendTransaction {
    private wallet;
    private outputs;
    private inputs;
    private changeAddress;
    private transaction;
    private mineTransaction;
    private pin;
    constructor(wallet: HathorWalletServiceWallet, options?: optionsType);
    /**
     * Prepare transaction data to send
     * Get utxos from wallet service, creates change outpus and returns a Transaction object
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    prepareTx(): Promise<{
        transaction: Transaction;
        utxosAddressPath: string[];
    }>;
    /**
     * Map input data to an input object
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    inputDataToModel(input: InputRequestObj): Input;
    /**
     * Map output data to an output object
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    outputDataToModel(output: OutputSendTransaction, tokens: string[]): Output;
    /**
     * Check if the utxos selected are valid and the sum is enough to
     * fill the outputs. If needed, create change output
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    validateUtxos(tokenAmountMap: TokenAmountMap): Promise<string[]>;
    /**
     * Select utxos to be used in the transaction
     * Get utxos from wallet service and creates change output if needed
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    selectUtxosToUse(tokenAmountMap: TokenAmountMap): Promise<string[]>;
    /**
     * Signs the inputs of a transaction
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    signTx(utxosAddressPath: string[]): Promise<void>;
    /**
     * Mine the transaction
     * Expects this.transaction to be prepared and signed
     * Emits MineTransaction events while the process is ongoing
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    mineTx(options?: {}): Promise<MineTxSuccessData>;
    /**
     * Create and send a tx proposal to wallet service
     * Expects this.transaction to be prepared, signed and mined
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    handleSendTxProposal(): Promise<Transaction>;
    /**
     * Run sendTransaction from mining, i.e. expects this.transaction to be prepared and signed
     * then it will mine and handle tx proposal
     *
     * 'until' parameter can be 'mine-tx', in order to only mine the transaction without propagating
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    runFromMining(until?: string | null): Promise<Transaction>;
    /**
     * Run sendTransaction from preparing, i.e. prepare, sign, mine and send the tx
     *
     * 'until' parameter can be 'prepare-tx' (it will stop before signing the tx), 'sign-tx' (it will stop before mining the tx),
     * or 'mine-tx' (it will stop before send tx proposal, i.e. propagating the tx)
     *
     * @memberof SendTransactionWalletService
     * @inner
     */
    run(until?: string | null): Promise<Transaction>;
}
export default SendTransactionWalletService;
//# sourceMappingURL=sendTransactionWalletService.d.ts.map