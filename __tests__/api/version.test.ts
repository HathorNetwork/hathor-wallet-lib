import MockAdapter from 'axios-mock-adapter';
import axios, { AxiosError } from 'axios';
import versionApi from '../../src/api/version';

describe('versionApi', () => {
  let mock;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  describe('getVersion', () => {
    it('should return version data', async () => {
      const data = { version: '1.0.0' };
      mock.onGet('/version').reply(200, data);

      const result = await new Promise((resolve, reject) => {
        versionApi.getVersion(resolve);
      });

      expect(result).toEqual(data);
    });

    it('should allow capturing errors in case of network error', async () => {
      mock.onGet('/version').networkError();

      await expect(versionApi.getVersion(() => {})).rejects.toThrow();
    });

    it('should allow capturing errors in case the server responds with 500', async () => {
      mock.onGet('/version').reply(500);

      let err: unknown;
      try {
        await versionApi.getVersion(() => {});
      } catch (e) {
        err = e;
      }
      expect((err as AxiosError).message).toEqual('Request failed with status code 500');
      expect((err as AxiosError).response?.status).toEqual(500);
    });
  });

  describe('asyncGetVersion', () => {
    it('should return version data', async () => {
      const data = { version: '1.0.0' };
      mock.onGet('/version').reply(200, data);

      const result = await versionApi.asyncGetVersion();

      expect(result).toEqual(data);
    });

    it('should allow capturing errors in case of network error', async () => {
      mock.onGet('/version').networkError();

      await expect(versionApi.asyncGetVersion()).rejects.toThrow();
    });

    it('should allow capturing errors in case the server responds with 500', async () => {
      mock.onGet('/version').reply(500);

      let err: unknown;
      try {
        await versionApi.asyncGetVersion();
      } catch (e) {
        err = e;
      }
      expect((err as AxiosError).message).toEqual('Request failed with status code 500');
      expect((err as AxiosError).response?.status).toEqual(500);
    });
  });
});
