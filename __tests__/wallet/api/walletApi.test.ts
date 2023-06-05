import * as walletServiceAxios from '../../../src/wallet/api/walletServiceAxios';
import walletApi from '../../../src/wallet/api/walletApi';
import Network from '../../../src/models/network';
import HathorWalletServiceWallet from '../../../src/wallet/wallet';
import config from '../../../src/config';

const seed = 'connect sunny silent cabin leopard start turtle tortoise dial timber woman genre pave tuna rice indicate gown draft palm collect retreat meadow assume spray';

jest.mock('../../../src/wallet/api/walletServiceAxios', () => ({
  __esModule: true,
  axiosInstance: jest.fn(), 
}));

test('getAddresses', async () => {
  config.setWalletServiceBaseUrl('https://wallet-service.hathor.network/');

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
  });

  // Should fail if status code is different from 200
  walletServiceAxios.axiosInstance.mockResolvedValueOnce({
    get: jest.fn().mockImplementation(() => Promise.resolve({
      status: 503,
      data: {
        success: true, // If status is != 200, it should fail regardless of the body
      },
    })),
  });

  await expect(walletApi.getAddresses(wallet, 0))
    .rejects
    .toThrowError('Error getting wallet addresses.');

  // Should fail if response data success attribute is false
  walletServiceAxios.axiosInstance.mockResolvedValueOnce({
    get: jest.fn().mockImplementation(() => Promise.resolve({
      status: 200, // Should fail even if status code is 200
      data: {
        success: false,
      },
    })),
  });

  await expect(walletApi.getAddresses(wallet, 0))
    .rejects
    .toThrowError('Error getting wallet addresses.');

  // Should return with data on success
  const data = {
    success: true,
    addresses: [{
      address: 'address1',
      index: 0,
      transactions: 1,
    }],
  };
  walletServiceAxios.axiosInstance.mockResolvedValueOnce({
    get: jest.fn().mockImplementation(() => Promise.resolve({
      status: 200, // Should fail even if status code is 200
      data,
    })),
  });

  await expect(walletApi.getAddresses(wallet, 0))
    .resolves
    .toStrictEqual(data);
});
