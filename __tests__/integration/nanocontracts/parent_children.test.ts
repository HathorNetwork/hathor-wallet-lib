import fs from 'fs';
import { isEmpty } from 'lodash';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, waitForTxReceived, waitTxConfirmed } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID, NANO_CONTRACTS_INITIALIZE_METHOD } from '../../../src/constants';
import ncApi from '../../../src/api/nano';
import { bufferToHex } from '../../../src/utils/buffer';
import helpersUtils from '../../../src/utils/helpers';
import { isNanoContractCreateTx } from '../../../src/nano_contracts/utils';

describe('Parent - children tests', () => {
  /** @type HathorWallet */
  let hWallet;
  let address0;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    address0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address0, 1000n);
  });

  afterAll(async () => {
    await hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  });

  const checkTxValid = async (wallet, tx) => {
    const txId = tx.hash;
    // Check that serialization and deserialization match
    const network = wallet.getNetworkObject();
    const txBytes = tx.toBytes();
    const deserializedTx = helpersUtils.createTxFromBytes(txBytes, network);
    const deserializedTxBytes = deserializedTx.toBytes();
    expect(bufferToHex(txBytes)).toBe(bufferToHex(deserializedTxBytes));

    expect(txId).toBeDefined();
    await waitForTxReceived(wallet, txId);
    // We need to wait for the tx to get a first block, so we guarantee it was executed
    await waitTxConfirmed(wallet, txId);
    // Now we query the transaction from the full node to double check it's still valid after the nano execution
    // and it already has a first block, so it was really executed
    const txAfterExecution = await wallet.getFullTxById(txId);
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(txAfterExecution.meta.first_block).not.toBeNull();
  };

  const executeTests = async (wallet, blueprintParentId, blueprintChildrenId) => {
    // NC initialize
    const txInitialize = await wallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId: blueprintParentId,
        args: [],
      }
    );
    await checkTxValid(wallet, txInitialize);
    const txInitializeData = await wallet.getFullTxById(txInitialize.hash);
    expect(isNanoContractCreateTx(txInitializeData.tx)).toBe(true);

    // NC deposit
    const txDeposit = await wallet.createAndSendNanoContractTransaction('deposit', address0, {
      ncId: txInitialize.hash,
      args: [],
      actions: [
        {
          type: 'deposit',
          token: NATIVE_TOKEN_UID,
          amount: 500n,
        },
      ],
    });
    await checkTxValid(wallet, txDeposit);

    // Get NC balance
    const ncStateDeposit = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [NATIVE_TOKEN_UID],
      []
    );

    expect(ncStateDeposit.balances[NATIVE_TOKEN_UID].value).toBe('500');

    // NC create token
    const txCreateToken = await wallet.createAndSendNanoContractTransaction(
      'create_token',
      address0,
      {
        ncId: txInitialize.hash,
        args: ['Test token', 'TKN', 200n, true, true],
        actions: [],
      }
    );
    await checkTxValid(wallet, txCreateToken);

    // Get NC create token
    const ncStateCreateToken = await ncApi.getNanoContractState(
      txInitialize.hash,
      ['last_created_token'],
      [],
      []
    );

    const createTokenUid = ncStateCreateToken.fields.last_created_token.value;

    const ncStateCreateTokenBalance = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [NATIVE_TOKEN_UID, createTokenUid],
      []
    );

    expect(ncStateCreateTokenBalance.balances[NATIVE_TOKEN_UID].value).toBe('498');
    expect(ncStateCreateTokenBalance.balances[createTokenUid].value).toBe('200');

    // NC create contract
    const txCreateContract = await wallet.createAndSendNanoContractTransaction(
      'create_child_contract',
      address0,
      {
        ncId: txInitialize.hash,
        args: [blueprintChildrenId, 'cafecafe', 'Test contract'],
        actions: [],
      }
    );
    await checkTxValid(wallet, txCreateContract);

    // Get NC create contract
    const ncStateCreateContract = await ncApi.getNanoContractState(
      txInitialize.hash,
      ['last_created_contract'],
      [],
      []
    );

    const createContractId = ncStateCreateContract.fields.last_created_contract.value;

    // Get NC child state
    const ncStateChildInitial = await ncApi.getNanoContractState(
      createContractId,
      ['name', 'attr'],
      [],
      []
    );

    expect(ncStateChildInitial.fields.name.value).toBe('Test contract');

    // NC child contract
    const txChild = await wallet.createAndSendNanoContractTransaction('set_attr', address0, {
      ncId: createContractId,
      args: ['Attr child'],
      actions: [],
    });
    await checkTxValid(wallet, txChild);

    // Get NC child state
    const ncStateChild = await ncApi.getNanoContractState(
      createContractId,
      ['name', 'attr'],
      [],
      []
    );

    expect(ncStateChild.fields.name.value).toBe('Test contract');
    expect(ncStateChild.fields.attr.value).toBe('Attr child');
  };

  it('Run with on chain blueprint', async () => {
    await executeTests(hWallet, global.PARENT_BLUEPRINT_ID, global.CHILDREN_BLUEPRINT_ID);
  });
});
