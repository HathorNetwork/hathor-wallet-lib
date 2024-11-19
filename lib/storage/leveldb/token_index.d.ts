/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVTokenIndex, ITokenData, ITokenMetadata } from '../../types';
export declare const TOKEN_PREFIX = "token";
export declare const META_PREFIX = "meta";
export declare const REGISTER_PREFIX = "registered";
export default class LevelTokenIndex implements IKVTokenIndex {
    dbpath: string;
    /**
     * Main token database
     * Key: uid
     * Value: ITokenData (json encoded)
     */
    tokenDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenData>;
    /**
     * Token metadata database
     * Key: uid
     * Value: ITokenMetadata (json encoded)
     */
    metadataDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenMetadata>;
    /**
     * Registered tokens database
     * Key: uid
     * Value: ITokenData (json encoded)
     */
    registeredDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, ITokenData>;
    indexVersion: string;
    constructor(dbpath: string);
    /**
     * Close the database and the sublevel children.
     * @returns {Promise<void>}
     */
    close(): Promise<void>;
    /**
     * Check that the index version matches the expected version.
     * @returns {Promise<void>}
     */
    checkVersion(): Promise<void>;
    validate(): Promise<void>;
    /**
     * Iterate over all tokens in the database
     * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
     */
    tokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    /**
     * Iterate over all registered tokens in the database
     * @returns {AsyncGenerator<ITokenData & Partial<ITokenMetadata>>}
     */
    registeredTokenIter(): AsyncGenerator<ITokenData & Partial<ITokenMetadata>>;
    /**
     * Check if a token is on the database
     * @param {string} tokenUid
     * @returns {Promise<boolean>}
     */
    hasToken(tokenUid: string): Promise<boolean>;
    /**
     * Get a token from the database.
     * @param {string} uid
     * @returns {Promise<(ITokenData & Partial<ITokenMetadata>)|null>}
     */
    getToken(uid: string): Promise<(ITokenData & Partial<ITokenMetadata>) | null>;
    /**
     * Get a token metadata from the database.
     * @param {string} uid
     * @returns {Promise<ITokenMetadata|null>}
     */
    getTokenMetadata(uid: string): Promise<ITokenMetadata | null>;
    /**
     * Save a token to the database.
     * @param {ITokenData} token Token to be saved
     * @returns {Promise<void>}
     */
    saveToken(token: ITokenData): Promise<void>;
    /**
     * Save a token metadata to the database.
     * @param {string} uid token uid
     * @param {ITokenMetadata} meta Token metadata to be saved
     * @returns {Promise<void>}
     */
    saveMetadata(uid: string, meta: ITokenMetadata): Promise<void>;
    /**
     * Add a token to the registered list.
     * @param {ITokenData} token Token to register
     * @returns {Promise<void>}
     */
    registerToken(token: ITokenData): Promise<void>;
    /**
     * Remove a token from the registered list.
     * @param {string} tokenUid Token uid to unregister
     * @returns {Promise<void>}
     */
    unregisterToken(tokenUid: string): Promise<void>;
    /**
     * Return if a token is registered.
     * @param tokenUid - Token id
     * @returns {Promise<boolean>}
     */
    isTokenRegistered(tokenUid: string): Promise<boolean>;
    /**
     * Delete a token from the database.
     * @param {string[]} tokens List of token uids to be deleted
     */
    deleteTokens(tokens: string[]): Promise<void>;
    /**
     * Edit token metadata
     * @param {string} tokenUid token uid
     * @param {Partial<ITokenMetadata>} meta metadata to add
     * @returns {Promise<void>}
     */
    editTokenMeta(tokenUid: string, meta: ITokenMetadata): Promise<void>;
    /**
     * Clear metadata index.
     * @returns {Promise<void>}
     */
    clearMeta(): Promise<void>;
    /**
     * Clear all entries from the database.
     * @param {boolean} [cleanIndex=true] Delete all token and meta keys.
     * @param {boolean} [cleanRegisteredTokens=false] Delete all registered token keys.
     * @returns {Promise<void>}
     */
    clear(cleanIndex?: boolean, cleanRegisteredTokens?: boolean): Promise<void>;
}
//# sourceMappingURL=token_index.d.ts.map