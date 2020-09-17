/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import helpers from '../src/helpers';
import tokens from '../src/tokens';
import { createRequestInstance } from '../src/api/axiosInstance';
import { XPubError } from '../src/errors';


test('Update list', () => {
  const list = [];

  helpers.updateListWs(list, 1, 3);
  expect(list).toMatchObject([1]);

  helpers.updateListWs(list, 2, 3);
  expect(list).toMatchObject([2, 1]);

  helpers.updateListWs(list, 3, 3);
  expect(list).toMatchObject([3, 2, 1]);

  helpers.updateListWs(list, 4, 3);
  expect(list).toMatchObject([4, 3, 2]);
})

test('Transaction type', () => {
  const transaction1 = {
    'version': 1,
    'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e',
    'inputs': [],
    'outputs': [
      {
        'decoded': {
          'address': '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q',
          'timelock': null
        },
        'value': 100,
        'spent_by': null,
        'token': '00',
      },
      {
        'decoded': {
          'address': '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q',
          'timelock': null
        },
        'value': 300,
        'spent_by': null,
        'token': '01',
      }
    ]
  };

  const transaction2 = {
    'version': 1,
    'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d',
    'inputs': [
      {
        'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e',
        'index': 0,
      }
    ],
    'outputs': [
      {
        'decoded': {
          'address': '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q',
          'timelock': null
        },
        'value': 100,
        'spent_by': null,
        'token': '00',
      },
      {
        'decoded': {
          'address': '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q',
          'timelock': null
        },
        'value': 300,
        'spent_by': null,
        'token': '01',
      }
    ]
  };

  const genesisBlock = {
    'version': 0,
    'tx_id': '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b',
    'inputs': [],
    'outputs': [
      {
        'decoded': {
          'address': '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q',
          'timelock': null
        },
        'value': 2000,
        'spent_by': null,
        'token': '00',
      },
    ]
  };

  expect(helpers.getTxType(transaction1).toLowerCase()).toBe('transaction');
  expect(helpers.getTxType(transaction2).toLowerCase()).toBe('transaction');
  expect(helpers.getTxType(genesisBlock).toLowerCase()).toBe('block');
});

test('Round float', () => {
  expect(helpers.roundFloat(1.23)).toBe(1.23);
  expect(helpers.roundFloat(1.2345)).toBe(1.23);
  expect(helpers.roundFloat(1.2355)).toBe(1.24);
});

test('Plural', () => {
  expect(helpers.plural(0, 'word', 'words')).toBe('words');
  expect(helpers.plural(1, 'word', 'words')).toBe('word');
  expect(helpers.plural(2, 'word', 'words')).toBe('words');
  expect(helpers.plural(1232, 'word', 'words')).toBe('words');
});

test('Element count', () => {
  expect(helpers.elementCount([1,2,3,4], 0)).toBe(0);
  expect(helpers.elementCount([1,2,3,4], 1)).toBe(1);
  expect(helpers.elementCount([1,2,3,4,1], 1)).toBe(2);
});

test('Minimum amount', () => {
  expect(helpers.minimumAmount()).toBe(0.01);
});

test('Short hash', () => {
  expect(helpers.getShortHash('000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b')).toBe('000164e1e7ec...e181e58eb01b');
});

test('Version check', () => {
  expect(helpers.isVersionAllowed('2.0.1-beta', '0.1.1')).toBe(false);
  expect(helpers.isVersionAllowed('2.0.1-beta', '0.1.1-beta')).toBe(true);

  expect(helpers.isVersionAllowed('2.0.1', '3.1.1')).toBe(false);
  expect(helpers.isVersionAllowed('2.1.1', '2.1.1')).toBe(true);
  expect(helpers.isVersionAllowed('3.1.1', '2.1.1')).toBe(true);
  expect(helpers.isVersionAllowed('0.1.1', '0.2.1')).toBe(false);
  expect(helpers.isVersionAllowed('0.3.1', '0.2.1')).toBe(true);
  expect(helpers.isVersionAllowed('0.3.1', '0.3.0')).toBe(true);
  expect(helpers.isVersionAllowed('0.3.1', '0.3.2')).toBe(false);
});

test('Axios config', () => {
  const axios = createRequestInstance();
  axios.defaults.agent = 'a';
  const config = {agent: 'a'};

  expect(config.agent).toBe('a');
  helpers.fixAxiosConfig(axios, config);
  expect(config.agent).toBe(undefined);
});

test('isXpubKeyValid', () => {
  const XPUBKEY = 'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res';
  expect(helpers.isXpubKeyValid(XPUBKEY)).toBe(true);
  expect(helpers.isXpubKeyValid(`${XPUBKEY}aa`)).toBe(false);
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
  let calculatedAddresses = helpers.getAddresses(XPUBKEY, 0, ADDRESSES.length, 'mainnet');
  let addrList = Object.keys(calculatedAddresses);
  expect(addrList).toHaveLength(ADDRESSES.length);
  expect(addrList).toStrictEqual(ADDRESSES);

  // start not from 0
  calculatedAddresses = helpers.getAddresses(XPUBKEY, 5, ADDRESSES.length - 5, 'mainnet');
  addrList = Object.keys(calculatedAddresses);
  expect(addrList).toHaveLength(ADDRESSES.length - 5);
  expect(addrList).toStrictEqual(ADDRESSES.slice(5));

  expect(() => helpers.getAddresses(`${XPUBKEY}aa`, 5, ADDRESSES.length - 5, 'mainnet')).toThrowError(XPubError);
});
