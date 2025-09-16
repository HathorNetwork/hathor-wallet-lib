import axios from 'axios';
import Mnemonic from 'bitcore-mnemonic';
import config from '../../src/config';
import { loggers } from './utils/logger.util';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src';
import {
  FULLNODE_NETWORK_NAME,
  FULLNODE_URL,
  NETWORK_NAME,
  WALLET_CONSTANTS,
} from './configuration/test-constants';
import { WALLET_SERVICE_AUTH_DERIVATION_PATH } from '../../src/constants';
import { decryptData } from '../../src/utils/crypto';
import walletUtils from '../../src/utils/wallet';
import { delay } from './utils/core.util';
import { TxNotFoundError } from '../../src/errors';

// Set base URL for the wallet service API inside the privatenet test container
config.setWalletServiceBaseUrl('http://localhost:3000/dev/');
config.setWalletServiceBaseWsUrl('ws://localhost:3001/');

const emptyWallet = {
  words:
    'buddy kingdom scorpion device uncover donate sense false few leaf oval illegal assume talent express glide above brain end believe abstract will marine crunch',
  addresses: [
    'WkHNZyrKNusTtu3EHfvozEqcBdK7RoEMR7',
    'WivGyxDjWxijcns3hpGvEJKhjR9HMgFzZ5',
    'WXQSeMcNt67hVpmgwYqmYLsddgXeGYP4mq',
    'WTMH3NQs8YXyNguqwLyqoTKDFTfkJLxMzX',
    'WTUiHeiajtt1MXd1Jb3TEeWUysfNJfig35',
    'WgzZ4MNcuX3sBgLC5Fa6dTTQaoy4ccLdv5',
    'WU6UQCnknGLh1WP392Gq6S69JmheS5kzZ2',
    'WX7cKt38FfgKFWFxSa2YzCWeCPgMbRR98h',
    'WZ1ABXsuwHHfLzeAWMX7RYs5919LPBaYpp',
    'WUJjQGb4SGSLh44m2JdgAR4kui8mTPb8bK',
  ],
};
const walletWithTxs = {
  words:
    'bridge balance milk impact love orchard achieve matrix mule axis size hip cargo rescue truth stable setup problem nerve fit million manage harbor connect',
  addresses: [
    'WeSnE5dnrciKahKbTvbUWmY6YM9Ntgi6MJ',
    'Wj52SGubNZu3JA2ncRXyNGfqyrdnj4XTU2',
    'Wh1Xs7zPVT9bc6dzzA23Zu8aiP3H8zLkiy',
    'WdFeZvVJkwAdLDpXLGJpFP9XSDcdrntvAg',
    'WTdWsgnCPKBuzEKAT4NZkzHaD4gHYMrk4G',
    'WSBhEBkuLpqu2Fz1j6PUyUa1W4GGybEYSF',
    'WS8yocEYBykpgjQxAhxjTcjVw9gKtYdys8',
    'WmkBa6ikYM2sZmiopM6zBGswJKvzs5Noix',
    'WeEPszSx14og6c3uPXy2vYh7BK9c6Zb9TX',
    'WWrNhymgFetPfxCv4DncveG6ykLHspHQxv',
  ],
};

/** Default pin to simplify the tests */
const pinCode = '123456';
/** Default password to simplify the tests */
const password = 'testpass';

/**
 * Builds a HathorWalletServiceWallet instance with a wallet seed words
 * @param enableWs - Whether to enable websocket connection (default: false)
 * @param words - The 24 words to use for the wallet (default: empty wallet)
 * @param passwordForRequests - The password that will be returned by the mocked requestPassword function (default: 'test-password')
 * @returns The wallet instance along with its store and storage for eventual mocking/spying
 */
function buildWalletInstance({
  enableWs = false,
  words = emptyWallet.words,
  passwordForRequests = 'test-password',
} = {}) {
  const walletData = { words };
  const network = new Network(NETWORK_NAME);
  const requestPassword = jest.fn().mockResolvedValue(passwordForRequests);

  const store = new MemoryStore();
  const storage = new Storage(store);
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed: walletData.words,
    network,
    storage,
    enableWs, // Disable websocket for integration tests
  });

  return { wallet, store, storage };
}

/**
 * Polls the wallet for a transaction by its ID until found or max attempts reached
 * @param wallet - The wallet instance to poll
 * @param txId - The transaction ID to look for
 * @returns The transaction object if found
 * @throws Error if the transaction is not found after max attempts
 */
async function poolForTx(wallet: HathorWalletServiceWallet, txId: string) {
  const maxAttempts = 10;
  const delayMs = 1000; // 1 second
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const tx = await wallet.getTxById(txId);
      if (tx) {
        loggers.test.log(`Pooling for ${txId} took ${attempts + 1} attempts`);
        return tx;
      }
    } catch (error) {
      // If the error is of type TxNotFoundError, we continue polling
      if (!(error instanceof TxNotFoundError)) {
        throw error; // Re-throw unexpected errors
      }
    }
    attempts++;
    await delay(delayMs);
  }
  throw new Error(`Transaction ${txId} not found after ${maxAttempts} attempts`);
}

describe('start', () => {
  describe('mandatory parameters validation', () => {
    let wallet: HathorWalletServiceWallet;

    beforeEach(() => {
      ({ wallet } = buildWalletInstance());
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
      await expect(wallet.start({ pinCode })).rejects.toThrow(
        'Password is required when starting the wallet from the seed.'
      );
    });
  });

  describe('handling internal errors', () => {
    let wallet: HathorWalletServiceWallet;
    const events: string[] = [];
    let storage: Storage;

    beforeEach(() => {
      ({ wallet, storage } = buildWalletInstance());

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
      await expect(() => wallet.start({ pinCode, password })).rejects.toThrow('Crash');

      // Verify wallet is ready
      expect(wallet.isReady()).toBe(false);
    });
  });

  describe('successful wallet creation', () => {
    let wallet: HathorWalletServiceWallet;
    const events: string[] = [];
    let storage: Storage;

    beforeEach(() => {
      ({ wallet, storage } = buildWalletInstance());

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
      await wallet.start({ pinCode, password });

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
      const network = new Network(NETWORK_NAME);
      const requestPassword = jest.fn().mockResolvedValue('test-password');
      wallet = new HathorWalletServiceWallet({
        requestPassword,
        xpriv: acctKey,
        authxpriv,
        network,
        storage,
        enableWs: false, // Disable websocket for integration tests
      });

      // Start the wallet
      await wallet.start({ pinCode, password });

      // Verify wallet is ready
      expect(wallet.isReady()).toBe(true);

      // Verify wallet has addresses available
      const currentAddress = wallet.getCurrentAddress();
      expect(currentAddress.index).toBeDefined();
      expect(currentAddress.address).toEqual(emptyWallet.addresses[currentAddress.index]);
    });
  });
});

describe('wallet public methods', () => {
  let wallet: HathorWalletServiceWallet;

  beforeEach(async () => {
    ({ wallet } = buildWalletInstance());
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

describe('empty wallet address methods', () => {
  let wallet: HathorWalletServiceWallet;
  const knownAddresses = emptyWallet.addresses;
  const unknownAddress = WALLET_CONSTANTS.miner.addresses[0];

  beforeEach(async () => {
    ({ wallet } = buildWalletInstance());
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

describe('basic transaction methods', () => {
  let wallet: HathorWalletServiceWallet;
  let gWallet: HathorWalletServiceWallet;

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
    if (gWallet) {
      await gWallet.stop({ cleanStorage: true });
    }
  });

  describe.only('sendTransaction', () => {
    it('should send a simple transaction with native token', async () => {
      ({ wallet: gWallet } = buildWalletInstance({
        words: WALLET_CONSTANTS.genesis.words,
      }));
      await gWallet.start({ pinCode, password });

      const sendTransaction = await gWallet.sendTransaction(walletWithTxs.addresses[0], 10n, {
        pinCode,
      });

      // Shallow validate all properties of the returned Transaction object
      expect(sendTransaction).toEqual(
        expect.objectContaining({
          // Core transaction identification
          hash: expect.any(String),

          // Inputs and outputs
          inputs: expect.any(Array),
          outputs: expect.any(Array),

          // Transaction metadata
          version: expect.any(Number),
          weight: expect.any(Number),
          nonce: expect.any(Number),
          signalBits: expect.any(Number),
          timestamp: expect.any(Number),

          // Transaction relationships
          parents: expect.arrayContaining([expect.any(String)]),
          tokens: expect.any(Array), // May be empty array

          // Headers
          headers: expect.any(Array), // May be empty
        })
      );

      // Deep validate the Inputs and Outputs arrays
      expect(sendTransaction.inputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            hash: expect.any(String),
            index: expect.any(Number),
            data: expect.any(Buffer),
          }),
        ])
      );

      expect(sendTransaction.outputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: expect.any(BigInt),
            script: expect.any(Buffer),
            tokenData: expect.any(Number),
          }),
        ])
      );

      // Additional specific validations
      expect(sendTransaction.hash).toHaveLength(64); // Transaction hash should be 64 hex characters
      expect(sendTransaction.inputs.length).toBeGreaterThan(0); // Should have at least one input
      expect(sendTransaction.outputs.length).toBeGreaterThan(0); // Should have at least one output
      expect(sendTransaction.tokens).toHaveLength(0); // Not populated if only the native token is sent
      expect(sendTransaction.parents).toHaveLength(2); // Should have exactly 2 parents
      expect(sendTransaction.timestamp).toBeGreaterThan(0); // Should have a valid timestamp

      // Verify the transaction was sent to the correct address with correct value
      const recipientOutput = sendTransaction.outputs.find(output => output.value === 10n);
      expect(recipientOutput).toStrictEqual(
        expect.objectContaining({
          value: 10n,
          tokenData: 0,
        })
      );
    });

    it('should send a transaction with a set changeAddress', async () => {
      ({ wallet } = buildWalletInstance({ words: walletWithTxs.words }));
      await wallet.start({ pinCode, password });

      const sendTransaction = await wallet.sendTransaction(walletWithTxs.addresses[1], 4n, {
        pinCode,
        changeAddress: walletWithTxs.addresses[0],
      });

      // Verify that the only outputs were the recipient and the change address
      expect(sendTransaction.outputs.length).toBe(2);

      // Verify the transaction was sent to the correct address with correct value
      let recipientIndex;
      let changeIndex;
      sendTransaction.outputs.forEach((output, index) => {
        if (output.value === 4n) {
          recipientIndex = index;
        } else if (output.value === 6n) {
          changeIndex = index;
        }
      });

      // Confirm the addresses through UTXO queries
      await poolForTx(wallet, sendTransaction.hash!);
      const recipientUtxo = await wallet.getUtxoFromId(sendTransaction.hash!, recipientIndex);
      expect(recipientUtxo).toStrictEqual(
        expect.objectContaining({
          address: walletWithTxs.addresses[1],
          value: 4n,
        })
      );
      const changeUtxo = await wallet.getUtxoFromId(sendTransaction.hash!, changeIndex);
      expect(changeUtxo).toStrictEqual(
        expect.objectContaining({
          address: walletWithTxs.addresses[0],
          value: 6n,
        })
      );
    });
  });
});

describe('websocket events', () => {
  let wallet: HathorWalletServiceWallet;
  let gWallet: HathorWalletServiceWallet;

  beforeAll(async () => {
    const genesisPassword = 'genesispass';
    ({ wallet: gWallet } = buildWalletInstance({
      enableWs: true,
      words: WALLET_CONSTANTS.genesis.words,
      passwordForRequests: genesisPassword,
    }));
    await gWallet.start({ pinCode, password: genesisPassword });
  });

  beforeEach(async () => {
    ({ wallet } = buildWalletInstance({ enableWs: true, words: walletWithTxs.words }));
    await wallet.start({ pinCode, password });
  });

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  afterAll(async () => {
    gWallet.stop();
  });

  // FIXME: The transactions happen, the websocket connection is active, but the events never arrive
  it.skip('should handle new-tx websocket event', async () => {
    const events: unknown[] = [];
    wallet.on('new-tx', tx => {
      events.push(tx);
      // Add your assertions here after triggering the event
    });
    wallet.on('update-tx', tx => {
      events.push(tx);
      // Add your assertions here after triggering the event
    });

    const sendTransaction = await gWallet.sendTransaction(walletWithTxs.addresses[0], 10n, {
      pinCode,
    });
    expect(sendTransaction.hash).toBeDefined();

    // Wait up to 3 times, 2 seconds each, for events to arrive
    for (let i = 0; i < 3; i++) {
      if (events.length > 0) break;
      await delay(2000);
    }

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toBeDefined();
  });

  it.skip('should handle update-tx websocket event', async () => {
    const events: any[] = [];
    wallet.on('update-tx', tx => {
      events.push(tx);
      // Add your assertions here after triggering the event
    });
    // TODO: Trigger the event and add assertions
    expect(true).toBe(false);
  });
});

describe('balances', () => {
  let wallet: HathorWalletServiceWallet;

  beforeEach(async () => {
    ({ wallet } = buildWalletInstance());
    await wallet.start({ pinCode, password });
  });

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  describe('getBalance', () => {
    // FIXME: The test does not return balance for empty wallet. It should return 0 for the native token
    it.skip('should return balance array for empty wallet', async () => {
      const balances = await wallet.getBalance();

      expect(Array.isArray(balances)).toBe(true);
      expect(balances.length).toStrictEqual(1);

      // Should have HTR (native token) with zero balance for empty wallet
      const htrBalance = balances.find(b => b.token.id === '00');
      expect(htrBalance).toBeDefined();
      expect(htrBalance?.balance).toBe(0n);
    });

    it('should return balance array for wallet with transactions', async () => {
      // Use walletWithTxs which has transaction history
      const { wallet: walletTxs } = buildWalletInstance({ words: walletWithTxs.words });
      await walletTxs.start({ pinCode, password });

      const balances = await walletTxs.getBalance();

      expect(Array.isArray(balances)).toBe(true);
      expect(balances.length).toBeGreaterThanOrEqual(1);

      // Should have HTR balance
      const htrBalance = balances.find(b => b.token.id === '00');
      expect(htrBalance).toBeDefined();
      expect(typeof htrBalance?.balance).toBe('bigint');

      await walletTxs.stop({ cleanStorage: true });
    });

    // FIXME: The test does not return balance for empty wallet. It should return 0 for the native token
    it('should return balance for specific token when token parameter is provided', async () => {
      const balances = await wallet.getBalance('00'); // HTR token

      expect(Array.isArray(balances)).toBe(true);
      // When requesting specific token, should return that token's balance
      expect(balances.length).toStrictEqual(1);
      expect(balances[0]).toEqual(
        expect.objectContaining({
          token: expect.objectContaining({
            id: '00',
            name: expect.any(String),
            symbol: expect.any(String),
          }),
          balance: expect.objectContaining({
            unlocked: 0n,
            locked: 0n,
          }),
          tokenAuthorities: expect.objectContaining({
            unlocked: expect.objectContaining({
              mint: false,
              melt: false,
            }),
            locked: expect.objectContaining({
              mint: false,
              melt: false,
            }),
          }),
          transactions: 0,
          lockExpires: expect.anything(),
        })
      );
    });

    it('should throw error when wallet is not ready', async () => {
      const { wallet: notReadyWallet } = buildWalletInstance();
      // Don't start the wallet, so it's not ready

      await expect(notReadyWallet.getBalance()).rejects.toThrow('Wallet not ready');
    });
  });

  describe.skip('getTxBalance', () => {});
});
