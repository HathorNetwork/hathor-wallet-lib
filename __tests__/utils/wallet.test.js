/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import wallet from '../../src/utils/wallet';
import { XPubError } from '../../src/errors';
import Network from '../../src/models/network';
import Mnemonic from 'bitcore-mnemonic';
import { HD_WALLET_ENTROPY, HATHOR_BIP44_CODE } from '../../src/constants';


test('Words', () => {
  const words = wallet.generateWalletWords();
  const wordsArr = words.split(' ');
  // 24 words
  expect(wordsArr.length).toBe(24);
  // Words are valid
  expect(wallet.wordsValid(words).valid).toBe(true);

  // With 23 words become invalid
  const invalidArr = wordsArr.slice(0, 23)
  expect(wallet.wordsValid(invalidArr.join(' ')).valid).toBe(false);
  // Wrong 24th word
  invalidArr.push('word');
  expect(wallet.wordsValid(invalidArr.join(' ')).valid).toBe(false);

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

  const derivedXpriv = xpriv.derive(`m/44'/${HATHOR_BIP44_CODE}'/0'/0`);
  const chainCode = derivedXpriv._buffers.chainCode;
  const fingerprint = derivedXpriv._buffers.parentFingerPrint;
  const derivedXpub = wallet.xpubFromData(derivedXpriv.publicKey.toBuffer(), chainCode, fingerprint, 'testnet');
  expect(derivedXpub).toBe(derivedXpriv.xpubkey);

  // TODO test toPubkeyCompressed and getPublicKeyFromXpub
});

test('isXpubKeyValid', () => {
  const XPUBKEY = 'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res';
  expect(wallet.isXpubKeyValid(XPUBKEY)).toBe(true);
  expect(wallet.isXpubKeyValid(`${XPUBKEY}aa`)).toBe(false);
});

test('getHathorAddresses', () => {
  const XPUBKEY = 'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res';
  const ADDRESSES = [
    'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA',
    'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4',
    'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK',
    'HQ2PjhE8ocyGgA17mGn8ny913iVpR6FBAm',
    'HKghT5LSxtZHa4Z2VYYBW4WDMnQHSVEBHA',
    'HGx6zgR96ubefHcAGgEv48NJp6ccVxMYJo',
    'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL',
    'HMmFLoWSagfvSUiEbE2mVDY7BYx1HPdXGf',
    'HQcnzbpCHKqhDm8Hd8mikVyb4oK2qoadPJ',
    'HEfqUBf4Rd4A35uhdtv7fuUtthGtjptYQC',
    'HLUjnbbgxzgDTLAU7TjsTHzuZpeYY2xezw',
    'HBYRWYMpDQzkBPCdAJMix4dGNVi81CC855',
    'HJVq5DKPTeJ73UpuivJURdhfWnTLG7WAjo',
    'HGJFqxUw6ntRxLjcEbvFz9GHsLxHzR9hQs',
    'HPapaHpBZArxt2EK9WUy9HT9H3PgfidBgN',
    'HJdAEBVMKygzntrw7Q3Qr8osLXLGUe8M65',
    'HGgSipJMLrHxGHambXtVc9Y9Lf9hxLxRVk',
    'HGgatY7US4cSPDppzrKUYdp2V1r7LWGyVf',
  ];
  let calculatedAddresses = wallet.getAddresses(XPUBKEY, 0, ADDRESSES.length, 'mainnet');
  let addrList = Object.keys(calculatedAddresses);
  expect(addrList).toHaveLength(ADDRESSES.length);
  expect(addrList).toStrictEqual(ADDRESSES);

  // start not from 0
  calculatedAddresses = wallet.getAddresses(XPUBKEY, 5, ADDRESSES.length - 5, 'mainnet');
  addrList = Object.keys(calculatedAddresses);
  expect(addrList).toHaveLength(ADDRESSES.length - 5);
  expect(addrList).toStrictEqual(ADDRESSES.slice(5));

  expect(() => wallet.getAddresses(`${XPUBKEY}aa`, 5, ADDRESSES.length - 5, 'mainnet')).toThrowError(XPubError);
});