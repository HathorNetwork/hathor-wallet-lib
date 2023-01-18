/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Utxo } from '../wallet/types';
import { UtxoError } from '../errors';
import { HistoryTransactionOutput } from '../models/types';
import {crypto as cryptoBL, PrivateKey, HDPrivateKey} from 'bitcore-lib'
import { TOKEN_AUTHORITY_MASK, TOKEN_MINT_MASK, TOKEN_MELT_MASK, HATHOR_TOKEN_CONFIG, CREATE_TOKEN_TX_VERSION, DEFAULT_TX_VERSION } from '../constants';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Input from '../models/input';
import Output from '../models/output';
import Network from '../models/network';
import { IBalance, IStorage, IHistoryTx, IDataOutput, IDataTx, isDataOutputCreateToken, IHistoryOutput, IDataInput } from '../types';
import Address from '../models/address';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import ScriptData from '../models/script_data';
import { ParseError } from '../errors';
import helpers from './helpers';
import { getAddressType } from './address';

const transaction = {

  /**
   * Check if the output is an authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'>} output An output with the token_data field
   * @returns {boolean} If the output is an authority output
   */
  isAuthorityOutput(output: Pick<HistoryTransactionOutput, 'token_data'>): boolean {
    return (output.token_data & TOKEN_AUTHORITY_MASK) > 0;
  },

  /**
   * Check if the output is a mint authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'|'value'>} output An output with the token_data and value fields
   * @returns {boolean} If the output is a mint authority output
   */
  isMint(output: Pick<HistoryTransactionOutput, 'token_data'|'value'>): boolean {
    return this.isAuthorityOutput(output) && ((output.value & TOKEN_MINT_MASK) > 0);
  },

  /**
   * Check if the output is a melt authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'|'value'>} output An output with the token_data and value fields
   * @returns {boolean} If the output is a melt authority output
   */
  isMelt(output: Pick<HistoryTransactionOutput, 'token_data'|'value'>): boolean {
    return this.isAuthorityOutput(output) && ((output.value & TOKEN_MELT_MASK) > 0);
  },

  /**
   * Check if the utxo is locked
   *
   * @param {Pick<HistoryTransactionOutput, 'decoded'>} output The output to check
   * @param {{refTs: number|undefined}} options Use these values as reference to check if the output is locked
   * @returns {boolean} Wheather the output is locked or not
   */
  isOutputLocked(
    output: Pick<HistoryTransactionOutput, 'decoded'>,
    options: { refTs?: number } = {},
  ): boolean {
    // XXX: check reward lock: requires blockHeight, bestBlockHeight and reward_spend_min_blocks
    const refTs = options.refTs || Math.floor(Date.now() / 1000);
    return (
      output.decoded.timelock !== undefined
      && output.decoded.timelock !== null
      && output.decoded.timelock > refTs
    );
  },

  /**
   * Get the signature from the dataToSignHash for a private key
   *
   * @param {Buffer} dataToSignHash hash of a transaction's dataToSign.
   * @param {PrivateKey} privateKey Signing key.
   *
   * @returns {Buffer}
   *
   * @memberof transaction
   * @inner
   */
  getSignature(dataToSignHash: Buffer, privateKey: PrivateKey): Buffer {
    const signature = cryptoBL.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
      nhashtype: cryptoBL.Signature.SIGHASH_ALL,
    });
    return signature.toDER();
  },

  async signTransaction(tx: Transaction, storage: IStorage, pinCode: string): Promise<Transaction> {
    const xprivstr = await storage.getMainXPrivKey(pinCode);
    const xprivkey = HDPrivateKey.fromString(xprivstr);
    const dataToSignHash = tx.getDataToSignHash();

    for await (const {tx: spentTx, input} of storage.getSpentTxs(tx.inputs)) {
      const spentOut = spentTx.outputs[input.index];
      if (!spentOut.decoded.address) {
        // This is not a wallet output
        continue;
      }
      const addressInfo = await storage.getAddressInfo(spentOut.decoded.address);
      if (!addressInfo) {
        // Not a wallet address
        continue;
      }
      const xpriv = xprivkey.deriveNonCompliantChild(addressInfo.bip32AddressIndex);
      const inputData = this.createInputData(
        this.getSignature(dataToSignHash, xpriv.privateKey),
        xpriv.publicKey.toBuffer(),
      );
      input.setData(inputData);
    }

    return tx;
  },

  /**
   * Select best utxos with the algorithm described below. This method expects the utxos to be sorted by greatest value
   *
   * 1. If we have a single utxo capable of handle the full amount requested,
   * we return the utxo with smaller amount among the ones that have an amount bigger than the requested
   * 2. Otherwise we reverse sort the utxos by amount and select the utxos in order until the full amount is fulfilled.
   *
   * @memberof transaction
   * @inner
   */
  selectUtxos(utxos: Utxo[], totalAmount: number): {utxos: Utxo[], changeAmount: number} {
    if (totalAmount <= 0) {
      throw new UtxoError('Total amount must be a positive integer.');
    }

    if (utxos.length === 0) {
      throw new UtxoError('Don\'t have enough utxos to fill total amount.');
    }

    let utxosToUse: Utxo[] = [];
    let filledAmount = 0;
    for (const utxo of utxos) {
      if (utxo.value >= totalAmount) {
        utxosToUse = [utxo];
        filledAmount = utxo.value;
      } else {
        if (filledAmount >= totalAmount) {
          break;
        }
        filledAmount += utxo.value;
        utxosToUse.push(utxo);
      }
    }
    if (filledAmount < totalAmount) {
      throw new UtxoError('Don\'t have enough utxos to fill total amount.');
    }

    return {
      utxos: utxosToUse,
      changeAmount: filledAmount - totalAmount,
    };
  },

  /**
   * Convert an output from the history of transactions to an Utxo.
   *
   * @param {string} txId The transaction this output belongs to.
   * @param {number} index The output index on the original transaction.
   * @param {HistoryTransactionOutput} txout output from the transaction history.
   * @param {Object} [options]
   * @param {string} [options.addressPath=''] utxo address bip32 path
   *
   * @returns {Utxo}
   *
   * @memberof transaction
   */
  utxoFromHistoryOutput(
    txId: string,
    index: number,
    txout: HistoryTransactionOutput,
    { addressPath = '' }: { addressPath?: string },
  ): Utxo {
    const isAuthority = this.isAuthorityOutput(txout);

    return {
      txId,
      index,
      addressPath,
      address: txout.decoded && txout.decoded.address || '',
      timelock: txout.decoded && txout.decoded.timelock || null,
      tokenId: txout.token,
      value: txout.value,
      authorities: isAuthority ? txout.value : 0,
      heightlock: null, // not enough info to determine this.
      locked: false,
    };
  },

  /**
   * Calculate the balance of a transaction
   *
   * @param tx Transaction to get balance from
   * @param storage Storage to get metadata from
   * @returns {Promise<Record<string, IBalance>>} Balance of the transaction
   */
  async getTxBalance(tx: IHistoryTx, storage: IStorage): Promise<Record<string, IBalance>> {
    const balance: Record<string, IBalance> = {};
    const getEmptyBalance = (): IBalance => ({
      tokens: { locked: 0, unlocked: 0 },
      authorities: {
        mint: { locked: 0, unlocked: 0 },
        melt: { locked: 0, unlocked: 0 },
      },
    });

    const nowTs = Math.floor(Date.now() / 1000);
    const nowHeight = await storage.getCurrentHeight();
    const rewardLock = storage.version?.reward_spend_min_blocks;
    const isHeightLocked = (!(rewardLock && tx.height)) ? false : ((tx.height + rewardLock) < nowHeight);

    for (const output of tx.outputs) {
      const address = output.decoded.address;
      if (!(address && await storage.isAddressMine(address))) {
        continue;
      }
      if (!balance[output.token]) {
        balance[output.token] = getEmptyBalance();
      }
      const isLocked = this.isOutputLocked(output, { refTs: nowTs }) || isHeightLocked;

      if (this.isAuthorityOutput(output)) {
        if (this.isMint(output)) {
          if (isLocked) {
            balance[output.token].authorities.mint.locked += 1;
          } else {
            balance[output.token].authorities.mint.unlocked += 1;
          }
        }
        if (this.isMelt(output)) {
          if (isLocked) {
            balance[output.token].authorities.melt.locked += 1;
          } else {
            balance[output.token].authorities.melt.unlocked += 1;
          }
        }
      } else {
        if (isLocked) {
          balance[output.token].tokens.locked += output.value;
        } else {
          balance[output.token].tokens.unlocked += output.value;
        }
      }
    }

    for (const input of tx.inputs) {
      const address = input.decoded.address;
      if (!(address && await storage.isAddressMine(address))) {
        continue;
      }
      if (!balance[input.token]) {
        balance[input.token] = getEmptyBalance();
      }

      if (this.isAuthorityOutput(input)) {
        if (this.isMint(input)) {
          balance[input.token].authorities.mint.unlocked -= 1;
        }
        if (this.isMelt(input)) {
          balance[input.token].authorities.melt.unlocked -= 1;
        }
      } else {
        balance[input.token].tokens.unlocked -= input.value;
      }
    }

    return balance;
  },

  /**
   * Get the token_data for a given output
   *
   * @param {IDataOutput} output output data
   * @param {string[]} tokens List of tokens in the transaction
   * @returns {number} Calculated TokenData for the output token
   */
  getTokenDataFromOutput(output: IDataOutput, tokens: string[]): number {
    if (isDataOutputCreateToken(output)) {
      // This output does not contain the token since it will be creating
      // But knowing this, we also know the token index of it.
      if (output.authorities === 0) {
        return 1;
      }
      return 1 | TOKEN_AUTHORITY_MASK;
    }

    // Token index of HTR is 0 and if it is a custom token it is its index on tokensWithoutHathor + 1
    const tokensWithoutHathor = tokens.filter((token) => token !== HATHOR_TOKEN_CONFIG.uid);
    const tokenIndex = tokensWithoutHathor.indexOf(output.token) + 1;
    if (output.authorities === 0) {
      return tokenIndex;
    }
    return tokenIndex | TOKEN_AUTHORITY_MASK;
  },

  /**
   * Create output script
   *
   * @param {IDataOutput} output Output with data to create the script
   *
   * @throws {AddressError} If the address is invalid
   *
   * @return {Buffer} Output script
   */
  createOutputScript(output: IDataOutput, network: Network): Buffer {
    if (output.type === 'data') {
      // Data script for NFT
      const scriptData = new ScriptData(output.data);
      return scriptData.createScript();
    } else if (getAddressType(output.address, network) === 'p2sh') {
      // P2SH
      const address = new Address(output.address, { network });
      // This will throw AddressError in case the address is invalid
      address.validateAddress();
      const p2sh = new P2SH(address, { timelock: output.timelock });
      return p2sh.createScript();
    } else if (getAddressType(output.address, network) === 'p2pkh') {
      // P2PKH
      const address = new Address(output.address, { network });
      // This will throw AddressError in case the address is invalid
      address.validateAddress();
      const p2pkh = new P2PKH(address, { timelock: output.timelock });
      return p2pkh.createScript();
    } else {
      throw new Error('Invalid output for creating script.');
    }
  },

  /**
   * Create a Transaction instance from tx data.
   *
   * @param {IDataTx} txData Tx data to create the transaction
   * @param {Network} network network to use
   * @returns {Transaction}
   */
  createTransactionFromData(txData: IDataTx, network: Network): Transaction {
    const inputs: Input[] = txData.inputs.map(input => {
      const inputObj = new Input(input.txId, input.index);
      if (input.data) {
        inputObj.setData(Buffer.from(input.data, 'hex'));
      }
      return inputObj;
    });
    const outputs: Output[] = txData.outputs.map(output => {
      const script = this.createOutputScript(output, network);
      const tokenData = this.getTokenDataFromOutput(output, txData.tokens);
      return new Output(output.value, script, { tokenData });
    });
    const options = {
      version: txData.version === undefined ? DEFAULT_TX_VERSION : txData.version,
      weight: txData.weight || 0,
      nonce: txData.nonce || 0,
      timestamp: txData.timestamp || null,
      parents: txData.parents || [],
      tokens: txData.tokens || [],
    };
    if (options.version === CREATE_TOKEN_TX_VERSION) {
      return new CreateTokenTransaction(txData.name!, txData.symbol!, inputs, outputs, options);
    } else if (options.version === DEFAULT_TX_VERSION) {
      return new Transaction(inputs, outputs, options);
    } else {
      throw new ParseError('Invalid transaction version.');
    }
  },

  /**
   * Prepare a Transaction instance from the transaction data and storage
   *
   * @param tx tx data to be prepared
   * @param pinCode pin to unlock the mainKey for signatures
   * @param storage Storage to get the mainKey
   * @returns {Promise<Transaction>} Prepared transaction
   */
  async prepareTransaction(txData: IDataTx, pinCode: string, storage: IStorage): Promise<Transaction> {
    const network = storage.config.getNetwork();
    const tx = this.createTransactionFromData(txData, network);
    await this.signTransaction(tx, storage, pinCode);
    tx.prepareToSend();

    return tx;
  },

  /**
   * Create P2PKH input data
   *
   * @param {Buffer} signature Input signature
   * @param {Buffer} publicKey Input public key
   * @returns {Buffer} Input data
   */
  createInputData(signature: Buffer, publicKey: Buffer): Buffer {
    let arr = [];
    helpers.pushDataToStack(arr, signature);
    helpers.pushDataToStack(arr, publicKey);
    return Buffer.concat(arr);
  },

  /**
   * Calculate the authorities data for an output
   *
   * @param output History output
   * @returns {number} Authorities from output
   */
  authoritiesFromOutput(output: Pick<IHistoryOutput, 'token_data'|'value'>): number {
    let authorities = 0;
    if (this.isMint(output)) {
      authorities |= TOKEN_MINT_MASK;
    }
    if (this.isMelt(output)) {
      authorities |= TOKEN_MELT_MASK;
    }
    return authorities;
  },
}

export default transaction;
