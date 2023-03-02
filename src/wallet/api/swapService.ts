/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import config from "../../config";
import axios, { AxiosRequestConfig } from "axios";
import { TIMEOUT, } from '../../constants';
import sha256 from 'crypto-js/sha256';
import AES from 'crypto-js/aes';
import CryptoJS from 'crypto-js';
import { AtomicSwapProposal } from "../../models/types";
import { PartialTxPrefix } from '../../models/partial_tx';

/**
 * This interface represents the type returned on the HTTP response, with its untreated and encrypted data.
 * The results should be translated to an `AtomicSwapProposal` interface before being sent out of this service.
 */
interface RawBackendProposal {
  id: string,
  partialTx: string,
  signatures: string | null,
  timestamp: string,
  version: number,
  history: { partialTx: string, timestamp: string }[]
}

/**
 * Encrypts a string ( PartialTx or Signatures ) before sending it to the backend
 * @param serialized
 * @param password
 */
export function encryptString(serialized: string, password: string): string {
  if (!serialized) {
    throw new Error('Missing encrypted string');
  }
  if (!password) {
    throw new Error('Missing password');
  }
  const aesEncryptedObject = AES.encrypt(serialized, password);

  // Serializing the cipher output in Base64 to avoid loss of encryption parameter data
  const baseEncryptedObj = CryptoJS.enc.Base64.parse(aesEncryptedObject.toString());
  return CryptoJS.enc.Base64.stringify(baseEncryptedObj);
}

/**
 * Decrypts a string ( PartialTx or Signatures ) from the backend
 * @param serialized
 * @param password
 */
export function decryptString(serialized: string, password: string): string {
  if (!serialized) {
    throw new Error('Missing encrypted string');
  }
  if (!password) {
    throw new Error('Missing password');
  }
  const aesDecryptedObject = AES.decrypt(serialized, password);
  return aesDecryptedObject.toString(CryptoJS.enc.Utf8);
}

/**
 * Hashes the password to use it as an authentication on the backend
 * @param {string} password
 * @returns {string} hashed password
 */
export function hashPassword(password): string {
  return sha256(password).toString();
}

/**
 * Returns an axios instance pre-configured for interacting with the Atomic Swap Service
 * @param [timeout] Optional timeout, defaults to the lib's timeout constant
 * @param [network] Optional network. If not present, defaults connection to the lib's configured baseUrl
 */
const axiosInstance = async (timeout: number = TIMEOUT, network?: 'mainnet'|'testnet') => {
  const swapServiceBaseUrl = config.getSwapServiceBaseUrl(network);
  const defaultOptions = {
    baseURL: swapServiceBaseUrl,
    timeout: timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  return axios.create(defaultOptions);
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
export const create = async (serializedPartialTx: string, password: string) => {
  if (!serializedPartialTx) {
    throw new Error('Missing serializedPartialTx')
  }
  if (!password) {
    throw new Error('Missing password')
  }

  const swapAxios = await axiosInstance();
  const payload = {
    partialTx: encryptString(serializedPartialTx, password),
    authPassword: hashPassword(password),
  };

  const { data } = await swapAxios.post<{ success: boolean, id: string }>('/', payload);
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
export const get = async (proposalId: string, password: string): Promise<AtomicSwapProposal> => {
  if (!proposalId) {
    throw new Error('Missing proposalId');
  }
  if (!password) {
    throw new Error('Missing password');
  }

  const swapAxios = await axiosInstance();
  const options = {
    headers: { 'X-Auth-Password': hashPassword(password) }
  } as AxiosRequestConfig;

  const { data } = await swapAxios.get<RawBackendProposal>(`/${proposalId}`, options);

  // Decrypting the backend contents and handling its possible failures
  try {
    const decryptedData: AtomicSwapProposal = {
      proposalId: data.id,
      version: data.version,
      timestamp: data.timestamp,
      partialTx: decryptString(data.partialTx, password),
      signatures: data.signatures ? decryptString(data.signatures, password) : null,
      history: data.history.map(r => ({
        partialTx: decryptString(r.partialTx, password),
        timestamp: r.timestamp,
      }))
    };

    // If the PartialTx does not have the correct prefix, it was not correctly decoded: incorrect password
    if (!decryptedData.partialTx.startsWith(PartialTxPrefix)) {
      throw new Error('Incorrect password: could not decode the proposal');
    }

    // Decoding was successful, return the data
    return decryptedData;
  } catch (err) {
    // If the failure was specifically on the decoding, our password was incorrect.
    if (err.message === "Malformed UTF-8 data") {
      throw new Error('Incorrect password: could not decode the proposal');
    }

    // Rethrow any other errors that may happen
    throw err;
  }
};
