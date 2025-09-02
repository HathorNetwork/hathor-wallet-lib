import axios from 'axios';
import config from '../../src/config';
import { loggers } from './utils/logger.util';

// Set base URL for the wallet service API inside the privatenet test container
config.setWalletServiceBaseUrl('http://localhost:3000/dev/');
config.setWalletServiceBaseWsUrl('ws://localhost:3001/dev/');

describe('version', () => {
  it('should retrieve the version data', async () => {
    const response = await axios
      .get('version', {
        baseURL: config.getWalletServiceBaseUrl(),
        headers: {
          'Content-Type': 'application/json',
        },
      })
      .catch(e => {
        loggers.test.log(`Received an error on /version: ${e}`);
        if (e.response) {
          return e.response;
        }
        throw e;
      });
    expect(response.status).toBe(200);
    expect(response.data?.success).toBe(true);
  });
});
