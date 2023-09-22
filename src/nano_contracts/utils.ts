/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import transactionUtils from '../utils/transaction';
import { crypto } from 'bitcore-lib';
import SendTransaction from '../new/sendTransaction';

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
export const signAndPushNCTransaction = async (tx, privateKey, pin, storage) => {
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
