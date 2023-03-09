/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import CryptoJS from 'crypto-js';
import { HASH_ITERATIONS, HASH_KEY_SIZE } from '../constants';
import { IEncryptedData } from '../types';

/**
 * Hash a piece of information with the given options.
 *
 * @param {string} data Data to hash
 * @param {{salt: string, iterations: number, pbkdf2Hasher: string}} [options={}] options for the hash algo
 * @returns {{hash: string, salt: string, iterations: number, pbkdf2Hasher: string}}
 */
export function hashData(
  data: string,
  { salt, iterations = HASH_ITERATIONS, pbkdf2Hasher = 'sha1'}: {salt?: string, iterations?: number, pbkdf2Hasher?: string} = {},
  ): {hash: string, salt: string, iterations: number, pbkdf2Hasher: string} {
  const actualSalt = salt || CryptoJS.lib.WordArray.random(128 / 8).toString();

  // NIST has issued Special Publication SP 800-132 recommending PBKDF2
  // For further information, see https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf
  // The default hash algorithm used by CryptoJS.PBKDF2 is SHA1
  // https://github.com/brix/crypto-js/blob/develop/src/pbkdf2.js#L24
  const hash = CryptoJS.PBKDF2(data, actualSalt, {
    keySize: HASH_KEY_SIZE / 32,
    iterations,
  });

  return {
    hash: hash.toString(),
    salt: actualSalt,
    iterations,
    pbkdf2Hasher,
  };
}

/**
 * Encrypt a piece of information with a password and add metadata for password validation.
 *
 * @param {string} data Data to encrypt
 * @param {string} password Encryption password to use
 * @param {{salt: string, iterations: number, pbkdf2Hasher: string}} [options={}] Options to hash the password, for validation
 * @returns {IEncryptedData} Encrypted data with encryption metadata
 */
export function encryptData(
  data: string,
  password: string,
  {
    salt,
    iterations = HASH_ITERATIONS,
    pbkdf2Hasher = 'sha1',
  }: {salt?: string, iterations?: number, pbkdf2Hasher?: string} = {},
): IEncryptedData {
  const encrypted = CryptoJS.AES.encrypt(data, password);
  const hash = hashData(password, { salt, iterations, pbkdf2Hasher });
  return { data: encrypted.toString(), ...hash };
}

/**
 * Decrypt and encode data.
 *
 * @param {string} data Encrypted string of data
 * @param {string} password Encryption password
 * @returns {string} Original data
 */
function _decryptData(data: string, password: string): string {
  const decrypted = CryptoJS.AES.decrypt(data, password);
  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * Validate the password and decrypt the data
 *
 * @param {IEncryptedData} data Encrypted data, complete with metadata
 * @param {string} password The encryption password
 * @returns {string} The decrypted data
 */
export function decryptData(data: IEncryptedData, password: string): string {
  const keyData = data.data;
  const hash = data.hash;
  const options = {
    salt: data.salt,
    iterations: data.iterations,
    pbkdf2Hasher: data.pbkdf2Hasher,
  };
  if (validateHash(password, hash, options)) {
    try {
      const originalData = _decryptData(keyData, password);
      if (originalData.length === 0) {
        // For certain NodeJS versions the CryptoJS.lib.WordArray will not raise an exception for malformed data.
        // It will just return an empty string, so we throw an error to mark the data as invalid.
        throw new Error('Invalid data.');
      }
      return originalData;
    } catch (err: unknown) {
      throw new Error('Invalid data.');
    }
  } else {
    // FIXME: create custom error type for password errors
    throw new Error('Invalid password');
  }
}

/**
 * Validate that the hashed data matches the given data
 * Obs: This is used for password validation
 *
 * @param {string} dataToValidate What the caller thinks is the original data
 * @param {string} hashedData The hashed data we use to compare
 * @param {{salt: string, iterations: number, pbkdf2Hasher: string}} options Options for the hash algo
 * @returns {boolean} if the data matches
 */
export function validateHash(
  dataToValidate: string,
  hashedData: string,
  { salt, iterations = HASH_ITERATIONS, pbkdf2Hasher = 'sha1'}: {salt?: string, iterations?: number, pbkdf2Hasher?: string} = {},
): boolean {
  const hash = hashData(dataToValidate, { salt, iterations, pbkdf2Hasher });
  return hash.hash === hashedData;
}