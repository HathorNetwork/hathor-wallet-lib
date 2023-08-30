/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import BetTransactionBuilder from '../../src/nano_contracts/builder';
import SendTransaction from '../../src/new/sendTransaction';
import Address from '../../src/models/address';
import Input from '../../src/models/input';
import Output from '../../src/models/output';
import P2PKH from '../../src/models/p2pkh';
import Network from '../../src/models/network';
import wallet from '../../src/wallet';
import { HDPrivateKey, PrivateKey, crypto } from 'bitcore-lib';
import { HATHOR_BIP44_CODE } from '../../src/constants';
import { hexToBuffer } from '../../src/utils/buffer';

const address = new Address('WZWzpVRNWbxtcJcYSXqrQWDrNpQr14Vewx');
const nano_contract_id = '00005f0b3be724646f04a56c617dee4c2fc0830a863b8ada9583ceff91c52466';

const getPrivKey = () => {
  const pin = '123456';
  const words = 'mutual property noodle reason reform leisure roof foil siren basket decide above offer rate outdoor board input depend sort twenty little veteran code plunge';
  wallet.executeGenerateWallet(words, '', pin, 'password', false);

  const accessData = wallet.getWalletAccessData();
  const encryptedPrivateKey = accessData.mainKey;
  const privateKeyStr = wallet.decryptData(encryptedPrivateKey, pin);
  const key = HDPrivateKey(privateKeyStr)
  const derivedKey = key.deriveNonCompliantChild(0);
  return derivedKey.privateKey;
};


test('Bet creation', () => {
  const privateKey = getPrivKey();
  const pubkey = privateKey.publicKey.toBuffer();

  const oracleScript = Buffer.from([0x61, 0x63, 0x6f, 0x72, 0x64, 0x61, 0x2d, 0x70, 0x65, 0x64, 0x72, 0x69, 0x6e, 0x68, 0x6f]);
  const tokenId = '00';
  const dateLastOffer = 0;

  const builder = new BetTransactionBuilder();
  const bet = builder.createBetNC(pubkey, oracleScript, tokenId, dateLastOffer);
  const dataToSignHash = bet.getDataToSignHash();
  const sig = crypto.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
    nhashtype: crypto.Signature.SIGHASH_ALL
  });
  bet.signature = sig.toDER();
  bet.prepareToSend();

  expect(0).toBe(1);
})

test('Bet deposit', () => {
  const privateKey = getPrivKey();
  const pubkey = privateKey.publicKey.toBuffer();


  const txId = '339f47da87435842b0b1b528ecd9eac2495ce983b3e9c923a37e1befbe12c792';
  const txIndex = 0;
  const input = new Input(txId, txIndex);

  const builder = new BetTransactionBuilder();
  const bet = builder.deposit(nano_contract_id, pubkey, [input], [], address, '1x0');
  const dataToSignHash = bet.getDataToSignHash();
  const sig = crypto.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
    nhashtype: crypto.Signature.SIGHASH_ALL
  });
  bet.signature = sig.toDER();
  bet.prepareToSend();

  expect(0).toBe(1);
})

test('Bet withdraw', () => {
  const privateKey = getPrivKey();
  const pubkey = privateKey.publicKey.toBuffer();

  const p2pkh = new P2PKH(address);
  const p2pkhScript = p2pkh.createScript()
  const output = new Output(100, p2pkhScript);

  const builder = new BetTransactionBuilder();
  const bet = builder.withdraw(nano_contract_id, pubkey, [output], address, 100);
  const dataToSignHash = bet.getDataToSignHash();
  const sig = crypto.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
    nhashtype: crypto.Signature.SIGHASH_ALL
  });
  bet.signature = sig.toDER();
  bet.prepareToSend();

  expect(0).toBe(1);
})

test('Bet set result', () => {
  const privateKey = getPrivKey();
  const pubkey = privateKey.publicKey.toBuffer();

  const builder = new BetTransactionBuilder();
  const bet = builder.setResult(nano_contract_id, pubkey, '1x0');
  const dataToSignHash = bet.getDataToSignHash();
  const sig = crypto.ECDSA.sign(dataToSignHash, privateKey, 'little').set({
    nhashtype: crypto.Signature.SIGHASH_ALL
  });
  bet.signature = sig.toDER();
  bet.prepareToSend();

  expect(0).toBe(1);
})
