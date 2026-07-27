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
import transactionUtils from '../../../src/utils/transaction';
import { NATIVE_TOKEN_UID, P2PKH_ACCT_PATH } from '../../../src/constants';
import { ConnectionState } from '../../../src/wallet/types';
import { WalletFromXPubGuard } from '../../../src/errors';
import { AuthorityType, TokenVersion } from '../../../src/types';
import Network from '../../../src/models/network';
import { MemoryStore, Storage } from '../../../src/storage';
import { WalletTracker } from '../utils/wallet-tracker.util';
import { deriveXpubFromSeed, getGapLimitConfig } from '../utils/core.util';
import { WALLET_CONSTANTS } from '../configuration/test-constants';
import {
  createTokenHelper,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  generateWalletHelper,
  waitForTxReceived,
  waitForWalletReady,
} from '../helpers/wallet.helper';
import {
  multisigWalletsData,
  precalculationHelpers,
} from '../helpers/wallet-precalculation.helper';
import { getPrecalculatedShieldedForSeed } from '../configuration/precalculated-shielded-addresses';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import WalletConnection from '../../../src/new/connection';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

const adapter = new FullnodeWalletTestAdapter();
const tracker = new WalletTracker<HathorWallet>({
  cleanStorage: true,
  cleanAddresses: true,
});

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
    await tracker.stopAll();
    await adapter.stopAllWallets();
  });

  it('should reject with invalid constructor parameters', async () => {
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
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
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();

    const hWallet = new HathorWallet({
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: walletData.addresses,
      preCalculatedShieldedAddresses: walletData.shieldedAddresses,
      scanPolicy: getGapLimitConfig(),
    });
    tracker.track(hWallet);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    for (const [index, precalcAddress] of walletData.addresses.entries()) {
      const addressAtIndex = await hWallet.getAddressAtIndex(index);
      expect(addressAtIndex).toEqual(precalcAddress);
    }
  });

  it("should calculate the wallet's addresses on start (no precalculated)", async () => {
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();

    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      // No preCalculatedAddresses — all calculated at runtime
      scanPolicy: getGapLimitConfig(),
    };
    const hWallet = new HathorWallet(walletConfig);
    tracker.track(hWallet);
    await hWallet.storage.setGapLimit(100);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    for (const [index, precalcAddress] of walletData.addresses.entries()) {
      const addressAtIndex = await hWallet.getAddressAtIndex(index);
      expect(precalcAddress).toEqual(addressAtIndex);
    }
  });

  it('should start a multisig wallet', async () => {
    const walletConfig = {
      seed: multisigWalletsData.words[0],
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedShieldedAddresses: getPrecalculatedShieldedForSeed(multisigWalletsData.words[0]),
      multisig: {
        pubkeys: multisigWalletsData.pubkeys,
        numSignatures: 3,
      },
      scanPolicy: getGapLimitConfig(),
    };

    const hWallet = new HathorWallet(walletConfig);
    tracker.track(hWallet);
    await hWallet.storage.setGapLimit(5);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    for (let i = 0; i < 5; ++i) {
      const precalcAddress = WALLET_CONSTANTS.multisig.addresses[i];
      const addressAtIndex = await hWallet.getAddressAtIndex(i);
      expect(precalcAddress).toStrictEqual(addressAtIndex);
    }
  });

  it('should start a wallet to manage a specific token', async () => {
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();

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

  it('should generate correct addresses from xpub (readonly)', async () => {
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
    const xpub = deriveXpubFromSeed(walletData.words);

    const hWallet = await generateWalletHelper({
      xpub,
    });

    // Fullnode derives addresses locally from xpub — verify all 20 match precalculated.
    for (let i = 0; i < 20; ++i) {
      expect(await hWallet.getAddressAtIndex(i)).toStrictEqual(walletData.addresses[i]);
    }
  });

  it('should reject write operations on a readonly (xpub) wallet', async () => {
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
    const xpub = deriveXpubFromSeed(walletData.words);

    const hWallet = await generateWalletHelper({
      xpub,
    });

    // Methods requiring private key should throw WalletFromXPubGuard.
    // All calls below deliberately omit required args — the guard rejects before arg validation.
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
  });

  it('should start an externally signed wallet', async () => {
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
    const code = new Mnemonic(walletData.words);
    const rootXpriv = code.toHDPrivateKey('', new Network('testnet'));
    const xpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    const xpub = xpriv.xpubkey;

    const hWallet = await generateWalletHelper({
      xpub,
    });
    // @ts-expect-error -- Simplified mock: real EcdsaTxSign has a different signature
    hWallet.setExternalTxSigningMethod(async () => {});
    expect(hWallet.isReady()).toStrictEqual(true);
    await expect(hWallet.isReadonly()).resolves.toBe(false);
    hWallet.setExternalTxSigningMethod(null);
    await expect(hWallet.isReadonly()).resolves.toBe(true);
  });

  it('should start an externally signed wallet from storage', async () => {
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
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
    });
    expect(hWallet.isReady()).toStrictEqual(true);
    await expect(hWallet.isReadonly()).resolves.toBe(false);
    hWallet.setExternalTxSigningMethod(null);
    await expect(hWallet.isReadonly()).resolves.toBe(true);
  });

  it('should create a token with an external signer and no pin (signTx: true)', async () => {
    // Reproduces the passkey-wallet flow end to end: an xpub-only wallet with an external
    // tx-signing method registered builds AND signs a create-token transaction (signTx defaults
    // to true) with NO pin. The signer derives keys the way a passkey ceremony would and reuses
    // transactionUtils.signTxInputs — the same primitive getSignatureForTx wraps — so it must
    // NOT hit the "Pin is required." guard, and the produced signatures must be valid on-chain.
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
    const rootXpriv = new Mnemonic(walletData.words).toHDPrivateKey('', new Network('testnet'));
    const acctXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    // signTxInputs asks for the change-path xpriv (m/44'/280'/0'/0) and derives per-input keys.
    const changeXpriv = acctXpriv.deriveNonCompliantChild(0);

    const hWallet = await generateWalletHelper({ xpub: acctXpriv.xpubkey });
    hWallet.setExternalTxSigningMethod((tx, storage) =>
      transactionUtils.signTxInputs(tx, storage, async () => changeXpriv)
    );
    // The external signer, not a stored key, makes the wallet spendable.
    await expect(hWallet.isReadonly()).resolves.toBe(false);

    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 100n);

    // No pinCode passed: createNewToken -> prepareCreateNewToken({ signTx: true }) -> signed by
    // the external method -> mined and pushed. Must not throw "Pin is required.".
    const tokenTx = await hWallet.createNewToken('External Signer Token', 'EST', 100n);
    expect(tokenTx).not.toBeNull();
    const tokenUid = tokenTx!.hash!;
    await waitForTxReceived(hWallet, tokenUid);

    // Every input carries real signature data — the fullnode accepted the tx, so the external
    // signer produced valid signatures without a pin.
    expect(tokenTx!.inputs.length).toBeGreaterThan(0);
    for (const input of tokenTx!.inputs) {
      expect(input.data).not.toBeNull();
      expect(input.data!.length).toBeGreaterThan(0);
    }

    const balance = await hWallet.getBalance(tokenUid);
    expect(balance[0].balance).toStrictEqual({ unlocked: 100n, locked: 0n });

    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should send, mint, melt, delegate and destroy with an external signer and no pin', async () => {
    // The companion test above covers createNewToken. This walks the rest of the entry points
    // whose pin guard is relaxed for an external signer, on one xpub-only wallet with NO pin.
    // Each is asserted on-chain rather than on the absence of an error: a relaxed guard that
    // let a build through while producing invalid signatures would be rejected by the fullnode,
    // so waiting for the tx to be received is what proves the signer actually signed.
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
    const rootXpriv = new Mnemonic(walletData.words).toHDPrivateKey('', new Network('testnet'));
    const acctXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);
    const changeXpriv = acctXpriv.deriveNonCompliantChild(0);

    const hWallet = await generateWalletHelper({ xpub: acctXpriv.xpubkey });
    // The "device" side of a passkey wallet: keys live outside the wallet, and the signer
    // reuses the same primitive getSignatureForTx wraps.
    hWallet.setExternalTxSigningMethod((tx, storage) =>
      transactionUtils.signTxInputs(tx, storage, async () => changeXpriv)
    );
    await expect(hWallet.isReadonly()).resolves.toBe(false);

    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 200n);

    // createNewToken keeps the mint and melt authorities on this wallet.
    const tokenTx = await hWallet.createNewToken('Relaxed Guards', 'RLX', 100n);
    const tokenUid = tokenTx!.hash!;
    await waitForTxReceived(hWallet, tokenUid);

    // sendManyOutputsSendTransaction
    const sendTx = await hWallet.sendManyOutputsTransaction([
      { address: await hWallet.getAddressAtIndex(1), value: 10n, token: NATIVE_TOKEN_UID },
    ]);
    await waitForTxReceived(hWallet, sendTx!.hash!);

    // prepareMintTokensData
    const mintTx = await hWallet.mintTokens(tokenUid, 50n);
    await waitForTxReceived(hWallet, mintTx!.hash!);
    expect((await hWallet.getBalance(tokenUid))[0].balance.unlocked).toStrictEqual(150n);

    // prepareMeltTokensData
    const meltTx = await hWallet.meltTokens(tokenUid, 30n);
    await waitForTxReceived(hWallet, meltTx!.hash!);
    expect((await hWallet.getBalance(tokenUid))[0].balance.unlocked).toStrictEqual(120n);

    // prepareDelegateAuthorityData
    const delegateTx = await hWallet.delegateAuthority(
      tokenUid,
      AuthorityType.MINT,
      await hWallet.getAddressAtIndex(2)
    );
    await waitForTxReceived(hWallet, delegateTx!.hash!);

    // prepareDestroyAuthorityData — the delegation above left two mint authorities.
    const destroyTx = await hWallet.destroyAuthority(tokenUid, AuthorityType.MINT, 1);
    await waitForTxReceived(hWallet, destroyTx!.hash!);

    // Every signed tx carries real input data; the fullnode accepted all of them.
    for (const tx of [sendTx, mintTx, meltTx, delegateTx, destroyTx]) {
      expect(tx!.inputs.length).toBeGreaterThan(0);
      for (const input of tx!.inputs) {
        expect(input.data).not.toBeNull();
        expect(input.data!.length).toBeGreaterThan(0);
      }
    }

    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should still require a pin on the relaxed entry points without an external signer', async () => {
    // The other half of the relaxation: with no external signer registered, an xpub-only wallet
    // is readonly and every one of these entry points must still refuse to sign.
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
    const rootXpriv = new Mnemonic(walletData.words).toHDPrivateKey('', new Network('testnet'));
    const acctXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH);

    const hWallet = await generateWalletHelper({ xpub: acctXpriv.xpubkey });
    await expect(hWallet.isReadonly()).resolves.toBe(true);

    const address0 = await hWallet.getAddressAtIndex(0);
    await expect(hWallet.mintTokens('0'.repeat(64), 1n)).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.meltTokens('0'.repeat(64), 1n)).rejects.toThrow(WalletFromXPubGuard);
    await expect(
      hWallet.delegateAuthority('0'.repeat(64), AuthorityType.MINT, address0)
    ).rejects.toThrow(WalletFromXPubGuard);
    await expect(hWallet.destroyAuthority('0'.repeat(64), AuthorityType.MINT, 1)).rejects.toThrow(
      WalletFromXPubGuard
    );

    await hWallet.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should start a wallet without pin (hack test)', async () => {
    const walletData = await precalculationHelpers.test!.getPrecalculatedWallet();
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
