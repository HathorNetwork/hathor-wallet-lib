/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get } from 'lodash';
import transactionUtils from '../utils/transaction';
import { crypto } from 'bitcore-lib';
import SendTransaction from '../new/sendTransaction';
import HathorWallet from '../new/wallet';
import NanoContract from './nano_contract';
import Transaction from '../models/transaction';
import Network from '../models/network';
import ScriptData from '../models/script_data';
import ncApi from '../api/nano';
import { hexToBuffer, bufferToHex, unpackLen } from '../utils/buffer';
import helpers from '../utils/helpers';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import Address from '../models/address';
import {
  NanoContractTransactionError,
  OracleParseError,
  WalletFromXPubGuard
} from '../errors';
import { OutputType } from '../wallet/types';
import { IStorage } from '../types';
import { parseScript } from '../utils/scripts';
import { decryptData } from '../utils/crypto';
import { PrivateKey } from 'bitcore-lib';
import { MethodArgInfo } from './types';

/**
 * Sign a transaction, create a send transaction object, mine and push
 *
 * @param {tx} Transaction to sign and send
 * @param {privateKey} Private key of the nano contract's tx signature
 * @param {pin} Pin to decrypt data
 * @param {storage} Wallet storage object
 */
export const signAndPushNCTransaction = async (tx: NanoContract, privateKey: PrivateKey, pin: string, storage: IStorage): Promise<Transaction> => {
  const dataToSignHash = tx.getDataToSignHash();
  // Add nano signature
  tx.signature = transactionUtils.getSignature(dataToSignHash, privateKey);
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

/**
 * Get oracle buffer from oracle string (address in base58 or oracle data directly in hex)
 *
 * @param {oracle} Address in base58 or oracle data directly in hex
 * @param {network} Network to calculate the address
 */
export const getOracleBuffer = (oracle: string, network: Network): Buffer => {
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
  }

  // Oracle script is a custom script
  try {
    return hexToBuffer(oracle);
  } catch (err) {
    // Invalid hex
    throw new OracleParseError('Invalid hex value for oracle script.');
  }
}

/**
 * Get oracle input data
 *
 * @param {oracleData} Oracle data
 * @param {resultSerialized} Result to sign with oracle data already serialized
 * @param {wallet} Hathor Wallet object
 */
export const getOracleInputData = async (oracleData: Buffer, resultSerialized: Buffer, wallet: HathorWallet): Promise<Buffer> => {
  // Parse oracle script to validate if it's an address of this wallet
  const parsedOracleScript = parseScript(oracleData, wallet.getNetworkObject());
  if (parsedOracleScript && !(parsedOracleScript instanceof ScriptData)) {
    if (await wallet.storage.isReadonly()) {
      throw new WalletFromXPubGuard('getOracleInputData');
    }

    // This is only when the oracle is an address, otherwise we will have the signed input data
    const address = parsedOracleScript.address.base58;
    if (!wallet.isAddressMine(address)) {
      throw new OracleParseError('Oracle address is not from the loaded wallet.');
    }
    const oracleKey = await wallet.getPrivateKeyFromAddress(address);

    const signatureOracle = transactionUtils.getSignature(crypto.Hash.sha256(resultSerialized), oracleKey);
    const oraclePubKeyBuffer = oracleKey.publicKey.toBuffer();
    return transactionUtils.createInputData(signatureOracle, oraclePubKeyBuffer);
  }

  // If it's not an address, we use the oracleInputData as the inputData directly
  return oracleData;
}


/**
 * Validate if nano contracts arguments match the expected ones from the blueprint method
 *
 * @param {blueprintId} Blueprint ID
 * @param {method} Method name
 * @param {args} Arguments of the method to check if have the expected types
 *
 * @throws NanoContractTransactionError in case the arguments are not valid
 * @throws NanoRequest404Error in case the blueprint ID does not exist on the full node
 */
export const validateBlueprintMethodArgs = async (blueprintId, method, args): Promise<void> => {
  // Get the blueprint data from full node
  const blueprintInformation = await ncApi.getBlueprintInformation(blueprintId);

  const methodArgs = get(blueprintInformation, `public_methods.${method}.args`, []) as MethodArgInfo[];
  if (!methodArgs) {
    throw new NanoContractTransactionError(`Blueprint does not have method ${method}.`);
  }

  // Args may come as undefined
  const argsLen = args ? args.length : 0;
  if (argsLen !== methodArgs.length) {
    throw new NanoContractTransactionError(`Method needs ${methodArgs.length} parameters but data has ${args.length}.`);
  }

  // Here we validate that the arguments sent in the data array of args has
  // the expected type for each parameter of the blueprint method
  for (const [index, arg] of methodArgs.entries()) {
    let typeToCheck = arg.type;
    if (typeToCheck.startsWith('SignedData')) {
      // Signed data will always be an hexadecimal with the
      // signature len, signature, and the data itself
      typeToCheck = 'str';
    }
    switch (typeToCheck) {
      case 'bytes':
        // Bytes arguments are sent in hexadecimal
        try {
          args[index] = hexToBuffer(args[index]);
        } catch {
          // Data sent is not a hex
          throw new NanoContractTransactionError(`Invalid hexadecimal for argument number ${index + 1}.`);
        }
        break;
      case 'int':
      case 'float':
        if (typeof args[index] !== 'number') {
          throw new NanoContractTransactionError(`Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`);
        }
        break;
      case 'str':
        if (typeof args[index] !== 'string') {
          throw new NanoContractTransactionError(`Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`);
        }
        break;
      default:
        if (arg.type !== typeof args[index]) {
          throw new NanoContractTransactionError(`Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`);
        }
    }
  }
}
