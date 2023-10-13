/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import transactionUtils from '../utils/transaction';
import { crypto } from 'bitcore-lib';
import SendTransaction from '../new/sendTransaction';
import HathorWallet from '../new/wallet';
import NanoContract from './nano_contract';
import Transaction from '../models/transaction';
import Deserializer from './deserializer';
import Network from '../models/network';
import ScriptData from '../models/script_data';
import { hexToBuffer, bufferToHex, unpackLen } from '../utils/buffer';
import helpers from '../utils/helpers';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import Address from '../models/address';
import { OracleParseError } from '../errors';
import { OutputType } from '../wallet/types';
import { parseScript } from '../utils/scripts';
import { decryptData } from '../utils/crypto';
import { HDPrivateKey } from 'bitcore-lib';

/**
 * Sign a transaction, create a send transaction object, mine and push
 *
 * @param {Transaction} tx Transaction to sign and send
 * @param {HDPrivateKey} privateKey Private key of the nano contract's tx signature
 * @param {string} pin Pin to decrypt data
 * @param {IStorage} storage Wallet storage object
 *
 * @returns {Promise<NanoContract>}
 */
export const signAndPushNCTransaction = async (tx: NanoContract, privateKey, pin: string, storage): Promise<Transaction> => {
  const dataToSignHash = tx.getDataToSignHash();
  const sig = crypto.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
    nhashtype: crypto.Signature.SIGHASH_ALL
  });
  // Add nano signature
  tx.signature = sig.toDER();
  // Inputs signature, if there are any
  await transactionUtils.signTransaction(tx, storage, pin);
  tx.prepareToSend();

  // Create send transaction object
  const sendTransaction = new SendTransaction({
    storage,
    transaction: tx,
    pin,
  });

  return sendTransaction.runFromMining();
}

export const getOracleBufferFromHex = (oracle: string, network: Network): Buffer => {
  const address = new Address(oracle, { network });
  // First check if the oracle is a base58 address
  // In case of success, set the output script as oracle
  // Otherwise, it's a custom script in hexadecimal
  if (address.isValid()) {
    const outputScriptType = address.getType();
    let outputScript;
    if (outputScriptType === OutputType.P2PKH) {
      outputScript = new P2PKH(address);
    } else if (outputScriptType === OutputType.P2SH) {
      outputScript = new P2SH(address);
    } else {
      throw new OracleParseError('Invalid output script type.');
    }
    return outputScript.createScript();
  } else {
    // Oracle script is a custom script
    try {
      return hexToBuffer(oracle);
    } catch (err) {
      // Invalid hex
      throw new OracleParseError('Invalid hex value for oracle script.');
    }
  }
}

export const getOracleInputData = async (oracleData: string, resultSerialized: Buffer, wallet: HathorWallet): Promise<Buffer> => {
  // Parse oracle script to validate if it's an address of this wallet
  const oracleDataBuffer = hexToBuffer(oracleData);
  const parsedOracleScript = parseScript(oracleDataBuffer, wallet.getNetworkObject());
  if (parsedOracleScript && !(parsedOracleScript instanceof ScriptData)) {
    // This is only when the oracle is an address, otherwise we will have the signed input data
    const address = parsedOracleScript.address.base58;
    const oracleKey = await wallet.getHDPrivateKeyFromAddress(address);

    const signatureOracle = transactionUtils.getSignature(transactionUtils.getDataToSignHash(resultSerialized), oracleKey.privateKey);
    const oraclePubKeyBuffer = oracleKey.publicKey.toBuffer();
    return transactionUtils.createInputData(signatureOracle, oraclePubKeyBuffer);
  } else {
    // If it's not an address, we use the oracleInputData as the inputData directly
    return oracleDataBuffer;
  }
}