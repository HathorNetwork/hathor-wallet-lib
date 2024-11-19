/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import SendTransaction from '../new/sendTransaction';
import NanoContract from './nano_contract';
import Network from '../models/network';
import { IHistoryTx, IStorage } from '../types';
import { NanoContractArgumentType } from './types';
/**
 * Sign a transaction and create a send transaction object
 *
 * @param tx Transaction to sign and send
 * @param pin Pin to decrypt data
 * @param storage Wallet storage object
 */
export declare const prepareNanoSendTransaction: (tx: NanoContract, pin: string, storage: IStorage) => Promise<SendTransaction>;
/**
 * Get oracle buffer from oracle string (address in base58 or oracle data directly in hex)
 *
 * @param oracle Address in base58 or oracle data directly in hex
 * @param network Network to calculate the address
 */
export declare const getOracleBuffer: (oracle: string, network: Network) => Buffer;
/**
 * Get oracle input data
 *
 * @param oracleData Oracle data
 * @param resultSerialized Result to sign with oracle data already serialized
 * @param wallet Hathor Wallet object
 */
export declare const getOracleInputData: (oracleData: Buffer, resultSerialized: Buffer, wallet: HathorWallet) => Promise<Buffer>;
/**
 * Validate if nano contracts arguments match the expected ones from the blueprint method
 * It also converts arguments that come from clients in a different type than the expected,
 * e.g., bytes come as hexadecimal strings and address (bytes) come as base58 string.
 * We convert them to the expected type and update the original array of arguments
 *
 * @param blueprintId Blueprint ID
 * @param method Method name
 * @param args Arguments of the method to check if have the expected types
 *
 * Warning: This method can mutate the `args` parameter during its validation
 *
 * @throws NanoContractTransactionError in case the arguments are not valid
 * @throws NanoRequest404Error in case the blueprint ID does not exist on the full node
 */
export declare const validateAndUpdateBlueprintMethodArgs: (blueprintId: string, method: string, args: NanoContractArgumentType[] | null) => Promise<void>;
/**
 * Checks if a transaction is a nano contract create transaction
 *
 * @param tx History object from hathor core to check if it's a nano create tx
 */
export declare const isNanoContractCreateTx: (tx: IHistoryTx) => boolean;
//# sourceMappingURL=utils.d.ts.map