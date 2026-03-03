import { isEmpty } from 'lodash';
import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import {
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitTxConfirmed,
} from './helpers/wallet.helper';

import ncApi from '../../src/api/nano';
import HathorWallet from '../../src/new/wallet';
import { NATIVE_TOKEN_UID, NANO_CONTRACTS_INITIALIZE_METHOD } from '../../src/constants';
import Address from '../../src/models/address';
import transactionUtils from '../../src/utils/transaction';

describe('HathorWallet prepare transaction without signing', () => {
  let hWallet: HathorWallet;
  let contractId: string;
  let fbtUid: string;

  beforeAll(async () => {
    hWallet = await generateWalletHelper(null);
    const address = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address, 10000n, {});

    // Initialize a FeeBlueprint contract
    const initTx = await hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address,
      {
        blueprintId: global.FEE_BLUEPRINT_ID,
        args: [],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 1000n,
            changeAddress: address,
          },
        ],
      }
    );
    await checkTxValid(hWallet, initTx);
    contractId = initTx.hash!;

    // Create a fee token (FBT)
    const createFbtTx = await hWallet.createAndSendNanoContractTransaction(
      'create_fee_token',
      address,
      {
        ncId: contractId,
        args: ['Fee Test Token', 'FBT', 1000],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100n,
            changeAddress: address,
          },
        ],
      }
    );
    await checkTxValid(hWallet, createFbtTx);

    const ncState = await ncApi.getNanoContractState(
      contractId,
      ['fbt_uid'],
      [NATIVE_TOKEN_UID],
      []
    );
    fbtUid = ncState.fields.fbt_uid.value;
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

  it('should build tx without signing, edit caller, sign, and send', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const address1 = await hWallet.getAddressAtIndex(1);

    // First, withdraw some FBT from the contract to have tokens to deposit
    const withdrawTx = await hWallet.createAndSendNanoContractTransaction('noop', address0, {
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
    });
    await checkTxValid(hWallet, withdrawTx);

    const fbtDepositAmount = 5n;
    const expectedFee = 2n;

    // 1. Build unsigned transaction with address0 as caller
    const sendTransaction = await hWallet.createNanoContractTransaction(
      'noop',
      address0,
      {
        ncId: contractId,
        args: [],
        actions: [
          {
            type: 'deposit',
            token: fbtUid,
            amount: fbtDepositAmount,
            changeAddress: address0,
          },
        ],
      },
      { signTx: false }
    );

    const tx = sendTransaction.transaction;

    // 2. Assert tx is built but NOT signed
    // Inputs: FBT (for deposit) + HTR (for fee)
    expect(tx.inputs.length).toBeGreaterThan(0);
    for (const input of tx.inputs) {
      expect(input.data).toBeNull();
    }

    const nanoHeaders = tx.getNanoHeaders();
    expect(nanoHeaders).toHaveLength(1);
    expect(nanoHeaders[0].script).toBeNull();
    expect(nanoHeaders[0].address.base58).toBe(address0);

    // Outputs: FBT change + HTR change
    expect(tx.outputs).toHaveLength(2);
    expect(tx.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenData: 1,
        }),
        expect.objectContaining({
          tokenData: 0,
        }),
      ])
    );

    // 3. Edit caller: change address AND seqnum for the new caller
    const newCallerSeqnum = await hWallet.getNanoHeaderSeqnum(address1);
    nanoHeaders[0].address = new Address(address1, { network: hWallet.getNetworkObject() });
    nanoHeaders[0].seqnum = newCallerSeqnum;

    // 4. Sign the transaction (signs both inputs AND nano header with new caller)
    await transactionUtils.signTransaction(tx, hWallet.storage, DEFAULT_PIN_CODE);

    // 4.1. Prepare to send (sets timestamp and calculates weight - must be done after signing)
    tx.prepareToSend();

    // 5. Assert tx IS now signed
    for (const input of tx.inputs) {
      expect(input.data).not.toBeNull();
    }
    expect(nanoHeaders[0].script).not.toBeNull();
    // Verify the caller was changed
    expect(nanoHeaders[0].address.base58).toBe(address1);

    // 6. Verify FeeHeader
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].amount).toBe(expectedFee);

    // 7. Send and verify not voided
    const result = await sendTransaction.runFromMining();
    await checkTxValid(hWallet, result);
  });
});
