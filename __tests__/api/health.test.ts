import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import healthApi from '../../src/api/health';

describe('healthApi', () => {
  let mock;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  it('getHealth should return health data', async () => {
    const data = { status: 'pass' };
    mock.onGet('health').reply(200, data);

    const result = await healthApi.getHealth();

    expect(result).toEqual(data);
  });

  it('getHealth should allow capturing errors in case of network error', async () => {
    mock.onGet('health').networkError();

    await expect(healthApi.getHealth()).rejects.toThrow();
  });
});
