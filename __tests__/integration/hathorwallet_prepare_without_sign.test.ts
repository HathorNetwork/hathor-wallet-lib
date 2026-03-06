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
import { TokenVersion } from '../../src/types';
import { SendTransaction } from '../../src';

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

    const txBeforeChangeCaller = sendTransaction.transaction;

    // 2. Assert tx is built but NOT signed
    // Inputs: FBT (for deposit) + HTR (for fee)
    expect(txBeforeChangeCaller.inputs.length).toBeGreaterThan(0);
    for (const input of txBeforeChangeCaller.inputs) {
      expect(input.data).toBeNull();
    }

    const nanoHeadersBeforeChangeCaller = txBeforeChangeCaller.getNanoHeaders();
    expect(nanoHeadersBeforeChangeCaller).toHaveLength(1);
    expect(nanoHeadersBeforeChangeCaller[0].script).toBeNull();
    expect(nanoHeadersBeforeChangeCaller[0].address.base58).toBe(address0);

    // Outputs: FBT change + HTR change
    expect(txBeforeChangeCaller.outputs).toHaveLength(2);
    expect(txBeforeChangeCaller.outputs).toEqual(
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
    await hWallet.setNanoHeaderCaller(nanoHeadersBeforeChangeCaller![0], address1);
    await hWallet.signTx(txBeforeChangeCaller);

    // 4. Sign the transaction (signs both inputs AND nano header with new caller)
    const txAfterSign = await hWallet.signTx(txBeforeChangeCaller);
    const nanoHeadersAfterSign = txAfterSign.getNanoHeaders();

    // 5. Assert tx IS now signed
    for (const input of txAfterSign.inputs) {
      expect(input.data).not.toBeNull();
    }
    expect(nanoHeadersAfterSign[0].script).not.toBeNull();
    // Verify the caller was changed
    expect(nanoHeadersAfterSign[0].address.base58).toBe(address1);

    // 6. Verify FeeHeader
    const feeHeader = txAfterSign.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].amount).toBe(expectedFee);

    // 7. Send and verify not voided
    const result = await sendTransaction.runFromMining();
    await checkTxValid(hWallet, result);
  });

  it('should build token creation tx without signing, edit caller, sign, and send', async () => {
    const address0 = await hWallet.getAddressAtIndex(0);
    const address1 = await hWallet.getAddressAtIndex(1);

    // Inject more funds since previous test consumed some
    await GenesisWalletHelper.injectFunds(hWallet, address0, 1000n, {});

    // 1. Build unsigned token creation transaction with address0 as caller
    const sendTransaction: SendTransaction = await hWallet.createNanoContractCreateTokenTransaction(
      'noop',
      address0,
      {
        ncId: contractId,
        args: [],
        actions: [],
      },
      {
        name: 'Test Token Unsigned',
        symbol: 'TTU',
        amount: 500n,
        mintAddress: address0,
        tokenVersion: TokenVersion.FEE,
      },
      { signTx: false }
    );
    const txBeforeChangeCaller = sendTransaction.transaction;

    // 2. Assert tx is built but NOT signed
    // Inputs should exist (for HTR deposit)
    expect(txBeforeChangeCaller?.inputs.length).toBeGreaterThan(0);
    for (const input of txBeforeChangeCaller?.inputs || []) {
      expect(input.data).toBeNull();
    }

    const nanoHeadersBeforeChangeCaller = txBeforeChangeCaller?.getNanoHeaders();
    expect(nanoHeadersBeforeChangeCaller).toHaveLength(1);
    expect(nanoHeadersBeforeChangeCaller![0].script).toBeNull();
    expect(nanoHeadersBeforeChangeCaller![0].address.base58).toBe(address0);

    // Outputs should include token mint outputs and HTR change
    expect(txBeforeChangeCaller?.outputs.length).toBeGreaterThan(0);
    expect(txBeforeChangeCaller?.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenData: 0, // HTR change
        }),
      ])
    );

    // 3. Edit caller: change address AND seqnum for the new caller
    await hWallet.setNanoHeaderCaller(nanoHeadersBeforeChangeCaller![0], address1);

    // 4. Sign the transaction (signs both inputs AND nano header with new caller)
    const tx = await hWallet.signTx(txBeforeChangeCaller!, { pinCode: DEFAULT_PIN_CODE });
    const nanoHeadersAfterSign = tx.getNanoHeaders();

    // 5. Assert tx IS now signed
    for (const input of tx.inputs) {
      expect(input.data).not.toBeNull();
    }
    expect(nanoHeadersAfterSign![0].script).not.toBeNull();
    // Verify the caller was changed
    expect(nanoHeadersAfterSign![0].address.base58).toBe(address1);

    // 6. Verify FeeHeader exists for token creation
    const feeHeader = tx.getFeeHeader();
    expect(feeHeader).not.toBeNull();

    // 7. Send and verify not voided
    const result = await sendTransaction.runFromMining();
    await checkTxValid(hWallet, result);

    // 8. Verify token was created
    const newTokenUid = result.hash;
    expect(newTokenUid).toBeDefined();
  });
});
