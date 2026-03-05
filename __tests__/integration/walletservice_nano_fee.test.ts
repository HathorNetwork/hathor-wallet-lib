import { GenesisWalletServiceHelper } from './helpers/genesis-wallet.helper';
import {
  buildWalletInstance,
  checkTxNotVoided,
  initializeServiceGlobalConfigs,
  pollForNcState,
  pollForTokenDetails,
  pollForTx,
} from './helpers/service-facade.helper';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { NATIVE_TOKEN_UID, NANO_CONTRACTS_INITIALIZE_METHOD } from '../../src/constants';
import { TokenVersion } from '../../src/types';

const pinCode = '123456';
const password = 'testpass';

initializeServiceGlobalConfigs();

describe('WalletService Nano Contract Fee Tests', () => {
  let wsWallet: HathorWalletServiceWallet;
  let walletAddresses: string[];
  let contractId: string;
  let fbtUid: string;

  beforeAll(async () => {
    // 1. Start genesis wallet helper
    await GenesisWalletServiceHelper.start();
    const gWallet = GenesisWalletServiceHelper.getSingleton();

    // 2. Build and start wsWallet (uses precalculated wallet)
    const buildResult = buildWalletInstance({});
    wsWallet = buildResult.wallet;
    walletAddresses = buildResult.addresses;
    await wsWallet.start({ pinCode, password });

    // 3. Fund wallet with HTR
    const address0 = walletAddresses[0];
    const fundTx = await gWallet.sendTransaction(address0, 1000n, { pinCode });
    await pollForTx(wsWallet, fundTx.hash!);

    // 4. Initialize FeeBlueprint contract
    const initTx = await wsWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId: global.FEE_BLUEPRINT_ID,
        args: [],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100n,
            changeAddress: address0,
          },
        ],
      },
      { pinCode }
    );
    await pollForTx(wsWallet, initTx.hash!);
    contractId = initTx.hash!;

    // 5. Create FBT token
    const createFbtTx = await wsWallet.createAndSendNanoContractTransaction(
      'create_fee_token',
      address0,
      {
        ncId: contractId,
        args: ['Fee Test Token', 'FBT', 1000],
        actions: [
          {
            type: 'deposit',
            token: NATIVE_TOKEN_UID,
            amount: 100n,
            changeAddress: address0,
          },
        ],
      },
      { pinCode }
    );
    await pollForTx(wsWallet, createFbtTx.hash!);

    // 6. Get fbtUid from contract state (with retry for fullnode indexing)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ncState = (await pollForNcState(contractId, ['fbt_uid'], 'fbt_uid')) as any;
    fbtUid = ncState.fields.fbt_uid.value;

    // 7. Wait for wallet-service to sync the token details
    // The token was just created, and getTokenDetails needs it to be indexed
    await pollForTokenDetails(wsWallet, fbtUid);
  });

  afterAll(async () => {
    if (wsWallet) {
      await wsWallet.stop({ cleanStorage: true });
    }
    await GenesisWalletServiceHelper.stop();
  });

  it('should build tx without signing, edit caller, sign, and send', async () => {
    const address0 = walletAddresses[0];
    const address1 = walletAddresses[1];

    // 1. Withdraw some FBT from contract (to have tokens to deposit)
    const withdrawTx = await wsWallet.createAndSendNanoContractTransaction(
      'noop',
      address0,
      {
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
      },
      { pinCode }
    );
    await pollForTx(wsWallet, withdrawTx.hash!);
    await checkTxNotVoided(wsWallet, withdrawTx.hash!);

    const fbtDepositAmount = 5n;
    const expectedFee = 2n;

    // 2. Build unsigned transaction with address0 as caller
    const sendTransaction = await wsWallet.createNanoContractTransaction(
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

    const txBeforeChangeCaller = sendTransaction.transaction!;
    expect(txBeforeChangeCaller).not.toBeNull();

    // 3. Assert tx is built but NOT signed
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
        expect.objectContaining({ tokenData: 1 }), // FBT
        expect.objectContaining({ tokenData: 0 }), // HTR
      ])
    );

    // 4. Edit caller: change address AND seqnum for the new caller
    await wsWallet.setNanoHeaderCaller(nanoHeadersBeforeChangeCaller[0], address1);

    // 5. Sign the transaction (signs both inputs AND nano header with new caller)
    const txAfterSign = await wsWallet.signTx(txBeforeChangeCaller, { pinCode });
    const nanoHeadersAfterSign = txAfterSign.getNanoHeaders();

    // 6. Assert tx IS now signed
    for (const input of txAfterSign.inputs) {
      expect(input.data).not.toBeNull();
    }
    expect(nanoHeadersAfterSign[0].script).not.toBeNull();
    // Verify the caller was changed
    expect(nanoHeadersAfterSign[0].address.base58).toBe(address1);

    // 7. Verify FeeHeader
    const feeHeader = txAfterSign.getFeeHeader();
    expect(feeHeader).not.toBeNull();
    expect(feeHeader!.entries[0].amount).toBe(expectedFee);

    // 8. Send and verify confirmed and not voided
    const result = await sendTransaction.runFromMining();
    await pollForTx(wsWallet, result.hash!);
    await checkTxNotVoided(wsWallet, result.hash!);
  });

  it('should build token creation tx without signing, edit caller, sign, and send', async () => {
    const address0 = walletAddresses[0];
    const address1 = walletAddresses[1];

    // 1. Build unsigned token creation transaction with address0 as caller
    const sendTransaction = await wsWallet.createNanoContractCreateTokenTransaction(
      'noop',
      address0,
      {
        ncId: contractId,
        args: [],
        actions: [],
      },
      {
        name: 'Test Token Unsigned WS',
        symbol: 'TTUWS',
        amount: 500n,
        mintAddress: address0,
        tokenVersion: TokenVersion.FEE,
        contractPaysTokenDeposit: false,
        changeAddress: address0,
        createMint: true,
        mintAuthorityAddress: address0,
        createMelt: true,
        meltAuthorityAddress: address0,
      },
      { signTx: false }
    );

    const txBeforeChangeCaller = sendTransaction.transaction!;
    expect(txBeforeChangeCaller).not.toBeNull();

    // 2. Assert tx is built but NOT signed
    // Inputs should exist (for HTR deposit)
    expect(txBeforeChangeCaller.inputs.length).toBeGreaterThan(0);
    for (const input of txBeforeChangeCaller.inputs) {
      expect(input.data).toBeNull();
    }

    const nanoHeadersBeforeChangeCaller = txBeforeChangeCaller.getNanoHeaders();
    expect(nanoHeadersBeforeChangeCaller).toHaveLength(1);
    expect(nanoHeadersBeforeChangeCaller[0].script).toBeNull();
    expect(nanoHeadersBeforeChangeCaller[0].address.base58).toBe(address0);

    // Outputs should include token mint outputs and HTR change
    expect(txBeforeChangeCaller.outputs.length).toBeGreaterThan(0);
    expect(txBeforeChangeCaller.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenData: 0, // HTR change
        }),
      ])
    );

    // 3. Edit caller: change address AND seqnum for the new caller
    await wsWallet.setNanoHeaderCaller(nanoHeadersBeforeChangeCaller[0], address1);

    // 4. Sign the transaction (signs both inputs AND nano header with new caller)
    const txAfterSign = await wsWallet.signTx(txBeforeChangeCaller, { pinCode });
    const nanoHeadersAfterSign = txAfterSign.getNanoHeaders();

    // 5. Assert tx IS now signed
    for (const input of txAfterSign.inputs) {
      expect(input.data).not.toBeNull();
    }
    expect(nanoHeadersAfterSign[0].script).not.toBeNull();
    // Verify the caller was changed
    expect(nanoHeadersAfterSign[0].address.base58).toBe(address1);

    // 6. Verify FeeHeader exists for token creation
    const feeHeader = txAfterSign.getFeeHeader();
    expect(feeHeader).not.toBeNull();

    // 7. Send and verify confirmed and not voided
    const result = await sendTransaction.runFromMining();
    await pollForTx(wsWallet, result.hash!);
    await checkTxNotVoided(wsWallet, result.hash!);

    // 8. Verify token was created
    const newTokenUid = result.hash;
    expect(newTokenUid).toBeDefined();
  });
});
