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
import { bufferToHex } from '../../../src/utils/buffer';
import Address from '../../../src/models/address';
import P2PKH from '../../../src/models/p2pkh';
import { isEmpty } from 'lodash';
import { delay } from '../utils/core.util';

// We have to skip this test because it needs nano contract support in the full node.
// Until we have this support in the public docker image, the CI won't succeed if this is not skipped
// After skipping it, we must also add `--nc-history-index` as a new parameter for the integration tests full node
// and add the blueprints in the configuration file for the tests privnet
describe.skip('full cycle of bet nano contract', () => {
  /** @type HathorWallet */
  let hWallet;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    const tx = await GenesisWalletHelper.injectFunds(await hWallet.getAddressAtIndex(0), 1000);
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
    // Create NC
    const address1 = await hWallet.getAddressAtIndex(1);
    const dateLastOffer = dateFormatter.dateToTimestamp(new Date()) + 6000;
    const tx1 = await hWallet.createBetNanoContract(HATHOR_TOKEN_CONFIG.uid, dateLastOffer, address1, 0);
    await checkTxValid(tx1.hash);

    // Bet 100 to address 2
    const address2 = await hWallet.getAddressAtIndex(2);
    const txBet = await hWallet.makeBet(tx1.hash, address2, address2, '1x0', 100, HATHOR_TOKEN_CONFIG.uid);
    await checkTxValid(txBet.hash);

    // Bet 200 to address 3
    const address3 = await hWallet.getAddressAtIndex(3);
    const txBet2 = await hWallet.makeBet(tx1.hash, address3, address3, '2x0', 200, HATHOR_TOKEN_CONFIG.uid);
    await checkTxValid(txBet2.hash);

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
    const addressObj1 = new Address(address1, { network: hWallet.getNetworkObject() });
    const outputScriptObj1 = new P2PKH(addressObj1);
    const outputScriptBuffer1 = outputScriptObj1.createScript();

    expect(ncState.token_uid).toBe(HATHOR_TOKEN_CONFIG.uid);
    expect(ncState.date_last_offer).toBe(dateLastOffer);
    expect(ncState.oracle_script).toBe(bufferToHex(outputScriptBuffer1));
    expect(ncState.final_result).toBeNull();
    expect(ncState.total).toBe(300);
    expect(ncState[`address_details.a'${address2}'`]).toHaveProperty('1x0', 100);
    expect(ncState[`withdrawals.a'${address2}'`]).toBeNull();
    expect(ncState[`address_details.a'${address3}'`]).toHaveProperty('2x0', 200);
    expect(ncState[`withdrawals.a'${address3}'`]).toBeNull();

    // Set result to '1x0'
    const txSetResult = await hWallet.setResult(tx1.hash, address1, '1x0', ncState.oracle_script);
    await checkTxValid(txSetResult.hash);
    txIds.push(txSetResult.hash);

    // Try to withdraw to address 2, success
    const txWithdrawal = await hWallet.makeWithdrawal(tx1.hash, address2, 300, HATHOR_TOKEN_CONFIG.uid);
    await checkTxValid(txWithdrawal.hash);
    txIds.push(txWithdrawal.hash);
    
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
    expect(ncState2.token_uid).toBe(HATHOR_TOKEN_CONFIG.uid);
    expect(ncState2.date_last_offer).toBe(dateLastOffer);
    expect(ncState2.oracle_script).toBe(bufferToHex(outputScriptBuffer1));
    expect(ncState2.final_result).toBe('1x0');
    expect(ncState2.total).toBe(300);
    expect(ncState2[`address_details.a'${address2}'`]).toHaveProperty('1x0', 100);
    expect(ncState2[`withdrawals.a'${address2}'`]).toBe(300);
    expect(ncState2[`address_details.a'${address3}'`]).toHaveProperty('2x0', 200);
    expect(ncState2[`withdrawals.a'${address3}'`]).toBeNull();

    // Get history again
    const ncHistory2 = await ncApi.getNanoContractHistory(tx1.hash);
    expect(ncHistory2.history.length).toBe(5);
    for (const tx of ncHistory2.history) {
      expect(txIds).toContain(tx.hash);
    }
  });
});
