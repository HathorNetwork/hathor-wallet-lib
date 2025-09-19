import axios from 'axios';
import Mnemonic from 'bitcore-mnemonic';
import config from '../../src/config';
import { loggers } from './utils/logger.util';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import Network from '../../src/models/network';
import { CreateTokenTransaction, MemoryStore, Output, Storage } from '../../src';
import {
  FULLNODE_NETWORK_NAME,
  FULLNODE_URL,
  NETWORK_NAME,
  WALLET_CONSTANTS,
} from './configuration/test-constants';
import {
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
  WALLET_SERVICE_AUTH_DERIVATION_PATH,
} from '../../src/constants';
import { decryptData } from '../../src/utils/crypto';
import walletUtils from '../../src/utils/wallet';
import { delay } from './utils/core.util';
import { TxNotFoundError, UtxoError } from '../../src/errors';
import { NATIVE_TOKEN_UID } from '../../lib/constants';
import { GetAddressesObject } from '../../lib/wallet/types';

const testLogger = loggers.test!;

// Set base URL for the wallet service API inside the privatenet test container
config.setWalletServiceBaseUrl('http://localhost:3000/dev/');
config.setWalletServiceBaseWsUrl('ws://localhost:3001/');

/** Genesis Wallet, used to fund all tests */
const gWallet: HathorWalletServiceWallet = buildWalletInstance({
  words: WALLET_CONSTANTS.genesis.words,
}).wallet;
/** Wallet instance used in tests */
let wallet: HathorWalletServiceWallet;
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
const customTokenWallet = {
  words:
    'shine myself welcome feature nurse cement crumble input utility lizard melt great sample slab know leisure salmon path gate iron enlist discover cry radio',
  addresses: [
    'WUTMZMaNoewWprYpb8b2etTfRuw2zRS5u3',
    'WNxz1juhoJk9Y28knsH8ynVXn9s7bYLMkd',
    'WWBkdHcB7TCjNQUiyFhZpXDU4Tejd7AFd5',
    'WdcFTovRGiePVSnCpoGUYBgAGyDmXhkaD6',
    'WjuxR4r487CTGGMJRpcnAZ9bdaH91qt7F5',
    'WkYJ6SHfS2CTAMCxtrwWm7Mr12YRMx7WzQ',
    'WTuBXE1WPNgjSxqDfRKy2fiDydT3e2pdiJ',
    'WTipscpJ14sAZ4Y3f2gY5Tb1RWJYop9QYK',
    'WhQovEXRSDc7MLMz8Tqy1qJdTy2hef1dYq',
    'WkUREDxNQX6Qq1NwdLQycxkHFjKujQasWX',
  ],
};
const multipleTokensWallet = {
  words:
    'object join brain round loyal unfair shine genius brain vocal object crouch simple cake chase october unlock detail ivory kidney saddle immense deer response',
  addresses: [
    'Wie8wTxa7P6Vbr1UhADfDfafJftyYsZNMU',
    'WaCk6XV4zCwdPTvGH6VgkE58ebqEndA6b7',
    'Wdsez9n6LuWMtKQv3zdnKtQkTeXFw7ATFj',
    'WdZcUpCoLS1CK5UD7V5Z4d42X92zc7QHEi',
    'WaaXsw2HdYiBUveqg6QWS5HmkwTNUKUBLD',
    'WPxVMXd89aaXWXqUcVTjdQPUvuT3wehJxc',
    'WSbfhb9tkJneSbEJsyzyEURYcTqkPKRUUD',
    'WQt8Gxy5yWC3xZGsHVrywYJqHyg5xtudun',
    'WcpnSRvzZGAnR6rtQiBnzP7aLnvPstpXbD',
    'WQzooroUKJMrFVv5P1UrPppmQ2YF8ACfAS',
  ],
};
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
        testLogger.log(`Pooling for ${txId} took ${attempts + 1} attempts`);
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

async function generateNewWalletAddress() {
  const newWords = walletUtils.generateWalletWords();
  const { wallet } = buildWalletInstance({ words: newWords });
  await wallet.start({ pinCode, password });

  const addresses: string[] = [];
  for (let i = 0; i < 10; i++) {
    addresses.push((await wallet.getAddressAtIndex(i))!);
  }

  return {
    words: newWords,
    addresses,
  };
}

async function sendFundTx(
  address: string,
  amount: bigint,
  destinationWallet?: HathorWalletServiceWallet
) {
  const fundTx = await gWallet.sendTransaction(address, amount, {
    pinCode,
  });

  // Ensure the transaction was sent from the Genesis perspective
  await poolForTx(gWallet, fundTx.hash!);

  // Ensure the destination wallet is also aware of the transaction
  if (destinationWallet) {
    await poolForTx(destinationWallet, fundTx.hash!);
  }

  return fundTx;
}

beforeAll(async () => {
  console.log(`${JSON.stringify(await generateNewWalletAddress(), null, 2)}`);

  let isServerlessReady = false;
  const startTime = Date.now();

  // Pool for the serverless app to be ready.
  const delayBetweenRequests = 3000;
  const lambdaTimeout = 30000;
  while (isServerlessReady) {
    try {
      // Executing a method that does not depend on the wallet being started,
      // but that ensures the Wallet Service Lambdas are receiving requests
      await gWallet.getVersionData();
      isServerlessReady = true;
    } catch (e) {
      // Ignore errors, serverless app is probably not ready yet
      testLogger.log('Ws-Serverless not ready yet, retrying in 3 seconds...');
    }

    // Timeout after 2 minutes
    if (Date.now() - startTime > lambdaTimeout) {
      throw new Error('Ws-Serverless did not become ready in time');
    }
    await delay(delayBetweenRequests);
  }
  await gWallet.start({ pinCode, password });
});

afterAll(async () => {
  await gWallet.stop({ cleanStorage: true });
});

describe('start', () => {
  describe('mandatory parameters validation', () => {

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
        testLogger.log(`Received an error on /version: ${e}`);
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

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  describe('sendTransaction - native token', () => {
    it('should send a simple transaction with native token', async () => {
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

  describe('createNewToken, getTokenDetails', () => {
    const tokenName = 'TestToken';
    const tokenSymbol = 'TST';
    const tokenAmount = 100n;
    let tokenUid: string;

    it('should not create a new token on a wallet without funds', async () => {
      ({ wallet } = buildWalletInstance());
      await wallet.start({ pinCode, password });

      await expect(
        wallet.createNewToken(tokenName, tokenSymbol, tokenAmount, { pinCode })
      ).rejects.toThrow(UtxoError);
    });

    it('should create a new token without any custom options', async () => {
      const fundTx = await sendFundTx(customTokenWallet.addresses[0], 10n);

      ({ wallet } = buildWalletInstance({
        words: customTokenWallet.words,
      }));
      await wallet.start({ pinCode, password });
      await poolForTx(wallet, fundTx.hash!);

      const createTokenTx = (await wallet.createNewToken(tokenName, tokenSymbol, tokenAmount, {
        pinCode,
      })) as CreateTokenTransaction;

      // Shallow validate all properties of the returned CreateTokenTransaction object
      expect(createTokenTx).toEqual(
        expect.objectContaining({
          // Core transaction identification
          hash: expect.any(String),

          // Token creation specific properties
          name: tokenName,
          symbol: tokenSymbol,

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
          tokens: expect.any(Array), // Should contain the new token UID

          // Headers
          headers: expect.any(Array), // May be empty
        })
      );

      // Deep validate the Outputs array
      expect(createTokenTx.outputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: expect.any(BigInt),
            script: expect.any(Buffer),
            tokenData: expect.any(Number),
          }),
        ])
      );

      // Additional validations
      expect(createTokenTx.inputs.length).toStrictEqual(1);
      expect(createTokenTx.outputs.length).toBeGreaterThanOrEqual(3); // Token output + mint authority + melt authority (+ possible change)
      expect(createTokenTx.tokens).toHaveLength(0); // Token creation has this array empty
      expect(createTokenTx.parents).toHaveLength(2); // Should have exactly 2 parents
      expect(createTokenTx.timestamp).toBeGreaterThan(0); // Should have a valid timestamp

      // Validate specific output types for token creation
      let tokenOutput: Output;
      let mintAuthorityOutput: Output;
      let meltAuthorityOutput: Output;

      createTokenTx.outputs.forEach(output => {
        if (output.tokenData === 1) {
          // Token amount output
          tokenOutput = output;
        } else if (output.tokenData === 129) {
          // Authority output (tokenData 129 = 128 + 1, where 128 is AUTHORITY_TOKEN_DATA and 1 is mint mask)
          if (output.value === TOKEN_MINT_MASK) {
            mintAuthorityOutput = output;
          } else if (output.value === TOKEN_MELT_MASK) {
            meltAuthorityOutput = output;
          }
        }
      });

      // Validate token amount output
      // @ts-expect-error - tokenOutput must exist
      expect(tokenOutput).toStrictEqual(
        expect.objectContaining({
          value: tokenAmount,
          tokenData: 1,
          script: expect.any(Buffer),
        })
      );

      // Validate mint authority output (default behavior creates mint authority)
      // @ts-expect-error - mintAuthorityOutput must exist
      expect(mintAuthorityOutput).toStrictEqual(
        expect.objectContaining({
          value: 1n, // TOKEN_MINT_MASK
          tokenData: 129, // AUTHORITY_TOKEN_DATA + mint bit
          script: expect.any(Buffer),
        })
      );

      // Validate melt authority output (default behavior creates melt authority)
      // @ts-expect-error - meltAuthorityOutput must exist
      expect(meltAuthorityOutput).toStrictEqual(
        expect.objectContaining({
          value: 2n, // TOKEN_MELT_MASK
          tokenData: 129, // AUTHORITY_TOKEN_DATA + melt bit
          script: expect.any(Buffer),
        })
      );

      // Verify the transaction can be found after creation
      tokenUid = createTokenTx.hash!;
      await poolForTx(wallet, tokenUid);

      // Specific token creation validations
      const tokenDetails = await wallet.getTokenDetails(tokenUid);
      expect(tokenDetails.tokenInfo).toStrictEqual(
        expect.objectContaining({
          id: tokenUid,
          name: tokenName,
          symbol: tokenSymbol,
        })
      );
      expect(tokenDetails.totalSupply).toBe(tokenAmount);
      expect(tokenDetails.totalTransactions).toBe(1);
      expect(tokenDetails.authorities?.mint).toBe(true);
      expect(tokenDetails.authorities?.melt).toBe(true);
    });

    it('should sendTransaction with custom token', async () => {
      ({ wallet } = buildWalletInstance({ words: customTokenWallet.words }));
      await wallet.start({ pinCode, password });

      const recipientAddress = customTokenWallet.addresses[0];
      const sendTransaction = await wallet.sendTransaction(recipientAddress, 10n, {
        pinCode,
        token: tokenUid,
      });
      await poolForTx(wallet, sendTransaction.hash!);

      // Verify that the only outputs were the recipient and the change address
      expect(sendTransaction.outputs.length).toBe(2);

      // Verify the transaction was sent to the correct address with correct value
      let recipientIndex;
      let changeIndex;
      sendTransaction.outputs.forEach((output, index) => {
        if (output.value === 10n) {
          recipientIndex = index;
        } else if (output.value === 90n) {
          changeIndex = index;
        }
      });

      // Confirm the addresses through UTXO queries
      const recipientUtxo = await wallet.getUtxoFromId(sendTransaction.hash!, recipientIndex);
      expect(recipientUtxo).toStrictEqual(
        expect.objectContaining({
          address: recipientAddress,
          value: 10n,
          tokenId: tokenUid,
        })
      );
      const changeUtxo = await wallet.getUtxoFromId(sendTransaction.hash!, changeIndex);
      expect(changeUtxo).toStrictEqual(
        expect.objectContaining({
          value: 90n,
          tokenId: tokenUid,
        })
      );
    });

    it('should create new token with no authorities', async () => {
      ({ wallet } = buildWalletInstance({
        words: customTokenWallet.words,
      }));
      await wallet.start({ pinCode, password });

      const createTokenTx = (await wallet.createNewToken(tokenName, tokenSymbol, tokenAmount, {
        pinCode,
        createMint: false,
        createMelt: false,
      })) as CreateTokenTransaction;

      // Shallow validate all properties of the returned CreateTokenTransaction object
      expect(createTokenTx).toEqual(
        expect.objectContaining({
          // Core transaction identification
          hash: expect.any(String),

          // Token creation specific properties
          name: tokenName,
          symbol: tokenSymbol,
        })
      );

      // Validate specific output types for token creation with no authorities
      let tokenOutput: Output;
      let authorityOutputsCount = 0;

      createTokenTx.outputs.forEach(output => {
        if (output.tokenData === 1) {
          // Token amount output
          tokenOutput = output;
        } else if (output.tokenData === 129) {
          // Authority output (tokenData 129 = 128 + 1, where 128 is AUTHORITY_TOKEN_DATA and 1 is tokenData)
          authorityOutputsCount++;
        }
      });

      // Validate token amount output
      // @ts-expect-error - tokenOutput must exist
      expect(tokenOutput).toStrictEqual(
        expect.objectContaining({
          value: tokenAmount,
          tokenData: 1,
          script: expect.any(Buffer),
        })
      );

      // Validate that no authority outputs were created
      expect(authorityOutputsCount).toBe(0);

      // Verify the transaction can be found after creation
      const noAuthTokenUid = createTokenTx.hash!;
      await poolForTx(wallet, noAuthTokenUid);

      // Specific token creation validations
      const tokenDetails = await wallet.getTokenDetails(noAuthTokenUid);
      expect(tokenDetails.tokenInfo).toStrictEqual(
        expect.objectContaining({
          id: noAuthTokenUid,
          name: tokenName,
          symbol: tokenSymbol,
        })
      );
      expect(tokenDetails.totalSupply).toBe(tokenAmount);
      expect(tokenDetails.totalTransactions).toBe(1);
      expect(tokenDetails.authorities?.mint).toBe(false);
      expect(tokenDetails.authorities?.melt).toBe(false);
    });

    it('should create token with specific addresses', async () => {
      ({ wallet } = buildWalletInstance({
        words: customTokenWallet.words,
      }));
      await wallet.start({ pinCode, password });

      // Assign specific addresses for each component (starting from index 9 going backwards)
      const destinationAddress = customTokenWallet.addresses[9]; // Token destination
      const mintAuthorityAddress = customTokenWallet.addresses[8]; // Mint authority
      const meltAuthorityAddress = customTokenWallet.addresses[7]; // Melt authority
      const changeAddress = customTokenWallet.addresses[6]; // Change address

      const createTokenTx = (await wallet.createNewToken(tokenName, tokenSymbol, tokenAmount, {
        pinCode,
        address: destinationAddress,
        changeAddress,
        createMint: true,
        mintAuthorityAddress,
        createMelt: true,
        meltAuthorityAddress,
      })) as CreateTokenTransaction;

      // Shallow validate all properties of the returned CreateTokenTransaction object
      expect(createTokenTx).toEqual(
        expect.objectContaining({
          hash: expect.any(String),
          name: tokenName,
          symbol: tokenSymbol,
        })
      );

      // Validate specific output types and their addresses
      let tokenOutput: Output;
      let mintAuthorityOutput: Output;
      let meltAuthorityOutput: Output;
      let changeOutput: Output;

      createTokenTx.outputs.forEach(output => {
        if (output.tokenData === 1) {
          // Token amount output
          tokenOutput = output;
        } else if (output.tokenData === 129) {
          // Authority output (tokenData 129 = 128 + 1, where 128 is AUTHORITY_TOKEN_DATA and 1 is mint mask)
          if (output.value === TOKEN_MINT_MASK) {
            mintAuthorityOutput = output;
          } else if (output.value === TOKEN_MELT_MASK) {
            meltAuthorityOutput = output;
          }
        } else if (
          output.tokenData === 0 &&
          output.value !== TOKEN_MINT_MASK &&
          output.value !== TOKEN_MELT_MASK
        ) {
          // HTR change output (tokenData 0, not authority)
          changeOutput = output;
        }
      });

      // Verify the transaction can be found after creation
      const specificAddressTokenUid = createTokenTx.hash!;
      await poolForTx(wallet, specificAddressTokenUid);

      // Validate that outputs went to the correct addresses through UTXO queries
      let tokenOutputIndex = -1;
      let mintAuthorityOutputIndex = -1;
      let meltAuthorityOutputIndex = -1;
      let changeOutputIndex = -1;

      createTokenTx.outputs.forEach((output, index) => {
        if (output.tokenData === 1) {
          tokenOutputIndex = index;
        } else if (output.tokenData === 129) {
          if (output.value === TOKEN_MINT_MASK) {
            mintAuthorityOutputIndex = index;
          } else if (output.value === TOKEN_MELT_MASK) {
            meltAuthorityOutputIndex = index;
          }
        } else if (
          output.tokenData === 0 &&
          output.value !== TOKEN_MINT_MASK &&
          output.value !== TOKEN_MELT_MASK
        ) {
          changeOutputIndex = index;
        }
      });

      // Verify token output went to destination address
      const tokenUtxo = await wallet.getUtxoFromId(specificAddressTokenUid, tokenOutputIndex);
      expect(tokenUtxo).toStrictEqual(
        expect.objectContaining({
          address: destinationAddress,
          value: tokenAmount,
          tokenId: specificAddressTokenUid,
        })
      );

      // Verify mint authority output went to mint authority address
      const mintAuthorityUtxo = await wallet.getUtxoFromId(
        specificAddressTokenUid,
        mintAuthorityOutputIndex
      );
      expect(mintAuthorityUtxo).toStrictEqual(
        expect.objectContaining({
          address: mintAuthorityAddress,
          value: 0n,
          tokenId: specificAddressTokenUid,
        })
      );

      // Verify melt authority output went to melt authority address
      const meltAuthorityUtxo = await wallet.getUtxoFromId(
        specificAddressTokenUid,
        meltAuthorityOutputIndex
      );
      expect(meltAuthorityUtxo).toStrictEqual(
        expect.objectContaining({
          address: meltAuthorityAddress,
          value: 0n,
          tokenId: specificAddressTokenUid,
        })
      );

      // Verify change output went to change address (if exists)
      if (changeOutputIndex !== -1) {
        const changeUtxo = await wallet.getUtxoFromId(specificAddressTokenUid, changeOutputIndex);
        expect(changeUtxo).toStrictEqual(
          expect.objectContaining({
            address: changeAddress,
            tokenId: NATIVE_TOKEN_UID,
          })
        );
      }

      // Specific token creation validations
      const tokenDetails = await wallet.getTokenDetails(specificAddressTokenUid);
      expect(tokenDetails.tokenInfo).toStrictEqual(
        expect.objectContaining({
          id: specificAddressTokenUid,
          name: tokenName,
          symbol: tokenSymbol,
        })
      );
      expect(tokenDetails.totalSupply).toBe(tokenAmount);
      expect(tokenDetails.totalTransactions).toBe(1);
      expect(tokenDetails.authorities?.mint).toBe(true);
      expect(tokenDetails.authorities?.melt).toBe(true);
    });

    it('should create token with all outputs to another wallet', async () => {
      const fundTx = await sendFundTx(customTokenWallet.addresses[0], 10n);

      ({ wallet } = buildWalletInstance({
        words: customTokenWallet.words,
      }));
      await wallet.start({ pinCode, password });
      await poolForTx(wallet, fundTx.hash!);

      // Assign external addresses from multipleTokensWallet (starting from index 9 going backwards)
      const destinationAddress = multipleTokensWallet.addresses[9]; // Token destination
      const mintAuthorityAddress = multipleTokensWallet.addresses[8]; // Mint authority
      const meltAuthorityAddress = multipleTokensWallet.addresses[7]; // Melt authority
      const changeAddress = multipleTokensWallet.addresses[6]; // Change address

      // First test: Try to use external addresses without proper flags - should fail
      await expect(
        wallet.createNewToken(tokenName, tokenSymbol, tokenAmount, {
          pinCode,
          address: destinationAddress,
          changeAddress,
          createMint: true,
          mintAuthorityAddress,
          createMelt: true,
          meltAuthorityAddress,
        })
      ).rejects.toThrow(); // Should throw because external addresses are not allowed without flags

      // Second test: Pass the correct flags to allow external addresses - should succeed
      const createTokenTx = (await wallet.createNewToken(tokenName, tokenSymbol, tokenAmount, {
        pinCode,
        address: destinationAddress,
        changeAddress,
        createMint: true,
        mintAuthorityAddress,
        createMelt: true,
        meltAuthorityAddress,
        allowExternalMintAuthorityAddress: true,
        allowExternalMeltAuthorityAddress: true,
      })) as CreateTokenTransaction;

      // Shallow validate all properties of the returned CreateTokenTransaction object
      expect(createTokenTx).toEqual(
        expect.objectContaining({
          // Core transaction identification
          hash: expect.any(String),

          // Token creation specific properties
          name: tokenName,
          symbol: tokenSymbol,

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
          tokens: expect.any(Array), // Should contain the new token UID

          // Headers
          headers: expect.any(Array), // May be empty
        })
      );

      // Deep validate the Outputs array
      expect(createTokenTx.outputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: expect.any(BigInt),
            script: expect.any(Buffer),
            tokenData: expect.any(Number),
          }),
        ])
      );

      // Additional validations
      expect(createTokenTx.inputs.length).toStrictEqual(1);
      expect(createTokenTx.outputs.length).toBeGreaterThanOrEqual(3); // Token output + mint authority + melt authority (+ possible change)
      expect(createTokenTx.tokens).toHaveLength(0); // Token creation has this array empty
      expect(createTokenTx.parents).toHaveLength(2); // Should have exactly 2 parents
      expect(createTokenTx.timestamp).toBeGreaterThan(0); // Should have a valid timestamp
      expect(createTokenTx.name).toBe(tokenName);
      expect(createTokenTx.symbol).toBe(tokenSymbol);

      // Validate specific output types and their addresses
      let tokenOutput: Output;
      let mintAuthorityOutput: Output;
      let meltAuthorityOutput: Output;

      createTokenTx.outputs.forEach(output => {
        if (output.tokenData === 1) {
          // Token amount output
          tokenOutput = output;
        } else if (output.tokenData === 129) {
          // Authority output (tokenData 129 = 128 + 1, where 128 is AUTHORITY_TOKEN_DATA and 1 is mint mask)
          if (output.value === TOKEN_MINT_MASK) {
            mintAuthorityOutput = output;
          } else if (output.value === TOKEN_MELT_MASK) {
            meltAuthorityOutput = output;
          }
        }
      });

      // Validate token amount output
      // @ts-expect-error - tokenOutput must exist
      expect(tokenOutput).toStrictEqual(
        expect.objectContaining({
          value: tokenAmount,
          tokenData: 1,
          script: expect.any(Buffer),
        })
      );

      // Validate mint authority output
      // @ts-expect-error - mintAuthorityOutput must exist
      expect(mintAuthorityOutput).toStrictEqual(
        expect.objectContaining({
          value: 1n, // TOKEN_MINT_MASK
          tokenData: 129, // AUTHORITY_TOKEN_DATA + token_data
          script: expect.any(Buffer),
        })
      );

      // Validate melt authority output
      // @ts-expect-error - meltAuthorityOutput must exist
      expect(meltAuthorityOutput).toStrictEqual(
        expect.objectContaining({
          value: 2n, // TOKEN_MELT_MASK
          tokenData: 129, // AUTHORITY_TOKEN_DATA + token_data
          script: expect.any(Buffer),
        })
      );

      // Verify the transaction can be found after creation
      const externalWalletTokenUid = createTokenTx.hash!;
      await poolForTx(wallet, externalWalletTokenUid);

      // Since outputs went to external addresses, we need to use the original wallet to query
      // but note that the wallet service might not be able to query external UTXOs directly
      // So we'll validate the transaction structure instead of individual UTXO queries

      // Validate that the transaction has the expected structure for external addresses
      let tokenOutputIndex = -1;
      let mintAuthorityOutputIndex = -1;
      let meltAuthorityOutputIndex = -1;

      createTokenTx.outputs.forEach((output, index) => {
        if (output.tokenData === 1) {
          tokenOutputIndex = index;
        } else if (output.tokenData === 129) {
          if (output.value === TOKEN_MINT_MASK) {
            mintAuthorityOutputIndex = index;
          } else if (output.value === TOKEN_MELT_MASK) {
            meltAuthorityOutputIndex = index;
          }
        }
      });

      // Verify that all expected output indices were found
      expect(tokenOutputIndex).toBeGreaterThanOrEqual(0);
      expect(mintAuthorityOutputIndex).toBeGreaterThanOrEqual(0);
      expect(meltAuthorityOutputIndex).toBeGreaterThanOrEqual(0);

      // Since the outputs went to external addresses, we validate the transaction was created
      // but the external wallet would need to be started to see the UTXOs

      // Specific token creation validations
      const tokenDetails = await wallet.getTokenDetails(externalWalletTokenUid);
      expect(tokenDetails.tokenInfo).toStrictEqual(
        expect.objectContaining({
          id: externalWalletTokenUid,
          name: tokenName,
          symbol: tokenSymbol,
        })
      );
      expect(tokenDetails.totalSupply).toBe(tokenAmount);
      expect(tokenDetails.totalTransactions).toBe(1);
      expect(tokenDetails.authorities?.mint).toBe(true);
      expect(tokenDetails.authorities?.melt).toBe(true);

      // Additional validation: Verify that the creating wallet doesn't own the token outputs
      // since they were sent to external addresses
      const creatorBalance = await wallet.getBalance(externalWalletTokenUid);
      expect(creatorBalance).toHaveLength(0); // Creator should have no balance or auth for the new token

      const { wallet: destinationWallet } = buildWalletInstance({
        words: multipleTokensWallet.words,
      });
      await destinationWallet.start({ pinCode, password });
      const destBalance = await destinationWallet.getBalance(externalWalletTokenUid);
      expect(destBalance).toHaveLength(1);
      expect(destBalance[0].balance.unlocked).toBe(tokenAmount);
      expect(destBalance[0].tokenAuthorities.unlocked.mint).toBe(true);
      expect(destBalance[0].tokenAuthorities.unlocked.melt).toBe(true);
    });
  });
});

describe('websocket events', () => {

  beforeEach(async () => {
    ({ wallet } = buildWalletInstance({ enableWs: true, words: walletWithTxs.words }));
    await wallet.start({ pinCode, password });
  });

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
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

    const sendTransaction = await sendFundTx(walletWithTxs.addresses[0], 10n);
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
      const htrBalance = balances.find(b => b.token.id === NATIVE_TOKEN_UID);
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
      const htrBalance = balances.find(b => b.token.id === NATIVE_TOKEN_UID);
      expect(htrBalance).toBeDefined();
      expect(typeof htrBalance?.balance).toBe('object');

      await walletTxs.stop({ cleanStorage: true });
    });

    // FIXME: The test does not return balance for empty wallet. It should return 0 for the native token
    it('should return balance for specific token when token parameter is provided', async () => {
      const balances = await wallet.getBalance(NATIVE_TOKEN_UID); // HTR token

      expect(Array.isArray(balances)).toBe(true);
      // When requesting specific token, should return that token's balance
      expect(balances.length).toStrictEqual(1);
      expect(balances[0]).toEqual(
        expect.objectContaining({
          token: expect.objectContaining({
            id: NATIVE_TOKEN_UID,
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

      // TODO: Improve the error assertion validation
      await expect(wallet.getAddressDetails(unknownAddress)).rejects.toThrow();
    });
  });
});
