/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Output from '../../models/output';
import P2PKH from '../../models/p2pkh';
import P2SH from '../../models/p2sh';
import Input from '../../models/input';
import Address from '../../models/address';
import NanoContract from '../nano_contract';
import { hexToBuffer } from '../../utils/buffer';
import { HATHOR_TOKEN_CONFIG, NANO_CONTRACTS_VERSION } from '../../constants';
import Serializer from '../serializer';
import { HDPrivateKey } from 'bitcore-lib';
import HathorWallet from '../../new/wallet';
import SendTransaction from '../../new/sendTransaction';
import { NanoContractTransactionError } from '../../errors';
import { signAndPushNCTransaction } from '../utils';
import { parseScript } from '../../utils/scripts';
import { decryptData } from '../../utils/crypto';
import transactionUtils from '../../utils/transaction';


class Bet {
  static id: string = '3cb032600bdf7db784800e4ea911b10676fa2f67591f82bb62628c234e771595';

  /**
   * Create a nano contract of bet blueprint
   *
   * @param {HathorWallet} wallet HathorWallet object to get wallet storage information
   * @param {string} pin Pin to decrypt storage data
   * @param {HDPrivateKey} privateKey Private key to sign the nano contract transaction
   * @param {Object} data Data parameters for the initialize method
   * @param {string} [data.token] Token of the nano contract
   * @param {number} [data.dateLastBet] Timestamp with the last moment for a bet
   * @param {string} [data.oracle] Oracle script in hex
   *
   * @returns {Promise<NanoContract>}
   */
  static async initialize(wallet: HathorWallet, pin: string, privateKey: HDPrivateKey, data: object): Promise<NanoContract> {
    const { token, dateLastBet, oracle } = data;
    let oracleScript;
    const address = new Address(oracle, { network: wallet.getNetworkObject() });
    // First check if the oracle is a base58 address
    // In case of success, set the output script as oracle
    // Otherwise, it's a custom script in hexadecimal
    if (address.isValid()) {
      const outputScriptType = address.getType();
      let outputScript;
      if (outputScriptType === 'p2pkh') {
        outputScript = new P2PKH(address);
      } else if (outputScriptType === 'p2sh') {
        outputScript = new P2SH(address);
      } else {
        throw new NanoContractTransactionError('Invalid output script type.');
      }
      oracleScript = outputScript.createScript();
    } else {
      // Oracle script is a custom script
      try {
        oracleScript = hexToBuffer(oracle);
      } catch (err) {
        // Invalid hex
        throw new NanoContractTransactionError('Invalid hex value for oracle script.');
      }
    }

    // Serialize args and create transaction
    const serializer = new Serializer();
    const serializedOracle = serializer.fromBytes(oracleScript);
    const serializedTokenUid = serializer.fromBytes(hexToBuffer(token));
    const serializedTimestamp = serializer.fromInt(dateLastBet);

    const args = [serializedOracle, serializedTokenUid, serializedTimestamp];
    const nc = new NanoContract([], [], this.id, 'initialize', args, privateKey.publicKey.toBuffer(), null);
    return signAndPushNCTransaction(nc, privateKey, pin, wallet.storage);
  }

  /**
   * Create a nano contract transaction for a bet
   *
   * @param {HathorWallet} wallet HathorWallet object to get wallet storage information
   * @param {string} pin Pin to decrypt storage data
   * @param {HDPrivateKey} privateKey Private key to sign the nano contract transaction
   * @param {Object} data Data parameters for the bet method
   * @param {string} [data.address] Address that will be able to withdraw in case the bet is successful
   * @param {string} [data.result] Result to bet
   * @param {number} [data.amount] Amount to bet
   * @param {string} [data.token] Token of the nano contract
   * @param {string | null} [data.changeAddress] Optional change address for the deposit utxo
   *
   * @returns {Promise<NanoContract>}
   */
  static async bet(wallet: HathorWallet, pin: string, privateKey: HDPrivateKey, data: object): Promise<NanoContract> {
    const { ncId, address, result, amount, token } = data;
    // Get the utxos with the amount of the bet and create the inputs
    const utxosData = await wallet.getUtxosForAmount(amount, { token });
    const inputs = [];
    for (const utxo of utxosData.utxos) {
      inputs.push(new Input(utxo.txId, utxo.index));
    }

    const outputs = [];
    const network = wallet.getNetworkObject();
    // If there's a change amount left in the utxos, create the change output
    if (utxosData.changeAmount) {
      const changeAddressParam = data.changeAddress;
      if (changeAddressParam && !wallet.isAddressMine(changeAddressParam)) {
        throw new NanoContractTransactionError('Change address must belong to the same wallet.');
      }

      const changeAddressStr = changeAddressParam || (await wallet.getCurrentAddress()).address;
      const changeAddress = new Address(changeAddressStr, { network });
      // This will throw AddressError in case the adress is invalid
      changeAddress.validateAddress();
      const p2pkh = new P2PKH(changeAddress);
      const p2pkhScript = p2pkh.createScript()
      const outputObj = new Output(
        utxosData.changeAmount,
        p2pkhScript,
        {
          tokenData: token === HATHOR_TOKEN_CONFIG.uid ? 0 : 1
        }
      );
      outputs.push(outputObj);
    }

    // Serialize args and create transaction
    const serializer = new Serializer();
    const addressObj = new Address(address, { network });
    const serializedAddress = serializer.fromBytes(addressObj.decode());
    const serializedResult = serializer.fromString(result);

    const args = [serializedAddress, serializedResult];
    const nc = new NanoContract(inputs, outputs, ncId, 'bet', args, privateKey.publicKey.toBuffer(), null);
    return signAndPushNCTransaction(nc, privateKey, pin, wallet.storage);
  }

  /**
   * Create a nano contract transaction for a withdrawal
   *
   * @param {HathorWallet} wallet HathorWallet object to get wallet storage information
   * @param {string} pin Pin to decrypt storage data
   * @param {HDPrivateKey} privateKey Private key to sign the nano contract transaction
   * @param {Object} data Data parameters for the withdraw method
   * @param {string} [data.address] Address that made the bet of this withdrawal
   * @param {number} [data.amount] Amount to withdraw
   * @param {string} [data.token] Token of the nano contract
   *
   * @returns {Promise<NanoContract>}
   */
  static async withdraw(wallet: HathorWallet, pin: string, privateKey: HDPrivateKey, data: object): Promise<NanoContract> {
    const { ncId, amount, address, token } = data;
    // Create the output with the withdeawal address and amount
    const addressObj = new Address(address, { network: wallet.getNetworkObject() });
    const p2pkh = new P2PKH(addressObj);
    const p2pkhScript = p2pkh.createScript()
    const output = new Output(
      amount,
      p2pkhScript,
      {
        tokenData: token === HATHOR_TOKEN_CONFIG.uid ? 0 : 1
      }
    );

    // Amount and address to withdraw will be in the outputs
    const nc = new NanoContract([], [output], ncId, 'withdraw', [], privateKey.publicKey.toBuffer(), null);
    return signAndPushNCTransaction(nc, privateKey, pin, wallet.storage);
  }

  /**
   * Create a nano contract transaction for a set result
   *
   * @param {HathorWallet} wallet HathorWallet object to get wallet storage information
   * @param {string} pin Pin to decrypt storage data
   * @param {HDPrivateKey} privateKey Private key to sign the nano contract transaction
   * @param {Object} data Data parameters for the set result method
   * @param {string} [data.result] Result of the bet to set
   * @param {string} [data.oracleData] Data of the oracle to sign the result
   *
   * @returns {Promise<NanoContract>}
   */
  static async setResult(wallet: HathorWallet, pin: string, privateKey: HDPrivateKey, data: object): Promise<NanoContract> {
    const { ncId, result, oracleData } = data;

    // XXX Why the full node has decode to ASCII and not UTF-8?
    // XXX if we decide to go with ASCII the result must be serialized
    // differently than the others strings
    const resultSerialized = Buffer.from(result, 'utf8');

    // Parse oracle script to validate if it's an address of this wallet
    const oracleDataBuffer = hexToBuffer(oracleData);
    const parsedOracleScript = parseScript(oracleDataBuffer, wallet.getNetworkObject());
    let inputData;
    if (parsedOracleScript) {
      // This is only when the oracle is an address, otherwise we will have the signed input data
      const address = parsedOracleScript.address.base58;
      const addressIndex = await wallet.getAddressIndex(address);
      if (addressIndex === null) {
        throw new NanoContractTransactionError('Address of the oracle does not belong to the wallet.');
      }
      const accessData = await wallet.getAccessData();
      const encryptedPrivateKey = accessData.mainKey;
      const privateKeyStr = decryptData(encryptedPrivateKey, pin);
      const key = HDPrivateKey(privateKeyStr)
      const oracleKey = key.deriveNonCompliantChild(addressIndex);

      const signatureOracle = transactionUtils.getSignature(transactionUtils.getDataToSignHash(resultSerialized), oracleKey.privateKey);
      const oraclePubKeyBuffer = oracleKey.publicKey.toBuffer();
      inputData = transactionUtils.createInputData(signatureOracle, oraclePubKeyBuffer);
    } else {
      // If it's not an address, we use the oracleInputData as the inputData directly
      inputData = oracleDataBuffer;
    }

    // Serialize args and create transaction
    const serializer = new Serializer();
    const serializedResult = serializer.fromSigned(inputData, result, 'string');

    const args = [serializedResult];
    const nc = new NanoContract([], [], ncId, 'set_result', args, privateKey.publicKey.toBuffer(), null);
    return signAndPushNCTransaction(nc, privateKey, pin, wallet.storage);
  }

}

export default Bet;
