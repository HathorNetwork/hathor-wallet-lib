
import { decryptString, encryptString, hashPassword, create } from '../../../src/wallet/api/swapService'
import config from '../../../src/config';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';

const mockAxiosAdapter = new MockAdapter(axios);

describe('hashing and encrypting', () => {
  it('should correctly hash a password', () => {
    const password = '123';
    const hashedPassword = hashPassword(password);

    expect(hashedPassword).toHaveLength(64);
  })

  it('should correctly encrypt and decrypt a string', () => {
    const originalString = 'PartialTx|123123||';
    const password = 'strongPassword';

    const encryptedString = encryptString(originalString, password);
    expect(encryptedString.length !== originalString.length).toBe(true);

    const decryptedString = decryptString(encryptedString, password);
    expect(decryptedString).toStrictEqual(originalString);
  })
})

describe('create api', () => {

  it('should throw an error if the backend base URL was not configured', async () => {
    await expect(create('PartialTx||', 'abc'))
      .rejects.toThrowError('Swap service base URL not set.');
  })

  it('should handle backend errors', async () => {
    config.setSwapServiceBaseUrl('http://mock-swap-url/')

    mockAxiosAdapter.onPost('/').reply(503)
    await expect(create('PartialTx||', 'abc'))
      .rejects.toThrowError('Request failed with status code 503');
  })

  it('should return the backend results on a successful post', async () => {
    config.setSwapServiceBaseUrl('http://mock-swap-url/')

    const responseData = {
      success: true,
      id: 'proposal-id-123'
    };
    mockAxiosAdapter.onPost('/').reply(200, responseData)
    await expect(create('PartialTx||', 'abc'))
      .resolves.toStrictEqual(responseData)
  })
})
