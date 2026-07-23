import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { getRandomInt } from './utils/core.util';
import {
  createTokenHelper,
  DEFAULT_PIN_CODE,
  generateMultisigWalletHelper,
  generateWalletHelper,
  generateWalletHelperRO,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK } from '../../src/constants';
import { TxNotFoundError } from '../../src/errors';
import SendTransaction from '../../src/new/sendTransaction';
import transaction from '../../src/utils/transaction';
import { WalletType } from '../../src/types';
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
    // After mining and pushing, the hash should be set (it was null before mining)
    expect(tx.hash).not.toBeNull();
    expect(typeof tx.nonce).toBe('number');
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

// addresses methods tests moved to shared/addresses.test.ts and fullnode-specific/addresses.test.ts

// getBalance tests moved to shared/get-balance.test.ts and fullnode-specific/get-balance.test.ts

// getTxById, getFullHistory and getTxBalance tests moved to fullnode-specific/history-query.test.ts

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

    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    const fullTx = await hWallet.getFullTxById(tx1.hash);
    expect(fullTx.success).toStrictEqual(true);

    const fullTxKeys = Object.keys(fullTx);
    expect(fullTxKeys).toContain('meta');
    expect(fullTxKeys).toContain('tx');
    expect(fullTxKeys).toContain('success');
    expect(fullTxKeys).toContain('spent_outputs');
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.getFullTxById('invalid-tx-hash')).rejects.toThrow(
      `Invalid transaction invalid-tx-hash`
    );
  });

  it('should throw an error on valid but not found transaction', async () => {
    await expect(
      gWallet.getFullTxById('0011371a7c07f7e8017c52c0a4f5293ccf30c865d96255d1b515f96f7a6a6299')
    ).rejects.toThrow(TxNotFoundError);
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

    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    const confirmationData = await hWallet.getTxConfirmationData(tx1.hash);

    expect(confirmationData.success).toStrictEqual(true);

    const confirmationDataKeys = Object.keys(confirmationData);
    expect(confirmationDataKeys).toContain('accumulated_bigger');
    expect(confirmationDataKeys).toContain('accumulated_weight');
    expect(confirmationDataKeys).toContain('confirmation_level');
    expect(confirmationDataKeys).toContain('success');
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.getTxConfirmationData('invalid-tx-hash')).rejects.toThrow(
      `Invalid transaction invalid-tx-hash`
    );
  });

  it('should throw TxNotFoundError on valid hash but not found transaction', async () => {
    await expect(
      gWallet.getTxConfirmationData(
        '000000000bc8c6fab1b3a5af184cc0e7ff7934c6ad982c8bea9ab5006ae1bafc'
      )
    ).rejects.toThrow(TxNotFoundError);
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
    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );
    const neighborsData = await hWallet.graphvizNeighborsQuery(tx1.hash, 'funds', 1);

    expect(neighborsData).toMatch(/digraph {/);
  });

  it('should capture errors when graphviz returns error', async () => {
    const hWallet = await generateWalletHelper();
    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    await expect(hWallet.graphvizNeighborsQuery(tx1.hash)).rejects.toThrow(
      'Request failed with status code 500'
    );
  });

  it('should throw an error if success is false on response', async () => {
    await expect(gWallet.graphvizNeighborsQuery('invalid-tx-hash')).rejects.toThrow(
      `Invalid transaction invalid-tx-hash`
    );
  });

  it('should throw TxNotFoundError on valid but not found transaction', async () => {
    await expect(
      gWallet.graphvizNeighborsQuery(
        '000000000bc8c6fab1b3a5af184cc0e7ff7934c6ad982c8bea9ab5006ae1bafc'
      )
    ).rejects.toThrow(TxNotFoundError);
  });
});

// sendTransaction tests moved to:
//   shared/send-transaction.test.ts, shared/send-transaction-tokens.test.ts,
//   fullnode-specific/send-transaction.test.ts
// sendManyOutputsTransaction tests moved to shared/send-many-outputs.test.ts

// authority utxo selection tests moved to fullnode-specific/authority-utxos.test.ts
// createNewToken tests moved to shared/create-token.test.ts and
// fullnode-specific/create-token.test.ts (including the FEE-token variants)
// mintTokens, delegateAuthority and destroyAuthority tests moved to
// shared/token-authority.test.ts; mint data-output cases moved to
// fullnode-specific/mint-tokens.test.ts

describe('meltTokens', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should melt tokens', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 15n);

    // Creating the token
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to Melt', 'TMELT', 500n);

    // Should not melt more than there is available
    await expect(hWallet.meltTokens(tokenUid, 999n)).rejects.toThrow(
      'Not enough tokens to melt: 999 requested, 500 available'
    );

    // Melting some tokens
    const meltAmount = BigInt(getRandomInt(99, 10));
    const { hash } = await hWallet.meltTokens(tokenUid, meltAmount);
    await waitForTxReceived(hWallet, hash);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(tokenUid);
    const expectedAmount = 500n - meltAmount;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);

    // Melt tokens with defined melt authority address
    const address0 = await hWallet.getAddressAtIndex(0);
    const meltResponse = await hWallet.meltTokens(tokenUid, 100n, {
      meltAuthorityAddress: address0,
    });
    await waitForTxReceived(hWallet, meltResponse.hash);

    // Validating a new melt authority was created by default
    const authorityOutputs = meltResponse.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(1);
    const authorityOutput = authorityOutputs[0];
    expect(authorityOutput.value).toEqual(TOKEN_MELT_MASK);
    const p2pkh = authorityOutput.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p2pkh.address.base58).toEqual(address0);

    // Validating custom token balance
    const tokenBalance2 = await hWallet.getBalance(tokenUid);
    const expectedAmount2 = expectedAmount - 100n;
    expect(tokenBalance2[0]).toHaveProperty('balance.unlocked', expectedAmount2);

    // Melt tokens with external address should return error
    const hWallet2 = await generateWalletHelper();
    const externalAddress = await hWallet2.getAddressAtIndex(0);

    await expect(
      hWallet.meltTokens(tokenUid, 100n, { meltAuthorityAddress: externalAddress })
    ).rejects.toThrow('must belong to your wallet');

    // Melt tokens with external address but allowing it
    const meltResponse3 = await hWallet.meltTokens(tokenUid, 100n, {
      meltAuthorityAddress: externalAddress,
      allowExternalMeltAuthorityAddress: true,
    });
    await waitForTxReceived(hWallet, meltResponse3.hash);
    await waitForTxReceived(hWallet2, meltResponse3.hash);

    // Validating a new melt authority was created by default
    const authorityOutputs3 = meltResponse3.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs3).toHaveLength(1);
    const authorityOutput3 = authorityOutputs3[0];
    expect(authorityOutput3.value).toEqual(TOKEN_MELT_MASK);
    const p3pkh = authorityOutput3.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p3pkh.address.base58).toEqual(externalAddress);

    // Validating custom token balance
    const tokenBalance3 = await hWallet.getBalance(tokenUid);
    const expectedAmount3 = expectedAmount2 - 100n;
    expect(tokenBalance3[0]).toHaveProperty('balance.unlocked', expectedAmount3);

    // Delegate melt back to wallet 1
    const delegateResponse = await hWallet2.delegateAuthority(tokenUid, 'melt', address0);
    expect(delegateResponse.hash).toBeDefined();
    await waitForTxReceived(hWallet, delegateResponse.hash);
    await waitForTxReceived(hWallet2, delegateResponse.hash);

    const meltResponse4 = await hWallet.meltTokens(tokenUid, 100n, { data: ['foobar'] });
    expect(meltResponse4.hash).toBeDefined();
    await waitForTxReceived(hWallet, meltResponse4.hash);

    // Validating there is a correct reference to the custom token
    expect(meltResponse4).toHaveProperty('tokens.length', 1);
    expect(meltResponse4.tokens[0]).toEqual(tokenUid);

    // Validating custom token balance
    const tokenBalance4 = await hWallet.getBalance(tokenUid);
    const expectedAmount4 = expectedAmount3 - 100n;
    expect(tokenBalance4[0]).toHaveProperty('balance.unlocked', expectedAmount4);

    const dataOutput4 = meltResponse4.outputs[meltResponse4.outputs.length - 1];
    expect(dataOutput4).toHaveProperty('value', 1n);
    expect(dataOutput4).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));

    const meltResponse5 = await hWallet.meltTokens(tokenUid, 100n, {
      unshiftData: true,
      data: ['foobar'],
    });
    expect(meltResponse5.hash).toBeDefined();
    await waitForTxReceived(hWallet, meltResponse5.hash);

    // Validating there is a correct reference to the custom token
    expect(meltResponse5).toHaveProperty('tokens.length', 1);
    expect(meltResponse5.tokens[0]).toEqual(tokenUid);

    // Validating custom token balance
    const tokenBalance5 = await hWallet.getBalance(tokenUid);
    const expectedAmount5 = expectedAmount4 - 100n;
    expect(tokenBalance5[0]).toHaveProperty('balance.unlocked', expectedAmount5);

    const dataOutput5 = meltResponse5.outputs[0];
    expect(dataOutput5).toHaveProperty('value', 1n);
    expect(dataOutput5).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));
  });

  it('should recover correct amount of HTR on melting', async () => {
    /**
     *
     * @param {HathorWallet} hWallet
     * @returns {Promise<number>}
     */
    async function getHtrBalance(hWallet) {
      const [htrBalance] = await hWallet.getBalance(NATIVE_TOKEN_UID);
      return htrBalance.balance.unlocked;
    }

    // Setting up scenario
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 20n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to Melt', 'TMELT', 1900n);
    let expectedHtrFunds = 1n;

    let meltResponse;
    // Melting less than 1.00 tokens recovers 0 HTR
    meltResponse = await hWallet.meltTokens(tokenUid, 99n);
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting exactly 1.00 tokens recovers 0.01 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 100n);
    expectedHtrFunds += 1n;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting between 1.00 and 2.00 tokens recovers 0.01 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 199n);
    expectedHtrFunds += 1n;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting exactly 2.00 tokens recovers 0.02 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 200n);
    expectedHtrFunds += 2n;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting between 2.00 and 3.00 tokens recovers 0.02 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 299n);
    expectedHtrFunds += 2n;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);
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
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Signatures token', 'SIGT', 100n);

    const network = hWallet.getNetworkObject();
    // Build a Transaction to sign
    let sendTransaction = new SendTransaction({
      storage: hWallet.storage,
      outputs: [
        { address: await hWallet.getAddressAtIndex(5), value: 5n, token: NATIVE_TOKEN_UID },
        { address: await hWallet.getAddressAtIndex(6), value: 100n, token: tokenUid },
      ],
    });
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
    const tx1 = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );
    txHistory = await hWallet.getTxHistory();
    expect(txHistory).toStrictEqual([
      expect.objectContaining({
        txId: tx1.hash,
      }),
    ]);

    // HTR internal transfer
    const tx2 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(1), 4n);
    await waitForTxReceived(hWallet, tx2.hash);
    txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(2);

    // HTR external transfer
    await waitUntilNextTimestamp(hWallet, tx2.hash);
    const tx3 = await hWallet.sendTransaction(await gWallet.getAddressAtIndex(0), 3n);
    await waitForTxReceived(hWallet, tx3.hash);
    await waitForTxReceived(gWallet, tx3.hash);
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
      skip: 1,
    });
    expect(txHistory.length).toEqual(2);
  });

  it('should show custom token transactions in correct order', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    let txHistory = await hWallet.getTxHistory({
      token_id: fakeTokenUid,
    });
    expect(txHistory).toHaveLength(0);

    const { hash: tokenUid } = await createTokenHelper(hWallet, 'txHistory Token', 'TXHT', 100n);

    // Custom token creation
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(1);
    expect(txHistory[0].txId).toEqual(tokenUid);

    // Custom token internal transfer
    const { hash: tx1Hash } = await hWallet.sendTransaction(
      await hWallet.getAddressAtIndex(0),
      10n,
      { token: tokenUid }
    );
    await waitForTxReceived(hWallet, tx1Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(2);

    // Custom token external transfer
    await waitUntilNextTimestamp(hWallet, tx1Hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      await gWallet.getAddressAtIndex(0),
      10n,
      { token: tokenUid }
    );
    await waitForTxReceived(hWallet, tx2Hash);
    await waitForTxReceived(gWallet, tx2Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(3);

    // Custom token melting
    await waitUntilNextTimestamp(hWallet, tx2Hash);
    const { hash: tx3Hash } = await hWallet.meltTokens(tokenUid, 20n);
    await waitForTxReceived(hWallet, tx3Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(4);

    // Custom token minting
    await waitUntilNextTimestamp(hWallet, tx3Hash);
    const { hash: tx4Hash } = await hWallet.mintTokens(tokenUid, 30n);
    await waitForTxReceived(hWallet, tx4Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(5);

    // Count option
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      count: 3,
    });
    expect(txHistory.length).toEqual(3);

    // Skip option
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      skip: 3,
    });
    expect(txHistory.length).toEqual(2);

    // Count + Skip options
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      skip: 2,
      count: 2,
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

  it('should return if the wallet is a hardware wallet', async () => {
    const hWallet = await generateWalletHelper();
    await expect(hWallet.isHardwareWallet()).resolves.toBe(false);

    const hWalletRO = await generateWalletHelperRO({ hardware: true });
    await expect(hWalletRO.isHardwareWallet()).resolves.toBe(true);
  });
});
