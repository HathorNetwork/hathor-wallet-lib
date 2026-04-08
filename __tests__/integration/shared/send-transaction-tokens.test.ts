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
import FeeHeader from '../../../src/headers/fee';
import Header from '../../../src/headers/base';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

/**
 * Validates that the fee header contains exactly one entry with the expected amount.
 * Asserts a single entry to avoid silently summing fees across tokens with
 * different denominations (e.g., 1 HTR ≠ 100 of another token).
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
    const wallet = created.wallet;
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
    const { wallet, externalWallet } = await createFundedPair(10n);
    const { hash: tokenUid } = await adapter.createToken(wallet, 'Token to Send', 'TTS', 100n);

    await adapter.sendTransaction(wallet, (await wallet.getAddressAtIndex(5))!, 30n, {
      token: tokenUid,
      changeAddress: (await wallet.getAddressAtIndex(6))!,
    });

    const tokenBalance = await wallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toEqual(100n);

    const externalAddr = (await externalWallet.getAddressAtIndex(0))!;
    const { hash: externalTxHash } = await adapter.sendTransaction(wallet, externalAddr, 80n, {
      token: tokenUid,
    });
    await adapter.waitForTx(externalWallet, externalTxHash);

    const remainingBalance = await wallet.getBalance(tokenUid);
    expect(remainingBalance[0].balance.unlocked).toEqual(20n);
  });

  it('should send custom fee token transactions', async () => {
    // 10n HTR: 1n non-refundable deposit (createToken) + 2n fee × 2 sends = 5n spent → 5n remaining
    const { wallet, externalWallet } = await createFundedPair(10n);
    const { hash: tokenUid } = await adapter.createToken(wallet, 'FeeBasedToken', 'FBT', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });

    const { transaction: tx1 } = await adapter.sendTransaction(
      wallet,
      (await wallet.getAddressAtIndex(5))!,
      8000n,
      { token: tokenUid, changeAddress: (await wallet.getAddressAtIndex(6))! }
    );
    validateFeeAmount(tx1.headers, 2n);

    let fbtBalance = await wallet.getBalance(tokenUid);
    expect(fbtBalance[0].balance.unlocked).toEqual(8582n);

    const { transaction: tx2 } = await adapter.sendTransaction(
      wallet,
      (await externalWallet.getAddressAtIndex(0))!,
      82n,
      { token: tokenUid }
    );
    validateFeeAmount(tx2.headers, 2n);

    fbtBalance = await wallet.getBalance(tokenUid);
    expect(fbtBalance[0].balance.unlocked).toEqual(8500n);

    const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(5n);
  });

  it('should pay only 1 HTR fee when sending entire fee token UTXO (no change output)', async () => {
    const { wallet } = await createFundedPair(10n);
    const { hash: tokenUid } = await adapter.createToken(wallet, 'FeeTokenNoChange', 'FTNC', 200n, {
      tokenVersion: TokenVersion.FEE,
    });

    // Send the entire token balance so there is no change output — only 1 token output
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

    // 10 HTR - 1 non-refundable deposit (createToken) - 1 fee = 8 HTR remaining
    const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(8n);
  });

  it('should pay 5 HTR fee when spreading fee token across 5 outputs with no change', async () => {
    const { wallet } = await createFundedPair(10n);
    const { hash: tokenUid } = await adapter.createToken(wallet, 'FeeToken5Out', 'FT5O', 500n, {
      tokenVersion: TokenVersion.FEE,
    });

    // Spread the entire 500n supply across 5 outputs (100n each) — no change
    const outputs = await Promise.all(
      [1, 2, 3, 4, 5].map(async i => ({
        address: (await wallet.getAddressAtIndex(i))!,
        value: 100n,
        token: tokenUid,
      }))
    );

    const { transaction: tx } = await adapter.sendManyOutputsTransaction(wallet, outputs);
    validateFeeAmount(tx.headers, 5n);

    const fullTx = await adapter.getFullTxById(wallet, tx.hash!);
    const tokenOutputs = fullTx.tx.outputs.filter(
      (o: { token_data: number }) => o.token_data !== 0
    );
    expect(tokenOutputs).toHaveLength(5);
    tokenOutputs.forEach((o: { value: bigint }) => expect(o.value).toBe(100n));

    // 10 HTR - 1 non-refundable deposit (createToken) - 5 fee = 4 HTR remaining
    const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(4n);
  });

  // Skipped: SendTransactionWalletService.prepareTx() builds utxosAddressPath
  // in [token, htr] order regardless of this.inputs order, causing wrong
  // signatures when HTR inputs come before token inputs. See #1057.
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('should send fee token with manually provided HTR input — HTR first (broken signing)', async () => {
    const { wallet } = await createFundedPair(10n);
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
    // Inputs are listed token-first to match the internal processing order
    // of SendTransactionWalletService.prepareTx(), which builds address
    // paths as [custom_tokens..., htr...]. See #1057 for the underlying bug.
    const { wallet } = await createFundedPair(10n);
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
      expect.objectContaining({ value: 50n, token_data: 1 })
    );
  });
});
