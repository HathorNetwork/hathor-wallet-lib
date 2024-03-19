/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { HDPublicKey } from 'bitcore-lib';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src/storage';
import { WalletType } from '../../src/types';
import {
  getAddressType,
  deriveAddressFromDataP2SH,
  deriveAddressFromXPubP2PKH,
  deriveAddressP2PKH,
  deriveAddressP2SH,
  getAddressFromPubkey,
} from '../../src/utils/address';

const seed = 'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind';
const xprivkey = 'htpr58K5ktSehjML89C3uRicPQ9TrrJ7LAbD7Xp1C7AZULDaY75joGmSu7TWGWqb31noixGt9ehSyspRVdFBhCZiJpB1RiuSosUkFw7QezVbECo';
const xpubkey = 'xpub6EvdxHF4vBs38uFrs6UuN8Zu78LDoqLrskMffXk531wy7xMFb7X9Ntxb9dGL2kbYdKJ1d83dqAifQS2Wzcq2DxJf7HPDPvMZMtNQxyBzAWn';
const MULTISIG_XPUB = 'xpub6CvvCBtHqFfErbcW2Rv28TmZ3MqcFuWQVKGg8xDzLeAwEAHRz9LBTgSFSj7B99scSvZGbq6TxAyyATA9b6cnwsgduNs9NGKQJnEQr3PYtwK';
const WALLET_DATA = {
  multisig: {
    seed,
    data: {
      numSignatures: 3,
      total: 5,
      pubkeys: [
        MULTISIG_XPUB,
        'xpub6CA16g2qPwukWAWBMdJKU3p2fQEEi831W3WAs2nesuCzPhbrG29aJsoRDSEDT4Ac3smqSk51uuv6oujU3MAAL3d1Nm87q9GDwE3HRGQLjdP',
        'xpub6BwNT613Vzy7ARVHDEpoX23SMBEZQMJXdqTWYjQKvJZJVDBjEemU38exJEhc6qbFVc4MmarN68gUKHkyZ3NEgXXCbWtoXXGouHpwMEcXJLf',
        'xpub6DCyPHg4AwXsdiMh7QSTHR7afmNVwZKHBBMFUiy5aCYQNaWp68ceQXYXCGQr5fZyLAe5hiJDdXrq6w3AXzvVmjFX9F7EdM87repxJEhsmjL',
        'xpub6CgPUcCCJ9pAK7Rj52hwkxTutSRv91Fq74Hx1SjN62eg6Mp3S3YCJFPChPaDjpp9jCbCZHibBgdKnfNdq6hE9umyjyZKUCySBNF7wkoG4uK',
      ],
    },
    addresses: [
      'wgyUgNjqZ18uYr4YfE2ALW6tP5hd8MumH5',
      'wbe2eJdyZVimA7nJjmBQnKYJSXmpnpMKgG',
      'wQQWdSZwp2CEGKsTvvbJ7i8HfHuV2i5QVQ',
      'wfrtq9cMe1YfixVgSKXQNQ5hjsmR4hpjP6',
      'wQG7itjdtZBsNTk9TG4f1HrehyQiAEMN18',
      'wfgSqHUHPtmj2GDy8YfasbPPcFh8L1GPMA',
      'wgZbCEMHHnhftCAwj7CRBmfi5TgBhfMZbk',
      'wdz9NeMac7jyVeP2WK4BJWsM1zpd9tgsBb',
      'wPs7WaRCqwC89uHycLbctDGmWPgH9oZvjp',
      'wWJJxvr6oSk7WZdE9rpSRMoE6ZqJ3i8VDc',
      'wbuDJtmM7vg8at2h5o3pTCHE4SASEFYusr',
      'wPNkywbiw8UHbRQkD3nZ3EHMQsjyTamh9u',
      'wQBNidXXYpE943BgydUNtarAwNzk612Yip',
      'wh2eCGzUK9rLThr5D6tyCfckHpBjS97ERA',
      'wZvajxVp3LabcZiY3XPrivrXiSS6wphRu7',
      'wgPbL1WzbrEntepHRC92UX6mA2EmaqfDqt',
      'wbdx4g3rucX3WHmZRXjPEKtRfZ7XSnCGKf',
      'wiKTnqSN11ukuCWEXRVrRTTPo2mw4fGue3',
      'wQ4aQP4YqJqfwshLggR2w1Gg3UFhhKhVKs',
      'wca2xk9S2MVn2UrKh78UScdwXz3xrTp8Ky',
      'wcUZ6J7t2B1s8bqRYiyuZAftcdCGRSiiau',
    ],
  },
  p2pkh: {
    seed,
    addresses: [
      'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN',
      'WmtWgtk5GxdcDKwjNwmXXn74nQWTPWhKfx',
      'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
      'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
      'WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi',
      'Wc4dKp6hBgr5PU9gBmzJofc93XZGAEEUXD',
      'WUujvZnk3LMbFWUW7CnZbjn5JZzALaqLfm',
      'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
      'WXN7sf6WzhpESgUuRCBrjzjzHtWTCfV8Cq',
      'WYaMN32qQ9CAUNsDnbtwi1U41JY9prYhvR',
      'WWbt2ww4W45YLUAumnumZiyWrABYDzCTdN',
      'WgpRs9NxhkBPxe7ptm9RcuLdABb7DdVUA5',
      'WPzpVP34vx6X5Krj4jeiQz9VW87F4LEZnV',
      'WSn9Bn6EDPSWZqNQdpV3FxGjpTEMsqQHYQ',
      'WmYnieT3vzzY83eHphQHs6HJ5mYyPwcKSE',
      'WZfcHjgkfK9UroTzpiricB6gtg99QKraG1',
      'WiHovoQ5ZLKPpQjZYkLVeoVgP7LoVLK518',
      'Wi5AvNTnh4mZft65kzsRbDYEPGbTRhd5q3',
      'Weg6WEncAEJs5qDbGUxcLTR3iycM3hrt4C',
      'WSVarF73e6UVccGwb44FvTtqFWsHQmjKCt',
    ],
  }
};

test('Get address type', () => {
  const testnet = new Network('testnet');
  expect(getAddressType(WALLET_DATA.p2pkh.addresses[0], testnet)).toEqual('p2pkh');
  expect(getAddressType(WALLET_DATA.multisig.addresses[3], testnet)).toEqual('p2sh');
});

test('Derive p2pkh address from xpub', () => {
  const xpub = new HDPublicKey(xpubkey);
  for (let i = 0; i < 5; i++) {
    expect(deriveAddressFromXPubP2PKH(xpubkey, i, 'testnet')).toMatchObject({
      base58: WALLET_DATA.p2pkh.addresses[i],
      bip32AddressIndex: i,
      publicKey: xpub.deriveChild(i, false).publicKey.toString('hex'),
    });
  }
});

test('Derive p2sh address from data', () => {
  for (let i = 0; i < 5; i++) {
    expect(deriveAddressFromDataP2SH(WALLET_DATA.multisig.data, i, 'testnet')).toMatchObject({
      base58: WALLET_DATA.multisig.addresses[i],
      bip32AddressIndex: i,
    });
  }
});

test('Derive address p2pkh', async () => {
  const xpub = new HDPublicKey(xpubkey);
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');
  const spy = jest.spyOn(storage, 'getAccessData').mockImplementation(async () => {
    return {
      xpubkey,
      walletType: WalletType.P2PKH,
      walletFlags: 0,
    };
  });
  for (let i = 0; i < 5; i++) {
    expect(await deriveAddressP2PKH(i, storage)).toMatchObject({
      base58: WALLET_DATA.p2pkh.addresses[i],
      bip32AddressIndex: i,
      publicKey: xpub.deriveChild(i, false).publicKey.toString('hex'),
    });
  }

  spy.mockReturnValue(Promise.resolve(null));
  await expect(deriveAddressP2PKH(0, storage)).rejects.toThrow('No access data');
});

test('Derive address p2sh', async () => {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork('testnet');
  const spy = jest.spyOn(storage, 'getAccessData').mockImplementation(async () => {
    return {
      xpubkey,
      multisigData: WALLET_DATA.multisig.data,
      walletType: WalletType.MULTISIG,
      walletFlags: 0,
    };
  });
  for (let i = 0; i < 5; i++) {
    expect(await deriveAddressP2SH(i, storage)).toMatchObject({
      base58: WALLET_DATA.multisig.addresses[i],
      bip32AddressIndex: i,
    });
  }

  spy.mockReturnValue(Promise.resolve(null));
  await expect(deriveAddressP2SH(0, storage)).rejects.toThrow('No access data');
});

test('Get address from pubkey', async () => {
  const base58 = WALLET_DATA.p2pkh.addresses[0];
  const { publicKey } = deriveAddressFromXPubP2PKH(xpubkey, 0, 'testnet');
  const address = getAddressFromPubkey(publicKey!, new Network('testnet'));

  expect(address.getType()).toBe(WalletType.P2PKH);
  expect(address.base58).toBe(base58);
  expect(address.validateAddress()).toBeTruthy();
});
