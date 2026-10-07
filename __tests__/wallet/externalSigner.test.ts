/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * External tx-signing method on the wallet-service facade (HathorWalletServiceWallet).
 *
 * Mirrors the HathorWallet external-signer support: an xpub-only wallet (e.g. a passkey wallet)
 * registers a signer and every signing path signs through it — via the wallet-service storage
 * proxy — with no pin, never prompting for one and never touching a stored private key.
 */

import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import HathorWalletServiceWallet from '../../src/wallet/wallet';
import SendTransactionWalletService from '../../src/wallet/sendTransactionWalletService';
import walletApi from '../../src/wallet/api/walletApi';
import Network from '../../src/models/network';
import Transaction from '../../src/models/transaction';
import Input from '../../src/models/input';
import walletUtils from '../../src/utils/wallet';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import { PinRequiredError, WalletFromXPubGuard } from '../../src/errors';
import { EcdsaTxSign, TokenVersion } from '../../src/types';

const seed =
  'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
const network = new Network('testnet');
const addresses = [
  'WdSD7aytFEZ5Hp8quhqu3wUCsyyGqcneMu',
  'WbjNdAGBWAkCS2QVpqmacKXNy8WVXatXNM',
  'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX',
];
const TOKEN_ID = '0000000000000000000000000000000000000000000000000000000000000001';
const PUBKEY = Buffer.from(`02${'11'.repeat(32)}`, 'hex');

// A signer that produces one deterministic signature per input, like a passkey signer would
// (the real one derives keys in a ceremony and delegates to transactionUtils.signTxInputs).
const makeSigner = () =>
  jest.fn(async (tx: Transaction) => ({
    inputSignatures: tx.inputs.map((_input, inputIndex) => ({
      inputIndex,
      addressIndex: 0,
      signature: Buffer.from(`sig-${inputIndex}`),
      pubkey: PUBKEY,
    })),
    ncCallerSignature: null,
  }));

const htrUtxo = (txIdSuffix: string, address: string) => ({
  txId: `${'0'.repeat(60)}${txIdSuffix}`,
  index: 0,
  tokenId: NATIVE_TOKEN_UID,
  address,
  value: 5n,
  authorities: 0n,
  timelock: null,
  heightlock: null,
  locked: false,
  addressPath: "m/44'/280'/0'/0/0",
});

/** An xpub-only (readonly-storage) facade wallet, started, with access data saved. */
async function makeXpubWallet() {
  const xpub = walletUtils.getXPubKeyFromSeed(seed, { networkName: 'testnet' });
  const requestPassword = jest.fn();
  const wallet = new HathorWalletServiceWallet({ requestPassword, xpub, network });
  await wallet.storage.saveAccessData(walletUtils.generateAccessDataFromXpub(xpub));
  wallet.setState('Ready');
  wallet.walletId = 'wallet-id';
  const getMainXPrivKey = jest.spyOn(wallet.storage, 'getMainXPrivKey');
  return { wallet, requestPassword, getMainXPrivKey };
}

const expectSignedThroughProxy = (
  signer: ReturnType<typeof makeSigner>,
  wallet: HathorWalletServiceWallet,
  tx: Transaction
) => {
  expect(signer).toHaveBeenCalledTimes(1);
  const [signedTx, storageArg] = signer.mock.calls[0] as unknown as [Transaction, unknown];
  expect(signedTx).toBe(tx);
  // The signer gets the wallet-service storage PROXY (it resolves spent outputs and address
  // indexes through the API), not the raw storage.
  expect(storageArg).not.toBe(wallet.storage);
  expect(typeof (storageArg as { getSpentTxs: unknown }).getSpentTxs).toBe('function');
  for (const input of tx.inputs) {
    expect(input.data).not.toBeNull();
    expect(input.data!.length).toBeGreaterThan(0);
  }
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('setExternalTxSigningMethod / isReadonly', () => {
  it('an xpub-only wallet is readonly until a signer is registered', async () => {
    const { wallet } = await makeXpubWallet();
    expect(wallet.isSignedExternally).toBe(false);
    await expect(wallet.isReadonly()).resolves.toBe(true);

    wallet.setExternalTxSigningMethod(makeSigner() as unknown as EcdsaTxSign);
    expect(wallet.isSignedExternally).toBe(true);
    expect(wallet.storage.hasTxSignatureMethod()).toBe(true);
    await expect(wallet.isReadonly()).resolves.toBe(false);

    wallet.setExternalTxSigningMethod(null);
    expect(wallet.isSignedExternally).toBe(false);
    await expect(wallet.isReadonly()).resolves.toBe(true);
  });
});

describe('setExternalPrivateKeyMethod / hasExternalPrivateKeyMethod', () => {
  it('reports whether an external private-key provider is registered', async () => {
    const { wallet } = await makeXpubWallet();
    expect(wallet.hasExternalPrivateKeyMethod()).toBe(false);

    wallet.setExternalPrivateKeyMethod(async () => undefined);
    expect(wallet.hasExternalPrivateKeyMethod()).toBe(true);
    expect(wallet.storage.hasPrivateKeyMethod()).toBe(true);

    wallet.setExternalPrivateKeyMethod(null);
    expect(wallet.hasExternalPrivateKeyMethod()).toBe(false);
  });
});

describe('signTx with an external signer', () => {
  const makeTx = () =>
    new Transaction([new Input(`${'0'.repeat(62)}aa`, 0), new Input(`${'0'.repeat(62)}bb`, 1)], []);

  it('signs through the proxy with no pin', async () => {
    const { wallet, requestPassword, getMainXPrivKey } = await makeXpubWallet();
    const signer = makeSigner();
    wallet.setExternalTxSigningMethod(signer as unknown as EcdsaTxSign);
    const tx = makeTx();

    await wallet.signTx(tx);

    expectSignedThroughProxy(signer, wallet, tx);
    expect(signer.mock.calls[0][2]).toBe('');
    expect(requestPassword).not.toHaveBeenCalled();
    expect(getMainXPrivKey).not.toHaveBeenCalled();
  });

  it('still rejects an xpub-only wallet without a signer', async () => {
    const { wallet } = await makeXpubWallet();
    await expect(wallet.signTx(makeTx())).rejects.toThrow(WalletFromXPubGuard);
  });
});

describe('SendTransactionWalletService.signTx with an external signer', () => {
  it('signs through the wallet without a pin', async () => {
    const { wallet, getMainXPrivKey } = await makeXpubWallet();
    const signer = makeSigner();
    wallet.setExternalTxSigningMethod(signer as unknown as EcdsaTxSign);
    const tx = new Transaction([new Input(`${'0'.repeat(62)}cc`, 0)], []);
    const sendTx = new SendTransactionWalletService(wallet, { transaction: tx });

    await expect(sendTx.signTx()).resolves.toBe(tx);

    expectSignedThroughProxy(signer, wallet, tx);
    expect(getMainXPrivKey).not.toHaveBeenCalled();
  });
});

describe('sendManyOutputsSendTransaction with an external signer', () => {
  it('never asks for a pin', async () => {
    const { wallet, requestPassword } = await makeXpubWallet();
    wallet.setExternalTxSigningMethod(makeSigner() as unknown as EcdsaTxSign);

    const sendTx = await wallet.sendManyOutputsSendTransaction([
      { address: addresses[0], value: 1n, token: NATIVE_TOKEN_UID },
    ]);

    expect(sendTx).toBeInstanceOf(SendTransactionWalletService);
    expect(requestPassword).not.toHaveBeenCalled();
  });
});

describe('prepare* token/authority methods with an external signer', () => {
  /** Common stubs for the token methods; each test signs a tx with no pin. */
  const stubTokenDeps = (wallet: HathorWalletServiceWallet) => {
    jest.spyOn(wallet, 'getCurrentAddress').mockReturnValue({ address: addresses[0] } as never);
    jest.spyOn(wallet.storage, 'getToken').mockResolvedValue(null);
    jest.spyOn(wallet, 'getTokenDetails').mockResolvedValue({
      tokenInfo: { id: TOKEN_ID, name: 'Token', symbol: 'TKN', version: TokenVersion.DEPOSIT },
      totalSupply: 1000n,
      totalTransactions: 1,
      authorities: { mint: true, melt: true },
    } as never);
    jest.spyOn(wallet, 'getAddressIndex').mockResolvedValue(2);
    jest.spyOn(wallet, 'getUtxosForAmount').mockImplementation(async (_amount, params) => {
      if (params?.token === NATIVE_TOKEN_UID) {
        return { utxos: [htrUtxo('01', addresses[0])], changeAmount: 4n } as never;
      }
      return {
        utxos: [{ ...htrUtxo('02', addresses[1]), tokenId: TOKEN_ID, value: 10n }],
        changeAmount: 0n,
      } as never;
    });
  };
  const authority = (mask: bigint) => [
    { txId: `${'0'.repeat(60)}aa01`, index: 0, address: addresses[2], authorities: mask },
  ];

  const setup = async () => {
    const harness = await makeXpubWallet();
    const signer = makeSigner();
    harness.wallet.setExternalTxSigningMethod(signer as unknown as EcdsaTxSign);
    stubTokenDeps(harness.wallet);
    return { ...harness, signer };
  };

  it('prepareCreateNewToken', async () => {
    const { wallet, signer, getMainXPrivKey } = await setup();
    const tx = await wallet.prepareCreateNewToken('Token', 'TKN', 100n, { signTx: true });
    expectSignedThroughProxy(signer, wallet, tx);
    expect(getMainXPrivKey).not.toHaveBeenCalled();
  });

  it('prepareMintTokensData', async () => {
    const { wallet, signer, getMainXPrivKey } = await setup();
    jest.spyOn(wallet, 'getMintAuthority').mockResolvedValue(authority(TOKEN_MINT_MASK) as never);
    const tx = await wallet.prepareMintTokensData(TOKEN_ID, 100n, { signTx: true });
    expectSignedThroughProxy(signer, wallet, tx);
    expect(getMainXPrivKey).not.toHaveBeenCalled();
  });

  it('prepareMeltTokensData', async () => {
    const { wallet, signer, getMainXPrivKey } = await setup();
    jest.spyOn(wallet, 'getMeltAuthority').mockResolvedValue(authority(TOKEN_MELT_MASK) as never);
    const tx = await wallet.prepareMeltTokensData(TOKEN_ID, 10n, { signTx: true });
    expectSignedThroughProxy(signer, wallet, tx);
    expect(getMainXPrivKey).not.toHaveBeenCalled();
  });

  it('prepareDelegateAuthorityData', async () => {
    const { wallet, signer, getMainXPrivKey } = await setup();
    jest.spyOn(wallet, 'getMintAuthority').mockResolvedValue(authority(TOKEN_MINT_MASK) as never);
    const tx = await wallet.prepareDelegateAuthorityData(TOKEN_ID, 'mint', addresses[1], {});
    expectSignedThroughProxy(signer, wallet, tx);
    expect(getMainXPrivKey).not.toHaveBeenCalled();
  });

  it('prepareDestroyAuthorityData', async () => {
    const { wallet, signer, getMainXPrivKey } = await setup();
    jest.spyOn(wallet, 'getMeltAuthority').mockResolvedValue(authority(TOKEN_MELT_MASK) as never);
    const tx = await wallet.prepareDestroyAuthorityData(TOKEN_ID, 'melt', 1, {});
    expectSignedThroughProxy(signer, wallet, tx);
    expect(getMainXPrivKey).not.toHaveBeenCalled();
  });
});

describe('nano with an external signer', () => {
  it('createNanoContractTransaction does not require a pin when a signer is set', async () => {
    const { wallet } = await makeXpubWallet();
    // Stop right after the pin check: reaching this stub means the pin guard let it through.
    jest
      .spyOn(wallet as never, 'getAddressIndexIfOwned')
      .mockRejectedValue(new Error('past the pin check') as never);

    wallet.setExternalTxSigningMethod(makeSigner() as unknown as EcdsaTxSign);
    await expect(
      wallet.createNanoContractTransaction('initialize', addresses[0], {})
    ).rejects.toThrow('past the pin check');
  });

  it('createNanoContractTransaction still requires a pin without a signer', async () => {
    const { wallet } = await makeXpubWallet();
    jest.spyOn(wallet.storage, 'isReadonly').mockResolvedValue(false); // seed-like wallet
    await expect(
      wallet.createNanoContractTransaction('initialize', addresses[0], {})
    ).rejects.toThrow(PinRequiredError);
  });

  it('prepareNanoSendTransactionWalletService signs with a signer and no pin', async () => {
    const { wallet } = await makeXpubWallet();
    wallet.setExternalTxSigningMethod(makeSigner() as unknown as EcdsaTxSign);
    jest.spyOn(wallet, 'getAddressDetails').mockResolvedValue({ index: 0 } as never);
    const signTx = jest.spyOn(wallet, 'signTx').mockImplementation(async tx => tx);
    const tx = new Transaction([], []);

    await wallet.prepareNanoSendTransactionWalletService(tx, addresses[0], null);

    expect(signTx).toHaveBeenCalledWith(tx, { pinCode: null });
  });
});

describe('refreshFullAuthToken', () => {
  const authPrivKey = () => {
    const root = new Mnemonic(seed).toHDPrivateKey('', network.getNetwork());
    return HathorWalletServiceWallet.deriveAuthPrivateKey(root);
  };

  it('mints a full token with the auth key without keeping the key', async () => {
    const { wallet } = await makeXpubWallet();
    const createAuthToken = jest
      .spyOn(walletApi, 'createAuthToken')
      .mockResolvedValue({ success: true, token: 'full-token' } as never);
    const key = authPrivKey();

    await wallet.refreshFullAuthToken(key);

    expect(createAuthToken).toHaveBeenCalledWith(
      wallet,
      expect.any(Number),
      key.xpubkey,
      expect.any(String)
    );
    expect((wallet as unknown as { authToken: string }).authToken).toBe('full-token');
    // Later renewals fall back to read-only tokens: the key is not retained.
    expect((wallet as unknown as { authPrivKey: unknown }).authPrivKey).toBeNull();
  });

  it('requires a started wallet', async () => {
    const { wallet } = await makeXpubWallet();
    wallet.walletId = null;
    await expect(wallet.refreshFullAuthToken(authPrivKey())).rejects.toThrow(
      'Wallet not ready yet.'
    );
  });
});
