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
import { hexToBuffer } from '../../src/utils/buffer';


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

  const xprivAccount = xpriv.deriveNonCompliantChild(`m/44'/${HATHOR_BIP44_CODE}'/0'`);
  const xpubAccount = xprivAccount.xpubkey;
  const derivedXpriv = xprivAccount.deriveNonCompliantChild(0);

  expect(wallet.xpubDeriveChild(xpubAccount, 0)).toBe(derivedXpriv.xpubkey);

  const chainCode = derivedXpriv._buffers.chainCode;
  const fingerprint = derivedXpriv._buffers.parentFingerPrint;
  const derivedXpub = wallet.xpubFromData(derivedXpriv.publicKey.toBuffer(), chainCode, fingerprint, 'testnet');
  expect(derivedXpub).toBe(derivedXpriv.xpubkey);

  const pubKey = wallet.getPublicKeyFromXpub(derivedXpub, 10);
  const expectedRet = {};
  const address10 = Address(pubKey, network.bitcoreNetwork).toString();
  expectedRet[address10] = 10;
  expect(expectedRet).toStrictEqual(wallet.getAddresses(derivedXpub, 10, 1, 'testnet'));

  expect(wallet.getAddressAtIndex(derivedXpub, 10, 'testnet')).toBe(address10);

  // To pubkey compressed
  const uncompressedPubKeyHex = '044f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1';
  const compressedPubKey = wallet.toPubkeyCompressed(hexToBuffer(uncompressedPubKeyHex));
  const expectedCompressedPubKeyHex = '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa';
  expect(util.buffer.bufferToHex(compressedPubKey)).toBe(expectedCompressedPubKeyHex);

  // Invalid uncompressed public key must throw error
  expect(() => wallet.toPubkeyCompressed(hexToBuffer(uncompressedPubKeyHex + 'ab'))).toThrowError(UncompressedPubKeyError);
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

test('hd derivation', () => {
  // Seed that generate 31 byte private keys (through xpriv.privateKey.bn.toBuffer())
  const Words31B = 'few hint winner dignity where paper glare manual erupt school iron panther sign whisper egg buzz opera joy cable minor slot skull zoo system';

  // 10 first addresses derived from the seed above on the paths m/44'/280'/0'/0/0-9
  const Addr31B = [
    'WZmfUEAzZkCcUWG2XFsLRXvErswmfm6kXE',
    'WkXzzbKenz72uThsSGp93UeyFJqkpEV5cg',
    'WVBoPads4aWMBCNrGfLnj5zfTvqoqiJFAf',
    'WaKXxYh1H7kRV7i8wV29YgwVy6RygDxuEq',
    'WZtSQHGYBtu72QrRYN3giWVMZ9y61jsnie',
    'WUkz8Qib368ssTDMQoBXXMnWJAxGKJWDPX',
    'WhxHrL1cyQ8qHR5eaYdi2pJ1MQuMycZv8q',
    'WcywrinkAiyVSv9kB8UchNBMLRPt5q6uF3',
    'WQUAM7ynWeeyZAEEoBu9FyrybRmYxHQrQR',
    'WavSG5HpmG6Nq3faEAdzsCxYRbRrzFQWRB',
  ]

  // Seed that generate 32 byte private keys (through xpriv.privateKey.bn.toBuffer())
  const Words32B = 'employ name misery bring pepper drive deal journey young prefer pluck rough entire tag mouse rough belt history arm shove crouch crater lobster remember';

  // 10 first addresses derived from the seed above on the paths m/44'/280'/0'/0/0-9
  const Addr32B = [
    'WVEp3HoztTxmaBGawkyLKcvsNNV4Nd6Z7n',
    'WgGCFzgPE6RAwkGNBJZGTAJ9irV9vV5MjE',
    'Wk1bJ2C886MfzjE9hVeSBoeF4T2bUpk48Y',
    'WfeBrfT2beJB2Vq2PaMuiTiBedDhW8NSgC',
    'Wd483JsLQN7G5MjikwXBm6bQCAagyvf4m4',
    'WiZG9r8CKoNd7vTTnoAp86bPxQ5N6qM3no',
    'WP6GLZPkXZh9A9ZD9n7MaJCxHX1fRE7LvP',
    'WaUjcZ7UThBxH5wrJfb5GNnQZCzWJ3kMGH',
    'WZgiheyfEresupQuyZvKsKdym3y755HSnT',
    'WednacQNGATvx1S2FTTCRbi2Sjs6mzS9f6',
  ]

  // These tests will determine bitcore has not changed the implementations of derive and deriveNonCompliantChild
  // For 31 bytes private keys
  const xpriv31B = wallet.getXPrivKeyFromSeed(Words31B, {networkName: 'testnet'});
  expect(xpriv31B.privateKey.bn.toBuffer().length).toBe(31);
  const dpriv31Bd = xpriv31B.derive('m/44\'/280\'/0\'/0');
  const dpriv31B = xpriv31B.deriveNonCompliantChild('m/44\'/280\'/0\'/0');
  for (let i = 0; i < 10; i++) {
    const addrd = dpriv31Bd.derive(i).publicKey.toAddress().toString();
    const addr = dpriv31B.deriveNonCompliantChild(i).publicKey.toAddress().toString();
    expect(addr).toStrictEqual(addrd); // derive and deriveNonCompliant should be the same
    expect(addr).toStrictEqual(Addr31B[i]); // and both should generate the expected address
  }

  // For 32 bytes private keys
  const xpriv32B = wallet.getXPrivKeyFromSeed(Words32B, {networkName: 'testnet'});
  expect(xpriv32B.privateKey.bn.toBuffer().length).toBe(32);
  const dpriv32Bd = xpriv32B.derive('m/44\'/280\'/0\'/0');
  const dpriv32B = xpriv32B.deriveNonCompliantChild('m/44\'/280\'/0\'/0');
  for (let i = 0; i < 10; i++) {
    const addrd = dpriv32Bd.derive(i).publicKey.toAddress().toString();
    const addr = dpriv32B.deriveNonCompliantChild(i).publicKey.toAddress().toString();
    expect(addr).toStrictEqual(addrd);
    expect(addr).toStrictEqual(Addr32B[i]);
  }

  // test our address generation
  // XXX: the accountDerivationIndex being 0'/0 is a temporary fix
  // getXPubKeyFromSeed does not derive for 'change' (https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#change)
  const xpub31B = wallet.getXPubKeyFromSeed(Words31B, {accountDerivationIndex: '0\'/0', networkName: 'testnet'});
  const addressObj31B = wallet.getAddresses(xpub31B, 0, 10, 'testnet');
  const address31B = Object.keys(addressObj31B);
  for (let i = 0; i < 10; i++) {
    expect(address31B[i]).toStrictEqual(Addr31B[i]);
  }

  const xpub32B = wallet.getXPubKeyFromSeed(Words32B, {accountDerivationIndex: '0\'/0', networkName: 'testnet'});
  const addressObj32B = wallet.getAddresses(xpub32B, 0, 10, 'testnet');
  const address32B = Object.keys(addressObj32B);
  for (let i = 0; i < 10; i++) {
    expect(address32B[i]).toStrictEqual(Addr32B[i]);
  }
});
