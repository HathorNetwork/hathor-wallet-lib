/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get } from 'lodash';
import { crypto } from 'bitcore-lib';
import transactionUtils from '../utils/transaction';
import SendTransaction from '../new/sendTransaction';
import HathorWallet from '../new/wallet';
import Network from '../models/network';
import ScriptData from '../models/script_data';
import ncApi from '../api/nano';
import { hexToBuffer } from '../utils/buffer';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import Address from '../models/address';
import Transaction from '../models/transaction';
import { NanoContractTransactionError, OracleParseError, WalletFromXPubGuard } from '../errors';
import { OutputType } from '../wallet/types';
import { IHistoryTx, IStorage } from '../types';
import { parseScript } from '../utils/scripts';
import {
  MethodArgInfo,
  NanoContractArgumentType,
  NanoContractArgumentContainerType,
} from './types';
import { NANO_CONTRACTS_INITIALIZE_METHOD } from '../constants';

export function getContainerInternalType(
  type: string
): [NanoContractArgumentContainerType, string] {
  if (type.endsWith('?')) {
    // Optional value
    return ['Optional', type.slice(0, -1)];
  }

  // ContainerType[internalType]
  const match = type.match(/^(.*?)\[(.*)\]/);
  const containerType = match ? match[1] : null;
  const internalType = match ? match[2] : null;
  if ((!internalType) || (!containerType)) {
    throw new Error('Unable to extract type');
  }
  // Only some values are allowed for containerType
  switch (containerType) {
    case 'Tuple':
    case 'SignedData':
    case 'RawSignedData':
      return [containerType, internalType]
    default:
      throw new Error('Not a ContainerType');
  }
}

export function getContainerType(type: string): NanoContractArgumentContainerType | null {
  try {
    const [containerType, _internalType] = getContainerInternalType(type);
    return containerType;
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Not a ContainerType') {
      return null;
    }
    // Re-raise unexpected error
    throw err;
  }
}

/**
 * Sign a transaction and create a send transaction object
 *
 * @param tx Transaction to sign and send
 * @param pin Pin to decrypt data
 * @param storage Wallet storage object
 */
export const prepareNanoSendTransaction = async (
  tx: Transaction,
  pin: string,
  storage: IStorage
): Promise<SendTransaction> => {
  await transactionUtils.signTransaction(tx, storage, pin);
  tx.prepareToSend();

  // Create and return a send transaction object
  return new SendTransaction({
    storage,
    transaction: tx,
    pin,
  });
};

/**
 * Get oracle buffer from oracle string (address in base58 or oracle data directly in hex)
 *
 * @param oracle Address in base58 or oracle data directly in hex
 * @param network Network to calculate the address
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
};

/**
 * Get oracle input data
 *
 * @param oracleData Oracle data
 * @param resultSerialized Result to sign with oracle data already serialized
 * @param wallet Hathor Wallet object
 */
export const getOracleInputData = async (
  oracleData: Buffer,
  resultSerialized: Buffer,
  wallet: HathorWallet
): Promise<Buffer> => {
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

    const signatureOracle = transactionUtils.getSignature(
      crypto.Hash.sha256(resultSerialized),
      oracleKey
    );
    const oraclePubKeyBuffer = oracleKey.publicKey.toBuffer();
    return transactionUtils.createInputData(signatureOracle, oraclePubKeyBuffer);
  }

  // If it's not an address, we use the oracleInputData as the inputData directly
  return oracleData;
};

/**
 * Validate if nano contracts arguments match the expected ones from the blueprint method
 * It also converts arguments that come from clients in a different type than the expected,
 * e.g., bytes come as hexadecimal strings and address (bytes) come as base58 string.
 * We convert them to the expected type and update the original array of arguments
 *
 * @param blueprintId Blueprint ID
 * @param method Method name
 * @param args Arguments of the method to check if have the expected types
 *
 * Warning: This method can mutate the `args` parameter during its validation
 *
 * @throws NanoContractTransactionError in case the arguments are not valid
 * @throws NanoRequest404Error in case the blueprint ID does not exist on the full node
 */
export const validateAndUpdateBlueprintMethodArgs = async (
  blueprintId: string,
  method: string,
  args: NanoContractArgumentType[] | null
): Promise<void> => {
  // Get the blueprint data from full node
  const blueprintInformation = await ncApi.getBlueprintInformation(blueprintId);

  const methodArgs = get(
    blueprintInformation,
    `public_methods.${method}.args`,
    []
  ) as MethodArgInfo[];
  if (!methodArgs) {
    throw new NanoContractTransactionError(`Blueprint does not have method ${method}.`);
  }

  // Args may come as undefined or null
  if (args == null) {
    if (methodArgs.length !== 0) {
      throw new NanoContractTransactionError(
        `Method needs ${methodArgs.length} parameters but no arguments were received.`
      );
    }

    return;
  }

  const argsLen = args.length;
  if (argsLen !== methodArgs.length) {
    throw new NanoContractTransactionError(
      `Method needs ${methodArgs.length} parameters but data has ${args.length}.`
    );
  }

  // Here we validate that the arguments sent in the data array of args has
  // the expected type for each parameter of the blueprint method
  // Besides that, there are arguments that come from the clients in a different way
  // that we expect, e.g. the bytes arguments come as hexadecimal, and the address
  // arguments come as base58 strings, so we converts them and update the original
  // array of arguments with the expected type
  for (const [index, arg] of methodArgs.entries()) {
    let typeToCheck = arg.type;
    if (typeToCheck.startsWith('SignedData')) {
      // Signed data will always be an hexadecimal with the
      // signature len, signature, and the data itself
      typeToCheck = 'str';
    }
    switch (typeToCheck) {
      case 'bytes':
      case 'BlueprintId':
      case 'ContractId':
      case 'TokenUid':
      case 'TxOutputScript':
      case 'VertexId':
        // Bytes arguments are sent in hexadecimal
        try {
          // eslint-disable-next-line no-param-reassign
          args[index] = hexToBuffer(args[index] as string);
        } catch {
          // Data sent is not a hex
          throw new NanoContractTransactionError(
            `Invalid hexadecimal for argument number ${index + 1} for type ${arg.type}.`
          );
        }
        break;
      case 'Amount':
        if (typeof args[index] !== 'bigint') {
          throw new NanoContractTransactionError(
            `Expects argument number ${index + 1} type ${arg.type} (bigint) but received type ${typeof args[index]}.`
          );
        }
        break;
      case 'int':
      case 'Timestamp':
        if (typeof args[index] !== 'number') {
          throw new NanoContractTransactionError(
            `Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`
          );
        }
        break;
      case 'str':
        if (typeof args[index] !== 'string') {
          throw new NanoContractTransactionError(
            `Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`
          );
        }
        break;
      // Creating a block {} in the case below
      // because we can't create a variable without it (linter - no-case-declarations)
      case 'Address': {
        const argValue = args[index];
        if (typeof argValue !== 'string') {
          throw new NanoContractTransactionError(
            `Expects argument number ${index + 1} type ${arg.type} but received type ${typeof argValue}.`
          );
        }

        try {
          const address = new Address(argValue as string);
          address.validateAddress();
        } catch {
          // Argument value is not a valid address
          throw new NanoContractTransactionError(
            `Argument ${argValue} is not a valid base58 address.`
          );
        }
        break;
      }
      default:
        // eslint-disable-next-line valid-typeof -- This rule is not suited for dynamic comparisons such as this one
        if (arg.type !== typeof args[index]) {
          throw new NanoContractTransactionError(
            `Expects argument number ${index + 1} type ${arg.type} but received type ${typeof args[index]}.`
          );
        }
    }
  }
};

/**
 * Checks if a transaction is a nano contract create transaction
 *
 * @param tx History object from hathor core to check if it's a nano create tx
 */
export const isNanoContractCreateTx = (tx: IHistoryTx): boolean => {
  return tx.nc_method === NANO_CONTRACTS_INITIALIZE_METHOD;
};
