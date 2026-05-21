import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { MemoryStore, Storage, Network } from '../../src';
import { WALLET_CONSTANTS } from './configuration/test-constants';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import {
  buildWalletInstance,
  emptyWallet,
  initializeServiceGlobalConfigs,
  pollForTx,
} from './helpers/service-facade.helper';
import { UtxoError, WalletRequestError } from '../../src/errors';
import { GetAddressesObject } from '../../src/wallet/types';
import { WalletAddressMode } from '../../src/types';
import { GenesisWalletServiceHelper } from './helpers/genesis-wallet.helper';

// Set base URL for the wallet service API inside the privatenet test container
initializeServiceGlobalConfigs();

/** Wallet instance used in tests */
let wallet: HathorWalletServiceWallet;
const addressesWallet = {
  words:
    'pumpkin tank father organ can doll romance damage because barely vault pride will man rack horn lamp remove enemy brain desert exchange boil salon',
  addresses: [
    'WRsDG9VhM4N9DPSpbnpFKnngLEXonaBsuH',
    'WSTMdCz4BuzGv5q6g8woaCHeyppTZdjXWx',
    'WPbCV3Lrh28ntoQY2hvC2ppU5TimCZdRaw',
    'WaAgCebJjWfQCKcDwtpffQ4kt2im7fbsUr',
    'WXN2wRybweJY4xunPkz6pwfGUmoumCCcUP',
    'WbEA4E7Rnx98TtRox3UazMQRm1yNoAJcfm',
    'WZs2Ci9ZxyMzmfdbGfR2nTp9xsxS7rSsDN',
    'Wf1waSNgXmMoitFjx7TADMemKyCWjhvLUb',
    'WVTMecGGC9kGzUbQqjB4J7i4KVhLVyMagy',
    'WjHom47afCW8qEFtBqMq3MT22zxLkuvQag',
  ],
};
const utxosWallet = {
  words:
    'provide bunker age agree renew size popular license best kidney range flag they bulk survey letter concert mobile february clean nuclear inherit voyage capable',
  addresses: [
    'WQvAdYAqZf69nsgzVwSMwfRWcBRHJJU1qH',
    'We4fZtzxod2M3w1u8h4TNpaMYrYWqXxNqd',
    'WioaJZPzytLVniJ9MTinLiWih1VaoRfaUV',
    'WmRLJj5P1rj1bErNADJnweq8mXBNLmNiAL',
    'WXpXoREmV2hFuMX83dup7YMqJqRW5Y94Av',
    'WirQUza1XdqnN7DcAMdXvysTntq9DB3xz6',
    'Wb26hUGD6du7nkecrAeaRbBoZS4Z3dynby',
    'WXgFTQm7uNYTj8gsz3GWNg58jCvaPn96hD',
    'WdcFv1fKjbPPqSXHkdo22QE2bbZnbXADHK',
    'WTm47mTSd7ompdinkZM3LiF4VE7AeQttzo',
  ],
};
const singleAddressWallet1 = {
  words:
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind',
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
};
const singleAddressWallet2 = {
  words:
    'glad drop admit april disagree picnic claim soon permit ethics cross soul pulp desert weather capital praise nose wise color else flock royal merit',
  addresses: [
    'WjE2yiEeBYSoHLnTXkGgJvB1Afn3vG3LX6',
    'WaGshSrBBCrWAjAgNHZSU3DJXTysAso5q3',
    'WS3LUTDKSgejR28v6Gi2ejT3RH2diDAS3g',
    'WR6188ey4v6BUfY29UyHgMaVLmqQ7PGxFa',
    'WTPeL8fApUQgz7UhaL694Xqt4YcDTPMGu1',
    'WdqpeFjGoUhT8Kyfbc2qjFyRsy6agwe3VU',
    'WZMjeMMnx3BPNagTqbHW2XkP1nrzxPVGCw',
    'WPgxrd5BcfDpMynrsWXAySbLhS6DCmTeKL',
    'WY7NCX2j98VfStbTyyxgai9y3xma63W1Bk',
    'WYYsfkTSRQ6fzQtdeSVMYLsPkBA6MemPhv',
    'Wjzb9KiBVL4xNArQd8ckR3UtvBmYo8NxYG',
    'WdCyoh1JzvxJhgQcrCVkZ3SpAoUwqVSEfS',
    'WfFpwweGNQ1QurAwqYLwSuccHcUz12q3Zi',
    'Wddb5Maxq6B7rFYH1JZJvZY7kTQezwrafL',
    'Wfw58Z5GrYfp4Ecmg1hDLBCQspPQC2gpqH',
    'WU931UJrREpFn8dhi3HNn4nLNkVjx9hdj5',
    'WakAnQEvsUgxUd8kGkmeeaUPC2XNPDXxFu',
    'WZUBn2K9evu3U9jPe8Y92LvYFWgctVov9L',
    'Whwv9XaKtDUpyXpEJPhvT9WdQEpfeeadr1',
    'WUL7Bc2o7ekAZHo19YVZCjc5As1ZeM3XRv',
  ],
};

/** Default pin to simplify the tests */
const pinCode = '123456';
/** Default password to simplify the tests */
const password = 'testpass';

/**
 * Obsolete function, use GenesisWalletServiceHelper.injectFunds instead.
 * @deprecated
 */
const sendFundTx = GenesisWalletServiceHelper.injectFunds;

beforeAll(async () => {
  await GenesisWalletServiceHelper.start();
});

afterAll(async () => {
  await GenesisWalletServiceHelper.stop();
});

describe('empty wallet address methods', () => {
  const knownAddresses = emptyWallet.addresses;
  const unknownAddress = WALLET_CONSTANTS.miner.addresses[0];

  beforeEach(async () => {
    ({ wallet } = buildWalletInstance({ words: emptyWallet.words }));
    await wallet.start({ pinCode, password });
  });

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  it('getAddressIndex returns correct index for known address', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const index = await wallet.getAddressIndex(knownAddresses[i]);
      expect(index).toBe(i);
    }
  });

  it('getAddressIndex returns null for unknown address', async () => {
    const index = await wallet.getAddressIndex(unknownAddress);
    expect(index).toBeNull();
  });

  it('getAddressPathForIndex returns correct path for index', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const path = await wallet.getAddressPathForIndex(i);
      expect(path.endsWith(`/${i}`)).toBe(true);
      expect(path).toMatch(/m\/44'\/280'\/0'\/0\/[0-9]+/);
    }
  });

  it('getAddressAtIndex returns correct address for index', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const address = await wallet.getAddressAtIndex(i);
      expect(address).toBe(knownAddresses[i]);
    }
  });

  it('getAddressPrivKey returns HDPrivateKey for known index', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const privKey = await wallet.getAddressPrivKey(pinCode, i);
      expect(privKey.constructor.name).toBe('HDPrivateKey');
      // Should have a publicKey and privateKey
      expect(privKey.publicKey).toBeDefined();
      expect(privKey.privateKey).toBeDefined();
    }
  });

  it('isAddressMine returns true for known addresses', async () => {
    for (const address of knownAddresses) {
      const result = await wallet.isAddressMine(address);
      expect(result).toBe(true);
    }
  });

  it('isAddressMine returns false for unknown address', async () => {
    const result = await wallet.isAddressMine(unknownAddress);
    expect(result).toBe(false);
  });

  it('checkAddressesMine returns correct map for known and unknown addresses', async () => {
    const addresses = [...knownAddresses, unknownAddress];
    const result = await wallet.checkAddressesMine(addresses);
    for (let i = 0; i < knownAddresses.length; i++) {
      expect(result[knownAddresses[i]]).toBe(true);
    }
    expect(result[unknownAddress]).toBe(false);
  });

  it('getPrivateKeyFromAddress returns PrivateKey for known address', async () => {
    for (const address of knownAddresses) {
      const privKey = await wallet.getPrivateKeyFromAddress(address, { pinCode });
      expect(privKey.constructor.name).toBe('PrivateKey');
      expect(privKey.toString()).toMatch(/[A-Fa-f0-9]{64}/);
    }
  });

  it('getPrivateKeyFromAddress throws for unknown address', async () => {
    await expect(wallet.getPrivateKeyFromAddress(unknownAddress, { pinCode })).rejects.toThrow(
      /does not belong to this wallet/
    );
  });
});

describe.skip('websocket events', () => {});

// balances tests moved to shared/get-balance.test.ts and service-specific/get-balance.test.ts

describe('address management methods', () => {
  const knownAddresses = addressesWallet.addresses;

  beforeEach(async () => {
    ({ wallet } = buildWalletInstance({ words: addressesWallet.words }));
    await wallet.start({ pinCode, password });
  });

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  describe('getAllAddresses', () => {
    it('should return expected addresses on getAllAddresses', async () => {
      const allAddresses: GetAddressesObject[] = [];
      for await (const addr of wallet.getAllAddresses()) {
        allAddresses.push(addr);
      }

      // Should return an array of addresses
      expect(allAddresses.length).toBeGreaterThan(0);

      // Should include the known addresses from addressesWallet
      allAddresses.forEach(addrObj => {
        expect(knownAddresses).toContain(addrObj.address);
      });

      // Should be in order (index 0, 1, 2, etc.)
      for (let i = 0; i < knownAddresses.length; i++) {
        expect(allAddresses[i].address).toBe(knownAddresses[i]);
      }
    });

    it('should return consistent results on multiple calls', async () => {
      const allAddressesFirstCall: GetAddressesObject[] = [];
      for await (const addr of wallet.getAllAddresses()) {
        allAddressesFirstCall.push(addr);
      }
      const allAddressesSecondCall: GetAddressesObject[] = [];
      for await (const addr of wallet.getAllAddresses()) {
        allAddressesSecondCall.push(addr);
      }

      expect(allAddressesFirstCall.length).toBe(allAddressesSecondCall.length);
      expect(allAddressesFirstCall).toEqual(allAddressesSecondCall);
    });
  });

  describe('getCurrentAddress, getNextAddress', () => {
    it('should return current address with index and address string', () => {
      const currentAddress = wallet.getCurrentAddress();

      // Should return an object with index and address
      expect(currentAddress).toEqual(
        expect.objectContaining({
          index: expect.any(Number),
          address: expect.any(String),
        })
      );

      expect(currentAddress.index).toBeGreaterThanOrEqual(0);
      expect(knownAddresses).toContain(currentAddress.address);
      expect(currentAddress.addressPath).toMatch(/^m\/44'\/280'\/0'\/0\/\d+$/);
      expect(currentAddress.info).toBeFalsy();
    });

    it('should return consistent results when called multiple times without changes', () => {
      const first = wallet.getCurrentAddress();
      const second = wallet.getCurrentAddress();

      expect(first).toEqual(second);
    });

    it('should mark addresses as used and not return them anymore', async () => {
      const initialCurrent = wallet.getCurrentAddress();
      const secondCurrent = wallet.getCurrentAddress({ markAsUsed: true });
      const thirdCurrent = wallet.getCurrentAddress();

      expect(initialCurrent).toEqual(secondCurrent);
      expect(thirdCurrent.index).toBe(secondCurrent.index + 1);
      expect(thirdCurrent.address).not.toBe(secondCurrent.address);
    });

    it('should have the same mark as used behavior with getNextAddress', async () => {
      const currentBefore = wallet.getCurrentAddress();
      const nextAddress = wallet.getNextAddress();
      const currentAfter = wallet.getCurrentAddress();

      expect(nextAddress.index).toBe(currentBefore.index + 1);
      expect(nextAddress.address).not.toBe(currentBefore.address);
      expect(currentAfter).toEqual(nextAddress);
    });

    it('should inform when the limit for new addresses has been reached', async () => {
      // Advance to near the end of known addresses
      for (let i = 0; i < knownAddresses.length - 1; i++) {
        wallet.getNextAddress();
      }

      const current = wallet.getNextAddress();
      expect(current.index).toBe(knownAddresses.length - 1);
      expect(current.address).toBe(knownAddresses[knownAddresses.length - 1]);
      expect(current.info).toBe('GAP_LIMIT_REACHED');
    });
  });

  describe('getAddressDetails', () => {
    it('should return details for known addresses', async () => {
      // Test first known addresses to verify index mapping
      for (let i = 0; i < knownAddresses.length; i++) {
        const details = await wallet.getAddressDetails(knownAddresses[i]);
        expect(details).toEqual(
          expect.objectContaining({
            address: knownAddresses[i],
            index: i,
            transactions: 0,
            seqnum: 0,
          })
        );
      }
    });

    it('should throw error for unknown address', async () => {
      const unknownAddress = WALLET_CONSTANTS.miner.addresses[0];

      await expect(wallet.getAddressDetails(unknownAddress)).rejects.toThrow(WalletRequestError);
    });
  });
});

describe('getUtxos, getUtxosForAmount', () => {
  let utxosTestWallet: HathorWalletServiceWallet;
  let createdTokenUid: string;

  beforeAll(async () => {
    // Create and fund the utxos wallet for testing
    ({ wallet: utxosTestWallet } = buildWalletInstance({ words: utxosWallet.words }));
    await utxosTestWallet.start({ pinCode, password });

    // Fund the wallet with multiple transactions to create various UTXOs
    await sendFundTx(utxosWallet.addresses[0], 100n, utxosTestWallet);

    // Create additional UTXOs by sending to different addresses
    const fundTx2 = await utxosTestWallet.sendTransaction(utxosWallet.addresses[1], 20n, {
      pinCode,
      changeAddress: utxosWallet.addresses[0],
    });
    await pollForTx(utxosTestWallet, fundTx2.hash!);
    const fundTx3 = await utxosTestWallet.sendTransaction(utxosWallet.addresses[2], 30n, {
      pinCode,
      changeAddress: utxosWallet.addresses[0],
    });
    await pollForTx(utxosTestWallet, fundTx3.hash!);
    // Create a custom token to test authority UTXOs
    const createTokenTx = await utxosTestWallet.createNewToken('UtxoTestToken', 'UTT', 200n, {
      pinCode,
      address: utxosWallet.addresses[1],
      mintAuthorityAddress: utxosWallet.addresses[2],
      meltAuthorityAddress: utxosWallet.addresses[3],
      changeAddress: utxosWallet.addresses[1],
    });

    createdTokenUid = createTokenTx.hash!;

    await pollForTx(utxosTestWallet, createdTokenUid);
  });

  afterAll(async () => {
    if (utxosTestWallet) {
      await utxosTestWallet.stop({ cleanStorage: true });
    }
  });

  describe('getUtxos', () => {
    it('should return all available UTXOs without filters', async () => {
      const utxoData = await utxosTestWallet.getUtxos();

      // Validate the structure of the response
      expect(utxoData).toEqual(
        expect.objectContaining({
          total_amount_available: expect.any(BigInt),
          total_utxos_available: expect.any(BigInt),
          total_amount_locked: expect.any(BigInt),
          total_utxos_locked: expect.any(BigInt),
          utxos: expect.any(Array),
        })
      );

      // Should have at least some UTXOs from our funding transactions
      expect(utxoData.total_utxos_available).toBe(3n);
      expect(utxoData.total_amount_available).toBe(98n);
      expect(utxoData.utxos.length).toBe(3);

      // Validate UTXO structure
      utxoData.utxos.forEach(utxo => {
        expect(utxo).toEqual(
          expect.objectContaining({
            address: expect.any(String),
            amount: expect.any(BigInt),
            tx_id: expect.any(String),
            locked: expect.any(Boolean),
            index: expect.any(Number),
          })
        );
        expect(utxo.amount).toBeGreaterThan(0n);
        expect(utxosWallet.addresses).toContain(utxo.address);
      });
    });

    it('should filter UTXOs by specific token', async () => {
      const nativeTokenUtxos = await utxosTestWallet.getUtxos({ token: NATIVE_TOKEN_UID });
      const customTokenUtxos = await utxosTestWallet.getUtxos({ token: createdTokenUid });

      // Should have native token UTXOs
      expect(nativeTokenUtxos.total_utxos_available).toBe(3n);
      expect(nativeTokenUtxos.utxos).toHaveLength(3);
      expect(nativeTokenUtxos.total_amount_available).toBe(98n);

      // Should have custom token UTXOs
      expect(customTokenUtxos.total_utxos_available).toBe(1n);
      expect(customTokenUtxos.utxos).toHaveLength(1);
      expect(customTokenUtxos.total_amount_available).toBe(200n); // The amount we created
    });

    it('should filter UTXOs by specific address', async () => {
      let currentFilterAddress = utxosWallet.addresses[1];

      // Should have UTXOs for the specific address, native token
      let addressUtxos = await utxosTestWallet.getUtxos({
        filter_address: currentFilterAddress,
      });
      expect(addressUtxos.utxos).toHaveLength(1);
      expect(addressUtxos.utxos[0].address).toBe(currentFilterAddress);
      expect(addressUtxos.utxos[0].amount).toBe(18n);

      // Should have UTXOs for the specific address, custom token
      addressUtxos = await utxosTestWallet.getUtxos({
        filter_address: currentFilterAddress,
        token: createdTokenUid,
      });
      expect(addressUtxos.utxos).toHaveLength(1);
      expect(addressUtxos.utxos[0].address).toBe(currentFilterAddress);
      expect(addressUtxos.utxos[0].amount).toBe(200n);

      // Should not return authority UTXOs: this is a dedicated feature of getAuthorityUtxo
      currentFilterAddress = await utxosWallet.addresses[2];
      addressUtxos = await utxosTestWallet.getUtxos({
        filter_address: currentFilterAddress,
        token: createdTokenUid,
      });
      expect(addressUtxos.utxos.length).toBe(0);
    });

    it('should limit the number of UTXOs returned', async () => {
      const limitedUtxos = await utxosTestWallet.getUtxos({ max_utxos: 2 });

      expect(limitedUtxos.utxos).toHaveLength(2);
    });

    it('should filter UTXOs by amount range', async () => {
      const smallUtxos = await utxosTestWallet.getUtxos({
        amount_smaller_than: 25,
      });
      expect(smallUtxos.total_utxos_available).toBe(1n);
      expect(smallUtxos.utxos[0].amount).toBe(18n);

      const bigUtxos = await utxosTestWallet.getUtxos({
        amount_bigger_than: 40,
      });
      expect(bigUtxos.total_utxos_available).toBe(1n);
      expect(bigUtxos.utxos[0].amount).toBe(50n);
    });
  });

  // getAuthorityUtxo tests moved to shared/authority-utxos.test.ts and service-specific/authority-utxos.test.ts
});

describe('single-address mode', () => {
  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  it('should enable single-address mode and keep index 0 as current address after receiving tx', async () => {
    ({ wallet } = buildWalletInstance({ words: singleAddressWallet1.words }));
    await wallet.start({ pinCode, password });

    await wallet.enableSingleAddressMode();

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(singleAddressWallet1.addresses[0]);

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet1.addresses[0], 10n, wallet);

    const currentAddressAfterTx = wallet.getCurrentAddress();
    expect(currentAddressAfterTx.index).toBe(0);
    expect(currentAddressAfterTx.address).toBe(singleAddressWallet1.addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(singleAddressWallet1.addresses[0]);
  });

  it('should succeed enabling single-address mode when wallet only has tx on index 0', async () => {
    ({ wallet } = buildWalletInstance({ words: singleAddressWallet2.words }));
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet2.addresses[0], 5n, wallet);

    await wallet.enableSingleAddressMode();

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(singleAddressWallet2.addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(singleAddressWallet2.addresses[0]);
  });

  it('should fail to enable single-address mode when wallet has tx on index > 0', async () => {
    ({ wallet } = buildWalletInstance({ words: singleAddressWallet2.words }));
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet2.addresses[1], 10n, wallet);

    await expect(wallet.enableSingleAddressMode()).rejects.toThrow(
      'Cannot enable single-address policy'
    );
  });

  it('should fallback to start in multi-address mode via constructor when wallet has tx on index > 0', async () => {
    // First, start wallet normally and fund index 1
    ({ wallet } = buildWalletInstance({ words: singleAddressWallet2.words }));
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet2.addresses[1], 10n, wallet);

    await wallet.stop({ cleanStorage: true });

    // Now try to re-start with singleAddressMode: true via constructor
    const store = new MemoryStore();
    const storage = new Storage(store);
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn().mockResolvedValue('test-password'),
      seed: singleAddressWallet2.words,
      network: new Network('testnet'),
      storage,
      enableWs: false,
      singleAddressMode: true,
    });

    await wallet.start({ pinCode, password });

    await expect(wallet.getAddressMode()).resolves.toBe(WalletAddressMode.MULTI);
  });

  it('should start in single-address mode via constructor', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn().mockResolvedValue('test-password'),
      seed: singleAddressWallet1.words,
      network: new Network('testnet'),
      storage,
      enableWs: false,
      singleAddressMode: true,
    });

    await wallet.start({ pinCode, password });

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(singleAddressWallet1.addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(singleAddressWallet1.addresses[0]);
  });
});
