import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  generateMultisigWalletHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
  waitNextBlock,
  waitTxConfirmed
} from '../helpers/wallet.helper';
import {
  HATHOR_TOKEN_CONFIG,
  NANO_CONTRACTS_INITIALIZE_METHOD
} from '../../../src/constants';
import ncApi from '../../../src/api/nano';
import helpersUtils from '../../../src/utils/helpers';
import dateFormatter from '../../../src/utils/date';
import { bufferToHex, hexToBuffer } from '../../../src/utils/buffer';
import Address from '../../../src/models/address';
import P2PKH from '../../../src/models/p2pkh';
import { isEmpty } from 'lodash';
import { getOracleBuffer, getOracleInputData } from '../../../src/nano_contracts/utils';
import Serializer from '../../../src/nano_contracts/serializer';
import { NanoContractTransactionError, NanoRequest404Error } from '../../../src/errors';
import { OutputType } from '../../../src/wallet/types';

let fundsTx;
const blueprintId = '3cb032600bdf7db784800e4ea911b10676fa2f67591f82bb62628c234e771595';

describe('full cycle of bet nano contract', () => {
  /** @type HathorWallet */
  let hWallet;
  let mhWallet;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    fundsTx = await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1000);

    mhWallet = await generateMultisigWalletHelper({ walletIndex: 3 });
    await GenesisWalletHelper.injectFunds(mhWallet, await mhWallet.getAddressAtIndex(0), 1000);
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
  }

  const executeTests = async (wallet) => {
    const address0 = await wallet.getAddressAtIndex(0);
    const address1 = await wallet.getAddressAtIndex(1);
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 6000;
    const network = wallet.getNetworkObject();

    const utxos = await wallet.getUtxos();
    // We must have one utxo in the address 0 of 1000 HTR
    expect(utxos.utxos.length).toBe(1);
    expect(utxos.utxos[0].address).toBe(address0);
    expect(utxos.utxos[0].amount).toBe(1000);

    // Create NC
    const oracleData = getOracleBuffer(address1, network);
    const tx1 = await wallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
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
    await checkTxValid(wallet, tx1.hash);

    // Bet 100 to address 2
    const address2 = await wallet.getAddressAtIndex(2);
    const address2Obj = new Address(address2, { network });
    const txBet = await wallet.createAndSendNanoContractTransaction(
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
            amount: 100,
            changeAddress: address0,
          }
        ],
      }
    );
    await checkTxValid(wallet, txBet.hash);

    const utxos2 = await wallet.getUtxos();
    // We must have one utxo in the address 0 of 900 HTR
    // this validates that the change address parameter worked fine
    expect(utxos2.utxos.length).toBe(1);
    expect(utxos2.utxos[0].address).toBe(address0);
    expect(utxos2.utxos[0].amount).toBe(900);

    // Bet 200 to address 3
    const address3 = await wallet.getAddressAtIndex(3);
    const address3Obj = new Address(address3, { network });
    const txBet2 = await wallet.createAndSendNanoContractTransaction(
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
    await checkTxValid(wallet, txBet2.hash);

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
    const nanoSerializer = new Serializer();
    const result = '1x0';
    const resultSerialized = nanoSerializer.serializeFromType(result, 'str');
    const inputData = await getOracleInputData(oracleData, resultSerialized, wallet);
    const txSetResult = await wallet.createAndSendNanoContractTransaction(
      'set_result',
      address1,
      {
        ncId: tx1.hash,
        args: [
          `${bufferToHex(inputData)},${result},str`
        ],
      }
    );
    await checkTxValid(wallet, txSetResult.hash);

    // Try to withdraw to address 2, success
    const txWithdrawal = await wallet.createAndSendNanoContractTransaction(
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
    await checkTxValid(wallet, txWithdrawal.hash);
  }

  it('bet deposit', async () => {
    await executeTests(hWallet);
  });

  // The hathor-core and the wallet-lib are still not ready for
  // using nano contracts with a Multisig wallet
  it.skip('bet deposit with multisig wallet', async () => {
    await executeTests(mhWallet);
  });

  it('handle errors', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const address1 = await hWallet.getAddressAtIndex(1);
    const dateLastBet = dateFormatter.dateToTimestamp(new Date()) + 6000;
    const network = hWallet.getNetworkObject();
    const blueprintId = '3cb032600bdf7db784800e4ea911b10676fa2f67591f82bb62628c234e771595';

    // Initialize missing blueprintId
    const oracleData = getOracleBuffer(address1, network);
    await expect(hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        args: [
          bufferToHex(oracleData),
          HATHOR_TOKEN_CONFIG.uid,
          dateLastBet
        ]
      }
    )).rejects.toThrow(NanoContractTransactionError);

    // Invalid blueprint id
    await expect(hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId: '1234',
        args: [
          bufferToHex(oracleData),
          HATHOR_TOKEN_CONFIG.uid,
          dateLastBet
        ]
      }
    )).rejects.toThrow(NanoRequest404Error);

    // Missing last argument
    await expect(hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId,
        args: [
          bufferToHex(oracleData),
          HATHOR_TOKEN_CONFIG.uid,
        ]
      }
    )).rejects.toThrow(NanoContractTransactionError);

    // Address selected to sign does not belong to the wallet
    const hWallet2 = await generateWalletHelper();
    const addressNewWallet = await hWallet2.getAddressAtIndex(0);
    await expect(hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      addressNewWallet,
      {
        blueprintId,
        args: [
          bufferToHex(oracleData),
          HATHOR_TOKEN_CONFIG.uid,
          dateLastBet
        ]
      }
    )).rejects.toThrow(NanoContractTransactionError);

    // Oracle data is expected to be a hexa
    await expect(hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId,
        args: [
          'error',
          HATHOR_TOKEN_CONFIG.uid,
          dateLastBet
        ]
      }
    )).rejects.toThrow(NanoContractTransactionError);

    // Date last bet is expected to be an integer
    await expect(hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId,
        args: [
          '123',
          HATHOR_TOKEN_CONFIG.uid,
          'error'
        ]
      }
    )).rejects.toThrow(NanoContractTransactionError);

    // Missing ncId for bet
    const address2 = await hWallet.getAddressAtIndex(2);
    const address2Obj = new Address(address2, { network });
    await expect(hWallet.createAndSendNanoContractTransaction(
      'bet',
      address2,
      {
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
    )).rejects.toThrow(NanoContractTransactionError);

    // Invalid ncId for bet
    await expect(hWallet.createAndSendNanoContractTransaction(
      'bet',
      address2,
      {
        ncId: '1234',
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
    )).rejects.toThrow(NanoContractTransactionError);

    // Invalid ncId for bet again
    await expect(hWallet.createAndSendNanoContractTransaction(
      'bet',
      address2,
      {
        ncId: fundsTx.hash,
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
    )).rejects.toThrow(NanoContractTransactionError);
  });
});
