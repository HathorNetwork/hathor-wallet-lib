/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { Level } from 'level';
import { AbstractSublevel } from 'abstract-level';
import { IAddressInfo, IAddressMetadata, IKVAddressIndex, AddressIndexValidateResponse, IAddressMetadataAsRecord } from '../../types';
export declare const ADDRESS_PREFIX = "address";
export declare const INDEX_PREFIX = "index";
export declare const ADDRESS_META_PREFIX = "meta";
export default class LevelAddressIndex implements IKVAddressIndex {
    dbpath: string;
    /**
     * Main address database
     * Key: address in base58
     * Value: json encoded IAddressInfo
     */
    addressesDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IAddressInfo>;
    /**
     * Index database
     * Key: index in uint32
     * Value: address in base58
     */
    addressesIndexDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, string>;
    /**
     * Address metadata database
     * Key: address in base58
     * Value: json encoded IAddressMetadata
     */
    addressesMetaDB: AbstractSublevel<Level, string | Buffer | Uint8Array, string, IAddressMetadataAsRecord>;
    /**
     * Whether the index is validated or not
     * This is used to avoid using the address count before we know it is valid.
     */
    isValidated: boolean;
    indexVersion: string;
    size: number;
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
     * Validate the index consistency along with the sublevel children.
     * We check that all addresses in the addressesDB have an index in the addressesIndexDB.
     * @returns {Promise<AddressIndexValidateResponse>} The first and last index in the database
     */
    validate(): Promise<AddressIndexValidateResponse>;
    /**
     * Get the number of addresses saved in the database.
     *
     * leveldb does not have a count method and the feature request for this was rejected (see https://github.com/google/leveldb/issues/119).
     * As stated in the issue above "There is no way to implement count more efficiently inside leveldb than outside."
     * This means that the best way to count the number of entries would be to iterate on all keys and count them.
     * Another sugestion would be to have an external count of addresses, this is done with the this.size variable.
     *
     * The problem with this.size is that it is not updated when we start a database.
     * This is why we update the size when we validate the index and then we can use the pre-calculated size.
     * If the index has not been validated we will run a full count.
     * While a full count runs in O(n) it has been confirmed to be very fast with leveldb.
     * And since the wallet runs the validation when it starts we do not expect to use the full count with a running wallet.
     *
     * @returns {Promise<number>} The number of addresses in the database
     */
    addressCount(): Promise<number>;
    /**
     * Run a full count of the addresses in the database.
     *
     * @returns {Promise<number>} The number of addresses in the database
     */
    runAddressCount(): Promise<number>;
    /**
     * Fetch the address info from the database.
     * @param {string} base58 The address in base58
     * @returns {Promise<IAddressInfo|null>}
     */
    getAddressInfo(base58: string): Promise<IAddressInfo | null>;
    /**
     * Check if the address exists in the database.
     * @param {string} base58 The address in base58
     * @returns {Promise<boolean>} True if the address exists in the database.
     */
    addressExists(base58: string): Promise<boolean>;
    /**
     * Iterate on all addresses, ordered by the bip32 address index.
     *
     * The iteration is done on the db sorted by bip32 address index (addressesIndexDB)
     * This ensures an ordered iteration.
     *
     * @returns {AsyncGenerator<IAddressInfo>}
     */
    addressIter(): AsyncGenerator<IAddressInfo>;
    /**
     * Save an address metadata in the database.
     *
     * The meta argument type is IAddressMetadata that uses a Map which is unsupported
     * with leveldb native json encoding so we convert it to an object using Record instead.
     *
     * @param {string} address Address in base58
     * @param {IAddressMetadata} meta metadata to store
     */
    setAddressMeta(address: string, meta: IAddressMetadata): Promise<void>;
    /**
     * Fetch address metadata from the database.
     *
     * Due to Leveldb json encoding the type returned is IAddressMetadataAsRecord
     * Which we need to convert to IAddressMetadata before returning.
     *
     * @param base58 Address in base58
     * @returns {Promise<IAddressMetadata|null>}
     */
    getAddressMeta(base58: string): Promise<IAddressMetadata | null>;
    /**
     * Get address using its bip32 index.
     * @param index Address bip32 index
     * @returns {Promise<string|null>}
     */
    getAddressAtIndex(index: number): Promise<string | null>;
    /**
     * Save address on database.
     * @param info Address info to save
     */
    saveAddress(info: IAddressInfo): Promise<void>;
    /**
     * Clear the address metadata database.
     */
    clearMeta(): Promise<void>;
    /**
     * Clear the entire address database.
     */
    clear(): Promise<void>;
}
//# sourceMappingURL=address_index.d.ts.map