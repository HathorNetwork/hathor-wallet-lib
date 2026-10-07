/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * External private-key provider (setExternalPrivateKeyMethod) on the wallet-service facade.
 *
 * Reproduces the passkey-wallet shape end to end: the wallet is registered once from its seed,
 * then runs as an xpub-only wallet started with `startReadOnly()`, whose address private keys come
 * from an external provider instead of a stored, PIN-encrypted key. Covers message signing,
 * getPrivateKeyFromAddress and oracle-data signing, and the check that rejects a provider key for
 * the wrong address.
 *
 * Message signing and getPrivateKeyFromAddress work with the read-only token. Oracle signing also
 * calls wallet/addresses/check_mine, which the wallet-service currently allows only with a full
 * token: the client mints it with refreshFullAuthToken in the same passkey ceremony, before
 * signing.
 */

import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import { PrivateKey } from 'bitcore-lib';
import HathorWalletServiceWallet from '../../../src/wallet/wallet';
import Network from '../../../src/models/network';
import { P2PKH_ACCT_PATH } from '../../../src/constants';
import { verifyMessage } from '../../../src/utils/crypto';
import { getOracleBuffer, unsafeGetOracleInputData } from '../../../src/nano_contracts/utils';
import { WalletFromXPubGuard } from '../../../src/errors';
import {
  buildWalletInstance,
  initializeServiceGlobalConfigs,
} from '../helpers/service-facade.helper';
import { GenesisWalletServiceHelper } from '../helpers/genesis-wallet.helper';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { deriveXpubFromSeed } from '../utils/core.util';

initializeServiceGlobalConfigs();

const pinCode = '123456';
const password = 'testpass';
const ORACLE_RESULT = Buffer.from('oracle-result');

/**
 * Build the provider a passkey signer would register: derive the address key on demand from the
 * seed, the same path the wallet uses for its stored key (m/44'/280'/0'/0/<index>).
 * `indexOffset` simulates a buggy provider that returns the key of another address.
 */
function makeProvider(words: string, indexOffset = 0) {
  const rootXpriv = new Mnemonic(words).toHDPrivateKey('', new Network('testnet'));
  const changeXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH).deriveNonCompliantChild(0);
  return async (addressIndex: number) =>
    changeXpriv.deriveNonCompliantChild(addressIndex + indexOffset).privateKey;
}

let words: string;
let addresses: string[];
// Oracle input data signed by the stored key of the same wallet (seed + pin): the ground truth.
let oracleViaPin: Buffer;

beforeAll(async () => {
  await GenesisWalletServiceHelper.start();

  ({ words, addresses } = await precalculationHelpers.test!.getPrecalculatedWallet());

  // Register the wallet on the wallet-service once, from the seed (wallet/init), and sign the
  // oracle data with its stored key while it runs.
  const { wallet: seedWallet } = await buildWalletInstance({ words });
  await seedWallet.start({ pinCode, password });
  oracleViaPin = await unsafeGetOracleInputData(
    getOracleBuffer(addresses[1], seedWallet.getNetworkObject()),
    ORACLE_RESULT,
    seedWallet,
    { pinCode }
  );
  await seedWallet.stop({ cleanStorage: true });
});

afterAll(async () => {
  await GenesisWalletServiceHelper.stop();
});

describe('[Service] external private-key provider on an xpub-only wallet', () => {
  let wallet: HathorWalletServiceWallet;

  /** Start the registered wallet xpub-only (read-only token), optionally with a provider. */
  async function startXpubOnlyWallet(provider?: ReturnType<typeof makeProvider>) {
    ({ wallet } = await buildWalletInstance({ xpub: deriveXpubFromSeed(words) }));
    await wallet.startReadOnly();
    if (provider) {
      wallet.setExternalPrivateKeyMethod(provider);
    }
    // The wallet holds no private key at all; only the provider can sign.
    await expect(wallet.storage.isReadonly()).resolves.toBe(true);
    return wallet;
  }

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  it('signs messages through the provider, with no pin', async () => {
    await startXpubOnlyWallet(makeProvider(words));

    for (let i = 0; i < 3; i++) {
      const message = `sign-me-${i}`;
      const signed = await wallet.signMessageWithAddress(message, i);
      expect(verifyMessage(message, signed, addresses[i])).toBe(true);
    }
    expect(
      (wallet as unknown as { requestPassword: jest.Mock }).requestPassword
    ).not.toHaveBeenCalled();
  });

  it('getPrivateKeyFromAddress returns the key of the requested address', async () => {
    await startXpubOnlyWallet(makeProvider(words));
    const network = wallet.getNetworkObject().bitcoreNetwork;

    for (let i = 0; i < 3; i++) {
      const key = await wallet.getPrivateKeyFromAddress(addresses[i]);
      expect(key).toBeInstanceOf(PrivateKey);
      expect(key.toAddress(network).toString()).toBe(addresses[i]);
    }
  });

  it('signs oracle data with the provider key, identical to the stored-key (pin) wallet', async () => {
    await startXpubOnlyWallet(makeProvider(words));
    const oracleData = getOracleBuffer(addresses[1], wallet.getNetworkObject());

    // The oracle path first checks the oracle address is ours (wallet/addresses/check_mine). The
    // wallet-service currently doesn't allow that call with a read-only token, so the passkey
    // consent step mints a full token first, in the same ceremony that yields the keys (as it
    // does for transactions).
    const rootXpriv = new Mnemonic(words).toHDPrivateKey('', new Network('testnet'));
    await wallet.refreshFullAuthToken(HathorWalletServiceWallet.deriveAuthPrivateKey(rootXpriv));

    const viaProvider = await unsafeGetOracleInputData(oracleData, ORACLE_RESULT, wallet);
    expect(viaProvider.toString('hex')).toBe(oracleViaPin.toString('hex'));
  });

  it('rejects a provider key that does not belong to the requested address', async () => {
    // A buggy provider returning the key of the NEXT address must never be used to sign.
    await startXpubOnlyWallet(makeProvider(words, 1));

    await expect(wallet.getPrivateKeyFromAddress(addresses[0])).rejects.toThrow(
      'External private key provider returned a key for the wrong address.'
    );
    await expect(wallet.signMessageWithAddress('sign-me', 0)).rejects.toThrow(
      'External private key provider returned a key for the wrong address.'
    );
  });

  it('rejects a provider that does not return a bitcore PrivateKey', async () => {
    await startXpubOnlyWallet();
    wallet.setExternalPrivateKeyMethod(async () => ({ not: 'a key' }));

    await expect(wallet.getPrivateKeyFromAddress(addresses[0])).rejects.toThrow(
      'External private key provider must return a bitcore PrivateKey.'
    );
  });

  it('still refuses to produce a key without a provider', async () => {
    await startXpubOnlyWallet();

    await expect(wallet.getPrivateKeyFromAddress(addresses[0])).rejects.toThrow(
      WalletFromXPubGuard
    );
    await expect(
      unsafeGetOracleInputData(
        getOracleBuffer(addresses[1], wallet.getNetworkObject()),
        ORACLE_RESULT,
        wallet
      )
    ).rejects.toThrow(WalletFromXPubGuard);
  });
});
