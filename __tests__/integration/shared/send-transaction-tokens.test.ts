/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared custom token and fee token sendTransaction tests.
 *
 * Validates token creation, custom token sends, and fee token behavior that
 * is common to both the fullnode ({@link HathorWallet}) and wallet-service
 * ({@link HathorWalletServiceWallet}) facades.
 */

import type { IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import { TokenVersion } from '../../../src/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';
import { TOKEN_DATA } from '../configuration/test-constants';
import FeeHeader from '../../../src/headers/fee';
import Header from '../../../src/headers/base';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

/**
 * Validates that the fee header contains exactly one entry with the expected amount.
 * This is the expected result for createToken / sendTransaction methods, which interact with only
 * one token per tx.
 */
function validateFeeAmount(headers: Header[], expectedFee: bigint) {
  const feeHeaders = headers.filter(h => h instanceof FeeHeader);
  expect(feeHeaders).toHaveLength(1);
  const { entries } = feeHeaders[0] as FeeHeader;
  expect(entries).toHaveLength(1);
  expect(entries[0].amount).toBe(expectedFee);
}

describe.each(adapters)('[Shared] sendTransaction — custom tokens — $name', adapter => {
  /** Creates a funded wallet and an external wallet for receiving. */
  async function createFundedPair(htrAmount: bigint) {
    const created = await adapter.createWallet();
    const { wallet } = created;
    await adapter.injectFunds(wallet, (await wallet.getAddressAtIndex(0))!, htrAmount);
    const ext = (await adapter.createWallet()).wallet;
    return { wallet, externalWallet: ext };
  }

  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  it('should send custom token transactions', async () => {
    // wallet: 10n HTR
    const { wallet, externalWallet } = await createFundedPair(10n);
    // 100n DBT created, 1n HTR deposit deducted
    const { hash: tokenUid } = await adapter.createToken(wallet, 'DepositBasedToken', 'DBT', 100n);

    // Self-send 30n DBT, total DBT unchanged
    await adapter.sendTransaction(wallet, (await wallet.getAddressAtIndex(5))!, 30n, {
      token: tokenUid,
      changeAddress: (await wallet.getAddressAtIndex(6))!,
    });

    // 100n DBT remaining (self-send doesn't change balance)
    const tokenBalance = await wallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toEqual(100n);

    // Sends 80n DBT to external wallet
    const externalAddr = (await externalWallet.getAddressAtIndex(0))!;
    await adapter.sendTransaction(wallet, externalAddr, 80n, {
      token: tokenUid,
      recvWallet: externalWallet,
    });

    // 20n DBT remaining after sending 80n to external wallet
    const remainingBalance = await wallet.getBalance(tokenUid);
    expect(remainingBalance[0].balance.unlocked).toEqual(20n);

    // External wallet received 80n DBT
    const externalBalance = await externalWallet.getBalance(tokenUid);
    expect(externalBalance[0].balance.unlocked).toEqual(80n);
  });

  it('should send custom fee token transactions', async () => {
    const { wallet, externalWallet } = await createFundedPair(10n);
    // Spends 1n HTR as fee, 9n HTR remaining
    const { hash: tokenUid } = await adapter.createToken(wallet, 'FeeBasedToken', 'FBT', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });

    // Spends 2n HTR as fee, 7n HTR remaining
    const { transaction: tx1 } = await adapter.sendTransaction(
      wallet,
      (await wallet.getAddressAtIndex(5))!,
      8000n,
      { token: tokenUid, changeAddress: (await wallet.getAddressAtIndex(6))! }
    );
    validateFeeAmount(tx1.headers, 2n);

    // Full FBT and 7n HTR remaining after first send
    let fbtBalance = await wallet.getBalance(tokenUid);
    expect(fbtBalance[0].balance.unlocked).toEqual(8582n);

    // Spends 2n HTR as fee, 5n HTR remaining
    const { transaction: tx2 } = await adapter.sendTransaction(
      wallet,
      (await externalWallet.getAddressAtIndex(0))!,
      82n,
      { token: tokenUid }
    );
    validateFeeAmount(tx2.headers, 2n);

    // 8500n FBT remaining on original wallet after second send
    fbtBalance = await wallet.getBalance(tokenUid);
    expect(fbtBalance[0].balance.unlocked).toEqual(8500n);

    // 5n HTR remaining after both sends
    const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(5n);
  });

  it('should pay only 1 HTR fee when sending entire fee token UTXO (no change output)', async () => {
    // wallet: 10n HTR
    const { wallet } = await createFundedPair(10n);
    // Spends 1n HTR as fee, 9n HTR remaining. 200n FTNC created
    const { hash: tokenUid } = await adapter.createToken(wallet, 'FeeTokenNoChange', 'FTNC', 200n, {
      tokenVersion: TokenVersion.FEE,
    });

    // Sends entire 200n FTNC (no change output = 1 token output), spends 1n HTR as fee, 8n HTR remaining
    const { transaction: tx } = await adapter.sendTransaction(
      wallet,
      (await wallet.getAddressAtIndex(5))!,
      200n,
      { token: tokenUid }
    );
    validateFeeAmount(tx.headers, 1n);

    const fullTx = await adapter.getFullTxById(wallet, tx.hash!);
    // Exactly one token output (destination, no change)
    const tokenOutputs = fullTx.tx.outputs.filter(
      (o: { token_data: number }) => o.token_data !== 0
    );
    expect(tokenOutputs).toHaveLength(1);
    expect(tokenOutputs[0].value).toBe(200n);

    // 8n HTR remaining after createToken (1n fee) + send (1n fee)
    const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(8n);
  });

  it('should pay 5 HTR fee when spreading fee token across 5 outputs with no change', async () => {
    // wallet: 10n HTR
    const { wallet } = await createFundedPair(10n);
    // Spends 1n HTR as fee, 9n HTR remaining. 500n FT5O created
    const { hash: tokenUid } = await adapter.createToken(wallet, 'FeeToken5Out', 'FT5O', 500n, {
      tokenVersion: TokenVersion.FEE,
    });

    // Spreads entire 500n FT5O across 5 outputs (100n each), no change output
    const outputs = await Promise.all(
      [1, 2, 3, 4, 5].map(async i => ({
        address: (await wallet.getAddressAtIndex(i))!,
        value: 100n,
        token: tokenUid,
      }))
    );

    // 5 token outputs × 1n HTR each = 5n HTR fee, 4n HTR remaining
    const { transaction: tx } = await adapter.sendManyOutputsTransaction(wallet, outputs);
    validateFeeAmount(tx.headers, 5n);

    const fullTx = await adapter.getFullTxById(wallet, tx.hash!);
    const tokenOutputs = fullTx.tx.outputs.filter(
      (o: { token_data: number }) => o.token_data !== 0
    );
    expect(tokenOutputs).toHaveLength(5);
    tokenOutputs.forEach((o: { value: bigint }) => expect(o.value).toBe(100n));

    // 4n HTR remaining after createToken (1n fee) + send (5n fee)
    const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(4n);
  });

  it('should send fee token with manually provided HTR input — HTR first', async () => {
    // wallet: 10n HTR
    const { wallet } = await createFundedPair(10n);
    // Spends 1n HTR as fee, 9n HTR remaining. 100n FTMI created
    const { hash: tokenUid } = await adapter.createToken(
      wallet,
      'FeeTokenManualInput',
      'FTMI',
      100n,
      {
        tokenVersion: TokenVersion.FEE,
      }
    );

    const { utxos: utxosHtr } = await adapter.getUtxos(wallet, { token: NATIVE_TOKEN_UID });
    const { utxos: utxosToken } = await adapter.getUtxos(wallet, { token: tokenUid });

    const htrUtxo = utxosHtr[0];
    const tokenUtxo = utxosToken[0];

    // Sends 50n FTMI with manual inputs (HTR first), spends 2n HTR as fee, 7n HTR remaining
    const { transaction: tx } = await adapter.sendManyOutputsTransaction(
      wallet,
      [{ address: (await wallet.getAddressAtIndex(5))!, value: 50n, token: tokenUid }],
      {
        inputs: [
          { txId: htrUtxo.tx_id, token: NATIVE_TOKEN_UID, index: htrUtxo.index },
          { txId: tokenUtxo.tx_id, token: tokenUid, index: tokenUtxo.index },
        ],
      }
    );
    validateFeeAmount(tx.headers, 2n);

    const fullTx = await adapter.getFullTxById(wallet, tx.hash!);
    expect(fullTx.tx.inputs).toHaveLength(2);
    expect(fullTx.tx.outputs).toContainEqual(
      expect.objectContaining({ value: 50n, token_data: 1 })
    );
  });

  it('should send fee token with manually provided inputs (token before HTR)', async () => {
    // Companion to the HTR-first case above; covers the symmetric ordering
    // to guard against regressions in input-order-dependent signing.
    // wallet: 10n HTR
    const { wallet } = await createFundedPair(10n);
    // Spends 1n HTR as fee, 9n HTR remaining. 100n FTMI created
    const { hash: tokenUid } = await adapter.createToken(
      wallet,
      'FeeTokenManualInput',
      'FTMI',
      100n,
      {
        tokenVersion: TokenVersion.FEE,
      }
    );

    const { utxos: utxosHtr } = await adapter.getUtxos(wallet, { token: NATIVE_TOKEN_UID });
    const { utxos: utxosToken } = await adapter.getUtxos(wallet, { token: tokenUid });

    const htrUtxo = utxosHtr[0];
    const tokenUtxo = utxosToken[0];

    // Sends 50n FTMI with manual inputs (token first), spends 2n HTR as fee, 7n HTR remaining
    const { transaction: tx } = await adapter.sendManyOutputsTransaction(
      wallet,
      [{ address: (await wallet.getAddressAtIndex(5))!, value: 50n, token: tokenUid }],
      {
        inputs: [
          { txId: tokenUtxo.tx_id, token: tokenUid, index: tokenUtxo.index },
          { txId: htrUtxo.tx_id, token: NATIVE_TOKEN_UID, index: htrUtxo.index },
        ],
      }
    );
    validateFeeAmount(tx.headers, 2n);

    const fullTx = await adapter.getFullTxById(wallet, tx.hash!);
    expect(fullTx.tx.inputs).toHaveLength(2);
    expect(fullTx.tx.outputs).toContainEqual(
      expect.objectContaining({ value: 50n, token_data: TOKEN_DATA.TOKEN })
    );
  });
});
