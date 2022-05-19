import wallet from "../../src/wallet";
import Mnemonic from "bitcore-mnemonic";
import network from "../../src/network";
import {
  HASH_ITERATIONS,
  HATHOR_BIP44_CODE,
  P2PKH_ACCT_PATH,
  WALLET_SERVICE_AUTH_DERIVATION_PATH
} from "../../src/constants";
import storage from "../../src/storage";

describe('start wallet', () => {
  it('should start a wallet successfully', async () => {
    const words = wallet.generateWalletWords(256);
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

    // Setting the storage
    wallet.setWalletAccessData({
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
    });
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
