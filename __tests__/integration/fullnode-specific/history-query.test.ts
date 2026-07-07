/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade transaction-history query tests: getTxById, getFullHistory,
 * and getTxBalance.
 *
 * These stay fullnode-specific because of concrete wallet-service divergences:
 * - `getFullHistory()` throws `Not implemented` on HathorWalletServiceWallet
 *   (src/wallet/wallet.ts), so any test that reads the full local history is
 *   fullnode-only.
 * - `getTxById()` exists on both facades but the fullnode facade computes the
 *   result locally from `getFullTxById()` + `getTxBalance()`; these tests
 *   `jest.spyOn` those internal methods and assert the fullnode-produced error
 *   messages, none of which apply to the wallet-service backend endpoint.
 * - `getTxBalance()` exists on the wallet-service facade, but these tests build
 *   its `IHistoryTx` argument via `getTx()`, which throws `Not implemented` on
 *   the wallet-service facade, and exercise `delegateAuthority` besides.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { delay, getRandomInt } from '../utils/core.util';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../../src/constants';
import { TOKEN_DATA } from '../configuration/test-constants';
import transaction from '../../../src/utils/transaction';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('[Fullnode] getTxById', () => {
  afterEach(async () => {
    await stopAllWallets();
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

describe('[Fullnode] getFullHistory', () => {
  afterEach(async () => {
    await stopAllWallets();
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

describe('[Fullnode] getTxBalance', () => {
  afterEach(async () => {
    await stopAllWallets();
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
