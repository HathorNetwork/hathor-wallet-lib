import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import { NATIVE_TOKEN_UID, TOKEN_MINT_MASK } from '../../src/constants';
import { SendTxError, UtxoError } from '../../src/errors';
import Network from '../../src/models/network';
import transaction from '../../src/utils/transaction';
import { TokenDetailsObject } from '../../src/wallet/types';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { mockGetToken } from '../__mock_helpers__/get-token.mock';

type P2PkH_Script = { address: { base58: string } };

describe('prepareMintTokensData method', () => {
  const addressPath = "m/280'/280'/0/1/0";
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ];

  const mockUtxo = (tokenId: string, authorities = 0n, amount = 1n) => ({
    txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5d',
    index: 0,
    tokenId,
    address: addresses[0],
    value: amount,
    authorities,
    timelock: null,
    heightlock: null,
    locked: false,
    addressPath,
  });

  const getUtxosMock = async (params: { tokenId: string }) => {
    if (params.tokenId === '00') {
      return { utxos: [mockUtxo('00')], changeAmount: 0n };
    }
    return { utxos: [mockUtxo('01', TOKEN_MINT_MASK)], changeAmount: 0n };
  };

  const getInputDataMock = () => Buffer.alloc(0);

  const network = new Network('testnet');
  const requestPassword = jest.fn();
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  const wallet = new HathorWalletServiceWallet({
    requestPassword,
    seed,
    network,
    passphrase: '',
    xpriv: null,
    xpub: null,
  });
  wallet.setState('Ready');
  const code = new Mnemonic(seed);
  const xpriv = code.toHDPrivateKey('', network.getNetwork());

  beforeEach(() => {
    jest.spyOn(wallet, 'getUtxos').mockImplementation(getUtxosMock as never);
    jest.spyOn(wallet.storage, 'getMainXPrivKey').mockReturnValue(Promise.resolve(xpriv.xprivkey));
    jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);
    jest.spyOn(wallet.storage, 'getToken').mockImplementation(mockGetToken);
    jest
      .spyOn(wallet, 'checkAddressesMine')
      .mockReturnValue(Promise.resolve({ [addresses[2]]: true }));
    jest.spyOn(wallet, 'getTokenDetails').mockImplementation(async token => {
      const { uid, ...mockData } = await mockGetToken(token);
      return {
        tokenInfo: { id: uid, ...mockData },
      } as TokenDetailsObject;
    });
  });

  it('should throw when mintAuthorityAddress is invalid', async () => {
    await expect(
      wallet.prepareMintTokensData('01', 100n, {
        address: addresses[1],
        createAnotherMint: true,
        mintAuthorityAddress: 'abc',
        pinCode: '123456',
      })
    ).rejects.toThrow(SendTxError);
  });

  it('should throw when allowExternalMintAuthorityAddress is true but address is invalid', async () => {
    await expect(
      wallet.prepareMintTokensData('01', 100n, {
        address: addresses[1],
        createAnotherMint: true,
        mintAuthorityAddress: 'abc',
        allowExternalMintAuthorityAddress: true,
        pinCode: '123456',
      })
    ).rejects.toThrow(SendTxError);
  });

  it('should sucessfully create mint data without signing the transaction', async () => {
    const result = await wallet.prepareMintTokensData('01', 100n, {
      address: addresses[1],
      mintAuthorityAddress: addresses[2],
      pinCode: '123456',
      signTx: false,
    });
    expect(result.inputs).toEqual([
      expect.objectContaining({ data: null }),
      expect.objectContaining({ data: null }),
    ]);
  });

  it('should sucessfully create mint data with mint authority output', async () => {
    const result = await wallet.prepareMintTokensData('01', 100n, {
      address: addresses[1],
      createAnotherMint: true,
      mintAuthorityAddress: addresses[2],
      pinCode: '123456',
    });

    expect(result.inputs).toEqual([
      expect.objectContaining({ data: expect.any(Object) }),
      expect.objectContaining({ data: expect.any(Object) }),
    ]);
    expect(result.outputs).toHaveLength(2);

    const authorityOutputs = result.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(1);
    const authorityOutput = authorityOutputs[0];
    expect(authorityOutput.value).toEqual(TOKEN_MINT_MASK);

    const p2pkh = authorityOutput.parseScript(network) as P2PkH_Script;
    expect(p2pkh.address.base58).toBe(addresses[2]);
  });

  it('should throw when trying to mint fee token without enough htr', async () => {
    const _spyGetUtxos = jest.spyOn(wallet, 'getUtxos').mockImplementation(async () => ({
      utxos: [],
      changeAmount: 0n,
    }));

    await expect(
      wallet.prepareMintTokensData('fbt', 100n, {
        address: addresses[1],
        createAnotherMint: true,
        mintAuthorityAddress: addresses[2],
        pinCode: '123456',
      })
    ).rejects.toThrow(UtxoError);

    _spyGetUtxos.mockRestore();
  });

  it('should successfully create fee token mint data with change, mint, and melt authority outputs', async () => {
    jest.spyOn(wallet, 'getUtxos').mockImplementation(async params => {
      if (params?.tokenId === NATIVE_TOKEN_UID) {
        return {
          utxos: [mockUtxo(NATIVE_TOKEN_UID, 0n, 10n)],
          changeAmount: 9n,
        };
      }
      return {
        utxos: [mockUtxo('02', params?.authority)],
        changeAmount: 0n,
      };
    });

    const result = await wallet.prepareMintTokensData('02', 1000n, {
      address: addresses[1],
      createAnotherMint: true,
      mintAuthorityAddress: addresses[2],
      changeAddress: addresses[2],
      pinCode: '123456',
      signTx: false,
    });

    expect(result.inputs).toEqual([
      expect.objectContaining({ data: expect.any(Object) }),
      expect.objectContaining({ data: expect.any(Object) }),
    ]);

    expect(result.outputs).toHaveLength(3);
    const authorityOutputs = result.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(1);
    expect(authorityOutputs[0].value).toEqual(TOKEN_MINT_MASK);

    const p2pkhMint = authorityOutputs[0].parseScript(network) as P2PkH_Script;
    expect(p2pkhMint.address.base58).toBe(addresses[2]);
  });
});
