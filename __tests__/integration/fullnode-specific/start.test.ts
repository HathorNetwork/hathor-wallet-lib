/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade start() tests.
 *
 * Defines fullnode-specific tests that rely on {@link HathorWallet}-only features
 * (multisig, xpub-readonly, token scoping, external signing, constructor validation).
 *
 * Shared start() tests live in `shared/start.test.ts` and run via `describe.each`.
 */

import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import HathorWallet from '../../../src/new/wallet';
import { NATIVE_TOKEN_UID, P2PKH_ACCT_PATH } from '../../../src/constants';
import { ConnectionState } from '../../../src/wallet/types';
import { WalletFromXPubGuard } from '../../../src/errors';
import { AuthorityType, TokenVersion } from '../../../src/types';
import Network from '../../../src/models/network';
import { MemoryStore, Storage } from '../../../src/storage';
import { WALLET_CONSTANTS } from '../configuration/test-constants';
import {
  createTokenHelper,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  generateWalletHelper,
  waitForWalletReady,
} from '../helpers/wallet.helper';
import {
  multisigWalletsData,
  precalculationHelpers,
} from '../helpers/wallet-precalculation.helper';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import WalletConnection from '../../../src/new/connection';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

const adapter = new FullnodeWalletTestAdapter();

// --- Suite lifecycle ---
beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

// --- Fullnode-specific tests ---
describe('[Fullnode-specific] start', () => {
  afterEach(async () => {
    await adapter.stopAllWallets();
  });

  it('should reject with invalid constructor parameters', () => {
    const walletData = precalculationHelpers.test!.getPrecalculatedWallet();
    const connection = generateConnection();

    // No arguments at all
    expect(() => new HathorWallet()).toThrow('provide a connection');

    // Missing connection
    expect(
      () =>
        // @ts-expect-error -- The test needs to remove a mandatory property
        new HathorWallet({
          seed: walletData.words,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('provide a connection');

    // Missing seed/xpub/xpriv
    expect(
      () =>
        new HathorWallet({
          connection,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('seed');

    // Both seed and xpriv
    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          xpriv: 'abc123',
          connection,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('seed and an xpriv');

    // xpriv with passphrase
    expect(
      () =>
        new HathorWallet({
          xpriv: 'abc123',
          connection,
          passphrase: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('xpriv with passphrase');

    // Already-connected connection
    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          // @ts-expect-error -- Deliberately passing an incomplete mock to test rejection
          connection: {
            state: ConnectionState.CONNECTED,
            getState(): ConnectionState {
              return ConnectionState.CONNECTED;
            },
          } as Partial<WalletConnection>,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
        })
    ).toThrow('share connections');

    // Invalid multisig config (empty)
    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          connection,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
          // @ts-expect-error -- Deliberately passing empty config to test rejection
          multisig: {},
        })
    ).toThrow('pubkeys and numSignatures');

    // Invalid multisig config (numSignatures > pubkeys.length)
    expect(
      () =>
        new HathorWallet({
          seed: walletData.words,
          connection,
          password: DEFAULT_PASSWORD,
          pinCode: DEFAULT_PIN_CODE,
          multisig: { pubkeys: ['abc'], numSignatures: 2 },
        })
    ).toThrow('configuration invalid');
  });

  it('should resolve precalculated addresses via getAddressAtIndex', async () => {
    const walletData = precalculationHelpers.test!.getPrecalculatedWallet();

    const hWallet = new HathorWallet({
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: walletData.addresses,
    });
    await hWallet.start();
    await waitForWalletReady(hWallet);

    for (const [index, precalcAddress] of walletData.addresses.entries()) {
      const addressAtIndex = await hWallet.getAddressAtIndex(index);
      expect(addressAtIndex).toEqual(precalcAddress);
    }
    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it("should calculate the wallet's addresses on start (no precalculated)", async () => {
    const walletData = precalculationHelpers.test!.getPrecalculatedWallet();

    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      // No preCalculatedAddresses — all calculated at runtime
    };
    const hWallet = new HathorWallet(walletConfig);
    await hWallet.storage.setGapLimit(100);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    for (const [index, precalcAddress] of walletData.addresses.entries()) {
      const addressAtIndex = await hWallet.getAddressAtIndex(index);
      expect(precalcAddress).toEqual(addressAtIndex);
    }
    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should start a multisig wallet', async () => {
    const walletConfig = {
      seed: multisigWalletsData.words[0],
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      multisig: {
        pubkeys: multisigWalletsData.pubkeys,
        numSignatures: 3,
      },
    };

    const hWallet = new HathorWallet(walletConfig);
    await hWallet.storage.setGapLimit(5);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    for (let i = 0; i < 5; ++i) {
      const precalcAddress = WALLET_CONSTANTS.multisig.addresses[i];
      const addressAtIndex = await hWallet.getAddressAtIndex(i);
      expect(precalcAddress).toStrictEqual(addressAtIndex);
    }

    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should start a wallet to manage a specific token', async () => {
    const walletData = precalculationHelpers.test!.getPrecalculatedWallet();

    // Create a wallet and mint a custom token
    let hWallet = await generateWalletHelper({
      seed: walletData.words,
      preCalculatedAddresses: walletData.addresses,
    });
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 2n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Dedicated Wallet Token',
      'DWT',
      100n
    );

    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });

    // Re-start with tokenUid scope
    hWallet = await generateWalletHelper({
      seed: walletData.words,
      preCalculatedAddresses: walletData.addresses,
      tokenUid,
    });
    expect(hWallet.isReady()).toStrictEqual(true);

    // @ts-expect-error -- Passing false instead of string to test legacy behavior
    expect(await hWallet.getBalance(false)).toStrictEqual([
      {
        token: {
          id: tokenUid,
          name: 'Dedicated Wallet Token',
          symbol: 'DWT',
          version: TokenVersion.DEPOSIT,
        },
        balance: { unlocked: 100n, locked: 0n },
        transactions: 1,
        lockExpires: null,
        tokenAuthorities: {
          unlocked: { mint: 1n, melt: 1n },
          locked: { mint: 0n, melt: 0n },
        },
      },
    ]);

    const txHistory1 = await hWallet.getTxHistory({ token_id: undefined });
    expect(txHistory1).toStrictEqual([expect.objectContaining({ txId: tokenUid })]);
  });

  it('should start a wallet via xpub (readonly)', async () => {
    const walletData = precalculationHelpers.test!.getPrecalculatedWallet();
    const code = new Mnemonic(walletData.words);
    const rootXpriv = code.toHDPrivateKey('', new Network('testnet'));
    const xpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    const xpub = xpriv.xpubkey;

    const hWallet = await generateWalletHelper({
      xpub,
      password: null,
      pinCode: null,
    });
    expect(hWallet.isReady()).toStrictEqual(true);
    await expect(hWallet.isReadonly()).resolves.toBe(true);

    // Methods requiring private key should throw WalletFromXPubGuard.
    // All calls below deliberately omit required args — the guard rejects before arg validation.
    // Disabling TypeScript validation for the following block
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = hWallet as any;
    await expect(w.consolidateUtxos()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.sendTransaction()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.sendManyOutputsTransaction()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.prepareCreateNewToken()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.prepareMintTokensData()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.prepareMeltTokensData()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.prepareDelegateAuthorityData()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.prepareDestroyAuthorityData()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.getAllSignatures()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.getSignatures()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.signTx()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.createAndSendNanoContractTransaction()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.createAndSendNanoContractCreateTokenTransaction()).rejects.toThrow(
      WalletFromXPubGuard
    );
    await expect(w.getPrivateKeyFromAddress()).rejects.toThrow(WalletFromXPubGuard);
    await expect(w.createOnChainBlueprintTransaction()).rejects.toThrow(WalletFromXPubGuard);

    // Address generation still works
    for (let i = 0; i < 20; ++i) {
      expect(await hWallet.getAddressAtIndex(i)).toStrictEqual(walletData.addresses[i]);
    }

    // Balance and utxo methods work
    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toStrictEqual([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        balance: { unlocked: 0n, locked: 0n },
        transactions: 0,
      }),
    ]);
    await expect(hWallet.getUtxos()).resolves.toHaveProperty('total_utxos_available', 0n);

    // Inject funds and verify they show in balance
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(1), 1n);

    await expect(hWallet.getBalance(NATIVE_TOKEN_UID)).resolves.toMatchObject([
      expect.objectContaining({
        token: expect.objectContaining({ id: NATIVE_TOKEN_UID }),
        balance: { unlocked: 1n, locked: 0n },
        transactions: expect.any(Number),
      }),
    ]);
    await expect(hWallet.getUtxos()).resolves.toHaveProperty('total_utxos_available', 1n);
  });

  it('should start an externally signed wallet', async () => {
    const walletData = precalculationHelpers.test!.getPrecalculatedWallet();
    const code = new Mnemonic(walletData.words);
    const rootXpriv = code.toHDPrivateKey('', new Network('testnet'));
    const xpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    const xpub = xpriv.xpubkey;

    const hWallet = await generateWalletHelper({
      xpub,
      password: null,
      pinCode: null,
    });
    // @ts-expect-error -- Simplified mock: real EcdsaTxSign has a different signature
    hWallet.setExternalTxSigningMethod(async () => {});
    expect(hWallet.isReady()).toStrictEqual(true);
    await expect(hWallet.isReadonly()).resolves.toBe(false);
    hWallet.setExternalTxSigningMethod(null);
    await expect(hWallet.isReadonly()).resolves.toBe(true);
  });

  it('should start an externally signed wallet from storage', async () => {
    const walletData = precalculationHelpers.test!.getPrecalculatedWallet();
    const code = new Mnemonic(walletData.words);
    const rootXpriv = code.toHDPrivateKey('', new Network('testnet'));
    const xpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    const xpub = xpriv.xpubkey;

    const store = new MemoryStore();
    const storage = new Storage(store);
    // @ts-expect-error -- Simplified mock: real EcdsaTxSign has a different signature
    storage.setTxSignatureMethod(async () => {});

    const hWallet = await generateWalletHelper({
      xpub,
      storage,
      password: null,
      pinCode: null,
    });
    expect(hWallet.isReady()).toStrictEqual(true);
    await expect(hWallet.isReadonly()).resolves.toBe(false);
    hWallet.setExternalTxSigningMethod(null);
    await expect(hWallet.isReadonly()).resolves.toBe(true);
  });

  it('should start a wallet without pin (hack test)', async () => {
    const walletData = precalculationHelpers.test!.getPrecalculatedWallet();
    const hWallet = await generateWalletHelper({
      seed: walletData.words,
      preCalculatedAddresses: walletData.addresses,
      pinCode: DEFAULT_PIN_CODE,
    });

    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    // Manually remove pin to test the no-pin code paths
    hWallet.pinCode = null;

    await expect(
      hWallet.sendManyOutputsTransaction([
        { address: await hWallet.getAddressAtIndex(1), value: 1n, token: NATIVE_TOKEN_UID },
      ])
    ).rejects.toThrow('Pin');

    await expect(hWallet.createNewToken('Pinless Token', 'PTT', 100n)).rejects.toThrow('Pin');

    await expect(hWallet.mintTokens(fakeTokenUid, 100n)).rejects.toThrow('Pin');

    await expect(hWallet.meltTokens(fakeTokenUid, 100n)).rejects.toThrow('Pin');

    await expect(
      hWallet.delegateAuthority(
        fakeTokenUid,
        AuthorityType.MINT,
        await hWallet.getAddressAtIndex(1)
      )
    ).rejects.toThrow('Pin');

    await expect(hWallet.destroyAuthority(fakeTokenUid, AuthorityType.MINT, 1)).rejects.toThrow(
      'Pin'
    );

    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });
});
