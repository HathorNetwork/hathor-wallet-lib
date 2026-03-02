import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay, getRandomInt } from './utils/core.util';
import {
  createTokenHelper,
  DEFAULT_PIN_CODE,
  generateMultisigWalletHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import HathorWallet from '../../src/new/wallet';
import {
  NATIVE_TOKEN_UID,
  TOKEN_MINT_MASK,
} from '../../src/constants';
import dateFormatter from '../../src/utils/date';
import { loggers } from './utils/logger.util';
import SendTransaction from '../../src/new/sendTransaction';
import transaction from '../../src/utils/transaction';
import { TokenVersion } from '../../src/types';
import Header from '../../src/headers/base';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

const validateFeeAmount = (headers: Header[], amount: bigint) => {
  // validate fee amount
  expect(headers).toHaveLength(1);
  expect(headers[0]).toEqual(
    expect.objectContaining({
      entries: expect.arrayContaining([
        expect.objectContaining({
          tokenIndex: 0,
          amount,
        }),
      ]),
    })
  );
};

describe('sendTransaction', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should send HTR transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    // Sending a transaction inside the same wallet
    const tx1 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(2), 6n);

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
      tokens: expect.any(Array),
    });

    // Validating balance stays the same for internal transactions
    let htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(10n);

    // Validating the correct addresses received the tokens
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(0))).toHaveProperty(
      'numTransactions',
      2
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(1))).toHaveProperty(
      'numTransactions',
      1
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(2))).toHaveProperty(
      'numTransactions',
      1
    );

    // Sending a transaction to outside the wallet ( returning funds to genesis )
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    await waitUntilNextTimestamp(hWallet, tx1.hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      await gWallet.getAddressAtIndex(0),
      8n,
      {
        changeAddress: await hWallet.getAddressAtIndex(5),
      }
    );
    await waitForTxReceived(hWallet, tx2Hash);

    // Balance was reduced
    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(2n);

    // Change was moved to correct address
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(0))).toHaveProperty(
      'numTransactions',
      2
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(1))).toHaveProperty(
      'numTransactions',
      2
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(2))).toHaveProperty(
      'numTransactions',
      2
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(3))).toHaveProperty(
      'numTransactions',
      0
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(4))).toHaveProperty(
      'numTransactions',
      0
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(5))).toHaveProperty(
      'numTransactions',
      1
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(6))).toHaveProperty(
      'numTransactions',
      0
    );
  });

  it('should send custom token transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to Send', 'TTS', 100n);

    const tx1 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(5), 30n, {
      token: tokenUid,
      changeAddress: await hWallet.getAddressAtIndex(6),
    });
    await waitForTxReceived(hWallet, tx1.hash);

    // Validating balance stays the same for internal transactions
    let htrBalance = await hWallet.getBalance(tokenUid);
    expect(htrBalance[0].balance.unlocked).toEqual(100n);

    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(5))).toHaveProperty(
      'numTransactions',
      1
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(6))).toHaveProperty(
      'numTransactions',
      1
    );

    // Transaction outside the wallet
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    await waitUntilNextTimestamp(hWallet, tx1.hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      await gWallet.getAddressAtIndex(0),
      80n,
      {
        token: tokenUid,
        changeAddress: await hWallet.getAddressAtIndex(12),
      }
    );
    await waitForTxReceived(hWallet, tx2Hash);
    await waitForTxReceived(gWallet, tx2Hash);

    // Balance was reduced
    htrBalance = await hWallet.getBalance(tokenUid);
    expect(htrBalance[0].balance.unlocked).toEqual(20n);

    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(5))).toHaveProperty(
      'numTransactions',
      2
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(6))).toHaveProperty(
      'numTransactions',
      2
    );
    expect(
      await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(12))
    ).toHaveProperty('numTransactions', 1);
  });
  it('should send custom fee token transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'FeeBasedToken', 'FBT', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });

    const tx1 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(5), 8000n, {
      token: tokenUid,
      changeAddress: await hWallet.getAddressAtIndex(6),
    });
    validateFeeAmount(tx1.headers, 2n);
    await waitForTxReceived(hWallet, tx1.hash);

    // Validating balance stays the same for internal transactions
    let fbtBalance = await hWallet.getBalance(tokenUid);
    expect(fbtBalance[0].balance.unlocked).toEqual(8582n);

    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(5))).toHaveProperty(
      'numTransactions',
      1
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(6))).toHaveProperty(
      'numTransactions',
      1
    );

    // Transaction outside the wallet
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    await waitUntilNextTimestamp(hWallet, tx1.hash);
    const { hash: tx2Hash, headers: tx2Headers } = await hWallet.sendTransaction(
      await gWallet.getAddressAtIndex(0),
      82n,
      {
        token: tokenUid,
        changeAddress: await hWallet.getAddressAtIndex(12),
      }
    );
    validateFeeAmount(tx2Headers, 2n);
    await waitForTxReceived(hWallet, tx2Hash);
    await waitForTxReceived(gWallet, tx2Hash);

    // Balance was reduced
    fbtBalance = await hWallet.getBalance(tokenUid);
    expect(fbtBalance[0].balance.unlocked).toEqual(8500n);

    const htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(5n);

    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(5))).toHaveProperty(
      'numTransactions',
      1
    );
    expect(await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(6))).toHaveProperty(
      'numTransactions',
      2
    );
    expect(
      await hWallet.storage.getAddressInfo(await hWallet.getAddressAtIndex(12))
    ).toHaveProperty('numTransactions', 1);
  });

  it('should send fee token with manually provided HTR input (no HTR output)', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'FeeTokenManualInput',
      'FTMI',
      100n,
      {
        tokenVersion: TokenVersion.FEE,
      }
    );

    // Get UTXOs for both HTR and the fee token
    const { utxos: utxosHtr } = await hWallet.getUtxos({ token: NATIVE_TOKEN_UID });
    const { utxos: utxosToken } = await hWallet.getUtxos({ token: tokenUid });

    // Get the first UTXO of each token
    const htrUtxo = utxosHtr[0];
    const tokenUtxo = utxosToken[0];

    // Send transaction with manually provided inputs (HTR + token) and only token output
    // This tests the scenario where user provides HTR input to pay for fee
    // but has no HTR output (only token output)
    const tx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: await hWallet.getAddressAtIndex(5),
          value: 50n,
          token: tokenUid,
        },
      ],
      {
        inputs: [
          { txId: htrUtxo.tx_id, index: htrUtxo.index },
          { txId: tokenUtxo.tx_id, index: tokenUtxo.index },
        ],
      }
    );

    validateFeeAmount(tx.headers, 2n);
    await waitForTxReceived(hWallet, tx.hash);

    // Validate the transaction was created correctly
    const decodedTx = await hWallet.getTx(tx.hash);

    // Should have 2 inputs (HTR + token)
    expect(decodedTx.inputs).toHaveLength(2);
    expect(decodedTx.inputs).toContainEqual(
      expect.objectContaining({ tx_id: htrUtxo.tx_id, index: htrUtxo.index })
    );
    expect(decodedTx.inputs).toContainEqual(
      expect.objectContaining({ tx_id: tokenUtxo.tx_id, index: tokenUtxo.index })
    );

    // Should have outputs: token output (50) + token change (50) + HTR change
    expect(decodedTx.outputs).toContainEqual(
      expect.objectContaining({ value: 50n, token: tokenUid })
    );
  });

  it('should send a multisig transaction', async () => {
    // Initialize 3 wallets from the same multisig and inject funds in them to test
    const mhWallet1 = await generateMultisigWalletHelper({ walletIndex: 0 });
    const mhWallet2 = await generateMultisigWalletHelper({ walletIndex: 1 });
    const mhWallet3 = await generateMultisigWalletHelper({ walletIndex: 2 });
    await GenesisWalletHelper.injectFunds(mhWallet1, await mhWallet1.getAddressAtIndex(0), 10n);

    /*
     * Building tx proposal:
     * 1) Identify the UTXO
     * 2) Build the outputs
     */
    const { tx_id: inputTxId, index: inputIndex } = (await mhWallet1.getUtxos()).utxos[0];
    const network = mhWallet1.getNetworkObject();
    const sendTransaction = new SendTransaction({
      storage: mhWallet1.storage,
      inputs: [{ txId: inputTxId, index: inputIndex }],
      outputs: [
        {
          address: await mhWallet1.getAddressAtIndex(1),
          value: 10n,
          token: NATIVE_TOKEN_UID,
        },
      ],
    });
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
    const partiallyAssembledTx = await mhWallet1.assemblePartialTransaction(txHex, [
      sig1,
      sig2,
      sig3,
    ]);
    partiallyAssembledTx.prepareToSend();
    const finalTx = new SendTransaction({
      storage: mhWallet1.storage,
      transaction: partiallyAssembledTx,
    });

    /** @type BaseTransactionResponse */
    const sentTx = await finalTx.runFromMining();
    expect(sentTx).toHaveProperty('hash');
    await waitForTxReceived(mhWallet1, sentTx.hash, 10000); // Multisig transactions take longer

    const historyTx = await mhWallet1.getTx(sentTx.hash);
    expect(historyTx).toMatchObject({
      tx_id: partiallyAssembledTx.hash,
      inputs: [
        expect.objectContaining({
          tx_id: inputTxId,
          value: 10n,
        }),
      ],
    });

    const fullNodeTx = await mhWallet1.getFullTxById(sentTx.hash);
    expect(fullNodeTx.tx).toMatchObject({
      hash: partiallyAssembledTx.hash,
      inputs: [
        expect.objectContaining({
          tx_id: inputTxId,
          value: 10n,
        }),
      ],
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
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 100n);

    // Single input and single output
    const rawSimpleTx = await hWallet.sendManyOutputsTransaction([
      {
        address: await hWallet.getAddressAtIndex(2),
        value: 100n,
        token: NATIVE_TOKEN_UID,
      },
    ]);
    expect(rawSimpleTx).toHaveProperty('hash');
    await waitForTxReceived(hWallet, rawSimpleTx.hash);
    const decodedSimple = await hWallet.getTx(rawSimpleTx.hash);
    expect(decodedSimple.inputs).toHaveLength(1);
    expect(decodedSimple.outputs).toHaveLength(1);

    // Single input and two outputs
    await waitUntilNextTimestamp(hWallet, rawSimpleTx.hash);
    const rawDoubleOutputTx = await hWallet.sendManyOutputsTransaction([
      {
        address: await hWallet.getAddressAtIndex(5),
        value: 60n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: await hWallet.getAddressAtIndex(6),
        value: 40n,
        token: NATIVE_TOKEN_UID,
      },
    ]);
    await waitForTxReceived(hWallet, rawDoubleOutputTx.hash);
    const decodedDoubleOutput = await hWallet.getTx(rawDoubleOutputTx.hash);
    expect(decodedDoubleOutput.inputs).toHaveLength(1);
    expect(decodedDoubleOutput.outputs).toHaveLength(2);
    const largerOutputIndex = decodedDoubleOutput.outputs.findIndex(o => o.value === 60n);

    // Explicit input and three outputs
    await waitUntilNextTimestamp(hWallet, rawDoubleOutputTx.hash);
    const rawExplicitInputTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: await hWallet.getAddressAtIndex(1),
          value: 5n,
          token: NATIVE_TOKEN_UID,
        },
        {
          address: await hWallet.getAddressAtIndex(2),
          value: 35n,
          token: NATIVE_TOKEN_UID,
        },
      ],
      {
        inputs: [
          {
            txId: decodedDoubleOutput.tx_id,
            token: NATIVE_TOKEN_UID,
            index: largerOutputIndex,
          },
        ],
      }
    );
    await waitForTxReceived(hWallet, rawExplicitInputTx.hash);
    const explicitInput = await hWallet.getTx(rawExplicitInputTx.hash);
    expect(explicitInput.inputs).toHaveLength(1);
    expect(explicitInput.outputs).toHaveLength(3);

    // Expect our explicit outputs and an automatic one to complete the 60 HTR input
    expect(explicitInput.outputs).toContainEqual(expect.objectContaining({ value: 5n }));
    expect(explicitInput.outputs).toContainEqual(expect.objectContaining({ value: 35n }));
    // Validate change output
    expect(explicitInput.outputs).toContainEqual(expect.objectContaining({ value: 20n }));
  });

  it('should send transactions with multiple tokens', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Multiple Tokens Tk', 'MTTK', 200n);

    // Generating tx
    const rawSendTx = await hWallet.sendManyOutputsTransaction([
      {
        token: tokenUid,
        value: 110n,
        address: await hWallet.getAddressAtIndex(1),
      },
      {
        token: NATIVE_TOKEN_UID,
        value: 5n,
        address: await hWallet.getAddressAtIndex(2),
      },
    ]);
    await waitForTxReceived(hWallet, rawSendTx.hash);

    // Validating amount of inputs and outputs
    const sendTx = await hWallet.getTx(rawSendTx.hash);
    expect(sendTx.inputs).toHaveLength(2);
    expect(sendTx.outputs).toHaveLength(4);

    // Validating that each of the outputs has the values we expect
    expect(sendTx.outputs).toContainEqual(
      expect.objectContaining({
        value: 3n,
        token: NATIVE_TOKEN_UID,
      })
    );
    expect(sendTx.outputs).toContainEqual(
      expect.objectContaining({
        value: 5n,
        token: NATIVE_TOKEN_UID,
      })
    );
    expect(sendTx.outputs).toContainEqual(
      expect.objectContaining({
        value: 90n,
        token: tokenUid,
      })
    );
    expect(sendTx.outputs).toContainEqual(
      expect.objectContaining({
        value: 110n,
        token: tokenUid,
      })
    );

    // Validating that each of the inputs has the values we expect
    expect(sendTx.inputs).toContainEqual(
      expect.objectContaining({
        value: 8n,
        token: NATIVE_TOKEN_UID,
      })
    );
    expect(sendTx.inputs).toContainEqual(
      expect.objectContaining({
        value: 200n,
        token: tokenUid,
      })
    );
  });

  it('should respect timelocks', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    // Defining timelocks (milliseconds) and timestamps (seconds)
    const startTime = Date.now().valueOf();
    const timelock1 = startTime + 5000; // 5 seconds of locked resources
    const timelock2 = startTime + 8000; // 8 seconds of locked resources
    const timelock1Timestamp = dateFormatter.dateToTimestamp(new Date(timelock1));
    const timelock2Timestamp = dateFormatter.dateToTimestamp(new Date(timelock2));

    const rawTimelockTx = await hWallet.sendManyOutputsTransaction([
      {
        address: await hWallet.getAddressAtIndex(1),
        value: 7n,
        token: NATIVE_TOKEN_UID,
        timelock: timelock1Timestamp,
      },
      {
        address: await hWallet.getAddressAtIndex(1),
        value: 3n,
        token: NATIVE_TOKEN_UID,
        timelock: timelock2Timestamp,
      },
    ]);
    await waitForTxReceived(hWallet, rawTimelockTx.hash);

    // Validating the transaction with getFullHistory / getTx
    const timelockTx = await hWallet.getTx(rawTimelockTx.hash);
    expect(timelockTx.outputs.find(o => o.decoded.timelock === timelock1Timestamp)).toBeDefined();
    expect(timelockTx.outputs.find(o => o.decoded.timelock === timelock2Timestamp)).toBeDefined();

    // Validating getBalance ( moment 0 )
    let htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance).toStrictEqual({ locked: 10n, unlocked: 0n });

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
    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance).toEqual({ locked: 3n, unlocked: 7n });

    // Confirm that the balance is unavailable
    await expect(hWallet.sendTransaction(await hWallet.getAddressAtIndex(3), 8n)).rejects.toThrow(
      'Insufficient'
    );
    // XXX: Error message should show the token identification, not "Token undefined"

    // Validating interfaces with all resources unlocked
    const waitFor2 = timelock2 - Date.now().valueOf() + 1000;
    loggers.test.log(`Will wait for ${waitFor2}ms for timelock2 to expire`);
    await delay(waitFor2);

    // Forcing balance updates
    await hWallet.storage.processHistory();

    // Validating getBalance ( moment 2 )
    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance).toStrictEqual({ locked: 0n, unlocked: 10n });

    // Confirm that now the balance is available
    const sendTx = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(4), 8n);
    expect(sendTx).toHaveProperty('hash');
  });
});

describe('authority utxo selection', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('getMintAuthority', async () => {
    // Setting up the custom token
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to test', 'ATST', 100n);

    // Mark mint authority as selected_as_input
    const [mintInput] = await hWallet.getMintAuthority(tokenUid, { many: false });
    await hWallet.markUtxoSelected(mintInput.txId, mintInput.index, true);

    // getMintAuthority should return even if the utxo is already selected_as_input
    await expect(hWallet.getMintAuthority(tokenUid, { many: false })).resolves.toStrictEqual([
      mintInput,
    ]);
    await expect(
      hWallet.getMintAuthority(tokenUid, { many: false, only_available_utxos: false })
    ).resolves.toStrictEqual([mintInput]);

    // getMintAuthority should not return selected_as_input utxos if only_available_utxos is true
    await expect(
      hWallet.getMintAuthority(tokenUid, { many: false, only_available_utxos: true })
    ).resolves.toStrictEqual([]);
  });

  it('getMeltAuthority', async () => {
    // Setting up the custom token
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to test', 'ATST', 100n);

    // Mark melt authority as selected_as_input
    const [meltInput] = await hWallet.getMeltAuthority(tokenUid, { many: false });
    await hWallet.markUtxoSelected(meltInput.txId, meltInput.index, true);

    // getMeltAuthority should return even if the utxo is already selected_as_input
    await expect(hWallet.getMeltAuthority(tokenUid, { many: false })).resolves.toStrictEqual([
      meltInput,
    ]);
    await expect(
      hWallet.getMeltAuthority(tokenUid, { many: false, only_available_utxos: false })
    ).resolves.toStrictEqual([meltInput]);

    // getMeltAuthority should not return selected_as_input utxos if only_available_utxos is true
    await expect(
      hWallet.getMeltAuthority(tokenUid, { many: false, only_available_utxos: true })
    ).resolves.toStrictEqual([]);
  });
});
