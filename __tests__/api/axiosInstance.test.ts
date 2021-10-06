import { createRequestInstance } from '../../src/api/axiosInstance';
import storage from '../../src/storage';
import config from '../../src/config';

let previouslyStoredServer;
let previouslyStoredDefaultServer;

beforeAll(() => {
    previouslyStoredServer = storage.getItem('wallet:server');
    previouslyStoredDefaultServer = storage.getItem('wallet:defaultServer');

    storage.removeItem('wallet:server');
    storage.removeItem('wallet:defaultServer');
});

afterAll(() => {
  storage.setItem('wallet:server', previouslyStoredServer);
  storage.setItem('wallet:defaultServer', previouslyStoredDefaultServer);
})

test('use mainnet default server by default', () => {
  const client = createRequestInstance(() => {}, 100);

  expect(client.defaults.baseURL).toEqual("https://node1.mainnet.hathor.network/v1a/");
});

test('use mainnet default server if the storage is not initialized', () => {
  const oldStore = storage.store;
  storage.setStore(undefined);

  const client = createRequestInstance(() => {}, 100);

  expect(client.defaults.baseURL).toEqual("https://node1.mainnet.hathor.network/v1a/");

  storage.setStore(oldStore);
});

test('use wallet:defaultServer from storage if set', async () => {
  storage.setItem('wallet:defaultServer', 'https://wallet.default.server');
  const client = await createRequestInstance(() => {}, 100);

  expect(client.defaults.baseURL).toEqual("https://wallet.default.server");
});

test('use wallet:server from storage if set', async () => {
  storage.setItem('wallet:defaultServer', 'https://wallet.default.server');
  storage.setItem('wallet:server', 'https://wallet.server');

  const client = await createRequestInstance(() => {}, 100);

  expect(client.defaults.baseURL).toEqual("https://wallet.server");
});

test('use the server explicitly set with config object', async () => {
  storage.setItem('wallet:defaultServer', 'https://wallet.default.server');
  storage.setItem('wallet:server', 'https://wallet.server');
  config.setServerUrl('https://wallet.server.config');

  const client = await createRequestInstance(() => {}, 100);

  expect(client.defaults.baseURL).toEqual("https://wallet.server.config");
});