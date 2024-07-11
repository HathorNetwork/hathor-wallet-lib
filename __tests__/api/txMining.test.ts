import MockAdapter from 'axios-mock-adapter';
import axios, { AxiosError } from 'axios';
import txMiningApi from '../../src/api/txMining';

describe('txMiningApi', () => {
  let mock;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  describe('getJobStatus', () => {
    it('should send the right request', async () => {
      const data = { status: 'done' };
      mock.onGet('job-status').reply(200, data);

      const result = await new Promise((resolve, reject) => {
        txMiningApi.getJobStatus('jobId', resolve);
      });

      expect(result).toEqual(data);

      expect(mock.history.get.length).toBe(1);
      expect(mock.history.get[0].params).toEqual({ 'job-id': 'jobId' });
    });

    it('should allow capturing errors in case of network error', async () => {
      mock.onGet('job-status').networkError();

      await expect(txMiningApi.getJobStatus('jobId', () => {})).rejects.toThrow();
    });

    it('should allow capturing errors in case the server responds with 500', async () => {
      mock.onGet('job-status').reply(500);

      let err: unknown;
      try {
        await txMiningApi.getJobStatus('jobId', () => {});
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AxiosError);
      expect((err as AxiosError).message).toEqual('Request failed with status code 500');
      expect((err as AxiosError).response?.status).toEqual(500);
    });
  });

  describe('cancelJob', () => {
    it('should send the right request', async () => {
      const data = { status: 'cancelled' };
      mock.onPost('cancel-job').reply(200, data);

      const result = await new Promise((resolve, reject) => {
        txMiningApi.cancelJob('jobId', resolve);
      });

      expect(result).toEqual(data);

      expect(mock.history.post.length).toBe(1);
      expect(mock.history.post[0].data).toEqual(JSON.stringify({ 'job-id': 'jobId' }));
    });

    it('should allow capturing errors in case of network error', async () => {
      mock.onPost('cancel-job').networkError();

      await expect(txMiningApi.cancelJob('jobId', () => {})).rejects.toThrow();
    });

    it('should allow capturing errors in case the server responds with 500', async () => {
      mock.onPost('cancel-job').reply(500);

      let err: unknown;
      try {
        await txMiningApi.cancelJob('jobId', () => {});
      } catch (e) {
        err = e;
      }
      expect((err as AxiosError).message).toEqual('Request failed with status code 500');
      expect((err as AxiosError).response?.status).toEqual(500);
    });
  });

  describe('getHealth', () => {
    it('should send the right request', async () => {
      const data = { status: 'pass' };
      mock.onGet('health').reply(200, data);

      const result = await txMiningApi.getHealth();

      expect(result).toEqual(data);
    });

    it('should allow capturing errors in case of network error', async () => {
      mock.onGet('health').networkError();

      await expect(txMiningApi.getHealth()).rejects.toThrow();
    });

    it('should allow capturing errors in case the server responds with 500', async () => {
      mock.onGet('health').reply(500);

      let err: unknown;
      try {
        await txMiningApi.getHealth();
      } catch (e) {
        err = e;
      }
      expect((err as AxiosError).message).toEqual('Request failed with status code 500');
      expect((err as AxiosError).response?.status).toEqual(500);
    });
  });

  describe('submitJob', () => {
    it('should send the right request', async () => {
      const data = { job: 'jobId' };
      mock.onPost('submit-job').reply(200, data);

      const result = await new Promise((resolve, reject) => {
        txMiningApi.submitJob('tx', true, true, 10, resolve);
      });

      expect(result).toEqual(data);

      expect(mock.history.post.length).toBe(1);
      expect(mock.history.post[0].data).toBe(
        JSON.stringify({
          tx: 'tx',
          propagate: true,
          add_parents: true,
          timeout: 10,
        })
      );
    });

    it('should allow capturing errors in case of network error', async () => {
      mock.onPost('submit-job').networkError();

      await expect(txMiningApi.submitJob('tx', true, true, 10, () => {})).rejects.toThrow();
    });

    it('should allow capturing errors in case the server responds with 500', async () => {
      mock.onPost('submit-job').reply(500);

      let err: unknown;
      try {
        await txMiningApi.submitJob('tx', true, true, 10, () => {});
      } catch (e) {
        err = e;
      }
      expect((err as AxiosError).message).toEqual('Request failed with status code 500');
      expect((err as AxiosError).response?.status).toEqual(500);
    });
  });
});
