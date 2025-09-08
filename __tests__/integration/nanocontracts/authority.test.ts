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
    expect(txAfterExecution.meta.first_block).not.toBeNull();
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
    // No inputs
    expect(txCreateTokenData.tx.inputs.length).toBe(0);
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

    // Mint/melt in the contract affect the token info in the utxo world
    const tokenDetail3 = await wallet.getTokenDetails(txCreateToken.hash);
    expect(tokenDetail3.totalSupply).toBe(2000n);
    expect(tokenDetail3.authorities.mint).toBe(false);
    expect(tokenDetail3.authorities.melt).toBe(true);

    // We will acquire a mint authority to an output
    const acquireData = {
      ncId: txInitialize.hash,
      actions: [
        {
          type: 'acquire_authority',
          token: txCreateToken.hash,
          authority: 'mint',
          address: address1,
        },
      ],
    };

    const txAcquire = await wallet.createAndSendNanoContractTransaction(
      'acquire_authority',
      address0,
      acquireData
    );
    await checkTxValid(wallet, txAcquire);
    const txAcquireData = await wallet.getFullTxById(txAcquire.hash);

    expect(txAcquireData.tx.nc_id).toBe(txInitialize.hash);
    expect(txAcquireData.tx.nc_method).toBe('acquire_authority');
    expect(txAcquireData.tx.outputs.length).toBe(1);
    expect(txAcquireData.tx.inputs.length).toBe(0);
    // Mint authority output
    expect(txAcquireData.tx.outputs[0].value).toBe(1n);
    expect(txAcquireData.tx.outputs[0].token_data).toBe(129);
    expect(txAcquireData.tx.outputs[0].decoded.address).toBe(address1);

    const ncStateAcquire = await ncApi.getNanoContractState(
      txInitialize.hash,
      [],
      [txCreateToken.hash, NATIVE_TOKEN_UID]
    );

    expect(BigInt(ncStateAcquire.balances[NATIVE_TOKEN_UID].value)).toBe(60n);
    expect(BigInt(ncStateAcquire.balances[txCreateToken.hash].value)).toBe(1000n);
    expect(ncStateAcquire.balances[txCreateToken.hash].can_mint).toBe(true);
    expect(ncStateAcquire.balances[txCreateToken.hash].can_melt).toBe(true);

    // Now we can mint again in the utxo world
    const tokenDetail4 = await wallet.getTokenDetails(txCreateToken.hash);
    expect(tokenDetail4.totalSupply).toBe(2000n);
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
    expect(tokenDetail5.totalSupply).toBe(2000n);
    expect(tokenDetail5.authorities.mint).toBe(true);
    expect(tokenDetail5.authorities.melt).toBe(true);

    // Create a new nano contract of this blueprint with token creation and deposit
    // using a single utxo for it
    const address2 = await hWallet.getAddressAtIndex(2);
    await GenesisWalletHelper.injectFunds(hWallet, address2, 1000n);

    // Create NC with deposit of HTR and token creation
    const newInitializeData = {
      blueprintId,
      actions: [
        {
          type: 'deposit',
          token: NATIVE_TOKEN_UID,
          amount: 100n,
          address: address2,
        },
      ],
    };

    const singleUtxoCreateTokenOptions = {
      mintAddress: address0,
      name: 'Single UTXO Test Token',
      symbol: 'SUT',
      amount: 1000n,
      changeAddress: null,
      createMint: true,
      mintAuthorityAddress: null,
      createMelt: true,
      meltAuthorityAddress: null,
      data: ['test'],
      isCreateNFT: false,
      contractPaysTokenDeposit: false,
    };

    // Create token and execute nano initialize with deposit action
    // we must have a single utxo to be used by the deposit fee, data, and deposit action
    const initializeTokenCreate = await wallet.createAndSendNanoContractCreateTokenTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address2,
      newInitializeData,
      singleUtxoCreateTokenOptions
    );
    await checkTxValid(wallet, initializeTokenCreate);
    const initializeTokenCreateData = await wallet.getFullTxById(initializeTokenCreate.hash);

    expect(initializeTokenCreateData.tx.nc_method).toBe(NANO_CONTRACTS_INITIALIZE_METHOD);
    expect(initializeTokenCreateData.tx.version).toBe(CREATE_TOKEN_TX_VERSION);
    expect(initializeTokenCreateData.tx.token_name).toBe(singleUtxoCreateTokenOptions.name);
    expect(initializeTokenCreateData.tx.token_symbol).toBe(singleUtxoCreateTokenOptions.symbol);
    // A single utxo was used
    expect(initializeTokenCreateData.tx.inputs.length).toBe(1);
    expect(initializeTokenCreateData.tx.outputs.length).toBe(5);
    // First the created token output with 1000n amount
    expect(initializeTokenCreateData.tx.outputs[0].value).toBe(1000n);
    expect(initializeTokenCreateData.tx.outputs[0].token_data).toBe(1);
    // Mint authority
    expect(initializeTokenCreateData.tx.outputs[1].value).toBe(1n);
    expect(initializeTokenCreateData.tx.outputs[1].token_data).toBe(129);
    // Melt authority
    expect(initializeTokenCreateData.tx.outputs[2].value).toBe(2n);
    expect(initializeTokenCreateData.tx.outputs[2].token_data).toBe(129);
    // Then the change output and the data output
    expect(initializeTokenCreateData.tx.outputs[3].value).toBe(1n);
    expect(initializeTokenCreateData.tx.outputs[3].token_data).toBe(0);
    expect(initializeTokenCreateData.tx.outputs[4].value).toBe(889n);
    expect(initializeTokenCreateData.tx.outputs[4].token_data).toBe(0);

    // Create a token that will need two utxos
    // Use a new wallet so the utxos don't get mixed with previous change utxos
    const newWallet = await generateWalletHelper();
    const newAddress0 = await newWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(newWallet, newAddress0, 100n);
    await GenesisWalletHelper.injectFunds(newWallet, newAddress0, 100n);

    // Create NC with deposit of HTR and token creation
    const twoUtxosInitializeData = {
      blueprintId,
      actions: [
        {
          type: 'deposit',
          token: NATIVE_TOKEN_UID,
          amount: 100n,
          address: newAddress0,
        },
      ],
    };

    const twoUtxosCreateTokenOptions = {
      mintAddress: newAddress0,
      name: 'Two UTXO Test Token',
      symbol: 'TUT',
      amount: 1000n,
      changeAddress: null,
      createMint: true,
      mintAuthorityAddress: null,
      createMelt: true,
      meltAuthorityAddress: null,
      data: ['test'],
      isCreateNFT: false,
      contractPaysTokenDeposit: false,
    };

    // Create token and execute nano initialize with deposit action
    // we must have a single utxo to be used by the deposit fee, data, and deposit action
    const twoUtxosInitializeTokenCreate =
      await newWallet.createAndSendNanoContractCreateTokenTransaction(
        NANO_CONTRACTS_INITIALIZE_METHOD,
        newAddress0,
        twoUtxosInitializeData,
        twoUtxosCreateTokenOptions
      );
    await checkTxValid(newWallet, twoUtxosInitializeTokenCreate);
    const twoUtxosInitializeTokenCreateData = await newWallet.getFullTxById(
      twoUtxosInitializeTokenCreate.hash
    );

    expect(twoUtxosInitializeTokenCreateData.tx.nc_method).toBe(NANO_CONTRACTS_INITIALIZE_METHOD);
    expect(twoUtxosInitializeTokenCreateData.tx.version).toBe(CREATE_TOKEN_TX_VERSION);
    expect(twoUtxosInitializeTokenCreateData.tx.token_name).toBe(twoUtxosCreateTokenOptions.name);
    expect(twoUtxosInitializeTokenCreateData.tx.token_symbol).toBe(
      twoUtxosCreateTokenOptions.symbol
    );
    // Two utxos were used
    expect(twoUtxosInitializeTokenCreateData.tx.inputs.length).toBe(2);
    expect(twoUtxosInitializeTokenCreateData.tx.outputs.length).toBe(5);
    // First the created token output with 1000n amount
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[0].value).toBe(1000n);
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[0].token_data).toBe(1);
    // Mint authority
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[1].value).toBe(1n);
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[1].token_data).toBe(129);
    // Melt authority
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[2].value).toBe(2n);
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[2].token_data).toBe(129);
    // Then the change output and the data output
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[3].value).toBe(1n);
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[3].token_data).toBe(0);
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[4].value).toBe(89n);
    expect(twoUtxosInitializeTokenCreateData.tx.outputs[4].token_data).toBe(0);

    // Create a new token with only required params
    const newCreateTokenData = {
      ncId: txInitialize.hash,
    };

    const newCreateTokenOptions = {
      name: 'New Authority Test Token',
      symbol: 'NAT',
      amount: 100n,
      contractPaysTokenDeposit: false,
    };

    // Create token and execute nano method
    // the user will pay for the deposit, not the contract
    const newTxCreateToken = await wallet.createAndSendNanoContractCreateTokenTransaction(
      'create_token_no_deposit',
      address0,
      newCreateTokenData,
      newCreateTokenOptions
    );
    await checkTxValid(wallet, newTxCreateToken);
    const newTxCreateTokenData = await wallet.getFullTxById(newTxCreateToken.hash);

    expect(newTxCreateTokenData.tx.nc_id).toBe(txInitialize.hash);
    expect(newTxCreateTokenData.tx.nc_method).toBe('create_token_no_deposit');
    expect(newTxCreateTokenData.tx.version).toBe(CREATE_TOKEN_TX_VERSION);
    expect(newTxCreateTokenData.tx.token_name).toBe(newCreateTokenOptions.name);
    expect(newTxCreateTokenData.tx.token_symbol).toBe(newCreateTokenOptions.symbol);
    expect(newTxCreateTokenData.tx.outputs.length).toBe(4);
    // First the change output of HTR used for the deposit
    expect(newTxCreateTokenData.tx.outputs[0].token_data).toBe(0);
    // Then the created token output with 100n amount
    expect(newTxCreateTokenData.tx.outputs[1].value).toBe(100n);
    expect(newTxCreateTokenData.tx.outputs[1].token_data).toBe(1);
    // Mint authority
    expect(newTxCreateTokenData.tx.outputs[2].value).toBe(1n);
    expect(newTxCreateTokenData.tx.outputs[2].token_data).toBe(129);
    // Melt authority
    expect(newTxCreateTokenData.tx.outputs[3].value).toBe(2n);
    expect(newTxCreateTokenData.tx.outputs[3].token_data).toBe(129);
    // The input is the one used to pay for the deposit
    expect(newTxCreateTokenData.tx.inputs.length).toBe(1);
    expect(newTxCreateTokenData.tx.inputs[0].token_data).toBe(0);

    const depositAndGrantData = {
      ncId: txInitialize.hash,
      args: [newTxCreateToken.hash],
      actions: [
        {
          type: 'grant_authority',
          token: newTxCreateToken.hash,
          authority: 'mint',
        },
        {
          type: 'deposit',
          token: newTxCreateToken.hash,
          amount: 10n,
        },
      ],
    };

    const txDepositAndGrant = await wallet.createAndSendNanoContractTransaction(
      'deposit_and_grant',
      address0,
      depositAndGrantData
    );
    await checkTxValid(wallet, txDepositAndGrant);
    const txDepositAndGrantData = await wallet.getFullTxById(txDepositAndGrant.hash);

    expect(txDepositAndGrantData.tx.nc_id).toBe(txInitialize.hash);
    expect(txDepositAndGrantData.tx.nc_method).toBe('deposit_and_grant');
    expect(txDepositAndGrantData.tx.outputs.length).toBe(1);
    // The change output of the token used for the deposit
    expect(txDepositAndGrantData.tx.outputs[0].token_data).toBe(1);
    // One input for the deposit and one for the authority
    expect(txDepositAndGrantData.tx.inputs.length).toBe(2);
    expect(txDepositAndGrantData.tx.nc_context.actions.length).toBe(2);
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
    const code = fs.readFileSync(
      './__tests__/integration/configuration/blueprints/authority.py',
      'utf8'
    );
    const tx = await hWallet.createAndSendOnChainBlueprintTransaction(code, address10);
    // Wait for the tx to be confirmed, so we can use the on chain blueprint
    await waitTxConfirmed(hWallet, tx.hash);
    // We must have one transaction in the address10 now
    const newAddress10Meta = await hWallet.storage.store.getAddressMeta(address10);
    expect(newAddress10Meta.numTransactions).toBe(1);
    // Execute the authority blueprint tests
    await executeTests(hWallet, tx.hash);
  });
});
