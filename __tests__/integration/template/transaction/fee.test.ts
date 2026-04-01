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
import { NATIVE_TOKEN_UID, NANO_CONTRACTS_INITIALIZE_METHOD } from '../../../../src/constants';
import { TransactionTemplateBuilder } from '../../../../src/template/transaction/builder';
import { NanoContractHeaderActionType } from '../../../../src/nano_contracts/types';

describe('FeeBlueprint Template execution', () => {
  let hWallet: HathorWallet;
  let contractId: string;
  let fbtUid: string;
  let dbtUid: string;

  beforeAll(async () => {
    hWallet = await generateWalletHelper(null);
    const address = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address, 10000n, {});

    // Setup: initialize contract and create tokens using wallet methods
    // (setup is not the focus of these tests, the template operations are)
    const address0 = await hWallet.getAddressAtIndex(0);

    // Initialize FeeBlueprint contract
    const initTx = await hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId: global.FEE_BLUEPRINT_ID,
        args: [],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 1000n,
            changeAddress: address0,
          },
        ],
      }
    );
    await waitForTxReceived(hWallet, initTx.hash);
    await waitTxConfirmed(hWallet, initTx.hash, null);
    const initTxData = await hWallet.getFullTxById(initTx.hash);
    if (!initTxData.success || !isEmpty(initTxData.meta.voided_by)) {
      throw new Error(`Setup failed: initTx ${initTx.hash} was voided or failed to fetch`);
    }
    contractId = initTx.hash!;

    // Create deposit token (DBT)
    const dbtTx = await hWallet.createAndSendNanoContractTransaction(
      'create_deposit_token',
      address0,
      {
        ncId: contractId,
        args: ['Deposit Test Token', 'DBT', 1000],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100n,
            changeAddress: address0,
          },
        ],
      }
    );
    await waitForTxReceived(hWallet, dbtTx.hash);
    await waitTxConfirmed(hWallet, dbtTx.hash, null);
    const dbtTxData = await hWallet.getFullTxById(dbtTx.hash);
    if (!dbtTxData.success || !isEmpty(dbtTxData.meta.voided_by)) {
      throw new Error(`Setup failed: dbtTx ${dbtTx.hash} was voided or failed to fetch`);
    }
    const dbtState = await ncApi.getNanoContractState(contractId, ['dbt_uid'], [], []);
    dbtUid = dbtState.fields.dbt_uid.value;

    // Create fee token (FBT)
    const fbtTx = await hWallet.createAndSendNanoContractTransaction('create_fee_token', address0, {
      ncId: contractId,
      args: ['Fee Test Token', 'FBT', 1000],
      actions: [
        {
          type: 'deposit',
          token: NATIVE_TOKEN_UID,
          amount: 100n,
          changeAddress: address0,
        },
      ],
    });
    await waitForTxReceived(hWallet, fbtTx.hash);
    await waitTxConfirmed(hWallet, fbtTx.hash, null);
    const fbtTxData = await hWallet.getFullTxById(fbtTx.hash);
    if (!fbtTxData.success || !isEmpty(fbtTxData.meta.voided_by)) {
      throw new Error(`Setup failed: fbtTx ${fbtTx.hash} was voided or failed to fetch`);
    }
    const fbtState = await ncApi.getNanoContractState(contractId, ['fbt_uid'], [], []);
    fbtUid = fbtState.fields.fbt_uid.value;

    // Withdraw some FBT to have tokens in the wallet for deposit tests
    const withdrawTx = await hWallet.createAndSendNanoContractTransaction('noop', address0, {
      ncId: contractId,
      args: [],
      actions: [
        {
          type: 'withdrawal',
          token: fbtUid,
          amount: 500n,
          address: address0,
        },
      ],
    });
    await waitForTxReceived(hWallet, withdrawTx.hash);
    await waitTxConfirmed(hWallet, withdrawTx.hash, null);
    const withdrawTxData = await hWallet.getFullTxById(withdrawTx.hash);
    if (!withdrawTxData.success || !isEmpty(withdrawTxData.meta.voided_by)) {
      throw new Error(`Setup failed: withdrawTx ${withdrawTx.hash} was voided or failed to fetch`);
    }
  });

  afterAll(async () => {
    await hWallet.stop();
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  const checkTxValid = async (wallet, tx) => {
    const txId = tx.hash;
    expect(txId).toBeDefined();
    await waitForTxReceived(wallet, txId);
    await waitTxConfirmed(wallet, txId, null);
    const txAfterExecution = await wallet.getFullTxById(txId);
    expect(txAfterExecution.success).toBe(true);
    if (!txAfterExecution.success) {
      throw new Error(`Failed to fetch transaction ${txId}`);
    }
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(txAfterExecution.meta.first_block).not.toBeNull();
  };

  it('should deposit FBT using template with contract paying fee via HTR withdrawal', async () => {
    const ncStateBefore = await ncApi.getNanoContractState(
      contractId,
      [],
      [fbtUid, NATIVE_TOKEN_UID],
      []
    );
    const fbtBalanceBefore = BigInt(ncStateBefore.balances[fbtUid].value);
    const htrBalanceBefore = BigInt(ncStateBefore.balances[NATIVE_TOKEN_UID].value);

    // Build transaction using template builder for granular control
    // The contract will withdraw HTR from its balance to pay the fee
    // Fee is 2n: 1n for FBT change output + 1n for FBT deposit action
    const feeAmount = 2n;
    const depositAmount = 10n;

    const template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'fbt', value: fbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{caller}',
        actions: [
          // Deposit FBT from wallet into contract
          { action: 'deposit', token: '{fbt}', amount: depositAmount, changeAddress: '{caller}' },
          // Withdraw HTR from contract to pay the fee (skipOutputs: true means no output is created)
          {
            action: 'withdrawal',
            token: NATIVE_TOKEN_UID,
            amount: feeAmount,
            address: '{caller}',
            skipOutputs: true,
          },
        ],
      })
      // Add fee header indicating the fee payment in HTR
      .addFee({ token: NATIVE_TOKEN_UID, amount: feeAmount })
      .build();

    const tx = await hWallet.runTxTemplate(template, DEFAULT_PIN_CODE);
    await checkTxValid(hWallet, tx);

    // Verify that inputs only contain FBT (no HTR inputs from wallet)
    // Since contract withdrew HTR to pay the fee, there should be no HTR inputs
    // All inputs should be for the FBT deposit from the wallet
    for (const input of tx.inputs) {
      const spentTxResponse = await hWallet.getFullTxById(input.hash);
      expect(spentTxResponse.success).toBe(true);
      if (!spentTxResponse.success) {
        throw new Error('Failed to get spent transaction');
      }
      const spentOutput = spentTxResponse.tx.outputs[input.index];
      // token_data 0 means HTR, any other value means custom token
      expect(spentOutput.token_data).not.toBe(0);
    }

    // Verify the FeeHeader exists
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries).toHaveLength(1);
    expect(feeHeader!.entries[0].tokenIndex).toBe(0); // HTR
    expect(feeHeader!.entries[0].amount).toBe(feeAmount);

    // Verify contract state
    const ncStateAfter = await ncApi.getNanoContractState(
      contractId,
      [],
      [fbtUid, NATIVE_TOKEN_UID],
      []
    );
    // FBT balance should increase by deposit amount
    expect(BigInt(ncStateAfter.balances[fbtUid].value)).toBe(fbtBalanceBefore + depositAmount);
    // HTR balance should decrease by fee amount (withdrawn to pay fee)
    expect(BigInt(ncStateAfter.balances[NATIVE_TOKEN_UID].value)).toBe(
      htrBalanceBefore - feeAmount
    );
  });

  it('should withdraw FBT using template with user paying fee in HTR', async () => {
    const ncStateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const fbtBalanceBefore = BigInt(ncStateBefore.balances[fbtUid].value);
    const withdrawalAmount = 50n;
    const feeAmount = 1n;

    const template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'fbt', value: fbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{caller}',
        actions: [
          {
            action: 'withdrawal',
            token: '{fbt}',
            amount: withdrawalAmount,
            address: '{caller}',
          },
        ],
      })
      // User pays fee from their HTR balance
      .addUtxoSelect({ fill: feeAmount })
      .addFee({ token: NATIVE_TOKEN_UID, amount: feeAmount })
      .build();

    const tx = await hWallet.runTxTemplate(template, DEFAULT_PIN_CODE);
    await checkTxValid(hWallet, tx);

    // Verify outputs contain the FBT withdrawal
    const fbtOutputs = tx.outputs.filter(o => o.tokenData === 1);
    expect(fbtOutputs.length).toBe(1);
    expect(fbtOutputs[0].value).toBe(withdrawalAmount);

    // Verify FeeHeader
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].amount).toBe(feeAmount);

    // Verify contract balance decreased
    const ncStateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    expect(BigInt(ncStateAfter.balances[fbtUid].value)).toBe(fbtBalanceBefore - withdrawalAmount);
  });

  it('should withdraw DBT using template without requiring fees', async () => {
    const ncStateBefore = await ncApi.getNanoContractState(contractId, [], [dbtUid], []);
    const dbtBalanceBefore = BigInt(ncStateBefore.balances[dbtUid].value);
    const withdrawalAmount = 50n;

    const template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'dbt', value: dbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{caller}',
        actions: [
          {
            action: 'withdrawal',
            token: '{dbt}',
            amount: withdrawalAmount,
            address: '{caller}',
          },
        ],
      })
      // No fee header needed for DBT (deposit-based token)
      .build();

    const tx = await hWallet.runTxTemplate(template, DEFAULT_PIN_CODE);
    await checkTxValid(hWallet, tx);

    // Verify only DBT withdrawal output exists
    expect(tx.outputs.length).toBe(1);
    expect(tx.outputs[0].value).toBe(withdrawalAmount);

    // Verify NO FeeHeader for DBT
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).toBeNull();

    // Verify nano header
    const nanoHeaders = tx.getNanoHeaders();
    expect(nanoHeaders.length).toBe(1);
    expect(nanoHeaders[0].actions[0].type).toBe(NanoContractHeaderActionType.WITHDRAWAL);

    // Verify contract balance decreased
    const ncStateAfter = await ncApi.getNanoContractState(contractId, [], [dbtUid], []);
    expect(BigInt(ncStateAfter.balances[dbtUid].value)).toBe(dbtBalanceBefore - withdrawalAmount);
  });

  it('should initialize contract using template with HTR deposit', async () => {
    const depositAmount = 200n;

    const template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'blueprint', value: global.FEE_BLUEPRINT_ID })
      .addNanoMethodExecution({
        id: '{blueprint}',
        method: NANO_CONTRACTS_INITIALIZE_METHOD,
        caller: '{caller}',
        actions: [
          {
            action: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: depositAmount,
            changeAddress: '{caller}',
          },
        ],
      })
      // No addUtxoSelect needed - deposit action handles UTXO selection automatically
      .build();

    const tx = await hWallet.runTxTemplate(template, DEFAULT_PIN_CODE);
    await checkTxValid(hWallet, tx);

    // Verify contract was created
    const newContractId = tx.hash!;
    const ncState = await ncApi.getNanoContractState(newContractId, [], [NATIVE_TOKEN_UID], []);
    expect(BigInt(ncState.balances[NATIVE_TOKEN_UID].value)).toBe(depositAmount);

    // Verify nano header has initialize method
    const nanoHeaders = tx.getNanoHeaders();
    expect(nanoHeaders.length).toBe(1);
    expect(nanoHeaders[0].actions[0].type).toBe(NanoContractHeaderActionType.DEPOSIT);
  });

  it('should handle multiple FBT withdrawals using template', async () => {
    const ncStateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const fbtBalanceBefore = BigInt(ncStateBefore.balances[fbtUid].value);
    const withdrawal1 = 10n;
    const withdrawal2 = 15n;
    // 2 FBT outputs = 2n fee
    const feeAmount = 2n;

    const address0 = await hWallet.getAddressAtIndex(0);
    const address1 = await hWallet.getAddressAtIndex(1);

    const template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'addr0', value: address0 })
      .addSetVarAction({ name: 'addr1', value: address1 })
      .addSetVarAction({ name: 'fbt', value: fbtUid })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{addr0}',
        actions: [
          {
            action: 'withdrawal',
            token: '{fbt}',
            amount: withdrawal1,
            address: '{addr0}',
          },
          {
            action: 'withdrawal',
            token: '{fbt}',
            amount: withdrawal2,
            address: '{addr1}',
          },
        ],
      })
      .addUtxoSelect({ fill: feeAmount })
      .addFee({ token: NATIVE_TOKEN_UID, amount: feeAmount })
      .build();

    const tx = await hWallet.runTxTemplate(template, DEFAULT_PIN_CODE);
    await checkTxValid(hWallet, tx);

    // Verify both FBT outputs exist
    const fbtOutputs = tx.outputs.filter(o => o.tokenData === 1);
    expect(fbtOutputs.length).toBe(2);
    const amounts = fbtOutputs.map(o => o.value).sort((a, b) => Number(a - b));
    expect(amounts).toEqual([withdrawal1, withdrawal2]);

    // Verify FeeHeader
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].amount).toBe(feeAmount);

    // Verify contract balance decreased by total withdrawal
    const ncStateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    expect(BigInt(ncStateAfter.balances[fbtUid].value)).toBe(
      fbtBalanceBefore - withdrawal1 - withdrawal2
    );
  });

  it('should use template variables for dynamic fee token operations', async () => {
    const ncStateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const fbtBalanceBefore = BigInt(ncStateBefore.balances[fbtUid].value);
    const withdrawalAmount = 25n;
    const feeAmount = 1n;

    // Using variables to make the template more dynamic/reusable
    const template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'token', value: fbtUid })
      .addSetVarAction({ name: 'amount', value: withdrawalAmount })
      .addSetVarAction({ name: 'fee', value: feeAmount })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'noop',
        caller: '{caller}',
        actions: [
          {
            action: 'withdrawal',
            token: '{token}',
            amount: '{amount}',
            address: '{caller}',
          },
        ],
      })
      .addUtxoSelect({ fill: '{fee}' })
      .addFee({ token: NATIVE_TOKEN_UID, amount: '{fee}' })
      .build();

    const tx = await hWallet.runTxTemplate(template, DEFAULT_PIN_CODE);
    await checkTxValid(hWallet, tx);

    // Verify withdrawal
    const fbtOutputs = tx.outputs.filter(o => o.tokenData === 1);
    expect(fbtOutputs.length).toBe(1);
    expect(fbtOutputs[0].value).toBe(withdrawalAmount);

    // Verify FeeHeader
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].amount).toBe(feeAmount);

    // Verify contract state
    const ncStateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    expect(BigInt(ncStateAfter.balances[fbtUid].value)).toBe(fbtBalanceBefore - withdrawalAmount);
  });
});
