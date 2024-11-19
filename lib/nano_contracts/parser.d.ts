/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import Address from '../models/address';
import Network from '../models/network';
import { NanoContractParsedArgument } from './types';
declare class NanoContractTransactionParser {
    blueprintId: string;
    method: string;
    publicKey: string;
    network: Network;
    address: Address | null;
    args: string | null;
    parsedArgs: NanoContractParsedArgument[] | null;
    constructor(blueprintId: string, method: string, publicKey: string, network: Network, args: string | null);
    /**
     * Parse the nano public key to an address object
     *
     * @memberof NanoContractTransactionParser
     * @inner
     */
    parseAddress(): void;
    /**
     * Parse the arguments in hex into a list of parsed arguments
     *
     * @memberof NanoContractTransactionParser
     * @inner
     */
    parseArguments(): Promise<void>;
}
export default NanoContractTransactionParser;
//# sourceMappingURL=parser.d.ts.map