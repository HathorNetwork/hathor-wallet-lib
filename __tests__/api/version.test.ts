import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import versionApi from '../../src/api/version';

describe('versionApi', () => {
  let mock;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  it('getVersion should return version data', async () => {
    const data = { version: '1.0.0' };
    mock.onGet('/version').reply(200, data);

    const result = await new Promise((resolve, reject) => {
      versionApi.getVersion(resolve);
    });

    expect(result).toEqual(data);
  });

  it('asyncGetVersion should return version data', async () => {
    const data = { version: '1.0.0' };
    mock.onGet('/version').reply(200, data);

    const result = await versionApi.asyncGetVersion();

    expect(result).toEqual(data);
  });

  it('asyncGetVersion should allow capturing errors in case of network error', async () => {
    mock.onGet('/version').networkError();

    await expect(versionApi.asyncGetVersion()).rejects.toThrow();
  });
});