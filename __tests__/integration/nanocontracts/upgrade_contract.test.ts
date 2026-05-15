import { isEmpty } from 'lodash';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, waitForTxReceived, waitTxConfirmed } from '../helpers/wallet.helper';
import { NANO_CONTRACTS_INITIALIZE_METHOD } from '../../../src/constants';
import ncApi from '../../../src/api/nano';
import { bufferToHex } from '../../../src/utils/buffer';
import helpersUtils from '../../../src/utils/helpers';
import { getBlueprintId } from '../../../src/nano_contracts/utils';

/**
 * End-to-end test for the wallet-lib's blueprint-id resolution on upgraded
 * nano contracts.
 *
 * Setup:
 * - UpgradeTestV1 declares `set_value(addr: Address)` and `upgrade_to(BlueprintId)`.
 * - UpgradeTestV2 declares `set_value(addr: CallerId)` (storage-compatible).
 *
 * Flow:
 * 1. Create a contract from V1; call `set_value` with a base58 Address (matches V1).
 * 2. Call `upgrade_to(V2)`; assert the state endpoint now reports V2 as the
 *    blueprint id, while the creation tx still carries V1 in `nc_blueprint_id`.
 * 3. Call `set_value` again with a 64-char hex (a ContractId-form CallerId).
 *    This succeeds only when the wallet-lib resolves the *current* blueprint
 *    via the state endpoint. Without that fix, it parses against V1's `Address`
 *    schema and rejects the value with a Zod regex error.
 */
describe('Upgradable nano contract', () => {
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
    const network = wallet.getNetworkObject();
    const txBytes = tx.toBytes();
    const deserializedTx = helpersUtils.createTxFromBytes(txBytes, network);
    expect(bufferToHex(txBytes)).toBe(bufferToHex(deserializedTx.toBytes()));

    expect(txId).toBeDefined();
    await waitForTxReceived(wallet, txId);
    await waitTxConfirmed(wallet, txId);
    const txAfterExecution = await wallet.getFullTxById(txId);
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(txAfterExecution.meta.first_block).not.toBeNull();
  };

  it('resolves the post-upgrade blueprint id when validating method args', async () => {
    const v1 = global.UPGRADE_TEST_V1_BLUEPRINT_ID;
    const v2 = global.UPGRADE_TEST_V2_BLUEPRINT_ID;
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v1).not.toBe(v2);

    // 1. Initialize a contract from V1.
    const txInit = await hWallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      { blueprintId: v1, args: [] }
    );
    await checkTxValid(hWallet, txInit);
    const ncId = txInit.hash;

    // V1's `set_value` accepts an Address — a wallet-owned base58 string works.
    const txSetV1 = await hWallet.createAndSendNanoContractTransaction(
      'set_value',
      address0,
      { ncId, args: [address0] }
    );
    await checkTxValid(hWallet, txSetV1);

    // Sanity: state reports V1 as the current blueprint and creation tx
    // carries V1 in nc_blueprint_id.
    const stateBefore = await ncApi.getNanoContractState(ncId, [], [], []);
    expect(stateBefore.blueprint_id).toBe(v1);
    const initTxData = await hWallet.getFullTxById(ncId);
    expect(initTxData.tx.nc_blueprint_id).toBe(v1);

    // 2. Upgrade in-place to V2.
    const txUpgrade = await hWallet.createAndSendNanoContractTransaction(
      'upgrade_to',
      address0,
      { ncId, args: [v2] }
    );
    await checkTxValid(hWallet, txUpgrade);

    // State now reports V2; the creation tx still carries V1 — this is the
    // discrepancy that motivates the wallet-lib fix.
    const stateAfter = await ncApi.getNanoContractState(ncId, [], [], []);
    expect(stateAfter.blueprint_id).toBe(v2);
    const stillInitTxData = await hWallet.getFullTxById(ncId);
    expect(stillInitTxData.tx.nc_blueprint_id).toBe(v1);

    // 3. `getBlueprintId` must return V2 (the current blueprint), not V1.
    const resolved = await getBlueprintId(ncId, hWallet);
    expect(resolved).toBe(v2);

    // 4. With V2 active, `set_value` accepts a CallerId. A 64-char hex value
    // is parsed by the wallet-lib as a ContractId-tagged CallerId. This
    // request only succeeds when the wallet-lib uses V2's signature for
    // arg validation — a regression of the fix would throw a Zod regex
    // error here.
    const callerIdHex = '0000421da6413f181b86c3fcf731976ad6f7ec0983598000a6658f35a212e3e1';
    const txSetV2 = await hWallet.createAndSendNanoContractTransaction(
      'set_value',
      address0,
      { ncId, args: [callerIdHex] }
    );
    await checkTxValid(hWallet, txSetV2);
  });
});
