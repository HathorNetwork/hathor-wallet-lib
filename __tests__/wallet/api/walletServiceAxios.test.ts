import { axiosInstance } from '../../../src/wallet/api/walletServiceAxios';
import Network from '../../../src/models/network';
import HathorWalletServiceWallet from '../../../src/wallet/wallet';
import config from '../../../src/config';

const words = 'connect sunny silent cabin leopard start turtle tortoise dial timber woman genre pave tuna rice indicate gown draft palm collect retreat meadow assume spray';

test('use testnet tx mining when network is testnet', async () => {
  config.setWalletServiceBaseUrl('https://wallet-service.testnet.hathor.network/');

  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const wallet = new HathorWalletServiceWallet(requestPassword, words, network);

  const client = await axiosInstance(wallet, false);

  expect(client.defaults.baseURL).toEqual('https://wallet-service.testnet.hathor.network/');
});

test('use mainnet tx mining when network is mainnet', async () => {
  config.setWalletServiceBaseUrl('https://wallet-service.hathor.network/');

  const requestPassword = jest.fn();
  const network = new Network('mainnet');
  const wallet = new HathorWalletServiceWallet(requestPassword, words, network);

  const client = await axiosInstance(wallet, false);

  expect(client.defaults.baseURL).toEqual('https://wallet-service.hathor.network/');
});

test('use explicitly configured tx mining', async () => {
  config.setWalletServiceBaseUrl('wallet.service.url');

  const requestPassword = jest.fn();
  const network = new Network('mainnet');
  const wallet = new HathorWalletServiceWallet(requestPassword, words, network);

  const client = await axiosInstance(wallet, false);

  expect(client.defaults.baseURL).toEqual('wallet.service.url');
});
