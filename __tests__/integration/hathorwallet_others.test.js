import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay } from './utils/core.util';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived, waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import { HATHOR_TOKEN_CONFIG, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import { FULLNODE_URL, NETWORK_NAME, WALLET_CONSTANTS } from './configuration/test-constants';
import dateFormatter from '../../src/date';
import { loggers } from './utils/logger.util';
import wallet from '../../src/wallet';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('getAddressInfo', () => {
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });

  afterAll(() => {
    hWallet.stop();
  });


  it('should display correct values for HTR transactions with no change', async () => {
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
    await waitUntilNextTimestamp(hWallet, tx.hash);
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

  it('should display correct values for transactions with change', async () => {
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

    // Validating locked balance
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

    // Creating custom token
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
  });
})

describe('getTxAddresses', () => {
  it('should identify transaction addresses correctly', async () => {
    const hWallet = await generateWalletHelper();
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();

    // Generating a transaction with outputs to multiple addresses
    const tx = await gWallet.sendManyOutputsTransaction([
      { address: hWallet.getAddressAtIndex(1), value: 1, token: HATHOR_TOKEN_CONFIG.uid },
      { address: hWallet.getAddressAtIndex(3), value: 3, token: HATHOR_TOKEN_CONFIG.uid },
      { address: hWallet.getAddressAtIndex(5), value: 5, token: HATHOR_TOKEN_CONFIG.uid },
    ],{
      changeAddress: WALLET_CONSTANTS.genesis.addresses[0]
    });
    await waitForTxReceived(hWallet, tx.hash);

    // Validating the method results
    const decodedTx = hWallet.getTx(tx.hash);
    expect(hWallet.getTxAddresses(decodedTx)).toStrictEqual(new Set([
      hWallet.getAddressAtIndex(1),
      hWallet.getAddressAtIndex(3),
      hWallet.getAddressAtIndex(5),
    ]));

    // By convention, only the address 0 of the genesis wallet is used on the integration tests
    expect(gWallet.getTxAddresses(decodedTx)).toStrictEqual(new Set([
      WALLET_CONSTANTS.genesis.addresses[0]
    ]))

  })
});

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

    // Get correct results for a single transaction
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

    // Expect the generator to have finished
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
      authorities: TOKEN_MINT_MASK
    });

    utxoGenResult = await utxoGenerator.next();
    expect(utxoGenResult.value).toMatchObject({
      txId: tokenUid,
      tokenId: tokenUid,
      value: 2,
      authorities: TOKEN_MELT_MASK
    });

    expect(await utxoGenerator.next()).toStrictEqual({ value: undefined, done: true });
  })
});

describe('getUtxosForAmount', () => {
  /** @type HathorWallet */
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
  /** @type HathorWallet */
  let hWallet;
  /** @type string */
  let txHash;
  /** @type number */
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

describe('consolidateUtxos', () => {
  /** @type HathorWallet */
  let hWallet1;
  /** @type HathorWallet */
  let hWallet2;
  /** @type string */
  let tokenHash;

  /*
   * The test initialization creates two wallets,
   * Wallet1: Empty, with no transactions
   * Wallet2: Containing HTR and custom token funds
   */
  beforeAll(async () => {
    hWallet1 = await generateWalletHelper();
    hWallet2 = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet2.getAddressAtIndex(0), 101)
    const { hash: tokenUid } = await createTokenHelper(
      hWallet2,
      'Consolidate Token',
      'CTK',
      100,
      { address: hWallet2.getAddressAtIndex(0) }
    );
    tokenHash = tokenUid;
  })
  afterAll(async () => {
    hWallet1.stop();
    hWallet2.stop();
    await GenesisWalletHelper.clearListeners();
  })

  /**
   * Helper function to empty wallet1 of a specified token and move it all back to wallet2.
   * @param {string} [token]
   * @returns {Promise<void>}
   */
  async function cleanWallet1(token) {
    const [balanceObj] = await hWallet1.getBalance(token);
    const tokenBalance = balanceObj?.balance?.unlocked || 0;
    if (tokenBalance === 0) {
      return;
    }

    const cleanTx = await hWallet1.sendTransaction(
      hWallet2.getAddressAtIndex(0),
      tokenBalance,
      { token }
    );
    await waitForTxReceived(hWallet1, cleanTx.hash);
    await waitUntilNextTimestamp(hWallet1, cleanTx.hash);
  }

  it('should throw when consolidating on an empty wallet', async () => {
    await expect(hWallet1.consolidateUtxos(hWallet1.getAddressAtIndex(0)))
      .rejects.toThrow('available utxo');
  });

  it('should consolidate two utxos (htr)', async () => {
    const fundTx = await hWallet2.sendManyOutputsTransaction([
        { address: hWallet1.getAddressAtIndex(0), value: 4, token: HATHOR_TOKEN_CONFIG.uid },
        { address: hWallet1.getAddressAtIndex(1), value: 5, token: HATHOR_TOKEN_CONFIG.uid },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(
      hWallet1.getAddressAtIndex(2),
      { token: HATHOR_TOKEN_CONFIG.uid }
    );
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 9,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        {
          address: hWallet1.getAddressAtIndex(0),
          amount: 4,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number)
        },
        {
          address: hWallet1.getAddressAtIndex(1),
          amount: 5,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number)
        },
      ])
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    const utxos = hWallet1.getUtxos();
    expect(utxos).toStrictEqual({
      total_amount_available: 9,
      total_utxos_available: 1,
      total_amount_locked: 0,
      total_utxos_locked: 0,
      utxos: [{
        address: hWallet1.getAddressAtIndex(2),
        amount: 9,
        tx_id: consolidateTx.txId,
        locked: false,
        index: 0 // This has a single resulting utxo, so 1 output only
      }]
    })

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(HATHOR_TOKEN_CONFIG.uid);
  })

  it('should consolidate two utxos (custom token)', async () => {
    const fundTx = await hWallet2.sendManyOutputsTransaction([
        { address: hWallet1.getAddressAtIndex(3), value: 40, token: tokenHash },
        { address: hWallet1.getAddressAtIndex(4), value: 50, token: tokenHash },
    ]);
    await waitForTxReceived(hWallet1, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(
      hWallet1.getAddressAtIndex(5),
      { token: tokenHash }
    );
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 90,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        {
          address: hWallet1.getAddressAtIndex(3),
          amount: 40,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number)
        },
        {
          address: hWallet1.getAddressAtIndex(4),
          amount: 50,
          tx_id: fundTx.hash,
          locked: false,
          index: expect.any(Number)
        },
      ])
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    const utxos = hWallet1.getUtxos({ token: tokenHash });
    expect(utxos).toStrictEqual({
      total_amount_available: 90,
      total_utxos_available: 1,
      total_amount_locked: 0,
      total_utxos_locked: 0,
      utxos: [{
        address: hWallet1.getAddressAtIndex(5),
        amount: 90,
        tx_id: consolidateTx.txId,
        locked: false,
        index: 0 // This has a single resulting utxo, so 1 output only
      }]
    })

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(tokenHash);
  })

  it('should consolidate with filter_address filter', async () => {
    const addr1 = hWallet1.getAddressAtIndex(1);
    const addr2 = hWallet1.getAddressAtIndex(2);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
        { address: addr1, value: 1, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr1, value: 2, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 1, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 1, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 3, token: HATHOR_TOKEN_CONFIG.uid },
      ]);
    await waitForTxReceived(hWallet1, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(
      hWallet1.getAddressAtIndex(3),
      {
        token: HATHOR_TOKEN_CONFIG.uid,
        filter_address: addr2
      }
    );
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 3,
      total_amount: 5,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        expect.objectContaining({ address: addr2 }),
        expect.objectContaining({ address: addr2 }),
        expect.objectContaining({ address: addr2 }),
      ]),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(1)))
      .toMatchObject({ total_amount_available: 3 })
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(2)))
      .toMatchObject({ total_amount_available: 0 })
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(3)))
      .toMatchObject({ total_amount_available: 5 })

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(HATHOR_TOKEN_CONFIG.uid);
  });

  it('should consolidate with amount_smaller_than filter', async () => {
    const addr1 = hWallet1.getAddressAtIndex(1);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
        { address: addr1, value: 1, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr1, value: 2, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr1, value: 3, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr1, value: 4, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr1, value: 5, token: HATHOR_TOKEN_CONFIG.uid },
      ]);
    await waitForTxReceived(hWallet1, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(
      hWallet1.getAddressAtIndex(2),
      {
        token: HATHOR_TOKEN_CONFIG.uid,
        amount_smaller_than: 3,
      }
    );
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 3,
      total_amount: 6,
      txId: expect.any(String),
      utxos: expect.objectContaining({ length: 3 }),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(1)))
      .toMatchObject({ total_amount_available: 9 })
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(2)))
      .toMatchObject({ total_amount_available: 6 })

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(HATHOR_TOKEN_CONFIG.uid);
  });

  it('should consolidate with amount_bigger_than filter', async () => {
    const addr2 = hWallet1.getAddressAtIndex(2);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
        { address: addr2, value: 1, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 2, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 3, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 4, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 5, token: HATHOR_TOKEN_CONFIG.uid },
      ]);
    await waitForTxReceived(hWallet1, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(
      hWallet1.getAddressAtIndex(4),
      {
        token: HATHOR_TOKEN_CONFIG.uid,
        amount_bigger_than: 3,
      }
    );
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 3,
      total_amount: 12,
      txId: expect.any(String),
      utxos: expect.objectContaining({ length: 3 }),
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(2)))
      .toMatchObject({ total_amount_available: 3 })
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(4)))
      .toMatchObject({ total_amount_available: 12 })

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(HATHOR_TOKEN_CONFIG.uid);
  });

  it('should consolidate with amount_bigger_than and maximum_amount filter', async () => {
    const addr2 = hWallet1.getAddressAtIndex(2);

    const fundTx = await hWallet2.sendManyOutputsTransaction([
        { address: addr2, value: 10, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 15, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 18, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 20, token: HATHOR_TOKEN_CONFIG.uid },
        { address: addr2, value: 35, token: HATHOR_TOKEN_CONFIG.uid },
      ]);
    await waitForTxReceived(hWallet1, fundTx.hash);

    // Sending transaction and validating the method response
    const consolidateTx = await hWallet1.consolidateUtxos(
      hWallet1.getAddressAtIndex(4),
      {
        token: HATHOR_TOKEN_CONFIG.uid,
        amount_bigger_than: 15,
        maximum_amount: 33,
      }
    );
    // FIXME: This result is not consistent, sometimes it fetches only utxo "20".
    expect(consolidateTx).toStrictEqual({
      total_utxos_consolidated: 2,
      total_amount: 33,
      txId: expect.any(String),
      utxos: expect.arrayContaining([
        expect.objectContaining({ amount: 15 }),
        expect.objectContaining({ amount: 18 }),
      ])
    });

    // Validating the updated balance on the wallet
    await waitForTxReceived(hWallet1, consolidateTx.txId);
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(2)))
      .toMatchObject({ total_amount_available: 65 })
    expect(hWallet1.getAddressInfo(hWallet1.getAddressAtIndex(4)))
      .toMatchObject({ total_amount_available: 33 })

    await waitUntilNextTimestamp(hWallet1, consolidateTx.txId);
    await cleanWallet1(HATHOR_TOKEN_CONFIG.uid);
  });
})

// getAuthorityUtxos acts as a wrapper for selectAuthorityUtxo: testing them together.
describe('selectAuthorityUtxo and getAuthorityUtxos', () => {
  /** @type HathorWallet */
  let hWallet;
  /** @type string */
  let tokenHash;
  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  })
  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  })

  it('should work on an empty wallet', async () => {
    // Default options
    expect(hWallet.selectAuthorityUtxo(
      HATHOR_TOKEN_CONFIG.uid,
      () => true)).toStrictEqual(null);

    // With "many" option
    expect(hWallet.selectAuthorityUtxo(
      HATHOR_TOKEN_CONFIG.uid,
      () => true,
      { many: true })).toStrictEqual([]);

    // Testing the wrapper method
    expect(hWallet.getAuthorityUtxos(fakeTokenUid,'mint')).toStrictEqual([]);
    expect(hWallet.getAuthorityUtxos(fakeTokenUid,'melt')).toStrictEqual([]);
    expect(() => hWallet.getAuthorityUtxos(fakeTokenUid,'invalid')).toThrow();
  });

  it('should find one authority utxo', async () => {
    // Creating the token
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 1);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'selectAuthorityUtxo Token',
      'SAUT',
      100,
    );
    tokenHash = tokenUid;

    // Validating single authority UTXO for a token creation
    expect(hWallet.selectAuthorityUtxo(tokenHash, wallet.isMintOutput.bind(wallet)))
      .toStrictEqual([{
        tx_id: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      }])
    expect(hWallet.selectAuthorityUtxo(tokenHash, wallet.isMeltOutput.bind(wallet)))
      .toStrictEqual([{
        tx_id: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: 2,
      }])

    // Validating single authority UTXO for a token creation ( with "many" option )
    expect(hWallet.selectAuthorityUtxo(tokenHash, wallet.isMintOutput.bind(wallet), { many: true }))
      .toStrictEqual([{
        tx_id: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      }])
    expect(hWallet.selectAuthorityUtxo(tokenHash, wallet.isMeltOutput.bind(wallet), { many: true }))
      .toStrictEqual([{
        tx_id: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: 2,
      }])

    // Validating the wrapper method
    expect(hWallet.getAuthorityUtxos(tokenHash, 'mint'))
      .toStrictEqual([{
        tx_id: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      }]);
    expect(hWallet.getAuthorityUtxos(tokenHash, 'melt'))
      .toStrictEqual([{
        tx_id: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: 2,
      }])
  });

  it('should find many "mint" authority utxos', async () => {
    // Delegating the mint to another address on the same wallet
    const mintDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'mint',
      hWallet.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet, mintDelegationTx.hash);

    // Should not find the spent utxo
    expect(hWallet.selectAuthorityUtxo(tokenHash, wallet.isMintOutput.bind(wallet)))
      .toStrictEqual([{
        tx_id: mintDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      }]);
    expect(hWallet.selectAuthorityUtxo(tokenHash, wallet.isMintOutput.bind(wallet), { many: true }))
      .toStrictEqual([{
        tx_id: mintDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      }]);
    expect(hWallet.getAuthorityUtxos(tokenHash, 'mint'))
      .toStrictEqual([{
        tx_id: mintDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      }]);

    // Should return multiple utxos
    expect(hWallet.selectAuthorityUtxo(
      tokenHash,
      wallet.isMintOutput.bind(wallet),
      { many: true, skipSpent: false }))
      .toStrictEqual([
        {
          tx_id: tokenHash,
          index: expect.any(Number),
          address: expect.any(String),
          authorities: TOKEN_MINT_MASK,
        },
        {
          tx_id: mintDelegationTx.hash,
          index: expect.any(Number),
          address: expect.any(String),
          authorities: TOKEN_MINT_MASK,
        },
      ]);
  });

  it('should find many "melt" authority utxos', async () => {
    // Delegating the mint to another address on the same wallet
    const meltDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'melt',
      hWallet.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet, meltDelegationTx.hash);

    // Should not find the spent utxo
    expect(hWallet.selectAuthorityUtxo(tokenHash, wallet.isMeltOutput.bind(wallet)))
      .toStrictEqual([{
        tx_id: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      }]);
    expect(hWallet.selectAuthorityUtxo(tokenHash, wallet.isMeltOutput.bind(wallet), { many: true }))
      .toStrictEqual([{
        tx_id: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      }]);
    expect(hWallet.getAuthorityUtxos(tokenHash, 'melt'))
      .toStrictEqual([{
        tx_id: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      }]);

    // Should return multiple utxos
    expect(hWallet.selectAuthorityUtxo(
      tokenHash,
      wallet.isMeltOutput.bind(wallet),
      { many: true, skipSpent: false }))
      .toStrictEqual([
        {
          tx_id: tokenHash,
          index: expect.any(Number),
          address: expect.any(String),
          authorities: TOKEN_MELT_MASK,
        },
        {
          tx_id: meltDelegationTx.hash,
          index: expect.any(Number),
          address: expect.any(String),
          authorities: TOKEN_MELT_MASK,
        },
      ]);
  });
});

// This section tests methods that have side effects impacting the whole wallet. Executing it last.
describe('internal methods', () => {
  /** @type HathorWallet */
  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  afterAll(() => {
    gWallet.stop();
  });

  it('should test network-related methods', async () => {
    // GetServerUrl fetching from the live fullnode connection
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

    // GetVersionData fetching from the live fullnode server
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
  });

  it('should change servers', async () => {
    // Changing from our integration test privatenet to the testnet
    gWallet.changeServer('https://node1.testnet.hathor.network/v1a/');
    const serverChangeTime = Date.now().valueOf();
    await delay(100);

    // Validating the server change with getVersionData
    let networkData = await gWallet.getVersionData();
    expect(networkData.timestamp).toBeGreaterThan(serverChangeTime);
    expect(networkData.network).toMatch(/^testnet.*/);

    gWallet.changeServer(FULLNODE_URL);
    await delay(100);

    // Reverting to the privatenet
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
 * clearSensitiveData - not relevant for integration
 * handleWebsocketMsg - not relevant for integration
 * getTokenData - not relevant for integration
 * onConnectionChangedState - too many dependencies, already tested elsewhere
 * onTxArrived - too many dependencies, already tested elsewhere
 * setPreProcessedData - not relevant for integration, already tested elsewhere
 * getPreProcessedData - not relevant for integration, already tested elsewhere
 * setState - not relevant for integration, already tested elsewhere
 * onNewTx - not relevant for integration, already tested elsewhere
 * isReady - not relevant for integration, already tested elsewhere
 * isAddressMine - not relevant for integration, already tested elsewhere
 *
 * The following methods should be tested with the Atomic Swap tests
 * getAllSignatures
 * assemblePartialTransaction
 */
