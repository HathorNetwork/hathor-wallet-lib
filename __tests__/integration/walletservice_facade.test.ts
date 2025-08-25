import axios, { InternalAxiosRequestConfig } from 'axios';
import Network from '../../src/models/network';
import { MemoryStore, Storage } from '../../src';
import walletUtils from '../../src/utils/wallet';
import { WALLET_CONSTANTS } from './configuration/test-constants';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import config from '../../src/config';
import { loggers } from './utils/logger.util';

// Set base URL for the wallet service API inside the privatenet test container
config.setWalletServiceBaseUrl('http://localhost:3000/dev/');
config.setWalletServiceBaseWsUrl('ws://localhost:3001/dev/');

describe('version', () => {
  it('should retrieve the version data', async () => {
    const response = await axios
      .get('version', {
        baseURL: config.getWalletServiceBaseUrl(),
        headers: {
          'Content-Type': 'application/json',
        },
      })
      .catch(e => {
        loggers.test.log(`Received an error on /version: ${e}`);
        if (e.response) {
          return e.response;
        }
        throw e;
      });
    expect(response.status).toBe(200);
    expect(response.data?.success).toBe(true);
  });
});

const defaultPinPass = '1234';
describe('start', () => {
  it.skip('should start the wallet service facade without errors', async () => {
    const requestPassword = jest.fn();
    const network = new Network('privatenet');
    const seed = WALLET_CONSTANTS.genesis.words;
    const store = new MemoryStore();
    const storage = new Storage(store);
    const accessData = walletUtils.generateAccessDataFromSeed(seed, {
      networkName: 'privatenet',
      password: defaultPinPass,
      pin: defaultPinPass,
    });

    // Create an instance of the WalletServiceFacade
    const wallet = new HathorWalletServiceWallet({
      requestPassword,
      seed,
      network,
      storage,
    });

    // Call the start method and assert no errors are thrown
    await expect(wallet.start()).rejects.toThrow('Pin code');

    // Call the start method with pin and password and assert no errors are thrown
    await wallet.start({ pinCode: defaultPinPass, password: defaultPinPass });
    await expect(wallet.storage.getAccessData()).resolves.toMatchObject({
      xpubkey: accessData.xpubkey,
    });
  });
});
