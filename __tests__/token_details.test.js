import HathorWallet from '../src/new/wallet';

class FakeHathorWallet {
  getTokenDetails(...args) {
    return HathorWallet.prototype.getTokenDetails.call(this, ...args);
  }
}

jest.mock('../src/api/wallet', () => {
  const walletApi = require.requireActual('../src/api/wallet').default;

  return {
    ...walletApi,
    getGeneralTokenInfo: () => {
      throw new Error('Unknown token');
    },
  };
});

describe('Get token details teta', () => {
  const hathorWallet = new FakeHathorWallet();

  test('Message thrown by token details should be the same received from the API', () => {
    try {
      hathorWallet.getTokenDetails('00a19c16466ffa0c2a93b76255d5f85a9df33cdb22c59ac2246c2d6a1497096f');
    } catch (error) {
      expect(error.message).toBe('Unknown token');
    }
  });
});
