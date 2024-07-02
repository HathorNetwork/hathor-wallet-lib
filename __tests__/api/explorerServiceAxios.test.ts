import { axiosInstance } from '../../src/api/explorerServiceAxios';
import config from '../../src/config';

test('use testnet tx mining when network is testnet', async () => {
  const client = await axiosInstance('testnet');

  expect(client.defaults.baseURL).toEqual('https://explorer-service.testnet.hathor.network/');
});

test('use mainnet tx mining when network is mainnet', async () => {
  const client = await axiosInstance('mainnet');

  expect(client.defaults.baseURL).toEqual('https://explorer-service.hathor.network/');
});

test('use explicitly configured tx mining', async () => {
  config.setExplorerServiceBaseUrl('explorer.service.url');
  const client = await axiosInstance('testnet');

  expect(client.defaults.baseURL).toEqual('explorer.service.url');
});
