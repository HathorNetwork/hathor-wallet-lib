import { createRequestInstance } from '../../src/api/axiosInstance';
import config from '../../src/config';

beforeAll(() => {
  config.SERVER_URL = undefined;
});

test('use mainnet default server by default', () => {
  const client = createRequestInstance(() => {}, 100);

  expect(client.defaults.baseURL).toEqual('https://node1.mainnet.hathor.network/v1a/');
});

test('use the server explicitly set with config object', async () => {
  config.setServerUrl('https://wallet.server.config');

  const client = await createRequestInstance(() => {}, 100);

  expect(client.defaults.baseURL).toEqual('https://wallet.server.config');
});
