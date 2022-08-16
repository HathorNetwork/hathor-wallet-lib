import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay } from './utils/core.util';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from './helpers/wallet.helper';
import { HATHOR_TOKEN_CONFIG } from '../../src/constants';
import { FULLNODE_URL, NETWORK_NAME } from './configuration/test-constants';
import dateFormatter from '../../src/date';
import { loggers } from './utils/logger.util';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('getAddressInfo', () => {
  /**
   * @type HathorWallet
   */
  let hWallet;
  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });

  afterAll(() => {
    hWallet.stop();
  });


  it('should test HTR transactions with full value', async () => {
    const addr0 = hWallet.getAddressAtIndex(0);
    const addr1 = hWallet.getAddressAtIndex(1);

    // Validating empty address information
    expect(hWallet.getAddressInfo(addr0)).toMatchObject({
      total_amount_received: 0,
      total_amount_sent: 0,
      total_amount_available: 0,
      total_amount_locked: 0, // Validating this field only once to check it's returned
      token: HATHOR_TOKEN_CONFIG.uid, // Validating this field only once to ensure it's correct
      index: 0,
    });

    // Validating address after 1 transaction
    await GenesisWalletHelper.injectFunds(addr0, 10);
    expect(hWallet.getAddressInfo(addr0)).toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 0,
      total_amount_available: 10,
    });


    // Validating the results for two transactions
    let tx = await hWallet.sendTransaction(addr1, 10);
    await waitForTxReceived(hWallet, tx.hash);
    expect(hWallet.getAddressInfo(addr0)).toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 10,
      total_amount_available: 0,
      index: 0, // Ensuring the index is correct
    });
    expect(hWallet.getAddressInfo(addr1)).toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 0,
      total_amount_available: 10,
      index: 1, // Ensuring the index is correct
    });


    // Validating the results for the funds returning to previously used address
    tx = await hWallet.sendTransaction(addr0, 10);
    await waitForTxReceived(hWallet, tx.hash);
    expect(hWallet.getAddressInfo(addr0)).toMatchObject({
      total_amount_received: 20,
      total_amount_sent: 10,
      total_amount_available: 10,
    });
    expect(hWallet.getAddressInfo(addr1)).toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 10,
      total_amount_available: 0,
    });
  });

  it('should test transactions with partial value', async () => {
    const addr2 = hWallet.getAddressAtIndex(2);
    const addr3 = hWallet.getAddressAtIndex(3);

    // Ensure both are empty addresses
    expect(hWallet.getAddressInfo(addr2).total_amount_received).toStrictEqual(0);
    expect(hWallet.getAddressInfo(addr3).total_amount_received).toStrictEqual(0);

    // Move all the wallet's funds to "2"
    let tx = await hWallet.sendTransaction(addr2, 10);
    await waitForTxReceived(hWallet, tx.hash);
    expect(hWallet.getAddressInfo(addr2)).toMatchObject({
      total_amount_received: 10,
      total_amount_sent: 0,
      total_amount_available: 10,
    });

    // Move only a part of the funds to "3", the change is returned to "2"
    tx = await hWallet.sendTransaction(addr3, 4, { changeAddress: addr2 });
    await waitForTxReceived(hWallet, tx.hash);
    expect(hWallet.getAddressInfo(addr2)).toMatchObject({
      total_amount_received: 16, // 10 from one transaction, 6 from the transaction change
      total_amount_sent: 10, // All the funds were sent
      total_amount_available: 6, // Only the change remains available
    });
    expect(hWallet.getAddressInfo(addr3)).toMatchObject({
      total_amount_received: 4,
      total_amount_sent: 0,
      total_amount_available: 4,
    });
  });

  it('should return correct values for locked utxos', async () => {
    const timelock1 = Date.now().valueOf() + 5000; // 5 seconds of locked resources
    const timelockTimestamp = dateFormatter.dateToTimestamp(new Date(timelock1));
    const rawTimelockTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: hWallet.getAddressAtIndex(0),
          value: 7,
          token: HATHOR_TOKEN_CONFIG.uid,
        },
        {
          address: hWallet.getAddressAtIndex(0),
          value: 3,
          token: HATHOR_TOKEN_CONFIG.uid,
          timelock: timelockTimestamp,
        }
      ],
    );
    await waitForTxReceived(hWallet, rawTimelockTx.hash);


    expect(hWallet.getAddressInfo(hWallet.getAddressAtIndex(0))).toMatchObject({
      total_amount_available: 7,
      total_amount_locked: 3,
    });
  });

  it('should test custom token transactions', async () => {
    // Generating a new wallet to avoid conflict with HTR wallet
    const hWalletCustom = await generateWalletHelper();
    const addr0Custom = hWalletCustom.getAddressAtIndex(0);
    const addr1Custom = hWalletCustom.getAddressAtIndex(1);

    await GenesisWalletHelper.injectFunds(addr0Custom, 1);
    const { hash: tokenUid } = await createTokenHelper(
      hWalletCustom,
      'getAddressInfo Token',
      'GAIT',
      100,
      { address: addr0Custom }
    );

    // Validating address information both in HTR and in custom token
    expect(hWalletCustom.getAddressInfo(addr0Custom)).toMatchObject({
      total_amount_received: 1,
      total_amount_sent: 1, // Custom token mint consumed this balance
      total_amount_available: 0,
      total_amount_locked: 0,
      token: HATHOR_TOKEN_CONFIG.uid,
      index: 0,
    });
    expect(hWalletCustom.getAddressInfo(addr0Custom, { token: tokenUid })).toMatchObject({
      total_amount_received: 100,
      total_amount_sent: 0,
      total_amount_available: 100,
      total_amount_locked: 0,
      token: tokenUid,
      index: 0,
    });

    // Validating address after 1 transaction
    let tx = await hWalletCustom.sendTransaction(addr1Custom, 40, { token: tokenUid } );
    await waitForTxReceived(hWalletCustom, tx.hash);
    expect(hWalletCustom.getAddressInfo(addr0Custom, { token: tokenUid })).toMatchObject({
      total_amount_received: 100,
      total_amount_sent: 100,
      total_amount_available: 0,
    });
    expect(hWalletCustom.getAddressInfo(addr1Custom, { token: tokenUid })).toMatchObject({
      total_amount_received: 40,
      total_amount_sent: 0,
      total_amount_available: 40,
    });
  });;
})

describe('getAllUtxos', () => {

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should correctly identify all utxos on an empty wallet', async () => {
    /**
     * @type HathorWallet
     */
    const hWallet = await generateWalletHelper();

    // Get correct results for an empty wallet
    let utxoGenerator = await hWallet.getAllUtxos();
    let utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult).toStrictEqual({ done: true, value: undefined });

    // Inject a transaction and validate the results
    const tx1 = await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);

    utxoGenerator = await hWallet.getAllUtxos();
    utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult)
      .toMatchObject({
        done: false,
        value: {
          txId: tx1.hash,
          index: expect.any(Number),
          tokenId: HATHOR_TOKEN_CONFIG.uid,
          address: hWallet.getAddressAtIndex(0),
          value: 10,
          authorities: 0,
          timelock: null,
          heightlock: null,
          locked: false,
          addressPath: expect.stringMatching(/\/0$/), // Matches "m/44'/280'/0'/0/0", for example
        }
      });

    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true })
  });

  it('should filter by address', async () => {
    /**
     * @type HathorWallet
     */
    const hWallet = await generateWalletHelper();
    const tx1 = await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);

    // Validate that on the address that received the transaction, the UTXO is listed
    let utxoGenerator = await hWallet.getAllUtxos({ filter_address: hWallet.getAddressAtIndex(0) });
    let utxoGenResult = await utxoGenerator.next();

    expect(utxoGenResult.value).toMatchObject({
      txId: tx1.hash,
      value: 10,
    });
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });

    // Validate that on the address that did not receive any transaction, the results are empty
    utxoGenerator = await hWallet.getAllUtxos({ filter_address: hWallet.getAddressAtIndex(1) });
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });
  })

  it('should filter by custom token', async () => {
    /**
     * @type HathorWallet
     */
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getAllUtxos Token',
      'GAUT',
      100
    );

    // Validate that the HTR change is listed
    let utxoGenerator = await hWallet.getAllUtxos();
    let utxoGenResult = await utxoGenerator.next();

    expect(utxoGenResult.value).toMatchObject({
      txId: tokenUid,
      tokenId: HATHOR_TOKEN_CONFIG.uid,
      value: 9,
    });
    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });

    // Validate that the custom token utxo is listed with its authority tokens
    utxoGenerator = await hWallet.getAllUtxos({ token: tokenUid });

    utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tokenUid,
      tokenId: tokenUid,
      value: 100,
      authorities: 0, // The custom token balance itself
    });

    utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tokenUid,
      tokenId: tokenUid,
      value: 1,
      authorities: 1 // Mint authority bits for the custom token
    });

    utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tokenUid,
      tokenId: tokenUid,
      value: 2,
      authorities: 2 // Melt authority bits for the custom token
    });

    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });
  })
});

describe('getUtxosForAmount', () => {
  /**
   * @type HathorWallet
   */
  let hWallet;
  let fundTx1hash;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  })

  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  })

  it('should throw on an empty wallet', async () => {
    // Should throw for invalid requested amount
    expect(() => hWallet.getUtxosForAmount(0)).toThrow('positive integer');
    expect(() => hWallet.getUtxosForAmount(-1)).toThrow('positive integer');

    // Should throw for an amount higher than available funds
    expect(() => hWallet.getUtxosForAmount(31)).toThrow('utxos to fill total amount');
  });

  it('should work on a wallet containing a single tx', async () => {
    const addr0 = hWallet.getAddressAtIndex(0);
    const addr1 = hWallet.getAddressAtIndex(1);
    const tx1 = await GenesisWalletHelper.injectFunds(addr0, 10);
    fundTx1hash = tx1.hash;

    // No change amount
    expect(hWallet.getUtxosForAmount(10)).toStrictEqual({
      changeAmount: 0,
      utxos: [{
        txId: fundTx1hash,
        index: expect.any(Number),
        tokenId: HATHOR_TOKEN_CONFIG.uid,
        address: addr0,
        value: 10,
        authorities: 0,
        timelock: null,
        heightlock: null,
        locked: false,
        addressPath: expect.any(String),
      }]
    });

    expect(hWallet.getUtxosForAmount(6)).toStrictEqual({
      changeAmount: 4,
      utxos: [expect.objectContaining({
        address: addr0,
        value: 10,
      })]
    });

    // Should filter by address
    expect(hWallet.getUtxosForAmount(10, { filter_address: addr0 })).toStrictEqual({
      changeAmount: 0,
      utxos: [expect.anything()]
    });
    expect(() => hWallet.getUtxosForAmount(10, { filter_address: addr1 }))
      .toThrow('utxos to fill total amount');

    // Should throw for an amount higher than available funds
    expect(() => hWallet.getUtxosForAmount(31)).toThrow('utxos to fill total amount');
  });

  it('should work on a wallet containing multiple txs', async () => {
    const addr0 = hWallet.getAddressAtIndex(0);
    const addr1 = hWallet.getAddressAtIndex(1);
    const tx2 = await GenesisWalletHelper.injectFunds(addr1, 20);

    /*
     * Since we don't know which order the transactions will be stored on the history,
     * we can't make tests that depend on utxo ordering. These will be done on the unit
     * tests.
     */

    // Should select only one utxo to satisfy the amount when both can do it
    expect(hWallet.getUtxosForAmount(7).utxos).toHaveLength(1);
    expect(hWallet.getUtxosForAmount(10).utxos).toHaveLength(1);

    // Should select the least amount of utxos that can satisfy the amount
    expect(hWallet.getUtxosForAmount(20)).toStrictEqual({
      changeAmount: 0,
      utxos: [expect.objectContaining({
        txId: tx2.hash,
        address: addr1,
        value: 20,
      })]
    });

    // Should select more than one utxo to cover an amount
    expect(hWallet.getUtxosForAmount(29)).toStrictEqual({
      changeAmount: 1,
      utxos: expect.arrayContaining([
        expect.objectContaining({
          txId: fundTx1hash,
          value: 10,
        }),
        expect.objectContaining({
          txId: tx2.hash,
          value: 20,
        }),
      ])
    });

    // Should filter by address
    expect(hWallet.getUtxosForAmount(10, { filter_address: addr0 })).toStrictEqual({
      changeAmount: 0,
      utxos: [expect.objectContaining({
        txId: fundTx1hash,
        address: addr0,
        value: 10,
      })]
    });
    expect(hWallet.getUtxosForAmount(10, { filter_address: addr1 })).toStrictEqual({
      changeAmount: 10,
      utxos: [expect.objectContaining({
        txId: tx2.hash,
        address: addr1,
        value: 20,
      })]
    });

    // Should throw for an amount higher than available funds
    expect(() => hWallet.getUtxosForAmount(31)).toThrow('utxos to fill total amount');
  });

  it('should filter by custom token', async () => {
    const addr2 = hWallet.getAddressAtIndex(2);
    const addr3 = hWallet.getAddressAtIndex(3);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getUtxosForAmount Test Token',
      'GUFAT',
      200,
      { address: addr2 }
    )

    // Should work only with the token filter
    expect(hWallet.getUtxosForAmount(6, { token: tokenUid }))
      .toStrictEqual({
      changeAmount: 194,
      utxos: [expect.objectContaining({
        address: addr2,
        value: 200,
        tokenId: tokenUid,
      })]
    });
    // Explicitly filtering for HTR
    expect(hWallet.getUtxosForAmount(6, { token: HATHOR_TOKEN_CONFIG.uid }))
      .toStrictEqual({
      changeAmount: expect.any(Number),
      utxos: [expect.objectContaining({ tokenId: HATHOR_TOKEN_CONFIG.uid })]
    });
    // Implicitly filtering for HTR
    expect(hWallet.getUtxosForAmount(6))
      .toStrictEqual({
      changeAmount: expect.any(Number),
      utxos: [expect.objectContaining({ tokenId: HATHOR_TOKEN_CONFIG.uid })]
    });

    // The token filter should work combined with the address filter
    expect(hWallet.getUtxosForAmount(6, { token: tokenUid, filter_address: addr2 }))
      .toStrictEqual({
      changeAmount: 194,
      utxos: [expect.objectContaining({
        address: addr2,
        value: 200,
      })]
    });
    expect(() => hWallet.getUtxosForAmount(6, { token: tokenUid, filter_address: addr3 }))
      .toThrow('utxos to fill');
  });
});

describe('markUtxoSelected', () => {
  /**
   * @type HathorWallet
   */
  let hWallet;
  /**
   * @type string
   */
  let txHash;
  /**
   * @type number
   */
  let oIndex;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    const { hash } = await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const { index } = hWallet.getUtxos().utxos[0];
    txHash = hash;
    oIndex = index;
  })

  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  })

  /*
   * We will validate this method's results by the following checks:
   * 1 - getTx() - direct access to the wallet full history
   * 2 - getUtxos()
   * 3 - getAllUtxos()
   * 4 - getUtxosForAmount()
   */

  it('should mark utxos as selected', async () => {
    // Validating utxo current state as not selected
    let rawOutput = hWallet.getTx(txHash).outputs[oIndex];
    loggers.test.log('Output before', rawOutput);
    expect(rawOutput.selected_as_input).toStrictEqual(false);

    // Marking it as selected
    hWallet.markUtxoSelected(txHash, oIndex, true);

    /*
     * We will force this update here without a new tx, for testing purposes.
     */
    await hWallet.preProcessWalletData();

    // Validation 1
    rawOutput = hWallet.getTx(txHash).outputs[oIndex];
    loggers.test.log('Output after', rawOutput);
    expect(rawOutput.selected_as_input).toStrictEqual(true);

    // Validation 2
    expect(hWallet.getUtxos()).toMatchObject({
      total_utxos_available: 0,
      utxos: [expect.objectContaining({
        tx_id: txHash,
        locked: true,
      })],
    });

    // Validation 3
    const utxosGenerator = hWallet.getAllUtxos();
    expect(utxosGenerator.next()).toStrictEqual({
      value: undefined,
      done: true,
    });

    // Validation 4
    expect(() => hWallet.getUtxosForAmount(10)).toThrow('utxos to fill');
  })

  it('should mark utxos as not selected', async () => {
    // Validating utxo current state as selected
    let rawOutput = hWallet.getTx(txHash).outputs[oIndex];
    expect(rawOutput.selected_as_input).toStrictEqual(true);

    // Marking it as not selected
    hWallet.markUtxoSelected(txHash, oIndex, false);

    // Validation 1
    rawOutput = hWallet.getTx(txHash).outputs[oIndex];
    expect(rawOutput.selected_as_input).toStrictEqual(false);

    // Validation 2
    expect(hWallet.getUtxos()).toMatchObject({
      total_utxos_available: 1,
      utxos: [expect.objectContaining({
        tx_id: txHash,
        locked: false
      })],
    });

    // Validation 3
    const utxosGenerator = hWallet.getAllUtxos();
    expect(utxosGenerator.next()).toStrictEqual({
      value: expect.objectContaining({ txId: txHash }),
      done: false,
    });

    // Validation 4
    expect(hWallet.getUtxosForAmount(10)).toStrictEqual({
      changeAmount: 0,
      utxos: [expect.objectContaining({ txId: txHash })]
    })
  })
})

// This section tests methods that have side effects impacting the whole wallet. Executing it last.
describe('internal methods', () => {
  /**
   * @type HathorWallet
   */
  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  afterAll(() => {
    gWallet.stop();
  });

  it('should test network-related methods', async () => {
    // GetServerUrl
    expect(gWallet.getServerUrl()).toStrictEqual(FULLNODE_URL);
    expect(gWallet.getNetwork()).toStrictEqual(NETWORK_NAME);
    expect(gWallet.getNetworkObject()).toMatchObject({
      name: NETWORK_NAME,
      versionBytes: { p2pkh: 73, p2sh: 135 }, // Calculated for the privnet.py config file
      bitcoreNetwork: {
        name: expect.stringContaining(NETWORK_NAME),
        alias: NETWORK_NAME,
        pubkeyhash: 73,
        scripthash: 135
      }
    });
    expect(await gWallet.getVersionData()).toMatchObject({
      timestamp: expect.any(Number),
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      network: NETWORK_NAME,
      minWeight: expect.any(Number),
      minTxWeight: expect.any(Number),
      minTxWeightCoefficient: expect.any(Number),
      minTxWeightK: expect.any(Number),
      tokenDepositPercentage: 0.01,
      rewardSpendMinBlocks: expect.any(Number),
      maxNumberInputs: 255,
      maxNumberOutputs: 255,
    })

    // const results = gWallet.getAllUtxos();
    // loggers.test.log(JSON.stringify(results));
  });

  it('should change servers', async () => {
    gWallet.changeServer('https://node1.testnet.hathor.network/v1a/');
    const serverChangeTime = Date.now().valueOf();
    await delay(100);

    let networkData = await gWallet.getVersionData();
    expect(networkData.timestamp).toBeGreaterThan(serverChangeTime);
    expect(networkData.network).toMatch(/^testnet.*/);

    gWallet.changeServer(FULLNODE_URL);
    await delay(100);

    networkData = await gWallet.getVersionData();
    expect(networkData.timestamp).toBeGreaterThan(serverChangeTime + 200);
    expect(networkData.network).toStrictEqual(NETWORK_NAME);
  });
});

/*
 * Internal methods not tested - reason:
 *
 * enableDebugMode - seems to be deprecated
 * disableDebugMode - seems to be deprecated
 * isFromXPub - not relevant for integration
 * handleWebsocketMsg - not relevant for integration
 * onConnectionChangedState - too many dependencies, already tested elsewhere
 *
 * The following methods should be tested with the Atomic Swap tests
 * getAllSignatures
 * assemblePartialTransaction
 */

/*

markUtxoSelected
consolidateUtxos
onTxArrived
setPreProcessedData
getPreProcessedData
setState
onNewTx
selectAuthorityUtxo
clearSensitiveData
getAuthorityUtxos
getTokenData
isReady
isAddressMine
getTxAddresses
 */
