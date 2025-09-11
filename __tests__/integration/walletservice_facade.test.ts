import axios from 'axios';
import Mnemonic from 'bitcore-mnemonic';
import { IStore } from 'src/types';
import config from '../../src/config';
import { loggers } from './utils/logger.util';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src';
import { FULLNODE_NETWORK_NAME, FULLNODE_URL, NETWORK_NAME } from './configuration/test-constants';
import { WALLET_SERVICE_AUTH_DERIVATION_PATH } from '../../src/constants';
import { decryptData } from '../../src/utils/crypto';
import walletUtils from '../../src/utils/wallet';

// Set base URL for the wallet service API inside the privatenet test container
config.setWalletServiceBaseUrl('http://localhost:3000/dev/');
config.setWalletServiceBaseWsUrl('ws://localhost:3001/dev/');

const emptyWallet = {
  words:
    'buddy kingdom scorpion device uncover donate sense false few leaf oval illegal assume talent express glide above brain end believe abstract will marine crunch',
  addresses: [
    'WkHNZyrKNusTtu3EHfvozEqcBdK7RoEMR7',
    'WivGyxDjWxijcns3hpGvEJKhjR9HMgFzZ5',
    'WXQSeMcNt67hVpmgwYqmYLsddgXeGYP4mq',
  ],
};

describe('start', () => {
  const walletData = { words: emptyWallet.words };
  const network = new Network(NETWORK_NAME);
  const requestPassword = jest.fn().mockResolvedValue('test-password');

  describe('mandatory parameters validation', () => {
    let wallet: HathorWalletServiceWallet;
    let storage: Storage;

    beforeEach(() => {
      const store = new MemoryStore();
      storage = new Storage(store);
      wallet = new HathorWalletServiceWallet({
        requestPassword,
        seed: walletData.words,
        network,
        storage,
      });
    });

    afterEach(async () => {
      if (wallet) {
        await wallet.stop({ cleanStorage: true });
      }
    });

    it('should throw error when pinCode is not provided', async () => {
      await expect(wallet.start({})).rejects.toThrow(
        'Pin code is required when starting the wallet.'
      );
    });

    it('should throw error when password is not provided for new wallet from seed', async () => {
      await expect(wallet.start({ pinCode: '123456' })).rejects.toThrow(
        'Password is required when starting the wallet from the seed.'
      );
    });
  });

  describe('handling internal errors', () => {
    let wallet: HathorWalletServiceWallet;
    const events: string[] = [];
    let store: IStore;
    let storage: Storage;

    beforeEach(() => {
      store = new MemoryStore();
      storage = new Storage(store);
      wallet = new HathorWalletServiceWallet({
        requestPassword,
        seed: walletData.words,
        network,
        storage,
        enableWs: false, // Disable websocket for integration tests
      });

      // Clear events array
      events.length = 0;

      // Listen for state events
      wallet.on('state', state => {
        events.push(`state:${state}`);
      });
    });

    afterEach(async () => {
      if (wallet) {
        await wallet.stop({ cleanStorage: true });
      }
    });

    it('should handle getAccessData unexpected errors', async () => {
      // XXX: This test belongs to the unit tests, but adding it here temporarily for coverage
      jest.spyOn(storage, 'getAccessData').mockRejectedValueOnce(new Error('Crash'));

      // Start the wallet
      await expect(() => wallet.start({ pinCode: '123456', password: 'testpass' })).rejects.toThrow(
        'Crash'
      );

      // Verify wallet is ready
      expect(wallet.isReady()).toBe(false);
    });
  });

  describe('successful wallet creation', () => {
    let wallet: HathorWalletServiceWallet;
    const events: string[] = [];
    let store: IStore;
    let storage: Storage;

    beforeEach(() => {
      store = new MemoryStore();
      storage = new Storage(store);
      wallet = new HathorWalletServiceWallet({
        requestPassword,
        seed: walletData.words,
        network,
        storage,
        enableWs: false, // Disable websocket for integration tests
      });

      // Clear events array
      events.length = 0;

      // Listen for state events
      wallet.on('state', state => {
        events.push(`state:${state}`);
      });
    });

    afterEach(async () => {
      if (wallet) {
        await wallet.stop({ cleanStorage: true });
      }
    });

    it('should create wallet with words and emit correct state events', async () => {
      // Start the wallet
      await wallet.start({ pinCode: '123456', password: 'testpass' });

      // Verify wallet is ready
      expect(wallet.isReady()).toBe(true);

      // Verify correct state transitions occurred
      expect(events).toContain('state:Loading');
      expect(events).toContain('state:Ready');

      // Verify wallet has correct network
      expect(wallet.getNetwork()).toBe(NETWORK_NAME);

      // Verify wallet has addresses available
      const currentAddress = wallet.getCurrentAddress();
      expect(currentAddress.index).toBeDefined();
      expect(currentAddress.address).toEqual(emptyWallet.addresses[currentAddress.index]);

      // Verify websocket is disabled for this test
      expect(wallet.isWsEnabled()).toBe(false);
    });

    it('should create wallet with xpriv', async () => {
      // Generate access data to get the xpriv
      const seed = emptyWallet.words;
      const accessData = walletUtils.generateAccessDataFromSeed(seed, {
        networkName: 'testnet',
        password: '1234',
        pin: '1234',
      });

      // Derive auth xpriv and account key
      const code = new Mnemonic(seed);
      const xpriv = code.toHDPrivateKey('', new Network('testnet'));
      const authxpriv = xpriv.deriveChild(WALLET_SERVICE_AUTH_DERIVATION_PATH).xprivkey;
      const acctKey = decryptData(accessData.acctPathKey!, '1234');

      // Build wallet with xpriv and authxpriv
      wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpriv: acctKey,
        authxpriv,
        network,
        storage,
        enableWs: false, // Disable websocket for integration tests
      });

      // Start the wallet
      await wallet.start({ pinCode: '123456', password: 'testpass' });

      // Verify wallet is ready
      expect(wallet.isReady()).toBe(true);

      // Verify wallet has addresses available
      const currentAddress = wallet.getCurrentAddress();
      expect(currentAddress.index).toBeDefined();
      expect(currentAddress.address).toEqual(emptyWallet.addresses[currentAddress.index]);
    });
  });

  describe('wallet public methods', () => {
    let wallet: HathorWalletServiceWallet;
    let storage: Storage;
    const pinCode = '123456';
    const password = 'testpass';
    const network = new Network(NETWORK_NAME);

    beforeEach(async () => {
      const store = new MemoryStore();
      storage = new Storage(store);
      wallet = new HathorWalletServiceWallet({
        requestPassword: jest.fn().mockResolvedValue(password),
        seed: emptyWallet.words,
        network,
        storage,
        enableWs: false,
      });
      await wallet.start({ pinCode, password });
    });

    afterEach(async () => {
      if (wallet) {
        await wallet.stop({ cleanStorage: true });
      }
    });

    it('getServerUrl returns the configured base URL', () => {
      expect(wallet.getServerUrl()).toBe(FULLNODE_URL);
    });

    it('getVersionData returns valid version info', async () => {
      const versionData = await wallet.getVersionData();
      expect(versionData).toBeDefined();
      expect(versionData).toEqual(
        expect.objectContaining({
          timestamp: expect.any(Number),
          version: expect.any(String),
          network: FULLNODE_NETWORK_NAME,
          minWeight: expect.any(Number),
          minTxWeight: expect.any(Number),
          minTxWeightCoefficient: expect.any(Number),
          minTxWeightK: expect.any(Number),
          tokenDepositPercentage: expect.any(Number),
          rewardSpendMinBlocks: expect.any(Number),
          maxNumberInputs: expect.any(Number),
          maxNumberOutputs: expect.any(Number),
          decimalPlaces: expect.any(Number),
          nativeTokenName: expect.any(String),
          nativeTokenSymbol: expect.any(String),
        })
      );

      // Make sure it contains the same data as a direct fullnode request
      const fullnodeResponse = await axios
        .get('version', {
          baseURL: config.getWalletServiceBaseUrl(),
          headers: {
            'Content-Type': 'application/json',
          },
        })
        .catch(e => {
          // @ts-expect-error - The logger is initialized on setup, but TS cannot infer that
          loggers.test.log(`Received an error on /version: ${e}`);
          if (e.response) {
            return e.response;
          }
          return {};
        });
      expect(fullnodeResponse.status).toBe(200);
      expect(fullnodeResponse.data?.success).toBe(true);

      expect(versionData).toEqual(fullnodeResponse.data.data);
    });

    it('getNetwork returns the correct network name', () => {
      expect(wallet.getNetwork()).toBe(NETWORK_NAME);
    });

    it('getNetworkObject returns a Network instance with correct name', () => {
      const networkObj = wallet.getNetworkObject();
      expect(networkObj).toBeInstanceOf(Network);
      expect(networkObj.name).toBe(NETWORK_NAME);
    });
  });
});
