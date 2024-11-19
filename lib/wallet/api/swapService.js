"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.create = void 0;
exports.decryptString = decryptString;
exports.encryptString = encryptString;
exports.get = void 0;
exports.hashPassword = hashPassword;
exports.update = void 0;
var _axios = _interopRequireDefault(require("axios"));
var _sha = _interopRequireDefault(require("crypto-js/sha256"));
var _aes = _interopRequireDefault(require("crypto-js/aes"));
var _cryptoJs = _interopRequireDefault(require("crypto-js"));
var _lodash = require("lodash");
var _partial_tx = require("../../models/partial_tx");
var _constants = require("../../constants");
var _config = _interopRequireDefault(require("../../config"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * This interface represents the type returned on the HTTP response, with its untreated and encrypted data.
 * The results should be translated to an `AtomicSwapProposal` interface before being sent out of this service.
 */

/**
 * Encrypts a string ( PartialTx or Signatures ) before sending it to the backend
 * @param serialized
 * @param password
 */
function encryptString(serialized, password) {
  if (!serialized) {
    throw new Error('Missing encrypted string');
  }
  if (!password) {
    throw new Error('Missing password');
  }
  const aesEncryptedObject = _aes.default.encrypt(serialized, password);

  // Serializing the cipher output in Base64 to avoid loss of encryption parameter data
  const baseEncryptedObj = _cryptoJs.default.enc.Base64.parse(aesEncryptedObject.toString());
  return _cryptoJs.default.enc.Base64.stringify(baseEncryptedObj);
}

/**
 * Decrypts a string ( PartialTx or Signatures ) from the backend
 * @param serialized
 * @param password
 */
function decryptString(serialized, password) {
  if (!serialized) {
    throw new Error('Missing encrypted string');
  }
  if (!password) {
    throw new Error('Missing password');
  }
  const aesDecryptedObject = _aes.default.decrypt(serialized, password);
  return aesDecryptedObject.toString(_cryptoJs.default.enc.Utf8);
}

/**
 * Hashes the password to use it as an authentication on the backend
 * @param {string} password
 * @returns {string} hashed password
 */
function hashPassword(password) {
  return (0, _sha.default)(password).toString();
}

/**
 * Returns an axios instance pre-configured for interacting with the Atomic Swap Service
 * @param [timeout] Optional timeout, defaults to the lib's timeout constant
 * @param [network] Optional network. If not present, defaults connection to the lib's configured baseUrl
 */
// eslint-disable-next-line default-param-last -- XXX: This method should be refactored
const axiosInstance = async (timeout = _constants.TIMEOUT, network) => {
  const swapServiceBaseUrl = _config.default.getSwapServiceBaseUrl(network);
  const defaultOptions = {
    baseURL: swapServiceBaseUrl,
    timeout,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  return _axios.default.create(defaultOptions);
};

/**
 * Calls the Atomic Swap Service requesting the creation of a new proposal identifier for the informed partialTx.
 * @param serializedPartialTx
 * @param password
 * @return Promise<{ success: boolean, id: string }>
 * @throws {Error} When the swap service network is not configured
 * @example
 * const results = await create('PartialTx|0001000000000000000000000063f78c0e0000000000||', 'pass123')
 */
const create = async (serializedPartialTx, password) => {
  if (!serializedPartialTx) {
    throw new Error('Missing serializedPartialTx');
  }
  if (!password) {
    throw new Error('Missing password');
  }
  const swapAxios = await axiosInstance();
  const payload = {
    partialTx: encryptString(serializedPartialTx, password),
    authPassword: hashPassword(password)
  };
  const {
    data
  } = await swapAxios.post('/', payload);
  return data;
};

/**
 * Fetches from the Atomic Swap Service the most up-to-date version of the proposal by the given id
 * and decrypts it locally
 * @throws {Error} When the swap service network is not configured
 * @throws {Error} When the password is incorrect and the proposal cannot be decoded
 * @param proposalId
 * @param password
 * @example
 * const results = await get('b4a5b077-c599-41e8-a791-85e08efcb1da', 'pass123')
 */
exports.create = create;
const get = async (proposalId, password) => {
  if (!proposalId) {
    throw new Error('Missing proposalId');
  }
  if (!password) {
    throw new Error('Missing password');
  }
  const swapAxios = await axiosInstance();
  const options = {
    headers: {
      'X-Auth-Password': hashPassword(password)
    }
  };
  const {
    data
  } = await swapAxios.get(`/${proposalId}`, options);

  // Decrypting the backend contents and handling its possible failures
  try {
    const decryptedData = {
      proposalId: data.id,
      version: data.version,
      timestamp: data.timestamp,
      partialTx: decryptString(data.partialTx, password),
      signatures: data.signatures ? decryptString(data.signatures, password) : null,
      history: data.history.map(r => ({
        partialTx: decryptString(r.partialTx, password),
        timestamp: r.timestamp
      }))
    };

    // If the PartialTx does not have the correct prefix, it was not correctly decoded: incorrect password
    if (!decryptedData.partialTx.startsWith(_partial_tx.PartialTxPrefix)) {
      throw new Error('Incorrect password: could not decode the proposal');
    }

    // Decoding was successful, return the data
    return decryptedData;
  } catch (err) {
    if (!(err instanceof Error)) {
      // If the error is not an Error, rethrow it
      throw err;
    }
    // If the failure was specifically on the decoding, our password was incorrect.
    if (err.message === 'Malformed UTF-8 data') {
      throw new Error('Incorrect password: could not decode the proposal');
    }

    // Rethrow any other errors that may happen
    throw err;
  }
};
exports.get = get;
/**
 * Updates the proposal on the Atomic Swap Service with the parameters informed
 */
const update = async params => {
  // Validates the input parameters and throws in case of errors
  validateParameters();
  const {
    proposalId,
    password,
    partialTx,
    version,
    signatures
  } = params;
  const swapAxios = await axiosInstance();
  const options = {
    headers: {
      'X-Auth-Password': hashPassword(password)
    }
  };
  const payload = {
    partialTx: encryptString(partialTx, password),
    version,
    signatures: signatures ? encryptString(signatures, password) : null
  };
  const {
    data
  } = await swapAxios.put(`/${proposalId}`, payload, options);
  return {
    success: data?.success
  };

  /**
   * Validates the many mandatory parameters for the `update` method
   * @throws {Error} if any mandatory parameter is missing
   * @throws {Error} if any version parameter is invalid
   */
  function validateParameters() {
    if (!params) {
      throw new Error(`Missing mandatory parameters.`);
    }
    const {
      proposalId: paramProposalId,
      password: paramPassword,
      partialTx: paramPartialTx,
      version: paramVersion
    } = params;
    // Checking for missing parameters
    const missingParameters = [];
    if (!paramProposalId) {
      missingParameters.push('proposalId');
    }
    if (!paramPassword) {
      missingParameters.push('password');
    }
    if (!paramPartialTx) {
      missingParameters.push('partialTx');
    }
    if (paramVersion === undefined || paramVersion === null) {
      missingParameters.push('version');
    }
    if (missingParameters.length > 0) {
      throw new Error(`Missing mandatory parameters: ${missingParameters.join(', ')}`);
    }

    // Checking for invalid parameters
    if (!(0, _lodash.isNumber)(paramVersion) || paramVersion < 0) {
      throw new Error('Invalid version number');
    }
  }
};
exports.update = update;