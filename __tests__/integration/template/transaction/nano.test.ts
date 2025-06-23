import { GenesisWalletHelper } from '../../helpers/genesis-wallet.helper';
import {
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from '../../helpers/wallet.helper';

import HathorWallet from '../../../../src/new/wallet';
import SendTransaction from '../../../../src/new/sendTransaction';
import { TransactionTemplateBuilder } from '../../../../src/template/transaction/builder';
import { WalletTxTemplateInterpreter } from '../../../../src/template/transaction/interpreter';
import { CREATE_TOKEN_TX_VERSION, NATIVE_TOKEN_UID } from '../../../../src/constants';
import dateFormatter from '../../../../src/utils/date';

const DEBUG = true;
const builtInBlueprintId = '3cb032600bdf7db784800e4ea911b10676fa2f67591f82bb62628c234e771595';

describe('Template execution', () => {
  let hWallet: HathorWallet;
  let interpreter: WalletTxTemplateInterpreter;

  beforeAll(async () => {
    hWallet = await generateWalletHelper(null);
    interpreter = new WalletTxTemplateInterpreter(hWallet);
    const address = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address, 100n, {});
  });

  afterAll(async () => {
    await hWallet.stop();
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should be able to run a bet contract', async () => {
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 6000;
    const initializeTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'addr', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'oracle', call: { method: 'get_oracle_script', index: 0 } })
      .addSetVarAction({ name: 'blueprint', value: builtInBlueprintId })
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
    await waitForTxReceived(hWallet, initializeTx.hash, undefined);

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
    await waitForTxReceived(hWallet, bet1Tx.hash, undefined);

    expect(bet1Tx.outputs).toHaveLength(1);
    expect(bet1Tx.outputs[0].value).toEqual(90n);
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
    await waitForTxReceived(hWallet, bet2Tx.hash, undefined);

    expect(bet2Tx.outputs).toHaveLength(1);
    expect(bet2Tx.outputs[0].value).toEqual(70n);
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
    await waitForTxReceived(hWallet, setResultTx.hash, undefined);

    expect(setResultTx.outputs).toHaveLength(0);

    // Withdrawal

    const withdrawalTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'bet_addr', call: { method: 'get_wallet_address', index: 5 } })
      .addSetVarAction({ name: 'contract', value: contractId })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'withdraw',
        caller: '{caller}',
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
    await waitForTxReceived(hWallet, withdrawalTx.hash, undefined);

    expect(withdrawalTx.outputs).toHaveLength(1);
    expect(withdrawalTx.outputs[0].value).toEqual(30n);
    expect(withdrawalTx.outputs[0].tokenData).toEqual(0);
  });

  it('should be able to create a token and call nano', async () => {
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 9000;
    const initializeTemplate = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'addr', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'oracle', call: { method: 'get_oracle_script', index: 0 } })
      .addSetVarAction({ name: 'blueprint', value: builtInBlueprintId })
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
    await waitForTxReceived(hWallet, initializeTx.hash, undefined);

    // BET Template

    const bet1Template = TransactionTemplateBuilder.new()
      .addSetVarAction({ name: 'contract', value: contractId })
      .addSetVarAction({ name: 'caller', call: { method: 'get_wallet_address', index: 0 } })
      .addSetVarAction({ name: 'bet_addr', call: { method: 'get_wallet_address', index: 5 } })
      .addConfigAction({ createToken: true, tokenName: 'Tk bet', tokenSymbol: 'tkBet' })
      .addTokenOutput({ amount: 100, useCreatedToken: true, address: '{caller}' })
      .addNanoMethodExecution({
        id: '{contract}',
        method: 'bet',
        caller: '{caller}',
        args: ['{bet_addr}', '1x0'],
        actions: [
          { action: 'deposit', amount: 10n, changeAddress: '{caller}', skipSelection: true },
        ],
      })
      .addUtxoSelect({ fill: 11 }) // Adds 10 for the deposit + 1 for token creation fee
      .build();

    const bet1Tx = await interpreter.buildAndSign(bet1Template, DEFAULT_PIN_CODE, DEBUG);
    const bet1SendTx = new SendTransaction({ storage: hWallet.storage, transaction: bet1Tx });
    await bet1SendTx.runFromMining();
    expect(bet1Tx.hash).not.toBeNull();
    if (bet1Tx.hash === null) {
      throw new Error('Transaction does not have a hash');
    }
    await waitForTxReceived(hWallet, bet1Tx.hash, undefined);
    expect(bet1Tx.version).toEqual(CREATE_TOKEN_TX_VERSION);

    expect(bet1Tx.outputs).toHaveLength(2);
    expect(bet1Tx.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 100n,
          tokenData: 1,
        }),
        expect.objectContaining({
          value: expect.anything(), // change output
          tokenData: 0,
        }),
      ])
    );
  });
});
