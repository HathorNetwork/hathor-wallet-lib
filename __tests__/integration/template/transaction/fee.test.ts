import { isEmpty } from 'lodash';
import { GenesisWalletHelper } from '../../helpers/genesis-wallet.helper';
import {
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitTxConfirmed,
} from '../../helpers/wallet.helper';

import ncApi from '../../../../src/api/nano';
import HathorWallet from '../../../../src/new/wallet';
import SendTransaction from '../../../../src/new/sendTransaction';
import { TransactionTemplateBuilder } from '../../../../src/template/transaction/builder';
import { WalletTxTemplateInterpreter } from '../../../../src/template/transaction/interpreter';
import { NATIVE_TOKEN_UID } from '../../../../src/constants';

const DEBUG = true;

async function runTemplate(template, wallet) {
  if (DEBUG) {
    wallet.enableDebugMode();
  }

  const tx = await wallet.runTxTemplate(template, DEFAULT_PIN_CODE);
  expect(tx.hash).not.toBeNull();
  if (tx.hash === null) {
    throw new Error('Transaction does not have a hash');
  }
  return tx;
}

describe('FeeBlueprint Template execution', () => {
  let hWallet: HathorWallet;
  let interpreter: WalletTxTemplateInterpreter;
  let contractId: string;
  let contractId2: string;
  let fbtUid: string;
  let dbtUid: string;

  beforeAll(async () => {
    hWallet = await generateWalletHelper(null);
    interpreter = new WalletTxTemplateInterpreter(hWallet);
    const address = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address, 10000n, {});
  });

  afterAll(async () => {
    await hWallet.stop();
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  const waitExecution = async (wallet, tx) => {
    const txId = tx.hash;
    expect(txId).toBeDefined();
    await waitForTxReceived(wallet, txId);
    await waitTxConfirmed(wallet, txId, null);
    const txAfterExecution = await wallet.getFullTxById(txId);
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(isEmpty(txAfterExecution.meta.first_block)).not.toBeNull();
  };

  it('should initialize a FeeBlueprint contract', async () => {
    const initializeTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'addr', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'blueprint', value: global.FEE_BLUEPRINT_ID })
      .addNanoMethodExecution({
        id: '{blueprint}',
        method: 'initialize',
        caller: '{addr}',
        actions: [{ action: 'deposit', amount: 1000n, changeAddress: '{addr}' }],
      })
      .build();

    const initializeTx = await runTemplate(initializeTemplate, hWallet);
    await waitExecution(hWallet, initializeTx);

    expect(initializeTx.hash).not.toBeNull();
    contractId = initializeTx.hash!;

    const ncState = await ncApi.getNanoContractState(contractId, [], [NATIVE_TOKEN_UID], []);
    expect(BigInt(ncState.balances[NATIVE_TOKEN_UID].value)).toBe(1000n);
  });

  it('should create a deposit token (DBT)', async () => {
    const createDbtTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'create_deposit_token',
        caller: '{caller}',
        args: ['Deposit Test Token', 'DBT', 1000],
        actions: [{ action: 'deposit', amount: 100n, changeAddress: '{caller}' }],
      })
      .build();

    const createDbtTx = await runTemplate(createDbtTemplate, hWallet);
    await waitExecution(hWallet, createDbtTx);

    const ncState = await ncApi.getNanoContractState(contractId, ['dbt_uid'], [NATIVE_TOKEN_UID], []);
    expect(ncState.fields.dbt_uid.value).toBeDefined();
    dbtUid = ncState.fields.dbt_uid.value;

    expect(BigInt(ncState.balances[NATIVE_TOKEN_UID].value)).toBeGreaterThanOrEqual(1000n);
  });

  it('should create a fee token (FBT)', async () => {
    const createFbtTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'create_fee_token',
        caller: '{caller}',
        args: ['Fee Test Token', 'FBT', 1000],
        actions: [{ action: 'deposit', amount: 100n, changeAddress: '{caller}' }],
      })
      .build();

    const createFbtTx = await runTemplate(createFbtTemplate, hWallet);
    await waitExecution(hWallet, createFbtTx);

    const ncState = await ncApi.getNanoContractState(contractId, ['fbt_uid'], [NATIVE_TOKEN_UID], []);
    expect(ncState.fields.fbt_uid.value).toBeDefined();
    fbtUid = ncState.fields.fbt_uid.value;
  });

  it('should withdraw DBT without paying fees', async () => {
    const withdrawDbtTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'dbt', value: dbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{caller}',
        actions: [{ action: 'withdrawal', amount: 100n, token: '{dbt}', address: '{caller}' }],
      })
      .build();

    const withdrawDbtTx = await runTemplate(withdrawDbtTemplate, hWallet);
    await waitExecution(hWallet, withdrawDbtTx);

    expect(withdrawDbtTx.outputs).toHaveLength(1);
    expect(withdrawDbtTx.outputs[0].value).toEqual(100n);
  });

  it('should deposit DBT back to contract', async () => {
    const depositDbtTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'dbt', value: dbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{caller}',
        actions: [{ action: 'deposit', amount: 50n, token: '{dbt}', changeAddress: '{caller}' }],
      })
      .build();

    const depositDbtTx = await runTemplate(depositDbtTemplate, hWallet);
    await waitExecution(hWallet, depositDbtTx);

    const ncState = await ncApi.getNanoContractState(contractId, [], [dbtUid], []);
    expect(BigInt(ncState.balances[dbtUid].value)).toBe(950n);
  });

  it('should withdraw FBT paying fees', async () => {
    const withdrawFbtTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'fbt', value: fbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{caller}',
        actions: [{ action: 'withdrawal', amount: 100n, token: '{fbt}', address: '{caller}' }],
      })
      .build();

    const withdrawFbtTx = await runTemplate(withdrawFbtTemplate, hWallet);
    await waitExecution(hWallet, withdrawFbtTx);

    expect(withdrawFbtTx.outputs).toHaveLength(1);
    expect(withdrawFbtTx.outputs[0].value).toEqual(100n);
  });

  it('should deposit FBT back to contract paying fees', async () => {
    const depositFbtTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'fbt', value: fbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{caller}',
        actions: [{ action: 'deposit', amount: 50n, token: '{fbt}', changeAddress: '{caller}' }],
      })
      .build();

    const depositFbtTx = await runTemplate(depositFbtTemplate, hWallet);
    await waitExecution(hWallet, depositFbtTx);

    const ncState = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    expect(BigInt(ncState.balances[fbtUid].value)).toBe(950n);
  });

  it('should initialize a second FeeBlueprint contract (nc2)', async () => {
    const initializeTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'addr', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'blueprint', value: global.FEE_BLUEPRINT_ID })
      .addNanoMethodExecution({
        id: '{blueprint}',
        method: 'initialize',
        caller: '{addr}',
        actions: [{ action: 'deposit', amount: 100n, changeAddress: '{addr}' }],
      })
      .build();

    const initializeTx = await runTemplate(initializeTemplate, hWallet);
    await waitExecution(hWallet, initializeTx);

    expect(initializeTx.hash).not.toBeNull();
    contractId2 = initializeTx.hash!;

    const ncState = await ncApi.getNanoContractState(contractId2, [], [NATIVE_TOKEN_UID], []);
    expect(BigInt(ncState.balances[NATIVE_TOKEN_UID].value)).toBe(100n);
  });

  it('should move FBT tokens from nc1 to nc2', async () => {
    const nc1StateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const fbtBalanceBefore = BigInt(nc1StateBefore.balances[fbtUid].value);

    const moveTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'nc2', value: contractId2 })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'fbt', value: fbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'move_tokens_to_nc',
        caller: '{caller}',
        args: ['{nc2}', '{fbt}', 200, '{fbt}', 10],
      })
      .build();

    const moveTx = await runTemplate(moveTemplate, hWallet);
    await waitExecution(hWallet, moveTx);

    const nc1StateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const nc2StateAfter = await ncApi.getNanoContractState(contractId2, [], [fbtUid], []);

    expect(BigInt(nc1StateAfter.balances[fbtUid].value)).toBe(fbtBalanceBefore - 200n - 10n);
    expect(BigInt(nc2StateAfter.balances[fbtUid].value)).toBe(200n);
  });

  it('should get FBT tokens back from nc2 to nc1', async () => {
    const nc1StateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const nc2StateBefore = await ncApi.getNanoContractState(contractId2, [], [fbtUid], []);
    const nc1FbtBefore = BigInt(nc1StateBefore.balances[fbtUid].value);
    const nc2FbtBefore = BigInt(nc2StateBefore.balances[fbtUid].value);

    const getTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'nc2', value: contractId2 })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'fbt', value: fbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'get_tokens_from_nc',
        caller: '{caller}',
        args: ['{nc2}', '{fbt}', 100, '{fbt}', 5],
      })
      .build();

    const getTx = await runTemplate(getTemplate, hWallet);
    await waitExecution(hWallet, getTx);

    const nc1StateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const nc2StateAfter = await ncApi.getNanoContractState(contractId2, [], [fbtUid], []);

    expect(BigInt(nc1StateAfter.balances[fbtUid].value)).toBe(nc1FbtBefore + 100n - 5n);
    expect(BigInt(nc2StateAfter.balances[fbtUid].value)).toBe(nc2FbtBefore - 100n);
  });
});
