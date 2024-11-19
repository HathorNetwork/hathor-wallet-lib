/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import bitcore from 'bitcore-lib';
import { IEncryptedData } from '../types';
/**
 * Hash a piece of information with the given options.
 *
 * pbkdf2Hasher is the name of the hash implementation to use with PBKDF2.
 * Currently supported hash algorithms are:
 * - sha1
 * - sha256
 *
 * @param {string} data Data to hash
 * @param {{salt: string, iterations: number, pbkdf2Hasher: string}} [options={}] options for the hash algo
 * @returns {{hash: string, salt: string, iterations: number, pbkdf2Hasher: string}}
 */
export declare function hashData(data: string, { salt, iterations, pbkdf2Hasher, }?: {
    salt?: string;
    iterations?: number;
    pbkdf2Hasher?: string;
}): {
    hash: string;
    salt: string;
    iterations: number;
    pbkdf2Hasher: string;
};
/**
 * Encrypt a piece of information with a password and add metadata for password validation.
 *
 * @param {string} data Data to encrypt
 * @param {string} password Encryption password to use
 * @param {{salt: string, iterations: number, pbkdf2Hasher: string}} [options={}] Options to hash the password, for validation
 * @returns {IEncryptedData} Encrypted data with encryption metadata
 */
export declare function encryptData(data: string, password: string, { salt, iterations, pbkdf2Hasher, }?: {
    salt?: string;
    iterations?: number;
    pbkdf2Hasher?: string;
}): IEncryptedData;
/**
 * Validate the password and decrypt the data
 *
 * @param {IEncryptedData} data Encrypted data, complete with metadata
 * @param {string} password The encryption password
 * @returns {string} The decrypted data
 */
export declare function decryptData(data: IEncryptedData, password: string): string;
/**
 * Validate that the hashed data matches the given data
 * Obs: This is used for password validation
 *
 * @param {string} dataToValidate What the caller thinks is the original data
 * @param {string} hashedData The hashed data we use to compare
 * @param {{salt: string, iterations: number, pbkdf2Hasher: string}} options Options for the hash algo
 * @returns {boolean} if the data matches
 */
export declare function validateHash(dataToValidate: string, hashedData: string, { salt, iterations, pbkdf2Hasher, }?: {
    salt?: string;
    iterations?: number;
    pbkdf2Hasher?: string;
}): boolean;
/**
 * Check that the given password was used to encrypt the given data.
 * @param {IEncryptedData} data The encrypted data.
 * @param {string} password The password we want to check against the data.
 *
 * @returns {boolean}
 */
export declare function checkPassword(data: IEncryptedData, password: string): boolean;
/**
 * Signs an arbitrary message given a private key
 * @param {string} message The message to be signed using a privateKey
 * @param {bitcore.PrivateKey} privateKey The privateKey to sign the message with
 *
 * @returns {string} Base64 encoded signature
 */
export declare function signMessage(message: string, privateKey: bitcore.PrivateKey): string;
/**
 * Verifies that a message was signed with an address' privateKey
 *
 * @param {string} message The message to be signed using a privateKey
 * @param {string} signature The signature in base64
 * @param {string} address The address which the message was signed with
 *
 * @returns {boolean}
 */
export declare function verifyMessage(message: string, signature: string, address: string): boolean;
//# sourceMappingURL=crypto.d.ts.map