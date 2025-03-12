import fs from 'fs';
import { isEmpty } from 'lodash';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { WALLET_CONSTANTS } from '../configuration/test-constants';
import {
  generateMultisigWalletHelper,
  generateWalletHelper,
  waitForTxReceived,
  waitNextBlock,
  waitTxConfirmed,
} from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID, NANO_CONTRACTS_INITIALIZE_METHOD } from '../../../src/constants';
import ncApi from '../../../src/api/nano';
import dateFormatter from '../../../src/utils/date';
import { bufferToHex } from '../../../src/utils/buffer';
import Address from '../../../src/models/address';
import P2PKH from '../../../src/models/p2pkh';
import P2SH from '../../../src/models/p2sh';
import {
  getOracleBuffer,
  getOracleInputData,
  isNanoContractCreateTx,
} from '../../../src/nano_contracts/utils';
import Serializer from '../../../src/nano_contracts/serializer';
import {
  NanoContractTransactionError,
  NanoRequest404Error,
  PinRequiredError,
} from '../../../src/errors';
import { OutputType } from '../../../src/wallet/types';
import NanoContractTransactionParser from '../../../src/nano_contracts/parser';

let fundsTx;
const builtInBlueprintId = '3cb032600bdf7db784800e4ea911b10676fa2f67591f82bb62628c234e771595';

describe('full cycle of bet nano contract', () => {
  /** @type HathorWallet */
  let hWallet;
  let mhWallet;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    fundsTx = await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      1000n
    );

    mhWallet = await generateMultisigWalletHelper({ walletIndex: 3 });
    await GenesisWalletHelper.injectFunds(mhWallet, await mhWallet.getAddressAtIndex(0), 1000n);
  });

  afterAll(async () => {
    await hWallet.stop();
    await mhWallet.stop();
    await GenesisWalletHelper.clearListeners();
  });

  const checkTxValid = async (wallet, txId) => {
    expect(txId).toBeDefined();
    await waitForTxReceived(wallet, txId);
    // We need to wait for the tx to get a first block, so we guarantee it was executed
    await waitTxConfirmed(wallet, txId);
    // Now we query the transaction from the full node to double check it's still valid after the nano execution
    // and it already has a first block, so it was really executed
    const txAfterExecution = await wallet.getFullTxById(txId);
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(isEmpty(txAfterExecution.meta.first_block)).not.toBeNull();
  };

  const executeTests = async (wallet, blueprintId) => {
    const address0 = await wallet.getAddressAtIndex(0);
    const address1 = await wallet.getAddressAtIndex(1);
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 6000;
    const network = wallet.getNetworkObject();

    const utxos = await wallet.getUtxos();
    // We must have one utxo in the address 0 of 1000 HTR
    expect(utxos.utxos.length).toBe(1);
    expect(utxos.utxos[0].address).toBe(address0);
    expect(utxos.utxos[0].amount).toBe(1000n);

    // We must have one transaction in the address0
    const address0Meta = await wallet.storage.store.getAddressMeta(address0);
    expect(address0Meta.numTransactions).toBe(1);

    // Create NC
    const oracleData = getOracleBuffer(address1, network);
    const tx1 = await wallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId,
        args: [bufferToHex(oracleData), NATIVE_TOKEN_UID, dateLastBet],
      }
    );
    await checkTxValid(wallet, tx1.hash);
    const tx1Data = await wallet.getFullTxById(tx1.hash);
    expect(isNanoContractCreateTx(tx1Data.tx)).toBe(true);

    // We must have two transactions in the address0
    const address0Meta2 = await wallet.storage.store.getAddressMeta(address0);
    expect(address0Meta2.numTransactions).toBe(2);

    const tx1Parser = new NanoContractTransactionParser(
      blueprintId,
      NANO_CONTRACTS_INITIALIZE_METHOD,
      tx1Data.tx.nc_pubkey,
      network,
      tx1Data.tx.nc_args
    );
    tx1Parser.parseAddress(network);
    await tx1Parser.parseArguments();
    expect(tx1Parser.address.base58).toBe(address0);
    expect(tx1Parser.parsedArgs).toStrictEqual([
      { name: 'oracle_script', type: 'TxOutputScript', parsed: oracleData },
      { name: 'token_uid', type: 'TokenUid', parsed: Buffer.from([NATIVE_TOKEN_UID]) },
      { name: 'date_last_bet', type: 'Timestamp', parsed: dateLastBet },
    ]);

    // First validate some bet arguments error handling
    const address2 = await wallet.getAddressAtIndex(2);

    // Address must be a string
    await expect(
      wallet.createAndSendNanoContractTransaction('bet', address2, {
        ncId: tx1.hash,
        args: [1234, '1x0'],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100,
            changeAddress: address0,
          },
        ],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Invalid address
    await expect(
      wallet.createAndSendNanoContractTransaction('bet', address2, {
        ncId: tx1.hash,
        args: ['1234', '1x0'],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100,
            changeAddress: address0,
          },
        ],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Bet 100 to address 2
    const txBet = await wallet.createAndSendNanoContractTransaction('bet', address2, {
      ncId: tx1.hash,
      args: [address2, '1x0'],
      actions: [
        {
          type: 'deposit',
          token: NATIVE_TOKEN_UID,
          amount: 100n,
          changeAddress: address0,
        },
      ],
    });
    await checkTxValid(wallet, txBet.hash);
    const txBetData = await wallet.getFullTxById(txBet.hash);
    expect(isNanoContractCreateTx(txBetData.tx)).toBe(false);

    // We must have three transactions in the address0 and one in address2
    // the input and change output of this tx is from address0 and the caller is address2
    const address0Meta3 = await wallet.storage.store.getAddressMeta(address0);
    expect(address0Meta3.numTransactions).toBe(3);

    const address2Meta = await wallet.storage.store.getAddressMeta(address2);
    expect(address2Meta.numTransactions).toBe(1);

    const txBetParser = new NanoContractTransactionParser(
      blueprintId,
      'bet',
      txBetData.tx.nc_pubkey,
      network,
      txBetData.tx.nc_args
    );
    txBetParser.parseAddress(network);
    await txBetParser.parseArguments();
    expect(txBetParser.address.base58).toBe(address2);
    expect(txBetParser.parsedArgs).toStrictEqual([
      { name: 'address', type: 'Address', parsed: address2 },
      { name: 'score', type: 'str', parsed: '1x0' },
    ]);

    const utxos2 = await wallet.getUtxos();
    // We must have one utxo in the address 0 of 900 HTR
    // this validates that the change address parameter worked fine
    expect(utxos2.utxos.length).toBe(1);
    expect(utxos2.utxos[0].address).toBe(address0);
    expect(utxos2.utxos[0].amount).toBe(900n);

    // Bet 200 to address 3
    const address3 = await wallet.getAddressAtIndex(3);
    const txBet2 = await wallet.createAndSendNanoContractTransaction('bet', address3, {
      ncId: tx1.hash,
      args: [address3, '2x0'],
      actions: [
        {
          type: 'deposit',
          token: NATIVE_TOKEN_UID,
          amount: 200n,
          changeAddress: address0,
        },
      ],
    });
    await checkTxValid(wallet, txBet2.hash);
    const txBet2Data = await wallet.getFullTxById(txBet2.hash);
    expect(isNanoContractCreateTx(txBet2Data.tx)).toBe(false);

    // We must have four transactions in the address0 and one in address3
    // the input of this tx is from address0 and the caller is address3
    const address0Meta4 = await wallet.storage.store.getAddressMeta(address0);
    expect(address0Meta4.numTransactions).toBe(4);

    const address3Meta = await wallet.storage.store.getAddressMeta(address3);
    expect(address3Meta.numTransactions).toBe(1);

    const txBet2Parser = new NanoContractTransactionParser(
      blueprintId,
      'bet',
      txBet2Data.tx.nc_pubkey,
      network,
      txBet2Data.tx.nc_args
    );
    txBet2Parser.parseAddress(network);
    await txBet2Parser.parseArguments();
    expect(txBet2Parser.address.base58).toBe(address3);
    expect(txBet2Parser.parsedArgs).toStrictEqual([
      { name: 'address', type: 'Address', parsed: address3 },
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
    const ncState = await ncApi.getNanoContractState(tx1.hash, [
      'token_uid',
      'total',
      'final_result',
      'oracle_script',
      'date_last_bet',
      `address_details.a'${address2}'`,
      `withdrawals.a'${address2}'`,
      `address_details.a'${address3}'`,
      `withdrawals.a'${address3}'`,
    ]);
    const addressObj1 = new Address(address1, { network });
    const outputScriptType = addressObj1.getType();
    let outputScript;
    if (outputScriptType === OutputType.P2PKH) {
      outputScript = new P2PKH(addressObj1);
    } else if (outputScriptType === OutputType.P2SH) {
      outputScript = new P2SH(addressObj1);
    } else {
      throw new Error('Invalid address.');
    }
    const outputScriptBuffer1 = outputScript.createScript();

    expect(ncState.fields.token_uid.value).toBe(NATIVE_TOKEN_UID);
    expect(ncState.fields.date_last_bet.value).toBe(dateLastBet);
    expect(ncState.fields.oracle_script.value).toBe(bufferToHex(outputScriptBuffer1));
    expect(ncState.fields.final_result.value).toBeNull();
    expect(ncState.fields.total.value).toBe(300);
    expect(ncState.fields[`address_details.a'${address2}'`].value).toHaveProperty('1x0', 100);
    expect(ncState.fields[`withdrawals.a'${address2}'`].value).toBeUndefined();
    expect(ncState.fields[`address_details.a'${address3}'`].value).toHaveProperty('2x0', 200);
    expect(ncState.fields[`withdrawals.a'${address3}'`].value).toBeUndefined();

    // Set result to '1x0'
    const nanoSerializer = new Serializer();
    const result = '1x0';
    const resultSerialized = nanoSerializer.serializeFromType(result, 'str');
    const inputData = await getOracleInputData(oracleData, resultSerialized, wallet);
    const txSetResult = await wallet.createAndSendNanoContractTransaction('set_result', address1, {
      ncId: tx1.hash,
      args: [`${bufferToHex(inputData)},${result},str`],
    });
    await checkTxValid(wallet, txSetResult.hash);
    txIds.push(txSetResult.hash);
    const txSetResultData = await wallet.getFullTxById(txSetResult.hash);
    expect(isNanoContractCreateTx(txSetResultData.tx)).toBe(false);

    // We must have one transaction in the address1
    const address1Meta = await wallet.storage.store.getAddressMeta(address1);
    expect(address1Meta.numTransactions).toBe(1);

    const txSetResultParser = new NanoContractTransactionParser(
      blueprintId,
      'set_result',
      txSetResultData.tx.nc_pubkey,
      network,
      txSetResultData.tx.nc_args
    );
    txSetResultParser.parseAddress(network);
    await txSetResultParser.parseArguments();
    expect(txSetResultParser.address.base58).toBe(address1);
    expect(txSetResultParser.parsedArgs).toStrictEqual([
      {
        name: 'result',
        type: 'SignedData[str]',
        parsed: `${bufferToHex(inputData)},${result},str`,
      },
    ]);

    // Try to withdraw to address 2, success
    const txWithdrawal = await wallet.createAndSendNanoContractTransaction('withdraw', address2, {
      ncId: tx1.hash,
      actions: [
        {
          type: 'withdrawal',
          token: NATIVE_TOKEN_UID,
          amount: 300n,
          address: address2,
        },
      ],
    });
    await checkTxValid(wallet, txWithdrawal.hash);
    txIds.push(txWithdrawal.hash);

    const txWithdrawalData = await wallet.getFullTxById(txWithdrawal.hash);
    expect(isNanoContractCreateTx(txWithdrawalData)).toBe(false);

    // We must have two transactions in the address2
    const address2Meta2 = await wallet.storage.store.getAddressMeta(address2);
    expect(address2Meta2.numTransactions).toBe(2);

    const txWithdrawalParser = new NanoContractTransactionParser(
      blueprintId,
      'set_result',
      txWithdrawalData.tx.nc_pubkey,
      network,
      txWithdrawalData.tx.nc_args
    );
    txWithdrawalParser.parseAddress(network);
    await txWithdrawalParser.parseArguments();
    expect(txWithdrawalParser.address.base58).toBe(address2);
    expect(txWithdrawalParser.parsedArgs).toBe(null);

    // Get state again
    const ncState2 = await ncApi.getNanoContractState(tx1.hash, [
      'token_uid',
      'total',
      'final_result',
      'oracle_script',
      'date_last_bet',
      `address_details.a'${address2}'`,
      `withdrawals.a'${address2}'`,
      `address_details.a'${address3}'`,
      `withdrawals.a'${address3}'`,
    ]);
    expect(ncState2.fields.token_uid.value).toBe(NATIVE_TOKEN_UID);
    expect(ncState2.fields.date_last_bet.value).toBe(dateLastBet);
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

    // Get tx history with success
    const txHistory = await wallet.getTxHistory();
    expect(txHistory).toHaveLength(4);

    // Now test getting nano state in a past block, after the second bet
    const bet2TxData = await wallet.getFullTxById(txBet2.hash);
    const firstBlock = bet2TxData.meta.first_block;
    const firstBlockHeight = bet2TxData.meta.first_block_height;

    // Get NC state in the past, using txBet2 first block
    const ncStateFirstBlock = await ncApi.getNanoContractState(
      tx1.hash,
      [
        'token_uid',
        'total',
        'final_result',
        'oracle_script',
        'date_last_bet',
        `address_details.a'${address2}'`,
        `withdrawals.a'${address2}'`,
        `address_details.a'${address3}'`,
        `withdrawals.a'${address3}'`,
      ],
      [],
      [],
      firstBlock
    );

    expect(ncStateFirstBlock.fields.token_uid.value).toBe(NATIVE_TOKEN_UID);
    expect(ncStateFirstBlock.fields.date_last_bet.value).toBe(dateLastBet);
    expect(ncStateFirstBlock.fields.oracle_script.value).toBe(bufferToHex(outputScriptBuffer1));
    expect(ncStateFirstBlock.fields.final_result.value).toBeNull();
    expect(ncStateFirstBlock.fields.total.value).toBe(300);
    expect(ncStateFirstBlock.fields[`address_details.a'${address2}'`].value).toHaveProperty(
      '1x0',
      100
    );
    expect(ncStateFirstBlock.fields[`withdrawals.a'${address2}'`].value).toBeUndefined();
    expect(ncStateFirstBlock.fields[`address_details.a'${address3}'`].value).toHaveProperty(
      '2x0',
      200
    );
    expect(ncStateFirstBlock.fields[`withdrawals.a'${address3}'`].value).toBeUndefined();

    // Get NC state in the past, using txBet2 first block height
    const ncStateFirstBlockHeight = await ncApi.getNanoContractState(
      tx1.hash,
      [
        'token_uid',
        'total',
        'final_result',
        'oracle_script',
        'date_last_bet',
        `address_details.a'${address2}'`,
        `withdrawals.a'${address2}'`,
        `address_details.a'${address3}'`,
        `withdrawals.a'${address3}'`,
      ],
      [],
      [],
      null,
      firstBlockHeight
    );

    expect(ncStateFirstBlockHeight.fields.token_uid.value).toBe(NATIVE_TOKEN_UID);
    expect(ncStateFirstBlockHeight.fields.date_last_bet.value).toBe(dateLastBet);
    expect(ncStateFirstBlockHeight.fields.oracle_script.value).toBe(
      bufferToHex(outputScriptBuffer1)
    );
    expect(ncStateFirstBlockHeight.fields.final_result.value).toBeNull();
    expect(ncStateFirstBlockHeight.fields.total.value).toBe(300);
    expect(ncStateFirstBlockHeight.fields[`address_details.a'${address2}'`].value).toHaveProperty(
      '1x0',
      100
    );
    expect(ncStateFirstBlockHeight.fields[`withdrawals.a'${address2}'`].value).toBeUndefined();
    expect(ncStateFirstBlockHeight.fields[`address_details.a'${address3}'`].value).toHaveProperty(
      '2x0',
      200
    );
    expect(ncStateFirstBlockHeight.fields[`withdrawals.a'${address3}'`].value).toBeUndefined();

    // Test a tx that becomes voided after the nano execution
    const txWithdrawal2 = await wallet.createAndSendNanoContractTransaction('withdraw', address2, {
      ncId: tx1.hash,
      actions: [
        {
          type: 'withdrawal',
          token: NATIVE_TOKEN_UID,
          amount: 400n,
          address: address2,
        },
      ],
    });

    jest.spyOn(wallet.storage, 'processHistory');
    expect(wallet.storage.processHistory.mock.calls.length).toBe(0);
    await waitNextBlock(wallet.storage);
    const txWithdrawal2Data = await wallet.getFullTxById(txWithdrawal2.hash);

    // The tx became voided after the block because of the nano execution
    // This voidness called the full processHistory method
    expect(isEmpty(txWithdrawal2Data.meta.voided_by)).toBe(false);
    expect(wallet.storage.processHistory.mock.calls.length).toBe(1);
  };

  it('bet deposit built in', async () => {
    await executeTests(hWallet, builtInBlueprintId);
  });

  // The hathor-core and the wallet-lib are still not ready for
  // using nano contracts with a Multisig wallet
  it.skip('bet deposit built in with multisig wallet', async () => {
    await executeTests(mhWallet, builtInBlueprintId);
  });

  it('bet deposit on chain blueprint', async () => {
    // For now the on chain blueprints needs a signature from a specific address
    // so we must always generate the same seed
    const { seed } = WALLET_CONSTANTS.ocb;
    const ocbWallet = await generateWalletHelper({ seed });
    // We use the address0 to inject funds because they are needed for the nano tests execution
    const address0 = await ocbWallet.getAddressAtIndex(0);
    // We use the address10 as caller of the ocb tx
    // so we don't mess with the number of transactions for address0 tests
    const address10 = await ocbWallet.getAddressAtIndex(10);

    // Add funds and validate address meta
    await GenesisWalletHelper.injectFunds(ocbWallet, address0, 1000n);
    const address0Meta = await ocbWallet.storage.store.getAddressMeta(address0);
    expect(address0Meta.numTransactions).toBe(1);

    // Use the bet blueprint code
    const code = fs.readFileSync('./__tests__/integration/configuration/bet.py', 'utf8');
    const tx = await ocbWallet.createAndSendOnChainBlueprintTransaction(code, address10);
    // Wait for the tx to be confirmed, so we can use the on chain blueprint
    await waitTxConfirmed(ocbWallet, tx.hash);
    // We must have one transaction in the address10 now
    const newAddress10Meta = await ocbWallet.storage.store.getAddressMeta(address10);
    expect(newAddress10Meta.numTransactions).toBe(1);
    // Execute the bet blueprint tests
    await executeTests(ocbWallet, tx.hash);
  });

  it('handle errors', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const address1 = await hWallet.getAddressAtIndex(1);
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 6000;
    const network = hWallet.getNetworkObject();

    // Initialize missing blueprintId
    const oracleData = getOracleBuffer(address1, network);
    await expect(
      hWallet.createAndSendNanoContractTransaction(NANO_CONTRACTS_INITIALIZE_METHOD, address0, {
        args: [bufferToHex(oracleData), NATIVE_TOKEN_UID, dateLastBet],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Invalid blueprint id
    await expect(
      hWallet.createAndSendNanoContractTransaction(NANO_CONTRACTS_INITIALIZE_METHOD, address0, {
        blueprintId: '1234',
        args: [bufferToHex(oracleData), NATIVE_TOKEN_UID, dateLastBet],
      })
    ).rejects.toThrow(NanoRequest404Error);

    // Missing last argument
    await expect(
      hWallet.createAndSendNanoContractTransaction(NANO_CONTRACTS_INITIALIZE_METHOD, address0, {
        blueprintId: builtInBlueprintId,
        args: [bufferToHex(oracleData), NATIVE_TOKEN_UID],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Args as null
    await expect(
      hWallet.createAndSendNanoContractTransaction(NANO_CONTRACTS_INITIALIZE_METHOD, address0, {
        blueprintId: builtInBlueprintId,
        args: null,
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Address selected to sign does not belong to the wallet
    const hWallet2 = await generateWalletHelper();
    const addressNewWallet = await hWallet2.getAddressAtIndex(0);
    await expect(
      hWallet.createAndSendNanoContractTransaction(
        NANO_CONTRACTS_INITIALIZE_METHOD,
        addressNewWallet,
        {
          blueprintId: builtInBlueprintId,
          args: [bufferToHex(oracleData), NATIVE_TOKEN_UID, dateLastBet],
        }
      )
    ).rejects.toThrow(NanoContractTransactionError);

    // Oracle data is expected to be a hexa
    await expect(
      hWallet.createAndSendNanoContractTransaction(NANO_CONTRACTS_INITIALIZE_METHOD, address0, {
        blueprintId: builtInBlueprintId,
        args: ['error', NATIVE_TOKEN_UID, dateLastBet],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Date last bet is expected to be an integer
    await expect(
      hWallet.createAndSendNanoContractTransaction(NANO_CONTRACTS_INITIALIZE_METHOD, address0, {
        blueprintId: builtInBlueprintId,
        args: ['123', NATIVE_TOKEN_UID, 'error'],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Missing ncId for bet
    const address2 = await hWallet.getAddressAtIndex(2);
    await expect(
      hWallet.createAndSendNanoContractTransaction('bet', address2, {
        args: [address2, '1x0'],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100n,
          },
        ],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Invalid ncId for bet
    await expect(
      hWallet.createAndSendNanoContractTransaction('bet', address2, {
        ncId: '1234',
        args: [address2, '1x0'],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100n,
          },
        ],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Invalid ncId for bet again
    await expect(
      hWallet.createAndSendNanoContractTransaction('bet', address2, {
        ncId: fundsTx.hash,
        args: [address2, '1x0'],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100n,
          },
        ],
      })
    ).rejects.toThrow(NanoContractTransactionError);

    // Test ocb errors
    const { seed } = WALLET_CONSTANTS.ocb;
    const ocbWallet = await generateWalletHelper({ seed });

    const code = fs.readFileSync('./__tests__/integration/configuration/bet.py', 'utf8');
    // Use an address that is not from the ocbWallet
    await expect(
      ocbWallet.createAndSendOnChainBlueprintTransaction(code, address0)
    ).rejects.toThrow(NanoContractTransactionError);

    // If we remove the pin from the wallet object, it should throw error
    const oldPin = ocbWallet.pinCode;
    ocbWallet.pinCode = '';
    await expect(
      ocbWallet.createAndSendOnChainBlueprintTransaction(code, address0)
    ).rejects.toThrow(PinRequiredError);

    // Add the pin back in case there are more tests here
    ocbWallet.pinCode = oldPin;
  });
});
