/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import wallet from '../../src/utils/wallet';
import { XPubError, InvalidWords, UncompressedPubKeyError } from '../../src/errors';
import Network from '../../src/models/network';
import Mnemonic from 'bitcore-mnemonic';
import { HD_WALLET_ENTROPY, HATHOR_BIP44_CODE } from '../../src/constants';
import { util, Address } from 'bitcore-lib';


test('Words', () => {
  const words = wallet.generateWalletWords();
  const wordsArr = words.split(' ');
  // 24 words
  expect(wordsArr.length).toBe(24);
  // Words are valid
  expect(wallet.wordsValid(words).valid).toBe(true);

  // With 23 words become invalid
  const invalidArr = wordsArr.slice(0, 23)
  expect(() => wallet.wordsValid(invalidArr.join(' '))).toThrowError(InvalidWords);

  // With 22 words and an invalid word, it's invalid and the invalid word will be on the error object
  const invalidArr2 = wordsArr.slice(0, 21)
  invalidArr2.push('i');
  invalidArr2.push('x');
  try {
    wallet.wordsValid(invalidArr2.join(' '));
  } catch(error) {
    expect(error).toBeInstanceOf(InvalidWords);
    expect(error.invalidWords).toStrictEqual(['i', 'x']);
  }

  // Wrong 24th word
  invalidArr.push('word');
  expect(() => wallet.wordsValid(invalidArr.join(' '))).toThrowError(InvalidWords);

  // If the wrong word does not belong to the mnemonic dictionary we return it in the list of invalidWords
  const invalidArr3 = invalidArr.slice(0, 23);
  invalidArr3.push('abc');
  try {
    wallet.wordsValid(invalidArr3.join(' '));
  } catch(error) {
    expect(error).toBeInstanceOf(InvalidWords);
    expect(error.invalidWords).toStrictEqual(['abc']);
  }

  // The separator may have breakline and multiples spaces
  const testWords = wordsArr.join('  \n');
  expect(wallet.wordsValid(testWords).valid).toBe(true);

  // Spaces before and after
  const newTestWords = `  ${testWords}  `;
  expect(wallet.wordsValid(newTestWords).valid).toBe(true);
})

test('Xpriv and xpub', () => {
  const code = new Mnemonic(HD_WALLET_ENTROPY);
  const network = new Network('testnet');
  const xpriv = code.toHDPrivateKey('', network.bitcoreNetwork);

  expect(wallet.getXPubKeyFromXPrivKey(xpriv.xprivkey)).toBe(xpriv.xpubkey);

  const derivedXprivAccount = xpriv.derive(`m/44'/${HATHOR_BIP44_CODE}'/0'`);
  const derivedXpriv = derivedXprivAccount.derive(0);
  const chainCode = derivedXpriv._buffers.chainCode;
  const fingerprint = derivedXpriv._buffers.parentFingerPrint;
  const derivedXpub = wallet.xpubFromData(derivedXpriv.publicKey.toBuffer(), chainCode, fingerprint, 'testnet');
  expect(derivedXpub).toBe(derivedXpriv.xpubkey);

  const pubKey = wallet.getPublicKeyFromXpub(derivedXpub, 10);
  const expectedRet = {};
  expectedRet[Address(pubKey, network.bitcoreNetwork).toString()] = 10;
  expect(expectedRet).toStrictEqual(wallet.getAddresses(derivedXprivAccount.xpubkey, 0, 10, 1, 'testnet'));

  // To pubkey compressed
  const uncompressedPubKeyHex = '044f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1';
  const compressedPubKey = wallet.toPubkeyCompressed(util.buffer.hexToBuffer(uncompressedPubKeyHex));
  const expectedCompressedPubKeyHex = '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa';
  expect(util.buffer.bufferToHex(compressedPubKey)).toBe(expectedCompressedPubKeyHex);

  // Invalid uncompressed public key must throw error
  expect(() => wallet.toPubkeyCompressed(util.buffer.hexToBuffer(uncompressedPubKeyHex + 'ab'))).toThrowError(UncompressedPubKeyError);
});

test('isXpubKeyValid', () => {
  const XPUBKEY = 'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res';
  expect(wallet.isXpubKeyValid(XPUBKEY)).toBe(true);
  expect(wallet.isXpubKeyValid(`${XPUBKEY}aa`)).toBe(false);
});

test('getHathorAddresses', () => {
  const XPUBKEY = 'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res';
  const ADDRESSES_0 = [
    'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci',
    'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4',
    'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag',
    'HNgJXBgj8UtZK4GD97yvDZhyjCLFoLBdDf',
    'HGfwgmn86RSQ1gNG6ceiKeiALwL84FuBf8',
    'HPmbgeKJu9DjNsrSHRZe6VEJC9YiLZ8WLx',
    'HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr',
    'H9ke3eZPPWBXCPHemz6ftZHvEHX1KHLTTg',
    'HSrfhXXAz7FxKzbG3VeqLCeUjVcLx3BpFD',
    'HQio5xMencxwWuCnPGEYGfwVunz7BDQoFf',
    'HHVZwDvm7sMXc75foXEceQra1Zbqzp2nHn',
    'HEibGHSs6tFcUbDKLnnY9nSsaaDFsjSg1t',
    'HK2eexidww2LvTF7cbBJZVHQghKc9UXUST',
    'HBh6y1ejjHqfMFxt6VKg8HuE3YGXttWwGh',
    'HHRUPc7H7wSbwwRpsoPP1m3bnBmjc5DNNq',
    'HTYFyEtzE9z4oW42k7DXFVPA6wqwBhKPQZ',
    'HKxw4Am1ecoTbKoVaJNL1xnNxY8dLpPggN',
    'HSUwYnnRYVnm4bLzV5dsBdqoSvZhunxPKr'
  ];
  const ADDRESSES_1 = [
    'HCYz5bUFNZjrUSPPP4Ro1KvtAuUuHnTnSE',
    'HRgvgpsRPy4b31iuFsjrskgLbmGXmxnoii',
    'H8nwsBA1vtHqkTEgpxDSkrhKzREamWqWdz',
    'H9ve5SiBcbNXgmPZz72NEDjv8ohMHyywuo',
    'HUD2a9Pht3bmDrtgM1tx5Kbgp1asCDbCk5',
    'HG6hXaVDhw4MqnUPhuWFVAWNJbATRtv1Wf',
    'HKzFyMyMHTgcwKbAhCxfNo96Ug6wkdHJtT',
    'HCG87oUSd2AWAoUsAP5np8PfLSACzmZtGe',
    'HGUdQNC7a7GT8GxkY1UGXARNuVjQ7Nf5qG',
    'HUNFrgqdt5ncpYeE4wSFPbFjPVzorxS7io',
    'HKsKUHVjJXagxyWmEWWaoL864GatGgeQsG',
    'HSssJwTT4VKKHASecAL81AwyKzG4xdXptm',
    'HNY6YyuqSKsX3zgW7XVsKehpcK4tkyTot9',
    'HJ4ztZeZjVwofoEwoNg9DYFF6AYBNB2hRJ',
    'HCzQph3TxoXF6V6S4TSKBa28rwLDqnzS6R',
    'HBuUUbyGQt7aFiGjhSXgQKVr2yP9JMfB6L',
    'HNtQbba3DJTfUzQWoeMxQHJ1m2sGW8AFQK',
    'HBa6H55oxGMDHc5PBFqrSv93puwWvnwcFy'
  ];
  let calculatedAddresses = wallet.getAddresses(XPUBKEY, 0, 0, ADDRESSES_0.length, 'mainnet');
  let addrList = Object.keys(calculatedAddresses);
  expect(addrList).toHaveLength(ADDRESSES_0.length);
  expect(addrList).toStrictEqual(ADDRESSES_0);

  // start not from 0
  calculatedAddresses = wallet.getAddresses(XPUBKEY, 0, 5, ADDRESSES_0.length - 5, 'mainnet');
  addrList = Object.keys(calculatedAddresses);
  expect(addrList).toHaveLength(ADDRESSES_0.length - 5);
  expect(addrList).toStrictEqual(ADDRESSES_0.slice(5));

  expect(() => wallet.getAddresses(`${XPUBKEY}aa`, 5, ADDRESSES_0.length - 5, 'mainnet')).toThrowError(XPubError);

  // With change derivation as 1, the addresses are different
  const calculatedAddresses1 = wallet.getAddresses(XPUBKEY, 1, 0, ADDRESSES_1.length, 'mainnet');
  const addrList1 = Object.keys(calculatedAddresses1);
  expect(addrList1).toHaveLength(ADDRESSES_1.length);
  expect(addrList1).toStrictEqual(ADDRESSES_1);
});