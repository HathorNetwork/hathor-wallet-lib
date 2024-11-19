"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.checkPassword = checkPassword;
exports.decryptData = decryptData;
exports.encryptData = encryptData;
exports.hashData = hashData;
exports.signMessage = signMessage;
exports.validateHash = validateHash;
exports.verifyMessage = verifyMessage;
var _cryptoJs = _interopRequireDefault(require("crypto-js"));
var _bitcoreLib = _interopRequireDefault(require("bitcore-lib"));
var _errors = require("../errors");
var _constants = require("../constants");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Monkey-patch MAGIC_BYTES to use Hathor's
_bitcoreLib.default.Message.MAGIC_BYTES = Buffer.from(_constants.HATHOR_MAGIC_BYTES);

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
function hashData(data, {
  salt,
  iterations = _constants.HASH_ITERATIONS,
  pbkdf2Hasher = 'sha1'
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HasherStatic type is not exported by its lib
  const hashers = new Map([['sha1', _cryptoJs.default.algo.SHA1], ['sha256', _cryptoJs.default.algo.SHA256]]);
  const hasher = hashers.get(pbkdf2Hasher);
  if (!hasher) {
    // Used an unsupported hasher algorithm
    throw new _errors.UnsupportedHasherError(`Invalid hasher: ${pbkdf2Hasher}`);
  }
  const actualSalt = salt || _cryptoJs.default.lib.WordArray.random(128 / 8).toString();

  // NIST has issued Special Publication SP 800-132 recommending PBKDF2
  // For further information, see https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf
  // The default hash algorithm used by CryptoJS.PBKDF2 is SHA1
  // https://github.com/brix/crypto-js/blob/develop/src/pbkdf2.js#L24
  const hash = _cryptoJs.default.PBKDF2(data, actualSalt, {
    keySize: _constants.HASH_KEY_SIZE / 32,
    hasher,
    iterations
  });
  return {
    hash: hash.toString(),
    salt: actualSalt,
    iterations,
    pbkdf2Hasher
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
function encryptData(data, password, {
  salt,
  iterations = _constants.HASH_ITERATIONS,
  pbkdf2Hasher = 'sha1'
} = {}) {
  const encrypted = _cryptoJs.default.AES.encrypt(data, password);
  const hash = hashData(password, {
    salt,
    iterations,
    pbkdf2Hasher
  });
  return {
    data: encrypted.toString(),
    ...hash
  };
}

/**
 * Decrypt and encode data.
 *
 * @param {string} data Encrypted string of data
 * @param {string} password Encryption password
 * @returns {string} Original data
 */
function _decryptData(data, password) {
  const decrypted = _cryptoJs.default.AES.decrypt(data, password);
  return decrypted.toString(_cryptoJs.default.enc.Utf8);
}

/**
 * Validate the password and decrypt the data
 *
 * @param {IEncryptedData} data Encrypted data, complete with metadata
 * @param {string} password The encryption password
 * @returns {string} The decrypted data
 */
function decryptData(data, password) {
  const keyData = data.data;
  const {
    hash
  } = data;
  const options = {
    salt: data.salt,
    iterations: data.iterations,
    pbkdf2Hasher: data.pbkdf2Hasher
  };
  if (validateHash(password, hash, options)) {
    try {
      const originalData = _decryptData(keyData, password);
      if (originalData.length === 0) {
        // For certain NodeJS versions the CryptoJS.lib.WordArray will not raise an exception for malformed data.
        // It will just return an empty string, so we throw an error to mark the data as invalid.
        throw new _errors.DecryptionError();
      }
      return originalData;
    } catch (err) {
      throw new _errors.DecryptionError();
    }
  } else {
    throw new _errors.InvalidPasswdError();
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
function validateHash(dataToValidate, hashedData, {
  salt,
  iterations = _constants.HASH_ITERATIONS,
  pbkdf2Hasher = 'sha1'
} = {}) {
  const hash = hashData(dataToValidate, {
    salt,
    iterations,
    pbkdf2Hasher
  });
  return hash.hash === hashedData;
}

/**
 * Check that the given password was used to encrypt the given data.
 * @param {IEncryptedData} data The encrypted data.
 * @param {string} password The password we want to check against the data.
 *
 * @returns {boolean}
 */
function checkPassword(data, password) {
  const options = {
    salt: data.salt,
    iterations: data.iterations,
    pbkdf2Hasher: data.pbkdf2Hasher
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
function signMessage(message, privateKey) {
  const signature = _bitcoreLib.default.Message(message).sign(privateKey);
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
function verifyMessage(message, signature, address) {
  const bitcoreLibMessage = new _bitcoreLib.default.Message(message);
  return bitcoreLibMessage.verify(new _bitcoreLib.default.Address(address), signature);
}