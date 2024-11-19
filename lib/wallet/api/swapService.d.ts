/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { AtomicSwapProposal } from '../../models/types';
/**
 * Encrypts a string ( PartialTx or Signatures ) before sending it to the backend
 * @param serialized
 * @param password
 */
export declare function encryptString(serialized: string, password: string): string;
/**
 * Decrypts a string ( PartialTx or Signatures ) from the backend
 * @param serialized
 * @param password
 */
export declare function decryptString(serialized: string, password: string): string;
/**
 * Hashes the password to use it as an authentication on the backend
 * @param {string} password
 * @returns {string} hashed password
 */
export declare function hashPassword(password: any): string;
/**
 * Calls the Atomic Swap Service requesting the creation of a new proposal identifier for the informed partialTx.
 * @param serializedPartialTx
 * @param password
 * @return Promise<{ success: boolean, id: string }>
 * @throws {Error} When the swap service network is not configured
 * @example
 * const results = await create('PartialTx|0001000000000000000000000063f78c0e0000000000||', 'pass123')
 */
export declare const create: (serializedPartialTx: string, password: string) => Promise<{
    success: boolean;
    id: string;
}>;
/**
 * Fetches from the Atomic Swap Service the most up-to-date version of the proposal by the given id
 * and decrypts it locally
 * @throws {Error} When the swap service network is not configured
 * @throws {Error} When the password is incorrect and the proposal cannot be decoded
 * @param proposalId
 * @param password
 * @example
 * const results = await get('b4a5b077-c599-41e8-a791-85e08efcb1da', 'pass123')
 */
export declare const get: (proposalId: string, password: string) => Promise<AtomicSwapProposal>;
interface SwapUpdateParams {
    proposalId: string;
    password: string;
    partialTx: string;
    version: number;
    signatures?: string;
}
/**
 * Updates the proposal on the Atomic Swap Service with the parameters informed
 */
export declare const update: (params: SwapUpdateParams) => Promise<{
    success: boolean;
}>;
export {};
//# sourceMappingURL=swapService.d.ts.map