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
import { util, Address, HDPrivateKey } from 'bitcore-lib';
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

test('testnet: hd derivation', () => {
  const testnet = new Network('testnet');
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
    const addrd = dpriv31Bd.derive(i).publicKey.toAddress(testnet.bitcoreNetwork).toString();
    const addr = dpriv31B.deriveNonCompliantChild(i).publicKey.toAddress(testnet.bitcoreNetwork).toString();
    expect(addr).toStrictEqual(addrd); // derive and deriveNonCompliant should be the same
    expect(addr).toStrictEqual(Addr31B[i]); // and both should generate the expected address
  }

  // For 32 bytes private keys
  const xpriv32B = wallet.getXPrivKeyFromSeed(Words32B, {networkName: 'testnet'});
  expect(xpriv32B.privateKey.bn.toBuffer().length).toBe(32);
  const dpriv32Bd = xpriv32B.derive('m/44\'/280\'/0\'/0');
  const dpriv32B = xpriv32B.deriveNonCompliantChild('m/44\'/280\'/0\'/0');
  for (let i = 0; i < 10; i++) {
    const addrd = dpriv32Bd.derive(i).publicKey.toAddress(testnet.bitcoreNetwork).toString();
    const addr = dpriv32B.deriveNonCompliantChild(i).publicKey.toAddress(testnet.bitcoreNetwork).toString();
    expect(addr).toStrictEqual(addrd);
    expect(addr).toStrictEqual(Addr32B[i]);
  }

  // test our address generation
  // XXX: the accountDerivationIndex being 0'/0 is a temporary fix
  // getXPubKeyFromSeed does not derive for 'change' (https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#change)
  const xpub31B = wallet.getXPubKeyFromSeed(Words31B, {networkName: 'testnet', accountDerivationIndex: '0\'/0'});
  const addressObj31B = wallet.getAddresses(xpub31B, 0, 10, 'testnet');
  const address31B = Object.keys(addressObj31B);
  for (let i = 0; i < 10; i++) {
    expect(address31B[i]).toStrictEqual(Addr31B[i]);
  }

  const xpub32B = wallet.getXPubKeyFromSeed(Words32B, {networkName: 'testnet', accountDerivationIndex: '0\'/0'});
  const addressObj32B = wallet.getAddresses(xpub32B, 0, 10, 'testnet');
  const address32B = Object.keys(addressObj32B);
  for (let i = 0; i < 10; i++) {
    expect(address32B[i]).toStrictEqual(Addr32B[i]);
  }
});

test('testnet: hd derivation with passphrase', () => {
  const testnet = new Network('testnet');
  // simple passphrase
  const passw = 'Hathor@Network';

  const Words = 'employ name misery bring pepper drive deal journey young prefer pluck rough entire tag mouse rough belt history arm shove crouch crater lobster remember';

  const Addr = [
    'WdWYtBvHHsD476nev6YkwXPVQcFWaPVHoX',
    'WNxy8hfHmtnaMuDrNLLkJURricGEJBtw1H',
    'WZvuKYKXztEkfDemxRoh8qBpkWUmFN1dkw',
    'WXeVhv7p2rnHqN2gUcJBZ99gponjw6Rq2G',
    'WRbgHXLJAc7pLBFfU5CMRiEhAKWFYQQWYW',
    'WNtSVKXXfFRza9vd4LbqwR52X9NHcp7RHK',
    'WkdDpDyzr2yvkyp1EhGeeKuCAyQiDRDo1E',
    'WhvotQQpzmWaQtXarPwjnwjrgurWW4v4YY',
    'WfwPJKbazRfMDrNfbSfeM5ybenQmKpHrNh',
    'Waks5ExFgsjyx8gamRbVmhZuyLTAhELkgh'
  ]

  // For 32 bytes private keys
  const xpriv = wallet.getXPrivKeyFromSeed(
      Words,
      {
        passphrase: passw,
        networkName: 'testnet',
      }
  );
  const dprivd = xpriv.derive('m/44\'/280\'/0\'/0');
  const dpriv = xpriv.deriveNonCompliantChild('m/44\'/280\'/0\'/0');
  for (let i = 0; i < 10; i++) {
    const addrd = dprivd.derive(i).publicKey.toAddress(testnet.bitcoreNetwork).toString();
    const addr = dpriv.deriveNonCompliantChild(i).publicKey.toAddress(testnet.bitcoreNetwork).toString();

    expect(addr).toStrictEqual(addrd);
    expect(addr).toStrictEqual(Addr[i]);
  }

  const xpub = wallet.getXPubKeyFromSeed(
      Words,
      {
        passphrase: passw,
        networkName: 'testnet',
        accountDerivationIndex: '0\'/0',
      },
  );
  const addressObj = wallet.getAddresses(xpub, 0, 10, 'testnet');
  const address = Object.keys(addressObj);
  for (let i = 0; i < 10; i++) {
    expect(address[i]).toStrictEqual(Addr[i]);
  }
});

test('mainnet: hd derivation', () => {
  const mainnet = new Network('mainnet');
  // Seed that generate 31 byte private keys (through xpriv.privateKey.bn.toBuffer())
  const Words31B = 'few hint winner dignity where paper glare manual erupt school iron panther sign whisper egg buzz opera joy cable minor slot skull zoo system';

  // 10 first addresses derived from the seed above on the paths m/44'/280'/0'/0/0-9
  const Addr31B = [
    'HHckyeLV8nuhVCfAiQspRPwH6ESe8cVuyo',
    'HUP6W1V9N2p7vA71dRpd3Lg1UfLdJu7afi',
    'HD2ttzoMddDSBtmzTpMGix1hhHLgRTLcuS',
    'HJAdTxrVrATWVp7H8e2dYYxYCSvrA3uHvs',
    'HHjXuhS2kwcC37FZjX4AiNWPnWTxVJk2Ag',
    'HCc5dpt5c8qxt9cVbxC1XDoYXXT8v3FhjM',
    'HRoPMkB7YSqvJ7UnmheC2gK3amQEUuZeZC',
    'HLq3N8xEjmgaTcYtNHV6hECPZmtkhEA9r2',
    'H8KFrY9H5hN4ZrdNzLudFqt1pnGRXUZr71',
    'HJmXmVTKLJoTqk4iRKeUs4yaewvjUvJZiv'
  ]

  // Seed that generate 32 byte private keys (through xpriv.privateKey.bn.toBuffer())
  const Words32B = 'employ name misery bring pepper drive deal journey young prefer pluck rough entire tag mouse rough belt history arm shove crouch crater lobster remember';

  // 10 first addresses derived from the seed above on the paths m/44'/280'/0'/0/0-9
  const Addr32B = [
    'HD5uYhyVTWfrasfj8uypKUwubiyvsFp6UZ',
    'HQ7HmQqso98FxSfWNTZkT2KBxCz2SHhSg4',
    'HTrgoSMch94m1RdHteevBffHHoXU393C45',
    'HPVHN5cXAh1G3CEAajNPiKjDsyiZzpeoU1',
    'HLuDYj2pyQpM648rx6XfkxcSRX5ZaqQYfD',
    'HSQMfGHgtr5i8crbyxBJ7xcSBkaEb7YyjU',
    'H6wMqyZF6cQEAqxMLw7qaADzWsWY1YVYs7',
    'HJKq7yGy2ju3HnLzVpbZGEoSnZVNoS6oUH',
    'HHXpD599ouMxvWp4AivosBf1zQTyb2LETZ',
    'HNUt62ZrqDB1xhqAScTgRTj4g6MyEwrWDM'
  ]

  // These tests will determine bitcore has not changed the implementations of derive and deriveNonCompliantChild
  // For 31 bytes private keys
  const xpriv31B = wallet.getXPrivKeyFromSeed(Words31B, {networkName: 'mainnet'});
  expect(xpriv31B.privateKey.bn.toBuffer().length).toBe(31);
  const dpriv31Bd = xpriv31B.derive('m/44\'/280\'/0\'/0');
  const dpriv31B = xpriv31B.deriveNonCompliantChild('m/44\'/280\'/0\'/0');
  for (let i = 0; i < 10; i++) {
    const addrd = dpriv31Bd.derive(i).publicKey.toAddress(mainnet.bitcoreNetwork).toString();
    const addr = dpriv31B.deriveNonCompliantChild(i).publicKey.toAddress(mainnet.bitcoreNetwork).toString();
    expect(addr).toStrictEqual(addrd); // derive and deriveNonCompliant should be the same
    expect(addr).toStrictEqual(Addr31B[i]); // and both should generate the expected address
  }

  // For 32 bytes private keys
  const xpriv32B = wallet.getXPrivKeyFromSeed(Words32B, {networkName: 'mainnet'});
  expect(xpriv32B.privateKey.bn.toBuffer().length).toBe(32);
  const dpriv32Bd = xpriv32B.derive('m/44\'/280\'/0\'/0');
  const dpriv32B = xpriv32B.deriveNonCompliantChild('m/44\'/280\'/0\'/0');
  for (let i = 0; i < 10; i++) {
    const addrd = dpriv32Bd.derive(i).publicKey.toAddress(mainnet.bitcoreNetwork).toString();
    const addr = dpriv32B.deriveNonCompliantChild(i).publicKey.toAddress(mainnet.bitcoreNetwork).toString();
    expect(addr).toStrictEqual(addrd);
    expect(addr).toStrictEqual(Addr32B[i]);
  }

  // test our address generation
  // XXX: the accountDerivationIndex being 0'/0 is a temporary fix
  // getXPubKeyFromSeed does not derive for 'change' (https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#change)
  const xpub31B = wallet.getXPubKeyFromSeed(Words31B, {networkName: 'mainnet', accountDerivationIndex: '0\'/0'});
  const addressObj31B = wallet.getAddresses(xpub31B, 0, 10, 'mainnet');
  const address31B = Object.keys(addressObj31B);
  for (let i = 0; i < 10; i++) {
    expect(address31B[i]).toStrictEqual(Addr31B[i]);
  }

  const xpub32B = wallet.getXPubKeyFromSeed(Words32B, {networkName: 'mainnet', accountDerivationIndex: '0\'/0'});
  const addressObj32B = wallet.getAddresses(xpub32B, 0, 10, 'mainnet');
  const address32B = Object.keys(addressObj32B);
  for (let i = 0; i < 10; i++) {
    expect(address32B[i]).toStrictEqual(Addr32B[i]);
  }
});

test('mainnet: hd derivation with passphrase', () => {
  const mainnet = new Network('mainnet');
  // simple passphrase
  const passw = 'Hathor@Network';

  const Words = 'employ name misery bring pepper drive deal journey young prefer pluck rough entire tag mouse rough belt history arm shove crouch crater lobster remember';

  const Addr = [
    'HMMePc5mruv97oBo7FZEwPQXdxkP7CkyrV',
    'H6p4e7pnLwVfNbczZVMEJLStwxm6uEKXm8',
    'HHmzpxV2Zvwqfv3v9apB8hCryrydsk6Xmz',
    'HFVbDLHJbuVNr4RpfmJfZ1Aj4AHcQd3Zrh',
    'H9SmnwVnjepuLseofECqRaFjPg188ykCHY',
    'H6jXzjh2EJ95arKmFVcKwH64kVsAERFFWd',
    'HUUKKe9VR5h1mgD9RrH8eBvEQKuaghP11Q',
    'HRmuPpaKZpDfRavj3YxDnoktvGMP2FmJGh',
    'HPnUojm5ZUNSEYmonbg8Lwzdt8udu1Y2eK',
    'HJbxaf7kFvT4xq5ixabymZaxCgx3E758ZJ'
  ]

  // For 32 bytes private keys
  const xpriv = wallet.getXPrivKeyFromSeed(
      Words,
      {
        passphrase: passw,
        networkName: 'mainnet',
      }
  );
  const dprivd = xpriv.derive('m/44\'/280\'/0\'/0');
  const dpriv = xpriv.deriveNonCompliantChild('m/44\'/280\'/0\'/0');
  for (let i = 0; i < 10; i++) {
    const addrd = dprivd.derive(i).publicKey.toAddress(mainnet.bitcoreNetwork).toString();
    const addr = dpriv.deriveNonCompliantChild(i).publicKey.toAddress(mainnet.bitcoreNetwork).toString();

    expect(addr).toStrictEqual(addrd);
    expect(addr).toStrictEqual(Addr[i]);
  }

  const xpub = wallet.getXPubKeyFromSeed(
      Words,
      {
        passphrase: passw,
        networkName: 'mainnet',
        accountDerivationIndex: '0\'/0',
      },
  );
  const addressObj = wallet.getAddresses(xpub, 0, 10, 'mainnet');
  const address = Object.keys(addressObj);
  for (let i = 0; i < 10; i++) {
    expect(address[i]).toStrictEqual(Addr[i]);
  }
});

test('createP2SHRedeemScript', () => {
  const xpubs = [
    'xpub6BnoFhDySfUAaJQveYx1YvB8YcLdnnGdz19twSXRh6byEfZSWS4ewinKVDVJcvp6m17mAkQiBuhUgytwS561AkyCFXTvSjRXatueS2E4s3K',
    'xpub6ChkMiCikMrqKCQtZqzuVJCnfsaBKMsnTerc1o6XFU6GrZqbG1HqyWsHapksyp8iq68LkzU94fqk6rjzF1NPbKzTL6okbTvFp9GJVhxsZD2',
    'xpub6BvZyQQRCQ37AKuxfTMUWSU929fkqQPwmTbTBSvgq2FSUgbc5FPGYYuv2FzcpBNtE8qyjU7kRktibZrwZ7VgiBTCvJ7B6gE9FKuZr869Rzd',
  ];
  const minSignatures = 2;

  const redeemScript0 = '5221027105a304d7f3935b64824303687cf96a2400a29a9a69fcfc286a090e71f5acf92102374bba4d4a3d19222db84b5334527fe49e746e3aeac7d18ae14c9ac5a1c1bd0721027892436f6b36eb31edaee157cfa029b1735525626cf7247eb17de5a3db2427ad53ae';
  expect(wallet.createP2SHRedeemScript(xpubs, minSignatures, 0).toString('hex')).toBe(redeemScript0);

  const redeemScript1 = '522103483dd29818452ddcc11eaa04e00a84f0d733102caa1b124b349c7d4e8f6226972103262d9d3d2339298a0fdee45553ca60765a3486c872271dd1b56e6224ee7ec0d621027af464c0c85f656544bb0b34b3e3e525b7b76a9ab9faa3bbec8d0ceeed62647b53ae';
  expect(wallet.createP2SHRedeemScript(xpubs, minSignatures, 1).toString('hex')).toBe(redeemScript1);
});

test('getP2SHInputData', () => {
  let signature = Buffer.alloc(20);

  // Multisig 2/3
  const redeemScript0 = '5221027105a304d7f3935b64824303687cf96a2400a29a9a69fcfc286a090e71f5acf92102374bba4d4a3d19222db84b5334527fe49e746e3aeac7d18ae14c9ac5a1c1bd0721027892436f6b36eb31edaee157cfa029b1735525626cf7247eb17de5a3db2427ad53ae';
  const sig0 = '1400000000000000000000000000000000000000001400000000000000000000000000000000000000004c695221027105a304d7f3935b64824303687cf96a2400a29a9a69fcfc286a090e71f5acf92102374bba4d4a3d19222db84b5334527fe49e746e3aeac7d18ae14c9ac5a1c1bd0721027892436f6b36eb31edaee157cfa029b1735525626cf7247eb17de5a3db2427ad53ae';

  // Create a valid input data
  expect(wallet.getP2SHInputData([signature, signature], Buffer.from(redeemScript0, 'hex')).toString('hex')).toBe(sig0);

  // Create a valid input data with another script
  const redeemScript1 = '522103483dd29818452ddcc11eaa04e00a84f0d733102caa1b124b349c7d4e8f6226972103262d9d3d2339298a0fdee45553ca60765a3486c872271dd1b56e6224ee7ec0d621027af464c0c85f656544bb0b34b3e3e525b7b76a9ab9faa3bbec8d0ceeed62647b53ae';
  const sig1 = '1400000000000000000000000000000000000000001400000000000000000000000000000000000000004c69522103483dd29818452ddcc11eaa04e00a84f0d733102caa1b124b349c7d4e8f6226972103262d9d3d2339298a0fdee45553ca60765a3486c872271dd1b56e6224ee7ec0d621027af464c0c85f656544bb0b34b3e3e525b7b76a9ab9faa3bbec8d0ceeed62647b53ae';
  expect(wallet.getP2SHInputData([signature, signature], Buffer.from(redeemScript1, 'hex')).toString('hex')).toBe(sig1);

  // The script is a Multisig 2/3
  // Test passing less than minSignatures
  expect(() => wallet.getP2SHInputData([signature], Buffer.from(redeemScript0, 'hex'))).toThrow();
  // Test passing more than maxSignatures
  expect(() => wallet.getP2SHInputData([signature, signature, signature, signature], Buffer.from(redeemScript0, 'hex'))).toThrow();
});

test('get multisig xpub', () => {
  const seed = 'mutual property noodle reason reform leisure roof foil siren basket decide above offer rate outdoor board input depend sort twenty little veteran code plunge';
  const xpriv = 'htpr4yPomy8kcy5uFnvKpExM7fUHTVZbS3aBbUmeKQAKSAX1SnYzTCvzzoJtVavt9HU5USsCUXubKZYPwskPLdXaTwStUuMu8q3G8Mpwnbd3uFf';
  const xpub = 'xpub6BnoFhDySfUAaJQveYx1YvB8YcLdnnGdz19twSXRh6byEfZSWS4ewinKVDVJcvp6m17mAkQiBuhUgytwS561AkyCFXTvSjRXatueS2E4s3K';

  // From xpriv
  expect(wallet.getMultiSigXPubFromXPriv(HDPrivateKey(xpriv))).toBe(xpub);

  // From words
  expect(wallet.getMultiSigXPubFromWords(seed)).toBe(xpub);
});
