import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
  waitNextBlock,
  waitTxConfirmed
} from '../helpers/wallet.helper';
import { HATHOR_TOKEN_CONFIG } from '../../../src/constants';
import ncApi from '../../../src/api/nano';
import helpersUtils from '../../../src/utils/helpers';
import dateFormatter from '../../../src/utils/date';
import { bufferToHex, hexToBuffer } from '../../../src/utils/buffer';
import Address from '../../../src/models/address';
import P2PKH from '../../../src/models/p2pkh';
import { isEmpty } from 'lodash';
import { getOracleBufferFromHex, getOracleInputData } from '../../../src/nano_contracts/utils';
import NanoContractTransactionParser from '../../../src/nano_contracts/parser';

// We have to skip this test because it needs nano contract support in the full node.
// Until we have this support in the public docker image, the CI won't succeed if this is not skipped
// After skipping it, we must also add `--nc-history-index` as a new parameter for the integration tests full node
// and add the blueprints in the configuration file for the tests privnet
describe('full cycle of bet nano contract', () => {
  /** @type HathorWallet */
  let hWallet;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    const tx = await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1000);
    await waitForTxReceived(hWallet, tx.hash);
  });

  afterAll(async () => {
    await hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  });

  const checkTxValid = async (txId) => {
    expect(txId).toBeDefined();
    await waitForTxReceived(hWallet, txId);
    // We need to wait for the tx to get a first block, so we guarantee it was executed
    await waitTxConfirmed(hWallet, txId);
    // Now we query the transaction from the full node to double check it's still valid after the nano execution
    // and it already has a first block, so it was really executed
    const txAfterExecution = await hWallet.getFullTxById(txId);
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(isEmpty(txAfterExecution.meta.first_block)).not.toBeNull();
  }

  it('bet deposit', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const address1 = await hWallet.getAddressAtIndex(1);
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 6000;
    const network = hWallet.getNetworkObject();
    const blueprintId = '3cb032600bdf7db784800e4ea911b10676fa2f67591f82bb62628c234e771595';

    // Create NC
    const oracleData = getOracleBufferFromHex(address1, network);
    const tx1 = await hWallet.createAndSendNanoContractTransaction(
      'initialize',
      address0,
      {
        blueprintId,
        args: [
          bufferToHex(oracleData),
          HATHOR_TOKEN_CONFIG.uid,
          dateLastBet
        ]
      }
    );
    await checkTxValid(tx1.hash);
    const tx1Data = await hWallet.getFullTxById(tx1.hash);

    const tx1Parser = new NanoContractTransactionParser(blueprintId, 'initialize', tx1Data.tx.nc_pubkey, tx1Data.tx.nc_args);
    tx1Parser.parseAddress();
    await tx1Parser.parseArguments();
    expect(tx1Parser.address.base58).toBe(address0);
    expect(tx1Parser.parsedArgs).toStrictEqual([
      { name: 'oracle_script', type: 'bytes', parsed: oracleData },
      { name: 'token_uid', type: 'bytes', parsed: Buffer.from([HATHOR_TOKEN_CONFIG.uid]) },
      { name: 'date_last_offer', type: 'int', parsed: dateLastBet },
    ]);

    // Bet 100 to address 2
    const address2 = await hWallet.getAddressAtIndex(2);
    const address2Obj = new Address(address2, { network });
    const txBet = await hWallet.createAndSendNanoContractTransaction(
      'bet',
      address2,
      {
        ncId: tx1.hash,
        args: [
          bufferToHex(address2Obj.decode()),
          '1x0'
        ],
        actions: [
          {
            type: 'deposit',
            token: HATHOR_TOKEN_CONFIG.uid,
            amount: 100
          }
        ],
      }
    );
    await checkTxValid(txBet.hash);
    const txBetData = await hWallet.getFullTxById(txBet.hash);

    const txBetParser = new NanoContractTransactionParser(blueprintId, 'bet', txBetData.tx.nc_pubkey, txBetData.tx.nc_args);
    txBetParser.parseAddress();
    await txBetParser.parseArguments();
    expect(txBetParser.address.base58).toBe(address2);
    expect(txBetParser.parsedArgs).toStrictEqual([
      { name: 'address', type: 'bytes', parsed: address2Obj.decode() },
      { name: 'score', type: 'str', parsed: '1x0' },
    ]);

    // Bet 200 to address 3
    const address3 = await hWallet.getAddressAtIndex(3);
    const address3Obj = new Address(address3, { network });
    const txBet2 = await hWallet.createAndSendNanoContractTransaction(
      'bet',
      address3,
      {
        ncId: tx1.hash,
        args: [
          bufferToHex(address3Obj.decode()),
          '2x0'
        ],
        actions: [
          {
            type: 'deposit',
            token: HATHOR_TOKEN_CONFIG.uid,
            amount: 200
          }
        ],
      }
    );
    await checkTxValid(txBet2.hash);
    const txBet2Data = await hWallet.getFullTxById(txBet2.hash);

    const txBet2Parser = new NanoContractTransactionParser(blueprintId, 'bet', txBet2Data.tx.nc_pubkey, txBet2Data.tx.nc_args);
    txBet2Parser.parseAddress();
    await txBet2Parser.parseArguments();
    expect(txBet2Parser.address.base58).toBe(address3);
    expect(txBet2Parser.parsedArgs).toStrictEqual([
      { name: 'address', type: 'bytes', parsed: address3Obj.decode() },
      { name: 'score', type: 'str', parsed: '2x0' },
    ]);

    // Get nc history
    const txIds = [tx1.hash, txBet.hash, txBet2.hash];
    const ncHistory = await ncApi.getNanoContractHistory(tx1.hash);
    expect(ncHistory.history.length).toBe(3);
    for (const tx of ncHistory.history) {
      expect(txIds).toContain(tx.hash);
    }

    // Get NC state
    const ncState = await ncApi.getNanoContractState(
      tx1.hash,
      [
        'token_uid',
        'total',
        'final_result',
        'oracle_script',
        'date_last_offer',
        `address_details.a'${address2}'`,
        `withdrawals.a'${address2}'`,
        `address_details.a'${address3}'`,
        `withdrawals.a'${address3}'`
      ]
    );
    const addressObj1 = new Address(address1, { network });
    const outputScriptObj1 = new P2PKH(addressObj1);
    const outputScriptBuffer1 = outputScriptObj1.createScript();

    expect(ncState.fields.token_uid.value).toBe(HATHOR_TOKEN_CONFIG.uid);
    expect(ncState.fields.date_last_offer.value).toBe(dateLastBet);
    expect(ncState.fields.oracle_script.value).toBe(bufferToHex(outputScriptBuffer1));
    expect(ncState.fields.final_result.value).toBeNull();
    expect(ncState.fields.total.value).toBe(300);
    expect(ncState.fields[`address_details.a'${address2}'`].value).toHaveProperty('1x0', 100);
    expect(ncState.fields[`withdrawals.a'${address2}'`].value).toBeUndefined();
    expect(ncState.fields[`address_details.a'${address3}'`].value).toHaveProperty('2x0', 200);
    expect(ncState.fields[`withdrawals.a'${address3}'`].value).toBeUndefined();

    // Set result to '1x0'
    const result = '1x0';
    const resultSerialized = Buffer.from(result, 'utf8');
    const inputData = await getOracleInputData(oracleData, resultSerialized, hWallet);
    const txSetResult = await hWallet.createAndSendNanoContractTransaction(
      'set_result',
      address1,
      {
        ncId: tx1.hash,
        args: [
          `${bufferToHex(inputData)},${result},str`
        ],
      }
    );
    await checkTxValid(txSetResult.hash);
    txIds.push(txSetResult.hash);

    const txSetResultData = await hWallet.getFullTxById(txSetResult.hash);

    const txSetResultParser = new NanoContractTransactionParser(blueprintId, 'set_result', txSetResultData.tx.nc_pubkey, txSetResultData.tx.nc_args);
    txSetResultParser.parseAddress();
    await txSetResultParser.parseArguments();
    expect(txSetResultParser.address.base58).toBe(address1);
    expect(txSetResultParser.parsedArgs).toStrictEqual([
      { name: 'result', type: 'SignedData[str]', parsed: `${bufferToHex(inputData)},${result},str` },
    ]);

    // Try to withdraw to address 2, success
    const txWithdrawal = await hWallet.createAndSendNanoContractTransaction(
      'withdraw',
      address2,
      {
        ncId: tx1.hash,
        actions: [
          {
            type: 'withdrawal',
            token: HATHOR_TOKEN_CONFIG.uid,
            amount: 300,
            address: address2
          }
        ],
      }
    );
    await checkTxValid(txWithdrawal.hash);
    txIds.push(txWithdrawal.hash);

    const txWithdrawalData = await hWallet.getFullTxById(txWithdrawal.hash);

    const txWithdrawalParser = new NanoContractTransactionParser(blueprintId, 'set_result', txWithdrawalData.tx.nc_pubkey, txWithdrawalData.tx.nc_args);
    txWithdrawalParser.parseAddress();
    await txWithdrawalParser.parseArguments();
    expect(txWithdrawalParser.address.base58).toBe(address2);
    expect(txWithdrawalParser.parsedArgs).toBe(null);
    
    // Get state again
    const ncState2 = await ncApi.getNanoContractState(
      tx1.hash,
      [
        'token_uid',
        'total',
        'final_result',
        'oracle_script',
        'date_last_offer',
        `address_details.a'${address2}'`,
        `withdrawals.a'${address2}'`,
        `address_details.a'${address3}'`,
        `withdrawals.a'${address3}'`
      ]
    );
    expect(ncState2.fields.token_uid.value).toBe(HATHOR_TOKEN_CONFIG.uid);
    expect(ncState2.fields.date_last_offer.value).toBe(dateLastBet);
    expect(ncState2.fields.oracle_script.value).toBe(bufferToHex(outputScriptBuffer1));
    expect(ncState2.fields.final_result.value).toBe('1x0');
    expect(ncState2.fields.total.value).toBe(300);
    expect(ncState2.fields[`address_details.a'${address2}'`].value).toHaveProperty('1x0', 100);
    expect(ncState2.fields[`withdrawals.a'${address2}'`].value).toBe(300);
    expect(ncState2.fields[`address_details.a'${address3}'`].value).toHaveProperty('2x0', 200);
    expect(ncState2.fields[`withdrawals.a'${address3}'`].value).toBeUndefined();

    // Get history again
    const ncHistory2 = await ncApi.getNanoContractHistory(tx1.hash);
    expect(ncHistory2.history.length).toBe(5);
    for (const tx of ncHistory2.history) {
      expect(txIds).toContain(tx.hash);
    }
  });
});
