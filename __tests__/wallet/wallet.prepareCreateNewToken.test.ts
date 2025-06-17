import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import Network from '../../src/models/network';
import { mockAxiosAdapter } from '../__mock_helpers__/axios-adapter.mock';
import { SendTxError } from '../../src/errors';
import { TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import transaction from '../../src/utils/transaction';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { AddressInfoObject } from '../../src/wallet/types';
import { TokenInfoVersion } from '../../src/models/enum/token_info_version';
import { Fee } from '../../src/models/fee';
import Output from '../../src/models/output';

type P2PkH_Script = { address: { base58: string } };

describe('prepareCreateNewToken method', () => {
  const addressPath = "m/280'/280'/0/1/0";
  const addresses = [
    'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
    'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
    'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
  ];
  mockAxiosAdapter.onPost('wallet/addresses/check_mine').reply(200, {
    success: true,
    addresses: {
      WR1i8USJWQuaU423fwuFQbezfevmT4vFWX: true,
    },
  });

  const mockUtxo = (amount = 1n) => ({
    txId: '002abde4018935e1bbde9600ef79c637adf42385fb1816ec284d702b7bb9ef5d',
    index: 0,
    tokenId: '00',
    address: addresses[0],
    value: amount,
    authorities: 0n,
    timelock: null,
    heightlock: null,
    locked: false,
    addressPath,
  });

  const getUtxosMock = async () => ({
    utxos: [mockUtxo()],
    changeAmount: 0n,
  });

  const network = new Network('testnet');
  const requestPassword = jest.fn();
  const seed =
    'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';

  const getInputDataMock = (xp: string, dtsh: Buffer) => Buffer.alloc(0);
  const getCurrentAddressDataMock = ({ markAsUsed = false } = {}): AddressInfoObject =>
    ({
      address: addresses[0],
    }) as AddressInfoObject;

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
    jest.spyOn(wallet, 'getUtxos').mockImplementation(getUtxosMock);
    jest.spyOn(wallet.storage, 'getMainXPrivKey').mockReturnValue(Promise.resolve(xpriv.xprivkey));
    jest.spyOn(wallet, 'getInputData').mockImplementation(getInputDataMock);
    jest.spyOn(wallet, 'getCurrentAddress').mockImplementation(getCurrentAddressDataMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should throw when invalid mint authority address is provided', async () => {
    await expect(
      wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
        address: addresses[1],
        createMintAuthority: true,
        mintAuthorityAddress: 'abc',
        pinCode: '123456',
      })
    ).rejects.toThrow(SendTxError);
  });

  it('should throw when invalid melt authority address is provided', async () => {
    await expect(
      wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
        address: addresses[1],
        createMeltAuthority: true,
        meltAuthorityAddress: 'abc',
        pinCode: '123456',
      })
    ).rejects.toThrow(SendTxError);
  });

  it('should throw when creating external mint authority address with invalid address', async () => {
    await expect(
      wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
        address: addresses[1],
        createMintAuthority: true,
        mintAuthorityAddress: 'abc',
        allowExternalMintAuthorityAddress: true,
        pinCode: '123456',
      })
    ).rejects.toThrow(SendTxError);
  });

  it('should throw when creating external melt authority with invalid address', async () => {
    await expect(
      wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
        address: addresses[1],
        createMeltAuthority: true,
        meltAuthorityAddress: 'abc',
        allowExternalMeltAuthorityAddress: true,
        pinCode: '123456',
      })
    ).rejects.toThrow(SendTxError);
  });

  it('should create deposit token without signing transaction when signTx is false', async () => {
    const result = await wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      mintAuthorityAddress: addresses[2],
      pinCode: '123456',
      signTx: false,
    });
    expect(result.inputs).toEqual([expect.objectContaining({ data: null })]);
  });

  it('should successfuly create deposit token with mint authority output', async () => {
    const result = await wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      createMintAuthority: true,
      mintAuthorityAddress: addresses[2],
      pinCode: '123456',
    });

    expect(result.inputs).toEqual([expect.objectContaining({ data: expect.any(Object) })]);
    expect(result.outputs).toHaveLength(3);

    const authorityOutputs = result.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(2);

    const mintAuth = authorityOutputs.find(o => o.value === TOKEN_MINT_MASK) as Output;
    const p2pkh = (mintAuth.parseScript(network) as P2PkH_Script).address.base58;
    expect(p2pkh).toBe(addresses[2]);
  });

  it('should successfuly create token with melt authority output', async () => {
    const result = await wallet.prepareCreateNewToken('Test Token', 'TST', 100n, {
      address: addresses[1],
      createMintAuthority: false,
      meltAuthorityAddress: addresses[2],
      pinCode: '123456',
    });

    expect(result.outputs).toHaveLength(2);

    const meltAuth = result.outputs.find(o => o.value === TOKEN_MELT_MASK) as Output;
    expect(meltAuth).toBeDefined();
    const p2pkh = (meltAuth.parseScript(network) as P2PkH_Script).address.base58;
    expect(p2pkh).toBe(addresses[2]);
  });
  it('should successfully create fee token with mint authority and change outputs', async () => {
    const _spyGetUtxos = jest.spyOn(wallet, 'getUtxos').mockImplementation(async () => ({
      utxos: [mockUtxo(10n)],
      changeAmount: 9n,
    }));
    const result = await wallet.prepareCreateNewToken('Test Token', 'TSTF', 1000n, {
      address: addresses[1],
      createMintAuthority: true,
      mintAuthorityAddress: addresses[2],
      pinCode: '123456',
      tokenInfoVersion: TokenInfoVersion.FEE,
    });

    expect(result.inputs).toEqual([expect.objectContaining({ data: expect.any(Object) })]);
    expect(result.outputs).toHaveLength(4);

    const authorityOutputs = result.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(2);

    const mintAuth = authorityOutputs.find(o => o.value === TOKEN_MINT_MASK) as Output;
    const p2pkh = (mintAuth.parseScript(network) as P2PkH_Script).address.base58;
    expect(p2pkh).toBe(addresses[2]);

    _spyGetUtxos.mockRestore();
  });
  it('should throws when the amount htr found is not enough to pay the fee', async () => {
    const _spyGetUtxos = jest.spyOn(wallet, 'getUtxos').mockImplementation(async () => ({
      utxos: [],
      changeAmount: 0n,
    }));

    jest.spyOn(Fee, 'calculateTokenCreationTxFee').mockReturnValue(1000);

    await expect(
      wallet.prepareCreateNewToken('Test Token', 'TSTF', 1000n, {
        address: addresses[1],
        createMintAuthority: true,
        mintAuthorityAddress: addresses[2],
        pinCode: '123456',
        tokenInfoVersion: TokenInfoVersion.FEE,
      })
    ).rejects.toThrow('No utxos available to fill the request. Token: HTR - Amount: 1000.');

    _spyGetUtxos.mockRestore();
  });
});
