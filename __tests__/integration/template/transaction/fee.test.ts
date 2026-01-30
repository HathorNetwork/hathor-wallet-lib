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
import { TokenVersion } from '../../../../src/types';
import { TransactionTemplateBuilder } from '../../../../src/template/transaction/builder';

describe('FeeBlueprint Template execution', () => {
  let hWallet: HathorWallet;
  let contractId: string;
  let contractId2: string;
  let fbtUid: string;
  let dbtUid: string;

  beforeAll(async () => {
    hWallet = await generateWalletHelper(null);
    const address = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address, 10000n, {});
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
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(txAfterExecution.meta.first_block).not.toBeNull();
  };

  it('should initialize a FeeBlueprint contract', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    const tx = await hWallet.createAndSendNanoContractTransaction(
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
    await checkTxValid(hWallet, tx);

    expect(tx.hash).not.toBeNull();
    contractId = tx.hash!;

    const ncState = await ncApi.getNanoContractState(contractId, [], [NATIVE_TOKEN_UID], []);
    expect(BigInt(ncState.balances[NATIVE_TOKEN_UID].value)).toBe(1000n);
  });

  it('should create a deposit token (DBT)', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    const tx = await hWallet.createAndSendNanoContractTransaction(
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
    await checkTxValid(hWallet, tx);

    const ncState = await ncApi.getNanoContractState(
      contractId,
      ['dbt_uid'],
      [NATIVE_TOKEN_UID],
      []
    );
    expect(ncState.fields.dbt_uid.value).toBeDefined();
    dbtUid = ncState.fields.dbt_uid.value;

    expect(BigInt(ncState.balances[NATIVE_TOKEN_UID].value)).toBeGreaterThanOrEqual(1000n);
  });

  it('should create a fee token (FBT)', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    const tx = await hWallet.createAndSendNanoContractTransaction('create_fee_token', address0, {
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
    await checkTxValid(hWallet, tx);

    const ncState = await ncApi.getNanoContractState(
      contractId,
      ['fbt_uid'],
      [NATIVE_TOKEN_UID],
      []
    );
    expect(ncState.fields.fbt_uid.value).toBeDefined();
    fbtUid = ncState.fields.fbt_uid.value;

    const tokenDetails = await hWallet.getTokenDetails(fbtUid);
    expect(tokenDetails.tokenInfo.version).toBe(TokenVersion.FEE);
  });

  it('should throw error when calculated fee exceeds maxFee in createNanoContractCreateTokenTransaction', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    // Create fee token with maxFee=0 should fail since token creation has outputs
    await expect(
      hWallet.createAndSendNanoContractCreateTokenTransaction(
        'create_fee_token',
        address0,
        {
          ncId: contractId,
          args: ['Fee Token Fail', 'FTF', 100],
          actions: [
            {
              type: 'deposit',
              token: NATIVE_TOKEN_UID,
              amount: 100n,
              changeAddress: address0,
            },
          ],
        },
        {
          name: 'Fee Token Fail',
          symbol: 'FTF',
          amount: 100n,
          mintAddress: address0,
          contractPaysTokenDeposit: true,
          tokenVersion: TokenVersion.FEE,
        },
        { maxFee: 0n }
      )
    ).rejects.toThrow(/exceeds maximum fee/);
  });

  it('should withdraw DBT without paying fees', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    const tx = await hWallet.createAndSendNanoContractTransaction('noop', address0, {
      ncId: contractId,
      args: [],
      actions: [
        {
          type: 'withdrawal',
          token: dbtUid,
          amount: 100n,
          address: address0,
        },
      ],
    });
    await checkTxValid(hWallet, tx);

    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0].value).toEqual(100n);

    // Verify no FeeHeader for DBT (deposit-based token)
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).toBeNull();
  });

  it('should throw error when calculated fee exceeds maxFee', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    // FBT withdrawal requires 1n fee per output, but maxFee is 0n
    await expect(
      hWallet.createAndSendNanoContractTransaction(
        'noop',
        address0,
        {
          ncId: contractId,
          args: [],
          actions: [
            {
              type: 'withdrawal',
              token: fbtUid,
              amount: 10n,
              address: address0,
            },
          ],
        },
        { maxFee: 0n } // Calculated fee (1n) exceeds this
      )
    ).rejects.toThrow('Calculated fee (1) exceeds maximum fee (0)');
  });

  it('should deposit DBT back to contract', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    const tx = await hWallet.createAndSendNanoContractTransaction('noop', address0, {
      ncId: contractId,
      args: [],
      actions: [
        {
          type: 'deposit',
          token: dbtUid,
          amount: 50n,
          changeAddress: address0,
        },
      ],
    });
    await checkTxValid(hWallet, tx);

    const ncState = await ncApi.getNanoContractState(contractId, [], [dbtUid], []);
    expect(BigInt(ncState.balances[dbtUid].value)).toBe(950n);
  });

  it('should withdraw FBT paying fees in HTR', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const ncStateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const fbtBalanceBefore = BigInt(ncStateBefore.balances[fbtUid].value);

    const tx = await hWallet.createAndSendNanoContractTransaction('noop', address0, {
      ncId: contractId,
      args: [],
      actions: [
        {
          type: 'withdrawal',
          token: fbtUid,
          amount: 100n,
          address: address0,
        },
      ],
    });
    await checkTxValid(hWallet, tx);

    // Verify the withdrawal output exists
    expect(tx.outputs.length).toBeGreaterThanOrEqual(1);

    // Verify the FeeHeader
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries).toHaveLength(1);
    expect(feeHeader!.entries[0].tokenIndex).toBe(0); // HTR
    expect(feeHeader!.entries[0].amount).toBe(1n); // 1 FBT output = 1n fee

    // Verify contract balance decreased by withdrawal amount
    const ncStateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    expect(BigInt(ncStateAfter.balances[fbtUid].value)).toBe(fbtBalanceBefore - 100n);
  });

  it('should get an error when trying to pay fees without enough HTR', async () => {
    /** Dedicated wallet for tests that require an empty wallet (never funded) */
    const emptyWallet = await generateWalletHelper(null);
    const address0 = await emptyWallet.getAddressAtIndex(0);

    // Use emptyWallet (which has no HTR) to create a transaction that requires fees
    // The FBT withdrawal triggers a fee that requires HTR to pay
    await expect(
      emptyWallet.createAndSendNanoContractTransaction('noop', address0, {
        ncId: contractId,
        args: [],
        actions: [
          {
            type: 'withdrawal',
            token: fbtUid,
            amount: 10n,
            address: address0,
          },
        ],
      })
    ).rejects.toThrow('Not enough HTR utxos to pay the fee.');
  });

  it('should deposit FBT back to contract paying fees in HTR', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const ncStateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    const fbtBalanceBefore = BigInt(ncStateBefore.balances[fbtUid].value);

    const tx = await hWallet.createAndSendNanoContractTransaction('noop', address0, {
      ncId: contractId,
      args: [],
      actions: [
        {
          type: 'deposit',
          token: fbtUid,
          amount: 50n,
          changeAddress: address0,
        },
      ],
    });
    await checkTxValid(hWallet, tx);

    // Verify the FeeHeader
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries).toHaveLength(1);
    expect(feeHeader!.entries[0].tokenIndex).toBe(0); // HTR
    expect(feeHeader!.entries[0].amount).toBe(2n); // 1 FBT change output + 1 FBT deposit

    const ncStateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid], []);
    // Balance should increase by deposit amount (50)
    expect(BigInt(ncStateAfter.balances[fbtUid].value)).toBe(fbtBalanceBefore + 50n);
  });

  it('should deposit FBT with contract paying fee via HTR withdrawal', async () => {
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

  it('should initialize a second FeeBlueprint contract (nc2)', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    const tx = await hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId: global.FEE_BLUEPRINT_ID,
        args: [],
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
    await checkTxValid(hWallet, tx);

    expect(tx.hash).not.toBeNull();
    contractId2 = tx.hash!;

    const ncState = await ncApi.getNanoContractState(contractId2, [], [NATIVE_TOKEN_UID], []);
    expect(BigInt(ncState.balances[NATIVE_TOKEN_UID].value)).toBe(100n);
  });

  it('should move FBT tokens from nc1 to nc2', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const nc1StateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid, dbtUid], []);
    const fbtBalanceBefore = BigInt(nc1StateBefore.balances[fbtUid].value);
    const dbtBalanceBefore = BigInt(nc1StateBefore.balances[dbtUid].value);

    // Use DBT (deposit token) to pay fees instead of FBT (fee token)
    // args: [nc_id, token_uid, token_amount, fee_token, fee_amount]
    const tx = await hWallet.createAndSendNanoContractTransaction('move_tokens_to_nc', address0, {
      ncId: contractId,
      args: [contractId2, fbtUid, 200, dbtUid, 100],
    });
    await checkTxValid(hWallet, tx);

    const nc1StateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid, dbtUid], []);
    const nc2StateAfter = await ncApi.getNanoContractState(contractId2, [], [fbtUid], []);

    // FBT balance decreases by transfer amount only (200)
    expect(BigInt(nc1StateAfter.balances[fbtUid].value)).toBe(fbtBalanceBefore - 200n);
    // DBT balance decreases by fee amount (100)
    expect(BigInt(nc1StateAfter.balances[dbtUid].value)).toBe(dbtBalanceBefore - 100n);
    // nc2 receives 200 FBT
    expect(BigInt(nc2StateAfter.balances[fbtUid].value)).toBe(200n);
  });

  it('should get FBT tokens back from nc2 to nc1', async () => {
    const nc1StateBefore = await ncApi.getNanoContractState(contractId, [], [fbtUid, dbtUid], []);
    const nc2StateBefore = await ncApi.getNanoContractState(contractId2, [], [fbtUid], []);
    const nc1FbtBefore = BigInt(nc1StateBefore.balances[fbtUid].value);
    const nc1DbtBefore = BigInt(nc1StateBefore.balances[dbtUid].value);
    const nc2FbtBefore = BigInt(nc2StateBefore.balances[fbtUid].value);
    const address0 = await hWallet.getAddressAtIndex(0);

    // Use DBT (deposit token) to pay fees instead of FBT (fee token)
    // args: [nc_id, token_uid, token_amount, fee_token, fee_amount]
    const tx = await hWallet.createAndSendNanoContractTransaction('get_tokens_from_nc', address0, {
      ncId: contractId,
      args: [contractId2, fbtUid, 100, dbtUid, 100],
    });
    await checkTxValid(hWallet, tx);

    const nc1StateAfter = await ncApi.getNanoContractState(contractId, [], [fbtUid, dbtUid], []);
    const nc2StateAfter = await ncApi.getNanoContractState(contractId2, [], [fbtUid], []);

    // nc1 receives 100 FBT back
    expect(BigInt(nc1StateAfter.balances[fbtUid].value)).toBe(nc1FbtBefore + 100n);
    // DBT balance decreases by fee amount (100)
    expect(BigInt(nc1StateAfter.balances[dbtUid].value)).toBe(nc1DbtBefore - 100n);
    // nc2 loses 100 FBT
    expect(BigInt(nc2StateAfter.balances[fbtUid].value)).toBe(nc2FbtBefore - 100n);
  });
});
