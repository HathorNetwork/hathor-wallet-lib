import fs from 'fs';
import { isEmpty } from 'lodash';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, waitForTxReceived, waitTxConfirmed } from '../helpers/wallet.helper';
import {
  CREATE_TOKEN_TX_VERSION,
  NATIVE_TOKEN_UID,
  NANO_CONTRACTS_INITIALIZE_METHOD,
} from '../../../src/constants';
import ncApi from '../../../src/api/nano';
import { bufferToHex } from '../../../src/utils/buffer';
import helpersUtils from '../../../src/utils/helpers';
import { isNanoContractCreateTx } from '../../../src/nano_contracts/utils';
import { NanoContractTransactionError } from '../../../src/errors';

describe('Authority actions blueprint test', () => {
  /** @type HathorWallet */
  let hWallet;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1000n);
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
    expect(isEmpty(txAfterExecution.meta.first_block)).not.toBeNull();
  };

  const executeTests = async (wallet, blueprintId) => {
    const address0 = await wallet.getAddressAtIndex(0);
    const address1 = await wallet.getAddressAtIndex(1);

    const utxos = await wallet.getUtxos();
    // We must have one utxo in the address 0 of 1000 HTR
    expect(utxos.utxos.length).toBe(1);
    expect(utxos.utxos[0].address).toBe(address0);
    expect(utxos.utxos[0].amount).toBe(1000n);

    // We must have one transaction in the address0
    const address0Meta = await wallet.storage.store.getAddressMeta(address0);
    expect(address0Meta.numTransactions).toBe(1);

    // Create NC with deposit of HTR
    const initializeData = {
      blueprintId,
      actions: [
        {
          type: 'deposit',
          token: NATIVE_TOKEN_UID,
          amount: 100n,
        },
      ],
    };

    const txInitialize = await wallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      initializeData
    );
    await checkTxValid(wallet, txInitialize);
    const txInitializeData = await wallet.getFullTxById(txInitialize.hash);
    expect(isNanoContractCreateTx(txInitializeData.tx)).toBe(true);

    const createTokenData = {
      ncId: txInitialize.hash,
      actions: [
        {
          type: 'withdrawal',
          token: NATIVE_TOKEN_UID,
          amount: 30n,
          address: address1,
        },
      ],
    };

    const createTokenOptions = {
      mintAddress: address0,
      name: 'Authority Test Token',
      symbol: 'ATT',
      amount: 1000n,
      changeAddress: null,
      createMint: true,
      mintAuthorityAddress: null,
      createMelt: true,
      meltAuthorityAddress: null,
      data: null,
      isCreateNFT: false,
      contractPaysTokenDeposit: true,
    };

    const createTokenMethod = 'create_token';

    // Error with invalid address
    await expect(
      wallet.createAndSendNanoContractCreateTokenTransaction(
        createTokenMethod,
        'abc',
        createTokenData,
        createTokenOptions
      )
    ).rejects.toThrow(NanoContractTransactionError);

    // Error with invalid mint authority address
    await expect(
      wallet.createAndSendNanoContractCreateTokenTransaction(
        createTokenMethod,
        address0,
        createTokenData,
        {
          ...createTokenOptions,
          mintAuthorityAddress: 'abc',
        }
      )
    ).rejects.toThrow(NanoContractTransactionError);

    // Error with invalid melt authority address
    await expect(
      wallet.createAndSendNanoContractCreateTokenTransaction(
        createTokenMethod,
        address0,
        createTokenData,
        {
          ...createTokenOptions,
          meltAuthorityAddress: 'abc',
        }
      )
    ).rejects.toThrow(NanoContractTransactionError);

    // Create token and execute nano method with withdrawal action
    // this withdrawal will be used to pay for the deposit fee (10n and 20n for an output)
    const txCreateToken = await wallet.createAndSendNanoContractCreateTokenTransaction(
      createTokenMethod,
      address0,
      createTokenData,
      createTokenOptions
    );
    await checkTxValid(wallet, txCreateToken);
    const txCreateTokenData = await wallet.getFullTxById(txCreateToken.hash);

    expect(txCreateTokenData.tx.nc_id).toBe(txInitialize.hash);
    expect(txCreateTokenData.tx.nc_method).toBe(createTokenMethod);
    expect(txCreateTokenData.tx.version).toBe(CREATE_TOKEN_TX_VERSION);
    expect(txCreateTokenData.tx.token_name).toBe(createTokenOptions.name);
    expect(txCreateTokenData.tx.token_symbol).toBe(createTokenOptions.symbol);
    expect(txCreateTokenData.tx.outputs.length).toBe(4);
    // First the created token output with 1000n amount
    expect(txCreateTokenData.tx.outputs[0].value).toBe(1000n);
    expect(txCreateTokenData.tx.outputs[0].token_data).toBe(1);
    // Mint authority
    expect(txCreateTokenData.tx.outputs[1].value).toBe(1n);
    expect(txCreateTokenData.tx.outputs[1].token_data).toBe(129);
    // Melt authority
    expect(txCreateTokenData.tx.outputs[2].value).toBe(2n);
    expect(txCreateTokenData.tx.outputs[2].token_data).toBe(129);
    // Then what's left of the withdrawal, after paying 10n
    // in deposit fee for the token creation
    expect(txCreateTokenData.tx.outputs[3].value).toBe(20n);
    expect(txCreateTokenData.tx.outputs[3].token_data).toBe(0);

    // Get NC state
    const ncState = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [txCreateToken.hash, NATIVE_TOKEN_UID]
    );

    // Deposit 100 - Withdrawal 30 of HTR
    // 0 tokens of new created token
    // Contract state
    expect(BigInt(ncState.balances[NATIVE_TOKEN_UID].value)).toBe(70n);
    expect(BigInt(ncState.balances[txCreateToken.hash].value)).toBe(0n);
    expect(ncState.balances[txCreateToken.hash].can_mint).toBe(false);
    expect(ncState.balances[txCreateToken.hash].can_melt).toBe(false);

    const tokenDetail = await wallet.getTokenDetails(txCreateToken.hash);

    // Token state
    expect(tokenDetail.totalSupply).toBe(1000n);
    expect(tokenDetail.authorities.mint).toBe(true);
    expect(tokenDetail.authorities.melt).toBe(true);

    // We will grant a mint authority to the contract
    const grantData1 = {
      ncId: txInitialize.hash,
      actions: [
        {
          type: 'grant_authority',
          token: txCreateToken.hash,
          authority: 'mint',
        },
      ],
    };

    const txGrant1 = await wallet.createAndSendNanoContractTransaction(
      'grant_authority',
      address0,
      grantData1
    );
    await checkTxValid(wallet, txGrant1);
    const txGrant1Data = await wallet.getFullTxById(txGrant1.hash);

    expect(txGrant1Data.tx.nc_id).toBe(txInitialize.hash);
    expect(txGrant1Data.tx.nc_method).toBe('grant_authority');
    expect(txGrant1Data.tx.outputs.length).toBe(0);
    expect(txGrant1Data.tx.inputs.length).toBe(1);
    // Mint authority input
    expect(txGrant1Data.tx.inputs[0].value).toBe(1n);
    expect(txGrant1Data.tx.inputs[0].token_data).toBe(129);

    const ncStateGrant1 = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [txCreateToken.hash, NATIVE_TOKEN_UID]
    );

    expect(BigInt(ncStateGrant1.balances[txCreateToken.hash].value)).toBe(0n);
    expect(ncStateGrant1.balances[txCreateToken.hash].can_mint).toBe(true);
    expect(ncStateGrant1.balances[txCreateToken.hash].can_melt).toBe(false);

    // We will grant a melt authority to the contract and keep one to the wallet
    const grantData2 = {
      ncId: txInitialize.hash,
      actions: [
        {
          type: 'grant_authority',
          token: txCreateToken.hash,
          authority: 'melt',
          authorityAddress: address1,
        },
      ],
    };

    const txGrant2 = await wallet.createAndSendNanoContractTransaction(
      'grant_authority',
      address0,
      grantData2
    );
    await checkTxValid(wallet, txGrant2);
    const txGrant2Data = await wallet.getFullTxById(txGrant2.hash);

    expect(txGrant2Data.tx.nc_id).toBe(txInitialize.hash);
    expect(txGrant2Data.tx.nc_method).toBe('grant_authority');
    expect(txGrant2Data.tx.outputs.length).toBe(1);
    expect(txGrant2Data.tx.inputs.length).toBe(1);
    // Melt authority input
    expect(txGrant2Data.tx.inputs[0].value).toBe(2n);
    expect(txGrant2Data.tx.inputs[0].token_data).toBe(129);
    // Melt authority output
    expect(txGrant2Data.tx.outputs[0].value).toBe(2n);
    expect(txGrant2Data.tx.outputs[0].token_data).toBe(129);
    expect(txGrant2Data.tx.outputs[0].decoded.address).toBe(address1);

    const ncStateGrant2 = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [txCreateToken.hash, NATIVE_TOKEN_UID]
    );

    expect(BigInt(ncStateGrant2.balances[txCreateToken.hash].value)).toBe(0n);
    expect(ncStateGrant2.balances[txCreateToken.hash].can_mint).toBe(true);
    expect(ncStateGrant2.balances[txCreateToken.hash].can_melt).toBe(true);

    // The utxo world can't mint anymore, the authority is only in the contract
    const tokenDetail2 = await wallet.getTokenDetails(txCreateToken.hash);
    expect(tokenDetail2.totalSupply).toBe(1000n);
    expect(tokenDetail2.authorities.mint).toBe(false);
    expect(tokenDetail2.authorities.melt).toBe(true);

    // Mint 2000 tokens in the contract
    const txMint = await wallet.createAndSendNanoContractTransaction('mint', address0, {
      ncId: txInitialize.hash,
      args: [txCreateToken.hash, 2000],
    });
    await checkTxValid(wallet, txMint);
    const txMintData = await wallet.getFullTxById(txMint.hash);
    expect(txMintData.tx.nc_id).toBe(txInitialize.hash);
    expect(txMintData.tx.nc_method).toBe('mint');
    expect(txMintData.tx.outputs.length).toBe(0);
    expect(txMintData.tx.inputs.length).toBe(0);

    const ncStateMint = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [txCreateToken.hash, NATIVE_TOKEN_UID]
    );

    expect(BigInt(ncStateMint.balances[NATIVE_TOKEN_UID].value)).toBe(50n);
    expect(BigInt(ncStateMint.balances[txCreateToken.hash].value)).toBe(2000n);
    expect(ncStateMint.balances[txCreateToken.hash].can_mint).toBe(true);
    expect(ncStateMint.balances[txCreateToken.hash].can_melt).toBe(true);

    // Melt 1000 tokens in the contract
    const txMelt = await wallet.createAndSendNanoContractTransaction('melt', address0, {
      ncId: txInitialize.hash,
      args: [txCreateToken.hash, 1000],
    });
    await checkTxValid(wallet, txMelt);
    const txMeltData = await wallet.getFullTxById(txMelt.hash);
    expect(txMeltData.tx.nc_id).toBe(txInitialize.hash);
    expect(txMeltData.tx.nc_method).toBe('melt');
    expect(txMeltData.tx.outputs.length).toBe(0);
    expect(txMeltData.tx.inputs.length).toBe(0);

    const ncStateMelt = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [txCreateToken.hash, NATIVE_TOKEN_UID]
    );

    expect(BigInt(ncStateMelt.balances[NATIVE_TOKEN_UID].value)).toBe(60n);
    expect(BigInt(ncStateMelt.balances[txCreateToken.hash].value)).toBe(1000n);
    expect(ncStateMelt.balances[txCreateToken.hash].can_mint).toBe(true);
    expect(ncStateMelt.balances[txCreateToken.hash].can_melt).toBe(true);

    // Mint/melt in the contract world doesn't affect this API from utxo world
    const tokenDetail3 = await wallet.getTokenDetails(txCreateToken.hash);
    expect(tokenDetail3.totalSupply).toBe(1000n);
    expect(tokenDetail3.authorities.mint).toBe(false);
    expect(tokenDetail3.authorities.melt).toBe(true);

    // We will invoke a mint authority to an output
    const invokeData = {
      ncId: txInitialize.hash,
      actions: [
        {
          type: 'invoke_authority',
          token: txCreateToken.hash,
          authority: 'mint',
          address: address1,
        },
      ],
    };

    const txInvoke = await wallet.createAndSendNanoContractTransaction(
      'invoke_authority',
      address0,
      invokeData
    );
    await checkTxValid(wallet, txInvoke);
    const txInvokeData = await wallet.getFullTxById(txInvoke.hash);

    expect(txInvokeData.tx.nc_id).toBe(txInitialize.hash);
    expect(txInvokeData.tx.nc_method).toBe('invoke_authority');
    expect(txInvokeData.tx.outputs.length).toBe(1);
    expect(txInvokeData.tx.inputs.length).toBe(0);
    // Mint authority output
    expect(txInvokeData.tx.outputs[0].value).toBe(1n);
    expect(txInvokeData.tx.outputs[0].token_data).toBe(129);
    expect(txInvokeData.tx.outputs[0].decoded.address).toBe(address1);

    const ncStateInvoke = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [txCreateToken.hash, NATIVE_TOKEN_UID]
    );

    expect(BigInt(ncStateInvoke.balances[NATIVE_TOKEN_UID].value)).toBe(60n);
    expect(BigInt(ncStateInvoke.balances[txCreateToken.hash].value)).toBe(1000n);
    expect(ncStateInvoke.balances[txCreateToken.hash].can_mint).toBe(true);
    expect(ncStateInvoke.balances[txCreateToken.hash].can_melt).toBe(true);

    // Now we can mint again in the utxo world
    const tokenDetail4 = await wallet.getTokenDetails(txCreateToken.hash);
    expect(tokenDetail4.totalSupply).toBe(1000n);
    expect(tokenDetail4.authorities.mint).toBe(true);
    expect(tokenDetail4.authorities.melt).toBe(true);

    // Revoke authorities of mint and melt from the contract
    const txRevoke = await wallet.createAndSendNanoContractTransaction('revoke', address0, {
      ncId: txInitialize.hash,
      args: [txCreateToken.hash, true, true],
    });
    await checkTxValid(wallet, txRevoke);
    const txRevokeData = await wallet.getFullTxById(txRevoke.hash);
    expect(txRevokeData.tx.nc_id).toBe(txInitialize.hash);
    expect(txRevokeData.tx.nc_method).toBe('revoke');
    expect(txRevokeData.tx.outputs.length).toBe(0);
    expect(txRevokeData.tx.inputs.length).toBe(0);

    // Now we can't mint/melt anymore in the contract
    const ncStateRevoke = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [txCreateToken.hash, NATIVE_TOKEN_UID]
    );

    expect(BigInt(ncStateRevoke.balances[NATIVE_TOKEN_UID].value)).toBe(60n);
    expect(BigInt(ncStateRevoke.balances[txCreateToken.hash].value)).toBe(1000n);
    expect(ncStateRevoke.balances[txCreateToken.hash].can_mint).toBe(false);
    expect(ncStateRevoke.balances[txCreateToken.hash].can_melt).toBe(false);

    // The token detail in the utxo world did not change
    const tokenDetail5 = await wallet.getTokenDetails(txCreateToken.hash);
    expect(tokenDetail5.totalSupply).toBe(1000n);
    expect(tokenDetail5.authorities.mint).toBe(true);
    expect(tokenDetail5.authorities.melt).toBe(true);
  };

  it('Run with on chain blueprint', async () => {
    // We use the address0 to inject funds because they are needed for the nano tests execution
    const address0 = await hWallet.getAddressAtIndex(0);
    // We use the address10 as caller of the ocb tx
    // so we don't mess with the number of transactions for address0 tests
    const address10 = await hWallet.getAddressAtIndex(10);

    // We already added funds to this address
    const address0Meta = await hWallet.storage.store.getAddressMeta(address0);
    expect(address0Meta?.numTransactions).toBe(1);

    // Use the blueprint code
    const code = fs.readFileSync('./__tests__/integration/configuration/authority.py', 'utf8');
    const tx = await hWallet.createAndSendOnChainBlueprintTransaction(code, address10);
    // Wait for the tx to be confirmed, so we can use the on chain blueprint
    await waitTxConfirmed(hWallet, tx.hash);
    // We must have one transaction in the address10 now
    const newAddress10Meta = await hWallet.storage.store.getAddressMeta(address10);
    expect(newAddress10Meta.numTransactions).toBe(1);
    // Execute the bet blueprint tests
    await executeTests(hWallet, tx.hash);
  });
});
