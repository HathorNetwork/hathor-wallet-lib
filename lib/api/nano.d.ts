/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { NanoContractBlueprintInformationAPIResponse, NanoContractHistoryAPIResponse, NanoContractStateAPIResponse } from '../nano_contracts/types';
/**
 * Api calls for nano contracts
 *
 * @namespace ApiNanoContracts
 */
declare const ncApi: {
    /**
     * Call get nano contracts state API
     *
     * @param id Nano Contract ID
     * @param fields Array of fields to get state
     * @param balances Array of balances to get state
     * @param calls Array of private method calls to execute in the nano contract and get the result
     * @param block_hash Hash of the block to get the state of the nano
     * @param block_height Height of the block to get the state of the nano
     *
     * @memberof ApiNanoContracts
     * @inner
     */
    getNanoContractState(id: string, fields: string[], balances: string[], calls: string[], block_hash?: string | null, block_height?: number | null): Promise<NanoContractStateAPIResponse>;
    /**
     * Call get nano contracts history API
     *
     * @param id Nano Contract ID
     * @param count Quantity of elements to return
     * @param after Used for pagination in the results
     * @param before Used for pagination in the results
     *
     * @memberof ApiNanoContracts
     * @inner
     */
    getNanoContractHistory(id: string, count?: number | null, after?: string | null, before?: string | null): Promise<NanoContractHistoryAPIResponse>;
    /**
     * Call get blueprint information
     *
     * @param id Blueprint ID
     *
     * @return {Promise}
     * @memberof ApiNanoContracts
     * @inner
     */
    getBlueprintInformation(id: string): Promise<NanoContractBlueprintInformationAPIResponse>;
};
export default ncApi;
//# sourceMappingURL=nano.d.ts.map