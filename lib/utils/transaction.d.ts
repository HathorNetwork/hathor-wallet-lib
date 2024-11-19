/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { Utxo } from '../wallet/types';
import { HistoryTransactionOutput } from '../models/types';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Network from '../models/network';
import { IBalance, IStorage, IHistoryTx, IDataOutput, IDataTx, IHistoryOutput, IUtxoId, ITxSignatureData, OutputValueType } from '../types';
declare const transaction: {
    /**
     * Return if a tx is a block or not.
     *
     * @param {Pick<IHistoryTx, 'version'>} tx - Transaction to check
     * @returns {boolean}
     */
    isBlock(tx: Pick<IHistoryTx, 'version'>): boolean;
    /**
     * Check if the output is an authority output
     *
     * @param {Pick<HistoryTransactionOutput, 'token_data'>} output An output with the token_data field
     * @returns {boolean} If the output is an authority output
     */
    isAuthorityOutput(output: Pick<HistoryTransactionOutput, 'token_data'>): boolean;
    /**
     * Check if the output is a mint authority output
     *
     * @param {Pick<HistoryTransactionOutput, 'token_data'|'value'>} output An output with the token_data and value fields
     * @returns {boolean} If the output is a mint authority output
     */
    isMint(output: Pick<HistoryTransactionOutput, 'token_data' | 'value'>): boolean;
    /**
     * Check if the output is a melt authority output
     *
     * @param {Pick<HistoryTransactionOutput, 'token_data'|'value'>} output An output with the token_data and value fields
     * @returns {boolean} If the output is a melt authority output
     */
    isMelt(output: Pick<HistoryTransactionOutput, 'token_data' | 'value'>): boolean;
    /**
     * Check if the utxo is locked
     *
     * @param {Pick<HistoryTransactionOutput, 'decoded'>} output The output to check
     * @param {{refTs: number|undefined}} options Use these values as reference to check if the output is locked
     * @returns {boolean} Wheather the output is locked or not
     */
    isOutputLocked(output: Pick<HistoryTransactionOutput, 'decoded'>, options?: {
        refTs?: number;
    }): boolean;
    /**
     * Check if an output in the given conditions would be height locked (or under reward lock)
     *
     * @param {number|undefined|null} blockHeight The height of the block
     * @param {number|undefined|null} currentHeight The height of the network
     * @param {number|undefined|null} rewardLock The reward lock of the network
     *
     * @returns {boolean} If the output is heightlocked
     */
    isHeightLocked(blockHeight: number | undefined | null, currentHeight: number | undefined | null, rewardLock: number | undefined | null): boolean;
    /**
     * Get the signature from the dataToSignHash for a private key
     *
     * @param {Buffer} dataToSignHash hash of a transaction's dataToSign.
     * @param {PrivateKey} privateKey Signing key.
     *
     * @returns {Buffer}
     *
     * @memberof transaction
     * @inner
     */
    getSignature(dataToSignHash: Buffer, privateKey: PrivateKey): Buffer;
    /**
     * Get the signatures for a transaction
     * @param tx Transaction to sign
     * @param storage Storage of the wallet
     * @param pinCode Pin to unlock the mainKey for signatures
     */
    getSignatureForTx(tx: Transaction, storage: IStorage, pinCode: string): Promise<ITxSignatureData>;
    /**
     * Signs a transaction using the provided storage and pin code.
     *
     * Warning: This function will mutate the transaction parameter
     *
     * @param tx - The transaction to be signed.
     * @param storage - The storage of the target wallet.
     * @param pinCode - The pin code used for retrieving signatures.
     * @returns The transaction object updated with the signatures.
     */
    signTransaction(tx: Transaction, storage: IStorage, pinCode: string): Promise<Transaction>;
    /**
     * Select best utxos with the algorithm described below. This method expects the utxos to be sorted by greatest value
     *
     * 1. If we have a single utxo capable of handle the full amount requested,
     * we return the utxo with smaller amount among the ones that have an amount bigger than the requested
     * 2. Otherwise we reverse sort the utxos by amount and select the utxos in order until the full amount is fulfilled.
     *
     * @memberof transaction
     * @inner
     */
    selectUtxos(utxos: Utxo[], totalAmount: OutputValueType): {
        utxos: Utxo[];
        changeAmount: OutputValueType;
    };
    /**
     * Convert an output from the history of transactions to an Utxo.
     *
     * @param {string} txId The transaction this output belongs to.
     * @param {number} index The output index on the original transaction.
     * @param {HistoryTransactionOutput} txout output from the transaction history.
     * @param {Object} [options]
     * @param {string} [options.addressPath=''] utxo address bip32 path
     *
     * @returns {Utxo}
     *
     * @memberof transaction
     */
    utxoFromHistoryOutput(txId: string, index: number, txout: HistoryTransactionOutput, { addressPath }: {
        addressPath?: string;
    }): Utxo;
    /**
     * Calculate the balance of a transaction
     *
     * @param tx Transaction to get balance from
     * @param storage Storage to get metadata from
     * @returns {Promise<Record<string, IBalance>>} Balance of the transaction
     */
    getTxBalance(tx: IHistoryTx, storage: IStorage): Promise<Record<string, IBalance>>;
    /**
     * Calculate the token balance of a transaction, including authorities, for a single token.
     * The balance will contain funds, mint and melt properties.
     * The funds property will contain the amount of tokens.
     * The mint and melt properties will contain the amount of mint and melt authorities.
     *
     * We will consider the balance from the inputs as negative and the outputs as positive
     * So that if the balance if positive we have a surplus of the token in the outputs.
     * If the balance is negative we have a deficit of the token in the outputs.
     *
     * Normal txs can be "unbalanced" when minting or melting tokens, but since we are not required to add the minted tokens on the inputs
     * Or conversely add the melted tokens on the outputs, we will ignore minted/melted funds.
     *
     * @param {string} token The token we want to calculate the balance.
     * @param {IDataTx} tx The transaction we want to calculate the balance.
     * @returns {Promise<Record<'funds'|'mint'|'melt', number>>} The balance of the given token on the transaction.
     */
    calculateTxBalanceToFillTx(token: string, tx: IDataTx): Promise<Record<'funds' | 'mint' | 'melt', OutputValueType>>;
    /**
     * Get the token_data for a given output
     *
     * @param {IDataOutput} output output data
     * @param {string[]} tokens List of tokens in the transaction
     * @returns {number} Calculated TokenData for the output token
     */
    getTokenDataFromOutput(output: IDataOutput, tokens: string[]): number;
    /**
     * Create output script
     *
     * @param {IDataOutput} output Output with data to create the script
     *
     * @throws {AddressError} If the address is invalid
     *
     * @return {Buffer} Output script
     */
    createOutputScript(output: IDataOutput, network: Network): Buffer;
    /**
     * Create a Transaction instance from tx data.
     *
     * @param {IDataTx} txData Tx data to create the transaction
     * @param {Network} network network to use
     * @returns {Transaction|CreateTokenTransaction}
     */
    createTransactionFromData(txData: IDataTx, network: Network): Transaction | CreateTokenTransaction;
    /**
     * Prepare a Transaction instance from the transaction data and storage
     *
     * @param tx tx data to be prepared
     * @param pinCode pin to unlock the mainKey for signatures
     * @param storage Storage to get the mainKey
     * @param {Object} [options]
     * @param {boolean} [options.signTx=true] sign transaction instance
     * @returns {Promise<Transaction|CreateTokenTransaction>} Prepared transaction
     */
    prepareTransaction(txData: IDataTx, pinCode: string, storage: IStorage, options?: {
        signTx?: boolean;
    }): Promise<Transaction | CreateTokenTransaction>;
    /**
     * Create P2PKH input data
     *
     * @param {Buffer} signature Input signature
     * @param {Buffer} publicKey Input public key
     * @returns {Buffer} Input data
     */
    createInputData(signature: Buffer, publicKey: Buffer): Buffer;
    /**
     * Calculate the authorities data for an output
     *
     * @param output History output
     * @returns {OutputValueType} Authorities from output
     */
    authoritiesFromOutput(output: Pick<IHistoryOutput, 'token_data' | 'value'>): OutputValueType;
    /**
     * Check if an utxo is available to be spent.
     *
     * @param {IUtxoId} utxo Utxo to check if we can use it
     * @param {IStorage} storage storage that may have the tx
     * @returns {Promise<boolean>}
     */
    canUseUtxo(utxo: IUtxoId, storage: IStorage): Promise<boolean>;
    /**
     * Get object type (Transaction or Block)
     *
     * @param {Pick<IHistoryTx, 'version'>} tx Object to get the type
     *
     * @return {string} Type of the object
     *
     * @memberof transaction
     * @inner
     */
    getTxType(tx: Pick<IHistoryTx, 'version'>): string;
};
export default transaction;
//# sourceMappingURL=transaction.d.ts.map