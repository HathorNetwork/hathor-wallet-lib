/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import CryptoJS from 'crypto-js';
import Mnemonic from 'bitcore-mnemonic';
import bitcore from 'bitcore-lib';
import { DecryptionError, InvalidPasswdError } from '../../src/errors';
import { HD_WALLET_ENTROPY } from '../../src/constants';
import {
  hashData,
  validateHash,
  encryptData,
  decryptData,
  checkPassword,
  signMessage,
  verifyMessage,
} from '../../src/utils/crypto';
import Network from '../../src/models/network';

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

test('sign message', () => {
  const message = 'please sign me';
  const xpriv = new bitcore.HDPrivateKey('tnpr4nfUjEyefVuczz8pYwkHUDD9Q96mP3q7jc3oDgdV6FEkTArttdZLrMWhCvRmvJ48jnKR5dHDrA13sk1qFwUujnzZt2ry9EgDzty3UjdhFsD');
  const firstAddressHDPrivKey = xpriv.derive('m/44\'/280\'/0\'/0/0'); // first address
  const { privateKey } = firstAddressHDPrivKey;
  const firstAddress = privateKey.toAddress().toString();

  expect(firstAddress).toStrictEqual('Wf6Jv8HVfAj51YojncmUupSqjhrtiQZatc');

  const signature = signMessage(message, privateKey);
  expect(verifyMessage(message, signature, firstAddress)).toBeTruthy();
});

test('verify message', () => {
  const message = 'please sign me';
  const validSignatures = [
    'IH8LTK3IkGKVY/X+UNsvQGtp3wdqXZE9yRML3QoNGEPtSctLXQccnsIlzJOl0/CQicZeRozEf5n7e1zrYR6koJk=',
    'H55ZDirQLKtLedu/TAbkmjulUYpotl2O8hwiKKnReAepGXtgKljLxQ9Vj3TyeNTlYzokb9z7TAPAx+HZKjR2ChQ=',
    'H/fZfIVeMavGjiv5Sbo+KSzLyqG5Cgt56EKOaemkPqzgYQbhVMjWEtJ1y6fgBlJ1uva3hcz936tKyc/IZgXjZyI=',
    'INPSv7XajbjmPEPJOIKpP8ZJksP4vRHTZ+W6Qt1VBEscRGlvTHXgcFf2UIf3B0M8+J90hU53bSivkHbWNVHNgQs='
  ];

  const invalidSignatures = [
    'IEMMfe3h9S+nQR3jPGXKH21L/8I62bebYpUhvw9cWabwV9b/hPfe8IeRQQoHKS9NXe+G+0St+UGCgnS6aDuYQfw=',
    'IHcS3C8rdBi9e2pa1vv7ZuaPI/pA3EKFGyskuVnxZyvyR01eIHtCIghKuff5W+Tl62dfjy9xJaxKkFTftn0JcGc=',
    'H3czFquha5Fgz4xD3W6jQp3WNNBRC6yvfk9K0/+PRGtEcq42dbczB8BJrdIRsZJ7BRMXcVJf1SkFj9aM095Vu2U=',
    'IM8KDd87eHlTdHhnlEulT3FLKz/n3qfcQdEZKD5CoNQPKf5+lsorcLoCY4k6qQGuGIgSxLNR4VLf1DEKRlrAOPc=',
  ];

  const address = 'Wf6Jv8HVfAj51YojncmUupSqjhrtiQZatc';

  for (const signature of validSignatures) {
    expect(verifyMessage(message, signature, address)).toBeTruthy();
  }

  for (const signature of invalidSignatures) {
    expect(verifyMessage(message, signature, address)).toBeFalsy();
  }
});
