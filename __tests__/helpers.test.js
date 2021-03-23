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
  let calculatedAddresses = helpers.getAddresses(XPUBKEY, 0, 0, ADDRESSES_0.length, 'mainnet');
  let addrList = Object.keys(calculatedAddresses);
  expect(addrList).toHaveLength(ADDRESSES_0.length);
  expect(addrList).toStrictEqual(ADDRESSES_0);

  // start not from 0
  calculatedAddresses = helpers.getAddresses(XPUBKEY, 0, 5, ADDRESSES_0.length - 5, 'mainnet');
  addrList = Object.keys(calculatedAddresses);
  expect(addrList).toHaveLength(ADDRESSES_0.length - 5);
  expect(addrList).toStrictEqual(ADDRESSES_0.slice(5));

  expect(() => helpers.getAddresses(`${XPUBKEY}aa`, 5, ADDRESSES_0.length - 5, 'mainnet')).toThrowError(XPubError);

  // With change derivation as 1, the addresses are different
  const calculatedAddresses1 = helpers.getAddresses(XPUBKEY, 1, 0, ADDRESSES_1.length, 'mainnet');
  const addrList1 = Object.keys(calculatedAddresses1);
  expect(addrList1).toHaveLength(ADDRESSES_1.length);
  expect(addrList1).toStrictEqual(ADDRESSES_1);
});
