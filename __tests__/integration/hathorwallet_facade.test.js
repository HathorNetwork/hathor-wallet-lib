import { multisigWalletsData, precalculationHelpers } from './helpers/wallet-precalculation.helper';
import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay, getRandomInt } from './utils/core.util';
import {
  createTokenHelper,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  generateMultisigWalletHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
  waitUntilNextTimestamp
} from './helpers/wallet.helper';
import HathorWallet from '../../src/new/wallet';
import { HATHOR_TOKEN_CONFIG, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import { NETWORK_NAME, TOKEN_DATA, WALLET_CONSTANTS } from './configuration/test-constants';
import dateFormatter from '../../src/utils/date';
import { loggers } from './utils/logger.util';
import { TxNotFoundError, SendTxError, WalletFromXPubGuard } from '../../src/errors';
import SendTransaction from '../../src/new/sendTransaction';
import walletUtils from '../../src/utils/wallet';
import { ConnectionState } from '../../src/wallet/types';
import transaction from '../../src/utils/transaction';
import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import { P2PKH_ACCT_PATH } from '../../src/constants';
import Network from '../../src/models/network';
import { WalletType } from '../../src/types';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';
const sampleNftData = 'ipfs://bafybeiccfclkdtucu6y4yc5cpr6y3yuinr67svmii46v5cfcrkp47ihehy/albums/QXBvbGxvIDEwIE1hZ2F6aW5lIDI3L04=/21716695748_7390815218_o.jpg';

describe('getTxById', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should return tx token balance', async () => {
    const hWallet = await generateWalletHelper();

    // Expect to have an empty list for the full history
    expect(Object.keys(hWallet.getFullHistory())).toHaveLength(0);

    // Injecting some funds on this wallet
    const fundDestinationAddress = await hWallet.getAddressAtIndex(0);
    const tx1 = await GenesisWalletHelper.injectFunds(fundDestinationAddress, 10);
    await delay(1000);
    // Validating the full history increased in one
    expect(Object.keys(await hWallet.getFullHistory())).toHaveLength(1);

    /**
     * @example
     * {
     *   "success": true,
     *   "txTokens": [
     *     {
     *       "balance": 10,
     *       "timestamp": 1675195819,
     *       "tokenId": "00",
     *       "tokenName": "Hathor",
     *       "tokenSymbol": "HTR",
     *       "txId": "00b1e296631984a43b81d2abc50d992335a78719e5684612510a9b61f0805646",
     *       "version": 1,
     *       "voided": false,
     *       "weight": 8.000001,
     *     },
     *   ],
     * }
     */
    const result = await hWallet.getTxById(tx1.hash);
    expect(result.success).toStrictEqual(true);
    expect(result.txTokens).toHaveLength(1);

    const firstTokenDetails = result.txTokens[0];
    const tokenDetailsKeys = Object.keys(firstTokenDetails);
    expect(tokenDetailsKeys.join(',')).toStrictEqual(
      'txId,timestamp,version,voided,weight,tokenId,tokenName,tokenSymbol,balance',
    );

    expect(firstTokenDetails.txId).toStrictEqual(tx1.hash);
    expect(firstTokenDetails.timestamp).toBeGreaterThan(0);
    expect(firstTokenDetails.version).toStrictEqual(1);
    expect(firstTokenDetails.voided).toStrictEqual(false);
    expect(firstTokenDetails.weight).toBeGreaterThan(0);
    expect(firstTokenDetails.tokenId).toStrictEqual('00');
    expect(firstTokenDetails.tokenName).toStrictEqual('Hathor');
    expect(firstTokenDetails.tokenSymbol).toStrictEqual('HTR');
    expect(firstTokenDetails.balance).toStrictEqual(10);

    // throw error if token uid not found in tokens list
    jest.spyOn(hWallet, 'getFullTxById').mockResolvedValue({
      success: true,
      tx: {
        ...tx1,
        // impossible token_data
        inputs: [{ ...tx1.inputs[0], token_data: -1 }],
      },
    });
    await expect(hWallet.getTxById(tx1.hash)).rejects.toThrowError('Token undefined not found in tokens list');
    jest.spyOn(hWallet, 'getFullTxById').mockRestore();

    // thorw error if token not found in tx
    jest.spyOn(hWallet, 'getTxBalance').mockResolvedValue({
      'unknown-token': 10,
    });
    await expect(hWallet.getTxById(tx1.hash)).rejects.toThrowError('Token unknown-token not found in tx');
    jest.spyOn(hWallet, 'getTxBalance').mockRestore();
  });

  it('should throw an error tx id is invalid', async () => {
    const hWallet = await generateWalletHelper();
    await expect(hWallet.getTxById('invalid-tx-hash')).rejects.toThrowError('Invalid transaction invalid-tx-hash');
  });

  it('should get the balance for a custom token', async () => {
    const hWallet = await generateWalletHelper();

    // Test case: non-existent token
    const emptyBalance = await hWallet.getBalance(fakeTokenUid);
    // Assert that only one balance is returned
    expect(emptyBalance).toHaveLength(1);
    // Assert the balance is zero
    expect(emptyBalance[0]).toMatchObject({
      token: { id: fakeTokenUid },
      balance: { unlocked: 0, locked: 0 },
      transactions: 0,
    });

    // Test case: custom token with funds
    const address = await hWallet.getAddressAtIndex(0);
    // Inject 10 HTR into the wallet
    await GenesisWalletHelper.injectFunds(address, 10);
    // Generate a random amount of new tokens
    const newTokenAmount = getRandomInt(1000, 10);
    // Create a new custom token with the generated amount
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'BalanceToken',
      'BAT',
      newTokenAmount,
    );
    // Get the balance of the new token
    await delay(1000);
    const tknBalance = await hWallet.getBalance(tokenUid);
    // Assert that only one balance is returned
    expect(tknBalance).toHaveLength(1);
    // Assert the balance is equal to the amount generated
    expect(tknBalance[0]).toMatchObject({
      token: { id: tokenUid },
      balance: { unlocked: newTokenAmount, locked: 0 },
      transactions: expect.any(Number),
      /**
       * TODO: The amount of transactions is often 8 but should be 1. Ref #397
       * @see https://github.com/HathorNetwork/hathor-wallet-lib/issues/397
       */
      // transactions: 1, 
    });
    // Get balance for the token creation transaction
    const result = await hWallet.getTxById(tokenUid);
    expect(result.success).toStrictEqual(true);
    expect(result.txTokens).toHaveLength(2);
    expect(result.txTokens).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tokenId: HATHOR_TOKEN_CONFIG.uid,
        balance: expect.any(Number),
      }),
      expect.objectContaining({
        tokenId: tokenUid,
        balance: newTokenAmount,
      }),
    ]));

    // Test case: non-accessible token for another wallet (genesis)
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    const genesisTknBalance = await gWallet.getBalance(tokenUid);
    expect(genesisTknBalance).toHaveLength(1);
    expect(genesisTknBalance[0]).toMatchObject({
      token: { id: tokenUid },
      balance: { unlocked: 0, locked: 0 },
      transactions: 0,
    });
  });
});

describe('start', () => {
  it('should reject with invalid parameters', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const connection = generateConnection();

    /*
     * Invalid parameters on constructing the object
     */
    expect(() => new HathorWallet()).toThrow('provide a connection');

    expect(() => new HathorWallet({
      seed: walletData.words,
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
    })).toThrow('provide a connection');

    expect(() => new HathorWallet({
      connection,
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
    })).toThrow('seed');

    expect(() => new HathorWallet({
      seed: walletData.words,
      xpriv: 'abc123',
      connection,
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
    })).toThrow('seed and an xpriv');

    expect(() => new HathorWallet({
      xpriv: 'abc123',
      connection,
      passphrase: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
    })).toThrow('xpriv with passphrase');

    expect(() => new HathorWallet({
      seed: walletData.words,
      connection: { state: ConnectionState.CONNECTED } ,
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
    })).toThrow('share connections');

    expect(() => new HathorWallet({
      seed: walletData.words,
      connection,
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      multisig: {}
    })).toThrow('pubkeys and numSignatures');

    expect(() => new HathorWallet({
      seed: walletData.words,
      connection,
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      multisig: { pubkeys: ['abc'], numSignatures: 2 }
    })).toThrow('configuration invalid');

    /*
     * Invalid parameters on starting the wallet
     */

    // A common wallet without a pin code
    let walletConfig = {
      seed: walletData.words,
      connection,
      password: DEFAULT_PASSWORD,
      preCalculatedAddresses: walletData.addresses,
    };
    let hWallet = new HathorWallet(walletConfig);
    await expect(hWallet.start()).rejects.toThrow('Pin');

    // A common wallet without password
    walletConfig = {
      seed: walletData.words,
      connection,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: walletData.addresses,
    }
    hWallet = new HathorWallet(walletConfig);
    await expect(hWallet.start()).rejects.toThrow('Password');
  });

  it('should start a wallet with no history', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: walletData.addresses,
    };
    const hWallet = new HathorWallet(walletConfig);
    await hWallet.start();

    // Validating that the wallet detects it's not ready
    expect(hWallet.isReady()).toStrictEqual(false);
    await waitForWalletReady(hWallet);
    expect(hWallet.isReady()).toStrictEqual(true);

    // Validate that it has no transactions
    const txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(0);

    // Validate that the addresses are the same as the pre-calculated that were informed
    for (const [addressIndex, precalcAddress] of walletData.addresses.entries()) {
      // const precalcAddress = walletData.addresses[+addressIndex];
      const addressAtIndex = await hWallet.getAddressAtIndex(+addressIndex);
      expect(precalcAddress).toEqual(addressAtIndex);
    }
    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should start a wallet with a transaction history', async () => {
    // Send a transaction to one of the wallet's addresses
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const injectAddress = walletData.addresses[0];
    const injectValue = getRandomInt(10, 1);
    const injectionTx = await GenesisWalletHelper.injectFunds(injectAddress, injectValue);

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: walletData.addresses,
    };
    const hWallet = new HathorWallet(walletConfig);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    // Validate that it has transactions
    const txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(1);
    expect(txHistory[0].txId).toEqual(injectionTx.hash);
    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should calculate the wallet\'s addresses on start', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      /*
       * No precalculated addresses here. All will be calculated at runtime.
       * This operation takes a lot longer under jest's testing framework, so we avoid it
       * on most tests.
       */
    };
    const hWallet = new HathorWallet(walletConfig);
    hWallet.storage.setGapLimit(100); // load more addresses than preCalculated
    await hWallet.start();
    await waitForWalletReady(hWallet);

    // Validate that the addresses are the same as the pre-calculated ones
    for (const addressIndex in walletData.addresses) {
      const precalcAddress = walletData.addresses[+addressIndex];
      const addressAtIndex = await hWallet.getAddressAtIndex(+addressIndex);
      expect(precalcAddress).toEqual(addressAtIndex);
    }
    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should start a multisig wallet', async () => {
    // Start the wallet without precalculated addresses
    const walletConfig = {
      seed: multisigWalletsData.words[0],
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      multisig: {
        pubkeys: multisigWalletsData.pubkeys,
        numSignatures: 3,
      },
    };

    const hWallet = new HathorWallet(walletConfig);
    /*
     * The interaction between the jest infrastructure with the address derivation calculations
     * somehow make this process very costly and slow, especially for multisig.
     * Here we lower the gap limit to make this test shorter.
     */
    hWallet.storage.setGapLimit(5);
    await hWallet.start();

    // Validating that all the booting processes worked
    await waitForWalletReady(hWallet);

    // Validate that the addresses are the same as the pre-calculated that we have
    for (let i = 0; i < 5; ++i) {
      const precalcAddress = WALLET_CONSTANTS.multisig.addresses[i];
      const addressAtIndex = await hWallet.getAddressAtIndex(i);
      expect(precalcAddress).toStrictEqual(addressAtIndex);
    }

    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should start a wallet to manage a specific token', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();

    // Creating a new wallet with a known set of words just to generate the custom token
    let hWallet = await generateWalletHelper({
      seed: walletData.words,
      preCalculatedAddresses: walletData.addresses,
    });
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 2);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Dedicated Wallet Token',
      'DWT',
      100
    );

    await delay(1000);
    // Stopping this wallet and destroying its memory state
    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
    hWallet = null;

    // Starting a new wallet re-using the same words, this time with a specific wallet token
    hWallet = await generateWalletHelper({
      seed: walletData.words,
      preCalculatedAddresses: walletData.addresses,
      tokenUid,
    });
    expect(hWallet.isReady()).toStrictEqual(true); // This operation should work

    // Now testing the methods that use this set tokenUid information
    // FIXME: No need to explicitly pass the non-boolean `false` as a tokenUid to get this result.
    expect(await hWallet.getBalance(false)).toStrictEqual([
      {
        token: {
          id: tokenUid,
          name: "Dedicated Wallet Token",
          symbol: "DWT"
        },
        balance: {
          unlocked: 100,
          locked: 0
        },
        transactions: 1,
        lockExpires: null,
        tokenAuthorities: {
          unlocked: {
            mint: 1,
            melt: 1
          },
          locked: {
            mint: 0,
            melt: 0
          }
        }
      }
    ]);

    // FIXME: We should not have to explicitly pass an empty token uid to get this result
    const txHistory1 = await hWallet.getTxHistory({ token_id: undefined });
    expect(txHistory1).toStrictEqual([
      expect.objectContaining({
        txId: tokenUid,
      }),
    ]);

    /*
     * These tests could be created inside the `getBalance` and `getTxHistory` sections but for
     * simplicity sake, since they are so small, were added here just as a complement to
     * this `start` test.
     */
  });

  it('should start a wallet via xpub', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const code = new Mnemonic(walletData.words);
    const rootXpriv = code.toHDPrivateKey('', new Network('privatenet'));
    const xpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    const xpub = xpriv.xpubkey;

    // Creating a new wallet with a known set of words just to generate the custom token
    const hWallet = await generateWalletHelper({
      xpub,
      password: null,
      pinCode: null,
    });
    expect(hWallet.isReady()).toStrictEqual(true);

    // Validating that methods that require the private key will throw on call
    await expect(hWallet.consolidateUtxos()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.sendTransaction()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.sendManyOutputsTransaction()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.prepareCreateNewToken()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.prepareMintTokensData()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.prepareMeltTokensData()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.prepareDelegateAuthorityData()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.prepareDestroyAuthorityData()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.getAllSignatures()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.getSignatures()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.signTx()).rejects.toThrow(WalletFromXPubGuard);

    // Validating that the address generation works as intended
    for (let i=0; i < 20; ++i) {
      expect(await hWallet.getAddressAtIndex(i))
        .toStrictEqual(walletData.addresses[i]);
    }

    // Validating balance and utxo methods
    await expect(hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid)).resolves.toStrictEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: HATHOR_TOKEN_CONFIG.uid }),
        balance: { unlocked: 0, locked: 0 },
        transactions: 0,
      }),
    ]);
    await expect(hWallet.getUtxos()).resolves.toHaveProperty('total_utxos_available', 0);

    // Generating a transaction and validating it shows correctly
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(1), 1);
    await delay(1000);

    await expect(hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid)).resolves.toMatchObject([
      expect.objectContaining({
        token: expect.objectContaining({ id: HATHOR_TOKEN_CONFIG.uid }),
        balance: { unlocked: 1, locked: 0 },
        transactions: expect.any(Number),
      }),
    ]);
    await expect(hWallet.getUtxos()).resolves.toHaveProperty('total_utxos_available', 1);
  })

  it('should start a wallet without pin', async () => {
    // Generating the wallet
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const hWallet = await generateWalletHelper({
      seed: walletData.words,
      preCalculatedAddresses: walletData.addresses,
      pinCode: DEFAULT_PIN_CODE
    });

    // Adding funds to it
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    /*
     * XXX: The code branches that require a PIN would not be achievable without this hack that
     * manually removes the pin from the wallet.
     * In order to increase the test coverage we will add this procedure here
     */
    hWallet.pinCode = null;

    // XXX: This is the only method that resolves instead of rejects. Check the standard here.
    await expect(hWallet.sendManyOutputsTransaction([
      { address: await hWallet.getAddressAtIndex(1), value: 1 }
    ])).rejects.toThrowError('Pin');

    await expect(hWallet.createNewToken(
      'Pinless Token',
      'PTT',
      100
    )).rejects.toThrowError('Pin');

    await expect(hWallet.mintTokens(
      fakeTokenUid,
      100
    )).rejects.toThrowError('Pin');

    await expect(hWallet.meltTokens(
      fakeTokenUid,
      100
    )).rejects.toThrow('Pin');

    await expect(hWallet.delegateAuthority(
      fakeTokenUid,
      'mint',
      await hWallet.getAddressAtIndex(1)))
      .rejects.toThrow('Pin');

    await expect(hWallet.destroyAuthority(
      fakeTokenUid,
      'mint',
      1))
      .rejects.toThrow('Pin');

    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });
});

describe('addresses methods', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get the correct current/next addresses', async () => {
    // Creating a wallet
    const hWallet = await generateWalletHelper();
    // Initializing the getAllAddresses generator
    const addressGenerator = hWallet.getAllAddresses();

    // Validating getAddressAtIndex and getAllAddresses methods
    for (let i = 0; i < 23; ++i) {
      // Validating generator results
      const genResults = await addressGenerator.next();
      expect(genResults).toMatchObject({
        done: expect.any(Boolean),
      });

      // Validating gap limit
      if (i === 22) {
        expect(genResults).toStrictEqual({
          done: true,
          value: undefined,
        });
        break;
      }

      // Validating generator contents
      const addressAtIndex = await hWallet.getAddressAtIndex(i);
      expect(genResults.value).toStrictEqual({
        index: i,
        address: addressAtIndex,
        transactions: 0,
      });
    }

    // Validating currentAddress behavior
    let currentAddress = await hWallet.getCurrentAddress();
    expect(currentAddress).toMatchObject({
      index: 0,
      address: await hWallet.getAddressAtIndex(0),
    });
    // Expect no change on second call
    currentAddress = await hWallet.getCurrentAddress();
    expect(currentAddress).toMatchObject({
      index: 0,
      address: await hWallet.getAddressAtIndex(0),
    });
    // Expect the same address for the last time when calling with markAsUsed parameters
    currentAddress = await hWallet.getCurrentAddress({ markAsUsed: true });
    expect(currentAddress).toMatchObject({
      index: 0,
      address: await hWallet.getAddressAtIndex(0),
    });
    // Now it won't return the used one
    currentAddress = await hWallet.getCurrentAddress();
    expect(currentAddress).toMatchObject({
      index: 1,
      address: await hWallet.getAddressAtIndex(1),
    });

    // Validating getNextAddress behavior
    let nextAddress = await hWallet.getNextAddress();
    expect(nextAddress).toMatchObject({
      index: 2,
      address: await hWallet.getAddressAtIndex(2),
    });
    // Expecting the next address index
    nextAddress = await hWallet.getNextAddress();
    expect(nextAddress).toMatchObject({
      index: 3,
      address: await hWallet.getAddressAtIndex(3),
    });

    // Expect the "current address" to change when a transaction arrives at the current one
    currentAddress = await hWallet.getCurrentAddress();
    await GenesisWalletHelper.injectFunds(currentAddress.address, 1);
    await new Promise(resolve => setTimeout(resolve, 100));
    const currentAfterTx = await hWallet.getCurrentAddress();
    expect(currentAfterTx).toMatchObject({
      index: currentAddress.index + 1,
      address: await hWallet.getAddressAtIndex(currentAddress.index + 1),
    });
  });

  it('should get correct addresses for a multisig wallet', async () => {
    const mshWallet = await generateMultisigWalletHelper({ walletIndex: 0 });

    // We will assume the wallet never received txs, which is to be expected for the addresses test
    expect((await mshWallet.getCurrentAddress()).address).toStrictEqual(WALLET_CONSTANTS.multisig.addresses[0]);

    for (let i=0; i < 21; ++i) {
      expect(await mshWallet.getAddressAtIndex(i))
        .toStrictEqual(WALLET_CONSTANTS.multisig.addresses[i]);
    }
  })
});

describe('getBalance', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get the balance for the HTR token', async () => {
    const hWallet = await generateWalletHelper();

    // Validating that the token uid parameter is mandatory.
    await expect(hWallet.getBalance()).rejects.toThrow();

    // Validating the return array has one entry on an empty wallet
    const balance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(balance).toHaveLength(1);
    expect(balance[0]).toMatchObject({
      token: { id: HATHOR_TOKEN_CONFIG.uid },
      balance: { unlocked: 0, locked: 0 },
      transactions: 0,
    });

    // Generating one transaction to validate its effects
    const injectedValue = getRandomInt(10, 2);
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), injectedValue);

    // Validating the transaction effects
    const balance1 = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(balance1[0]).toMatchObject({
      balance: { unlocked: injectedValue, locked: 0 },
      transactions: expect.any(Number),
      // transactions: 1, // TODO: The amount of transactions is often 2 but should be 1. Ref #397
    });

    // Transferring tokens inside the wallet should not change the balance
    const tx1 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(1), 2);
    await waitForTxReceived(hWallet, tx1.hash);
    const balance2 = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(balance2[0].balance).toEqual(balance1[0].balance);
  });

  it('should get the balance for a custom token', async () => {
    const hWallet = await generateWalletHelper();

    // Validating results for a nonexistant token
    const emptyBalance = await hWallet.getBalance(fakeTokenUid);
    expect(emptyBalance).toHaveLength(1);
    expect(emptyBalance[0]).toMatchObject({
      token: { id: fakeTokenUid },
      balance: { unlocked: 0, locked: 0 },
      transactions: 0,
    });

    // Creating a new custom token
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    const newTokenAmount = getRandomInt(1000, 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'BalanceToken',
      'BAT',
      newTokenAmount,
    );

    const tknBalance = await hWallet.getBalance(tokenUid);
    expect(tknBalance[0]).toMatchObject({
      balance: { unlocked: newTokenAmount, locked: 0 },
      transactions: expect.any(Number),
      // transactions: 1, // TODO: The amount of transactions is often 8 but should be 1. Ref #397
    });

    // Validating that a different wallet (genesis) has no access to this token
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    const genesisTknBalance = await gWallet.getBalance(tokenUid);
    expect(genesisTknBalance).toHaveLength(1);
    expect(genesisTknBalance[0]).toMatchObject({
      token: { id: tokenUid },
      balance: { unlocked: 0, locked: 0 },
      transactions: 0,
    });
  });
});

describe('getFullHistory', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should return full history (htr)', async () => {
    const hWallet = await generateWalletHelper();

    // Expect to have an empty list for the full history
    await expect(hWallet.storage.store.historyCount()).resolves.toEqual(0);

    // Injecting some funds on this wallet
    const fundDestinationAddress = await hWallet.getAddressAtIndex(0);
    const { hash: fundTxId } = await GenesisWalletHelper.injectFunds(fundDestinationAddress, 10);

    // Validating the full history increased in one
    await expect(hWallet.storage.store.historyCount()).resolves.toEqual(1);

    // Moving the funds inside this wallet so that we have every information about the tx
    const txDestinationAddress = await hWallet.getAddressAtIndex(5);
    const txChangeAddress = await hWallet.getAddressAtIndex(8);
    const txValue = 6;
    const rawMoveTx = await hWallet.sendTransaction(
      txDestinationAddress,
      txValue,
      { changeAddress: txChangeAddress }
    );
    await waitForTxReceived(hWallet, rawMoveTx.hash);

    const history = await hWallet.getFullHistory();
    expect(Object.keys(history)).toHaveLength(2);
    expect(history).toHaveProperty(rawMoveTx.hash);
    const moveTx = history[rawMoveTx.hash];

    // Validating transactions properties were correctly translated
    expect(moveTx).toMatchObject({
      tx_id: rawMoveTx.hash,
      version: rawMoveTx.version,
      weight: rawMoveTx.weight,
      timestamp: rawMoveTx.timestamp,
      is_voided: false,
      parents: rawMoveTx.parents,
    });

    // Validating inputs
    expect(moveTx.inputs).toHaveLength(rawMoveTx.inputs.length);
    for (const inputIndex in moveTx.inputs) {
      expect(moveTx.inputs[inputIndex]).toMatchObject({
        // Translated attributes are correct
        index: rawMoveTx.inputs[inputIndex].index,
        tx_id: rawMoveTx.inputs[inputIndex].hash,

        // Decoded attributes are correct
        token: HATHOR_TOKEN_CONFIG.uid,
        token_data: TOKEN_DATA.HTR,
        script: expect.any(String),
        value: 10,
        decoded: { type: 'P2PKH', address: fundDestinationAddress }
      });
    }

    // Validating outputs
    expect(moveTx.outputs).toHaveLength(rawMoveTx.outputs.length);
    for (const outputIndex in moveTx.outputs) {
      const outputObj = moveTx.outputs[outputIndex];

      expect(outputObj).toMatchObject({
        // Translated attributes are correct
        value: rawMoveTx.outputs[outputIndex].value,
        token_data: rawMoveTx.outputs[outputIndex].tokenData,

        // Decoded attributes are correct
        token: HATHOR_TOKEN_CONFIG.uid,
        script: expect.any(String),
        decoded: {
          type: 'P2PKH',
          address: outputObj.value === txValue
            ? txDestinationAddress
            : txChangeAddress,
        },
        spent_by: null,
      });
    }

    // Validating that the fundTx now has its output spent by moveTx
    const fundTx = history[fundTxId];
    const spentOutput = fundTx.outputs.find(o => o.decoded.address === fundDestinationAddress);
    expect(spentOutput.spent_by).toEqual(moveTx.tx_id);
  });

  it('should return full history (custom token)', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(
      await hWallet.getAddressAtIndex(0),
      10
    );
    const tokenName = 'Full History Token';
    const tokenSymbol = 'FHT';
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      tokenName,
      tokenSymbol,
      100
    );

    const history = await hWallet.getFullHistory();
    expect(Object.keys(history)).toHaveLength(2);

    // Validating create token properties ( all others have been validated on the previous test )
    expect(history).toHaveProperty(tokenUid);
    const createTx = history[tokenUid];

    // Validating basic token creation properties
    expect(createTx).toMatchObject({
      token_name: tokenName,
      token_symbol: tokenSymbol,
      inputs: [{
        token: HATHOR_TOKEN_CONFIG.uid,
        token_data: TOKEN_DATA.HTR,
        value: 10,
      }]
    });

    // Validating outputs
    expect(createTx.outputs).toHaveLength(4);
    const changeOutput = createTx.outputs.find(o => o.value === 9);
    expect(changeOutput).toMatchObject({
      token: HATHOR_TOKEN_CONFIG.uid,
      token_data: TOKEN_DATA.HTR,
    });

    const tokenOutput = createTx.outputs.find(o => o.value === 100);
    expect(tokenOutput).toMatchObject({
      token: tokenUid,
      token_data: TOKEN_DATA.TOKEN,
    });

    const mintOutput = createTx.outputs.find(o => {
      const isAuthority = transaction.isAuthorityOutput(o);
      const isMint = o.value === TOKEN_MINT_MASK;
      return isAuthority && isMint;
    });
    expect(mintOutput).toBeDefined();
    expect(mintOutput.token).toEqual(tokenUid);

    const meltOutput = createTx.outputs.find(o => {
      const isAuthority = transaction.isAuthorityOutput(o);
      const isMelt = o.value === TOKEN_MELT_MASK;
      return isAuthority && isMelt;
    });
    expect(meltOutput).toBeDefined();
    expect(meltOutput.token).toEqual(tokenUid);
  });
});

describe('getTxBalance', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get tx balance', async () => {
    const hWallet = await generateWalletHelper();
    const { hash: tx1Hash } = await GenesisWalletHelper.injectFunds(
      await hWallet.getAddressAtIndex(0),
      10
    );

    // Validating tx balance for a transaction with a single token (htr)
    const tx1 = await hWallet.getTx(tx1Hash);
    let txBalance = await hWallet.getTxBalance(tx1);
    expect(txBalance).toEqual({
      [HATHOR_TOKEN_CONFIG.uid]: 10
    });

    // Validating tx balance for a transaction with two tokens (htr+custom)
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'txBalance Token',
      'TXBT',
      100
    );
    const tokenCreationTx = await hWallet.getTx(tokenUid);
    txBalance = await hWallet.getTxBalance(tokenCreationTx);
    expect(txBalance).toEqual({
      [tokenUid]: 100,
      [HATHOR_TOKEN_CONFIG.uid]: -1,
    });

    // Validating that the option to include authority tokens does not change the balance
    txBalance = await hWallet.getTxBalance(tokenCreationTx, { includeAuthorities: true });
    expect(txBalance).toEqual({
      [tokenUid]: 100,
      [HATHOR_TOKEN_CONFIG.uid]: -1,
    });

    // Validating delegate token transaction behavior
    const { hash: delegateTxHash } = await hWallet.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet.getAddressAtIndex(0)
    );

    // By default this tx will not have a balance
    await waitForTxReceived(hWallet, delegateTxHash);
    const delegateTx = await hWallet.getTx(delegateTxHash);
    txBalance = await hWallet.getTxBalance(delegateTx);
    expect(Object.keys(txBalance)).toHaveLength(1);
    // When the "includeAuthorities" parameter is added, the balance should be zero
    txBalance = await hWallet.getTxBalance(delegateTx, { includeAuthorities: true });
    expect(Object.keys(txBalance)).toHaveLength(1);
    expect(txBalance).toHaveProperty(tokenUid, 0);

    // Validating that transactions inside a wallet have zero txBalance
    await waitUntilNextTimestamp(hWallet, delegateTxHash);
    const { hash: sameWalletTxHash } = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: await hWallet.getAddressAtIndex(0),
          value: 5,
          token: HATHOR_TOKEN_CONFIG.uid
        },
        {
          address: await hWallet.getAddressAtIndex(1),
          value: 50,
          token: tokenUid
        },
      ]
    );
    await waitForTxReceived(hWallet, sameWalletTxHash);

    const sameWalletTx = await hWallet.getTx(sameWalletTxHash);
    txBalance = await hWallet.getTxBalance(sameWalletTx);
    expect(Object.keys(txBalance)).toHaveLength(2);
    expect(txBalance[HATHOR_TOKEN_CONFIG.uid]).toEqual(0);
    expect(txBalance).toHaveProperty(tokenUid, 0);
  });
});

describe('getFullTxById', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  it('should download an existing transaction from the fullnode', async () => {
    const hWallet = await generateWalletHelper();

    const tx1 = await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    const fullTx = await hWallet.getFullTxById(tx1.hash);
    expect(fullTx.success).toStrictEqual(true);

    const fullTxKeys = Object.keys(fullTx);
    expect(fullTxKeys).toContain('meta');
    expect(fullTxKeys).toContain('tx');
    expect(fullTxKeys).toContain('success');
    expect(fullTxKeys).toContain('spent_outputs');
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.getFullTxById('invalid-tx-hash')).rejects.toThrowError(`Invalid transaction invalid-tx-hash`);
  });

  it('should throw an error on valid but not found transaction', async () => {
    await expect(gWallet.getFullTxById('0011371a7c07f7e8017c52c0a4f5293ccf30c865d96255d1b515f96f7a6a6299')).rejects.toThrowError(TxNotFoundError);
  });
});

describe('getTxConfirmationData', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  it('should download confirmation data for an existing transaction from the fullnode', async () => {
    const hWallet = await generateWalletHelper();

    const tx1 = await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    const confirmationData = await hWallet.getTxConfirmationData(tx1.hash);

    expect(confirmationData.success).toStrictEqual(true);

    const confirmationDataKeys = Object.keys(confirmationData);
    expect(confirmationDataKeys).toContain('accumulated_bigger');
    expect(confirmationDataKeys).toContain('accumulated_weight');
    expect(confirmationDataKeys).toContain('confirmation_level');
    expect(confirmationDataKeys).toContain('success');
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.getTxConfirmationData('invalid-tx-hash')).rejects.toThrowError(`Invalid transaction invalid-tx-hash`);
  });

  it('should throw TxNotFoundError on valid hash but not found transaction', async () => {
    await expect(gWallet.getTxConfirmationData('000000000bc8c6fab1b3a5af184cc0e7ff7934c6ad982c8bea9ab5006ae1bafc')).rejects.toThrowError(TxNotFoundError);
  });
});

describe('graphvizNeighborsQuery', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  it('should download graphviz neighbors data for a existing transaction from the fullnode', async () => {
    const hWallet = await generateWalletHelper();
    const tx1 = await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    const neighborsData = await hWallet.graphvizNeighborsQuery(tx1.hash, 'funds', 1);

    expect(neighborsData).toMatch(/digraph {/);
  });

  it('should capture errors when graphviz returns error', async () => {
    const hWallet = await generateWalletHelper();
    const tx1 = await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    await expect(hWallet.graphvizNeighborsQuery(tx1.hash)).rejects.toThrowError('Request failed with status code 500');
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.graphvizNeighborsQuery('invalid-tx-hash')).rejects.toThrowError(`Invalid transaction invalid-tx-hash`);
  });

  it('should throw TxNotFoundError on valid but not found transaction', async () => {
    await expect(gWallet.graphvizNeighborsQuery('000000000bc8c6fab1b3a5af184cc0e7ff7934c6ad982c8bea9ab5006ae1bafc')).rejects.toThrowError(TxNotFoundError);
  });
});

describe('sendTransaction', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should send HTR transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    // Sending a transaction inside the same wallet
    const tx1 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(2), 6);

    // Validating all fields
    await waitForTxReceived(hWallet, tx1.hash);
    expect(tx1).toMatchObject({
      hash: expect.any(String),
      inputs: expect.any(Array),
      outputs: expect.any(Array),
      version: expect.any(Number),
      weight: expect.any(Number),
      nonce: expect.any(Number),
      timestamp: expect.any(Number),
      parents: expect.any(Array),
      tokens: expect.any(Array)
    });

    // Validating balance stays the same for internal transactions
    let htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.unlocked).toEqual(10);

    // Validating the correct addresses received the tokens
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(0))).toHaveProperty('numTransactions', 2);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(1))).toHaveProperty('numTransactions', 1);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(2))).toHaveProperty('numTransactions', 1);

    // Sending a transaction to outside the wallet ( returning funds to genesis )
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    await waitUntilNextTimestamp(hWallet, tx1.hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      await gWallet.getAddressAtIndex(0),
      8,
      { changeAddress: await hWallet.getAddressAtIndex(5) }
    );
    await waitForTxReceived(hWallet, tx2Hash);

    // Balance was reduced
    htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.unlocked).toEqual(2);

    // Change was moved to correct address
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(0))).toHaveProperty('numTransactions', 2);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(1))).toHaveProperty('numTransactions', 2);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(2))).toHaveProperty('numTransactions', 2);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(3))).toHaveProperty('numTransactions', 0);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(4))).toHaveProperty('numTransactions', 0);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(5))).toHaveProperty('numTransactions', 1);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(6))).toHaveProperty('numTransactions', 0);
  });

  it('should send custom token transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Send',
      'TTS',
      100
    );

    const tx1 = await hWallet.sendTransaction(
      await hWallet.getAddressAtIndex(5),
      30,
      {
        token: tokenUid,
        changeAddress: await hWallet.getAddressAtIndex(6)
      }
    );
    await waitForTxReceived(hWallet, tx1.hash);

    // Validating balance stays the same for internal transactions
    let htrBalance = await hWallet.getBalance(tokenUid);
    expect(htrBalance[0].balance.unlocked).toEqual(100);

    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(5))).toHaveProperty('numTransactions', 1);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(6))).toHaveProperty('numTransactions', 1);

    // Transaction outside the wallet
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    await waitUntilNextTimestamp(hWallet, tx1.hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      await gWallet.getAddressAtIndex(0),
      80,
      {
        token: tokenUid,
        changeAddress: await hWallet.getAddressAtIndex(12)
      }
    );
    await waitForTxReceived(hWallet, tx2Hash);

    // Balance was reduced
    htrBalance = await hWallet.getBalance(tokenUid);
    expect(htrBalance[0].balance.unlocked).toEqual(20);

    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(5))).toHaveProperty('numTransactions', 2);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(6))).toHaveProperty('numTransactions', 2);
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(12))).toHaveProperty('numTransactions', 1);
  });

  it('should send a multisig transaction', async () => {
    // Initialize 3 wallets from the same multisig and inject funds in them to test
    const mhWallet1 = await generateMultisigWalletHelper({ walletIndex: 0 });
    const mhWallet2 = await generateMultisigWalletHelper({ walletIndex: 1 });
    const mhWallet3 = await generateMultisigWalletHelper({ walletIndex: 2 });
    await GenesisWalletHelper.injectFunds(await mhWallet1.getAddressAtIndex(0), 10);

    /*
     * Under heavy test processing this transaction takes longer than usual to be assimilated by the
     * HathorWallet. Here we increase this tolerance to increase the success rate of this test.
     */
    await delay(1000);

    /*
     * Building tx proposal:
     * 1) Identify the UTXO
     * 2) Build the outputs
     */
    const { tx_id: inputTxId, index: inputIndex } = (await mhWallet1.getUtxos()).utxos[0];
    const network = mhWallet1.getNetworkObject();
    const sendTransaction = new SendTransaction(
      {
        storage: mhWallet1.storage,
        inputs: [
          { txId: inputTxId, index: inputIndex }
        ],
        outputs: [
          { address: await mhWallet1.getAddressAtIndex(1), value: 10, token: HATHOR_TOKEN_CONFIG.uid }
        ],
      }
    );
    const tx = transaction.createTransactionFromData(
      { version: 1, ...(await sendTransaction.prepareTxData()) },
      network
    );
    const txHex = tx.toHex();

    // Getting signatures for the proposal
    const sig1 = await mhWallet1.getAllSignatures(txHex, DEFAULT_PIN_CODE);
    const sig2 = await mhWallet2.getAllSignatures(txHex, DEFAULT_PIN_CODE);
    const sig3 = await mhWallet3.getAllSignatures(txHex, DEFAULT_PIN_CODE);

    // Delay to avoid the same timestamp as the fundTx
    await waitUntilNextTimestamp(mhWallet1, inputTxId);

    // Sign and push
    const partiallyAssembledTx = await mhWallet1.assemblePartialTransaction(
      txHex,
      [sig1, sig2, sig3]
    );
    partiallyAssembledTx.prepareToSend();
    const finalTx = new SendTransaction(
      { storage: mhWallet1.storage, transaction: partiallyAssembledTx },
    );

    /** @type BaseTransactionResponse */
    const sentTx = await finalTx.runFromMining();
    expect(sentTx).toHaveProperty('hash');
    await waitForTxReceived(mhWallet1, sentTx.hash, 10000); // Multisig transactions take longer

    const historyTx = await mhWallet1.getTx(sentTx.hash);
    expect(historyTx).toMatchObject({
      tx_id: partiallyAssembledTx.hash,
      inputs: [expect.objectContaining({
        tx_id: inputTxId,
        value: 10,
      })]
    });
  });
});

describe('sendManyOutputsTransaction', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should send simple HTR transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 100);

    // Single input and single output
    const rawSimpleTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: await hWallet.getAddressAtIndex(2),
          value: 100,
          token: HATHOR_TOKEN_CONFIG.uid
        },
      ],
    );
    expect(rawSimpleTx).toHaveProperty('hash');
    await waitForTxReceived(hWallet, rawSimpleTx.hash);
    const decodedSimple = await hWallet.getTx(rawSimpleTx.hash);
    expect(decodedSimple.inputs).toHaveLength(1);
    expect(decodedSimple.outputs).toHaveLength(1);

    // Single input and two outputs
    await waitUntilNextTimestamp(hWallet, rawSimpleTx.hash);
    const rawDoubleOutputTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: await hWallet.getAddressAtIndex(5),
          value: 60,
          token: HATHOR_TOKEN_CONFIG.uid
        },
        {
          address: await hWallet.getAddressAtIndex(6),
          value: 40,
          token: HATHOR_TOKEN_CONFIG.uid
        },
      ],
    );
    await waitForTxReceived(hWallet, rawDoubleOutputTx.hash);
    const decodedDoubleOutput = await hWallet.getTx(rawDoubleOutputTx.hash);
    expect(decodedDoubleOutput.inputs).toHaveLength(1);
    expect(decodedDoubleOutput.outputs).toHaveLength(2);
    const largerOutputIndex = decodedDoubleOutput.outputs.findIndex(o => o.value === 60);

    // Explicit input and three outputs
    await waitUntilNextTimestamp(hWallet, rawDoubleOutputTx.hash);
    const rawExplicitInputTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: await hWallet.getAddressAtIndex(1),
          value: 5,
          token: HATHOR_TOKEN_CONFIG.uid
        },
        {
          address: await hWallet.getAddressAtIndex(2),
          value: 35,
          token: HATHOR_TOKEN_CONFIG.uid
        },
      ],
      {
        inputs: [{
          txId: decodedDoubleOutput.tx_id,
          token: HATHOR_TOKEN_CONFIG.uid,
          index: largerOutputIndex
        }]
      }
    );
    await waitForTxReceived(hWallet, rawExplicitInputTx.hash);
    const explicitInput = await hWallet.getTx(rawExplicitInputTx.hash);
    expect(explicitInput.inputs).toHaveLength(1);
    expect(explicitInput.outputs).toHaveLength(3);

    // Expect our explicit outputs and an automatic one to complete the 60 HTR input
    expect(explicitInput.outputs).toContainEqual(expect.objectContaining({ value: 5 }));
    expect(explicitInput.outputs).toContainEqual(expect.objectContaining({ value: 35 }));
    // Validate change output
    expect(explicitInput.outputs).toContainEqual(expect.objectContaining({ value: 20 }));
  });

  it('should send transactions with multiple tokens', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Multiple Tokens Tk',
      'MTTK',
      200
    );

    // Generating tx
    const rawSendTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          token: tokenUid,
          value: 110,
          address: await hWallet.getAddressAtIndex(1)
        },
        {
          token: HATHOR_TOKEN_CONFIG.uid,
          value: 5,
          address: await hWallet.getAddressAtIndex(2)
        },
      ]
    );
    await waitForTxReceived(hWallet, rawSendTx.hash);

    // Validating amount of inputs and outputs
    const sendTx = await hWallet.getTx(rawSendTx.hash);
    expect(sendTx.inputs).toHaveLength(2);
    expect(sendTx.outputs).toHaveLength(4);

    // Validating that each of the outputs has the values we expect
    expect(sendTx.outputs).toContainEqual(expect.objectContaining({
      value: 3,
      token: HATHOR_TOKEN_CONFIG.uid,
    }));
    expect(sendTx.outputs).toContainEqual(expect.objectContaining({
      value: 5,
      token: HATHOR_TOKEN_CONFIG.uid,
    }));
    expect(sendTx.outputs).toContainEqual(expect.objectContaining({
      value: 90,
      token: tokenUid,
    }));
    expect(sendTx.outputs).toContainEqual(expect.objectContaining({
      value: 110,
      token: tokenUid,
    }));

    // Validating that each of the inputs has the values we expect
    expect(sendTx.inputs).toContainEqual(expect.objectContaining({
      value: 8,
      token: HATHOR_TOKEN_CONFIG.uid,
    }));
    expect(sendTx.inputs).toContainEqual(expect.objectContaining({
      value: 200,
      token: tokenUid,
    }));
  });

  it('should respect timelocks', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    // Defining timelocks (milliseconds) and timestamps (seconds)
    const startTime = Date.now().valueOf();
    const timelock1 = startTime + 5000; // 5 seconds of locked resources
    const timelock2 = startTime + 8000; // 8 seconds of locked resources
    const timelock1Timestamp = dateFormatter.dateToTimestamp(new Date(timelock1));
    const timelock2Timestamp = dateFormatter.dateToTimestamp(new Date(timelock2));

    const rawTimelockTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: await hWallet.getAddressAtIndex(1),
          value: 7,
          token: HATHOR_TOKEN_CONFIG.uid,
          timelock: timelock1Timestamp,
        },
        {
          address: await hWallet.getAddressAtIndex(1),
          value: 3,
          token: HATHOR_TOKEN_CONFIG.uid,
          timelock: timelock2Timestamp,
        }
      ],
    );
    await waitForTxReceived(hWallet, rawTimelockTx.hash);

    // Validating the transaction with getFullHistory / getTx
    const timelockTx = await hWallet.getTx(rawTimelockTx.hash);
    expect(timelockTx.outputs.find(o => o.decoded.timelock === timelock1Timestamp)).toBeDefined();
    expect(timelockTx.outputs.find(o => o.decoded.timelock === timelock2Timestamp)).toBeDefined();

    // Validating getBalance ( moment 0 )
    let htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance).toStrictEqual({ locked: 10, unlocked: 0 });

    // Validating interfaces with only a partial lock of the resources
    const waitFor1 = timelock1 - Date.now().valueOf() + 1000;
    loggers.test.log(`Will wait for ${waitFor1}ms for timelock1 to expire`);
    await delay(waitFor1);

    /*
     * The locked/unlocked balances are usually updated when new transactions arrive.
     * We will force this update here without a new tx, for testing purposes.
     */
    await hWallet.storage.processHistory();

    // Validating getBalance ( moment 1 )
    htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance).toEqual({ locked: 3, unlocked: 7 });

    // Confirm that the balance is unavailable
    await expect(hWallet.sendTransaction(await hWallet.getAddressAtIndex(3), 8))
      .rejects.toThrow('Insufficient');
    // XXX: Error message should show the token identification, not "Token undefined"

    // Validating interfaces with all resources unlocked
    const waitFor2 = timelock2 - Date.now().valueOf() + 1000;
    loggers.test.log(`Will wait for ${waitFor2}ms for timelock2 to expire`);
    await delay(waitFor2);

    // Forcing balance updates
    await hWallet.storage.processHistory();

    // Validating getBalance ( moment 2 )
    htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance).toStrictEqual({ locked: 0, unlocked: 10 });

    // Confirm that now the balance is available
    const sendTx = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(4), 8);
    expect(sendTx).toHaveProperty('hash');
  });
});

describe('createNewToken', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should create a new token', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(addr0, 10);

    // Creating the new token
    const newTokenResponse = await hWallet.createNewToken(
      'TokenName',
      'TKN',
      100,
    );

    // Validating the creation tx
    expect(newTokenResponse).toMatchObject({
      hash: expect.any(String),
      name: 'TokenName',
      symbol: 'TKN',
      version: 2,
    });
    const tokenUid = newTokenResponse.hash;

    // Validating wallet balance is updated with this new token
    await waitForTxReceived(hWallet, tokenUid);
    const tknBalance = await hWallet.getBalance(tokenUid);
    expect(tknBalance[0].balance.unlocked).toBe(100);
  });

  it('should create a new token on the correct addresses', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(addr0, 10);

    // Creating the new token
    const destinationAddress = await hWallet.getAddressAtIndex(4);
    const changeAddress = await hWallet.getAddressAtIndex(8);
    const { hash: tokenUid } = await hWallet.createNewToken(
      'NewToken Name',
      'NTKN',
      100,
      {
        address: destinationAddress,
        changeAddress
      }
    );
    await waitForTxReceived(hWallet, tokenUid);
    await delay(500);
    // Validating the tokens are on the correct addresses
    const { utxos: utxosTokens } = await hWallet.getUtxos({ token: tokenUid });
    expect(utxosTokens).toContainEqual(
      expect.objectContaining({ address: destinationAddress, amount: 100 })
    );

    const { utxos: utxosHtr } = await hWallet.getUtxos();
    expect(utxosHtr).toContainEqual(
      expect.objectContaining({ address: changeAddress, amount: 9 })
    );
  });

  it('should create a new token without mint/melt authorities', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(addr0, 1);

    // Creating the new token
    const newTokenResponse = await hWallet.createNewToken(
      'Immutable Token',
      'ITKN',
      100,
      { createMint: false, createMelt: false }
    );

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');

    // Checking for authority outputs on the transaction
    const authorityOutputs = newTokenResponse.outputs.filter(o => transaction.isAuthorityOutput(o));
    expect(authorityOutputs).toHaveLength(0);
  });

  it('Create token using mint/melt address', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr10 = await hWallet.getAddressAtIndex(10);
    const addr11 = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(addr0, 1);

    // Creating the new token
    const newTokenResponse = await hWallet.createNewToken(
      'New Token',
      'NTKN',
      100,
      {
        createMint: true,
        mintAuthorityAddress: addr10,
        createMelt: true,
        meltAuthorityAddress: addr11,
      }
    );

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, newTokenResponse.hash);

    // Validating a new mint authority was created by default
    const authorityOutputs = newTokenResponse.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs).toHaveLength(2);
    const mintOutput = authorityOutputs.filter(
      o => o.value === TOKEN_MINT_MASK
    );
    const mintP2pkh = mintOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the mint output was sent to the correct address
    expect(mintP2pkh.address.base58).toEqual(addr10);

    const meltOutput = authorityOutputs.filter(
      o => o.value === TOKEN_MELT_MASK
    );
    const meltP2pkh = meltOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the melt output was sent to the correct address
    expect(meltP2pkh.address.base58).toEqual(addr11);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(newTokenResponse.hash);
    const expectedAmount = 100;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });

  it('Create token using external mint/melt address', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const hWallet2 = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr2_0 = await hWallet2.getAddressAtIndex(0);
    const addr2_1 = await hWallet2.getAddressAtIndex(1);
    await GenesisWalletHelper.injectFunds(addr0, 1);

    // Error creating token with external address
    await expect(hWallet.createNewToken(
      'New Token',
      'NTKN',
      100,
      {
        createMint: true,
        mintAuthorityAddress: addr2_0,
      }
    )).rejects.toThrow('must belong to your wallet');

    await expect(hWallet.createNewToken(
      'New Token',
      'NTKN',
      100,
      {
        createMelt: true,
        meltAuthorityAddress: addr2_1,
      }
    )).rejects.toThrow('must belong to your wallet');

    // Creating the new token allowing external address
    const newTokenResponse = await hWallet.createNewToken(
      'New Token',
      'NTKN',
      100,
      {
        createMint: true,
        mintAuthorityAddress: addr2_0,
        allowExternalMintAuthorityAddress: true,
        createMelt: true,
        meltAuthorityAddress: addr2_1,
        allowExternalMeltAuthorityAddress: true,
      }
    );

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, newTokenResponse.hash);

    // Validating a new mint authority was created by default
    const authorityOutputs = newTokenResponse.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs).toHaveLength(2);
    const mintOutput = authorityOutputs.filter(
      o => o.value === TOKEN_MINT_MASK
    );
    const mintP2pkh = mintOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the mint output was sent to the correct address
    expect(mintP2pkh.address.base58).toEqual(addr2_0);

    const meltOutput = authorityOutputs.filter(
      o => o.value === TOKEN_MELT_MASK
    );
    const meltP2pkh = meltOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the melt output was sent to the correct address
    expect(meltP2pkh.address.base58).toEqual(addr2_1);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(newTokenResponse.hash);
    const expectedAmount = 100;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });
});

describe('mintTokens', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should mint new tokens', async () => {
    // Setting up the custom token
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Mint',
      'TMINT',
      100,
    );

    // Should not mint more tokens than the HTR funds allow
    await expect(hWallet.mintTokens(tokenUid, 9000))
      .rejects.toThrow('HTR tokens');

    // Minting more of the tokens
    const mintAmount = getRandomInt(100, 50);
    const mintResponse = await hWallet.mintTokens(tokenUid, mintAmount);
    expect(mintResponse.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse).toHaveProperty('tokens.length', 1);
    expect(mintResponse.tokens[0]).toEqual(tokenUid);

    // Validating a new mint authority was created by default
    const authorityOutputs = mintResponse.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs).toHaveLength(1);
    expect(authorityOutputs[0]).toHaveProperty('value', TOKEN_MINT_MASK);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(tokenUid);
    const expectedAmount = 100 + mintAmount;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);

    // Mint tokens with defined mint authority address
    const address0 = await hWallet.getAddressAtIndex(0);

    const mintResponse2 = await hWallet.mintTokens(tokenUid, 100, { mintAuthorityAddress: address0 });
    expect(mintResponse2.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse2.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse2).toHaveProperty('tokens.length', 1);
    expect(mintResponse2.tokens[0]).toEqual(tokenUid);

    // Validating a new mint authority was created by default
    const authorityOutputs2 = mintResponse2.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs2).toHaveLength(1);
    const authorityOutput = authorityOutputs2[0];
    expect(authorityOutput.value).toEqual(TOKEN_MINT_MASK);
    const p2pkh = authorityOutput.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p2pkh.address.base58).toEqual(address0);

    // Validating custom token balance
    const tokenBalance2 = await hWallet.getBalance(tokenUid);
    const expectedAmount2 = expectedAmount + 100;
    expect(tokenBalance2[0]).toHaveProperty('balance.unlocked', expectedAmount2);

    // Mint tokens with external address should return error by default
    const hWallet2 = await generateWalletHelper();
    const externalAddress = await hWallet2.getAddressAtIndex(0);

    await expect(hWallet.mintTokens(tokenUid, 100, { mintAuthorityAddress: externalAddress }))
      .rejects.toThrow('must belong to your wallet');

    // Mint tokens with external address but allowing it
    const mintResponse4 = await hWallet.mintTokens(tokenUid, 100, {
      mintAuthorityAddress: externalAddress,
      allowExternalMintAuthorityAddress: true
    });
    expect(mintResponse4.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse4.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse4).toHaveProperty('tokens.length', 1);
    expect(mintResponse4.tokens[0]).toEqual(tokenUid);

    // Validating a new mint authority was created by default
    const authorityOutputs4 = mintResponse4.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs4).toHaveLength(1);
    const authorityOutput4 = authorityOutputs4[0];
    expect(authorityOutput4.value).toEqual(TOKEN_MINT_MASK);
    const p4pkh = authorityOutput4.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p4pkh.address.base58).toEqual(externalAddress);

    // Validating custom token balance
    const tokenBalance4 = await hWallet.getBalance(tokenUid);
    const expectedAmount4 = expectedAmount2 + 100;
    expect(tokenBalance4[0]).toHaveProperty('balance.unlocked', expectedAmount4);
  });

  it('should deposit correct HTR values for minting', async () => {
    /**
     *
     * @param {HathorWallet} hWallet
     * @returns {Promise<number>}
     */
    async function getHtrBalance(hWallet) {
      const [htrBalance] = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
      return htrBalance.balance.unlocked;
    }

    // Setting up scenario
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Mint',
      'TMINT',
      100,
    );
    let expectedHtrFunds = 9;

    // Minting less than 1.00 tokens consumes 0.01 HTR
    let mintResponse;
    mintResponse = await hWallet.mintTokens(tokenUid, 1);
    expectedHtrFunds -= 1;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting exactly 1.00 tokens consumes 0.01 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 100);
    expectedHtrFunds -= 1;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting between 1.00 and 2.00 tokens consumes 0.02 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 101);
    expectedHtrFunds -= 2;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting exactly 2.00 tokens consumes 0.02 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 200);
    expectedHtrFunds -= 2;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting between 2.00 and 3.00 tokens consumes 0.03 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 201);
    expectedHtrFunds -= 3;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);
  });
});

describe('meltTokens', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should melt tokens', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    // Creating the token
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Melt',
      'TMELT',
      300,
    );

    // Should not melt more than there is available
    await expect(hWallet.meltTokens(tokenUid, 999))
      .rejects.toThrow('Not enough tokens to melt');

    // Melting some tokens
    const meltAmount = getRandomInt(99, 10);
    const { hash } = await hWallet.meltTokens(tokenUid, meltAmount);
    await waitForTxReceived(hWallet, hash);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(tokenUid);
    const expectedAmount = 300 - meltAmount;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);

    // Melt tokens with defined melt authority address
    const address0 = await hWallet.getAddressAtIndex(0);
    const meltResponse = await hWallet.meltTokens(tokenUid, 100, { meltAuthorityAddress: address0 });
    await waitForTxReceived(hWallet, meltResponse.hash);

    // Validating a new melt authority was created by default
    const authorityOutputs = meltResponse.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs).toHaveLength(1);
    const authorityOutput = authorityOutputs[0];
    expect(authorityOutput.value).toEqual(TOKEN_MELT_MASK);
    const p2pkh = authorityOutput.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p2pkh.address.base58).toEqual(address0);

    // Validating custom token balance
    const tokenBalance2 = await hWallet.getBalance(tokenUid);
    const expectedAmount2 = expectedAmount - 100;
    expect(tokenBalance2[0]).toHaveProperty('balance.unlocked', expectedAmount2);

    // Melt tokens with external address should return error
    const hWallet2 = await generateWalletHelper();
    const externalAddress = await hWallet2.getAddressAtIndex(0);

    await expect(hWallet.meltTokens(tokenUid, 100, { meltAuthorityAddress: externalAddress }))
      .rejects.toThrow('must belong to your wallet');

    // Melt tokens with external address but allowing it
    const meltResponse3 = await hWallet.meltTokens(tokenUid, 100, {
      meltAuthorityAddress: externalAddress,
      allowExternalMeltAuthorityAddress: true
    });
    await waitForTxReceived(hWallet, meltResponse3.hash);

    // Validating a new melt authority was created by default
    const authorityOutputs3 = meltResponse3.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs3).toHaveLength(1);
    const authorityOutput3 = authorityOutputs3[0];
    expect(authorityOutput3.value).toEqual(TOKEN_MELT_MASK);
    const p3pkh = authorityOutput3.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p3pkh.address.base58).toEqual(externalAddress);

    // Validating custom token balance
    const tokenBalance3 = await hWallet.getBalance(tokenUid);
    const expectedAmount3 = expectedAmount2 - 100;
    expect(tokenBalance3[0]).toHaveProperty('balance.unlocked', expectedAmount3);
  });

  it('should recover correct amount of HTR on melting', async () => {
    /**
     *
     * @param {HathorWallet} hWallet
     * @returns {Promise<number>}
     */
    async function getHtrBalance(hWallet) {
      const [htrBalance] = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
      return htrBalance.balance.unlocked;
    }

    // Setting up scenario
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 20);
    await delay(500);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Melt',
      'TMELT',
      1900
    );
    let expectedHtrFunds = 1;

    let meltResponse;
    // Melting less than 1.00 tokens recovers 0 HTR
    meltResponse = await hWallet.meltTokens(tokenUid, 99);
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting exactly 1.00 tokens recovers 0.01 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 100);
    expectedHtrFunds += 1;
    await waitForTxReceived(hWallet, meltResponse.hash);
    await delay(100);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting between 1.00 and 2.00 tokens recovers 0.01 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 199);
    expectedHtrFunds += 1;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting exactly 2.00 tokens recovers 0.02 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 200);
    expectedHtrFunds += 2;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting between 2.00 and 3.00 tokens recovers 0.02 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 299);
    expectedHtrFunds += 2;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);
  });
});

describe('delegateAuthority', () => {
  /*
   * Since these tests need two wallets and the authority tokens are independent from token to token
   * we can reuse the wallets themselves and only do the build/cleanup operations once.
   */

  let hWallet1;
  let hWallet2;

  beforeAll(async () => {
    hWallet1 = await generateWalletHelper();
    hWallet2 = await generateWalletHelper();
  });

  afterAll(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should delegate authority between wallets', async () => {
    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(await hWallet1.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet1,
      'Delegate Token',
      'DTK',
      100,
    );

    // Should handle trying to delegate without the authority
    await expect(hWallet1.delegateAuthority(fakeTokenUid, 'mint', await hWallet2.getAddressAtIndex(0)))
      .rejects.toThrow();

    // Delegating mint authority to wallet 2
    const { hash: delegateMintTxId } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet2.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet1, delegateMintTxId);

    /*
     * XXX: Authority Token delegation usually takes longer than usual to be reflected on the local
     * caches. This forced recalculation will be executed before each authority validation below
     * to avoid a small possibility of the caches being obsolete at assertion time.
     */
    await delay(100);
    await hWallet1.storage.processHistory();

    // Expect wallet 1 to still have one mint authority
    let authorities1 = await hWallet1.getMintAuthority(tokenUid);
    expect(authorities1).toHaveLength(1);
    expect(authorities1[0]).toMatchObject({
      txId: delegateMintTxId,
      authorities: TOKEN_MINT_MASK
    });
    // Expect wallet 2 to also have one mint authority
    await hWallet2.storage.processHistory();
    let authorities2 = await hWallet2.getMintAuthority(tokenUid);
    expect(authorities2).toHaveLength(1);
    expect(authorities2[0]).toMatchObject({
      txId: delegateMintTxId,
      authorities: TOKEN_MINT_MASK
    });

    // Delegating melt authority to wallet 2
    await waitUntilNextTimestamp(hWallet1, delegateMintTxId);
    const { hash: delegateMeltTxId } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet2.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet1, delegateMeltTxId);

    // Expect wallet 1 to still have one melt authority
    await hWallet1.storage.processHistory();
    authorities1 = await hWallet1.getMeltAuthority(tokenUid);
    expect(authorities1).toHaveLength(1);
    expect(authorities1[0]).toMatchObject({
      txId: delegateMeltTxId,
      authorities: TOKEN_MELT_MASK
    });
    // Expect wallet 2 to also have one melt authority
    await hWallet2.storage.processHistory();
    authorities2 = await hWallet2.getMeltAuthority(tokenUid);
    expect(authorities2).toHaveLength(1);
    expect(authorities2[0]).toMatchObject({
      txId: delegateMeltTxId,
      authorities: TOKEN_MELT_MASK
    });
  });

  it('should delegate authority to another wallet without keeping one', async () => {
    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(await hWallet1.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet1,
      'Delegate Token',
      'DTK',
      100,
    );

    // Delegate mint authority without keeping one on wallet 1
    const { hash: giveAwayMintTx } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet2.getAddressAtIndex(0),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, giveAwayMintTx);

    // Validating error on mint tokens from Wallet 1
    await waitUntilNextTimestamp(hWallet1, giveAwayMintTx);
    await expect(hWallet1.mintTokens(tokenUid, 100)).rejects.toThrow();
    // TODO: The type of errors on mint and melt are different. They should have a standard.

    // Validating success on mint tokens from Wallet 2
    await GenesisWalletHelper.injectFunds(await hWallet2.getAddressAtIndex(0), 10);
    const mintTxWallet2 = await hWallet2.mintTokens(tokenUid, 100);
    expect(mintTxWallet2).toHaveProperty('hash');

    // Delegate melt authority without keeping one on wallet 1
    const { hash: giveAwayMeltTx } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet2.getAddressAtIndex(0),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, giveAwayMeltTx);

    // Validating error on mint tokens from Wallet 1
    await waitUntilNextTimestamp(hWallet1, giveAwayMeltTx);
    await expect(hWallet1.meltTokens(tokenUid, 100)).rejects.toThrow('authority output');

    // Validating success on melt tokens from Wallet 2
    await expect(hWallet2.meltTokens(tokenUid, 50)).resolves.toHaveProperty('hash');
  });

  it('should delegate mint authority to another wallet while keeping one', async () => {
    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(await hWallet1.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet1,
      'Delegate Token 2',
      'DTK2',
      100,
    );

    // Creating another mint authority token on the same wallet
    const { hash: duplicateMintAuth } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet1.getAddressAtIndex(1),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet1, duplicateMintAuth);

    // Confirming two authority tokens on wallet1
    let auth1 = await hWallet1.getMintAuthority(tokenUid, { many: true });
    expect(auth1).toMatchObject([
      {
        txId: duplicateMintAuth,
        index: 0,
        address: await hWallet1.getAddressAtIndex(1),
        authorities: TOKEN_MINT_MASK
      },
      {
        txId: duplicateMintAuth,
        index: 1,
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK
      },
    ]);

    // Now having two mint authority tokens on wallet 1, delegate a single one to wallet 2
    const { hash: delegateMintAuth } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet2.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, delegateMintAuth);

    // Confirming only one authority token was sent from wallet1 to wallet2
    auth1 = await hWallet1.getMintAuthority(tokenUid, { many: true });
    expect(auth1).toMatchObject([
      {
        txId: duplicateMintAuth,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK
      },
    ]);

    // Confirming one authority token was received by wallet2
    const auth2 = await hWallet2.getMintAuthority(tokenUid, { many: true });
    expect(auth2).toMatchObject([
      {
        txId: delegateMintAuth,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK
      },
    ]);
  });

  it('should delegate melt authority to another wallet while keeping one', async () => {
    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(await hWallet1.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet1,
      'Delegate Token 2',
      'DTK2',
      100,
    );

    // Creating another melt authority token on the same wallet
    const { hash: duplicateMeltAuth } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet1.getAddressAtIndex(1),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet1, duplicateMeltAuth);

    // Confirming two authority tokens on wallet1
    let auth1 = await hWallet1.getMeltAuthority(tokenUid, { many: true });
    expect(auth1).toMatchObject([
      {
        txId: duplicateMeltAuth,
        index: 0,
        address: await hWallet1.getAddressAtIndex(1),
        authorities: TOKEN_MELT_MASK,
      },
      {
        txId: duplicateMeltAuth,
        index: 1,
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      },
    ]);

    // Now having two melt authority tokens on wallet 1, delegate a single one to wallet 2
    const { hash: delegateMintAuth } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet2.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, delegateMintAuth);

    // Confirming only one authority token was sent from wallet1 to wallet2
    auth1 = await hWallet1.getMeltAuthority(tokenUid, { many: true });
    expect(auth1).toMatchObject([
      {
        txId: duplicateMeltAuth,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      },
    ]);

    // Confirming one authority token was received by wallet2
    const auth2 = await hWallet2.getMeltAuthority(tokenUid, { many: true });
    expect(auth2).toMatchObject([
      {
        txId: delegateMintAuth,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      },
    ]);
  });
});

describe('destroyAuthority', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should destroy mint authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token for MintDestroy',
      'DMINT',
      100
    );

    // Adding another mint authority
    const { hash: newMintTx } = await hWallet.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet, newMintTx);

    // Validating though getMintAuthority
    let mintAuthorities = await hWallet.getMintAuthority(tokenUid, { many: true });
    expect(mintAuthorities).toHaveLength(2);

    // Trying to destroy more authorities than there are available
    await expect(hWallet.destroyAuthority(tokenUid, 'mint', 3))
      .rejects.toThrow('utxos-available');

    // Destroying one mint authority
    await waitUntilNextTimestamp(hWallet, newMintTx);
    const { hash: destroyMintTx } = await hWallet.destroyAuthority(tokenUid, 'mint', 1);
    await waitForTxReceived(hWallet, destroyMintTx);
    mintAuthorities = await hWallet.getMintAuthority(tokenUid, { many: true });
    expect(mintAuthorities).toHaveLength(1);

    // Destroying all mint authorities
    await waitUntilNextTimestamp(hWallet, destroyMintTx);
    const { hash: destroyAllMintTx } = await hWallet.destroyAuthority(tokenUid, 'mint', 1);
    await waitForTxReceived(hWallet, destroyAllMintTx);
    mintAuthorities = await hWallet.getMintAuthority(tokenUid, { many: true });
    expect(mintAuthorities).toHaveLength(0);

    // Trying to mint and validating its error object
    await waitUntilNextTimestamp(hWallet, destroyAllMintTx);
    await expect(hWallet.mintTokens(tokenUid, 100)).rejects.toThrow('authority output');
  });

  it('should destroy melt authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token for MeltDestroy',
      'DMELT',
      100
    );

    // Adding another melt authority
    const { hash: newMeltTx } = await hWallet.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet, newMeltTx);

    // Validating though getMeltAuthority
    let meltAuthorities = await hWallet.getMeltAuthority(tokenUid, { many: true });
    expect(meltAuthorities).toHaveLength(2);

    // Trying to destroy more authorities than there are available
    await expect(hWallet.destroyAuthority(tokenUid, 'melt', 3))
      .rejects.toThrow('utxos-available');

    // Destroying one melt authority
    await waitUntilNextTimestamp(hWallet, newMeltTx);
    const { hash: destroyMeltTx } = await hWallet.destroyAuthority(tokenUid, 'melt', 1);
    await waitForTxReceived(hWallet, destroyMeltTx);
    meltAuthorities = await hWallet.getMeltAuthority(tokenUid, { many: true });
    expect(meltAuthorities).toHaveLength(1);

    // Destroying all melt authorities
    await waitUntilNextTimestamp(hWallet, destroyMeltTx);
    const { hash: destroyAllMintTx } = await hWallet.destroyAuthority(tokenUid, 'melt', 1);
    await waitForTxReceived(hWallet, destroyAllMintTx);
    meltAuthorities = await hWallet.getMeltAuthority(tokenUid, { many: true });
    expect(meltAuthorities).toHaveLength(0);

    // Trying to melt and validating its error object
    await expect(hWallet.meltTokens(tokenUid, 100)).rejects.toThrow('authority output');
  });
});

describe('createNFT', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should create an NFT with mint/melt authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    // Creating one NFT with default authorities
    const nftTx = await hWallet.createNFT(
      'New NFT',
      'NNFT',
      1,
      sampleNftData,
      {
        createMint: true,
        createMelt: true
      },
    );
    expect(nftTx).toMatchObject({
      hash: expect.any(String),
      name: 'New NFT',
      symbol: 'NNFT',
    });
    await waitForTxReceived(hWallet, nftTx.hash);

    // Validating HTR fee payment
    const htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.unlocked).toEqual(8); // 1 deposit, 1 fee
    let nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(1);

    // Validating mint authority
    let mintAuth = await hWallet.getMintAuthority(nftTx.hash, { many: true });
    expect(mintAuth).toHaveLength(1);
    expect(mintAuth[0]).toHaveProperty('txId', nftTx.hash);

    // Minting new NFT tokens and not creating new authorities
    await waitUntilNextTimestamp(hWallet, nftTx.hash);
    const rawMintTx = await hWallet.mintTokens(
      nftTx.hash,
      10,
      { createAnotherMint: false }
    );
    expect(rawMintTx).toHaveProperty('hash');
    await waitForTxReceived(hWallet, rawMintTx.hash);
    nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(11);

    // There should be no mint authority anymore
    mintAuth = await hWallet.getMintAuthority(nftTx.hash, { many: true });
    expect(mintAuth).toHaveLength(0);

    // Validating melt authority
    let meltAuth = await hWallet.getMeltAuthority(nftTx.hash, { many: true });
    expect(meltAuth).toHaveLength(1);
    expect(meltAuth[0]).toHaveProperty('txId', nftTx.hash);

    // Melting NFT tokens and not creating new authorities
    await waitUntilNextTimestamp(hWallet, rawMintTx.hash);
    const htrMelt = await hWallet.meltTokens(
      nftTx.hash,
      5,
      { createAnotherMelt: false }
    );
    expect(htrMelt).toHaveProperty('hash');
    await waitForTxReceived(hWallet, htrMelt.hash);
    nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(6);

    // There should be no melt authority anymore
    meltAuth = await hWallet.getMeltAuthority(nftTx.hash, { many: true });
    expect(meltAuth).toHaveLength(0);
  });

  it('should create an NFT without authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    // Creating one NFT without authorities, and with a specific destination address
    const nftTx = await hWallet.createNFT(
      'New NFT 2',
      'NNFT2',
      1,
      sampleNftData,
      {
        createMint: false,
        createMelt: false,
        address: await hWallet.getAddressAtIndex(3),
        changeAddress: await hWallet.getAddressAtIndex(4),
      },
    );
    expect(nftTx.hash).toBeDefined();
    await waitForTxReceived(hWallet, nftTx.hash);

    // Checking for authority outputs on the transaction
    const authorityOutputs = nftTx.outputs.filter(o => transaction.isAuthorityOutput(o));
    expect(authorityOutputs).toHaveLength(0);

    // Checking for the destination address
    const fullTx = await hWallet.getTx(nftTx.hash);
    const nftOutput = fullTx.outputs.find(o => o.token === nftTx.hash);
    expect(nftOutput).toHaveProperty('decoded.address', await hWallet.getAddressAtIndex(3));
  });

  it('Create token using mint/melt address', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr10 = await hWallet.getAddressAtIndex(10);
    const addr11 = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(addr0, 10);

    // Creating the new token
    const newTokenResponse = await hWallet.createNFT(
      'New Token',
      'NTKN',
      100,
      sampleNftData,
      {
        createMint: true,
        mintAuthorityAddress: addr10,
        createMelt: true,
        meltAuthorityAddress: addr11,
      }
    );

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, newTokenResponse.hash);

    // Validating a new mint authority was created by default
    const authorityOutputs = newTokenResponse.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs).toHaveLength(2);
    const mintOutput = authorityOutputs.filter(
      o => o.value === TOKEN_MINT_MASK
    );
    const mintP2pkh = mintOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the mint output was sent to the correct address
    expect(mintP2pkh.address.base58).toEqual(addr10);

    const meltOutput = authorityOutputs.filter(
      o => o.value === TOKEN_MELT_MASK
    );
    const meltP2pkh = meltOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the melt output was sent to the correct address
    expect(meltP2pkh.address.base58).toEqual(addr11);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(newTokenResponse.hash);
    const expectedAmount = 100;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });

  it('Create token using external mint/melt address', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const hWallet2 = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr2_0 = await hWallet2.getAddressAtIndex(0);
    const addr2_1 = await hWallet2.getAddressAtIndex(1);
    await GenesisWalletHelper.injectFunds(addr0, 10);

    // Error creating token with external address
    await expect(hWallet.createNFT(
      'New Token',
      'NTKN',
      100,
      sampleNftData,
      {
        createMint: true,
        mintAuthorityAddress: addr2_0,
      }
    )).rejects.toThrow('must belong to your wallet');

    await expect(hWallet.createNFT(
      'New Token',
      'NTKN',
      100,
      sampleNftData,
      {
        createMelt: true,
        meltAuthorityAddress: addr2_1,
      }
    )).rejects.toThrow('must belong to your wallet');

    // Creating the new token allowing external address
    const newTokenResponse = await hWallet.createNFT(
      'New Token',
      'NTKN',
      100,
      sampleNftData,
      {
        createMint: true,
        mintAuthorityAddress: addr2_0,
        allowExternalMintAuthorityAddress: true,
        createMelt: true,
        meltAuthorityAddress: addr2_1,
        allowExternalMeltAuthorityAddress: true,
      }
    );

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, newTokenResponse.hash);

    // Validating a new mint authority was created by default
    const authorityOutputs = newTokenResponse.outputs.filter(
      o => transaction.isAuthorityOutput({token_data: o.tokenData})
    );
    expect(authorityOutputs).toHaveLength(2);
    const mintOutput = authorityOutputs.filter(
      o => o.value === TOKEN_MINT_MASK
    );
    const mintP2pkh = mintOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the mint output was sent to the correct address
    expect(mintP2pkh.address.base58).toEqual(addr2_0);

    const meltOutput = authorityOutputs.filter(
      o => o.value === TOKEN_MELT_MASK
    );
    const meltP2pkh = meltOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the melt output was sent to the correct address
    expect(meltP2pkh.address.base58).toEqual(addr2_1);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(newTokenResponse.hash);
    const expectedAmount = 100;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });
});

describe('getToken methods', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get the correct responses for a valid token', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    // Validating `getTokenDetails` for custom token not in this wallet
    await expect(hWallet.getTokenDetails(fakeTokenUid)).rejects.toThrow('Unknown token');

    // Validating `getTokens` for no custom tokens
    let getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toHaveLength(1);
    expect(getTokensResponse[0]).toEqual(HATHOR_TOKEN_CONFIG.uid);

    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Details Token',
      'DTOK',
      100
    );

    // Validating `getTokens` response for having custom tokens
    getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toStrictEqual([HATHOR_TOKEN_CONFIG.uid, tokenUid]);

    // Validate `getTokenDetails` response for a valid token
    let details = await hWallet.getTokenDetails(tokenUid);
    expect(details).toStrictEqual({
      totalSupply: 100,
      totalTransactions: 1,
      tokenInfo: { name: 'Details Token', symbol: 'DTOK' },
      authorities: { mint: true, melt: true }
    });

    // Emptying the custom token
    const { hash: meltTx } = await hWallet.meltTokens(tokenUid, 100);
    await waitForTxReceived(hWallet, meltTx);

    // Validating `getTokenDetails` response
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details).toMatchObject({
      totalSupply: 0,
      totalTransactions: 2,
      authorities: { mint: true, melt: true },
    });

    // Destroying mint authority and validating getTokenDetails results
    await waitUntilNextTimestamp(hWallet, meltTx);
    const { hash: dMintTx } = await hWallet.destroyAuthority(tokenUid, 'mint', 1);
    await waitForTxReceived(hWallet, dMintTx);
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details).toMatchObject({
      totalTransactions: 2,
      authorities: { mint: false, melt: true }
    });

    // Destroying melt authority and validating getTokenDetails results
    await waitUntilNextTimestamp(hWallet, dMintTx);
    const { hash: dMeltTx } = await hWallet.destroyAuthority(tokenUid, 'melt', 1);
    await waitForTxReceived(hWallet, dMeltTx);
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details).toMatchObject({
      totalTransactions: 2,
      authorities: { mint: false, melt: false },
    });

    // Validating `getTokens` response has not changed
    getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toStrictEqual([HATHOR_TOKEN_CONFIG.uid, tokenUid]);
  });
});

describe('signTx', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });


  it('should sign the transaction', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();

    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(addr0, 10);

    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Signatures token',
      'SIGT',
      100
    );

    const network = hWallet.getNetworkObject();
    // Build a Transaction to sign
    let sendTransaction = new SendTransaction(
      {
        storage: hWallet.storage,
        outputs: [
          { address: await hWallet.getAddressAtIndex(5), value: 5, token: HATHOR_TOKEN_CONFIG.uid },
          { address: await hWallet.getAddressAtIndex(6), value: 100, token: tokenUid },
        ],
      },
    );
    const txData = await sendTransaction.prepareTxData();
    const tx = transaction.createTransactionFromData(txData, network);
    tx.prepareToSend();

    // Sign transaction
    await hWallet.signTx(tx);
    sendTransaction = new SendTransaction({ storage: hWallet.storage, transaction: tx });
    const minedTx = await sendTransaction.runFromMining('mine-tx');
    expect(minedTx.nonce).toBeDefined();
    expect(minedTx.parents).not.toHaveLength(0);

    // Push transaction to test if fullnode will validate it.
    await sendTransaction.handlePushTx();
    await waitForTxReceived(hWallet, sendTransaction.transaction.hash);
  });
});

describe('getTxHistory', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  afterAll(async () => {
    await gWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should show htr transactions in correct order', async () => {
    const hWallet = await generateWalletHelper();

    let txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(0);

    // HTR transaction incoming
    const tx1 = await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);
    txHistory = await hWallet.getTxHistory();
    expect(txHistory).toStrictEqual([
      expect.objectContaining({
        txId: tx1.hash,
      })
    ]);

    // HTR internal transfer
    const tx2 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(1), 4);
    await waitForTxReceived(hWallet, tx2.hash);
    txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(2);

    // HTR external transfer
    await waitUntilNextTimestamp(hWallet, tx2.hash);
    const tx3 = await hWallet.sendTransaction(await gWallet.getAddressAtIndex(0), 3);
    await waitForTxReceived(hWallet, tx3.hash);
    txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(3);

    // Count option
    txHistory = await hWallet.getTxHistory({ count: 2 });
    expect(txHistory.length).toEqual(2);

    // Skip option
    txHistory = await hWallet.getTxHistory({ skip: 2 });
    expect(txHistory.length).toEqual(1);

    // Count + Skip options
    txHistory = await hWallet.getTxHistory({
      count: 2,
      skip: 1
    });
    expect(txHistory.length).toEqual(2);
  });

  it('should show custom token transactions in correct order', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 10);

    let txHistory = await hWallet.getTxHistory({
      token_id: fakeTokenUid,
    });
    expect(txHistory).toHaveLength(0);

    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'txHistory Token',
      'TXHT',
      100
    );

    // Custom token creation
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(1);
    expect(txHistory[0].txId).toEqual(tokenUid);

    // Custom token internal transfer
    const { hash: tx1Hash } = await hWallet.sendTransaction(
      await hWallet.getAddressAtIndex(0),
      10,
      { token: tokenUid }
    );
    await waitForTxReceived(hWallet, tx1Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(2);

    // Custom token external transfer
    await waitUntilNextTimestamp(hWallet, tx1Hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      await gWallet.getAddressAtIndex(0),
      10,
      { token: tokenUid }
    );
    await waitForTxReceived(hWallet, tx2Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(3);

    // Custom token melting
    await waitUntilNextTimestamp(hWallet, tx2Hash);
    const { hash: tx3Hash } = await hWallet.meltTokens(tokenUid, 20);
    await waitForTxReceived(hWallet, tx3Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(4);

    // Custom token minting
    await waitUntilNextTimestamp(hWallet, tx3Hash);
    const { hash: tx4Hash } = await hWallet.mintTokens(tokenUid, 30);
    await waitForTxReceived(hWallet, tx4Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(5);

    // Count option
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      count: 3
    });
    expect(txHistory.length).toEqual(3);

    // Skip option
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      skip: 3
    });
    expect(txHistory.length).toEqual(2);

    // Count + Skip options
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      skip: 2,
      count: 2
    });
    expect(txHistory.length).toEqual(2);
  });
});

describe('storage methods', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should configure the gap limit for the wallet', async () => {
    const hWallet = await generateWalletHelper();
    await hWallet.setGapLimit(100);
    await expect(hWallet.storage.getGapLimit()).resolves.toEqual(100);
    await expect(hWallet.getGapLimit()).resolves.toEqual(100);
    await hWallet.setGapLimit(11);
    await expect(hWallet.storage.getGapLimit()).resolves.toEqual(11);
    await expect(hWallet.getGapLimit()).resolves.toEqual(11);
  });

  it('should get the wallet access data from storage', async () => {
    const hWallet = await generateWalletHelper();
    const accessData = await hWallet.storage.getAccessData();
    await expect(hWallet.getWalletType()).resolves.toEqual(WalletType.P2PKH);
    await expect(hWallet.getAccessData()).resolves.toEqual(accessData);
    await expect(hWallet.getMultisigData()).rejects.toThrow('Wallet is not a multisig wallet.');

    const mshWallet = await generateMultisigWalletHelper({ walletIndex: 0 });
    const mshAccessData = await mshWallet.storage.getAccessData();
    await expect(mshWallet.getWalletType()).resolves.toEqual(WalletType.MULTISIG);
    await expect(mshWallet.getAccessData()).resolves.toEqual(mshAccessData);
    await expect(mshWallet.getMultisigData()).resolves.toEqual(mshAccessData.multisigData);
  });
});
