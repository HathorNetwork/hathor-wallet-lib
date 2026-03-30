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

describe('FeeBlueprint Template execution', () => {
  let hWallet: HathorWallet;
  let contractId: string;
  let fbtUid: string;
  let _dbtUid: string;

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
    _dbtUid = dbtState.fields.dbt_uid.value;

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
});
