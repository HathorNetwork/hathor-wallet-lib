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
import { CREATE_TOKEN_TX_VERSION, NATIVE_TOKEN_UID, TOKEN_AUTHORITY_MASK, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../../../src/constants';
import dateFormatter from '../../../../src/utils/date';

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

describe('Template execution', () => {
  let hWallet: HathorWallet;
  let interpreter: WalletTxTemplateInterpreter;

  beforeAll(async () => {
    hWallet = await generateWalletHelper(null);
    interpreter = new WalletTxTemplateInterpreter(hWallet);
    const address = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address, 1000n, {});
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
    // We need to wait for the tx to get a first block, so we guarantee it was executed
    await waitTxConfirmed(wallet, txId, null);
    // Now we query the transaction from the full node to double check it's still valid after the nano execution
    // and it already has a first block, so it was really executed
    const txAfterExecution = await wallet.getFullTxById(txId);
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(isEmpty(txAfterExecution.meta.first_block)).not.toBeNull();
  };

  it('should be able to run a bet contract', async () => {
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 6000;
    const initializeTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'addr', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'oracle', call: { method: 'get_oracle_script', index: 0 } })
      .addSetVarAction({ name: 'blueprint', value: global.BET_BLUEPRINT_ID })
      .addNanoMethodExecution({
        id: '{blueprint}',
        method: 'initialize',
        caller: '{addr}',
        args: ['{oracle}', NATIVE_TOKEN_UID, dateLastBet],
      })
      .build();

    const initializeTx = await interpreter.buildAndSign(
      initializeTemplate,
      DEFAULT_PIN_CODE,
      DEBUG
    );
    const initializeSendTx = new SendTransaction({
      storage: hWallet.storage,
      transaction: initializeTx,
    });
    await initializeSendTx.runFromMining();
    expect(initializeTx.hash).not.toBeNull();
    if (initializeTx.hash === null) {
      throw new Error('Transaction does not have a hash');
    }
    const contractId = initializeTx.hash;
    await waitExecution(hWallet, initializeTx);

    expect(initializeTx.outputs).toHaveLength(0);

    // BET Template

    const bet1Template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'bet_addr', call: { method: 'get_wallet_address', index: 5 } })
      .addSetVarAction({ name: 'contract', value: contractId })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'bet',
        caller: '{caller}',
        args: ['{bet_addr}', '1x0'],
        actions: [{ action: 'deposit', amount: 10n, changeAddress: '{caller}' }],
      })
      .build();

    const bet1Tx = await interpreter.buildAndSign(bet1Template, DEFAULT_PIN_CODE, DEBUG);
    const bet1SendTx = new SendTransaction({ storage: hWallet.storage, transaction: bet1Tx });
    await bet1SendTx.runFromMining();
    expect(bet1Tx.hash).not.toBeNull();
    if (bet1Tx.hash === null) {
      throw new Error('Transaction does not have a hash');
    }
    await waitExecution(hWallet, bet1Tx);

    expect(bet1Tx.outputs).toHaveLength(1);
    expect(bet1Tx.outputs[0].value).toEqual(990n);
    expect(bet1Tx.outputs[0].tokenData).toEqual(0);

    const bet2Template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'bet_addr', call: { method: 'get_wallet_address', index: 7 } })
      .addSetVarAction({ name: 'contract', value: contractId })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'bet',
        caller: '{caller}',
        args: ['{bet_addr}', '1x2'],
        actions: [{ action: 'deposit', amount: 20n, changeAddress: '{caller}' }],
      })
      .build();

    const bet2Tx = await interpreter.buildAndSign(bet2Template, DEFAULT_PIN_CODE, DEBUG);
    const bet2SendTx = new SendTransaction({ storage: hWallet.storage, transaction: bet2Tx });
    await bet2SendTx.runFromMining();
    expect(bet2Tx.hash).not.toBeNull();
    if (bet2Tx.hash === null) {
      throw new Error('Transaction does not have a hash');
    }
    await waitExecution(hWallet, bet2Tx);

    expect(bet2Tx.outputs).toHaveLength(1);
    expect(bet2Tx.outputs[0].value).toEqual(970n);
    expect(bet2Tx.outputs[0].tokenData).toEqual(0);

    // set_result Template

    const setResultTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({
        name: 'result',
        call: {
          method: 'get_oracle_signed_data',
          index: 0,
          ncId: '{contract}',
          type: 'SignedData[str]',
          data: '1x0',
        },
      })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'set_result',
        caller: '{caller}',
        args: ['{result}'],
      })
      .build();

    const setResultTx = await interpreter.buildAndSign(setResultTemplate, DEFAULT_PIN_CODE, DEBUG);
    const setResultSendTx = new SendTransaction({
      storage: hWallet.storage,
      transaction: setResultTx,
    });
    await setResultSendTx.runFromMining();
    expect(setResultTx.hash).not.toBeNull();
    if (setResultTx.hash === null) {
      throw new Error('Transaction does not have a hash');
    }
    await waitExecution(hWallet, setResultTx);

    expect(setResultTx.outputs).toHaveLength(0);

    // Withdrawal

    const withdrawalTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'bet_addr', call: { method: 'get_wallet_address', index: 5 } })
      .addSetVarAction({ name: 'contract', value: contractId })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'withdraw',
        caller: '{bet_addr}',
        actions: [{ action: 'withdrawal', amount: 30n, address: '{bet_addr}' }],
      })
      .build();

    const withdrawalTx = await interpreter.buildAndSign(
      withdrawalTemplate,
      DEFAULT_PIN_CODE,
      DEBUG
    );
    const withdrawalSendTx = new SendTransaction({
      storage: hWallet.storage,
      transaction: withdrawalTx,
    });
    await withdrawalSendTx.runFromMining();
    expect(withdrawalTx.hash).not.toBeNull();
    if (withdrawalTx.hash === null) {
      throw new Error('Transaction does not have a hash');
    }
    await waitExecution(hWallet, withdrawalTx);

    expect(withdrawalTx.outputs).toHaveLength(1);
    expect(withdrawalTx.outputs[0].value).toEqual(30n);
    expect(withdrawalTx.outputs[0].tokenData).toEqual(0);
  });

  it('should be able to create a token and call nano', async () => {
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 9000;
    const initializeTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'addr', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'oracle', call: { method: 'get_oracle_script', index: 0 } })
      .addSetVarAction({ name: 'blueprint', value: global.BET_BLUEPRINT_ID })
      .addNanoMethodExecution({
        id: '{blueprint}',
        method: 'initialize',
        caller: '{addr}',
        args: ['{oracle}', NATIVE_TOKEN_UID, dateLastBet],
      })
      .build();

    const initializeTx = await runTemplate(initializeTemplate, hWallet);
    await waitExecution(hWallet, initializeTx);
    const contractId = initializeTx.hash;

    // BET Template

    const bet1Template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'bet_addr', call: { method: 'get_wallet_address', index: 5 } })
      .addConfigAction({ createToken: true, tokenName: 'Tk bet', tokenSymbol: 'tkBet' })
      .addTokenOutput({ amount: 100, useCreatedToken: true, address: '{caller}' })
      .addDataOutput({ data: 'foobar' })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'bet',
        caller: '{caller}',
        args: ['{bet_addr}', '1x0'],
        actions: [
          { action: 'deposit', amount: 10n, changeAddress: '{caller}', skipSelection: true },
        ],
      })
      .addUtxoSelect({ fill: 12 }) // Adds 10 for the deposit + 1 for token creation fee + 1 for data output
      .build();

    const bet1Tx = await runTemplate(bet1Template, hWallet);
    await waitExecution(hWallet, bet1Tx);
    expect(bet1Tx.version).toEqual(CREATE_TOKEN_TX_VERSION);

    expect(bet1Tx.outputs).toHaveLength(3);
    expect(bet1Tx.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 100n,
          tokenData: 1,
        }),
        expect.objectContaining({
          value: 1n, // data output
          tokenData: 0,
        }),
        expect.objectContaining({
          value: expect.anything(), // change output
          tokenData: 0,
        }),
      ])
    );
  });

  it('should be able to grant and acquire authorities', async () => {
    const initializeTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'blueprint', value: global.AUTHORITY_BLUEPRINT_ID })
      .addNanoMethodExecution({
        id: '{blueprint}',
        method: 'initialize',
        caller: '{caller}',
        actions: [{action: 'deposit', amount: 100}],
      })
      .build();

    const initializeTx = await runTemplate(initializeTemplate, hWallet);
    await waitExecution(hWallet, initializeTx);
    const contractId = initializeTx.hash;

    // Create token

    const createTokenTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addConfigAction({ createToken: true, tokenName: 'Authority Test Token', tokenSymbol: 'ATT' })
      .addTokenOutput({ amount: 100, useCreatedToken: true, address: '{caller}' })
      .addAuthorityOutput({ useCreatedToken: true, authority: 'mint', address: '{caller}' })
      .addAuthorityOutput({ useCreatedToken: true, authority: 'melt', address: '{caller}' })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'create_token',
        caller: '{caller}',
        actions: [
          { action: 'withdrawal', amount: 5, address: '{caller}', skipOutputs: true },
        ],
      })
      .addTokenOutput({ amount: 4, address: '{caller}' }) // withdrawal action - token creation fee
      .build();

    const createTokenTx = await runTemplate(createTokenTemplate, hWallet);
    await waitExecution(hWallet, createTokenTx);
    expect(createTokenTx.version).toEqual(CREATE_TOKEN_TX_VERSION);
    const tokenUID = createTokenTx.hash;

    // Contract pays the fee
    expect(createTokenTx.inputs).toHaveLength(0);

    expect(createTokenTx.outputs).toHaveLength(4);
    expect(createTokenTx.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 100n,
          tokenData: 1,
        }),
        expect.objectContaining({
          value: TOKEN_MINT_MASK,
          tokenData: TOKEN_AUTHORITY_MASK | 1,
        }),
        expect.objectContaining({
          value: TOKEN_MELT_MASK,
          tokenData: TOKEN_AUTHORITY_MASK | 1,
        }),
        expect.objectContaining({
          value: 4n,
          tokenData: 0,
        }),
      ])
    );

    // Grant authority

    const grantTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'token', value: tokenUID })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'grant_authority',
        caller: '{caller}',
        actions: [
          { action: 'grant_authority', authority: 'mint', token: '{token}' },
        ],
      })
      .build();

    const grantTx = await runTemplate(grantTemplate, hWallet);
    await waitExecution(hWallet, grantTx);

    expect(grantTx.inputs).toHaveLength(1);
    expect(grantTx.outputs).toHaveLength(0);

    // Mint tokens on the contract

    const mintTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'token', value: tokenUID })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'mint',
        caller: '{caller}',
        args: ['{token}', 200]
      })
      .build();

    const mintTx = await runTemplate(mintTemplate, hWallet);
    await waitExecution(hWallet, mintTx);

    expect(mintTx.inputs).toHaveLength(0);
    expect(mintTx.outputs).toHaveLength(0);

    const ncStateMint = await ncApi.getNanoContractState(
      contractId,
      [],
      [tokenUID, NATIVE_TOKEN_UID],
      [],
    );
    expect(BigInt(ncStateMint.balances[NATIVE_TOKEN_UID].value)).toBe(93n);
    expect(BigInt(ncStateMint.balances[tokenUID].value)).toBe(200n);

    const acquireTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'token', value: tokenUID })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'acquire_authority',
        caller: '{caller}',
        actions: [{ action: 'acquire_authority', token: '{token}', authority: 'mint' }],
      })
      .build();

    const acquireTx = await runTemplate(acquireTemplate, hWallet);
    await waitExecution(hWallet, acquireTx);

    expect(acquireTx.inputs).toHaveLength(0);
    expect(acquireTx.outputs).toHaveLength(1);
    expect(acquireTx.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: TOKEN_MINT_MASK,
          tokenData: TOKEN_AUTHORITY_MASK | 1,
        }),
      ])
    );

    const revokeTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'token', value: tokenUID })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'revoke',
        caller: '{caller}',
        args: ['{token}', true, true]
      })
      .build();

    const revokeTx = await runTemplate(revokeTemplate, hWallet);
    await waitExecution(hWallet, revokeTx);

    expect(revokeTx.inputs).toHaveLength(0);
    expect(revokeTx.outputs).toHaveLength(0);
    const ncStateRevoke = await ncApi.getNanoContractState(
      contractId,
      [],
      [tokenUID, NATIVE_TOKEN_UID],
      [],
    );

    expect(BigInt(ncStateRevoke.balances[NATIVE_TOKEN_UID].value)).toBe(93n);
    expect(BigInt(ncStateRevoke.balances[tokenUID].value)).toBe(200n);
    expect(ncStateRevoke.balances[tokenUID].can_mint).toBe(false);
    expect(ncStateRevoke.balances[tokenUID].can_melt).toBe(false);
  });
});
