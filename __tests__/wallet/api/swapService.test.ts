
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

describe('base url configuration', () => {
  it('should throw when no url parameter was offered', () => {
      expect(() => config.getSwapServiceBaseUrl())
        .toThrowError('You should either provide a network or call setSwapServiceBaseUrl before calling this.');
  })

  it('should return mainnet address when requested', () => {
      expect(config.getSwapServiceBaseUrl('mainnet'))
        .toStrictEqual('https://atomic-swap-service.hathor.network/')
  })

  it('should return testnet address when requested', () => {
      expect(config.getSwapServiceBaseUrl('testnet'))
        .toContain('testnet')
  })

  it('should throw when an invalid network is requested', () => {
    // @ts-ignore
    expect(() => config.getSwapServiceBaseUrl('invalid'))
      .toThrowError('You should set it explicitly.');
  })

  it('should return the specified baseURL when it was set', () => {
    config.setSwapServiceBaseUrl('http://swap-base-url')
      expect(config.getSwapServiceBaseUrl())
        .toStrictEqual('http://swap-base-url')
  })
})

describe('create api', () => {

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
