/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Utxo } from '../wallet/types';
import { UtxoError } from '../errors';
import { HistoryTransactionOutput } from '../models/types';
import wallet from '../wallet';
import {crypto as cryptoBL, PrivateKey} from 'bitcore-lib'
import { TOKEN_AUTHORITY_MASK, TOKEN_MINT_MASK, TOKEN_MELT_MASK } from '../constants';
import Transaction from '../models/transaction';
import Input from '../models/input';
import Network from '../models/network';
import { IBalance, IStorage, IStorageTx } from '../types';

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
      && output.decoded.timelock <= refTs
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
   * @inner
   */
  utxoFromHistoryOutput(
    txId: string,
    index: number,
    txout: HistoryTransactionOutput,
    { addressPath = '' }: { addressPath?: string },
  ): Utxo {
    const isAuthority = wallet.isAuthorityOutput(txout);

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

  async getTxBalance(tx: IStorageTx, storage: IStorage): Promise<Record<string, IBalance>> {
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
    const isHeightLocked = (height?: number): boolean => {
      // Must have reward lock and height to check for height lock
      if (!(rewardLock && height)) return false
      return (height + rewardLock) < nowHeight;
    };

    for (const output of tx.outputs) {
      if (!balance[output.token]) {
        balance[output.token] = getEmptyBalance();
      }
      const isLocked = this.isOutputLocked(output, { refTs: nowTs }) || isHeightLocked(output.height);

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
}

export default transaction;
