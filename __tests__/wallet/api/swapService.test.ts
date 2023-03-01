
import { decryptString, encryptString, hashPassword, create, get } from '../../../src/wallet/api/swapService'
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
        .toStrictEqual('https://atomic-swap-service.testnet.hathor.network/')
  })

  it('should throw when an invalid network is requested', () => {
    // @ts-ignore
    expect(() => config.getSwapServiceBaseUrl('invalid'))
      .toThrowError(`Network invalid doesn't have a correspondent Atomic Swap Service url. You should set it explicitly by calling setSwapServiceBaseUrl.`);
  })

  it('should return the specified baseURL when it was set', () => {
    config.setSwapServiceBaseUrl('http://swap-base-url')
      expect(config.getSwapServiceBaseUrl())
        .toStrictEqual('http://swap-base-url')
  })
})

describe('create api', () => {

  it('should throw missing parameter errors', async () => {
    // @ts-ignore
    await expect(create()).rejects.toThrowError('Missing serializedPartialTx');
    // @ts-ignore
    await expect(create('PartialTx|0001000000000000000000000063f78c0e0000000000||')).rejects.toThrowError('Missing password');
  })

  it('should handle backend errors', async () => {
    config.setSwapServiceBaseUrl('http://mock-swap-url/')

    mockAxiosAdapter.onPost('/').reply(503)
    await expect(create('PartialTx|0001000000000000000000000063f78c0e0000000000||', 'abc'))
      .rejects.toThrowError('Request failed with status code 503');
  })

  it('should return the backend results on a successful post', async () => {
    config.setSwapServiceBaseUrl('http://mock-swap-url/')

    const responseData = {
      success: true,
      id: 'proposal-id-123'
    };
    mockAxiosAdapter.onPost('/').reply(200, responseData)
    await expect(create('PartialTx|0001000000000000000000000063f78c0e0000000000||', 'abc'))
      .resolves.toStrictEqual(responseData)
  })
})

describe('get api', () => {

  it('should throw missing parameter errors', async () => {
    // @ts-ignore
    await expect(get()).rejects.toThrowError('Missing proposalId');
    // @ts-ignore
    await expect(get('b4a5b077-c599-41e8-a791-85e08efcb1da'))
      .rejects.toThrowError('Missing password');
  })

  it('should handle backend errors', async () => {
    config.setSwapServiceBaseUrl('http://mock-swap-url/')

    mockAxiosAdapter.onGet('/b4a5b077-c599-41e8-a791-85e08efcb1da').reply(503)
    await expect(get('b4a5b077-c599-41e8-a791-85e08efcb1da', 'abc'))
      .rejects.toThrowError('Request failed with status code 503');
  })

  it('should throw if the password cannot decode the proposal', async () => {
    const originalPartialTx = 'PartialTx|0001000000000000000000000063f78c0e0000000000||';
    const password = 'abc';
    const incorrectPassword = 'bcd';

    config.setSwapServiceBaseUrl('http://mock-swap-url/')
    const rawHttpBody = {
      id: 'b4a5b077-c599-41e8-a791-85e08efcb1da',
      partialTx: encryptString(originalPartialTx, password),
      signatures: null,
      timestamp: 'Wed Mar 01 2023 18:56:00 GMT-0300 (Brasilia Standard Time)',
      version: 0,
      history: []
    }

    const responseData = {
      proposalId: 'b4a5b077-c599-41e8-a791-85e08efcb1da',
      partialTx: originalPartialTx,
      signatures: null,
      timestamp: 'Wed Mar 01 2023 18:56:00 GMT-0300 (Brasilia Standard Time)',
      version: 0,
      history: []
    };
    mockAxiosAdapter.onGet('/b4a5b077-c599-41e8-a791-85e08efcb1da').reply(200, rawHttpBody)
    await expect(get('b4a5b077-c599-41e8-a791-85e08efcb1da', incorrectPassword))
      .rejects.toThrowError('Incorrect password: could not decode the proposal');
  })

  it('should return the backend results on a successful request', async () => {
    const originalPartialTx = 'PartialTx|0001000000000000000000000063f78c0e0000000000||';
    const password = 'abc';

    config.setSwapServiceBaseUrl('http://mock-swap-url/')
    const rawHttpBody = {
      id: 'b4a5b077-c599-41e8-a791-85e08efcb1da',
      partialTx: encryptString(originalPartialTx, password),
      signatures: null,
      timestamp: 'Wed Mar 01 2023 18:56:00 GMT-0300 (Brasilia Standard Time)',
      version: 0,
      history: []
    }

    const responseData = {
      proposalId: 'b4a5b077-c599-41e8-a791-85e08efcb1da',
      partialTx: originalPartialTx,
      signatures: null,
      timestamp: 'Wed Mar 01 2023 18:56:00 GMT-0300 (Brasilia Standard Time)',
      version: 0,
      history: []
    };
    mockAxiosAdapter.onGet('/b4a5b077-c599-41e8-a791-85e08efcb1da').reply(200, rawHttpBody)
    const resolvedData = await get('b4a5b077-c599-41e8-a791-85e08efcb1da', password);
    expect(resolvedData).toStrictEqual(responseData)
  })

  it('should correctly parse the history', async () => {
    const originalPartialTx = 'PartialTx|0001000000000000000000000063f78c0e0000000000||';
    const password = 'abc';
    const encryptedPartialTx = encryptString(originalPartialTx, password);

    config.setSwapServiceBaseUrl('http://mock-swap-url/')
    const rawHttpBody = {
      id: 'b4a5b077-c599-41e8-a791-85e08efcb1da',
      partialTx: encryptedPartialTx,
      signatures: null,
      timestamp: 'Wed Mar 01 2023 18:56:00 GMT-0300 (Brasilia Standard Time)',
      version: 0,
      history: [{
        partialTx: encryptedPartialTx,
        timestamp: 'Wed Fev 01 2023 18:56:00 GMT-0300 (Brasilia Standard Time)'
      }]
    }

    const responseData = {
      proposalId: 'b4a5b077-c599-41e8-a791-85e08efcb1da',
      partialTx: originalPartialTx,
      signatures: null,
      timestamp: 'Wed Mar 01 2023 18:56:00 GMT-0300 (Brasilia Standard Time)',
      version: 0,
      history: [{
        partialTx: originalPartialTx,
        timestamp: 'Wed Fev 01 2023 18:56:00 GMT-0300 (Brasilia Standard Time)'
      }]
    };
    mockAxiosAdapter.onGet('/b4a5b077-c599-41e8-a791-85e08efcb1da').reply(200, rawHttpBody)
    const resolvedData = await get('b4a5b077-c599-41e8-a791-85e08efcb1da', password);
    expect(resolvedData).toStrictEqual(responseData)
  })
})
