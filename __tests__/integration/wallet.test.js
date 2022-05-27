import wallet from "../../src/wallet";
import HathorWallet from "../../src/new/wallet";
import Mnemonic from "bitcore-mnemonic";
import network from "../../src/network";
import {
  HASH_ITERATIONS,
  HATHOR_BIP44_CODE,
  P2PKH_ACCT_PATH,
  WALLET_SERVICE_AUTH_DERIVATION_PATH
} from "../../src/constants";
import storage from "../../src/storage";

import WebSocketHandler from '../../src/WebSocketHandler';
import Connection from "../../src/new/connection";
import { WALLET_CONSTANTS } from "./configuration/test-constants";
wallet.setConnection(WebSocketHandler);
WebSocketHandler.setup();

const sampleWords = 'issue middle acid visual long universe robust renew room illness voice wreck security section trip swim lock notable erosion where island nephew identify dilemma';

let genericWalletAccessData = {};
function getGenericWalletAccessData(wordsSeed) {
  if (genericWalletAccessData[wordsSeed]) return genericWalletAccessData[wordsSeed];

  const words = wordsSeed || wallet.generateWalletWords(256);
  const pin = '123456';

  // Generating wallet data manually, to skip other undesired steps of `executeGenerateWallet`
  const code = new Mnemonic(words);
  const xpriv = code.toHDPrivateKey('', network.getNetwork());
  const authXpriv = xpriv.deriveNonCompliantChild(WALLET_SERVICE_AUTH_DERIVATION_PATH);
  const accPrivKey = xpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
  const privkey = xpriv.deriveNonCompliantChild(`m/44'/${HATHOR_BIP44_CODE}'/0'/0`);
  const encryptedData = wallet.encryptData(privkey.xprivkey, pin);
  const encryptedAccountPathXpriv = wallet.encryptData(accPrivKey.xprivkey, pin);
  const encryptedAuthXpriv = wallet.encryptData(authXpriv.xprivkey, pin);
  const encryptedDataWords = wallet.encryptData(words, 'password');

  const walletAccessData = {
    mainKey: encryptedData.encrypted.toString(),
    acctPathMainKey: encryptedAccountPathXpriv.encrypted.toString(),
    hash: encryptedData.hash.key.toString(),
    salt: encryptedData.hash.salt,
    words: encryptedDataWords.encrypted.toString(),
    authKey: encryptedAuthXpriv.encrypted.toString(),
    hashPasswd: encryptedDataWords.hash.key.toString(),
    saltPasswd: encryptedDataWords.hash.salt,
    hashIterations: HASH_ITERATIONS,
    pbkdf2Hasher: 'sha1',
    xpubkey: privkey.xpubkey,
  };

  if (wordsSeed) genericWalletAccessData[wordsSeed] = walletAccessData;
  return walletAccessData;

}

describe('src/wallet.js', () => {
  /*
   * Methods to test:
   * subscribeAddress
   * saveNewHistoryOnStorage
   * updateHistoryData
   */

  describe.skip('start wallet', () => {
    it('should start a wallet successfully', async () => {

      // Setting the storage
      wallet.setWalletAccessData(getGenericWalletAccessData());
      wallet.setWalletData({
        keys: {},
        historyTransactions: {},
      });

      // Executing test
      const addr1hash = 'WY1URKUnqCTyiixW1Dw29vmeG99hNN4EW6';
      const addr2hash = 'WTjhJXzQJETVx7BVXdyZmvk396DRRsubdw';
      const amountOfAddresses = 2;
      const preCalculatedAddresses = await wallet.loadAddressHistory(
        0,
        amountOfAddresses,
        null,
        null,
        [addr1hash, addr2hash]
      ).catch(err => err);

      // Validating results on storage
      const walletData = storage.getItem('wallet:data');
      expect(walletData.keys).toHaveProperty(addr1hash);
      expect(walletData.keys[addr1hash]).toEqual({privkey: null, index: 0});
      expect(walletData.keys).toHaveProperty(addr2hash);
      expect(walletData.keys[addr2hash]).toEqual({privkey: null, index: 1});
    });
  });

  describe.skip('getTxHistory', () => {
    it('should get the transaction history for an address', async (done) => {
      const addresses = [
        'WT4RayTkdz1k2RKG9HM9PYmfXiqzNL5cAj'
      ];
      const words = sampleWords;
      wallet.setWalletAccessData(getGenericWalletAccessData(words));
      wallet.setWalletData({
        keys: {},
        historyTransactions: {},
      });

      const resolve = (results) => {
        console.log('Resolved.');
        expect(results).toBeTruthy();
        done();
      };
      const reject = (e) => {
        console.warn(`Rejected: ${e.stack}`);
        expect(false).toBe(true);
        done();
      };

      const connection = null;
      const store = null;
      try {
        wallet.getTxHistory(addresses, resolve, reject, connection, store)
          .catch((e) => {
            reject(e);
          });
      }
      catch (e) {
        console.error(e.stack);
        done(e);
      }
    })
  })
});

describe('new/wallet.ts', () => {
  describe('send tokens', () => {
    it('should send HTR token', async (done) => {
      const words = WALLET_CONSTANTS.genesis.words;
      let pin = '123456';
      const connection = new Connection({
        network: 'privatenet',
        servers: ['http://localhost:8083/v1a/'],
        connectionTimeout: 30000,
      })
      const walletConfig = {
        seed: words,
        connection,
        password: 'password',
        pinCode: pin,
        multisig: false,
      }
      try {
        const hWallet = new HathorWallet(walletConfig);
        await hWallet.start();

        await new Promise((resolve, reject) => {
          hWallet.on('state', newState => {
            // Only continue the tests on wallet ready
            if (newState === HathorWallet.READY) {
              return resolve();
            } else if (newState === HathorWallet.ERROR) {
              reject(new Error('HathorWallet failed to start.'))
            }

            // TODO: Add a timeout here.
          })
        })

        const result = await hWallet.sendTransaction(
          'WT4RayTkdz1k2RKG9HM9PYmfXiqzNL5cAj',
          100,
          {
            changeAddress: 'WPhehTyNHTPz954CskfuSgLEfuKXbXeK3f'
          });
        console.log(result);
        done();
      }
      catch (e) {
        console.error(e.stack);
        done(e);
      }

    })
  })
});
