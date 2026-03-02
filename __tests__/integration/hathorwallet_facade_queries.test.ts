import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { getRandomInt } from './utils/core.util';
import {
  createTokenHelper,
  generateMultisigWalletHelper,
  generateWalletHelper,
  generateWalletHelperRO,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import HathorWallet from '../../src/new/wallet';
import {
  NATIVE_TOKEN_UID,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../../src/constants';
import { TOKEN_DATA } from './configuration/test-constants';
import { TxNotFoundError } from '../../src/errors';
import transaction from '../../src/utils/transaction';
import { WalletType } from '../../src/types';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

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
    const balance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(balance).toHaveLength(1);
    expect(balance[0]).toMatchObject({
      token: { id: NATIVE_TOKEN_UID },
      balance: { unlocked: 0n, locked: 0n },
      transactions: 0,
    });

    // Generating one transaction to validate its effects
    const injectedValue = BigInt(getRandomInt(10, 2));
    await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      injectedValue
    );

    // Validating the transaction effects
    const balance1 = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(balance1[0]).toMatchObject({
      balance: { unlocked: injectedValue, locked: 0n },
      transactions: expect.any(Number),
      // transactions: 1, // TODO: The amount of transactions is often 2 but should be 1. Ref #397
    });

    // Transferring tokens inside the wallet should not change the balance
    const tx1 = await hWallet.sendTransaction(await hWallet.getAddressAtIndex(1), 2n);
    await waitForTxReceived(hWallet, tx1.hash);
    const balance2 = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(balance2[0].balance).toEqual(balance1[0].balance);
  });

  it('should get the balance for a custom token', async () => {
    const hWallet = await generateWalletHelper();

    // Validating results for a nonexistant token
    const emptyBalance = await hWallet.getBalance(fakeTokenUid);
    expect(emptyBalance).toHaveLength(1);
    expect(emptyBalance[0]).toMatchObject({
      token: { id: fakeTokenUid },
      balance: { unlocked: 0n, locked: 0n },
      transactions: 0,
    });

    // Creating a new custom token
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const newTokenAmount = BigInt(getRandomInt(1000, 10));
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'BalanceToken',
      'BAT',
      newTokenAmount
    );

    const tknBalance = await hWallet.getBalance(tokenUid);
    expect(tknBalance[0]).toMatchObject({
      balance: { unlocked: newTokenAmount, locked: 0n },
      transactions: expect.any(Number),
      // transactions: 1, // TODO: The amount of transactions is often 8 but should be 1. Ref #397
    });

    // Validating that a different wallet (genesis) has no access to this token
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
    const { hash: fundTxId } = await GenesisWalletHelper.injectFunds(
      hWallet,
      fundDestinationAddress,
      10n
    );

    // Validating the full history increased in one
    await expect(hWallet.storage.store.historyCount()).resolves.toEqual(1);

    // Moving the funds inside this wallet so that we have every information about the tx
    const txDestinationAddress = await hWallet.getAddressAtIndex(5);
    const txChangeAddress = await hWallet.getAddressAtIndex(8);
    const txValue = 6n;
    const rawMoveTx = await hWallet.sendTransaction(txDestinationAddress, txValue, {
      changeAddress: txChangeAddress,
    });
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
        token: NATIVE_TOKEN_UID,
        token_data: TOKEN_DATA.HTR,
        script: expect.any(String),
        value: 10n,
        decoded: { type: 'P2PKH', address: fundDestinationAddress },
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
        token: NATIVE_TOKEN_UID,
        script: expect.any(String),
        decoded: {
          type: 'P2PKH',
          address: outputObj.value === txValue ? txDestinationAddress : txChangeAddress,
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
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const tokenName = 'Full History Token';
    const tokenSymbol = 'FHT';
    const { hash: tokenUid } = await createTokenHelper(hWallet, tokenName, tokenSymbol, 100n);

    const history = await hWallet.getFullHistory();
    expect(Object.keys(history)).toHaveLength(2);

    // Validating create token properties ( all others have been validated on the previous test )
    expect(history).toHaveProperty(tokenUid);
    const createTx = history[tokenUid];

    // Validating basic token creation properties
    expect(createTx).toMatchObject({
      token_name: tokenName,
      token_symbol: tokenSymbol,
      inputs: [
        {
          token: NATIVE_TOKEN_UID,
          token_data: TOKEN_DATA.HTR,
          value: 10n,
        },
      ],
    });

    // Validating outputs
    expect(createTx.outputs).toHaveLength(4);
    const changeOutput = createTx.outputs.find(o => o.value === 9n);
    expect(changeOutput).toMatchObject({
      token: NATIVE_TOKEN_UID,
      token_data: TOKEN_DATA.HTR,
    });

    const tokenOutput = createTx.outputs.find(o => o.value === 100n);
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
      hWallet,
      await hWallet.getAddressAtIndex(0),
      10n
    );

    // Validating tx balance for a transaction with a single token (htr)
    const tx1 = await hWallet.getTx(tx1Hash);
    let txBalance = await hWallet.getTxBalance(tx1);
    expect(txBalance).toEqual({
      [NATIVE_TOKEN_UID]: 10n,
    });

    // Validating tx balance for a transaction with two tokens (htr+custom)
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'txBalance Token', 'TXBT', 100n);
    const tokenCreationTx = await hWallet.getTx(tokenUid);
    txBalance = await hWallet.getTxBalance(tokenCreationTx);
    expect(txBalance).toEqual({
      [tokenUid]: 100n,
      [NATIVE_TOKEN_UID]: -1n,
    });

    // Validating that the option to include authority tokens does not change the balance
    txBalance = await hWallet.getTxBalance(tokenCreationTx, { includeAuthorities: true });
    expect(txBalance).toEqual({
      [tokenUid]: 100n,
      [NATIVE_TOKEN_UID]: -1n,
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
    expect(txBalance).toHaveProperty(tokenUid, 0n);

    // Validating that transactions inside a wallet have zero txBalance
    await waitUntilNextTimestamp(hWallet, delegateTxHash);
    const { hash: sameWalletTxHash } = await hWallet.sendManyOutputsTransaction([
      {
        address: await hWallet.getAddressAtIndex(0),
        value: 5n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: await hWallet.getAddressAtIndex(1),
        value: 50n,
        token: tokenUid,
      },
    ]);
    await waitForTxReceived(hWallet, sameWalletTxHash);

    const sameWalletTx = await hWallet.getTx(sameWalletTxHash);
    txBalance = await hWallet.getTxBalance(sameWalletTx);
    expect(Object.keys(txBalance)).toHaveLength(2);
    expect(txBalance[NATIVE_TOKEN_UID]).toEqual(0n);
    expect(txBalance).toHaveProperty(tokenUid, 0n);
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
    // XXX: gWallet.stop({ cleanStorage, cleanAddresses }) kills the genesis singleton for this worker
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
