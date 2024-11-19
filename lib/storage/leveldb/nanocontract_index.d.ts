/// <reference types="node" />
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IKVNanoContractIndex, INcData } from 'src/types';
export declare const REGISTERED_PREFIX = "registered";
export default class LevelNanoContractIndex implements IKVNanoContractIndex {
    dbpath: string;
    /**
     * Registered Nano Contract database
     * Key: ncId
     * Value: INcData (json encoded)
     */
    registeredDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, INcData>;
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
    /**
     * Validate the database.
     * @returns {Promise<void>}
     */
    validate(): Promise<void>;
    /**
     * Delete all entries on the database.
     */
    clear(): Promise<void>;
    /**
     * Return if the nano contract is registered for the given ncId.
     *
     * @param ncId Nano Contract ID.
     * @returns `true` if registered and `false` otherwise.
     * @async
     */
    isNanoContractRegistered(ncId: string): Promise<boolean>;
    /**
     * Iterate over all registered nano contracts in the database
     *
     * @async
     * @generator
     * @returns {AsyncGenerator<INcData>}
     */
    registeredNanoContractsIter(): AsyncGenerator<INcData>;
    /**
     * Get a nano contract data on database from the ncId.
     *
     * @param ncId Nano Contract ID.
     * @returns Nano contract data instance.
     * @async
     */
    getNanoContract(ncId: string): Promise<INcData | null>;
    /**
     * Register a nano contract data.
     *
     * @param ncId Nano Contract ID.
     * @param ncValue Nano contract basic information.
     * @async
     */
    registerNanoContract(ncId: string, ncValue: INcData): Promise<void>;
    /**
     * Unregister nano contract.
     *
     * @param ncId Nano Contract ID.
     * @async
     */
    unregisterNanoContract(ncId: string): Promise<void>;
    /**
     * Update nano contract registered address.
     *
     * @param ncId Nano Contract ID.
     * @param address Nano Contract registered address.
     * @async
     */
    updateNanoContractRegisteredAddress(ncId: string, address: string): Promise<void>;
}
//# sourceMappingURL=nanocontract_index.d.ts.map