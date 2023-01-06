/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import CryptoJS from 'crypto-js';
import { HASH_ITERATIONS, HASH_KEY_SIZE } from '../constants';
import { IEncryptedData } from '../types';

export function hashData(
  data: string,
  { salt, iterations = HASH_ITERATIONS, pbkdf2Hasher = 'sha1'}: {salt?: string, iterations?: number, pbkdf2Hasher?: string},
  ): {hash: string, salt: string, iterations: number, pbkdf2Hasher: string} {
  const actualSalt = salt || CryptoJS.lib.WordArray.random(128 / 8).toString();

  // NIST has issued Special Publication SP 800-132 recommending PBKDF2
  // For further information, see https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf
  // The default hash algorithm used by CryptoJS.PBKDF2 is SHA1
  // https://github.com/brix/crypto-js/blob/develop/src/pbkdf2.js#L24
  const hash = CryptoJS.PBKDF2(data, actualSalt, {
    keySize: HASH_KEY_SIZE / 32,
    iterations: HASH_ITERATIONS,
  });

  return {
    hash: hash.toString(),
    salt: actualSalt,
    iterations,
    pbkdf2Hasher,
  };
}

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

function _decryptData(data: string, password: string): string {
  const decrypted = CryptoJS.AES.decrypt(data, password);
  return decrypted.toString(CryptoJS.enc.Utf8);
}

export function decryptData(data: IEncryptedData, password: string): string {
  const keyData = data.data;
  const hash = data.hash;
  const options = {
    salt: data.salt,
    iterations: data.iterations,
    pbkdf2Hasher: data.pbkdf2Hasher,
  };
  if (validateHash(password, hash, options)) {
    return _decryptData(keyData, password);
  } else {
    // FIXME: create custom error type for password errors
    throw new Error('Invalid password');
  }
}

export function validateHash(
  dataToValidate: string,
  hashedData: string,
  { salt, iterations = HASH_ITERATIONS, pbkdf2Hasher = 'sha1'}: {salt?: string, iterations?: number, pbkdf2Hasher?: string},
): boolean {
  const hash = hashData(dataToValidate, { salt, iterations, pbkdf2Hasher });
  return hash.hash === hashedData;
}