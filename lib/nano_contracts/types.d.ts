/// <reference types="node" />
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { IHistoryTx, OutputValueType } from '../types';
export declare enum NanoContractActionType {
    DEPOSIT = "deposit",
    WITHDRAWAL = "withdrawal"
}
export type NanoContractArgumentApiInputType = string | number | OutputValueType | boolean | null;
export type NanoContractArgumentType = NanoContractArgumentApiInputType | Buffer;
export interface NanoContractAction {
    type: NanoContractActionType.DEPOSIT | NanoContractActionType.WITHDRAWAL;
    token: string;
    amount: OutputValueType;
    address: string | null;
    changeAddress: string | null;
}
export interface NanoContractParsedArgument {
    name: string;
    type: string;
    parsed: NanoContractArgumentType;
}
export interface MethodArgInfo {
    name: string;
    type: string;
}
interface MethodInfo {
    args: MethodArgInfo[];
    return_type?: string;
}
export interface NanoContractBlueprintInformationAPIResponse {
    id: string;
    name: string;
    attributes: Map<string, string>;
    public_methods: Map<string, MethodInfo>;
    private_methods: Map<string, MethodInfo>;
}
export interface NanoContractHistoryAPIResponse {
    success: boolean;
    count: number;
    after?: string;
    history: IHistoryTx[];
}
interface StateValueSuccess {
    value: NanoContractArgumentApiInputType;
}
interface StateValueError {
    errmsg: string;
}
export interface NanoContractStateAPIResponse {
    success: boolean;
    nc_id: string;
    blueprint_name: string;
    fields: Map<string, StateValueSuccess | StateValueError>;
    balances: Map<string, StateValueSuccess | StateValueError>;
    calls: Map<string, StateValueSuccess | StateValueError>;
}
export interface NanoContractStateAPIParameters {
    id: string;
    fields: string[];
    balances: string[];
    calls: string[];
    block_hash?: string;
    block_height?: number;
}
export {};
//# sourceMappingURL=types.d.ts.map