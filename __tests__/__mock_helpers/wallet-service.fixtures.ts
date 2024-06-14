import Network from '../../src/models/network';
import HathorWalletServiceWallet from '../../src/wallet/wallet';

export const defaultWalletSeed =
  'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
export const buildSuccessTxByIdTokenDataResponse = (): string => {
  const txTokens = [
    {
      balance: 10,
      height: 1,
      timestamp: 10,
      tokenId: 'token1',
      tokenName: 'Token 1',
      tokenSymbol: 'T1',
      txId: 'txId1',
      version: 3,
      voided: false,
      weight: 65.4321,
    },
    {
      balance: 7,
      height: 1,
      timestamp: 10,
      tokenId: 'token2',
      tokenName: 'Token 2',
      tokenSymbol: 'T2',
      txId: 'txId1',
      version: 3,
      voided: false,
      weight: 65.4321,
    },
  ];
  return JSON.stringify({
    success: true,
    txTokens,
  });
};
// eslint-disable-next-line -- 'arrow-parens' rule conflicts with typescript syntax here
export const buildWalletToAuthenticateApiCall = (overwrite?) => {
  const requestPassword = jest.fn();
  const network = new Network('testnet');
  const seed = defaultWalletSeed;
  // instantiate wallet ready to be used
  return new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
    ...overwrite,
  });
};
