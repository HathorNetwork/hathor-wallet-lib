/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import CryptoJS from 'crypto-js';
import { DecryptionError, InvalidPasswdError } from '../../src/errors';
import { hashData, validateHash, encryptData, decryptData, checkPassword } from '../../src/utils/crypto';

test('validateHash', () => {
  const data = 'a-valid-data';
  const hashedData = hashData(data);

  expect(validateHash(
    data,
    hashedData.hash,
    {
      salt: hashedData.salt,
      iterations: hashedData.iterations,
      pbkdf2Hasher: hashedData.pbkdf2Hasher,
    }
  )).toBe(true);

  const wrongSalt = CryptoJS.lib.WordArray.random(128 / 8).toString();
  expect(validateHash(
    data,
    hashedData.hash,
    {
      salt: wrongSalt,
      iterations: hashedData.iterations,
      pbkdf2Hasher: hashedData.pbkdf2Hasher,
    }
  )).toBe(false);
});

test('encryption test', () => {
  const data = 'a-valid-data';
  const passwd = 'a-valid-passwd';
  const encrypted = encryptData(data, passwd);

  // Password will be hashed for password and pinCode validations
  expect(validateHash(
    passwd,
    encrypted.hash,
    {
      salt: encrypted.salt,
      iterations: encrypted.iterations,
      pbkdf2Hasher: encrypted.pbkdf2Hasher,
    },
  )).toBe(true);

  // Decryption should only work with the correct password and data
  expect(decryptData(encrypted, passwd)).toEqual('a-valid-data');
  expect(() => { decryptData(encrypted, 'invalid-passwd') }).toThrowError(InvalidPasswdError);
  const invalidData = {
    data: 'an-invalid-data',
    hash: encrypted.hash,
    salt: encrypted.salt,
    iterations: encrypted.iterations,
    pbkdf2Hasher: encrypted.pbkdf2Hasher,
  };
  expect(() => { decryptData(invalidData, passwd) }).toThrowError(DecryptionError);
});

test('check password', () => {
  const data = 'a-valid-data';
  const passwd = 'a-valid-passwd';
  const invalidPasswd = 'an-invalid-passwd';
  const encrypted = encryptData(data, passwd);

  expect(checkPassword(encrypted, passwd)).toEqual(true)
  expect(checkPassword(encrypted, invalidPasswd)).toEqual(false)
});
