import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import txMiningApi from '../../src/api/txMining';

describe('txMiningApi', () => {
  let mock;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  it('getJobStatus should send the right request', async () => {
    const data = { status: 'done' };
    mock.onGet('job-status').reply(200, data);

    const result = await new Promise((resolve, reject) => {
      txMiningApi.getJobStatus('jobId', resolve);
    });

    expect(result).toEqual(data);

    expect(mock.history.get.length).toBe(1);
    expect(mock.history.get[0].params).toEqual({ "job-id": 'jobId' });
  });

  it('cancelJob should send the right request', async () => {
    const data = { status: 'cancelled' };
    mock.onPost('cancel-job').reply(200, data);

    const result = await new Promise((resolve, reject) => {
      txMiningApi.cancelJob('jobId', resolve);
    });

    expect(result).toEqual(data);

    expect(mock.history.post.length).toBe(1);
    expect(mock.history.post[0].data).toEqual(JSON.stringify({ "job-id": 'jobId' }));
  });

  it('getHealth should send the right request', async () => {
    const data = { status: 'pass' };
    mock.onGet('health').reply(200, data);

    const result = await txMiningApi.getHealth();

    expect(result).toEqual(data);
  });

  it('getHealth should allow capturing errors in case of network error', async () => {
    mock.onGet('health').networkError();

    await expect(txMiningApi.getHealth()).rejects.toThrow();
  });

  it('submitJob should send the right request', async () => {
    const data = { job: 'jobId' };
    mock.onPost('submit-job').reply(200, data);

    const result = await new Promise((resolve, reject) => {
      txMiningApi.submitJob('tx', true, true, 10, resolve);
    });

    expect(result).toEqual(data);

    expect(mock.history.post.length).toBe(1);
    expect(mock.history.post[0].data).toBe(JSON.stringify({
        'tx': 'tx',
        'propagate': true,
        'add_parents': true,
        'timeout': 10
    }));
  });
});