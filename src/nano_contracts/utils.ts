/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { get } from 'lodash';
import { crypto } from 'bitcore-lib';
import { z } from 'zod';
import transactionUtils from '../utils/transaction';
import tokensUtils from '../utils/tokens';
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
import { IHistoryTx, IStorage, ITokenData } from '../types';
import { parseScript } from '../utils/scripts';
import {
  MethodArgInfo,
  NanoContractArgumentContainerType,
  NanoContractArgumentApiInputType,
  NanoContractArgumentSingleTypeName,
  NanoContractArgumentSingleTypeNameSchema,
  ActionTypeToActionHeaderType,
  NanoContractAction,
  NanoContractActionHeader,
  NanoContractActionType,
} from './types';
import { NANO_CONTRACTS_INITIALIZE_METHOD, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../constants';
import { NanoContractMethodArgument } from './methodArg';
import leb128 from '../utils/leb128';

export function getContainerInternalType(
  type: string
): [
  NanoContractArgumentContainerType,
  NanoContractArgumentSingleTypeName | NanoContractArgumentSingleTypeName[],
] {
  if (type.endsWith('?')) {
    // Optional value
    const innerType = type.slice(0, -1);
    return ['Optional', NanoContractArgumentSingleTypeNameSchema.parse(innerType)];
  }

  // ContainerType[internalType]
  const match = type.match(/^(.*?)\[(.*)\]/);
  const containerType = match ? match[1] : null;
  const internalType = match ? match[2] : null;
  if (!internalType || !containerType) {
    throw new Error('Unable to extract type');
  }
  // Only some values are allowed for containerType
  switch (containerType) {
    case 'SignedData':
    case 'RawSignedData':
      return [containerType, NanoContractArgumentSingleTypeNameSchema.parse(internalType)];
    case 'Tuple':
      return [
        containerType,
        internalType.split(',').map(t => NanoContractArgumentSingleTypeNameSchema.parse(t.trim())),
      ];
    default:
      throw new Error('Not a ContainerType');
  }
}

export function getContainerType(type: string): NanoContractArgumentContainerType | null {
  try {
    const [containerType, _internalType] = getContainerInternalType(type);
    return containerType;
  } catch (err: unknown) {
    return null;
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
 * @param contractId Id of the nano contract being invoked
 * @param resultSerialized Result to sign with oracle data already serialized
 * @param wallet Hathor Wallet object
 */
export const getOracleInputData = async (
  oracleData: Buffer,
  contractId: string,
  resultSerialized: Buffer,
  wallet: HathorWallet
) => {
  const ncId = Buffer.from(contractId, 'hex');
  const actualValue = Buffer.concat([leb128.encodeUnsigned(ncId.length), ncId, resultSerialized]);
  return unsafeGetOracleInputData(oracleData, actualValue, wallet);
};

/**
 * [unsafe] Get oracle input data, signs received data raw.
 * This is meant to be used for RawSignedData
 *
 * @param oracleData Oracle data
 * @param resultSerialized Result to sign with oracle data already serialized
 * @param wallet Hathor Wallet object
 */
export const unsafeGetOracleInputData = async (
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
 * @throws NanoRequest404Error in case the blueprint ID does not exist on the full node
 */
export const validateAndParseBlueprintMethodArgs = async (
  blueprintId: string,
  method: string,
  args: NanoContractArgumentApiInputType[] | null
): Promise<NanoContractMethodArgument[] | null> => {
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

  if (args == null) {
    throw new NanoContractTransactionError(`No arguments were received.`);
  }

  const argsLen = args.length;
  if (argsLen !== methodArgs.length) {
    throw new NanoContractTransactionError(
      `Method needs ${methodArgs.length} parameters but data has ${args.length}.`
    );
  }

  try {
    const parsedArgs: NanoContractMethodArgument[] = [];
    for (const [index, arg] of methodArgs.entries()) {
      const parsedArg = NanoContractMethodArgument.fromApiInput(arg.name, arg.type, args[index]);
      parsedArgs.push(parsedArg);
    }
    return parsedArgs;
  } catch (err: unknown) {
    if (err instanceof z.ZodError || err instanceof Error) {
      throw new NanoContractTransactionError(err.message);
    }
    throw err;
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

/**
 * Map a NanoContractAction object to NanoContractActionHeader
 *
 * @param action The action object to be mapped
 * @param tokens The tokens array to be used in the mapping
 *
 * @return The mapped action header object
 */
export const mapActionToActionHeader = (
  action: NanoContractAction,
  tokens: string[]
): NanoContractActionHeader => {
  const headerActionType = ActionTypeToActionHeaderType[action.type];

  const mappedTokens: ITokenData[] = tokens.map(token => {
    return {
      uid: token,
      name: '',
      symbol: '',
    };
  });

  let amount;
  if (
    action.type === NanoContractActionType.GRANT_AUTHORITY ||
    action.type === NanoContractActionType.ACQUIRE_AUTHORITY
  ) {
    amount = action.authority === 'mint' ? TOKEN_MINT_MASK : TOKEN_MELT_MASK;
  } else if (
    action.type === NanoContractActionType.DEPOSIT ||
    action.type === NanoContractActionType.WITHDRAWAL
  ) {
    amount = action.amount;
  } else {
    throw new Error('Invalid nano contract action type');
  }

  return {
    type: headerActionType,
    amount,
    tokenIndex: tokensUtils.getTokenIndex(mappedTokens, action.token),
  };
};
