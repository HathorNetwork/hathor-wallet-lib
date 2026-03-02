import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay } from './utils/core.util';
import {
  generateWalletHelper,
} from './helpers/wallet.helper';
import {
  FULLNODE_NETWORK_NAME,
  FULLNODE_URL,
  NETWORK_NAME,
} from './configuration/test-constants';
import { ConnectionState } from '../../src/wallet/types';

// This section tests methods that have side effects impacting the whole wallet. Executing it last.
describe('internal methods', () => {
  /** @type HathorWallet */
  let gWallet;
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    const { hWallet: ghWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = ghWallet;
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
    // XXX: gWallet.stop() kills the genesis singleton without nulling the reference in GenesisWalletHelper
    await gWallet.stop();
  });

  it('should test the debug methods', async () => {
    expect(gWallet.debug).toStrictEqual(false);

    gWallet.enableDebugMode();
    expect(gWallet.debug).toStrictEqual(true);

    gWallet.disableDebugMode();
    expect(gWallet.debug).toStrictEqual(false);
  });

  it('should test network-related methods', async () => {
    // GetServerUrl fetching from the live fullnode connection
    expect(await gWallet.getServerUrl()).toStrictEqual(FULLNODE_URL);
    expect(await gWallet.getNetwork()).toStrictEqual(NETWORK_NAME);
    expect(await gWallet.getNetworkObject()).toMatchObject({
      name: NETWORK_NAME,
      versionBytes: { p2pkh: 73, p2sh: 135 }, // Calculated for the privnet.py config file
      bitcoreNetwork: {
        name: expect.stringContaining(NETWORK_NAME),
        alias: 'test', // this is the alias for the testnet network
        pubkeyhash: 73,
        scripthash: 135,
      },
    });

    // GetVersionData fetching from the live fullnode server
    expect(await gWallet.getVersionData()).toMatchObject({
      timestamp: expect.any(Number),
      version: expect.any(String),
      network: FULLNODE_NETWORK_NAME,
      minWeight: expect.any(Number),
      minTxWeight: expect.any(Number),
      minTxWeightCoefficient: expect.any(Number),
      minTxWeightK: expect.any(Number),
      tokenDepositPercentage: 0.01,
      rewardSpendMinBlocks: expect.any(Number),
      maxNumberInputs: 255,
      maxNumberOutputs: 255,
    });
  });

  it('should change servers', async () => {
    // Changing from our integration test privatenet to the testnet
    // XXX: changeServer not wrapped in try/finally — if restoration fails, genesis wallet stays on testnet
    gWallet.changeServer('https://node1.testnet.hathor.network/v1a/');
    const serverChangeTime = Date.now().valueOf();
    await delay(100);

    // Validating the server change with getVersionData
    let networkData = await gWallet.getVersionData();
    expect(networkData.timestamp).toBeGreaterThan(serverChangeTime);
    expect(networkData.network).toMatch(/^testnet.*/);

    await gWallet.changeServer(FULLNODE_URL);
    await delay(100);

    // Reverting to the privatenet
    networkData = await gWallet.getVersionData();
    expect(networkData.timestamp).toBeGreaterThan(serverChangeTime + 200);
    expect(networkData.network).toStrictEqual(FULLNODE_NETWORK_NAME);
  });

  it('should reload the storage', async () => {
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const spy = jest.spyOn(hWallet.storage, 'processHistory');
    // XXX: jest.spyOn not restored after assertion — spy persists for remainder of describe block
    // Simulate that we received an event of the connection becoming active
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
