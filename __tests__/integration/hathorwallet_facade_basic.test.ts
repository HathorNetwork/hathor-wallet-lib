import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
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
  generateWalletHelperRO,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
} from './helpers/wallet.helper';
import HathorWallet from '../../src/new/wallet';
import {
  NATIVE_TOKEN_UID,
  P2PKH_ACCT_PATH,
} from '../../src/constants';
import { WALLET_CONSTANTS } from './configuration/test-constants';
import { verifyMessage } from '../../src/utils/crypto';
import { WalletFromXPubGuard } from '../../src/errors';
import SendTransaction from '../../src/new/sendTransaction';
import { ConnectionState } from '../../src/wallet/types';
import transaction from '../../src/utils/transaction';
import Network from '../../src/models/network';
import { TokenVersion } from '../../src/types';
import { MemoryStore, Storage } from '../../src/storage';
import { TransactionTemplateBuilder } from '../../src/template/transaction';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('template methods', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should build transactions from the template transaction', async () => {
    const hWallet = await generateWalletHelper();
    const address = await hWallet.getAddressAtIndex(1);

    await GenesisWalletHelper.injectFunds(hWallet, address, 10n);

    const template = new TransactionTemplateBuilder()
      .addConfigAction({ createToken: true, tokenName: 'Tmpl Token', tokenSymbol: 'TT' })
      .addSetVarAction({ name: 'addr', call: { method: 'get_wallet_address' } })
      .addUtxoSelect({ fill: 1 })
      .addTokenOutput({ address: '{addr}', amount: 100, useCreatedToken: true })
      .build();

    const tx = await hWallet.buildTxTemplate(template, { signTx: true, pinCode: DEFAULT_PIN_CODE });
    expect(tx.version).toEqual(2); // Create token transaction
    expect(tx.inputs).toHaveLength(1);
    expect(tx.inputs[0].data).not.toBeFalsy(); // Tx is signed
    // Transaction is not mined yet
    expect(tx.hash).toBeNull();
    expect(tx.nonce).toEqual(0);

    // Send transaction
    const sendTx = new SendTransaction({ storage: hWallet.storage, transaction: tx });
    await sendTx.runFromMining();
    expect(tx.nonce).toBeGreaterThan(0);
  });

  it('should send transactions from the template transaction', async () => {
    const hWallet = await generateWalletHelper();
    const address = await hWallet.getAddressAtIndex(1);

    await GenesisWalletHelper.injectFunds(hWallet, address, 10n);

    const template = new TransactionTemplateBuilder()
      .addConfigAction({ createToken: true, tokenName: 'Tmpl Token', tokenSymbol: 'TT' })
      .addSetVarAction({ name: 'addr', call: { method: 'get_wallet_address' } })
      .addUtxoSelect({ fill: 1 })
      .addTokenOutput({ address: '{addr}', amount: 100, useCreatedToken: true })
      .build();

    const tx = await hWallet.runTxTemplate(template, DEFAULT_PIN_CODE);
    expect(tx.version).toEqual(2); // Create token transaction
    expect(tx.inputs).toHaveLength(1);
    expect(tx.inputs[0].data).not.toBeFalsy(); // Tx is signed
    // Transaction is mined and pushed
    expect(tx.hash).not.toBeNull();
    // Outputs will have 100 minted tokens and 9 HTR as change
    expect(tx.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 100n,
          tokenData: 1,
        }),
        expect.objectContaining({
          value: 9n,
          tokenData: 0,
        }),
      ])
    );
  });
});

describe('getWalletInputInfo', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should return the address index and address path', async () => {
    const hWallet = await generateWalletHelper();
    const address = await hWallet.getAddressAtIndex(1);

    const network = hWallet.getNetworkObject();
    await GenesisWalletHelper.injectFunds(hWallet, address, 10n);

    const sendTransaction = new SendTransaction({
      storage: hWallet.storage,
      outputs: [
        {
          address: await hWallet.getAddressAtIndex(2),
          value: 5n,
          token: NATIVE_TOKEN_UID,
        },
      ],
    });
    const txData = await sendTransaction.prepareTxData();
    const tx = transaction.createTransactionFromData(txData, network);
    tx.prepareToSend();

    await expect(hWallet.getWalletInputInfo(tx)).resolves.toEqual([
      {
        inputIndex: 0,
        addressIndex: 1,
        addressPath: "m/44'/280'/0'/0/1",
      },
    ]);
  });
});

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
    const tx1 = await GenesisWalletHelper.injectFunds(hWallet, fundDestinationAddress, 10n);
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
      'txId,timestamp,version,voided,weight,tokenId,tokenName,tokenSymbol,balance'
    );

    expect(firstTokenDetails.txId).toStrictEqual(tx1.hash);
    expect(firstTokenDetails.timestamp).toBeGreaterThan(0);
    expect(firstTokenDetails.version).toStrictEqual(1);
    expect(firstTokenDetails.voided).toStrictEqual(false);
    expect(firstTokenDetails.weight).toBeGreaterThan(0);
    expect(firstTokenDetails.tokenId).toStrictEqual('00');
    expect(firstTokenDetails.tokenName).toStrictEqual('Hathor');
    expect(firstTokenDetails.tokenSymbol).toStrictEqual('HTR');
    expect(firstTokenDetails.balance).toStrictEqual(10n);

    // throw error if token uid not found in tokens list
    jest.spyOn(hWallet, 'getFullTxById').mockResolvedValue({
      success: true,
      tx: {
        ...tx1,
        // impossible token_data
        inputs: [{ ...tx1.inputs[0], token_data: -1 }],
      },
    });
    await expect(hWallet.getTxById(tx1.hash)).rejects.toThrow(
      'Invalid token_data undefined, token not found in tokens list'
    );
    jest.spyOn(hWallet, 'getFullTxById').mockRestore();

    // thorw error if token not found in tx
    jest.spyOn(hWallet, 'getTxBalance').mockResolvedValue({
      'unknown-token': 10n,
    });
    await expect(hWallet.getTxById(tx1.hash)).rejects.toThrow(
      'Token unknown-token not found in tx'
    );
    jest.spyOn(hWallet, 'getTxBalance').mockRestore();
  });

  it('should throw an error tx id is invalid', async () => {
    const hWallet = await generateWalletHelper();
    await expect(hWallet.getTxById('invalid-tx-hash')).rejects.toThrow(
      'Invalid transaction invalid-tx-hash'
    );
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
      balance: { unlocked: 0n, locked: 0n },
      transactions: 0,
    });

    // Test case: custom token with funds
    const address = await hWallet.getAddressAtIndex(0);
    // Inject 10 HTR into the wallet
    await GenesisWalletHelper.injectFunds(hWallet, address, 10n);
    // Generate a random amount of new tokens
    const newTokenAmount = BigInt(getRandomInt(1000, 10));
    // Create a new custom token with the generated amount
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'BalanceToken',
      'BAT',
      newTokenAmount
    );
    // Get the balance of the new token
    await delay(1000);
    const tknBalance = await hWallet.getBalance(tokenUid);
    // Assert that only one balance is returned
    expect(tknBalance).toHaveLength(1);
    // Assert the balance is equal to the amount generated
    expect(tknBalance[0]).toMatchObject({
      token: { id: tokenUid },
      balance: { unlocked: newTokenAmount, locked: 0n },
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
    expect(result.txTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenId: NATIVE_TOKEN_UID,
          balance: expect.any(BigInt),
        }),
        expect.objectContaining({
          tokenId: tokenUid,
          balance: newTokenAmount,
        }),
      ])
    );

    // Test case: non-accessible token for another wallet (genesis)
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    const genesisTknBalance = await gWallet.getBalance(tokenUid);
    expect(genesisTknBalance).toHaveLength(1);
    expect(genesisTknBalance[0]).toMatchObject({
      token: { id: tokenUid },
      balance: { unlocked: 0n, locked: 0n },
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

    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('provide a connection');

    expect(
      () =>
        new HathorWallet({
          connection,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('seed');

    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          xpriv: 'abc123',
          connection,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('seed and an xpriv');

    expect(
      () =>
        new HathorWallet({
          xpriv: 'abc123',
          connection,
          passphrase: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('xpriv with passphrase');

    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          connection: { state: ConnectionState.CONNECTED },
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('share connections');

    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          connection,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
          multisig: {},
        })
    ).toThrow('pubkeys and numSignatures');

    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          connection,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
          multisig: { pubkeys: ['abc'], numSignatures: 2 },
        })
    ).toThrow('configuration invalid');

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
    };
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

    // We are not using the injectFunds helper method here because
    // we want to send this transaction before the wallet is started
    // then we don't have the wallet object, which is an expected parameter
    // for the injectFunds method now
    // Since we start and load the wallet after the transaction is sent to the full node
    // we don't need to worry for it to be received in the websocket
    const injectAddress = walletData.addresses[0];
    const injectValue = BigInt(getRandomInt(10, 1));
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    const injectionTx = await gWallet.sendTransaction(injectAddress, injectValue);

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

  it("should calculate the wallet's addresses on start", async () => {
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
    await hWallet.storage.setGapLimit(100); // load more addresses than preCalculated
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
    await hWallet.storage.setGapLimit(5);
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
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 2n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Dedicated Wallet Token',
      'DWT',
      100n
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
          name: 'Dedicated Wallet Token',
          symbol: 'DWT',
          version: TokenVersion.DEPOSIT,
        },
        balance: {
          unlocked: 100n,
          locked: 0n,
        },
        transactions: 1,
        lockExpires: null,
        tokenAuthorities: {
          unlocked: {
            mint: 1n,
            melt: 1n,
          },
          locked: {
            mint: 0n,
            melt: 0n,
          },
        },
      },
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
    const rootXpriv = code.toHDPrivateKey('', new Network('testnet'));
    const xpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    const xpub = xpriv.xpubkey;

    // Creating a new wallet with a known set of words just to generate the custom token
    const hWallet = await generateWalletHelper({
      xpub,
      password: null,
      pinCode: null,
    });
    expect(hWallet.isReady()).toStrictEqual(true);
    await expect(hWallet.isReadonly()).resolves.toBe(true);

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
    await expect(hWallet.createAndSendNanoContractTransaction()).rejects.toThrow(
      WalletFromXPubGuard
    );
    await expect(hWallet.createAndSendNanoContractCreateTokenTransaction()).rejects.toThrow(
      WalletFromXPubGuard
    );
    await expect(hWallet.getPrivateKeyFromAddress()).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.createOnChainBlueprintTransaction()).rejects.toThrow(WalletFromXPubGuard);

    // Validating that the address generation works as intended
    for (let i = 0; i < 20; ++i) {
      expect(await hWallet.getAddressAtIndex(i)).toStrictEqual(walletData.addresses[i]);
    }

    // Validating balance and utxo methods
    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toStrictEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        balance: { unlocked: 0n, locked: 0n },
        transactions: 0,
      }),
    ]);
    await expect(hWallet.getUtxos()).resolves.toHaveProperty('total_utxos_available', 0n);

    // Generating a transaction and validating it shows correctly
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(1), 1n);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toMatchObject([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        balance: { unlocked: 1n, locked: 0n },
        transactions: expect.any(Number),
      }),
    ]);
    await expect(hWallet.getUtxos()).resolves.toHaveProperty('total_utxos_available', 1n);
  });

  it('should start an externally signed wallet', async () => {
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
    hWallet.setExternalTxSigningMethod(async () => {});
    expect(hWallet.isReady()).toStrictEqual(true);
    await expect(hWallet.isReadonly()).resolves.toBe(false);
    hWallet.setExternalTxSigningMethod(null);
    await expect(hWallet.isReadonly()).resolves.toBe(true);
  });

  it('should start an externally signed wallet from storage', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const code = new Mnemonic(walletData.words);
    const rootXpriv = code.toHDPrivateKey('', new Network('privatenet'));
    const xpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    const xpub = xpriv.xpubkey;

    const store = new MemoryStore();
    const storage = new Storage(store);
    storage.setTxSignatureMethod(async () => {});
    // Creating a new wallet with a known set of words just to generate the custom token
    const hWallet = await generateWalletHelper({
      xpub,
      storage,
      password: null,
      pinCode: null,
    });
    expect(hWallet.isReady()).toStrictEqual(true);
    await expect(hWallet.isReadonly()).resolves.toBe(false);
    hWallet.setExternalTxSigningMethod(null);
    await expect(hWallet.isReadonly()).resolves.toBe(true);
  });

  it('should start a wallet without pin', async () => {
    // Generating the wallet
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const hWallet = await generateWalletHelper({
      seed: walletData.words,
      preCalculatedAddresses: walletData.addresses,
      pinCode: DEFAULT_PIN_CODE,
    });

    // Adding funds to it
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    /*
     * XXX: The code branches that require a PIN would not be achievable without this hack that
     * manually removes the pin from the wallet.
     * In order to increase the test coverage we will add this procedure here
     */
    hWallet.pinCode = null;

    // XXX: This is the only method that resolves instead of rejects. Check the standard here.
    await expect(
      hWallet.sendManyOutputsTransaction([
        { address: await hWallet.getAddressAtIndex(1), value: 1 },
      ])
    ).rejects.toThrow('Pin');

    await expect(hWallet.createNewToken('Pinless Token', 'PTT', 100)).rejects.toThrow('Pin');

    await expect(hWallet.mintTokens(fakeTokenUid, 100n)).rejects.toThrow('Pin');

    await expect(hWallet.meltTokens(fakeTokenUid, 100n)).rejects.toThrow('Pin');

    await expect(
      hWallet.delegateAuthority(fakeTokenUid, 'mint', await hWallet.getAddressAtIndex(1))
    ).rejects.toThrow('Pin');

    await expect(hWallet.destroyAuthority(fakeTokenUid, 'mint', 1)).rejects.toThrow('Pin');

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
        // eslint-disable-next-line jest/no-conditional-expect -- This is already the simplest way to test the gap limit
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
    await GenesisWalletHelper.injectFunds(hWallet, currentAddress.address, 1n);
    const currentAfterTx = await hWallet.getCurrentAddress();
    expect(currentAfterTx).toMatchObject({
      index: currentAddress.index + 1,
      address: await hWallet.getAddressAtIndex(currentAddress.index + 1),
    });
  });

  it('should get address privkeys correctly', async () => {
    // Creating a wallet
    const hWallet = await generateWalletHelper();
    // Validate 20 address private keys
    for (let i = 0; i < 20; i++) {
      const addressHDPrivKey = await hWallet.getAddressPrivKey(DEFAULT_PIN_CODE, i);
      // Validate that it's from the same address:
      expect(
        addressHDPrivKey.privateKey.toAddress(hWallet.getNetworkObject().bitcoreNetwork).toString()
      ).toStrictEqual(await hWallet.getAddressAtIndex(i));
    }
  });

  it('should sign messages with an address privkey', async () => {
    // Creating a wallet
    const hWallet = await generateWalletHelper();
    // Validate 20 address private keys
    for (let i = 0; i < 20; i++) {
      const messageToSign = 'sign-me';
      const address = await hWallet.getAddressAtIndex(i);
      const signedMessage = await hWallet.signMessageWithAddress(
        messageToSign,
        i,
        DEFAULT_PIN_CODE
      );

      expect(verifyMessage(messageToSign, signedMessage, address)).toStrictEqual(true);
    }
  });

  it('should get correct addresses for a multisig wallet', async () => {
    const mshWallet = await generateMultisigWalletHelper({ walletIndex: 0 });

    // We will assume the wallet never received txs, which is to be expected for the addresses test
    expect((await mshWallet.getCurrentAddress()).address).toStrictEqual(
      WALLET_CONSTANTS.multisig.addresses[0]
    );

    for (let i = 0; i < 21; ++i) {
      expect(await mshWallet.getAddressAtIndex(i)).toStrictEqual(
        WALLET_CONSTANTS.multisig.addresses[i]
      );
    }
  });

  it('should correctly get index of address using getAddressIndex', async () => {
    // Creating a wallet
    const hWallet = await generateWalletHelper();
    const address = await hWallet.getAddressAtIndex(2);

    const index = await hWallet.getAddressIndex(address);

    expect(index).toBe(2);

    // Address that does not belong to the wallet returns null
    const nullIndex = await hWallet.getAddressIndex('test');

    expect(nullIndex).toBe(null);
  });

  it('should derive an address if it has not been generated yet', async () => {
    const hWallet = await generateWalletHelper();
    await expect(hWallet.getAddressAtIndex(50)).resolves.toBeDefined();

    const mshWallet = await generateMultisigWalletHelper({ walletIndex: 0 });
    await expect(mshWallet.getAddressAtIndex(50)).resolves.toBeDefined();
  });
});
