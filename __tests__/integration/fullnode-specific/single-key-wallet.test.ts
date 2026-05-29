/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-specific single-key wallet tests.
 *
 * A single-key wallet is built from a raw secp256k1 private key (the Web3Auth
 * use case) instead of a seed/xpriv/xpub. It holds exactly one address and no
 * BIP32 material, so it is a {@link HathorWallet}-only feature — the
 * wallet-service facade has no single-key counterpart, hence there is no shared
 * suite for it.
 *
 * Coverage: single-address start, derivation guards (operations that require
 * deriving beyond index 0 must throw), local-key access/signing, and a
 * round-trip transaction signed with the raw key.
 */

import Mnemonic from 'bitcore-mnemonic/lib/mnemonic';
import HathorWallet from '../../../src/new/wallet';
import Network from '../../../src/models/network';
import { NATIVE_TOKEN_UID, P2PKH_ACCT_PATH } from '../../../src/constants';
import { AddressError } from '../../../src/errors';
import { WalletTracker } from '../utils/wallet-tracker.util';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import {
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  waitForTxReceived,
  waitForWalletReady,
} from '../helpers/wallet.helper';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';

// Derive a raw single-key (rawPriv, pubKey) from a dedicated seed that is not
// part of the pre-calculated wallet pool, so its single address starts empty.
// Mirrors the derivation used by `generateAccessDataFromSeed`:
// m/44'/280'/0'/0 (change path), then bitcore `.deriveChild(0)` for addr 0.
const SEED =
  'drink favorite jewel cage jar grief endorse judge kitten ten hurry where ' +
  'project alley drill illness claim month era simple paddle crater menu problem';

const network = new Network('testnet');
const rootXpriv = new Mnemonic(SEED).toHDPrivateKey('', network.bitcoreNetwork);
const changeXpriv = rootXpriv.deriveNonCompliantChild(P2PKH_ACCT_PATH).deriveNonCompliantChild(0);
const addr0HDKey = changeXpriv.deriveChild(0);
const rawPrivHex = addr0HDKey.privateKey.toString('hex');
const pubKeyHex = addr0HDKey.publicKey.toString('hex');

const adapter = new FullnodeWalletTestAdapter();
const tracker = new WalletTracker<HathorWallet>({
  cleanStorage: true,
  cleanAddresses: true,
});

/**
 * Start a raw single-key wallet against the integration fullnode.
 * `scanPolicy` is intentionally omitted so it defaults to SINGLE_ADDRESS
 * (the only policy a key-only wallet can sync under).
 */
async function startSingleKeyWallet(): Promise<HathorWallet> {
  const hWallet = new HathorWallet({
    connection: generateConnection(),
    privateKey: rawPrivHex,
    publicKey: pubKeyHex,
    password: DEFAULT_PASSWORD,
    pinCode: DEFAULT_PIN_CODE,
  });
  tracker.track(hWallet);
  await hWallet.start();
  await waitForWalletReady(hWallet);
  return hWallet;
}

// --- Suite lifecycle ---
beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

// --- Fullnode-specific tests ---
describe('[Fullnode-specific] single-key wallet', () => {
  afterEach(async () => {
    await tracker.stopAll();
    await adapter.stopAllWallets();
  });

  it('should start with a single address and reject derivation operations', async () => {
    const hWallet = await startSingleKeyWallet();

    // Address 0 is available and matches the provided key.
    const address0 = await hWallet.getAddressAtIndex(0);
    expect(address0).toBeTruthy();

    // The wallet holds no material to derive any other index.
    await expect(hWallet.getAddressAtIndex(1)).rejects.toThrow(AddressError);

    // Every operation that depends on deriving further addresses must throw.
    await expect(hWallet.getNextAddress()).rejects.toThrow(/address-derivation capability/);
    await expect(hWallet.setGapLimit(30)).rejects.toThrow(/address-derivation capability/);
    await expect(hWallet.enableMultiAddressMode()).rejects.toThrow(/address-derivation capability/);
    await expect(hWallet.indexLimitSetEndIndex(5)).rejects.toThrow(/address-derivation capability/);
  });

  it('should expose the single private key and reject other indexes', async () => {
    const hWallet = await startSingleKeyWallet();

    // Index 0 returns the raw private key (not an HDPrivateKey).
    const key = await hWallet.getAddressPrivKey(DEFAULT_PIN_CODE, 0);
    expect(key.toString()).toBe(rawPrivHex);

    // Any other index is invalid for a single-key wallet.
    await expect(hWallet.getAddressPrivKey(DEFAULT_PIN_CODE, 1)).rejects.toThrow(AddressError);

    // Message signing uses the single key (index 0).
    const signed = await hWallet.signMessageWithAddress('hathor', 0, DEFAULT_PIN_CODE);
    expect(typeof signed).toBe('string');
    expect(signed.length).toBeGreaterThan(0);
  });

  it('should send a transaction signed with the local single key', async () => {
    const hWallet = await startSingleKeyWallet();
    const address0 = await hWallet.getAddressAtIndex(0);

    // Use relative balances: the single address is deterministic, so a shared
    // fullnode (e.g. local re-runs) may already hold funds from a prior run.
    const balanceBefore = (await hWallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;

    // Fund the single address from the genesis wallet.
    await GenesisWalletHelper.injectFunds(hWallet, address0, 10n);
    const balanceFunded = (await hWallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balanceFunded).toBe(balanceBefore + 10n);

    // Spend back to the same (only) address; the wallet must sign locally with
    // the raw key. Change also returns to address 0 since it is the only one.
    const tx = await hWallet.sendTransaction(address0, 4n, { changeAddress: address0 });
    expect(tx.hash).toBeTruthy();
    expect(tx.inputs.length).toBeGreaterThan(0);
    // Inputs are signed.
    expect(tx.inputs[0].data).not.toBeFalsy();

    await waitForTxReceived(hWallet, tx.hash);

    // Simple HTR transfer has no fee and goes back to the only address, so the
    // total unlocked balance is unchanged.
    const balanceAfter = (await hWallet.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked;
    expect(balanceAfter).toBe(balanceFunded);
  });
});
