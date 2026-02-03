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
import CreateTokenTransaction from '../../../../src/models/create_token_transaction';
import { NanoContractHeaderActionType } from '../../../../src/nano_contracts/types';

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
          tokenVersion: TokenVersion.FEE,
        },
        { maxFee: 0n }
      )
    ).rejects.toThrow(/exceeds maximum fee/);
  });

  it('should create fee token with withdrawal and contract pays fees', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const address1 = await hWallet.getAddressAtIndex(1);

    const withdrawalAmount = 10n;
    const tokenAmount = 1000n;
    const expectedFee = 1n;

    const tx = await hWallet.createAndSendNanoContractCreateTokenTransaction(
      'noop',
      address0,
      {
        ncId: contractId,
        args: [],
        actions: [
          {
            type: 'withdrawal',
            token: NATIVE_TOKEN_UID,
            amount: withdrawalAmount,
            address: address1,
          },
        ],
      },
      {
        name: 'FBT',
        symbol: 'FTCP',
        amount: tokenAmount,
        mintAddress: address0,
        tokenVersion: TokenVersion.FEE,
      },
      { contractPaysFees: true }
    );
    await checkTxValid(hWallet, tx);

    // Verify the withdrawal output has the REDUCED amount (same as deposit tokens)
    // withdrawal(10n) - fee(1n) = output(9n)
    const createTokenTx = tx as CreateTokenTransaction;

    // token output
    expect(createTokenTx.outputs.length).toBe(4);
    expect(createTokenTx.outputs[0].value).toBe(1000n);
    // authorities outputs
    expect(createTokenTx.outputs[1].value).toBe(1n);
    expect(createTokenTx.outputs[1].tokenData).toBe(129);
    expect(createTokenTx.outputs[2].value).toBe(2n);
    expect(createTokenTx.outputs[2].tokenData).toBe(129);
    // change output in native token
    expect(createTokenTx.outputs[3].value).toBe(9n);
    expect(createTokenTx.outputs[3].tokenData).toBe(0);

    // Verify FeeHeader exists and has correct fee
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].amount).toBe(expectedFee);

    // Verify token was created with FEE version
    const tokenDetails = await hWallet.getTokenDetails(tx.hash!);
    expect(tokenDetails.tokenInfo.version).toBe(TokenVersion.FEE);

    const nanoHeader = createTokenTx.getNanoHeaders();
    expect(nanoHeader.length).toBe(1);
    expect(nanoHeader[0].actions.length).toBe(1);
    expect(nanoHeader[0].actions[0].type).toBe(NanoContractHeaderActionType.WITHDRAWAL);

    // Withdrawal header shows original amount (10n)
    // Validation: withdrawal(10n) = output(9n) + FeeHeader(1n)
    expect(nanoHeader[0].actions[0].amount).toBe(withdrawalAmount);
  });

  it('should withdraw FBT with contract paying fees via HTR withdrawal', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    const fbtWithdrawalAmount = 100n;
    const htrWithdrawalAmount = 1n; // Exact fee amount, no output created
    const expectedFee = 1n; // 1 FBT output = 1n fee

    const tx = await hWallet.createAndSendNanoContractTransaction(
      'noop',
      address0,
      {
        ncId: contractId,
        args: [],
        actions: [
          {
            type: 'withdrawal',
            token: fbtUid,
            amount: fbtWithdrawalAmount,
            address: address0,
          },
          {
            type: 'withdrawal',
            token: NATIVE_TOKEN_UID,
            amount: htrWithdrawalAmount,
            address: address0,
          },
        ],
      },
      { contractPaysFees: true }
    );
    await checkTxValid(hWallet, tx);

    // Verify no inputs from wallet (contract pays fees)
    expect(tx.inputs.length).toBe(0);

    // Verify outputs:
    // - FBT withdrawal output (100n)
    // - No HTR output because withdrawal(1n) - fee(1n) = 0n
    expect(tx.outputs.length).toBe(1);
    expect(tx.outputs[0].value).toBe(fbtWithdrawalAmount);
    expect(tx.outputs[0].tokenData).toBe(1); // FBT token index

    // Verify FeeHeader exists with correct fee
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].tokenIndex).toBe(0); // HTR
    expect(feeHeader!.entries[0].amount).toBe(expectedFee);

    // Verify nano header has both withdrawal actions
    const nanoHeaders = tx.getNanoHeaders();
    expect(nanoHeaders.length).toBe(1);
    expect(nanoHeaders[0].actions.length).toBe(2);
    expect(nanoHeaders[0].actions[0].type).toBe(NanoContractHeaderActionType.WITHDRAWAL);
    expect(nanoHeaders[0].actions[0].amount).toBe(fbtWithdrawalAmount);
    expect(nanoHeaders[0].actions[1].type).toBe(NanoContractHeaderActionType.WITHDRAWAL);
    expect(nanoHeaders[0].actions[1].amount).toBe(htrWithdrawalAmount);
  });

  it('should throw error when HTR withdrawal is insufficient to cover fee with contractPaysFees', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    // Create a second fee token to have 2 different FBT outputs
    const createTx = await hWallet.createAndSendNanoContractCreateTokenTransaction(
      'noop',
      address0,
      {
        ncId: contractId,
        args: [],
        actions: [
          {
            type: 'withdrawal',
            token: NATIVE_TOKEN_UID,
            amount: 1n,
            address: address0,
          },
        ],
      },
      {
        name: 'Fee Token 2',
        symbol: 'FT2',
        amount: 100n,
        mintAddress: address0,
        tokenVersion: TokenVersion.FEE,
      },
      { contractPaysFees: true }
    );
    await checkTxValid(hWallet, createTx);
    const fbt2Uid = createTx.hash!;

    // Now try to withdraw both fee tokens with insufficient HTR
    // 2 different FBT outputs = 2n fee required
    // But only 1n HTR withdrawal = insufficient
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
              amount: 50n,
              address: address0,
            },
            {
              type: 'withdrawal',
              token: fbt2Uid,
              amount: 50n,
              address: address0,
            },
            {
              type: 'withdrawal',
              token: NATIVE_TOKEN_UID,
              amount: 1n, // Only 1n, but fee is 2n (2 different FBT outputs)
              address: address0,
            },
          ],
        },
        { contractPaysFees: true }
      )
    ).rejects.toThrow(/HTR withdrawal amount insufficient to cover fee/);
  });

  it('should throw error when withdrawal amount is insufficient to cover token deposit', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    await expect(
      hWallet.createAndSendNanoContractCreateTokenTransaction(
        'noop',
        address0,
        {
          ncId: contractId,
          args: [],
          actions: [
            {
              type: 'withdrawal',
              token: NATIVE_TOKEN_UID,
              amount: 100n,
              address: address0,
            },
          ],
        },
        {
          name: 'Deposit Test Token Fail',
          symbol: 'DTTF',
          amount: 20000n, // Requires 200n deposit
          mintAddress: address0,
          contractPaysTokenDeposit: true,
          tokenVersion: TokenVersion.DEPOSIT,
        }
      )
    ).rejects.toThrow('Withdrawal amount -100 for token 00 is less than 0.');
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

    expect(tx.headers.length).toBe(1);
    expect(tx.getNanoHeaders()[0].actions.length).toBe(1);
    expect(tx.getNanoHeaders()[0].actions[0].type).toBe(NanoContractHeaderActionType.WITHDRAWAL);
    expect(tx.getNanoHeaders()[0].actions[0].amount).toBe(100n);

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

    // Verify the withdrawal output
    expect(tx.outputs.length).toBe(2);
    expect(tx.outputs[0].value).toBe(100n);
    expect(tx.outputs[0].tokenData).toBe(1);

    expect(tx.inputs.length).toBe(1);

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
  it('should grant authority of fee token to contract without paying fees', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);

    const createTokenTx = await hWallet.createAndSendNanoContractCreateTokenTransaction(
      'noop',
      address0,
      {
        ncId: contractId,
        args: [],
        actions: [
          {
            type: 'withdrawal',
            token: NATIVE_TOKEN_UID,
            amount: 1n,
            address: address0,
          },
        ],
      },
      {
        name: 'Fee Authority Token',
        symbol: 'FAT',
        amount: 8582n,
        mintAddress: address0,
        createMint: true,
        createMelt: true,
        tokenVersion: TokenVersion.FEE,
      }
    );
    await checkTxValid(hWallet, createTokenTx);

    // Verify outputs structure
    expect(createTokenTx.outputs.length).toBe(5);

    // Output 0: Fee token amount (8582n)
    expect(createTokenTx.outputs[0].value).toBe(8582n);
    expect(createTokenTx.outputs[0].tokenData).toBe(1); // token index 1

    // Output 1: Mint authority
    expect(createTokenTx.outputs[1].value).toBe(1n);
    expect(createTokenTx.outputs[1].tokenData).toBe(129); // 128 (authority mask) + 1 (token index)

    // Output 2: Melt authority
    expect(createTokenTx.outputs[2].value).toBe(2n);
    expect(createTokenTx.outputs[2].tokenData).toBe(129); // 128 (authority mask) + 1 (token index)

    // Output 3: HTR withdrawal from contract (1n)
    expect(createTokenTx.outputs[3].value).toBe(1n);
    expect(createTokenTx.outputs[3].tokenData).toBe(0); // HTR

    // Output 4: HTR change (from fee payment UTXO selection)
    expect(createTokenTx.outputs[4].tokenData).toBe(0); // HTR

    // Verify FeeHeader exists with correct fee (1n for the fee token output)
    const createTokenFeeHeader = createTokenTx.getFeeHeader();
    expect(createTokenFeeHeader).not.toBeNull();
    expect(createTokenFeeHeader!.entries[0].tokenIndex).toBe(0); // HTR
    expect(createTokenFeeHeader!.entries[0].amount).toBe(1n); // 1 fee token output = 1n fee

    const feeTokenUid = createTokenTx.hash!;
    const tokenDetails = await hWallet.getTokenDetails(feeTokenUid);
    expect(tokenDetails.tokenInfo.version).toBe(TokenVersion.FEE);

    // // Verify authorities exist in the wallet
    expect(tokenDetails.authorities.mint).toBe(true);
    expect(tokenDetails.authorities.melt).toBe(true);

    // // Get contract state before grant
    const ncStateBefore = await ncApi.getNanoContractState(contractId, [], [feeTokenUid], []);
    expect(ncStateBefore.balances[feeTokenUid].can_mint).toBe(false);

    // // Grant mint authority to the contract
    // // According to fee calculation rules: Authority tokens are EXCLUDED from fee calculation
    // // Therefore, the grant_authority action itself should NOT require a fee
    const grantTx = await hWallet.createAndSendNanoContractTransaction('noop', address0, {
      ncId: contractId,
      args: [],
      actions: [
        {
          type: 'grant_authority',
          token: feeTokenUid,
          authority: 'mint',
        },
      ],
    });
    await checkTxValid(hWallet, grantTx);

    // // Verify transaction structure
    // // Input: 1 mint authority UTXO from wallet
    expect(grantTx.inputs.length).toBe(1);
    const inputTxData = await hWallet.getFullTxById(grantTx.inputs[0].hash);
    expect(inputTxData.success).toBe(true);
    if (!inputTxData.success) {
      throw new Error('Failed to get input transaction');
    }
    const inputOutput = inputTxData.tx.outputs[grantTx.inputs[0].index];
    // // Authority outputs have value 1 (mint) or 2 (melt) and token_data with authority mask (129)
    expect(inputOutput.value).toBe(1n); // Mint authority
    expect(inputOutput.token_data).toBe(129); // Authority mask | token index 1

    // // Verify NO outputs (authority goes entirely to contract)
    expect(grantTx.outputs.length).toBe(0);

    // // Verify NO FeeHeader (authority actions are excluded from fee calculation)
    // // This is the key assertion: grant_authority of fee token should NOT require fee
    const feeHeader = grantTx.getFeeHeader();
    expect(feeHeader).toBeNull();

    // // Verify nano contract header has the grant_authority action
    const nanoHeaders = grantTx.getNanoHeaders();
    expect(nanoHeaders.length).toBe(1);
    expect(nanoHeaders[0].actions.length).toBe(1);
    expect(nanoHeaders[0].actions[0].type).toBe(NanoContractHeaderActionType.GRANT_AUTHORITY);

    // // Verify contract now has mint authority for the fee token
    const ncStateAfter = await ncApi.getNanoContractState(contractId, [], [feeTokenUid], []);
    expect(ncStateAfter.balances[feeTokenUid].can_mint).toBe(true);

    // // Wallet should no longer have mint authority (granted to contract)
    const tokenDetailsAfter = await hWallet.getTokenDetails(feeTokenUid);
    expect(tokenDetailsAfter.authorities.mint).toBe(false);
    expect(tokenDetailsAfter.authorities.melt).toBe(true); // Melt still in wallet
  });
});
