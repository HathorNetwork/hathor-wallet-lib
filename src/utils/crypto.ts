/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import CryptoJS from 'crypto-js';
import bitcore from 'bitcore-lib';
import { DecryptionError, InvalidPasswdError, UnsupportedHasherError } from '../errors';
import { HATHOR_MAGIC_BYTES, HASH_ITERATIONS, HASH_KEY_SIZE } from '../constants';
import { IEncryptedData } from '../types';

// Monkey-patch MAGIC_BYTES to use Hathor's
bitcore.Message.MAGIC_BYTES = Buffer.from(HATHOR_MAGIC_BYTES);

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
export function hashData(
  data: string,
  {
    salt,
    iterations = HASH_ITERATIONS,
    pbkdf2Hasher = 'sha1',
  }: { salt?: string; iterations?: number; pbkdf2Hasher?: string } = {}
): { hash: string; salt: string; iterations: number; pbkdf2Hasher: string } {
  const hashers = new Map<string, any>([
    ['sha1', CryptoJS.algo.SHA1],
    ['sha256', CryptoJS.algo.SHA256],
  ]);

  const hasher = hashers.get(pbkdf2Hasher);
  if (!hasher) {
    // Used an unsupported hasher algorithm
    throw new UnsupportedHasherError(`Invalid hasher: ${pbkdf2Hasher}`);
  }

  const actualSalt = salt || CryptoJS.lib.WordArray.random(128 / 8).toString();

  // NIST has issued Special Publication SP 800-132 recommending PBKDF2
  // For further information, see https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf
  // The default hash algorithm used by CryptoJS.PBKDF2 is SHA1
  // https://github.com/brix/crypto-js/blob/develop/src/pbkdf2.js#L24
  const hash = CryptoJS.PBKDF2(data, actualSalt, {
    keySize: HASH_KEY_SIZE / 32,
    hasher,
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
  }: { salt?: string; iterations?: number; pbkdf2Hasher?: string } = {}
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
  const { hash } = data;
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
        throw new DecryptionError();
      }
      return originalData;
    } catch (err: unknown) {
      throw new DecryptionError();
    }
  } else {
    throw new InvalidPasswdError();
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
  {
    salt,
    iterations = HASH_ITERATIONS,
    pbkdf2Hasher = 'sha1',
  }: { salt?: string; iterations?: number; pbkdf2Hasher?: string } = {}
): boolean {
  const hash = hashData(dataToValidate, { salt, iterations, pbkdf2Hasher });
  return hash.hash === hashedData;
}

/**
 * Check that the given password was used to encrypt the given data.
 * @param {IEncryptedData} data The encrypted data.
 * @param {string} password The password we want to check against the data.
 *
 * @returns {boolean}
 */
export function checkPassword(data: IEncryptedData, password: string): boolean {
  const options = {
    salt: data.salt,
    iterations: data.iterations,
    pbkdf2Hasher: data.pbkdf2Hasher,
  };
  return validateHash(password, data.hash, options);
}

/**
 * Signs an arbitrary message given a private key
 * @param {string} message The message to be signed using a privateKey
 * @param {bitcore.PrivateKey} privateKey The privateKey to sign the message with
 *
 * @returns {string} Base64 encoded signature
 */
export function signMessage(message: string, privateKey: bitcore.PrivateKey): string {
  const signature = bitcore.Message(message).sign(privateKey);
  return signature;
}

/**
 * Verifies that a message was signed with an address' privateKey
 *
 * @param {string} message The message to be signed using a privateKey
 * @param {string} signature The signature in base64
 * @param {string} address The address which the message was signed with
 *
 * @returns {boolean}
 */
export function verifyMessage(message: string, signature: string, address: string): boolean {
  const bitcoreLibMessage = new bitcore.Message(message);

  return bitcoreLibMessage.verify(new bitcore.Address(address), signature);
}
