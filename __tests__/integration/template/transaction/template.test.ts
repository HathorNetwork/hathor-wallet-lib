import { GenesisWalletHelper } from '../../helpers/genesis-wallet.helper';
import {
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from '../../helpers/wallet.helper';

import HathorWallet from '../../../../src/new/wallet';
import SendTransaction from '../../../../src/new/sendTransaction';
import transactionUtils from '../../../../src/utils/transaction';
import { TransactionTemplateBuilder } from '../../../../src/template/transaction/builder';
import { WalletTxTemplateInterpreter } from '../../../../src/template/transaction/interpreter';

const DEBUG = true;

describe('Template execution', () => {
  let hWallet: HathorWallet;
  let interpreter: WalletTxTemplateInterpreter;
  let tokenUid: string;

  beforeAll(async () => {
    hWallet = await generateWalletHelper(null);
    interpreter = new WalletTxTemplateInterpreter(hWallet);
    const address = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address, 10n, {});
  });

  afterAll(async () => {
    await hWallet.stop();
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should be able to create a custom token', async () => {
    const template = new TransactionTemplateBuilder()
      .addConfigAction({ tokenName: 'Tmpl Test Token 01', tokenSymbol: 'TTT01' })
      .addSetVarAction({ name: 'addr', action: 'get_wallet_address' })
      .addUtxoSelect({ fill: 1 })
      .addTokenOutput({ address: '{addr}', amount: 100, useCreatedToken: true })
      .addAuthorityOutput({ authority: 'mint', address: '{addr}', useCreatedToken: true, count: 5 })
      .addAuthorityOutput({ authority: 'melt', address: '{addr}', useCreatedToken: true, count: 5 })
      .build();

    const tx = await interpreter.build(template, DEBUG);
    await transactionUtils.signTransaction(tx, hWallet.storage, DEFAULT_PIN_CODE);
    tx.prepareToSend();
    const sendTx = new SendTransaction({ storage: hWallet.storage, transaction: tx });
    await sendTx.runFromMining();
    if (tx.hash === null) {
      throw new Error('Transaction does not have a hash');
    }
    tokenUid = tx.hash;
    await waitForTxReceived(hWallet, tx.hash, null);

    expect(tx.outputs).toHaveLength(12);

    // HTR change
    expect(tx.outputs[0].tokenData).toBe(0);
    expect(tx.outputs[0].value).toBe(9n);

    // Created token
    expect(tx.outputs[1].tokenData).toBe(1);
    expect(tx.outputs[1].value).toBe(100n);

    // 5 mint authorities
    expect(tx.outputs[2].tokenData).toBe(129);
    expect(tx.outputs[2].value).toBe(1n);
    expect(tx.outputs[6].tokenData).toBe(129);
    expect(tx.outputs[6].value).toBe(1n);

    // 5 melt authorities
    expect(tx.outputs[7].tokenData).toBe(129);
    expect(tx.outputs[7].value).toBe(2n);
    expect(tx.outputs[11].tokenData).toBe(129);
    expect(tx.outputs[11].value).toBe(2n);
  });

  it('should be able to send tokens and authorities', async () => {
    const address = await hWallet.getAddressAtIndex(10);
    const template = new TransactionTemplateBuilder()
      .addSetVarAction({ name: 'addr', value: address })
      .addSetVarAction({ name: 'token', value: tokenUid })
      .addUtxoSelect({ fill: 2 })
      .addTokenOutput({ address: '{addr}', amount: 2 })
      .addUtxoSelect({ fill: 3, token: '{token}' })
      .addTokenOutput({ address: '{addr}', amount: 3, token: '{token}' })
      .addAuthoritySelect({ authority: 'mint', token: '{token}', count: 1 })
      .addAuthorityOutput({ address: '{addr}', authority: 'mint', count: 1, token: '{token}' })
      .addAuthoritySelect({ authority: 'melt', token: '{token}', count: 2 })
      .addAuthorityOutput({ address: '{addr}', authority: 'melt', count: 2, token: '{token}' })
      .build();

    const tx = await interpreter.build(template, DEBUG);
    await transactionUtils.signTransaction(tx, hWallet.storage, DEFAULT_PIN_CODE);
    tx.prepareToSend();
    const sendTx = new SendTransaction({ storage: hWallet.storage, transaction: tx });
    await sendTx.runFromMining();
    await waitForTxReceived(hWallet, tx.hash, null);

    expect(tx.outputs).toHaveLength(7);

    // HTR
    expect(tx.outputs[0].tokenData).toBe(0);
    expect(tx.outputs[0].value).toBe(2n);

    // HTR Change
    expect(tx.outputs[1].tokenData).toBe(0);
    expect(tx.outputs[1].value).toBe(7n);

    // Custom token
    expect(tx.outputs[2].tokenData).toBe(1);
    expect(tx.outputs[2].value).toBe(3n);

    // Custom token change
    expect(tx.outputs[3].tokenData).toBe(1);
    expect(tx.outputs[3].value).toBe(3n);

    // mint authority
    expect(tx.outputs[4].tokenData).toBe(129);
    expect(tx.outputs[4].value).toBe(1n);

    // melt authorities
    expect(tx.outputs[5].tokenData).toBe(129);
    expect(tx.outputs[5].value).toBe(2n);
    expect(tx.outputs[6].tokenData).toBe(129);
    expect(tx.outputs[6].value).toBe(2n);
  });

  it('should be able to destroy authorities', async () => {
    const template = new TransactionTemplateBuilder()
      .addSetVarAction({ name: 'token', value: tokenUid })
      .addAuthoritySelect({ authority: 'mint', token: '{token}', count: 4 })
      .addAuthoritySelect({ authority: 'melt', token: '{token}', count: 4 })
      .build();

    const tx = await interpreter.build(template, DEBUG);
    await transactionUtils.signTransaction(tx, hWallet.storage, DEFAULT_PIN_CODE);
    tx.prepareToSend();
    const sendTx = new SendTransaction({ storage: hWallet.storage, transaction: tx });
    await sendTx.runFromMining();
    await waitForTxReceived(hWallet, tx.hash, null);

    expect(tx.outputs).toHaveLength(0);
  });

  it('should be able to mint new tokens', async () => {
    const address = await hWallet.getAddressAtIndex(15);
    const template = new TransactionTemplateBuilder()
      .addSetVarAction({ name: 'addr', value: address })
      .addSetVarAction({ name: 'token', value: tokenUid })
      .addUtxoSelect({ fill: 1 })
      .addAuthoritySelect({ authority: 'mint', token: '{token}' })
      .addTokenOutput({ address: '{addr}', amount: 100, token: '{token}' })
      .addAuthorityOutput({ address: '{addr}', authority: 'mint', token: '{token}' })
      .build();

    const tx = await interpreter.build(template, DEBUG);
    await transactionUtils.signTransaction(tx, hWallet.storage, DEFAULT_PIN_CODE);
    tx.prepareToSend();
    const sendTx = new SendTransaction({ storage: hWallet.storage, transaction: tx });
    await sendTx.runFromMining();
    await waitForTxReceived(hWallet, tx.hash, null);

    expect(tx.outputs[0].tokenData).toBe(0);
    expect(tx.outputs[1].tokenData).toBe(1);
    expect(tx.outputs[1].value).toBe(100n);
  });

  it('should be able to melt tokens', async () => {
    const address = await hWallet.getAddressAtIndex(20);
    const template = new TransactionTemplateBuilder()
      .addSetVarAction({ name: 'addr', value: address })
      .addSetVarAction({ name: 'token', value: tokenUid })
      .addUtxoSelect({ fill: 100, token: '{token}' })
      .addAuthoritySelect({ authority: 'melt', token: '{token}' })
      .addTokenOutput({ address: '{addr}', amount: 1 })
      .addAuthorityOutput({ address: '{addr}', authority: 'melt', token: '{token}' })
      .build();

    const tx = await interpreter.build(template, DEBUG);
    await transactionUtils.signTransaction(tx, hWallet.storage, DEFAULT_PIN_CODE);
    tx.prepareToSend();
    const sendTx = new SendTransaction({ storage: hWallet.storage, transaction: tx });
    await sendTx.runFromMining();
    await waitForTxReceived(hWallet, tx.hash, null);

    expect(tx.outputs[0].tokenData).toBe(0);
    expect(tx.outputs[0].value).toBe(1n);
    expect(tx.outputs[1].tokenData).toBe(129);
    expect(tx.outputs[1].value).toBe(2n);
  });
});
