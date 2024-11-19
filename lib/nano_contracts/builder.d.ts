/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import Output from '../models/output';
import Input from '../models/input';
import NanoContract from './nano_contract';
import HathorWallet from '../new/wallet';
import { NanoContractAction, NanoContractArgumentApiInputType, NanoContractArgumentType } from './types';
declare class NanoContractTransactionBuilder {
    blueprintId: string | null | undefined;
    ncId: string | null | undefined;
    method: string | null;
    actions: NanoContractAction[] | null;
    caller: Buffer | null;
    args: NanoContractArgumentType[] | null;
    transaction: NanoContract | null;
    wallet: HathorWallet | null;
    constructor();
    /**
     * Set object method attribute
     *
     * @param method Method name
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    setMethod(method: string): this;
    /**
     * Set object actions attribute
     *
     * @param actions List of actions
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    setActions(actions: NanoContractAction[]): this;
    /**
     * Set object args attribute
     *
     * @param args List of arguments
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    setArgs(args: NanoContractArgumentApiInputType[]): this;
    /**
     * Set object caller attribute
     *
     * @param caller caller public key
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    setCaller(caller: Buffer): this;
    /**
     * Set object blueprintId attribute
     *
     * @param blueprintId Blueprint id
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    setBlueprintId(blueprintId: string): this;
    /**
     * Set object ncId attribute
     *
     * @param {ncId} Nano contract id
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    setNcId(ncId: string): this;
    /**
     * Set object wallet attribute
     *
     * @param {wallet} Wallet object building this transaction
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    setWallet(wallet: HathorWallet): this;
    /**
     * Execute a deposit action
     * Create inputs (and maybe change outputs) to complete the deposit
     *
     * @param {action} Action to be completed (must be a deposit type)
     * @param {tokens} Array of tokens to get the token data correctly
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    executeDeposit(action: NanoContractAction, tokens: string[]): Promise<[Input[], Output[]]>;
    /**
     * Execute a withdrawal action
     * Create outputs to complete the withdrawal
     *
     * @param {action} Action to be completed (must be a withdrawal type)
     * @param {tokens} Array of tokens to get the token data correctly
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    executeWithdrawal(action: NanoContractAction, tokens: string[]): Output;
    /**
     * Build the nano contract transaction
     *
     * @memberof NanoContractTransactionBuilder
     * @inner
     */
    build(): Promise<NanoContract>;
}
export default NanoContractTransactionBuilder;
//# sourceMappingURL=builder.d.ts.map