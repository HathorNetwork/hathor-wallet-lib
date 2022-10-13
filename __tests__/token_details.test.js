import HathorWallet from '../src/new/wallet';
import walletApi from '../src/api/wallet';

class FakeHathorWallet {
  getTokenDetails(...args) {
    return HathorWallet.prototype.getTokenDetails.call(this, ...args);
  }
}

describe('Get token details', () => {
  const hathorWallet = new FakeHathorWallet();
  const walletApiSpy = jest.spyOn(walletApi, 'getGeneralTokenInfo');

  afterEach(() => {
    walletApiSpy.mockReset();
  })

  afterAll(() => {
    walletApiSpy.mockRestore();
  })

  test('Message thrown by token details should be the same received from the API', async () => {
    expect.assertions(1);

    walletApiSpy.mockImplementationOnce(() => {
        throw new Error('Mocked API error');
      });

    await expect(hathorWallet.getTokenDetails('tokenUid'))
      .rejects
      .toThrow('Mocked API error');
  });

  test('Should throw when the api results are unsuccessful', async () => {
    expect.assertions(1);

    walletApiSpy.mockImplementationOnce((tokenId, resolve) => {
        resolve({
          success: false,
          message: 'Mocked non-success message',
          name: 'Mocked Name',
          symbol: 'MCKN1',
          mint: [0],
          melt: [],
          total: 2,
          transactions_count: 4,
        })
      });

    await expect(hathorWallet.getTokenDetails('tokenUid'))
      .rejects
      .toThrow('Mocked non-success message');
  });

  test('Should return the same values received from the API on success', async () => {
    expect.assertions(1);

    walletApiSpy.mockImplementationOnce((tokenId, resolve) => {
        resolve({
          success: true,
          name: 'Mocked Name',
          symbol: 'MCKN1',
          mint: [0],
          melt: [],
          total: 2,
          transactions_count: 4,
        })
      });

    await expect(hathorWallet.getTokenDetails('tokenUid'))
      .resolves
      .toStrictEqual({
        totalSupply: 2,
        totalTransactions: 4,
        tokenInfo: {
          name: 'Mocked Name',
          symbol: 'MCKN1',
        },
        authorities: {
          mint: true,
          melt: false,
        },
      })
  });

});
